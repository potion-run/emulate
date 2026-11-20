# Vendored anti-slop

`tools/oxlint/anti-slop/` is a copy of the plugin, not an npm dependency. The
rules are ours to read and change.

| | |
| --- | --- |
| Upstream | https://github.com/K-Mistele/anti-slop |
| Ref | `main` at `13b020367525e8c6efe6cede8f387697b2a8d907` (2026-11-19) |
| Copied | `src/` → this directory, plus `README.md` and `LICENSE` |
| Local changes | none |

`vendor/eslint-stylistic/` inside the copy keeps its own `LICENSE` and
`UPSTREAM.md`; `require-readable-spacing` derives from that MIT code.

## Refresh

```bash
git clone --depth 1 https://github.com/K-Mistele/anti-slop /tmp/anti-slop
rsync -a --delete /tmp/anti-slop/src/ tools/oxlint/anti-slop/
cp /tmp/anti-slop/README.md /tmp/anti-slop/LICENSE tools/oxlint/anti-slop/
```

Then update the ref row above, run `pnpm check`, and re-read the diff for rules
that changed severity or added options.

## Which rules are on

`oxlint.config.ts` enables the core rules, the landmines testing rules, the
ai-guard rules, the Effect rules (`anti-slop-effect`), the cevr Effect runtime
rules, the enfect rules, and the Fowler smells at `warn`. The Jev (LLM-judged)
rules and the diff rules are off: they make paid model requests per run.

The vendored copy also ships `xstate/` and `martinfowler/jev-plugin.ts`; this
repository enables only what `oxlint.config.ts` names.
