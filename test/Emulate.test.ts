import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import { createEmulator } from "emulate";
import {
  Connect,
  Emulate,
  EmulateExternalConfigError,
  EmulateResetError,
  EmulateStartError,
  EmulateUnknownServiceError,
  InProcess,
} from "../src/index.ts";

const platform = () => Layer.mergeAll(InProcess(), FetchHttpClient.layer);

const listen = Effect.acquireRelease(
  Effect.promise(() => createEmulator({ service: "github", port: 0 })),
  (started) => Effect.promise(() => started.close()),
);

describe("Emulate", () => {
  describe("InProcess", () => {
    it.layer(platform(), { buildPerTest: true })((it) => {
      it.effect("serves the emulated service's routes over a loopback URL", () =>
        Effect.gen(function* () {
          const emulate = yield* Emulate({ services: { github: {} } });

          expect(new URL(emulate.github.url).hostname).toBe("localhost");

          const response = yield* emulate.github.request("/zen");
          const body = yield* Effect.promise(() => response.text());

          expect(response.status).toBe(200);
          expect(body.length).toBeGreaterThan(0);
        }),
      );

      it.effect("shares one emulator between every Emulate call for the same service", () =>
        Effect.gen(function* () {
          const first = yield* Emulate({ services: { github: {} } });
          const second = yield* Emulate({ services: { github: {} } });

          expect(second.github.url).toBe(first.github.url);
        }),
      );

      it.effect("gives each service its own endpoint", () =>
        Effect.gen(function* () {
          const emulate = yield* Emulate({ services: { github: {}, slack: {} } });

          expect(emulate.github.url).not.toBe(emulate.slack.url);

          const slack = yield* emulate.slack.request("/");
          expect(slack.status).toBe(200);
        }),
      );

      it.effect("resets an emulator it owns", () =>
        Effect.gen(function* () {
          const emulate = yield* Emulate({ services: { github: {} } });

          yield* emulate.github.reset;
          const response = yield* emulate.github.request("/zen");

          expect(response.status).toBe(200);
        }),
      );

      it.effect("reports a typed error when an emulator cannot bind its port", () =>
        Effect.gen(function* () {
          const server = yield* listen;
          const port = Number(new URL(server.url).port);

          const failure = yield* Emulate({ services: { github: { port } } }).pipe(
            Effect.provide(InProcess()),
            Effect.flip,
          );

          expect(failure).toBeInstanceOf(EmulateStartError);
        }),
      );
    });
  });

  describe("Connect", () => {
    it.layer(platform(), { buildPerTest: true })((it) => {
      it.effect("attaches to an emulator that is already listening", () =>
        Effect.gen(function* () {
          const server = yield* listen;

          const emulate = yield* Emulate({ services: { github: {} } }).pipe(
            Effect.provide(Connect({ github: server.url })),
          );

          const response = yield* emulate.github.request("/zen");

          expect(emulate.github.url).toBe(server.url);
          expect(response.status).toBe(200);
        }),
      );

      it.effect("refuses to reset an emulator it does not own", () =>
        Effect.gen(function* () {
          const server = yield* listen;

          const emulate = yield* Emulate({ services: { github: {} } }).pipe(
            Effect.provide(Connect({ github: server.url })),
          );

          const failure = yield* emulate.github.reset.pipe(Effect.flip);

          expect(failure).toBeInstanceOf(EmulateResetError);
        }),
      );

      it.effect("fails when the service has no configured URL", () =>
        Effect.gen(function* () {
          const failure = yield* Emulate({ services: { github: {} } }).pipe(
            Effect.provide(Connect({})),
            Effect.flip,
          );

          expect(failure).toBeInstanceOf(EmulateUnknownServiceError);
        }),
      );

      it.effect("fails instead of silently dropping options it cannot apply", () =>
        Effect.gen(function* () {
          const failure = yield* Emulate({
            services: { github: { seed: { tokens: {} } } },
          }).pipe(Effect.provide(Connect({ github: "http://127.0.0.1:4000" })), Effect.flip);

          expect(failure).toBeInstanceOf(EmulateExternalConfigError);
        }),
      );
    });
  });
});
