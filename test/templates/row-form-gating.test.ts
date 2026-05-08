// Verifies that the row-form templates client-side-gate the submit
// button so it cannot be pressed before required fields are filled in.
//
// The runtime gating runs in the browser; here we assert the rendered
// HTML/JS so the contract is locked in:
//
//   - the submit button is rendered with the `disabled` attribute on
//     initial paint (so there's no flash-of-enabled state), and
//   - each per-flow script defines an `isFormValid()` predicate, which
//     `commonRowFormScript` calls to toggle `submitBtn.disabled`.

import { describe, it, expect } from "vitest";

import { requesterPageHtml } from "../../src/templates/requester.js";
import { approverPageHtml } from "../../src/templates/approver.js";
import { confirmerPageHtml } from "../../src/templates/confirmer.js";

const csrfToken = "csrf-test";
const nonce = "nonce-test";

function expectGated(html: string): void {
  expect(html).toMatch(/id="submit-btn"[^>]*\sdisabled(\s|>)/);
  expect(html).toContain("function isFormValid()");
  expect(html).toContain("refreshSubmitState");
}

describe("row-form submit gating", () => {
  it("requester renders submit disabled and ships isFormValid", () => {
    const html = requesterPageHtml({
      csrfToken,
      nonce,
      rows: [
        { id: "a", label: "Group A", maxDuration: "PT8H" },
        { id: "b", label: "Group B", maxDuration: "PT1H" },
      ],
    });
    expectGated(html);
    // Required-field guard wording is exposed so the reviewer can grep
    // for the contract.
    expect(html).toContain(".justification");
    expect(html).toContain("data-max-minutes");
  });

  it("approver renders submit disabled and ships isFormValid", () => {
    const html = approverPageHtml({
      csrfToken,
      nonce,
      rows: [
        {
          id: "ap-1",
          label: "Role A",
          requestor: "Alice",
          requestorJustification: "On-call",
        },
      ],
    });
    expectGated(html);
    // Approver gating is decision-aware: only Approve/Deny rows count.
    expect(html).toContain("decision-group");
  });

  it("confirmer renders submit disabled and ships isFormValid", () => {
    const html = confirmerPageHtml({
      csrfToken,
      nonce,
      heading: "Deactivate",
      subtitle: "Confirm which to deactivate.",
      submitLabel: "Deactivate",
      rows: [{ id: "c-1", label: "Group A" }],
    });
    expectGated(html);
    // Confirmer keeps reason optional, so gating is only "≥1 included".
    expect(html).toContain("include-toggle");
  });
});
