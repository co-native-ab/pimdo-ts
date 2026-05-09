// Lightweight HTTP client for Microsoft Graph API.
//
// Thin subclass of {@link BaseHttpClient} that plugs in the Graph error
// class and the standard `{ error: { code, message } }` envelope. The
// shared transport (auth, retry/backoff, timeout, logging) lives in the
// base class.

import {
  BaseHttpClient,
  HttpMethod,
  RequestError,
  ResponseParseError,
  isStandardErrorEnvelope,
  parseResponseGeneric,
  type TokenCredential,
} from "../http/base-client.js";
import type { ZodType } from "zod";

export { HttpMethod, type TokenCredential };

/** Error thrown when a Graph API request fails. */
export class GraphRequestError extends RequestError {
  constructor(
    method: string,
    path: string,
    statusCode: number,
    code: string,
    public readonly graphMessage: string,
  ) {
    super("graph", method, path, statusCode, code, graphMessage);
    this.name = "GraphRequestError";
  }
}

/** Error thrown when a Graph API response cannot be parsed/validated. */
export class GraphResponseParseError extends ResponseParseError {
  constructor(
    method: string,
    path: string,
    statusCode: number,
    zodError: import("zod").ZodError,
    rawBody: string,
  ) {
    super("graph", method, path, statusCode, zodError, rawBody);
    this.name = "GraphResponseParseError";
  }
}

/**
 * Parse and validate a Graph API response using a Zod schema.
 * Throws GraphResponseParseError on validation failure.
 */
export async function parseResponse<T>(
  response: Response,
  schema: ZodType<T>,
  method?: string,
  path?: string,
): Promise<T> {
  return parseResponseGeneric(response, schema, "Graph", GraphResponseParseError, method, path);
}

/** HTTP client for Microsoft Graph API using native fetch. */
export class GraphClient extends BaseHttpClient<GraphRequestError> {
  /**
   * @param baseUrl  Graph API base URL (default: https://graph.microsoft.com/v1.0)
   * @param credential  A TokenCredential whose getToken() is called on every request,
   *   or a plain string token (wrapped internally for backward compatibility).
   */
  constructor(
    baseUrl = "https://graph.microsoft.com/v1.0",
    credential: TokenCredential | string,
    timeoutMs = 30000,
    maxRetries = 3,
    delayFn?: (ms: number) => Promise<void>,
  ) {
    super(
      baseUrl,
      credential,
      {
        resource: "graph",
        errorLabel: "Graph API",
        buildRequestError: (method, path, statusCode, code, message) =>
          new GraphRequestError(method, path, statusCode, code, message),
        isErrorEnvelope: isStandardErrorEnvelope,
      },
      timeoutMs,
      maxRetries,
      delayFn,
    );
  }

  /**
   * Send a request with a raw body and caller-specified Content-Type.
   *
   * Unlike {@link request}, the body is sent as-is (not JSON-stringified).
   * Used for OneDrive content uploads where the payload is raw text/bytes.
   *
   * Optional `extraHeaders` are merged on top of the Content-Type header. Use
   * this for conditional requests like `If-Match` / `If-None-Match`.
   */
  async requestRaw(
    method: HttpMethod,
    path: string,
    body: string | Uint8Array,
    contentType: string,
    signal: AbortSignal,
    extraHeaders?: Readonly<Record<string, string>>,
  ): Promise<Response> {
    return this.performRawRequest(method, path, body, contentType, signal, extraHeaders);
  }
}
