# Agent source mirrors

Shallow git trees for source-first agent work. **Not runtime dependencies, not
typechecked, not linted.** Populate:

```bash
./scripts/vendor-agent-sources.sh
./scripts/vendor-agent-sources.sh --refresh   # replace existing mirrors
```

Layout: `.agent_sources/github.com/<owner>/<repo>/` with a `.agent-source.json`
metadata file per mirror. The trees are gitignored; the script and this file are
the source of truth.

## Inventory

Refs are derived from this repository's pins by
`scripts/vendor-agent-sources.sh`, so a bump in `package.json` is a bump here.

| Path | Upstream | Ref | Why |
| --- | --- | --- | --- |
| `github.com/Effect-TS/effect` | https://github.com/Effect-TS/effect.git | `effect@4.1.4` | Effect v4: `Context.Service`, `Layer`, `Schema.TaggedError`, `effect/http` |
| `github.com/alchemy-run/alchemy` | https://github.com/alchemy-run/alchemy.git | `v2.0.0-beta.87` | The integration shape this package follows: `packages/better-auth` (options-in / layers-on-the-impl pattern), `Local/ProviderLayer` (dev-mode resources), `scripts/package-build.ts` (publish map) |
| `github.com/vercel-labs/emulate` | https://github.com/vercel-labs/emulate.git | `v0.14.0` | Source behind the emulated services: `packages/emulate/src` service, seed, and lifecycle behavior. The published `node_modules/emulate/dist/api.d.ts` remains the runtime contract. |

Inspect before non-trivial Effect work. Prefer these mirrors over `node_modules`
for API shape, examples, and the reasoning behind a design.
