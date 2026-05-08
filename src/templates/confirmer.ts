// HTML template for the `confirmerFlow` page (used by deactivate).

import { escapeHtml } from "./escape.js";
import { renderBulkToolbar, renderRowFormPage } from "./row-form.js";

export interface ConfirmerRowSpec {
  /** Stable id passed back in the submission payload. */
  id: string;
  label: string;
  subtitle?: string;
  /** Optional prefilled reason. */
  prefilledReason?: string;
  /** Defaults to true; bulk-toggled. */
  includedByDefault?: boolean;
}

export interface ConfirmerPageConfig {
  csrfToken: string;
  nonce: string;
  /** Heading shown on the page. Lets callers reuse the flow for different actions. */
  heading: string;
  subtitle: string;
  /** Submit button label. */
  submitLabel: string;
  /** Label for the per-row reason textarea. */
  reasonLabel?: string;
  rows: readonly ConfirmerRowSpec[];
}

function renderRow(row: ConfirmerRowSpec, reasonLabel: string): string {
  const included = row.includedByDefault !== false;
  const reason = row.prefilledReason ?? "";
  return `<div class="row" data-row-id="${escapeHtml(row.id)}">
        <div class="row-header">
          <div>
            <div class="row-label">${escapeHtml(row.label)}</div>
            ${row.subtitle ? `<div class="row-subtitle">${escapeHtml(row.subtitle)}</div>` : ""}
          </div>
          <label class="row-meta">
            <input type="checkbox" class="include-toggle" ${included ? "checked" : ""}>
            Include
          </label>
        </div>
        <div class="row-controls">
          <div>
            <label>${escapeHtml(reasonLabel)} (optional)</label>
            <textarea class="reason" rows="2"></textarea>
          </div>
        </div>
        <p class="row-error" hidden></p>
      </div>`.replace(
    `<textarea class="reason" rows="2"></textarea>`,
    `<textarea class="reason" rows="2">${escapeHtml(reason)}</textarea>`,
  );
}

export function confirmerPageHtml(config: ConfirmerPageConfig): string {
  const reasonLabel = config.reasonLabel ?? "Reason";
  const rowsHtml =
    config.rows.length > 0
      ? `<div class="row-list">${config.rows.map((r) => renderRow(r, reasonLabel)).join("\n      ")}</div>`
      : `<p class="empty-state">No items to confirm.</p>`;

  const bulkToolbar = renderBulkToolbar([
    { id: "include-all", label: "Include all" },
    { id: "include-none", label: "Include none" },
  ]);

  const formContent = `${bulkToolbar}
      ${rowsHtml}`;

  const perFlowScript = `    function applyBulk(action) {
      var include = action === 'include-all';
      document.querySelectorAll('.row .include-toggle').forEach(function (cb) {
        cb.checked = include;
      });
    }

    function buildPayload() {
      var rows = [];
      document.querySelectorAll('.row').forEach(function (rowEl) {
        if (!rowEl.querySelector('.include-toggle').checked) return;
        rows.push({
          id: rowEl.getAttribute('data-row-id'),
          reason: rowEl.querySelector('.reason').value.trim(),
        });
      });
      if (rows.length === 0) {
        throw new Error('Select at least one item to submit.');
      }
      return { rows: rows };
    }`;

  return renderRowFormPage({
    title: config.heading,
    heading: config.heading,
    subtitle: config.subtitle,
    csrfToken: config.csrfToken,
    nonce: config.nonce,
    formContent,
    submitLabel: config.submitLabel,
    perFlowScript,
  });
}
