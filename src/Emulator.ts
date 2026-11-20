import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type { GeneratedSecret, ServiceName } from "emulate";
import type { EmulateError } from "./Errors.ts";
import type { RequestOptions } from "./Request.ts";
import type { ServiceOptions } from "./ServiceOptions.ts";

/** An emulator that is running and answering requests. */
export interface RunningEmulator {
  readonly name: ServiceName;
  /** Listening URL, e.g. `http://localhost:52152`. */
  readonly url: string;
  /**
   * Credentials the emulator minted for itself, e.g. a seeded API token.
   * Empty for emulators that authenticate only from `seed.tokens`.
   */
  readonly generatedSecrets: ReadonlyArray<GeneratedSecret>;
  /** Reset the emulator's state back to its seed. */
  readonly reset: Effect.Effect<void, EmulateError>;
  /** Send a request to this emulator and hand back the web `Response`. */
  request(path: string, options?: RequestOptions): Effect.Effect<Response, EmulateError>;
}

/**
 * How emulators are provided: started in this process, or attached to
 * servers that are already running.
 *
 * The platform layers (`InProcess`, `Connect`) provide this service;
 * `yield* Emulate({ services })` consumes it. Provide the layer on the
 * surrounding impl effect:
 *
 * ```typescript
 * Effect.gen(function* () {
 *   const emulate = yield* Emulate({ services: { github: { seed } } });
 *   return { url: emulate.github.url };
 * }).pipe(Effect.provide(InProcess()))
 * ```
 */
export interface EmulatorService {
  readonly kind: "in-process" | "external";
  /**
   * Start (or reuse) the emulator for `name`. Implementations MUST cache one
   * instance per service name for the layer's lifetime: two `Emulate` calls
   * for the same service share one running emulator and its state.
   */
  readonly acquire: (
    name: ServiceName,
    options: ServiceOptions,
  ) => Effect.Effect<RunningEmulator, EmulateError>;
}

/** The emulator platform `Emulate` requires. */
export class Emulator extends Context.Service<Emulator, EmulatorService>()(
  "@potion-run/emulate/Emulator",
) {}
