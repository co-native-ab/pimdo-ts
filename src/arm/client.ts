// Lightweight HTTP client for Azure Resource Manager (https://management.azure.com).
//
// Thin subclass of {@link BaseHttpClient} that plugs in the ARM error class
// and the standard `{ error: { code, message } }` envelope. The shared
// transport (auth, retry/backoff, timeout, logging) lives in the base class.

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

/** ARM error response envelope (re-exported for backward compatibility). */
export type { ArmErrorEnvelope } from "./types.js";

/** Error thrown when an ARM API request fails. */
export class ArmRequestError extends RequestError {
  constructor(
    method: string,
    path: string,
    statusCode: number,
    code: string,
    public readonly armMessage: string,
  ) {
    super("arm", method, path, statusCode, code, armMessage);
    this.name = "ArmRequestError";
  }
}

/** Error thrown when an ARM API response cannot be parsed/validated. */
export class ArmResponseParseError extends ResponseParseError {
  constructor(
    method: string,
    path: string,
    statusCode: number,
    zodError: import("zod").ZodError,
    rawBody: string,
  ) {
    super("arm", method, path, statusCode, zodError, rawBody);
    this.name = "ArmResponseParseError";
  }
}

/**
 * Parse and validate an ARM API response using a Zod schema.
 * Throws {@link ArmResponseParseError} on validation failure.
 */
export async function parseResponse<T>(
  response: Response,
  schema: ZodType<T>,
  method?: string,
  path?: string,
): Promise<T> {
  return parseResponseGeneric(response, schema, "ARM", ArmResponseParseError, method, path);
}

/** HTTP client for Azure Resource Manager using native fetch. */
export class ArmClient extends BaseHttpClient<ArmRequestError> {
  /**
   * @param baseUrl  ARM API base URL (default: https://management.azure.com)
   * @param credential  A TokenCredential whose getToken() is called on every
   *   request, or a plain string token (wrapped internally).
   */
  constructor(
    baseUrl = "https://management.azure.com",
    credential: TokenCredential | string,
    timeoutMs = 30000,
    maxRetries = 3,
    delayFn?: (ms: number) => Promise<void>,
  ) {
    super(
      baseUrl,
      credential,
      {
        resource: "arm",
        errorLabel: "ARM API",
        buildRequestError: (method, path, statusCode, code, message) =>
          new ArmRequestError(method, path, statusCode, code, message),
        isErrorEnvelope: isStandardErrorEnvelope,
      },
      timeoutMs,
      maxRetries,
      delayFn,
    );
  }
}
