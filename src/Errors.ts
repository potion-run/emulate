import * as Schema from "effect/Schema";

/**
 * An emulator could not be started.
 *
 * Common causes: the requested port is already in use, or the code is running
 * somewhere without Node's `http` module (a Worker, a browser).
 */
export class EmulateStartError extends Schema.TaggedError<
  EmulateStartError,
  { readonly brand: unique symbol }
>()("EmulateStartError", {
  service: Schema.String,
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

/** No emulator is configured for the requested service. */
export class EmulateUnknownServiceError extends Schema.TaggedError<
  EmulateUnknownServiceError,
  { readonly brand: unique symbol }
>()("EmulateUnknownServiceError", {
  service: Schema.String,
  message: Schema.String,
}) {}

/** A request to a running emulator failed at the transport level. */
export class EmulateRequestError extends Schema.TaggedError<
  EmulateRequestError,
  { readonly brand: unique symbol }
>()("EmulateRequestError", {
  service: Schema.String,
  url: Schema.String,
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

/** An emulator failed to reset its state back to the seed. */
export class EmulateResetError extends Schema.TaggedError<
  EmulateResetError,
  { readonly brand: unique symbol }
>()("EmulateResetError", {
  service: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

/** `Connect` was given service options it cannot apply to an external server. */
export class EmulateExternalConfigError extends Schema.TaggedError<
  EmulateExternalConfigError,
  { readonly brand: unique symbol }
>()("EmulateExternalConfigError", {
  service: Schema.String,
  message: Schema.String,
}) {}

/** Every failure this package can produce. */
export type EmulateError =
  | EmulateStartError
  | EmulateUnknownServiceError
  | EmulateRequestError
  | EmulateResetError
  | EmulateExternalConfigError;
