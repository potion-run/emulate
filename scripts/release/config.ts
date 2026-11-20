/**
 * Shared config for the release scripts.
 *
 * EMULATE_REPO   `<owner>/<repo>` for changelog/release-note URLs. Defaults to
 *                this package's own repository, so a fork only sets it to get
 *                its own compare links.
 */
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as String from "effect/String";

export class InvalidRepo extends Schema.TaggedError<
  InvalidRepo,
  { readonly brand: unique symbol }
>()("InvalidRepo", {
  message: Schema.String,
}) {}

const defaultRepo = "potion-run/emulate";

/** `EMULATE_REPO`, as `<owner>/<repo>`. */
export const repository = Effect.gen(function* () {
  const configured = yield* Config.String("EMULATE_REPO").pipe(Config.withDefault(defaultRepo));
  const repo = String.trim(configured);

  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return yield* InvalidRepo.make({
      message: `EMULATE_REPO must be <owner>/<repo> (got: ${repo}). Fix: unset it to use ${defaultRepo}, or export EMULATE_REPO=<owner>/<repo>.`,
    });
  }

  return repo;
});
