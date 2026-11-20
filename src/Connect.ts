import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";
import type { ServiceName } from "emulate";
import { Emulator, type RunningEmulator } from "./Emulator.ts";
import {
  EmulateExternalConfigError,
  EmulateResetError,
  EmulateUnknownServiceError,
} from "./Errors.ts";
import { executeRequest, type RequestOptions } from "./Request.ts";
import { type ServiceOptions } from "./ServiceOptions.ts";

/** Base URL per emulated service, as printed by the `emulate` CLI. */
export type EmulatorUrls = { readonly [name in ServiceName]?: string };

const toRunningEmulator =
  (client: HttpClient.HttpClient) =>
  (name: ServiceName, url: string): RunningEmulator => ({
    name,
    url,
    generatedSecrets: [],
    reset: Effect.fail(
      EmulateResetError.make({
        service: name,
        message: `The ${name} emulator at ${url} is not owned by this process, so it cannot be reset. Fix: restart the \`emulate\` server, or use \`InProcess()\` when the emulator should be owned here.`,
      }),
    ),
    request: (path: string, options?: RequestOptions) =>
      executeRequest({ client, service: name, url, path, options: options ?? {} }),
  });

const rejectOwnedOptions = (
  name: ServiceName,
  options: ServiceOptions,
): Effect.Effect<void, EmulateExternalConfigError> => {
  const configured = Arr.map(
    // oxlint-disable-next-line effecttsgo/prefer-effect-record -- ServiceOptions has optional keys, which effect/Record's ReadonlyRecord cannot model under exactOptionalPropertyTypes.
    Arr.filter(Object.entries(options), ([, value]) => value !== undefined),
    ([key]) => key,
  );

  return configured.length === 0
    ? Effect.void
    : Effect.fail(
        EmulateExternalConfigError.make({
          service: name,
          message: `Connect cannot apply ${Arr.join(configured, ", ")} for the ${name} emulator: that server is already running. Fix: configure the seed and port on the \`emulate\` server, or use \`InProcess()\` when this process should own the emulator.`,
        }),
      );
};

/**
 * Attach to emulator servers that are **already running** — the `emulate` CLI
 * (`pnpm exec emulate`) or a container in CI — instead of starting them in
 * this process.
 *
 * This is the platform for Workers and other runtimes that can reach a URL
 * but cannot host a server: the base URLs you pass are the ones the CLI
 * printed, no process is owned or closed by the layer, and the caller provides
 * the `HttpClient` (a platform `FetchHttpClient` layer, or alchemy's Worker
 * runtime). Emulators this layer did not start cannot be reset; restart the
 * server instead.
 *
 * ```typescript
 * Effect.gen(function* () {
 *   const emulate = yield* Emulate({ services: { github: {} } });
 *   yield* emulate.github.request("/zen");
 * }).pipe(
 *   Effect.provide(Connect({ github: "http://127.0.0.1:4000" })),
 *   Effect.provide(FetchHttpClient.layer),
 * )
 * ```
 */
export const Connect = (urls: EmulatorUrls): Layer.Layer<Emulator, never, HttpClient.HttpClient> =>
  // oxlint-disable-next-line anti-slop-effect/require-service-make-layer -- The service is a platform seam with one implementation per module; `InProcess` and `Connect` are its two peers, so the service class owns no single `make`.
  Layer.effect(
    Emulator,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const running = toRunningEmulator(client);

      return Emulator.of({
        kind: "external",
        acquire: (name: ServiceName, options: ServiceOptions) => {
          const url = urls[name];

          if (url === undefined) {
            return Effect.fail(
              EmulateUnknownServiceError.make({
                service: name,
                message: `No URL is configured for the ${name} emulator. Fix: add \`${name}\` to \`Connect({ ... })\` with the URL the \`emulate\` CLI printed, or use \`InProcess()\` to start it here.`,
              }),
            );
          }

          return rejectOwnedOptions(name, options).pipe(Effect.as(running(name, url)));
        },
      });
    }),
  );
