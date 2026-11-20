import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import { EmulateService } from "alchemy-emulate/EmulateService";
import { providers } from "alchemy-emulate/Providers";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export type Env = import("./src/worker.ts").Env;

export default Alchemy.Stack(
  "CloudflareEmulate",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), providers()),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    // The GitHub API this worker calls. Under `alchemy dev` the emulator
    // runs in the dev sidecar — seeded with one token — and `github.url`
    // is its ephemeral URL; under `alchemy deploy` the emulator is inert
    // and `github.url` is the real endpoint from `url`.
    const github = yield* EmulateService("github", {
      service: "github",
      url: "https://api.github.com",
      dev: {
        seed: {
          tokens: { ghp_emulate: { login: "octocat" } },
          github: { users: [{ login: "octocat", name: "The Octocat" }] },
        },
      },
    });

    const worker = yield* Cloudflare.Worker("api", {
      main: "./src/worker.ts",
      env: {
        GITHUB_API_URL: github.url,
        GITHUB_TOKEN: "ghp_emulate",
      },
    });

    return { url: worker.url.as<string>() };
  }),
);
