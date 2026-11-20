import * as LocalProvider from "alchemy/Local/LocalProvider";
import * as ProviderLayer from "alchemy/Local/ProviderLayer";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import { moduleExtension } from "alchemy/Util/Node";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
  createEmulator,
  type EmulatorOptions,
  type GeneratedSecret,
  type SeedConfig,
} from "emulate";
import { EmulateDeployUrlError, EmulateStartError } from "./Errors.ts";
import type { ServiceName } from "./ServiceOptions.ts";

const DEFAULT_PORT = 0;

const EMPTY_SEED: SeedConfig = {};

/**
 * How the emulated service is provided during `alchemy dev`.
 *
 * Mirrors the two runtime platforms: `mode: "emulator"` (the default) is
 * `InProcess()` — the dev sidecar starts the emulator and owns its lifetime,
 * restarting it when the seed or port changes; `mode: "external"` is
 * `Connect()` — an emulator you run yourself (the `emulate` CLI, a CI
 * container) is already listening, and this resource only adopts its URL.
 */
export type EmulateServiceDevProps =
  | EmulateServiceDevEmulatorProps
  | EmulateServiceDevExternalProps;

export interface EmulateServiceDevEmulatorProps {
  /**
   * Run the emulator in the dev sidecar, scoped to the stack's lifetime.
   * @default "emulator"
   */
  mode?: "emulator";
  /**
   * Initial state for the emulator: `tokens` plus whatever the service's
   * state type declares. Re-applied on restart, so changing the seed
   * restarts the emulator with fresh state.
   */
  seed?: SeedConfig;
  /**
   * Port the emulator listens on.
   *
   * @default 0 — an ephemeral port chosen by the OS, so several stacks (and
   * several test files) can run at once without colliding on `emulate`'s
   * default port.
   */
  port?: number;
  /**
   * Address the emulator binds. Leave it unset to keep `emulate`'s own
   * default (IPv4 loopback): emulated services hold seeded credentials
   * and unauthenticated endpoints, so they stay off public interfaces
   * unless you ask. Note that `url` always reports `localhost`.
   */
  hostname?: string;
}

export interface EmulateServiceDevExternalProps {
  /**
   * Don't start an emulator; adopt the URL of one that is already
   * listening (started with the `emulate` CLI or in a CI container).
   */
  mode: "external";
  /**
   * The URL the running emulator prints, e.g. `http://127.0.0.1:4000`.
   * The emulator's seed lives where it was started — this resource never
   * applies options to a server it does not own.
   */
  url: string;
}

export interface EmulateServiceProps {
  /**
   * The emulated service, e.g. `"github"` or `"stripe"`. One of the services
   * `emulate` ships a drop-in emulator for.
   */
  readonly service: ServiceName;
  /**
   * The real API endpoint this resource stands in for, reported by
   * `alchemy deploy` — emulators only run under `alchemy dev`, so a deployed
   * stack needs the endpoint its code should call instead, e.g.
   * `"https://api.github.com"`.
   *
   * A deploy fails with `EmulateDeployUrlError` when this is missing: the
   * alternative — silently reporting no URL — would drop the binding out of
   * the worker that depends on it.
   */
  readonly url?: string;
  /**
   * How the emulated service is provided during `alchemy dev`. See
   * {@link EmulateServiceDevProps}.
   */
  readonly dev?: EmulateServiceDevProps;
}

export interface EmulateServiceAttributes {
  /**
   * The endpoint this service is reachable at: under `alchemy dev` the
   * emulator's URL (an ephemeral port, so a restart changes it — bind it,
   * don't hardcode it); on `alchemy deploy` the `url` prop.
   */
  readonly url: string;
  /**
   * Credentials the emulator minted for itself, e.g. a seeded app's client
   * secret. Empty on deploy and for services that only read `seed.tokens`.
   */
  readonly generatedSecrets: ReadonlyArray<GeneratedSecret>;
}

export interface EmulateService extends Resource<
  "Emulate.Service",
  EmulateServiceProps,
  EmulateServiceAttributes
> {}

/**
 * An emulated third-party API, declared in a stack.
 *
 * Under `alchemy dev` the emulator runs in the dev sidecar — scoped to the
 * stack, restarted when its seed or port changes, closed on destroy — and
 * its URL binds into whatever resource uses it (a Worker's `env`, a website's
 * `env`). Under `alchemy deploy` the emulator is inert and the resource
 * reports the real endpoint you configured with `url`.
 *
 * **Example:** a Worker that calls the GitHub API
 * ```typescript
 * const github = yield* EmulateService("github", {
 *   service: "github",
 *   url: "https://api.github.com",
 *   dev: {
 *     seed: { tokens: { ghp_test: { login: "octocat" } } },
 *   },
 * });
 *
 * yield* Cloudflare.Worker("api", {
 *   main: "./src/worker.ts",
 *   env: {
 *     GITHUB_API_URL: github.url, // dev: the emulator, deploy: api.github.com
 *     GITHUB_TOKEN: "ghp_test",
 *   },
 * });
 * ```
 *
 * **Example:** attach to a running `emulate` server instead
 * ```typescript
 * const github = yield* EmulateService("github", {
 *   service: "github",
 *   url: "https://api.github.com",
 *   dev: { mode: "external", url: "http://127.0.0.1:4000" },
 * });
 * ```
 *
 * @resource
 */
// oxlint-disable-next-line effecttsgo/missing-pipeable-signature -- alchemy's Resource constructor is data-first by contract: `(id, props)` returns the resource, and pipeability lives on the returned resource (`.pipe(Alchemy.remote())`), not on this factory. The effecttsgo preset cannot see through the ResourceClass intersection.
export const EmulateService = Resource<EmulateService>("Emulate.Service");

/**
 * The live (`alchemy deploy`) provider: no emulator exists at deploy time, so
 * the resource only reports the endpoint it stands in for.
 */
export const EmulateServiceProviderLive = () =>
  Provider.succeed(EmulateService, {
    reconcile: Effect.fn(function* ({ id, news }) {
      if (news.url === undefined) {
        return yield* EmulateDeployUrlError.make({
          id,
          service: news.service,
          message: `The ${id} emulator resource (${news.service}) has no \`url\` for \`alchemy deploy\`. Emulators run only under \`alchemy dev\`, so a deploy needs the real endpoint this resource stands in for. Fix: pass \`url: "https://api.github.com"\` to \`EmulateService("${id}", { ... })\`, or keep this resource out of the deployed stack.`,
        });
      }

      return { url: news.url, generatedSecrets: [] };
    }),
    delete: () => Effect.void,
  });

/**
 * The restart-relevant config of a running emulator: everything but `url`,
 * the deploy-time endpoint. Editing `url` must not restart a healthy
 * emulator or drop its state.
 */
interface EmulateServiceRestartConfig {
  readonly service: ServiceName;
  readonly dev: Option.Option<EmulateServiceDevProps>;
}

const toEmulatorOptions = (
  props: EmulateServiceProps,
  dev: Option.Option<EmulateServiceDevEmulatorProps>,
): EmulatorOptions => {
  const base: EmulatorOptions = {
    service: props.service,
    port: Option.flatMapNullishOr(dev, (options) => options.port).pipe(
      Option.getOrElse(() => DEFAULT_PORT),
    ),
    seed: Option.flatMapNullishOr(dev, (options) => options.seed).pipe(
      Option.getOrElse(() => EMPTY_SEED),
    ),
  };

  // `EmulatorOptions`'s `hostname` is optional under exactOptionalPropertyTypes,
  // so it is added only when set — the same shape `InProcess` builds.
  const hostname = Option.flatMapNullishOr(dev, (options) => options.hostname).pipe(
    Option.getOrUndefined,
  );

  return hostname === undefined ? base : { ...base, hostname };
};

/**
 * The `alchemy dev` provider: one emulator per resource, started in the dev
 * sidecar's scope so it survives user-code reloads, restarted when the
 * restart-relevant config (the seed, the port, the dev mode) changes, and
 * closed when the resource is deleted.
 */
export const EmulateServiceProviderLocal = () =>
  LocalProvider.make(
    EmulateService,
    import.meta.resolve(
      `./EmulateServiceLocal${moduleExtension(import.meta.url)}`,
      import.meta.url,
    ),
    Effect.succeed({
      resolveConfig: ({ news }: LocalProvider.LocalProviderInput<EmulateService>) =>
        Effect.succeed<EmulateServiceRestartConfig>({
          service: news.service,
          dev: Option.fromNullishOr(news.dev),
        }),
      start: Effect.fn(function* ({
        news: props,
      }: LocalProvider.StartContext<EmulateService, EmulateServiceRestartConfig>) {
        const dev = props.dev;

        // An emulator this process does not own: adopt its URL, apply no
        // options — the server's own configuration already ran where it
        // was started.
        if (dev?.mode === "external") {
          return { url: dev.url, generatedSecrets: [] };
        }

        // `createEmulator` resolves once the server is listening, so
        // acquisition is readiness; the instance scope the LocalProvider
        // helper forks holds the release, so a restart or delete closes
        // the emulator.
        const emulator = yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: () => createEmulator(toEmulatorOptions(props, Option.fromNullishOr(dev))),
            catch: (cause) =>
              EmulateStartError.make({
                service: props.service,
                message: `The ${props.service} emulator failed to start under \`alchemy dev\`. Fix: free the configured \`port\` (or drop it for an ephemeral one); a changed \`seed\` restarts the emulator, so check what changed in the seed.`,
                cause,
              }),
          }),
          // oxlint-disable-next-line enfect/effect-promise-vs-trypromise -- a failed close is a defect: no caller can act on it, and the finalizer must stay infallible.
          (started) => Effect.promise(() => started.close()),
        );

        return { url: emulator.url, generatedSecrets: [...emulator.generatedSecrets] };
      }),
    } satisfies LocalProvider.LocalProviderSpec<EmulateService, EmulateServiceRestartConfig>),
  );

/**
 * Registers the `Emulate.Service` provider with both its **live** and its
 * **local** implementation, so provider mode is a first-class concern: `alchemy
 * dev` resolves the emulator provider, `alchemy deploy` the live one, and
 * `Alchemy.remote()` opts a resource out of emulation.
 */
export const EmulateServiceProvider = () =>
  ProviderLayer.dual(EmulateService, {
    live: EmulateServiceProviderLive,
    local: EmulateServiceProviderLocal,
  });
