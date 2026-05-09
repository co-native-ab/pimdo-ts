// Shared HTML/CSS/JS helpers for the multi-row form pages used by
// `requesterFlow`, `approverFlow`, and `confirmerFlow`.
//
// Each flow has its own per-row controls and bulk actions, so the
// HTML for the rows section and the JS that builds the submit payload
// are flow-specific. This module provides:
//
//   - `renderRowFormPage` — wraps a flow-supplied `formContent` and
//     `script` in the standard layout shell + ROW_FORM_STYLE + a small
//     "done" card and CSRF/POST plumbing snippet.
//   - `renderBulkToolbar` — common bulk-action button row.
//   - `commonRowFormScript` — JS that handles submit, cancel, and the
//     done-card countdown. Each flow appends its own `buildPayload()`
//     and `applyBulk(actionId)` functions before this snippet.

import { ROW_FORM_STYLE } from "./styles.js";
import { escapeHtml } from "./escape.js";
import { logoDarkDataUri, logoLightDataUri } from "./icons.js";
import { layoutHtml } from "./layout.js";

export interface BulkAction {
  id: string;
  label: string;
}

export function renderBulkToolbar(actions: readonly BulkAction[], summaryId?: string): string {
  if (actions.length === 0) return "";
  const buttons = actions
    .map(
      (a) =>
        `<button type="button" class="bulk-btn" data-bulk="${escapeHtml(a.id)}">${escapeHtml(a.label)}</button>`,
    )
    .join("");
  const summary = summaryId
    ? `<span class="row-summary" id="${escapeHtml(summaryId)}" aria-live="polite"></span>`
    : "";
  return `<div class="bulk-toolbar"><span class="bulk-toolbar-label">Bulk</span>${buttons}${summary}</div>`;
}

export interface RowFormPageConfig {
  /** Used in the document `<title>`. */
  title: string;
  /** Heading text inside the card. */
  heading: string;
  subtitle: string;
  csrfToken: string;
  nonce: string;
  /** Pre-rendered HTML for the rows + bulk toolbar + any flow-specific UI. */
  formContent: string;
  /** Submit button label, e.g. "Submit requests". */
  submitLabel: string;
  /**
   * Per-flow JS. Must define `function buildPayload()` and may define
   * `function applyBulk(actionId)`. May also define
   * `function isFormValid()` returning a boolean — when present, the
   * submit button starts disabled and is re-enabled live as the form
   * becomes valid (and back to disabled if the user invalidates it).
   */
  perFlowScript: string;
  /**
   * When true, render the submit button initially disabled. Set this
   * for flows whose `perFlowScript` defines `isFormValid()`, so there
   * is no flash-of-enabled state before the page script runs.
   */
  submitInitiallyDisabled?: boolean;
}

/**
 * Render the full HTML page for a row-form flow. The flow supplies the
 * inner form content (rows + bulk toolbar) and a JS snippet defining
 * `buildPayload()` and optionally `applyBulk(actionId)`. This helper
 * wires up CSRF, POST `/submit`, POST `/cancel`, and the success page.
 */
export function renderRowFormPage(config: RowFormPageConfig): string {
  return layoutHtml({
    title: `pimdo - ${escapeHtml(config.title)}`,
    extraStyles: ROW_FORM_STYLE,
    nonce: config.nonce,
    extraHead: `<meta name="csrf-token" content="${escapeHtml(config.csrfToken)}">`,
    body: `<div class="container">
    <div class="card" id="form-card">
      <h1>${escapeHtml(config.heading)}</h1>
      <p class="subtitle">${escapeHtml(config.subtitle)}</p>
      ${config.formContent}
      <div class="form-actions">
        <button type="button" id="cancel-btn" class="cancel-btn">Cancel</button>
        <button type="button" id="submit-btn" class="submit-btn"${config.submitInitiallyDisabled ? " disabled" : ""}>${escapeHtml(config.submitLabel)}</button>
      </div>
      <p id="error-banner" class="error-banner" hidden></p>
    </div>
    <div class="card done" id="done-card" hidden>
      <h1>&#10003; Done</h1>
      <p class="message">You can switch back to your AI assistant now.</p>
      <p class="countdown">Closing in <span id="countdown">5</span>s&hellip;</p>
      <p id="manual-close" hidden>If this window didn&rsquo;t close automatically, please close it manually.</p>
    </div>
    <picture>
      <source srcset="${logoLightDataUri}" media="(prefers-color-scheme: dark)">
      <img src="${logoDarkDataUri}" alt="pimdo" class="brand-footer">
    </picture>
  </div>`,
    script: `${config.perFlowScript}
${commonRowFormScript()}`,
  });
}

/** Common submit / cancel / done-card JS shared by all row-form flows. */
function commonRowFormScript(): string {
  return `    const csrfMeta = document.querySelector('meta[name="csrf-token"]');
    const csrfToken = csrfMeta ? csrfMeta.getAttribute('content') : '';
    const submitBtn = document.getElementById('submit-btn');
    const cancelBtn = document.getElementById('cancel-btn');
    const errorBanner = document.getElementById('error-banner');
    const formCard = document.getElementById('form-card');
    const doneCard = document.getElementById('done-card');

    function showError(msg) {
      errorBanner.hidden = false;
      errorBanner.textContent = msg;
    }

    function clearError() {
      errorBanner.hidden = true;
      errorBanner.textContent = '';
    }

    function clearRowErrors() {
      document.querySelectorAll('.row-error').forEach(function (el) {
        el.hidden = true;
        el.textContent = '';
      });
    }

    function setRowError(rowEl, msg) {
      var err = rowEl.querySelector('.row-error');
      if (!err) {
        err = document.createElement('p');
        err.className = 'row-error';
        rowEl.appendChild(err);
      }
      err.hidden = false;
      err.textContent = msg;
    }

    function showDoneCard() {
      formCard.hidden = true;
      doneCard.hidden = false;
      var remaining = 5;
      var el = document.getElementById('countdown');
      var tick = setInterval(function () {
        remaining--;
        el.textContent = String(remaining);
        if (remaining <= 0) {
          clearInterval(tick);
          window.close();
          setTimeout(function () {
            document.getElementById('countdown').parentElement.hidden = true;
            document.getElementById('manual-close').hidden = false;
          }, 500);
        }
      }, 1000);
    }

    function refreshSubmitState() {
      if (typeof isFormValid !== 'function') return;
      var ok = false;
      try {
        ok = !!isFormValid();
      } catch (_e) {
        ok = false;
      }
      submitBtn.disabled = !ok;
      if (ok) {
        submitBtn.removeAttribute('aria-disabled');
        submitBtn.removeAttribute('title');
      } else {
        submitBtn.setAttribute('aria-disabled', 'true');
        submitBtn.title = 'Fill in the required fields for every selected row to continue.';
      }
    }

    document.querySelectorAll('[data-bulk]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (typeof applyBulk === 'function') {
          applyBulk(btn.getAttribute('data-bulk'));
        }
        refreshSubmitState();
      });
    });

    if (formCard) {
      formCard.addEventListener('input', refreshSubmitState);
      formCard.addEventListener('change', refreshSubmitState);
    }
    refreshSubmitState();

    submitBtn.addEventListener('click', async function () {
      clearError();
      clearRowErrors();
      var payload;
      try {
        payload = buildPayload();
      } catch (err) {
        showError(err && err.message ? err.message : 'Form validation failed');
        return;
      }
      submitBtn.disabled = true;
      cancelBtn.disabled = true;
      try {
        var body = Object.assign({ csrfToken: csrfToken }, payload);
        var res = await fetch('/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(await res.text());
        showDoneCard();
      } catch (err) {
        submitBtn.disabled = false;
        cancelBtn.disabled = false;
        showError('Submit failed: ' + (err && err.message ? err.message : 'unknown error'));
      }
    });

    cancelBtn.addEventListener('click', async function () {
      cancelBtn.disabled = true;
      submitBtn.disabled = true;
      await fetch('/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csrfToken: csrfToken }),
      }).catch(function () {});
      window.close();
    });`;
}
