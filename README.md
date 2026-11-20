# alchemy-emulate

[emulate](https://github.com/vercel-labs/emulate) for the
[alchemy](https://alchemy.run) / [Effect](https://effect.website) stack: drop-in
local API emulators (GitHub, Vercel, Google, Slack, Stripe, …) wired as
Effect-native platform layers, with typed errors and layer-owned lifecycle.

The API follows alchemy's own integration shape — `@alchemy.run/better-auth`'s
`BetterAuth(options)` plus one platform layer per transport — so it slots into
the same composition point: the impl effect of a Worker, Function, or test.

```bash
pnpm add alchemy-emulate emulate effect
```

`alchemy-emulate` depends on `emulate` and peers on `effect` `4.1.4`; install
`effect` yourself so one copy serves the whole app. The alchemy resource peers
on `alchemy` (optional — the runtime half works without it), so a stack project
that declares emulators installs alchemy anyway and needs nothing extra.

## Quick start

```typescript
import { Emulate, InProcess } from "alchemy-emulate";
import * as Effect from "effect/Effect";

const program = Effect.gen(function* () {
  const emulate = yield* Emulate({
    services: {
      github: { seed: { tokens: { ghp_test: { login: "octocat" } } } },
    },
  });

  const response = yield* emulate.github.request("/zen");
  return { url: emulate.github.url, status: response.status };
}).pipe(Effect.provide(InProcess()));
```

`InProcess()` starts each requested emulator inside the current process, on an
**ephemeral port** (so several services and several test files never collide on
`emulate`'s default `4000`), and closes it when the layer's scope closes. Two
`Emulate` calls for the same service share one instance and its state.

## Attaching to a running server

`Connect` is the platform for anything that can reach a URL but cannot host a
server — a Cloudflare Worker, a Lambda, a CI job that runs `pnpm exec emulate`:

```typescript
import { Connect, Emulate } from "alchemy-emulate";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";

const platform = Connect({ github: "http://127.0.0.1:4000" }).pipe(
  Layer.provide(FetchHttpClient.layer),
);
```

`Connect` never owns a process, so `reset` fails with `EmulateResetError` — a
server you did not start can only be reset by restarting it. Options that would
have to reach the emulator's own configuration (`seed`, `port`, `baseUrl`,
`hostname`) fail with `EmulateExternalConfigError` instead of being dropped.

## The wiring, in alchemy terms

`Emulate` is a function of the ambient platform, exactly like `BetterAuth` is a
function of the ambient `Database`. Provide the platform on the impl effect of
the resource that needs the emulated API:

```typescript
import { Emulate, InProcess } from "alchemy-emulate";
import * as Effect from "effect/Effect";

Effect.gen(function* () {
  const emulate = yield* Emulate({ services: { github: {} } });
  const api = new Octokit({ baseUrl: emulate.github.url });
  return { fetch: /* ... */ };
}).pipe(Effect.provide(InProcess()));
```

That is the whole runtime seam: no environment variables to hand-wire, no
process management in the app, and the emulator's lifetime is the layer's.

## The resource: declaring emulators in a stack

`EmulateService` is the `alchemy dev` half — the resource alchemy itself would
write for a dev-only dependency, the same way `Command.Dev` wraps a dev server.
Declare the emulated API in the stack, bind its URL into a Worker's `env`, and
the emulator's lifecycle is alchemy's:

```typescript
import { EmulateService } from "alchemy-emulate/EmulateService";
import { providers } from "alchemy-emulate/Providers";

export default Alchemy.Stack(
  "MyStack",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), providers()),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const github = yield* EmulateService("github", {
      service: "github",
      // the endpoint a deploy reports, since no emulator runs then
      url: "https://api.github.com",
      dev: { seed: { tokens: { ghp_test: { login: "octocat" } } } },
    });

    const worker = yield* Cloudflare.Worker("api", {
      main: "./src/worker.ts",
      env: { GITHUB_API_URL: github.url, GITHUB_TOKEN: "ghp_test" },
    });

    return { url: worker.url.as<string>() };
  }),
);
```

Under `alchemy dev` the emulator runs in the dev sidecar (`ProviderLayer.dual`

- `LocalProvider.make`, the machinery behind every alchemy local provider): one
  instance per resource for the session's lifetime, restarted when the seed or
  port changes, closed on destroy — and its URL binds into whatever consumes it,
  no redeploys needed. `dev: { mode: "external" }` is the resource's `Connect`:
  adopt the URL of an emulator you run yourself.

Under `alchemy deploy` the emulator is inert and the resource reports the real
endpoint from `url`. A deploy without `url` fails with
`EmulateDeployUrlError` instead of silently dropping the binding out of the
worker that needs it. `Alchemy.remote()` opts a resource out of emulation; a
destroy deletes a dev-created row with the dev provider, whatever the run's
current mode.

The runtime seam and the resource stay symmetric: `dev: { mode: "emulator" }`
is `InProcess()`, `dev: { mode: "external" }` is `Connect()`, and the same
typed errors name the same failures on both halves.

A runnable version of the snippet above lives in
[`examples/cloudflare-emulate`](./examples/cloudflare-emulate) — a Worker that
calls the GitHub API, with a test that runs the real `alchemy dev` topology
(emulator in the sidecar, worker in local workerd) and asserts the seeded flow
end to end.

## API

The runtime half ships from the barrel (`alchemy-emulate`); the alchemy half
ships from subpath modules (`alchemy-emulate/EmulateService`,
`alchemy-emulate/Providers`), so a runtime-only consumer never has to install
`alchemy` — the same split alchemy's own packages apply to driver layers with
optional peers.

| Export                                        | What it is                                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `Emulate({ services })`                       | Effect that starts (or attaches to) every configured service and returns a typed handle per service |
| `InProcess()`                                 | Platform layer that starts emulators in this process (Node)                                         |
| `Connect({ service: url })`                   | Platform layer for servers that are already running; requires an `HttpClient`                       |
| `EmulatorHandle`                              | Per service: `url`, `secrets`, `reset`, `request(path, options?)`                                   |
| `EmulateService(id, { service, url?, dev? })` | The alchemy resource: the emulated API under `alchemy dev`, the real endpoint on deploy             |
| `providers()`                                 | The stack providers layer registering the `Emulate.Service` provider                                |
| `EmulateStartError`                           | The emulator failed to start (port in use, non-Node runtime, bad seed)                              |
| `EmulateUnknownServiceError`                  | No emulator configured for that service                                                             |
| `EmulateRequestError`                         | The request to the emulator failed, or the client cannot return a web `Response`                    |
| `EmulateResetError`                           | Reset failed, or the platform does not own the emulator                                             |
| `EmulateExternalConfigError`                  | `Connect` was given options only the server can apply                                               |
| `EmulateDeployUrlError`                       | A deploy was asked for the endpoint but the resource has no `url`                                   |

### Requests

`request` returns the web `Response` — the emulator is an HTTP server, so the
response you assert on in a test is the response a client would see:

```typescript
const response =
  yield *
  emulate.github.request("/rate_limit", {
    headers: { authorization: "Bearer ghp_test" },
  });
expect(response.status).toBe(200);
```

Requests go through an `HttpClient`, so `InProcess()` provides a `fetch`-based
one and `Connect()` takes the caller's (`FetchHttpClient.layer`, alchemy's
Worker runtime, a test client with retries). The public surface only uses stable
types, which is why it hands back `Response` rather than an `effect/http` type.

### Secrets

`emulate` can mint its own credentials (`generatedSecrets`); they are exposed as
`emulate.<service>.secrets` rather than hidden in the environment. Services that
authenticate only from `seed.tokens` report an empty list.

## Development

```bash
pnpm install         # installs, then patches oxlint + tsrs with @effect/tsgo
pnpm check           # lint + format + typecheck + Effect diagnostics
pnpm fix             # apply safe lint and format fixes
pnpm test            # vitest, including live in-process emulators
pnpm build           # compile lib/ and verify the publish map
pnpm pack            # inspect the published tarball
```

The resource's lifecycle (restart on seed change, guarded delete, dual
provider-mode routing) is tested by driving the generated provider service
directly, the same way alchemy tests `LocalProvider.make`. The example's own
test goes one level further — the real `alchemy dev` topology with the sidecar —
and runs from the example directory:

```bash
cd examples/cloudflare-emulate && bun test
```

`.agent_sources/README.md` explains how to vendor the Effect and alchemy source
mirrors this package is written against. `AGENTS.md` is the repository law.

## License

Apache-2.0. See `NOTICE` for the vendored anti-slop (MIT) and the upstream
projects this package builds on.
