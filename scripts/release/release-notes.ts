// Prepends the release notes for a tag to CHANGELOG.md. Idempotent: a tag
// that already has a heading in CHANGELOG.md is skipped.
//
// The notes cover the commits since the previous tag, up to the tag if it
// exists yet, otherwise HEAD. Reads `EMULATE_REPO` (`<owner>/<repo>`) for the
// changelog's links, defaulting to `potion-run/emulate`.
//
// Usage: pnpm release:notes <tag>
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Argument from "effect/cli/Argument";
import * as Command from "effect/cli/Command";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as String from "effect/String";
import { generate } from "./changelog.ts";
import { repository } from "./config.ts";

/** Whether `tag` exists locally. */
const tagExists = Effect.fn(function* (tag: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const exitCode = yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(
        ChildProcess.make("git", ["rev-parse", "--verify", `refs/tags/${tag}`], {
          stdout: "ignore",
          stderr: "ignore",
          forceKillAfter: "5 seconds",
        }),
      );

      return yield* handle.exitCode;
    }),
  );

  return Number(exitCode) === 0;
});

const command = Command.make(
  "release-notes",
  {
    tag: Argument.String("tag").pipe(Argument.withDescription("Release tag, e.g. v0.1.0")),
  },
  Effect.fn(function* ({ tag }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const changelogPath = path.resolve("CHANGELOG.md");

    const existing = (yield* fs.exists(changelogPath))
      ? yield* fs.readFileString(changelogPath)
      : "";

    if (String.includes(`## ${tag}\n`)(existing)) {
      yield* Console.log(`${tag} already in CHANGELOG.md, skipping`);

      return;
    }

    const to = (yield* tagExists(tag)) ? tag : "HEAD";

    yield* Console.log(`Generating release notes for ${tag} (using ${to})`);

    const { md } = yield* generate({ to, repo: yield* repository });
    const separator = String.trim(existing) === "" ? "\n" : `\n\n---\n\n${existing}`;

    yield* fs.writeFileString(changelogPath, `## ${tag}\n\n${md}${separator}`);
  }),
).pipe(Command.withDescription("Prepend the release notes for a tag to CHANGELOG.md"));

Command.run(command, { version: "0.0.0" }).pipe(
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
