import * as Provider from "alchemy/Provider";
import * as Layer from "effect/Layer";
import { EmulateService, EmulateServiceProvider } from "./EmulateService.ts";

/** Service tag bundling every emulate provider. */
export class Providers extends Provider.ProviderCollection<Providers>()("Emulate") {
  static readonly make = Provider.collection([EmulateService]);

  // A fresh Layer per call, never a shared value: the provider underneath
  // captures the building stack's services (its `Stack`, its artifact
  // store), so a memoized instance would pin the first stack's context
  // into every later stack that reused it.
  static readonly layer = () =>
    Layer.effect(Providers, Providers.make).pipe(Layer.provide(EmulateServiceProvider()));
}

/**
 * The emulate providers Layer: registers the `Emulate.Service` provider, so a
 * stack that declares an emulated service can resolve it. Include this from
 * your stack alongside other providers layers — the convention every
 * alchemy provider package follows:
 *
 * ```typescript
 * import * as Alchemy from "alchemy";
 * import * as Cloudflare from "@alchemy.run/cloudflare";
 * import { providers } from "@potion.run/emulate/Providers";
 *
 * export default Alchemy.Stack(
 *   "MyStack",
 *   {
 *     providers: Layer.mergeAll(Cloudflare.providers(), providers()),
 *     state: Alchemy.localState(),
 *   },
 *   Effect.gen(function* () {
 *     const github = yield* EmulateService("github", { service: "github" });
 *     return { url: github.url };
 *   }),
 * );
 * ```
 */
export const providers = Providers.layer;
