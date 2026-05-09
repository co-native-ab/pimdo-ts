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

function renderRow(row: ConfirmerRowSpec, reasonLabel: string, index: number): string {
  const included = row.includedByDefault !== false;
  const reason = row.prefilledReason ?? "";
  const id = `confirmer-${String(index)}`;
  return `<div class="row" data-row-id="${escapeHtml(row.id)}">
        <div class="row-header">
          <div class="row-label">${escapeHtml(row.label)}</div>
          ${row.subtitle ? `<div class="row-subtitle">${escapeHtml(row.subtitle)}</div>` : ""}
        </div>
        <div class="row-controls">
          <label class="include-row">
            <input type="checkbox" class="include-toggle" ${included ? "checked" : ""}>
            <span>Include</span>
          </label>
          <div class="control-group">
            <label class="control-label" for="${id}-reason">${escapeHtml(reasonLabel)} <span class="control-hint">optional</span></label>
            <textarea id="${id}-reason" class="reason" rows="2">${escapeHtml(reason)}</textarea>
          </div>
        </div>
        <p class="row-error" hidden></p>
      </div>`;
}

export function confirmerPageHtml(config: ConfirmerPageConfig): string {
  const reasonLabel = config.reasonLabel ?? "Reason";
  const bulkToolbar = renderBulkToolbar(
    [
      { id: "include-all", label: "Include all" },
      { id: "include-none", label: "Include none" },
    ],
    "row-summary",
  );

  const formContent =
    config.rows.length > 0
      ? `<div class="row-section">
        ${bulkToolbar}
        <div class="row-list">${config.rows.map((r, i) => renderRow(r, reasonLabel, i)).join("\n      ")}</div>
      </div>`
      : `<div class="row-section"><p class="empty-state">No items to confirm.</p></div>`;

  const perFlowScript = `    function applyBulk(action) {
      var include = action === 'include-all';
      document.querySelectorAll('.row .include-toggle').forEach(function (cb) {
        cb.checked = include;
      });
      updateRowSummary();
    }

    function updateRowSummary() {
      var summaryEl = document.getElementById('row-summary');
      if (!summaryEl) return;
      var total = document.querySelectorAll('.row').length;
      var selected = document.querySelectorAll('.row .include-toggle:checked').length;
      summaryEl.textContent = selected + ' of ' + total + ' selected';
    }
    document.addEventListener('change', updateRowSummary);
    updateRowSummary();

    function isFormValid() {
      var toggles = document.querySelectorAll('.row .include-toggle');
      for (var i = 0; i < toggles.length; i++) {
        if (toggles[i].checked) return true;
      }
      return false;
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
    submitInitiallyDisabled: true,
  });
}
