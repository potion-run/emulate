/**
 * Release-note generation: `git log` → changelogen's conventional-commit
 * parser → `render.ts`.
 *
 * This is alchemy's generator (`scripts/release/changelog.ts`), copied rather
 * than depended on. This used to be changelogithub there, but only its
 * commit-range read, parser and author dedupe were used (no GitHub token was
 * ever passed, so authors were never resolved to logins), and it pins an old
 * changelogen that drags in deprecated `tar@6`. What's left of it is the
 * defaults below.
 *
 * Runs under node through Effect's `ChildProcessSpawner`. The log is read
 * through a pipe rather than a fixed buffer: `git log … --name-status` prints
 * every changed path of every commit in the range, so a release spanning one
 * repo-wide refactor overflows `execSync`'s 1 MB default and the release dies
 * at the tagging step having already bumped versions.
 */
import { parseCommits, type ChangelogConfig, type GitCommit, type RawGitCommit } from "changelogen";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as String from "effect/String";
import { renderMarkdown, type RenderConfig } from "./render.ts";

export interface Commit extends GitCommit {
  /** Commit authors (incl. co-authors), deduped by email, bots dropped. */
  resolvedAuthors: Array<{ name: string; email: string }>;
}

export interface ChangelogOptions {
  /** Start of the range. Defaults to the closest tag before `to`. */
  from?: Option.Option<string>;
  to: string;
  /** `<owner>/<repo>`. */
  repo: string;
}

const defaults = {
  types: {
    feat: { title: "🚀 Features" },
    fix: { title: "🐞 Bug Fixes" },
    perf: { title: "🏎 Performance" },
  },
  titles: { breakingChanges: "🚨 Breaking Changes" },
  emoji: true,
  capitalize: true,
  baseUrl: "github.com",
  scopeMap: {},
};

const excludeAuthors = [/\[bot\]/i, /dependabot/i, /\(bot\)/i];

export class GitFailed extends Schema.TaggedError<GitFailed, { readonly brand: unique symbol }>()(
  "GitFailed",
  {
    message: Schema.String,
    args: Schema.Array(Schema.String),
    exitCode: Schema.Finite,
  },
) {}

/** Runs git, collecting stdout and stderr through pipes. */
const git = Effect.fn(function* (args: ReadonlyArray<string>) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(
        ChildProcess.make("git", [...args], {
          stdout: "pipe",
          stderr: "pipe",
          forceKillAfter: "5 seconds",
        }),
      );

      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
          handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
          handle.exitCode,
        ],
        { concurrency: "unbounded" },
      );

      return { stdout, stderr, exitCode: Number(exitCode) };
    }),
  );
});

/** The tag closest to `to`, excluding a tag on `to` itself. */
const previousTag = Effect.fn(function* (to: string) {
  const { stdout, exitCode } = yield* git(["describe", "--tags", "--abbrev=0", `${to}^`]);

  return exitCode === 0 ? Option.some(String.trim(stdout)) : Option.none<string>();
});

/**
 * Same command and record format as changelogen's `getGitDiff` (the `----`
 * separator and `|`-delimited header are what `parseCommits` expects).
 */
const gitDiff = Effect.fn(function* (from: Option.Option<string>, to = "HEAD") {
  const range = Option.match(from, {
    onNone: () => to,
    onSome: (tag) => `${tag}...${to}`,
  });

  const args = ["--no-pager", "log", range, "--pretty=----%n%s|%h|%an|%ae%n%b", "--name-status"];

  const { stdout, stderr, exitCode } = yield* git(args);

  if (exitCode !== 0) {
    return yield* GitFailed.make({
      message: `git log ${range} failed: ${String.trim(stderr)}`,
      args,
      exitCode,
    });
  }

  const records = Arr.drop(1)(String.split(String.trim(stdout), "----\n"));

  return Arr.map(records, (record): RawGitCommit => {
    const [firstLine, ...bodyLines] = String.split(record, "\n");
    const [message, shortHash, authorName, authorEmail] = String.split(firstLine, "|");

    return {
      message: message ?? "",
      shortHash: shortHash ?? "",
      author: { name: authorName ?? "", email: authorEmail ?? "" },
      body: Arr.join(bodyLines, "\n"),
    };
  });
});

/** Attaches `resolvedAuthors`, keeping the first name seen per email. */
const resolveAuthors = (commits: GitCommit[]): Commit[] => {
  const byEmail = new Map<string, { name: string; email: string }>();

  const resolve = (
    author: GitCommit["authors"][number],
  ): Array<{ name: string; email: string }> => {
    const excluded = Arr.some(excludeAuthors, (pattern) => pattern.test(author.name));

    if (author.email === "" || author.name === "" || excluded) {
      return [];
    }

    const seen = byEmail.get(author.email);

    if (seen !== undefined) {
      return [seen];
    }

    const resolved = { name: author.name, email: author.email };

    byEmail.set(author.email, resolved);

    return [resolved];
  };

  return Arr.map(commits, (commit) => ({
    ...commit,
    resolvedAuthors: Arr.flatMap(commit.authors, resolve),
  }));
};

export const generate = Effect.fn(function* (options: ChangelogOptions) {
  const from = options.from !== undefined ? options.from : yield* previousTag(options.to);

  const config: RenderConfig = {
    ...defaults,
    repo: options.repo,
    from: Option.getOrElse(from, () => ""),
    to: options.to,
  };

  // changelogen's parser reads only `scopeMap`; the rest of its config is
  // irrelevant to the conventional-commit parse, so build a full (unused)
  // config instead of asserting RenderConfig into ChangelogConfig.
  const parseConfig: ChangelogConfig = {
    cwd: "",
    types: config.types,
    scopeMap: config.scopeMap ?? {},
    tokens: {},
    from: config.from,
    to: config.to,
    output: false,
    publish: {},
    templates: {},
    noAuthors: false,
    excludeAuthors: [],
  };

  const raw = yield* gitDiff(from, options.to);
  const commits = resolveAuthors(parseCommits(raw, parseConfig));

  return { config, commits, md: renderMarkdown(commits, config) };
});
