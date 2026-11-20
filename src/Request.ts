import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import type { ServiceName } from "emulate";
import { EmulateRequestError } from "./Errors.ts";

/** HTTP methods the package accepts. A subset of the tokens `fetch` and Effect's client support. */
export type HttpRequestMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";

/** Options for one request against an emulated service. */
export interface RequestOptions {
  /**
   * @default "GET"
   */
  readonly method?: HttpRequestMethod;
  /** Request headers, e.g. the seeded `authorization` token. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Request body. Bodies are the caller's business: encode JSON yourself. */
  readonly body?: string;
}

const toRequest = (url: string, path: string, options: RequestOptions) => {
  const base = HttpClientRequest.make(options.method ?? "GET")(`${url}${path}`);

  const withHeaders =
    options.headers === undefined ? base : HttpClientRequest.setHeaders(options.headers)(base);

  return options.body === undefined
    ? withHeaders
    : HttpClientRequest.bodyText(options.body)(withHeaders);
};

/** One request to route through an emulator. */
export interface EmulatedRequest {
  readonly client: HttpClient.HttpClient;
  readonly service: ServiceName;
  readonly url: string;
  readonly path: string;
  readonly options: RequestOptions;
}

/**
 * Send one request through `client` and hand back the web `Response`, so the
 * public surface never leaks an unstable `effect/http` type.
 *
 * @internal
 */
export const executeRequest = (
  input: EmulatedRequest,
): Effect.Effect<Response, EmulateRequestError> => {
  const target = `${input.url}${input.path}`;

  return input.client.execute(toRequest(input.url, input.path, input.options)).pipe(
    Effect.mapError((cause) =>
      EmulateRequestError.make({
        service: input.service,
        url: target,
        message: `The request to the ${input.service} emulator at ${input.url} failed. Fix: check the emulator is listening, that the path exists for this service, and that an HttpClient is provided.`,
        cause,
      }),
    ),
    Effect.flatMap((response) =>
      Effect.fromOption(HttpClientResponse.toWeb(response), () =>
        EmulateRequestError.make({
          service: input.service,
          url: target,
          message: `The HttpClient provided for the ${input.service} emulator cannot hand back a web Response. Fix: provide a web-backed client such as \`FetchHttpClient.layer\`.`,
          cause: undefined,
        }),
      ),
    ),
  );
};
