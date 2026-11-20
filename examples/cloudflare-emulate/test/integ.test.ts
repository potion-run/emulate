import { expect } from "bun:test";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Test from "@alchemy.run/test/Bun";
import { providers } from "@potion-run/emulate/Providers";
import * as Alchemy from "alchemy";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import Stack from "../alchemy.run.ts";

// Placeholder credentials satisfy the local Cloudflare providers' env
// lookups without any cloud call being possible, and `CI=1` lets a
// profile-less run fall back to them — the same hermetic trick the
// alchemy repo's own dev-mode example tests use.
process.env.CI = "1";
process.env.CLOUDFLARE_ACCOUNT_ID ??= "0123456789abcdef0123456789abcdef";
process.env.CLOUDFLARE_API_TOKEN ??= "cloudflare-emulate-placeholder";

// `dev: true` runs the real `alchemy dev` topology: the emulator starts in
// the provider sidecar, and its URL binds into the local workerd runtime.
const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Layer.mergeAll(Cloudflare.providers(), providers()),
  state: Alchemy.localState(),
  dev: true,
});

afterAll(destroy(Stack));

class NotReady extends Data.TaggedError("NotReady")<{ readonly status?: number }> {}

const getWhenReady = (url: string) =>
  HttpClient.get(url).pipe(
    Effect.flatMap((response) =>
      response.status === 200
        ? Effect.succeed(response)
        : Effect.fail(new NotReady({ status: response.status })),
    ),
    Effect.retry({
      while: (error) => error._tag === "NotReady",
      schedule: Schedule.max([Schedule.spaced("250 millis"), Schedule.recurs(60)]),
    }),
  );

const stack = beforeAll(
  deploy(Stack).pipe(
    Effect.flatMap((outputs) => getWhenReady(`${outputs.url}/zen`).pipe(Effect.as(outputs))),
  ),
  { timeout: 300_000 },
);

test(
  "the worker serves the emulated /zen",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const response = yield* getWhenReady(`${url}/zen`);
    const wisdom = yield* response.text;

    expect(wisdom.length).toBeGreaterThan(0);
  }),
  { timeout: 60_000 },
);

test(
  "the seeded token authenticates against the emulated /user",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const response = yield* getWhenReady(`${url}/user`);
    const user = (yield* response.json) as { login: string };

    expect(user.login).toBe("octocat");
  }),
  { timeout: 60_000 },
);
