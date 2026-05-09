// `confirmerFlow` — multi-row confirmation form (used by deactivate).

import { z } from "zod";

import type { RowFormHandle } from "./row-form.js";
import { runRowForm } from "./row-form.js";
import type { ConfirmerRowSpec } from "../../templates/confirmer.js";
import { confirmerPageHtml } from "../../templates/confirmer.js";

export type { ConfirmerRowSpec };

export interface SubmittedConfirmation {
  id: string;
  /** May be empty if the user did not enter a reason. */
  reason: string;
}

export interface ConfirmerResult {
  rows: SubmittedConfirmation[];
}

const SubmittedConfirmationSchema = z.object({
  id: z.string().min(1),
  reason: z.string(),
});

const ConfirmerSubmissionSchema = z.object({
  csrfToken: z.string(),
  rows: z.array(SubmittedConfirmationSchema).min(1),
});

export interface ConfirmerConfig {
  heading: string;
  subtitle: string;
  submitLabel: string;
  reasonLabel?: string;
  rows: readonly ConfirmerRowSpec[];
  timeoutMs?: number;
}

export function runConfirmerFlow(
  config: ConfirmerConfig,
  signal: AbortSignal,
): Promise<RowFormHandle<ConfirmerResult>> {
  const allowedIds = new Set(config.rows.map((r) => r.id));
  return runRowForm(
    {
      name: "confirmer",
      timeoutMs: config.timeoutMs,
      renderHtml: (csrfToken, nonce) =>
        confirmerPageHtml({
          csrfToken,
          nonce,
          heading: config.heading,
          subtitle: config.subtitle,
          submitLabel: config.submitLabel,
          reasonLabel: config.reasonLabel,
          rows: config.rows,
        }),
      submitSchema: ConfirmerSubmissionSchema,
      onSubmit: (data): Promise<ConfirmerResult> => {
        // Defence-in-depth: a CSRF-token holder must not be able to
        // submit an id that was not in the rendered form.
        for (const row of data.rows) {
          if (!allowedIds.has(row.id)) {
            throw new Error(`Unknown row id: ${row.id}`);
          }
        }
        return Promise.resolve({ rows: data.rows.map((r) => ({ ...r })) });
      },
    },
    signal,
  );
}
