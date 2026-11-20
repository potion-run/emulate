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
`effect` yourself so one copy serves the whole app.

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

That is the whole integration seam: no environment variables to hand-wire, no
process management in the app, and the emulator's lifetime is the layer's.

> **Not in this release:** an `alchemy dev` resource (`ProviderLayer.dual` +
> `LocalProvider.make`) that declares the emulators in a Stack and binds their
> URLs into a Worker's environment. The platform layers above are the runtime
> half it would build on; the resource belongs in its own release with
> `alchemy dev` lifecycle tests.

## API

| Export                       | What it is                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `Emulate({ services })`      | Effect that starts (or attaches to) every configured service and returns a typed handle per service |
| `InProcess()`                | Platform layer that starts emulators in this process (Node)                                         |
| `Connect({ service: url })`  | Platform layer for servers that are already running; requires an `HttpClient`                       |
| `EmulatorHandle`             | Per service: `url`, `secrets`, `reset`, `request(path, options?)`                                   |
| `EmulateStartError`          | The emulator failed to start (port in use, non-Node runtime, bad seed)                              |
| `EmulateUnknownServiceError` | No emulator configured for that service                                                             |
| `EmulateRequestError`        | The request to the emulator failed, or the client cannot return a web `Response`                    |
| `EmulateResetError`          | Reset failed, or the platform does not own the emulator                                             |
| `EmulateExternalConfigError` | `Connect` was given options only the server can apply                                               |

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

`.agent_sources/README.md` explains how to vendor the Effect and alchemy source
mirrors this package is written against. `AGENTS.md` is the repository law.

## License

Apache-2.0. See `NOTICE` for the vendored anti-slop (MIT) and the upstream
projects this package builds on.
