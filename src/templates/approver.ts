// HTML template for the `approverFlow` page.

import { escapeHtml } from "./escape.js";
import { renderBulkToolbar, renderRowFormPage } from "./row-form.js";

/** A pending approval the reviewer can act on. */
export interface ApproverRowSpec {
  /** Approval ID (passed back unchanged). */
  id: string;
  /** Bold heading (e.g. group name). */
  label: string;
  /** Smaller line under the label. */
  subtitle?: string;
  /** Display name of the user requesting access. */
  requestor: string;
  /** Justification supplied by the requestor. */
  requestorJustification: string;
  /** Optional pre-selected decision. */
  prefilledDecision?: "Approve" | "Deny" | "Skip";
  /** Optional prefilled reviewer justification. */
  prefilledJustification?: string;
}

export interface ApproverPageConfig {
  csrfToken: string;
  nonce: string;
  rows: readonly ApproverRowSpec[];
}

function renderRow(row: ApproverRowSpec, index: number): string {
  const decision = row.prefilledDecision ?? "Skip";
  const justification = row.prefilledJustification ?? "";
  const id = `approver-${String(index)}`;

  const radio = (value: "Approve" | "Deny" | "Skip"): string =>
    `<label><input type="radio" name="${id}" value="${value}"${
      decision === value ? " checked" : ""
    }>${value}</label>`;

  return `<tr class="row" data-row-id="${escapeHtml(row.id)}" data-row-index="${String(index)}">
        <td class="cell-primary">
          <div class="row-label">${escapeHtml(row.label)}</div>
          ${row.subtitle ? `<div class="row-subtitle">${escapeHtml(row.subtitle)}</div>` : ""}
        </td>
        <td class="cell-meta">
          <span class="cell-meta-name">${escapeHtml(row.requestor)}</span>
          <span class="cell-quote">&ldquo;${escapeHtml(row.requestorJustification)}&rdquo;</span>
        </td>
        <td class="cell-decision">
          <div class="decision-group" role="radiogroup" aria-label="Decision">
            ${radio("Approve")}
            ${radio("Deny")}
            ${radio("Skip")}
          </div>
        </td>
        <td class="cell-input">
          <textarea id="${id}-justification" class="justification" rows="2" aria-label="Reviewer justification" placeholder="Required when approving or denying">${escapeHtml(justification)}</textarea>
          <p class="row-error" hidden></p>
        </td>
      </tr>`;
}

export function approverPageHtml(config: ApproverPageConfig): string {
  const bulkToolbar = renderBulkToolbar(
    [
      { id: "approve-all", label: "Approve all" },
      { id: "deny-all", label: "Deny all" },
      { id: "skip-all", label: "Skip all" },
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
              <th class="col-primary" scope="col">Group / role</th>
              <th class="col-meta" scope="col">Requestor</th>
              <th class="col-decision" scope="col">Decision</th>
              <th class="col-input" scope="col">Reviewer note</th>
            </tr>
          </thead>
          <tbody>${config.rows.map(renderRow).join("\n          ")}</tbody>
        </table>
      </div>`
      : `<p class="empty-state">// no pending approvals</p>`;

  const perFlowScript = `    function applyBulk(action) {
      var value = action === 'approve-all' ? 'Approve'
        : action === 'deny-all' ? 'Deny'
        : 'Skip';
      document.querySelectorAll('.row .decision-group input[type="radio"]').forEach(function (r) {
        if (r.value === value) r.checked = true;
      });
      document.querySelectorAll('.row').forEach(function (rowEl) {
        rowEl.classList.toggle('skipped', value === 'Skip');
      });
      updateRowSummary();
    }

    function updateRowSummary() {
      var summaryEl = document.getElementById('row-summary');
      if (!summaryEl) return;
      var rows = document.querySelectorAll('.row');
      var approve = 0, deny = 0, skip = 0;
      rows.forEach(function (r) {
        var checked = r.querySelector('.decision-group input[type="radio"]:checked');
        var v = checked ? checked.value : 'Skip';
        if (v === 'Approve') approve++;
        else if (v === 'Deny') deny++;
        else skip++;
      });
      summaryEl.textContent = approve + ' approve · ' + deny + ' deny · ' + skip + ' skip';
    }
    document.addEventListener('change', function (e) {
      if (e.target && e.target.matches && e.target.matches('.decision-group input[type="radio"]')) {
        var rowEl = e.target.closest('.row');
        if (rowEl) rowEl.classList.toggle('skipped', e.target.value === 'Skip');
      }
      updateRowSummary();
    });
    updateRowSummary();

    function isFormValid() {
      var actionable = 0;
      var rowEls = document.querySelectorAll('.row');
      for (var i = 0; i < rowEls.length; i++) {
        var rowEl = rowEls[i];
        var checked = rowEl.querySelector('.decision-group input[type="radio"]:checked');
        var decision = checked ? checked.value : 'Skip';
        if (decision === 'Skip') continue;
        actionable++;
        var justification = rowEl.querySelector('.justification').value.trim();
        if (!justification) return false;
      }
      return actionable > 0;
    }

    function buildPayload() {
      var rows = [];
      var rowEls = document.querySelectorAll('.row');
      rowEls.forEach(function (rowEl) {
        var checked = rowEl.querySelector('.decision-group input[type="radio"]:checked');
        var decision = checked ? checked.value : 'Skip';
        rowEl.classList.toggle('skipped', decision === 'Skip');
        if (decision === 'Skip') return;
        var id = rowEl.getAttribute('data-row-id');
        var justification = rowEl.querySelector('.justification').value.trim();
        if (!justification) {
          setRowError(rowEl, 'Justification is required when approving or denying.');
          throw new Error('One or more rows are missing required justification.');
        }
        rows.push({ id: id, decision: decision, justification: justification });
      });
      if (rows.length === 0) {
        throw new Error('Mark at least one row Approve or Deny.');
      }
      return { rows: rows };
    }`;

  return renderRowFormPage({
    title: "Review approvals",
    heading: "Review pending approvals",
    subtitle: "Approve or deny each pending request. Skip leaves an item untouched.",
    csrfToken: config.csrfToken,
    nonce: config.nonce,
    formContent,
    submitLabel: "Submit decisions",
    perFlowScript,
    submitInitiallyDisabled: true,
  });
}
