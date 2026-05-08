// Deterministic row fixtures shared across requester / approver /
// confirmer flows. The same rows feed all three flows so the preview
// reads as a coherent story across surfaces.

import type { ListScenarioId } from "../scenarios.js";

export interface PreviewRow {
  id: string;
  label: string;
  subtitle?: string;
  /** Display name used by the approver flow. */
  requestor?: string;
  /** Justification used by the approver flow. */
  requestorJustification?: string;
}

const FIXED_GROUP_ID_PREFIX = "00000000-0000-0000-0000-00000000000";

function row(n: number): PreviewRow {
  return {
    id: `${FIXED_GROUP_ID_PREFIX}${String(n)}`,
    label: `Sample Group ${String(n)}`,
    subtitle: `Eligible member — ${FIXED_GROUP_ID_PREFIX}${String(n)}`,
    requestor: `Alice Example`,
    requestorJustification: `Need access to investigate ticket #100${String(n)}.`,
  };
}

const FULL: PreviewRow[] = [row(1), row(2), row(3), row(4), row(5)];

/**
 * Rows for each scenario id. `next-page` mirrors `full` in count but
 * uses a distinct labelling so the index can show "what page 2 would
 * look like". Browser flows can't render a `0-row` page (the loopback
 * server requires at least one row) — for `empty` we still emit a
 * single illustrative row so the HTML is valid; the index labels the
 * scenario clearly.
 */
export const ROW_FIXTURES: Record<ListScenarioId, readonly PreviewRow[]> = {
  empty: [row(0)],
  single: [row(1)],
  pair: [row(1), row(2)],
  full: FULL,
  "next-page": [row(6), row(7), row(8), row(9), row(10)],
};

/** Fixed CSP nonce + CSRF token used everywhere so HTML is byte-stable. */
export const FIXED_NONCE = "preview-nonce-0000";
export const FIXED_CSRF = "preview-csrf-0000";
