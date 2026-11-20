# Repository law

`alchemy-emulate` is one published package: **emulate**'s local API emulators
(GitHub, Vercel, Google, Slack, Stripe, …) behind alchemy-shaped Effect layers.
The public contract is `README.md`; this file is how to change it without
breaking it.

Read `.agent_sources/README.md` before non-trivial Effect work and run
`pnpm vendor:agent-sources` to populate the mirrors. Alchemy's
`packages/better-auth/src/` is the design reference this package copies:
options-in function, one platform layer per transport, typed errors, layer-owned
lifecycle.

## The seam

Two halves, and every change lands in one of them:

- **`Emulate(options)`** (`src/Emulate.ts`) — reads the ambient `Emulator`
  service, acquires one runner per configured service, returns a typed handle
  per service. It owns no process and no transport.
- **Platform layers** (`src/InProcess.ts`, `src/Connect.ts`) — provide
  `Emulator` (`src/Emulator.ts`). This is where a process is started or a URL is
  trusted, and nowhere else. `InProcess` owns lifetime; `Connect` owns nothing.

Keep the two peers symmetric: a capability added to one platform and not the
other is a bug unless it is impossible off-process (see `reset`).

`Emulator` is a **platform seam**, not a service with one canonical constructor,
so `require-service-make-layer` is disabled at the two `Layer.effect` sites.
Those two disables are the whole exception; anywhere else, give the service a
`make` and a static layer.

## The gate

Run `pnpm check` before claiming a change is ready. It is:

```bash
pnpm lint          # oxlint: anti-slop + effecttsgo rules + smells
pnpm format:check  # oxfmt
pnpm typecheck     # tsrs (The Effect-patched TypeScript 7)
pnpm lint:types    # effect-tsgo diagnostics, warnings are errors
pnpm test          # vitest with live in-process emulators
```

`pnpm fix` applies the safe lint and format fixes; `pnpm build` then
`pnpm pack` proves the published tarball. A change is done when `pnpm check`,
`pnpm test`, and `pnpm build` are green.

## Pins

Every version is exact. The checker trio moves together:
`@effect/tsgo` ↔ `tsrs` ↔ `typescript`. `@effect/tsgo` refuses a `tsrs` build it
does not ship replacements for, so bump all three in one commit and re-run
`pnpm install`.

`prepare` runs `effect-tsgo patch --oxlint --tsrs --no-typescript`. That patch
is what teaches Oxlint the `effecttsgo` plugin and gives `tsrs` the Effect
language service. If lint fails with `Unknown plugin: 'effecttsgo'`, the patch
has not run: `pnpm install`.

## Layout

Alchemy's package conventions, applied to a single package at the repo root:

- `src/<PascalCase>.ts` — one concern per module, named for the thing it
  exports (`Emulate.ts`, `InProcess.ts`). No `index.ts` per folder.
- `src/index.ts` — the barrel; every public name appears there.
- `test/<Name>.test.ts` — beside `src/`, driving the public API. Fixtures under
  `test/fixtures/` if a test needs one.
- `scripts/build.ts` — the only build entry; `scripts/vendor-agent-sources.sh`
  refreshes mirrors.
- `package.json` — source-first `exports` (`./src/*.ts`) plus
  `publishConfig.exports` mapping to `lib/`, `files: ["lib", "src", "NOTICE",
  "README.md"]`, `build:package` for the compile step. Copy it, don't invent a
  bundler.

## API invariants

These are the rules the public contract depends on:

- **Stable surface.** Public types are web types (`Response`, `Headers`,
  `RequestOptions` of our own making). `effect/http` marks everything unstable,
  so an `effect/http` type in a signature is a leak even when it compiles. The
  `api-stability-leak` rule is off only because effect is pinned exactly — the
  invariant still applies.
- **`request` returns a web `Response`.** Callers assert on what a client sees.
  Converting to an Effect-native response type would leak the client's world
  into the emulator's contract.
- **Errors are the interface.** Each failure is a `Schema.TaggedError` with a
  `message` shaped `<what happened>. <why>. Fix: <a command, file, or
  replacement in a code span>`. Add a tag rather than reusing a near-miss one.
- **No silent drops.** `Connect` rejects options it cannot apply
  (`EmulateExternalConfigError`); it never pretends a seed took effect.
- **Ephemeral ports are the default** (`port: 0`). A fixed default port is what
  makes emulators collide across services and test files. `emulate` reports
  `url` as `localhost` even when `hostname` is set; assert on the port, not the
  host string.
- **`listen: false` is custom-emulator only.** Named services always bind a
  socket, which is why `InProcess` requires Node and a real HTTP client rather
  than an in-memory handler.
- **The layer owns the process.** `InProcess` keeps one instance per service
  name for the layer's lifetime and closes it on scope close. Construction must
  never happen per request.
- **Two callers, one emulator.** `Emulate` relies on `acquire` being memoized by
  service name; a platform that starts a fresh emulator per call breaks the
  contract (the `shares one emulator` test pins it).

## The lint fence

`tools/oxlint/anti-slop/` is vendored (see its `UPSTREAM.md`) and our copy is
ours to change. Anti-slop rules stay at `error` (the Fowler smells are `warn`
prompts to look); a rule that fires on new code is a finding, not noise.

- Suppress narrowly: `// oxlint-disable-next-line <plugin>/<rule> -- <reason>`,
  with the reason stating the invariant the rule cannot see. Unused directives
  fail lint.
- The `prefer-effect-record` disables on service maps are structural, not
  temporary: `effect/Record`'s `ReadonlyRecord` cannot model a map with optional
  values under `exactOptionalPropertyTypes`. Keep them on the `Object.entries`
  line and summarise the reason.
- The repo-wide `api-stability-leak` and `lazy-effect` settings in
  `oxlint.config.ts` carry their reasons inline. Do not widen them.
- Comments explain _why_, never _what_. Anything a name, type, or test can say
  belongs there instead.

## Tests

Tests drive the public API against real emulators — no mocks of `emulate`, no
assertions on our own internals.

- `it.layer(platform(), { buildPerTest: true })` gives each test fresh
  emulators; the default shares one layer and leaks state between tests.
- Assert on what the emulator returns (`/zen` → 200, `/` on slack → 200) and on
  the seam's behaviour (shared URL, distinct endpoints, typed failures). A test
  that only proves a function was called is not a test.
- Prefer a seeded token over a hand-written fake; `seed` is the fixture.
- A fix earns a test only when it closes a real behavioural gap.

## Publishing

`pnpm check && pnpm build && pnpm pack` is the release rehearsal. The tarball
must contain `lib/`, `src/`, `NOTICE`, `NOTICE` again under `lib/`, `LICENSE`,
and `README.md`. `scripts/build.ts` fails when `publishConfig.exports` names a
file the build did not produce.

Bump `version` in `package.json`; there is no changelog tool. `.github/workflows/publish.yml`
publishes on a `v<version>` tag that matches the manifest, using npm trusted
publishing (OIDC, no token in the repo). Publishing and version numbers need
owner sign-off.

## Boundaries

- Direct: source, tests, docs, this file, `.agent_sources/README.md`, the vendor
  script, `tools/oxlint/anti-slop/` while keeping its `UPSTREAM.md` current.
- Ask first: adding or changing a dependency or pin, changing the publish map or
  `files`, disabling a lint rule repo-wide, adding a platform layer that owns a
  new kind of process, and anything that changes the public API's shape.
- Never: commit `.agent_sources/github.com/`, secrets, or generated `lib/`.
  Never `git … --no-verify`.
