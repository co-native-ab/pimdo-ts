// Per-tool downgrade-path coverage.
//
// These tests assert two related properties of the scope-validation
// pipeline introduced for the per-call-site `requiredScopes` work:
//
//   1. A tool whose underlying call sites accept a downgraded
//      `Read.X` scope keeps its tool-registry visibility (i.e. its
//      auto-derived `requiredScopes` DNF includes a Read-only
//      alternative) — this is the regression test for the
//      `pim_role_entra_request` bug where the tool was hidden in
//      tenants that consent-downgraded `RoleEligibilitySchedule.ReadWrite`
//      to `.Read`.
//
//   2. `assertScopes` enforces the per-call-site DNF at runtime: a
//      missing scope produces a typed `MissingScopeError` (NOT an
//      `AuthenticationRequiredError`, which would trigger the
//      auto-relogin code path and silently re-fail).

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

describe("pim_role_entra_request consent-downgrade regression", () => {
  // The four call sites the tool exercises, mirrored from
  // src/features/role-entra/tools/pim-role-entra-request.ts.
  const TOOL_CALL_SITES = [
    LIST_ELIGIBLE_ROLE_ENTRA_SCOPES,
    GET_DIRECTORY_ROLE_MAX_DURATION_SCOPES,
    GET_MY_OBJECT_ID_SCOPES,
    ROLE_ENTRA_SCHEDULE_REQUEST_SCOPES,
  ];

  // Scope set seen on tenants that consent-downgrade
  // `RoleEligibilitySchedule.ReadWrite.Directory` to its Read variant.
  const DOWNGRADED_SCOPES: OAuthScope[] = [
    OAuthScope.UserRead,
    OAuthScope.OfflineAccess,
    OAuthScope.RoleEligibilityScheduleReadDirectory, // downgraded
    OAuthScope.RoleAssignmentScheduleReadWriteDirectory,
    OAuthScope.RoleManagementPolicyReadDirectory,
  ];

  it("derived requiredScopes contain a Read-only alternative", () => {
    const required = deriveRequiredScopes(TOOL_CALL_SITES);
    // At least one alternative must NOT include the ReadWrite eligibility scope.
    const hasReadOnlyAlt = required.some(
      (alt) => !alt.includes(OAuthScope.RoleEligibilityScheduleReadWriteDirectory),
    );
    expect(hasReadOnlyAlt).toBe(true);
  });

  it("downgraded scopes satisfy at least one alternative (tool stays enabled)", () => {
    const required = deriveRequiredScopes(TOOL_CALL_SITES);
    const granted = new Set(DOWNGRADED_SCOPES);
    const enabled = required.some((alt) => alt.every((s) => granted.has(s)));
    expect(enabled).toBe(true);
  });

  it("removing the eligibility scope entirely disables the tool", () => {
    const required = deriveRequiredScopes(TOOL_CALL_SITES);
    const stripped = DOWNGRADED_SCOPES.filter(
      (s) =>
        s !== OAuthScope.RoleEligibilityScheduleReadDirectory &&
        s !== OAuthScope.RoleEligibilityScheduleReadWriteDirectory,
    );
    const granted = new Set<OAuthScope>(stripped);
    const enabled = required.some((alt) => alt.every((s) => granted.has(s)));
    expect(enabled).toBe(false);
  });

  it("listEligible call site accepts the downgraded Read variant at runtime", async () => {
    const cred = credWith([OAuthScope.RoleEligibilityScheduleReadDirectory]);
    await expect(
      assertScopes(cred, LIST_ELIGIBLE_ROLE_ENTRA_SCOPES, AbortSignal.timeout(1000)),
    ).resolves.toBeUndefined();
  });

  it("requestRoleEntraActivation still requires the ReadWrite assignment scope", async () => {
    // Downgraded eligibility alone is NOT enough for the activation POST.
    const cred = credWith([OAuthScope.RoleEligibilityScheduleReadDirectory]);
    await expect(
      assertScopes(cred, ROLE_ENTRA_SCHEDULE_REQUEST_SCOPES, AbortSignal.timeout(1000)),
    ).rejects.toBeInstanceOf(MissingScopeError);
  });
});
