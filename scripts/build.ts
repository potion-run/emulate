/**
 * Package build for `@potion-run/emulate`.
 *
 * In the workspace this package resolves from `src/*.ts`: `exports` points
 * straight at source, so consumers and linked checkouts need no build. A
 * published tarball swaps in `publishConfig.exports`, which resolves to the
 * compiled `lib/` output while keeping the `bun` and `worker` conditions on
 * source — the same source-first contract alchemy's own packages publish.
 *
 * Steps:
 *
 * 1. `tsrs -p tsconfig.build.json` emits `lib/*.js` and `lib/*.d.ts`, with
 *    `rewriteRelativeImportExtensions` turning `./Foo.ts` into `./Foo.js`.
 * 2. Copy `NOTICE` next to the output.
 * 3. Verify `publishConfig.exports` names only files the build produced, so a
 *    missing entry point fails here instead of in a consumer's install.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as Arr from "effect/Array";
import * as Record from "effect/Record";
import * as Schema from "effect/Schema";
import * as String from "effect/String";

const Conditions = Schema.Record(Schema.String, Schema.String);

const ExportTarget = Schema.Union([Schema.String, Conditions]);

const ExportMap = Schema.Record(Schema.String, ExportTarget);

const BuildManifest = Schema.Struct({
  publishConfig: Schema.optional(Schema.Struct({ exports: Schema.optional(ExportMap) })),
});

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const fail: (message: string) => never = (message) => {
  process.stderr.write(`${message}\n`);

  return process.exit(1);
};

const runCommand = (command: string, args: ReadonlyArray<string>): void => {
  process.stdout.write(`> ${command} ${Arr.join(args, " ")}\n`);
  execFileSync(command, [...args], { cwd: repositoryRoot, stdio: "inherit" });
};

const readManifest = () =>
  Schema.decodeSync(Schema.fromJsonString(BuildManifest))(
    readFileSync(join(repositoryRoot, "package.json"), "utf8"),
  );

const manifest = readManifest();

const publishedExports = manifest.publishConfig?.exports;

if (publishedExports === undefined) {
  fail("package.json has no publishConfig.exports. Fix: restore the alchemy-style publish map.");
}

const targets = Arr.flatMap(Record.values(publishedExports), (target) =>
  Schema.is(Schema.String)(target) ? [target] : Record.values(target),
);

const builtEntries = Arr.filter(
  targets,
  (target) => String.startsWith("./lib/")(target) && !String.includes("*")(target),
);

const compiler = join(
  repositoryRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsrs.cmd" : "tsrs",
);

runCommand(compiler, ["-p", "tsconfig.build.json"]);

mkdirSync(join(repositoryRoot, "lib"), { recursive: true });

copyFileSync(join(repositoryRoot, "NOTICE"), join(repositoryRoot, "lib", "NOTICE"));

const missing = Arr.filter(builtEntries, (entry) => !existsSync(join(repositoryRoot, entry)));

if (missing.length > 0) {
  fail(
    `publishConfig.exports points at files the build did not produce: ${Arr.join(missing, ", ")}. Fix: check tsconfig.build.json's rootDir/outDir, or the export map.`,
  );
}

const entryPoint = join(repositoryRoot, "lib", "index.d.ts");

if (!existsSync(entryPoint)) {
  fail(
    `the build produced no lib/index.d.ts. Fix: check tsconfig.build.json includes src/index.ts and rewrites relative import extensions.`,
  );
}

process.stdout.write(`verified ${builtEntries.length} built export targets and lib/index.d.ts\n`);
