/**
 * Markdown renderer for the commits parsed by `changelog.ts`.
 *
 * Copied from alchemy (`scripts/release/render.ts`). Mirrors the output of
 * changelogithub's built-in generator (which alchemy used to depend on) but
 * groups conventional-commit scopes hierarchically by splitting on `/`. For
 * example commits like `fix(aws/lambda): ...`, `fix(aws/s3): ...` and
 * `fix(aws): ...` render as nested categories under a shared `**aws**`
 * top-level scope rather than as three unrelated flat groups.
 *
 * Line-level formatting (authors, PR/issue links, `<samp>` hash tags,
 * `&nbsp;` spacing) is kept byte-compatible with changelogithub so output
 * for single-segment scopes is identical to the upstream renderer.
 */
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Records from "effect/Record";
import * as String from "effect/String";
import type { Commit } from "./changelog.ts";

export interface RenderConfig {
  titles: { breakingChanges?: string };
  types: Record<string, { title: string }>;
  capitalize: boolean;
  emoji: boolean;
  baseUrl: string;
  repo: string;
  from: string;
  to: string;
  scopeMap?: Record<string, string>;
}

const emojisRE =
  /([\u2700-\u27BF\uE000-\uF8FF\u2011-\u26FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDD10-\uDDFF])/g;

// oxlint-disable-next-line effecttsgo/missing-pipeable-signature -- a renderer formats a commit list; it is not a data-last pipe stage.
export function renderMarkdown(commits: Commit[], config: RenderConfig): string {
  const lines: string[] = [];
  const [breaking, rest] = partition(commits, (commit) => commit.isBreaking);
  const breakingTitle = config.titles.breakingChanges;

  if (breakingTitle !== undefined) {
    lines.push(...renderSection(breaking, breakingTitle, config));
  }

  const byType = groupBy(rest, (commit) => commit.type);
  const types = Records.keys(config.types);

  for (const type of types) {
    const section = config.types[type];

    if (section !== undefined) {
      lines.push(...renderSection(byType[type] ?? [], section.title, config));
    }
  }

  if (lines.length === 0) {
    lines.push("*No significant changes*");
  }

  // The first release has no previous tag to compare against, so
  // `compare/...HEAD` would be a dead link; omit it instead.
  if (config.from !== "") {
    const url = `https://${config.baseUrl}/${config.repo}/compare/${config.from}...${config.to}`;

    lines.push("", `##### &nbsp;&nbsp;&nbsp;&nbsp;[View changes on GitHub](${url})`);
  }

  return String.trim(Arr.join(lines, "\n"));
}

interface Node {
  commits: Commit[];
  children: Record<string, Node>;
}

function makeNode(): Node {
  return { commits: [], children: {} };
}

function renderSection(commits: Commit[], sectionName: string, config: RenderConfig): string[] {
  if (commits.length === 0) {
    return [];
  }

  const out: string[] = ["", formatTitle(sectionName, config), ""];

  // Build a tree keyed by the `/`-separated scope segments. Commits attach
  // to the deepest node that matches their scope exactly.
  const root = makeNode();

  for (const commit of commits) {
    const scope = String.trim(commit.scope ?? "");
    const mapped = config.scopeMap?.[scope] ?? scope;

    const segments =
      mapped === ""
        ? []
        : Arr.filter(
            Arr.map(String.split(mapped, "/"), (segment) => String.trim(segment)),
            (segment) => segment !== "",
          );

    let node = root;

    for (const segment of segments) {
      const child = node.children[segment] ?? makeNode();

      node.children[segment] = child;
      node = child;
    }

    node.commits.push(commit);
  }

  return [...out, ...renderNode(root, 0, config)];
}

function renderNode(node: Node, depth: number, config: RenderConfig): string[] {
  const lines: string[] = [];
  const pad = String.repeat(depth)("  ");

  // Reverse to match changelogithub's ordering: commits come out of git log
  // newest-first, and the upstream renderer flips them so the oldest entry
  // in the range appears at the top of each bucket.
  for (const commit of Arr.reverse(node.commits)) {
    lines.push(`${pad}- ${formatLine(commit, config)}`);
  }

  const childNames = Arr.sort(Records.keys(node.children), Order.String);

  // Match changelogithub's `group: true` default: within a given level, if
  // ANY sibling scope has more than a single inline-able commit (either
  // multiple commits or further sub-scopes), force every sibling to render
  // with a header. This keeps visual alignment consistent and is what the
  // existing CHANGELOG.md entries already use, so it avoids regressing
  // historical release-notes style.
  const forceHeaders = Arr.some(childNames, (name) => {
    const child = node.children[name];

    return (
      child !== undefined && (countCommits(child) > 1 || Records.keys(child.children).length > 0)
    );
  });

  for (const name of childNames) {
    const child = node.children[name];

    if (child === undefined) {
      continue;
    }

    const label = `**${name}**`;
    const childCommitCount = countCommits(child);
    const hasGrandchildren = Records.keys(child.children).length > 0;

    // Collapse inline only when NO sibling wants a header and this child is
    // a single-commit leaf. Otherwise emit the header + nested bullets.
    if (!forceHeaders && childCommitCount === 1 && !hasGrandchildren) {
      const commit = child.commits[0];

      if (commit !== undefined) {
        lines.push(`${pad}- ${label}: ${formatLine(commit, config)}`);
      }

      continue;
    }

    lines.push(`${pad}- ${label}:`);
    lines.push(...renderNode(child, depth + 1, config));
  }

  return lines;
}

function countCommits(node: Node): number {
  let total = node.commits.length;

  for (const child of Records.values(node.children)) {
    total += countCommits(child);
  }

  return total;
}

function formatTitle(name: string, config: RenderConfig): string {
  const title = config.emoji ? name : String.replace(emojisRE, "")(name);

  return `### &nbsp;&nbsp;&nbsp;${String.trim(title)}`;
}

function formatLine(commit: Commit, config: RenderConfig): string {
  const prRefs = formatReferences(commit.references, config, "issues");
  const hashRefs = formatReferences(commit.references, config, "hash");

  const authorNames = Arr.dedupe(Arr.map(commit.resolvedAuthors, (author) => `**${author.name}**`));

  const authors = String.trim(joinWithAnd(authorNames));
  const authorStr = authors === "" ? "" : `by ${authors}`;

  const refs = Arr.join(
    Arr.filter([authorStr, prRefs, hashRefs], (part) => String.trim(part) !== ""),
    " ",
  );

  const description = config.capitalize ? capitalize(commit.description) : commit.description;

  return Arr.join(
    Arr.filter(
      [description, refs === "" ? "" : `&nbsp;-&nbsp; ${refs}`],
      (part) => String.trim(part) !== "",
    ),
    " ",
  );
}

function formatReferences(
  references: Commit["references"],
  config: RenderConfig,
  kind: "issues" | "hash",
): string {
  const refs = Arr.flatMap(references, (ref) => {
    const relevant =
      kind === "issues" ? ref.type === "issue" || ref.type === "pull-request" : ref.type === "hash";

    if (!relevant) {
      return [];
    }

    if (config.repo === "") {
      return [ref.value];
    }

    if (ref.type === "pull-request" || ref.type === "issue") {
      return [`https://${config.baseUrl}/${config.repo}/issues/${String.slice(1)(ref.value)}`];
    }

    return [
      `[<samp>(${String.slice(0, 5)(ref.value)})</samp>](https://${config.baseUrl}/${config.repo}/commit/${ref.value})`,
    ];
  });

  const joined = String.trim(joinWithAnd(refs));

  if (kind === "issues") {
    return joined === "" ? "" : `in ${joined}`;
  }

  return joined;
}

function capitalize(value: string): string {
  const first = Option.match(String.charAt(0)(value), {
    onNone: () => "",
    onSome: String.toUpperCase,
  });

  return `${first}${String.slice(1)(value)}`;
}

function joinWithAnd(values: string[], glue = ", ", finalGlue = " and "): string {
  const first = values[0];

  if (first === undefined) {
    return "";
  }

  if (values.length === 1) {
    return first;
  }

  if (values.length === 2) {
    return Arr.join(values, finalGlue);
  }

  const last = Arr.last(values);

  return `${Arr.join(Arr.dropRight(values, 1), glue)}${finalGlue}${Option.getOrElse(last, () => "")}`;
}

function partition<T>(items: T[], pred: (item: T) => boolean): [T[], T[]] {
  const yes: T[] = [];
  const no: T[] = [];

  for (const item of items) {
    (pred(item) ? yes : no).push(item);
  }

  return [yes, no];
}

function groupBy<T>(items: T[], key: (item: T) => string) {
  const out: Record<string, T[]> = {};

  for (const item of items) {
    const group = key(item);
    const bucket = out[group] ?? [];

    bucket.push(item);
    out[group] = bucket;
  }

  return out;
}
