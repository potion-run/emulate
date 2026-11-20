# Cloudflare Emulate

A Cloudflare Worker that calls the GitHub API — against [emulate](https://emulate.dev)'s
local GitHub emulator under `alchemy dev`, and the real `https://api.github.com` on
`alchemy deploy`. The whole dev→deploy story is one resource:

```typescript
const github =
  yield *
  EmulateService("github", {
    service: "github",
    url: "https://api.github.com",
    dev: {
      seed: {
        tokens: { ghp_emulate: { login: "octocat" } },
        github: { users: [{ login: "octocat", name: "The Octocat" }] },
      },
    },
  });
```

`alchemy dev` starts the emulator in the dev sidecar (seeded with the
`ghp_emulate` token) and binds its ephemeral URL into the Worker's
`GITHUB_API_URL`; `alchemy deploy` reports the real endpoint from `url`
instead. The Worker never knows which one it got.

## Run locally

From the repository root:

```sh
pnpm install
cd examples/cloudflare-emulate
bun run dev
```

No Cloudflare account is needed for local development — placeholder
credentials satisfy the local providers, and nothing leaves the machine.
Alchemy prints the Worker's URL; open it:

- `/zen` — the emulator's GitHub wisdom, proxied through the Worker
- `/user` — the seeded `octocat`, authenticated with the seeded token

Editing the seed (or the port, or switching to `dev: { mode: "external" }`)
restarts the emulator on the next save; `alchemy dev` re-plans and re-binds
the new URL into the Worker.

## Verify

The integration test deploys the stack through the same topology
`alchemy dev` uses — emulator in the provider sidecar, Worker in local
workerd — and asserts the seeded flow end to end:

```sh
bun test
```

## Deploy

```sh
bun run deploy --stage production
```

The deploy binds `https://api.github.com` into the Worker. Replace the
placeholder token with a real one before serving traffic: `GITHUB_TOKEN`
is a dev token the real GitHub API will reject.
