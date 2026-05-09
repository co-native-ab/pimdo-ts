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
  return `<tr class="row" data-row-id="${escapeHtml(row.id)}">
        <td class="cell-include">
          <input type="checkbox" class="include-toggle" aria-label="Include" ${included ? "checked" : ""}>
        </td>
        <td class="cell-primary">
          <div class="row-label">${escapeHtml(row.label)}</div>
          ${row.subtitle ? `<div class="row-subtitle">${escapeHtml(row.subtitle)}</div>` : ""}
        </td>
        <td class="cell-input">
          <textarea id="${id}-reason" class="reason" rows="2" aria-label="${escapeHtml(reasonLabel)}" placeholder="Optional ${escapeHtml(reasonLabel.toLowerCase())}">${escapeHtml(reason)}</textarea>
          <p class="row-error" hidden></p>
        </td>
      </tr>`;
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
      ? `${bulkToolbar}
      <div class="row-table-wrap">
        <table class="row-table">
          <thead>
            <tr>
              <th class="col-include" scope="col" aria-label="Include"></th>
              <th class="col-primary" scope="col">Group / role</th>
              <th class="col-input" scope="col">${escapeHtml(reasonLabel)} <span class="cell-num">(optional)</span></th>
            </tr>
          </thead>
          <tbody>${config.rows.map((r, i) => renderRow(r, reasonLabel, i)).join("\n          ")}</tbody>
        </table>
      </div>`
      : `<p class="empty-state">// no items to confirm</p>`;

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
