// `approverFlow` — multi-row form for reviewing PIM approval requests.

import { z } from "zod";

import type { RowFormHandle } from "./row-form.js";
import { runRowForm } from "./row-form.js";
import type { ApproverRowSpec } from "../../templates/approver.js";
import { approverPageHtml } from "../../templates/approver.js";

export type { ApproverRowSpec };

/** A row the reviewer chose to act on (Skip is never submitted). */
export interface SubmittedDecision {
  /** Echoes `ApproverRowSpec.id`. */
  id: string;
  decision: "Approve" | "Deny";
  justification: string;
}

export interface ApproverResult {
  rows: SubmittedDecision[];
}

const SubmittedDecisionSchema = z.object({
  id: z.string().min(1),
  decision: z.enum(["Approve", "Deny"]),
  justification: z.string().min(1),
});

const ApproverSubmissionSchema = z.object({
  csrfToken: z.string(),
  rows: z.array(SubmittedDecisionSchema).min(1),
});

export interface ApproverConfig {
  rows: readonly ApproverRowSpec[];
  timeoutMs?: number;
}

export function runApproverFlow(
  config: ApproverConfig,
  signal: AbortSignal,
): Promise<RowFormHandle<ApproverResult>> {
  return runRowForm(
    {
      name: "approver",
      timeoutMs: config.timeoutMs,
      renderHtml: (csrfToken, nonce) => approverPageHtml({ csrfToken, nonce, rows: config.rows }),
      submitSchema: ApproverSubmissionSchema,
      onSubmit: (data): Promise<ApproverResult> =>
        Promise.resolve({ rows: data.rows.map((r) => ({ ...r })) }),
    },
    signal,
  );
}
