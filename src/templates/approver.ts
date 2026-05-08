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
    `<label><input type="radio" name="${id}" value="${value}" ${
      decision === value ? "checked" : ""
    }>${value}</label>`;

  return `<div class="row" data-row-id="${escapeHtml(row.id)}" data-row-index="${String(index)}">
        <div class="row-header">
          <div>
            <div class="row-label">${escapeHtml(row.label)}</div>
            ${row.subtitle ? `<div class="row-subtitle">${escapeHtml(row.subtitle)}</div>` : ""}
            <div class="row-meta">Requestor: <strong>${escapeHtml(row.requestor)}</strong></div>
            <div class="row-meta">Their justification: ${escapeHtml(row.requestorJustification)}</div>
          </div>
        </div>
        <div class="row-controls">
          <div>
            <label>Decision</label>
            <div class="decision-group">
              ${radio("Approve")}
              ${radio("Deny")}
              ${radio("Skip")}
            </div>
          </div>
          <div>
            <label>Reviewer justification</label>
            <textarea class="justification" rows="2" placeholder="Required when approving or denying.">${escapeHtml(justification)}</textarea>
          </div>
        </div>
        <p class="row-error" hidden></p>
      </div>`;
}

export function approverPageHtml(config: ApproverPageConfig): string {
  const rowsHtml =
    config.rows.length > 0
      ? `<div class="row-list">${config.rows.map(renderRow).join("\n      ")}</div>`
      : `<p class="empty-state">No pending approvals.</p>`;

  const bulkToolbar = renderBulkToolbar([
    { id: "approve-all", label: "Approve all" },
    { id: "deny-all", label: "Deny all" },
    { id: "skip-all", label: "Skip all" },
  ]);

  const formContent = `${bulkToolbar}
      ${rowsHtml}`;

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
  });
}
