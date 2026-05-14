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

import { extractClaimsChallenge } from "./claims-challenge.js";

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
 *
 * Optional `grantedScopes` exposes the OAuth scopes the credential
 * believes are currently granted (i.e. the consented set on the
 * signed-in account). When present, `BaseHttpClient.assertScopes`
 * uses it to fail fast with a `MissingScopeError` before attempting
 * an HTTP call that the server would reject. Test credentials that
 * are constructed from a plain string token do not implement it,
 * which makes scope checking opt-in by credential rather than by
 * call site.
 */
export interface TokenCredential {
  /** Acquire a (possibly cached / silently-refreshed) access token. */
  getToken(signal: AbortSignal): Promise<string>;
  /** Return the OAuth scopes currently granted, if known. */
  grantedScopes?(signal: AbortSignal): Promise<readonly string[]>;
}

/** Common-shape error envelope. Both Graph and ARM use `{ error: { code, message } }`. */
export interface ErrorEnvelope {
  error: { code: string; message: string };
}

/**
 * HTTP-level error thrown when a Graph or ARM request fails.
 *
 * `resource` (`"graph"` / `"arm"`) is the discriminator — callers that
 * need per-resource handling switch on it rather than `instanceof`-ing
 * a subclass. Kept as a single named class so cross-cutting handlers
 * can match `err instanceof RequestError` regardless of the underlying
 * API.
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

/**
 * Thrown when a Graph or ARM response carries a Conditional Access
 * "claims challenge" — the user's current access token does not
 * satisfy a required authentication context (e.g. MFA `c1`, compliant
 * device, session-risk policy) and Microsoft Entra wants the user to
 * step up.
 *
 * Subclass of {@link RequestError} so existing `instanceof RequestError`
 * handlers still match. The recovery flow is **not** automated by the
 * HTTP transport; the AI assistant is expected to:
 *
 *   1. Read the embedded {@link claims} JSON from the error.
 *   2. Call the `login` tool with `{ claims }` to trigger an
 *      interactive re-auth that satisfies the policy.
 *   3. Re-invoke the original tool.
 *
 * The error message is written for the AI assistant and includes the
 * literal claims JSON so it can be passed verbatim to the next
 * `login` call.
 */
export class StepUpRequiredError extends RequestError {
  constructor(
    resource: string,
    method: string,
    path: string,
    statusCode: number,
    code: string,
    responseMessage: string,
    public readonly claims: string,
  ) {
    super(resource, method, path, statusCode, code, responseMessage);
    this.name = "StepUpRequiredError";
    // Replace the inherited message with one that tells the AI exactly
    // how to recover. Keep the original transport detail (status, code,
    // resource/method/path) for traceability.
    this.message =
      `Conditional Access step-up authentication required for ${resource} ${method} ${path} ` +
      `(${code}, HTTP ${String(statusCode)}). The user's current access token does not satisfy ` +
      `the required authentication context. ` +
      `Recover by calling the \`login\` tool with claims=${claims} and then re-invoking the ` +
      `original tool. The browser will prompt the user to satisfy the policy (MFA, compliant ` +
      `device, etc.) for the currently signed-in account.`;
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
export interface HttpClientPlugins {
  /** Short, lowercase resource label (e.g. `"graph"`, `"arm"`). */
  readonly resource: string;
  /** Friendly resource name for error messages (e.g. `"Graph API"`). */
  readonly errorLabel: string;
  /** Construct a `RequestError` from a parsed envelope. */
  readonly buildRequestError: (
    method: string,
    path: string,
    statusCode: number,
    code: string,
    message: string,
  ) => RequestError;
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
export class BaseHttpClient {
  protected readonly baseUrl: string;
  protected readonly timeoutMs: number;
  /**
   * Public so feature client functions can pass it to
   * {@link assertScopes} without taking a separate Authenticator
   * parameter. The {@link TokenCredential.grantedScopes} hook makes
   * scope enforcement opt-in per credential — production credentials
   * (the real `Authenticator`) implement it; tests that pass a plain
   * string token do not, and the scope check is skipped.
   */
  readonly credential: TokenCredential;
  protected readonly maxRetries: number;
  private readonly _delayFn: (ms: number) => Promise<void>;
  private readonly plugins: HttpClientPlugins;
  private static readonly retryableStatusCodes = new Set([429, 503, 504]);
  private static readonly BASE_RETRY_DELAY_MS = 1000;

  constructor(
    baseUrl: string,
    credential: TokenCredential | string,
    plugins: HttpClientPlugins,
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
    if (signalArg !== undefined) {
      // 4-arg overload: (method, path, body, signal).
      body = bodyOrSignal;
      signal = signalArg;
    } else if (bodyOrSignal instanceof AbortSignal) {
      // 3-arg overload: (method, path, signal).
      body = undefined;
      signal = bodyOrSignal;
    } else {
      // Neither overload matched — caller passed a body without a signal.
      throw new TypeError("BaseHttpClient.request: missing AbortSignal");
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

      // Detect a Conditional Access claims challenge before building
      // the generic RequestError. Both the WWW-Authenticate header
      // (CAE / OAuth standard) and the response body (PIM
      // RoleAssignmentRequestAcrsValidationFailed) are inspected. When
      // present, throw a typed StepUpRequiredError so the AI can
      // recover via the login tool with the embedded claims. The HTTP
      // transport deliberately performs no retry and has no knowledge
      // of the authenticator — orchestration lives in the tool layer.
      const claims = extractClaimsChallenge({
        headers: response.headers,
        body: rawBody,
        message,
      });
      if (claims !== null) {
        const stepUpError = new StepUpRequiredError(
          this.plugins.resource,
          method,
          path,
          response.status,
          code,
          message,
          claims,
        );
        logger.info(`${this.plugins.resource} step-up challenge`, {
          method,
          path,
          status: response.status,
          code,
        });
        throw stepUpError;
      }

      const error = this.plugins.buildRequestError(method, path, response.status, code, message);

      const isRetryable = BaseHttpClient.retryableStatusCodes.has(response.status);
      const isLastAttempt = attempt >= this.maxRetries;
      if (!isRetryable || isLastAttempt) {
        throw error;
      }

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
    }
    // Unreachable: each iteration either returns or throws.
    /* v8 ignore next */
    throw new Error("BaseHttpClient.performRequest: retry loop completed without returning");
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
