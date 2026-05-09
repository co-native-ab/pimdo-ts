// Shared HTTP base client.
//
// Both `GraphClient` and `ArmClient` follow the same wire contract:
// bearer auth, native fetch, native error envelope, retry on 429/503/504.
// Their only differences are the resource label, error class, and how the
// JSON error envelope shape is parsed. This module owns the transport
// (token acquisition, `Accept-Language` pinning, retry/backoff,
// timeout-per-attempt) and lets each subclass plug in those three things.

import { logger } from "../logger.js";
import { ZodType, ZodError } from "zod";

/** HTTP methods used by API requests. */
export enum HttpMethod {
  GET = "GET",
  POST = "POST",
  PUT = "PUT",
  PATCH = "PATCH",
  DELETE = "DELETE",
}

/**
 * Analogous to Azure.Identity's TokenCredential. Implemented by
 * `Authenticator` — handles caching, silent refresh, and throws
 * `AuthenticationRequiredError` when interaction is needed.
 */
export interface TokenCredential {
  /** Acquire a (possibly cached / silently-refreshed) access token. */
  getToken(signal: AbortSignal): Promise<string>;
}

/** Common-shape error envelope. Both Graph and ARM use `{ error: { code, message } }`. */
export interface ErrorEnvelope {
  error: { code: string; message: string };
}

/**
 * Common base for `GraphRequestError` / `ArmRequestError`.
 *
 * Subclasses set `resource` (e.g. `"graph"`, `"arm"`) and may override the
 * formatted `message` shape. Kept as a small named class so callers can do
 * `err instanceof RequestError` for cross-cutting handling without giving
 * up per-resource subtype refinement.
 */
export class RequestError extends Error {
  constructor(
    public readonly resource: string,
    public readonly method: string,
    public readonly path: string,
    public readonly statusCode: number,
    public readonly code: string,
    public readonly responseMessage: string,
  ) {
    super(`${resource} ${method} ${path}: ${code}: ${responseMessage} (HTTP ${statusCode})`);
    this.name = "RequestError";
  }
}

/** Base for response-parse errors. */
export class ResponseParseError extends Error {
  constructor(
    public readonly resource: string,
    public readonly method: string,
    public readonly path: string,
    public readonly statusCode: number,
    public readonly zodError: ZodError,
    public readonly rawBody: string,
  ) {
    super(
      `Failed to parse ${resource} API response for ${method} ${path} (HTTP ${statusCode}): ${zodError.message}`,
    );
    this.name = "ResponseParseError";
  }
}

/**
 * Parse and validate a response body as JSON against a Zod schema.
 *
 * Throws an instance of `ParseErrorClass` (one of the per-resource
 * subclasses) on parse / validation failure. The factory pattern keeps
 * the existing per-resource error class names stable for callers.
 */
export async function parseResponseGeneric<T>(
  response: Response,
  schema: ZodType<T>,
  resource: string,
  ParseErrorClass: new (
    method: string,
    path: string,
    statusCode: number,
    zodError: ZodError,
    rawBody: string,
  ) => Error,
  method?: string,
  path?: string,
): Promise<T> {
  const rawBody = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new ParseErrorClass(
      method ?? response.url,
      path ?? "",
      response.status,
      new ZodError([
        {
          code: "custom",
          message: "Response body is not valid JSON",
          path: [],
        },
      ]),
      rawBody,
    );
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new ParseErrorClass(
      method ?? response.url,
      path ?? "",
      response.status,
      result.error,
      rawBody,
    );
  }
  return result.data;
}

/**
 * Configuration plug-points for `BaseHttpClient` subclasses.
 */
export interface HttpClientPlugins<RErr extends RequestError> {
  /** Short, lowercase resource label (e.g. `"graph"`, `"arm"`). */
  readonly resource: string;
  /** Friendly resource name for error messages (e.g. `"Graph API"`). */
  readonly errorLabel: string;
  /** Construct a per-resource RequestError from a parsed envelope. */
  readonly buildRequestError: (
    method: string,
    path: string,
    statusCode: number,
    code: string,
    message: string,
  ) => RErr;
  /**
   * Detect whether a parsed JSON value matches the per-resource error
   * envelope shape. Both graph and arm currently use `{error:{code,message}}`
   * but we keep the hook in case shapes diverge later.
   */
  readonly isErrorEnvelope: (value: unknown) => value is ErrorEnvelope;
}

/** Default `{error:{code,message}}` envelope detector. Re-used by both clients. */
export function isStandardErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj["error"] !== "object" || obj["error"] === null) return false;
  const err = obj["error"] as Record<string, unknown>;
  return typeof err["code"] === "string" && typeof err["message"] === "string";
}

/**
 * Common transport for `GraphClient` and `ArmClient`.
 *
 * Owns: bearer-auth header, `Accept-Language` pinning (Microsoft endpoints
 * reject undici's default `*`), retry/backoff for 429/503/504, per-attempt
 * timeout combined with the caller's cancellation `AbortSignal`, and
 * structured request/response logging.
 *
 * Subclasses contribute their resource label, error class, and (optionally)
 * their own override of `request()` to customise the public type signature.
 */
export class BaseHttpClient<RErr extends RequestError> {
  protected readonly baseUrl: string;
  protected readonly timeoutMs: number;
  protected readonly credential: TokenCredential;
  protected readonly maxRetries: number;
  private readonly _delayFn: (ms: number) => Promise<void>;
  private readonly plugins: HttpClientPlugins<RErr>;
  private static readonly retryableStatusCodes = new Set([429, 503, 504]);
  private static readonly BASE_RETRY_DELAY_MS = 1000;

  constructor(
    baseUrl: string,
    credential: TokenCredential | string,
    plugins: HttpClientPlugins<RErr>,
    timeoutMs = 30000,
    maxRetries = 3,
    delayFn?: (ms: number) => Promise<void>,
  ) {
    // Strip trailing slashes without a backtracking regex.
    let cleanUrl = baseUrl;
    while (cleanUrl.endsWith("/")) cleanUrl = cleanUrl.slice(0, -1);
    this.baseUrl = cleanUrl;
    this.credential =
      typeof credential === "string" ? { getToken: () => Promise.resolve(credential) } : credential;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this._delayFn = delayFn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.plugins = plugins;
  }

  /** Send an HTTP request with no body. */
  request(method: HttpMethod, path: string, signal: AbortSignal): Promise<Response>;
  /** Send an HTTP request with a JSON body. */
  request(method: HttpMethod, path: string, body: unknown, signal: AbortSignal): Promise<Response>;
  async request(
    method: HttpMethod,
    path: string,
    bodyOrSignal: unknown,
    signalArg?: AbortSignal,
  ): Promise<Response> {
    let body: unknown;
    let signal: AbortSignal;
    if (bodyOrSignal instanceof AbortSignal) {
      body = undefined;
      signal = bodyOrSignal;
    } else {
      body = bodyOrSignal;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      signal = signalArg!;
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const rawBody = body !== undefined ? JSON.stringify(body) : undefined;
    return this.performRequest(method, path, headers, rawBody, signal);
  }

  /**
   * Send a request with a raw body and caller-specified Content-Type.
   * Body is sent as-is (not JSON-stringified). `extraHeaders` merge over the
   * Content-Type and may carry e.g. `If-Match` / `If-None-Match`.
   */
  protected async performRawRequest(
    method: HttpMethod,
    path: string,
    body: string | Uint8Array,
    contentType: string,
    signal: AbortSignal,
    extraHeaders?: Readonly<Record<string, string>>,
  ): Promise<Response> {
    const headers: Record<string, string> = { "Content-Type": contentType, ...extraHeaders };
    return this.performRequest(method, path, headers, body, signal);
  }

  protected async performRequest(
    method: HttpMethod,
    path: string,
    extraHeaders: Record<string, string>,
    body: string | Uint8Array | undefined,
    signal: AbortSignal,
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;

    // Acquire a fresh (or silently-refreshed) token for this request.
    const token = await this.credential.getToken(signal);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      // Node's undici fetch defaults Accept-Language to "*", which Microsoft
      // Graph and some ARM endpoints reject ("CultureNotFoundException").
      // Pin an explicit value. Callers may override via extraHeaders.
      "Accept-Language": "en",
      ...extraHeaders,
    };

    // Log path only (no query string): URLs frequently embed user
    // identifiers, principal/role-assignment GUIDs, and `$filter`
    // expressions containing display names — content the user enabling
    // PIMDO_DEBUG=true probably does not expect to land in plaintext logs.
    const queryIdx = path.indexOf("?");
    const pathForLog = queryIdx === -1 ? path : path.slice(0, queryIdx);
    logger.debug(`${this.plugins.resource} request`, { method, path: pathForLog });

    const baseInit: RequestInit = { method, headers };
    if (body !== undefined) {
      baseInit.body = body;
    }

    let lastError: RErr | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (signal.aborted) throw signal.reason;

      // Fresh AbortSignal per attempt so each retry gets the full timeout.
      const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
      const init: RequestInit = {
        ...baseInit,
        signal: AbortSignal.any([signal, timeoutSignal]),
      };

      let response: Response;
      try {
        response = await fetch(url, init);
      } catch (err) {
        if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
          throw this.plugins.buildRequestError(
            method,
            path,
            0,
            "TimeoutError",
            `${this.plugins.errorLabel} request timed out after ${String(this.timeoutMs)}ms`,
          );
        }
        throw err;
      }

      logger.debug(`${this.plugins.resource} response`, { method, url, status: response.status });

      if (response.status < 400) {
        return response;
      }

      // Parse error body for code/message.
      const rawBody = await response.text();
      let code = "UnknownError";
      let message = rawBody;

      try {
        const envelope = JSON.parse(rawBody) as unknown;
        if (this.plugins.isErrorEnvelope(envelope)) {
          code = envelope.error.code;
          message = envelope.error.message;
        }
      } catch {
        // Use raw body text as message.
      }

      const error = this.plugins.buildRequestError(method, path, response.status, code, message);

      if (attempt < this.maxRetries && BaseHttpClient.retryableStatusCodes.has(response.status)) {
        const delayMs = parseRetryAfter(response.headers.get("Retry-After"), attempt);
        logger.info(`${this.plugins.resource} retry`, {
          method,
          path,
          status: response.status,
          attempt: attempt + 1,
          delayMs,
          code,
          message,
        });
        await this._delayFn(delayMs);
        lastError = error;
        continue;
      }
      throw error;
    }
    // lastError is always set when the loop exits without throwing (all
    // attempts were retryable and exhausted), so the non-null assertion is safe.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    throw lastError!;
  }
}

/**
 * Parse an HTTP `Retry-After` header into a delay in milliseconds.
 * Falls back to exponential backoff (1s, 2s, 4s, …) when absent or malformed.
 */
function parseRetryAfter(retryAfter: string | null, attempt: number): number {
  if (retryAfter) {
    const retryAfterSeconds = parseInt(retryAfter, 10);
    if (!isNaN(retryAfterSeconds)) {
      return retryAfterSeconds * 1000;
    }
    const retryDate = Date.parse(retryAfter);
    if (!isNaN(retryDate)) {
      return Math.max(0, retryDate - Date.now());
    }
  }
  return 1000 * Math.pow(2, attempt); // 1s, 2s, 4s, …
}
