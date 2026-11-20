import type { SeedConfig, ServiceName } from "emulate";

/** Every service `emulate` ships a drop-in emulator for. */
export type { ServiceName };

/**
 * Per-service emulator options. Mirrors the options `createEmulator` accepts,
 * minus `service` (which is the key in `Emulate({ services })`).
 */
export interface ServiceOptions {
  /**
   * Initial state for the emulator: `tokens` plus whatever the service's
   * state type declares. `emulate` re-applies it on `reset`.
   */
  readonly seed?: SeedConfig;
  /**
   * Port the emulator listens on.
   *
   * @default 0 — an ephemeral port chosen by the OS, so several services (and
   * several test files) can run at once without colliding on `emulate`'s
   * default port.
   */
  readonly port?: number;
  /**
   * Address the emulator binds. Leave it unset to keep `emulate`'s own
   * default (IPv4 loopback): emulated services hold seeded credentials and
   * unauthenticated endpoints, so they stay off public interfaces unless you
   * ask. Note that `url` always reports `localhost`.
   */
  readonly hostname?: string;
  /**
   * Public base URL the emulator advertises in its responses (webhook
   * targets, OAuth redirects). Defaults to the listening URL.
   */
  readonly baseUrl?: string;
}

/** The service map `Emulate({ services })` accepts: emulated services, keyed by name. */
export type ServiceConfigs = { readonly [name in ServiceName]?: ServiceOptions };
