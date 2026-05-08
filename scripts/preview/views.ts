// Registry of browser views surfaced in the preview site. Each entry
// re-uses the production HTML template module — never reimplements it —
// so the preview is byte-identical to the live loopback page.
//
// View kinds:
//   - "static"   single state (e.g. login landing); declares its own scenarios.
//   - "row-form" requester / approver / confirmer; iterates the canonical
//                LIST_SCENARIOS matrix.

import { approverPageHtml } from "../../src/templates/approver.js";
import { confirmerPageHtml } from "../../src/templates/confirmer.js";
import { errorPageHtml, landingPageHtml, successPageHtml } from "../../src/templates/login.js";
import { logoutPageHtml } from "../../src/templates/logout.js";
import { requesterPageHtml } from "../../src/templates/requester.js";

import { FIXED_CSRF, FIXED_NONCE, ROW_FIXTURES } from "./fixtures/row-form/rows.js";
import type { ListScenarioId } from "./scenarios.js";
import { LIST_SCENARIO_IDS } from "./scenarios.js";

export interface ViewScenario {
  /** Scenario id used for filenames and the index. */
  id: string;
  /** Human-readable label shown in the index. */
  label: string;
  /** Pure renderer: scenario id → HTML string. */
  render(): string;
}

export interface ViewPreview {
  /** Stable identifier used as the directory name under docs/preview/views. */
  name: string;
  /** Surface family for the index sidebar. */
  family: "Auth" | "Group" | "Entra Role" | "Azure Role";
  /** Descriptive blurb shown in the index. */
  description: string;
  /** Whether this view follows the canonical 5-scenario list matrix. */
  kind: "static" | "row-form";
  scenarios: readonly ViewScenario[];
}

// ---------------------------------------------------------------------------
// Static views (login + logout state machine)
// ---------------------------------------------------------------------------

const LOGIN: ViewPreview = {
  name: "login",
  family: "Auth",
  description: "MSAL loopback landing / success / error pages.",
  kind: "static",
  scenarios: [
    {
      id: "landing",
      label: "Landing",
      render: () =>
        landingPageHtml("https://login.example/sign-in", {
          csrfToken: FIXED_CSRF,
          nonce: FIXED_NONCE,
        }),
    },
    { id: "success", label: "Success", render: () => successPageHtml(FIXED_NONCE) },
    {
      id: "error",
      label: "Error",
      render: () =>
        errorPageHtml(
          "AADSTS50059: No tenant-identifying information found in the request. Please try again.",
          FIXED_NONCE,
        ),
    },
  ],
};

const LOGOUT: ViewPreview = {
  name: "logout",
  family: "Auth",
  description: "Logout confirmation + signed-out state.",
  kind: "static",
  scenarios: [
    {
      id: "confirm",
      label: "Confirm",
      render: () => logoutPageHtml({ csrfToken: FIXED_CSRF, nonce: FIXED_NONCE }),
    },
    {
      id: "done",
      label: "Done",
      render: () =>
        logoutPageHtml({ csrfToken: FIXED_CSRF, nonce: FIXED_NONCE })
          .replace('id="confirm-view">', 'id="confirm-view" hidden>')
          .replace('id="done-view" hidden', 'id="done-view"'),
    },
  ],
};

// ---------------------------------------------------------------------------
// Row-form views — iterate the canonical scenario matrix
// ---------------------------------------------------------------------------

function rowFormScenarios(build: (scenario: ListScenarioId) => string): readonly ViewScenario[] {
  return LIST_SCENARIO_IDS.map((id) => ({
    id,
    label: id,
    render: () => build(id),
  }));
}

const REQUESTER: ViewPreview = {
  name: "requester",
  family: "Group",
  description: "Multi-row activation form. Each row is one requestable item.",
  kind: "row-form",
  scenarios: rowFormScenarios((scenario) =>
    requesterPageHtml({
      csrfToken: FIXED_CSRF,
      nonce: FIXED_NONCE,
      rows: ROW_FIXTURES[scenario].map((r) => ({
        id: r.id,
        label: r.label,
        subtitle: r.subtitle,
        maxDuration: "PT8H",
        defaultDuration: "PT4H",
        prefilledJustification: r.requestorJustification,
      })),
    }),
  ),
};

const APPROVER: ViewPreview = {
  name: "approver",
  family: "Group",
  description: "Reviewer flow. One row per pending approval.",
  kind: "row-form",
  scenarios: rowFormScenarios((scenario) =>
    approverPageHtml({
      csrfToken: FIXED_CSRF,
      nonce: FIXED_NONCE,
      rows: ROW_FIXTURES[scenario].map((r) => ({
        id: r.id,
        label: r.label,
        subtitle: r.subtitle,
        requestor: r.requestor ?? "Alice Example",
        requestorJustification:
          r.requestorJustification ?? "Need access to investigate ticket #1001.",
      })),
    }),
  ),
};

const CONFIRMER: ViewPreview = {
  name: "confirmer",
  family: "Group",
  description: "Confirmation flow used by deactivate. One row per item.",
  kind: "row-form",
  scenarios: rowFormScenarios((scenario) =>
    confirmerPageHtml({
      csrfToken: FIXED_CSRF,
      nonce: FIXED_NONCE,
      heading: "Deactivate assignments",
      subtitle: "Confirm which active assignments to deactivate.",
      submitLabel: "Deactivate selected",
      reasonLabel: "Reason",
      rows: ROW_FIXTURES[scenario].map((r) => ({
        id: r.id,
        label: r.label,
        subtitle: r.subtitle,
      })),
    }),
  ),
};

// ---------------------------------------------------------------------------

export const VIEW_PREVIEWS: readonly ViewPreview[] = [
  LOGIN,
  LOGOUT,
  REQUESTER,
  APPROVER,
  CONFIRMER,
];
