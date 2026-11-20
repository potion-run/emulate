import { describe, expect, it } from "@effect/vitest";
import { AlchemyContext } from "alchemy/AlchemyContext";
import { ArtifactStore, createArtifactStore } from "alchemy/Artifacts";
import type { Diff as AlchemyProviderDiff } from "alchemy/Diff";
import * as AlchemyProvider from "alchemy/Provider";
import { noopSession } from "alchemy/Report";
import { Stack } from "alchemy/Stack";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { createEmulator } from "emulate";
import {
  EmulateService,
  type EmulateServiceProps,
  EmulateServiceProvider,
  EmulateServiceProviderLive,
  EmulateServiceProviderLocal,
} from "../src/EmulateService.ts";
import { EmulateDeployUrlError } from "../src/Errors.ts";
import { Providers, providers } from "../src/Providers.ts";

/** The `Provider(EmulateService)` service tag, as the engine resolves it. */
const EmulateServiceProviderTag = AlchemyProvider.Provider<EmulateService>(EmulateService.Type);

const stackLayer = Layer.succeed(Stack, {
  name: "emulate-service-test",
  stage: "test",
  resources: {},
  bindings: {},
  actions: {},
});

const alchemyContext = (dev: boolean) =>
  Layer.succeed(AlchemyContext, { dotAlchemy: ".alchemy", dev, adopt: false });

const services = (dev: boolean) =>
  Layer.mergeAll(
    alchemyContext(dev),
    stackLayer,
    Layer.succeed(ArtifactStore, createArtifactStore()),
  );

/** The local provider with every service its layer build needs, so tests scope it whole. */
const localProvider = () => EmulateServiceProviderLocal().pipe(Layer.provide(services(true)));

/** The dual registration with every service its layer build needs. */
const dualProvider = (dev: boolean) => EmulateServiceProvider().pipe(Layer.provide(services(dev)));

/** The stack-facing providers layer with every service its build needs. */
const registeredProviders = () => providers().pipe(Layer.provide(services(true)));

const SEED = { tokens: { ghp_test: { login: "octocat" } } };

const OTHER_SEED = { tokens: { ghp_other: { login: "hubot" } } };

const github = (props: Partial<EmulateServiceProps> = {}): EmulateServiceProps => ({
  service: "github",
  ...props,
});

/** The full lifecycle input, spread into whichever call shape the provider takes. */
const input = (instanceId: string, news: EmulateServiceProps) => ({
  id: "github",
  fqn: "github",
  instanceId,
  news,
  olds: news,
  output: undefined,
  oldBindings: [],
  newBindings: [],
  bindings: [],
  session: noopSession,
});

const expectServesZen = (url: string) =>
  Effect.gen(function* () {
    // oxlint-disable-next-line effecttsgo/global-fetch-in-effect -- a test probe: assert what a plain client sees on the wire; routing it through HttpClient would test this package's own transport instead.
    const response = yield* Effect.promise(() => fetch(`${url}/zen`));
    const body = yield* Effect.promise(() => response.text());

    expect(response.status).toBe(200);
    expect(body.length).toBeGreaterThan(0);
  });

const expectUnreachable = (url: string) =>
  // oxlint-disable-next-line effecttsgo/global-fetch-in-effect -- a test probe: a closed port is the assertion, so the raw connection refusal is the signal, not something to model as a client error.
  Effect.promise(() => fetch(`${url}/zen`)).pipe(
    Effect.exit,
    Effect.map((exit) => expect(exit._tag).toBe("Failure")),
  );

/**
 * The generated local provider always defines `diff`; the `ProviderService`
 * type marks it optional, so narrow once rather than assert at each call.
 */
const generatedDiff = (
  provider: AlchemyProvider.ProviderService<EmulateService>,
  input: Parameters<NonNullable<AlchemyProvider.ProviderService<EmulateService>["diff"]>>[0],
): Effect.Effect<AlchemyProviderDiff | void, AlchemyProvider.ProviderError> =>
  provider.diff === undefined
    ? Effect.die(new Error("the generated provider must define diff"))
    : provider.diff(input);

/** An emulator started outside the resource, for `dev: { mode: "external" }`. */
const listen = Effect.acquireRelease(
  Effect.promise(() => createEmulator({ service: "github", port: 0 })),
  (started) => Effect.promise(() => started.close()),
);

describe("EmulateService", () => {
  describe("local provider", () => {
    it.layer(localProvider(), { buildPerTest: true })((it) => {
      it.effect("starts one emulator per resource and restarts it on seed changes", () =>
        Effect.gen(function* () {
          const provider = yield* EmulateServiceProviderTag;

          // create: the emulator is listening at the reported url
          const created = yield* provider.reconcile(input("i1", github({ dev: { seed: SEED } })));
          expect(new URL(created.url).hostname).toBe("localhost");
          expect(created.generatedSecrets).toEqual([]);
          yield* expectServesZen(created.url);

          // same config: the diff is a noop and reconcile joins the running instance
          const unchanged = yield* generatedDiff(
            provider,
            input("i1", github({ dev: { seed: SEED } })),
          );

          expect(unchanged).toEqual({ action: "noop" });

          const joined = yield* provider.reconcile(input("i1", github({ dev: { seed: SEED } })));
          expect(joined.url).toBe(created.url);
          yield* expectServesZen(created.url);

          // editing the deploy-time url must not restart a healthy emulator
          const deployed = github({ url: "https://api.github.com", dev: { seed: SEED } });
          const deployedDiff = yield* generatedDiff(provider, input("i1", deployed));
          expect(deployedDiff).toEqual({ action: "noop" });
          const adopted = yield* provider.reconcile(input("i1", deployed));
          expect(adopted.url).toBe(created.url);

          // a seed change restarts: a new url serves, the old port is dead
          const reseeded = github({ url: "https://api.github.com", dev: { seed: OTHER_SEED } });
          const reseededDiff = yield* generatedDiff(provider, input("i1", reseeded));
          expect(reseededDiff).toEqual({ action: "update" });
          const restarted = yield* provider.reconcile(input("i1", reseeded));
          expect(restarted.url).not.toBe(created.url);
          yield* expectServesZen(restarted.url);
          yield* expectUnreachable(created.url);

          // a replacement generation's delete must not touch the running instance
          yield* provider.delete({ ...input("i0", reseeded), output: restarted });
          yield* expectServesZen(restarted.url);

          // the matching delete closes the emulator
          yield* provider.delete({ ...input("i1", reseeded), output: restarted });
          yield* expectUnreachable(restarted.url);

          // delete is idempotent
          yield* provider.delete({ ...input("i1", reseeded), output: restarted });
        }),
      );

      it.effect("gives two resources of one service distinct emulators", () =>
        Effect.gen(function* () {
          const provider = yield* EmulateServiceProviderTag;

          const first = yield* provider.reconcile(input("i1", github({ dev: { seed: SEED } })));

          const second = yield* provider.reconcile({
            ...input("i2", github({ dev: { seed: OTHER_SEED } })),
            id: "mirror",
            fqn: "mirror",
          });

          expect(second.url).not.toBe(first.url);
          yield* expectServesZen(first.url);
          yield* expectServesZen(second.url);
        }),
      );

      it.effect("adopts the URL of an external emulator and never owns it", () =>
        Effect.gen(function* () {
          const server = yield* listen;
          const provider = yield* EmulateServiceProviderTag;

          const external = github({ dev: { mode: "external", url: server.url } });
          const adopted = yield* provider.reconcile(input("i1", external));

          expect(adopted.url).toBe(server.url);
          expect(adopted.generatedSecrets).toEqual([]);

          // deleting the resource leaves the server it did not start alone
          yield* provider.delete({ ...input("i1", external), output: adopted });
          yield* expectServesZen(server.url);
        }),
      );

      it.effect("fails with a typed error when the port is taken", () =>
        Effect.gen(function* () {
          const server = yield* listen;
          const port = Number(new URL(server.url).port);
          const provider = yield* EmulateServiceProviderTag;

          const failure = yield* provider
            .reconcile(input("i1", github({ dev: { port } })))
            .pipe(Effect.flip);

          expect(failure._tag).toBe("EmulateStartError");
        }),
      );
    });
  });

  describe("live provider", () => {
    it.layer(EmulateServiceProviderLive(), { buildPerTest: true })((it) => {
      it.effect("reports the real endpoint on deploy", () =>
        Effect.gen(function* () {
          const provider = yield* EmulateServiceProviderTag;

          const attrs = yield* provider.reconcile(
            input("i1", github({ url: "https://api.github.com" })),
          );

          expect(attrs).toEqual({ url: "https://api.github.com", generatedSecrets: [] });

          // nothing runs on deploy, so there is nothing to tear down
          yield* provider.delete({
            ...input("i1", github({ url: "https://api.github.com" })),
            output: attrs,
          });
        }),
      );

      it.effect("fails a deploy without a url instead of dropping the binding", () =>
        Effect.gen(function* () {
          const provider = yield* EmulateServiceProviderTag;

          const failure = yield* provider.reconcile(input("i1", github())).pipe(Effect.flip);

          expect(failure).toBeInstanceOf(EmulateDeployUrlError);
        }),
      );
    });
  });

  describe("EmulateServiceProvider", () => {
    it.effect("routes by provider mode: dev starts an emulator, deploy reports the url", () =>
      Effect.gen(function* () {
        // The variant layer builds lazily on the first lifecycle call, so the
        // reconcile (and the probe on the emulator it starts) run inside the
        // provided scope, the way a stack deploy holds its providers layer.
        yield* EmulateServiceProviderTag.pipe(
          Effect.flatMap((provider) => provider.reconcile(input("i1", github()))),
          Effect.tap((attrs) => expectServesZen(attrs.url)),
          Effect.provide(dualProvider(true)),
        );

        const failure = yield* EmulateServiceProviderTag.pipe(
          Effect.flatMap((provider) => provider.reconcile(input("i1", github()))),
          Effect.provide(dualProvider(false)),
          Effect.flip,
        );

        expect(failure).toBeInstanceOf(EmulateDeployUrlError);
      }),
    );
  });

  describe("providers()", () => {
    it.effect("registers the provider where the stack engine resolves it", () =>
      Effect.gen(function* () {
        const collection = yield* Providers;

        // SAFETY: the collection keys on the resource's own Type string, so the
        // loose Record lookup only needs re-narrowing to the typed provider,
        // and the guard below turns a missing registration into a failure.
        const provider = collection.get(
          EmulateService.Type,
        ) as AlchemyProvider.ProviderService<EmulateService>;

        if (provider === undefined) {
          return yield* Effect.die(new Error("Emulate.Service must be registered"));
        }

        const attrs = yield* provider.reconcile(input("i1", github()));
        yield* expectServesZen(attrs.url);
      }).pipe(Effect.provide(registeredProviders())),
    );
  });
});
