export { Connect, type EmulatorUrls } from "./Connect.ts";

export { Emulate, type EmulateOptions, type Emulation, type EmulatorHandle } from "./Emulate.ts";

export { Emulator, type EmulatorService, type RunningEmulator } from "./Emulator.ts";

export {
  EmulateDeployUrlError,
  EmulateExternalConfigError,
  EmulateRequestError,
  EmulateResetError,
  EmulateStartError,
  EmulateUnknownServiceError,
  type EmulateError,
} from "./Errors.ts";

export { InProcess } from "./InProcess.ts";

export type { HttpRequestMethod, RequestOptions } from "./Request.ts";

export type { ServiceConfigs, ServiceName, ServiceOptions } from "./ServiceOptions.ts";

// The alchemy-integration half is deliberately NOT re-exported from this
// barrel (it carries the optional `alchemy` peer, which runtime-only
// consumers — Effect tests, non-alchemy apps — must not be forced to
// install). One module per entry point, the same doctrine alchemy's own
// packages apply to their optional-peer driver layers:
//   @potion.run/emulate/EmulateService      — the `Emulate.Service` resource + providers
//   @potion.run/emulate/EmulateServiceLocal — the dev sidecar's provider group module
//   @potion.run/emulate/Providers           — the stack `providers()` layer
