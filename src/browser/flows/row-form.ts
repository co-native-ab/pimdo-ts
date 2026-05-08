// Shared `runRowForm` helper for the requester / approver / confirmer
// flows.
//
// Each row-form flow renders an HTML page with a CSRF-protected
// `POST /submit` handler. This module owns the route table, schema
// validation, and lifecycle wiring on top of `runBrowserFlow`. The
// per-flow code only has to provide:
//
//   - `name`        — short label for logs
//   - `renderHtml`  — `(csrfToken, nonce) => string`
//   - `submitSchema` — zod schema applied to the parsed JSON body
//   - `onSubmit`    — async callback that produces the flow's `Result`
//                     from the validated payload (or throws to surface
//                     an error to the browser).

import { z } from "zod";

import { UserCancelledError } from "../../errors.js";
import type { BrowserFlow, FlowContext, RouteTable } from "../server.js";
import { readJsonWithCsrf, respondAndClose, runBrowserFlow } from "../server.js";

/**
 * Descriptor for a row-form flow.
 *
 * `Submission` is the validated POST body (after CSRF + schema check)
 * and `Result` is whatever the caller wants resolved by the flow's
 * outer `Promise`.
 */
export interface RowFormDescriptor<Submission, Result> {
  /** Short label used in logs and timeout messages. */
  readonly name: string;
  /** Per-flow timeout. Defaults to 5 minutes (longer than the picker). */
  readonly timeoutMs?: number;
  /** Render the HTML page. Receives the CSRF token + per-request CSP nonce. */
  readonly renderHtml: (csrfToken: string, nonce: string) => string;
  /** Zod schema applied to the parsed POST body. Must include a `csrfToken` field. */
  readonly submitSchema: z.ZodType<Submission>;
  /**
   * Called once the schema passes. Throw to surface an error in the browser
   * (the user can re-submit). Return the flow `Result` to resolve.
   */
  readonly onSubmit: (data: Submission, signal: AbortSignal) => Promise<Result>;
}

export interface RowFormHandle<Result> {
  /** URL the loopback page is served from. Pass to `openBrowser`. */
  readonly url: string;
  /** Resolves with the `onSubmit` result, or rejects on cancel/timeout/abort. */
  readonly result: Promise<Result>;
}

/** Default timeout for row-form flows (5 minutes — longer than picker's 2). */
const DEFAULT_ROW_FORM_TIMEOUT_MS = 5 * 60 * 1000;

const CancelSchema = z.object({ csrfToken: z.string() });

/** Build a `BrowserFlow<Result>` from a row-form descriptor. */
export function rowFormFlow<Submission, Result>(
  descriptor: RowFormDescriptor<Submission, Result>,
  signal: AbortSignal,
): BrowserFlow<Result> {
  return {
    name: descriptor.name,
    timeoutMs: descriptor.timeoutMs ?? DEFAULT_ROW_FORM_TIMEOUT_MS,
    routes: (ctx: FlowContext<Result>): RouteTable => ({
      "GET /": (_req, res, nonce) => {
        const html = descriptor.renderHtml(ctx.csrfToken, nonce);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      },

      "POST /submit": (req, res) => {
        readJsonWithCsrf(req, res, ctx, descriptor.submitSchema, async (data) => {
          const result = await descriptor.onSubmit(data, signal);
          respondAndClose(res, ctx.server, { ok: true });
          ctx.resolve(result);
        });
      },

      "POST /cancel": (req, res) => {
        readJsonWithCsrf(req, res, ctx, CancelSchema, () => {
          respondAndClose(res, ctx.server, { ok: true });
          ctx.reject(new UserCancelledError(`${descriptor.name} cancelled by user`));
        });
      },
    }),
  };
}

/**
 * Run a row-form flow and surface the URL plus the eventual `Result`.
 */
export async function runRowForm<Submission, Result>(
  descriptor: RowFormDescriptor<Submission, Result>,
  signal: AbortSignal,
): Promise<RowFormHandle<Result>> {
  const handle = await runBrowserFlow(rowFormFlow(descriptor, signal), signal);
  return { url: handle.url, result: handle.result };
}

/** Re-export for tests / per-flow modules that need it. */
export { UserCancelledError };
