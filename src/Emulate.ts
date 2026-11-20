import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Record from "effect/Record";
import type { GeneratedSecret, ServiceName } from "emulate";
import { Emulator } from "./Emulator.ts";
import type { EmulateError } from "./Errors.ts";
import { type RequestOptions } from "./Request.ts";
import { type ServiceConfigs, type ServiceOptions } from "./ServiceOptions.ts";

/** One emulated service, wired to its running emulator. */
export interface EmulatorHandle {
  readonly name: ServiceName;
  /** Base URL of the running emulator, e.g. for a third-party client's base URL. */
  readonly url: string;
  /** Credentials the emulator minted for itself; empty when it only reads `seed.tokens`. */
  readonly secrets: ReadonlyArray<GeneratedSecret>;
  /**
   * Reset this service's state back to its seed. Fails with
   * `EmulateResetError` when the platform does not own the emulator
   * (`Connect`).
   */
  readonly reset: Effect.Effect<void, EmulateError>;
  /** Send a request to this service's emulator and hand back the web `Response`. */
  request(path: string, options?: RequestOptions): Effect.Effect<Response, EmulateError>;
}

/** Emulated services, keyed by the names configured in `Emulate({ services })`. */
export type Emulation<Configs extends ServiceConfigs> = {
  readonly [name in Extract<keyof Configs, ServiceName>]: EmulatorHandle;
};

/** The service map `Emulate` accepts. */
export interface EmulateOptions<Configs extends ServiceConfigs> {
  readonly services: Configs;
}

const configuredEntries = <Configs extends ServiceConfigs>(
  services: Configs,
): ReadonlyArray<readonly [ServiceName, ServiceOptions]> => {
  const entries = Arr.filter(
    // oxlint-disable-next-line effecttsgo/prefer-effect-record -- the map has optional keys, which effect/Record's ReadonlyRecord cannot model under exactOptionalPropertyTypes.
    Object.entries(services),
    (entry): entry is [string, ServiceOptions] => entry[1] !== undefined,
  );

  // SAFETY: `services` is the constrained service map, so every key it yields is a ServiceName.
  return entries as ReadonlyArray<readonly [ServiceName, ServiceOptions]>;
};

/**
 * Start (or attach to) every emulated service this program needs.
 *
 * Requires the platform layer: `InProcess()` starts the emulators in this
 * process, `Connect({ ... })` attaches to servers that are already running.
 * Emulators live for the layer's lifetime, so state survives across requests
 * and two callers of `Emulate` share the same instance.
 *
 * ```typescript
 * Effect.gen(function* () {
 *   const emulate = yield* Emulate({
 *     services: { github: { seed: { tokens: { "ghp_test": { login: "octocat" } } } } },
 *   });
 *   const zen = yield* emulate.github.request("/zen");
 *   return { url: emulate.github.url, status: zen.status };
 * }).pipe(Effect.provide(InProcess()))
 * ```
 *
 * @layer
 * @requires @potion.run/emulate/Emulator
 */
export const Emulate = <const Configs extends ServiceConfigs>(
  options: EmulateOptions<Configs>,
): Effect.Effect<Emulation<Configs>, EmulateError, Emulator> =>
  Effect.gen(function* () {
    const platform = yield* Emulator;
    const entries = configuredEntries(options.services);

    const handles = yield* Effect.forEach(
      entries,
      ([name, serviceOptions]) =>
        platform.acquire(name, serviceOptions).pipe(
          Effect.map(
            (runner) =>
              [
                name,
                {
                  name: runner.name,
                  url: runner.url,
                  secrets: runner.generatedSecrets,
                  reset: runner.reset,
                  request: (path: string, options?: RequestOptions) =>
                    runner.request(path, options),
                },
              ] as const,
          ),
        ),
      { concurrency: 1 },
    );

    // SAFETY: `handles` has exactly one entry per configured service, so every
    // key of Configs is present in the resulting record.
    return Record.fromEntries(handles) as Emulation<Configs>;
  });
