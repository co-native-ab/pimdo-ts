// HTML template for the `requesterFlow` page.
//
// Renders one row per requestable item with: an include checkbox,
// justification textarea (required when included), and a duration
// number input + unit selector bounded by the policy max-duration. A
// bulk toolbar toggles include-all / include-none.

import { escapeHtml } from "./escape.js";
import { renderBulkToolbar, renderRowFormPage } from "./row-form.js";
import { parseIsoDuration } from "../duration.js";

/** A row visible to the user inside the requester page. */
export interface RequesterRowSpec {
  /** Stable identifier passed back in the submission payload. */
  id: string;
  /** Bold heading (e.g. group name). */
  label: string;
  /** Smaller line under the label (e.g. group description / id). */
  subtitle?: string;
  /** ISO-8601 max duration the policy allows. Used to clamp the input. */
  maxDuration: string;
  /** ISO-8601 duration prefilled into the input. Defaults to {@link maxDuration}. */
  defaultDuration?: string;
  /** Optional prefilled justification. */
  prefilledJustification?: string;
  /** Defaults to true; bulk-toggled. */
  includedByDefault?: boolean;
}

export interface RequesterPageConfig {
  csrfToken: string;
  nonce: string;
  rows: readonly RequesterRowSpec[];
}

interface DurationParts {
  hours: number;
  minutes: number;
  totalMinutes: number;
}

function durationToParts(iso: string): DurationParts {
  const d = parseIsoDuration(iso);
  const days = d.days ?? 0;
  const hours = d.hours ?? 0;
  const minutes = d.minutes ?? 0;
  const totalMinutes = days * 24 * 60 + hours * 60 + minutes;
  // Display as hours when divisible cleanly, otherwise as minutes.
  if (totalMinutes % 60 === 0) {
    return { hours: totalMinutes / 60, minutes: 0, totalMinutes };
  }
  return { hours: 0, minutes: totalMinutes, totalMinutes };
}

function renderRow(row: RequesterRowSpec, index: number): string {
  const max = durationToParts(row.maxDuration);
  const defaultIso = row.defaultDuration ?? row.maxDuration;
  const defaultParts = durationToParts(defaultIso);
  const included = row.includedByDefault !== false;
  const justification = row.prefilledJustification ?? "";

  const useHours = defaultParts.hours > 0 || max.hours > 0;
  const initialUnit = useHours ? "H" : "M";
  const initialValue = useHours
    ? defaultParts.hours || Math.max(1, Math.round(defaultParts.totalMinutes / 60))
    : defaultParts.minutes || max.totalMinutes;
  const id = `requester-${String(index)}`;

  return `<tr class="row" data-row-id="${escapeHtml(row.id)}" data-max-minutes="${String(max.totalMinutes)}" data-row-index="${String(index)}">
        <td class="cell-include">
          <input type="checkbox" class="include-toggle" aria-label="Include" ${included ? "checked" : ""}>
        </td>
        <td class="cell-primary">
          <div class="row-label">${escapeHtml(row.label)}</div>
          ${row.subtitle ? `<div class="row-subtitle">${escapeHtml(row.subtitle)}</div>` : ""}
        </td>
        <td class="cell-input">
          <textarea id="${id}-justification" class="justification" rows="2" aria-label="Justification" placeholder="Why do you need this access?">${escapeHtml(justification)}</textarea>
        </td>
        <td class="cell-duration">
          <div class="duration-group">
            <input id="${id}-duration" type="number" class="duration-value" min="1" value="${String(initialValue)}" aria-label="Duration value">
            <select class="duration-unit" aria-label="Duration unit">
              <option value="H" ${initialUnit === "H" ? "selected" : ""}>Hours</option>
              <option value="M" ${initialUnit === "M" ? "selected" : ""}>Minutes</option>
            </select>
          </div>
          <span class="duration-max">max ${escapeHtml(formatHumanDuration(max))}</span>
          <p class="row-error" hidden></p>
        </td>
      </tr>`;
}

function formatHumanDuration(parts: DurationParts): string {
  if (parts.totalMinutes % 60 === 0 && parts.totalMinutes > 0) {
    return `${String(parts.totalMinutes / 60)} h`;
  }
  return `${String(parts.totalMinutes)} min`;
}

export function requesterPageHtml(config: RequesterPageConfig): string {
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
              <th class="col-input" scope="col">Justification</th>
              <th class="col-duration" scope="col">Duration</th>
            </tr>
          </thead>
          <tbody>${config.rows.map(renderRow).join("\n          ")}</tbody>
        </table>
      </div>`
      : `<p class="empty-state">// no items to request</p>`;

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
      var includedCount = 0;
      var rowEls = document.querySelectorAll('.row');
      for (var i = 0; i < rowEls.length; i++) {
        var rowEl = rowEls[i];
        if (!rowEl.querySelector('.include-toggle').checked) continue;
        includedCount++;
        var justification = rowEl.querySelector('.justification').value.trim();
        if (!justification) return false;
        var maxMinutes = parseInt(rowEl.getAttribute('data-max-minutes'), 10);
        var value = parseInt(rowEl.querySelector('.duration-value').value, 10);
        if (!Number.isFinite(value) || value <= 0) return false;
        var unit = rowEl.querySelector('.duration-unit').value;
        var minutes = unit === 'H' ? value * 60 : value;
        if (minutes > maxMinutes) return false;
      }
      return includedCount > 0;
    }

    function buildPayload() {
      var rows = [];
      var rowEls = document.querySelectorAll('.row');
      rowEls.forEach(function (rowEl) {
        var include = rowEl.querySelector('.include-toggle').checked;
        if (!include) return;
        var id = rowEl.getAttribute('data-row-id');
        var maxMinutes = parseInt(rowEl.getAttribute('data-max-minutes'), 10);
        var justification = rowEl.querySelector('.justification').value.trim();
        var value = parseInt(rowEl.querySelector('.duration-value').value, 10);
        var unit = rowEl.querySelector('.duration-unit').value;
        if (!justification) {
          setRowError(rowEl, 'Justification is required.');
          throw new Error('One or more rows are missing required fields.');
        }
        if (!Number.isFinite(value) || value <= 0) {
          setRowError(rowEl, 'Duration must be a positive number.');
          throw new Error('One or more rows have invalid durations.');
        }
        var minutes = unit === 'H' ? value * 60 : value;
        if (minutes > maxMinutes) {
          setRowError(rowEl, 'Duration exceeds policy maximum.');
          throw new Error('One or more rows exceed the policy maximum.');
        }
        rows.push({
          id: id,
          justification: justification,
          duration: unit === 'H' ? 'PT' + value + 'H' : 'PT' + value + 'M',
        });
      });
      if (rows.length === 0) {
        throw new Error('Select at least one item to submit.');
      }
      return { rows: rows };
    }`;

  return renderRowFormPage({
    title: "Request activation",
    heading: "Request activation",
    subtitle:
      "Confirm the items you want to activate, edit justification or duration, then submit.",
    csrfToken: config.csrfToken,
    nonce: config.nonce,
    formContent,
    submitLabel: "Submit requests",
    perFlowScript,
    submitInitiallyDisabled: true,
  });
}
