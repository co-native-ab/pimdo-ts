// Lightweight HTTP client for Azure Resource Manager (https://management.azure.com).
//
// Mirrors the shape of {@link ../graph/client.ts!GraphClient}: takes a
// {@link TokenCredential}, performs JSON HTTP with bearer auth, parses an
// ARM-style error envelope into {@link ArmRequestError}, and retries
// 429/503/504. The duplication is deliberate — graph and ARM are
// independent resources (separate audiences, separate token caches) and
// keeping the clients separate avoids tangling their concerns.

import { logger } from "../logger.js";
import { ZodType, ZodError } from "zod";

/** HTTP methods used by ARM API requests. */
export enum HttpMethod {
  GET = "GET",
  POST = "POST",
  PUT = "PUT",
  PATCH = "PATCH",
  DELETE = "DELETE",
}

/**
 * Analogous to Azure.Identity's TokenCredential. Implemented by
 * `Authenticator` — the ARM client always asks for a fresh token via
 * `getToken(signal)` so silent refresh and cancellation work.
 *
 * Mirrors `graph/client.ts` so a single Authenticator instance can
 * satisfy both clients without an adapter shim.
 */
export interface TokenCredential {
  /** Acquire a (possibly cached / silently-refreshed) ARM access token. */
  getToken(signal: AbortSignal): Promise<string>;
}

/** ARM error response envelope. */
export interface ArmErrorEnvelope {
  error: {
    code: string;
    message: string;
  };
}

/** Error thrown when an ARM API request fails. */
export class ArmRequestError extends Error {
  constructor(
    public readonly method: string,
    public readonly path: string,
    public readonly statusCode: number,
    public readonly code: string,
    public readonly armMessage: string,
  ) {
    super(`arm ${method} ${path}: ${code}: ${armMessage} (HTTP ${statusCode})`);
    this.name = "ArmRequestError";
  }
}

/** Error thrown when an ARM API response cannot be parsed/validated. */
export class ArmResponseParseError extends Error {
  constructor(
    public readonly method: string,
    public readonly path: string,
    public readonly statusCode: number,
    public readonly zodError: ZodError,
    public readonly rawBody: string,
  ) {
    super(
      `Failed to parse ARM API response for ${method} ${path} (HTTP ${statusCode}): ${zodError.message}`,
    );
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
  const rawBody = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new ArmResponseParseError(
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
    throw new ArmResponseParseError(
      method ?? response.url,
      path ?? "",
      response.status,
      result.error,
      rawBody,
    );
  }
  return result.data;
}

/** HTTP client for Azure Resource Manager using native fetch. */
export class ArmClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly credential: TokenCredential;
  private readonly maxRetries: number;
  private readonly _delayFn: (ms: number) => Promise<void>;
  private static readonly retryableStatusCodes = new Set([429, 503, 504]);
  private static readonly BASE_RETRY_DELAY_MS = 1000;

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
    let cleanUrl = baseUrl;
    while (cleanUrl.endsWith("/")) cleanUrl = cleanUrl.slice(0, -1);
    this.baseUrl = cleanUrl;
    this.credential =
      typeof credential === "string" ? { getToken: () => Promise.resolve(credential) } : credential;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this._delayFn = delayFn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
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

  private async performRequest(
    method: HttpMethod,
    path: string,
    extraHeaders: Record<string, string>,
    body: string | undefined,
    signal: AbortSignal,
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;

    const token = await this.credential.getToken(signal);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      // Node's undici fetch defaults Accept-Language to "*", which some
      // Azure Resource Manager endpoints reject as an invalid culture. Pin
      // an explicit, well-formed value. Callers may override via extraHeaders.
      "Accept-Language": "en",
      ...extraHeaders,
    };

    logger.debug("arm request", { method, url });

    const baseInit: RequestInit = { method, headers };
    if (body !== undefined) {
      baseInit.body = body;
    }

    let lastError: ArmRequestError | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (signal.aborted) throw signal.reason;

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
          throw new ArmRequestError(
            method,
            path,
            0,
            "TimeoutError",
            `ARM API request timed out after ${this.timeoutMs}ms`,
          );
        }
        throw err;
      }

      logger.debug("arm response", { method, url, status: response.status });

      if (response.status < 400) {
        return response;
      }

      const rawBody = await response.text();
      let code = "UnknownError";
      let message = rawBody;

      try {
        const envelope = JSON.parse(rawBody) as unknown;
        if (isArmErrorEnvelope(envelope)) {
          code = envelope.error.code;
          message = envelope.error.message;
        }
      } catch {
        // Use raw body text as message
      }

      const error = new ArmRequestError(method, path, response.status, code, message);

      if (attempt < this.maxRetries && ArmClient.retryableStatusCodes.has(response.status)) {
        let delayMs = 0;
        const retryAfter = response.headers.get("Retry-After");
        if (retryAfter) {
          const retryAfterSeconds = parseInt(retryAfter, 10);
          if (!isNaN(retryAfterSeconds)) {
            delayMs = retryAfterSeconds * 1000;
          } else {
            const retryDate = Date.parse(retryAfter);
            if (!isNaN(retryDate)) {
              delayMs = Math.max(0, retryDate - Date.now());
            }
          }
        }
        if (delayMs === 0) {
          delayMs = ArmClient.BASE_RETRY_DELAY_MS * Math.pow(2, attempt); // 1s, 2s, 4s
        }
        logger.info("arm retry", {
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
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    throw lastError!;
  }
}

function isArmErrorEnvelope(value: unknown): value is ArmErrorEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj["error"] !== "object" || obj["error"] === null) return false;
  const err = obj["error"] as Record<string, unknown>;
  return typeof err["code"] === "string" && typeof err["message"] === "string";
}
