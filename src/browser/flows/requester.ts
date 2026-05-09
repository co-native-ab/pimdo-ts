// `requesterFlow` — multi-row form for PIM "request activation".
//
// Each row carries the input the user can confirm/edit (id, label,
// subtitle, max duration, default duration, optional prefilled
// justification). The browser collects per-row justification + duration
// + include toggle and POSTs `{ csrfToken, rows: SubmittedRow[] }`.
// Validated rows are surfaced to the caller via `RequesterResult`.

import { z } from "zod";

import type { RowFormHandle } from "./row-form.js";
import { runRowForm } from "./row-form.js";
import { compareDurations, parseIsoDuration } from "../../duration.js";
import type { RequesterRowSpec } from "../../templates/requester.js";
import { requesterPageHtml } from "../../templates/requester.js";

export type { RequesterRowSpec };

/** A row the user confirmed for submission. */
export interface SubmittedRequesterRow {
  /** Echoes `RequesterRowSpec.id`. */
  id: string;
  justification: string;
  /** ISO-8601 duration (clamped client-side to `maxDuration`). */
  duration: string;
}

export interface RequesterResult {
  rows: SubmittedRequesterRow[];
}

const SubmittedRowSchema = z.object({
  id: z.string().min(1),
  justification: z.string().min(1),
  duration: z.string().min(1),
});

const RequesterSubmissionSchema = z.object({
  csrfToken: z.string(),
  rows: z.array(SubmittedRowSchema).min(1),
});

export interface RequesterConfig {
  rows: readonly RequesterRowSpec[];
  /** Override the default 5-minute timeout. */
  timeoutMs?: number;
}

/**
 * Start the requester flow. Returns the URL immediately and a promise
 * that resolves with the user-confirmed rows.
 *
 * Server-side defence-in-depth: even though the in-page JS clamps
 * each duration to the policy max and disables submit when an `id`
 * is invalid, we re-validate here so a CSRF-token holder (e.g. a
 * compromised browser extension) cannot smuggle in either an
 * unknown row id or a duration above the policy maximum.
 */
export function runRequesterFlow(
  config: RequesterConfig,
  signal: AbortSignal,
): Promise<RowFormHandle<RequesterResult>> {
  const specsById = new Map(config.rows.map((r) => [r.id, r]));
  return runRowForm(
    {
      name: "requester",
      timeoutMs: config.timeoutMs,
      renderHtml: (csrfToken, nonce) => requesterPageHtml({ csrfToken, nonce, rows: config.rows }),
      submitSchema: RequesterSubmissionSchema,
      onSubmit: (data): Promise<RequesterResult> => {
        for (const row of data.rows) {
          const spec = specsById.get(row.id);
          if (!spec) {
            throw new Error(`Unknown row id: ${row.id}`);
          }
          let requested;
          try {
            requested = parseIsoDuration(row.duration);
          } catch {
            throw new Error(`Invalid duration for row ${row.id}: ${row.duration}`);
          }
          const max = parseIsoDuration(spec.maxDuration);
          if (compareDurations(requested, max) > 0) {
            throw new Error(
              `Duration for row ${row.id} (${row.duration}) exceeds policy maximum (${spec.maxDuration})`,
            );
          }
        }
        return Promise.resolve({ rows: data.rows.map((r) => ({ ...r })) });
      },
    },
    signal,
  );
}
