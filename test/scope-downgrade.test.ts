// Per-tool single-variant policy coverage (ADR-0017).
//
// pimdo intentionally requests a single Read/ReadWrite variant per scope
// family — `Read` for call sites that never mutate (eligibility lists,
// policy reads) and `ReadWrite` for call sites that do (assignment
// schedules, approvals). A tenant that consent-downgrades a requested
// `ReadWrite` scope to its `Read` variant therefore loses access to
// every tool that depends on that `ReadWrite` scope; pimdo does NOT
// silently fall back to the `Read` variant.
//
// These tests pin that contract so a future "be tolerant" refactor
// can't quietly re-introduce the over-permissive alternatives.

import { describe, expect, it } from "vitest";

import { MissingScopeError } from "../src/errors.js";
import {
  LIST_ELIGIBLE_ROLE_ENTRA_SCOPES,
  ROLE_ENTRA_SCHEDULE_REQUEST_SCOPES,
} from "../src/features/role-entra/client.js";
import { GET_DIRECTORY_ROLE_MAX_DURATION_SCOPES } from "../src/graph/policies.js";
import { GET_MY_OBJECT_ID_SCOPES } from "../src/graph/me.js";
import type { TokenCredential } from "../src/http/base-client.js";
import { OAuthScope } from "../src/scopes.js";
import { assertScopes, deriveRequiredScopes } from "../src/scopes-runtime.js";

function credWith(scopes: OAuthScope[]): TokenCredential {
  return {
    getToken: () => Promise.resolve("test-token"),
    grantedScopes: () => Promise.resolve(scopes),
  };
}

describe("pim_role_entra_request single-variant policy", () => {
  // The four call sites the tool exercises, mirrored from
  // src/features/role-entra/tools/pim-role-entra-request.ts.
  const TOOL_CALL_SITES = [
    LIST_ELIGIBLE_ROLE_ENTRA_SCOPES,
    GET_DIRECTORY_ROLE_MAX_DURATION_SCOPES,
    GET_MY_OBJECT_ID_SCOPES,
    ROLE_ENTRA_SCHEDULE_REQUEST_SCOPES,
  ];

  // Scope set seen on a tenant that consent-downgrades the requested
  // `RoleAssignmentSchedule.ReadWrite.Directory` scope to its Read
  // variant. The eligibility scope is already the `Read` variant by
  // design (we never request the ReadWrite variant) so it is not
  // downgraded.
  const DOWNGRADED_SCOPES: OAuthScope[] = [
    OAuthScope.UserRead,
    OAuthScope.OfflineAccess,
    OAuthScope.RoleEligibilityScheduleReadDirectory,
    // RoleAssignmentSchedule.ReadWrite.Directory was downgraded — only the
    // Read variant ends up in the token, and pimdo no longer accepts it
    // as a fallback for the activation POST.
    OAuthScope.RoleManagementPolicyReadDirectory,
  ];

  it("derived requiredScopes have no Read-only fallback for the assignment scope", () => {
    const required = deriveRequiredScopes(TOOL_CALL_SITES);
    // Every alternative must include the ReadWrite assignment scope —
    // there is no Read-only escape hatch.
    const everyAltRequiresReadWrite = required.every((alt) =>
      alt.includes(OAuthScope.RoleAssignmentScheduleReadWriteDirectory),
    );
    expect(everyAltRequiresReadWrite).toBe(true);
  });

  it("downgraded tenant: tool is hidden because no alternative is satisfied", () => {
    const required = deriveRequiredScopes(TOOL_CALL_SITES);
    const granted = new Set(DOWNGRADED_SCOPES);
    const enabled = required.some((alt) => alt.every((s) => granted.has(s)));
    expect(enabled).toBe(false);
  });

  it("requestRoleEntraActivation rejects with MissingScopeError on a downgraded tenant", async () => {
    const cred = credWith(DOWNGRADED_SCOPES);
    await expect(
      assertScopes(cred, ROLE_ENTRA_SCHEDULE_REQUEST_SCOPES, AbortSignal.timeout(1000)),
    ).rejects.toBeInstanceOf(MissingScopeError);
  });

  it("non-downgraded tenant: tool is enabled when ReadWrite is granted", () => {
    const required = deriveRequiredScopes(TOOL_CALL_SITES);
    const granted = new Set<OAuthScope>([
      OAuthScope.UserRead,
      OAuthScope.OfflineAccess,
      OAuthScope.RoleEligibilityScheduleReadDirectory,
      OAuthScope.RoleAssignmentScheduleReadWriteDirectory,
      OAuthScope.RoleManagementPolicyReadDirectory,
    ]);
    const enabled = required.some((alt) => alt.every((s) => granted.has(s)));
    expect(enabled).toBe(true);
  });
});
