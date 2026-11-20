import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as HashMap from "effect/HashMap";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import {
  createEmulator,
  type EmulatorOptions,
  type Emulator as StartedEmulator,
  type ServiceName,
} from "emulate";
import { Emulator, type RunningEmulator } from "./Emulator.ts";
import { EmulateResetError, EmulateStartError } from "./Errors.ts";
import { executeRequest, type RequestOptions } from "./Request.ts";
import { type ServiceOptions } from "./ServiceOptions.ts";

const DEFAULT_PORT = 0;

const toEmulatorOptions = (name: ServiceName, options: ServiceOptions): EmulatorOptions => {
  const base = { service: name, port: options.port ?? DEFAULT_PORT, seed: options.seed ?? {} };

  const withHostname =
    options.hostname === undefined ? base : { ...base, hostname: options.hostname };

  return options.baseUrl === undefined
    ? withHostname
    : { ...withHostname, baseUrl: options.baseUrl };
};

const toRunningEmulator =
  (client: HttpClient.HttpClient) =>
  (name: ServiceName, emulator: StartedEmulator): RunningEmulator => ({
    name,
    url: emulator.url,
    generatedSecrets: emulator.generatedSecrets,
    reset: Effect.try({
      try: () => emulator.reset(),
      catch: (cause) =>
        EmulateResetError.make({
          service: name,
          message: `The ${name} emulator could not reset to its seed. Fix: check the seed passed to \`Emulate({ services: { ${name} } })\`; a custom emulator's setup runs again on reset.`,
          cause,
        }),
    }),
    request: (path: string, options?: RequestOptions) =>
      executeRequest({ client, service: name, url: emulator.url, path, options: options ?? {} }),
  });

const startEmulator = (client: HttpClient.HttpClient) =>
  Effect.fnUntraced(function* (name: ServiceName, options: ServiceOptions) {
    const emulator = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () => createEmulator(toEmulatorOptions(name, options)),
        catch: (cause) =>
          EmulateStartError.make({
            service: name,
            message: `The ${name} emulator failed to start. Fix: free the configured port (or drop \`port\` to get an ephemeral one), and run in-process emulators under Node — Workers and browsers cannot host them.`,
            cause,
          }),
      }),
      // oxlint-disable-next-line enfect/effect-promise-vs-trypromise -- a failed close is a defect: no caller can act on it, and the finalizer must stay infallible.
      (started) => Effect.promise(() => started.close()),
    );

    return toRunningEmulator(client)(name, emulator);
  });

/**
 * Start emulators **inside this process**, so `alchemy dev` and tests need no
 * separate `emulate` server.
 *
 * One instance per service name lives for the lifetime of the layer and is
 * closed when the layer's scope closes; two consumers that ask for the same
 * service share its state. Requires Node (emulators listen on a loopback
 * socket and are reached with the platform `fetch`) — in a Worker, use
 * `Connect` against a server you run yourself.
 *
 * ```typescript
 * Effect.gen(function* () {
 *   const emulate = yield* Emulate({ services: { github: { seed } } });
 *   const response = yield* emulate.github.request("/zen");
 * }).pipe(Effect.provide(InProcess()))
 * ```
 */
const make = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const start = startEmulator(client);
  const lifetime = yield* Scope.make();
  yield* Effect.addFinalizer(() => Scope.close(lifetime, Exit.void));
  const gate = yield* Semaphore.make(1);
  const instances = yield* Ref.make(HashMap.empty<ServiceName, RunningEmulator>());

  const acquire = Effect.fnUntraced(function* (name: ServiceName, options: ServiceOptions) {
    const registered = yield* Ref.get(instances);
    const existing = HashMap.get(registered, name);

    if (Option.isSome(existing)) {
      return existing.value;
    }

    const started = yield* start(name, options).pipe(Scope.provide(lifetime));
    yield* Ref.update(instances, HashMap.set(name, started));

    return started;
  });

  return Emulator.of({
    kind: "in-process",
    acquire: (name, options) => gate.withPermits(1)(acquire(name, options)),
  });
});

/**
 * Start emulators **inside this process**, so `alchemy dev` and tests need no
 * separate `emulate` server.
 *
 * One instance per service name lives for the lifetime of the layer and is
 * closed when the layer's scope closes; two consumers that ask for the same
 * service share its state. Requires Node (emulators listen on a loopback
 * socket and are reached with the platform `fetch`) — in a Worker, use
 * `Connect` against a server you run yourself.
 *
 * ```typescript
 * Effect.gen(function* () {
 *   const emulate = yield* Emulate({ services: { github: { seed } } });
 *   const response = yield* emulate.github.request("/zen");
 * }).pipe(Effect.provide(InProcess()))
 * ```
 */
export const InProcess = (): Layer.Layer<Emulator> =>
  // oxlint-disable-next-line anti-slop-effect/require-service-make-layer -- The service is a platform seam with one implementation per module; `InProcess` and `Connect` are its two peers, so the service class owns no single `make`.
  Layer.effect(Emulator, make).pipe(Layer.provide(FetchHttpClient.layer));
