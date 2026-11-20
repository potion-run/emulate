# @potion-run/emulate

Local API emulators for [Alchemy](https://alchemy.run) and
[Effect](https://effect.website). Run GitHub, Vercel, Google, Slack, Stripe, and
other third-party APIs in tests and under `alchemy dev`, wired as Effect
platform layers with typed errors and layer-owned lifecycle.

```sh
npm install alchemy @potion-run/emulate emulate effect
```

`effect` 4.1.4 is a peer dependency. `alchemy` is optional: drop it when you
only use the runtime half. The runtime follows Alchemy's `BetterAuth(options)`
shape: the factory takes options, and one platform layer supplies the
transport.

A test that seeds a GitHub token and calls the emulated API:

```typescript
import { Emulate, InProcess } from "@potion-run/emulate";
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

By default, `InProcess()` starts each emulator in this process on an ephemeral
port. It closes the emulator when the layer's scope closes. The port is `0` by
default, so several services and test files never collide on `emulate`'s
default port, `4000`. Two `Emulate` calls against one platform layer share the instance, its
URL, and its state.

`Emulate` reads the ambient platform, so provide the layer on the effect that
needs the emulator: a test, a script, or a resource impl.

## What you get

- **`Emulate({ services })`** starts or attaches to each configured service and
  returns a handle per service: `url`, `secrets`, `reset`, and `request`.
- **`InProcess()`** starts the emulators inside the Node process. Use it in
  tests and local programs.
- **`Connect({ service: url })`** attaches to emulators that are already
  running. Use it in Workers, Lambda, and CI.
- **`EmulateService(id, props)`** declares an emulated API in an Alchemy stack.
  It runs under `alchemy dev` and reports the real endpoint on deploy.
- **Typed errors** are `Schema.TaggedError` values, and each message names the
  fix.

## Use it under `alchemy dev`

`EmulateService` declares a dev-only dependency in the stack, in the same
shape as `Command.Dev`. Declare the emulated API, then bind its URL into the
Worker's `env`:

```typescript
import * as Cloudflare from "@alchemy.run/cloudflare";
import { EmulateService } from "@potion-run/emulate/EmulateService";
import { providers } from "@potion-run/emulate/Providers";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

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

Under `alchemy dev`, the emulator runs in the dev sidecar. The provider uses
`ProviderLayer.dual` and `LocalProvider.make`, the machinery behind every local
Alchemy provider. One instance serves each resource for the session. The
provider restarts it when its `dev` config changes and closes it on destroy.
The emulator's URL binds into whatever consumes the resource, so a restart
needs no redeploy.

Under `alchemy deploy`, the emulator is inert and the resource reports the real
endpoint from `url`. A deploy without `url` fails with `EmulateDeployUrlError`
instead of dropping the binding from the Worker. `Alchemy.remote()` opts a
resource out of emulation.

To attach to an emulator you run yourself, pass
`dev: { mode: "external", url: "http://127.0.0.1:4000" }`. The resource adopts
that URL and applies no options.

The runtime half and the resource half stay symmetric. `InProcess()` is
`dev: { mode: "emulator" }`, and `Connect()` is `dev: { mode: "external" }`.
Both halves fail with the same typed errors.

See [`examples/cloudflare-emulate`](./examples/cloudflare-emulate) for a
runnable version. Its test runs the real `alchemy dev` topology, with the
emulator in the sidecar and the Worker in local workerd, and asserts the seeded
flow end to end.

## Attach to a running emulator

`Connect` is the platform for any runtime that can reach a URL but cannot host
a server: a Cloudflare Worker, a Lambda, or a CI job that runs `npx emulate`.

```typescript
import { Connect, Emulate } from "@potion-run/emulate";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";

const platform = Connect({ github: "http://127.0.0.1:4000" }).pipe(
  Layer.provide(FetchHttpClient.layer),
);
```

`Connect` owns no process. `reset` fails with `EmulateResetError` because only
a restart of the server can reset its state. Options that only the server can
apply (`seed`, `port`, `baseUrl`, `hostname`) fail with
`EmulateExternalConfigError` instead of being dropped.

## Make requests

The handle's `url` is the base URL for a third-party client, such as Octokit or
the Stripe SDK. `request` sends a call directly and returns the web `Response`,
so a test asserts on what a client sees:

```typescript
const response =
  yield *
  emulate.github.request("/rate_limit", {
    headers: { authorization: "Bearer ghp_test" },
  });
expect(response.status).toBe(200);
```

Requests go through an `HttpClient`. `InProcess()` provides a `fetch`-backed
client. `Connect()` uses the one you provide, such as `FetchHttpClient.layer`,
Alchemy's Worker runtime, or a test client with retries. The public surface
uses stable web types only, which is why `request` returns `Response` rather
than an `effect/http` type.

## Read minted secrets

Some services mint their own credentials. Read them from
`emulate.<service>.secrets` instead of scraping the environment. Services that
authenticate only from `seed.tokens` report an empty list.

## API

`Emulate`, `InProcess`, `Connect`, the handle, and the errors ship from the
package root. The Alchemy half ships from subpaths:
`@potion-run/emulate/EmulateService` and `@potion-run/emulate/Providers`. A
runtime-only consumer never installs `alchemy`. Alchemy's own packages use the
same split for driver layers with optional peers.

| Export                      | What it is                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `Emulate({ services })`     | Effect that starts or attaches to each configured service and returns one handle per service |
| `InProcess()`               | Layer that starts emulators in this process. Requires Node                                   |
| `Connect(urls)`             | Layer that attaches to running emulators. Requires an `HttpClient`                           |
| `EmulatorHandle`            | Per service: `url`, `secrets`, `reset`, `request(path, options?)`                            |
| `EmulateService(id, props)` | Alchemy resource: the emulator under `alchemy dev`, the real endpoint on deploy              |
| `providers()`               | Stack layer that registers the `Emulate.Service` provider                                    |

### Service options

`Emulate({ services })` and `dev` accept these options per service:

| Option     | Default              | What it does                                                                                 |
| ---------- | -------------------- | -------------------------------------------------------------------------------------------- |
| `seed`     | `{}`                 | Initial state: `tokens` plus the service's own state. `emulate` re-applies it on reset       |
| `port`     | `0`                  | Listening port. `0` gets an ephemeral port from the OS                                       |
| `hostname` | `emulate`'s loopback | Address the emulator binds. Keep it unset unless you need another interface                  |
| `baseUrl`  | the listening URL    | Public URL the emulator advertises in responses, such as webhook targets and OAuth redirects |

`url` always reports `localhost`, even when you set `hostname`. Assert on the
port, not the host string.

### Errors

| Error                        | When it fires                                                        |
| ---------------------------- | -------------------------------------------------------------------- |
| `EmulateStartError`          | The emulator failed to start: port in use, no Node runtime, bad seed |
| `EmulateUnknownServiceError` | No emulator is configured for that service                           |
| `EmulateRequestError`        | The request failed, or the client cannot return a web `Response`     |
| `EmulateResetError`          | Reset failed, or the platform does not own the emulator              |
| `EmulateExternalConfigError` | `Connect` was given options only the server can apply                |
| `EmulateDeployUrlError`      | A deploy needs the endpoint, but the resource has no `url`           |

## Handle errors

Each failure is a tagged Effect error, so you can branch on the tag and read the
message:

```typescript
const request = emulate.github.request("/zen");

const zen =
  yield *
  request.pipe(
    Effect.catchTag("EmulateRequestError", (error) =>
      Effect.logWarning(error.message).pipe(Effect.as(null)),
    ),
  );
```

`EmulateRequestError` carries the `service`, the `url` that failed, and the
`cause`. `Connect` alone produces `EmulateExternalConfigError` and
`EmulateUnknownServiceError`. `InProcess` alone produces `EmulateStartError`.
The live provider produces `EmulateDeployUrlError` on a deploy without `url`.

## Requirements

- Node.js 24.18 or newer for `InProcess()`.
- TypeScript with `strict` enabled.
- `effect` 4.1.4.
- `alchemy` 2.0.0-beta.87 or newer for `EmulateService`.

`Connect()` has no Node requirement. It only needs an `HttpClient` your runtime
can provide.

## Development

```sh
pnpm install                   # install, then patch oxlint and tsrs
pnpm check                     # lint, format, typecheck, and Effect diagnostics
pnpm fix                       # apply safe lint and format fixes
pnpm test                      # vitest, with live in-process emulators
pnpm build                     # compile lib/ and verify the publish map
pnpm pack                      # inspect the published tarball
pnpm release:notes v<version>  # prepend a tag's notes to CHANGELOG.md
```

Tests drive the public API against real emulators. The resource's lifecycle
tests call the generated provider service directly, the way Alchemy tests
`LocalProvider.make`. The example goes further and runs the real `alchemy dev`
topology:

```sh
cd examples/cloudflare-emulate && bun test
```

`.agent_sources/README.md` explains the vendored Effect and Alchemy source
mirrors. `AGENTS.md` is the repository law.

## Learn more

- [emulate](https://emulate.dev): the emulators this package wraps.
- [Alchemy](https://alchemy.run): the stack framework and `alchemy dev`.
- [Effect](https://effect.website): the runtime the layers build on.
- [Cloudflare Worker example](./examples/cloudflare-emulate): an emulator under
  `alchemy dev`.

## License

Apache-2.0. See `NOTICE` for the vendored anti-slop (MIT) and the upstream
projects this package builds on.
