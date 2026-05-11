// Direct tests for the per-surface format helpers. These exercise the
// branch combinations (empty list / no-displayName / no-expiry /
// no-justification / no-approvalId / no-status / no-action / etc.) that
// the higher-level integration tests don't naturally cover.

import { describe, it, expect } from "vitest";

import {
  formatActiveAssignmentsText as groupActive,
  formatEligibleAssignmentsText as groupEligible,
  formatRequestsText as groupRequests,
} from "../../../src/features/group/format.js";
import {
  formatActiveAssignmentsText as entraActive,
  formatEligibleAssignmentsText as entraEligible,
  formatRequestsText as entraRequests,
} from "../../../src/features/role-entra/format.js";
import {
  formatActiveAssignmentsText as azureActive,
  formatEligibleAssignmentsText as azureEligible,
  formatRequestsText as azureRequests,
  roleLabel as azureRoleLabel,
  scopeLabel as azureScopeLabel,
  scopeFromAssignment as azureScopeFromAssignment,
} from "../../../src/features/role-azure/format.js";

describe("group format helpers", () => {
  it("eligible: empty / displayName / no displayName / with expiry", () => {
    expect(groupEligible([])).toBe("No eligible PIM group assignments.");
    const out = groupEligible([
      { id: "e1", groupId: "g1", principalId: "p", group: { id: "g1", displayName: "Alpha" } },
      {
        id: "e2",
        groupId: "g2",
        principalId: "p",
        scheduleInfo: { expiration: { endDateTime: "2099-01-01T00:00:00Z" } },
      },
    ]);
    expect(out).toContain("Eligible PIM group assignments (2):");
    expect(out).toContain("Alpha (g1)");
    expect(out).toContain("- g2 [eligibility=e2] — eligible until 2099-01-01T00:00:00Z");
  });

  it("active: empty / endDateTime branches", () => {
    expect(groupActive([])).toBe("No active PIM group assignments.");
    const out = groupActive([
      { id: "i1", groupId: "g1", principalId: "p", accessId: "member", memberType: "Direct" },
      {
        id: "i2",
        groupId: "g2",
        principalId: "p",
        accessId: "member",
        memberType: "Direct",
        endDateTime: "2099-01-01T00:00:00Z",
        group: { id: "g2", displayName: "Beta" },
      },
    ]);
    expect(out).toContain("- g1 [instance=i1]");
    expect(out).toContain("- Beta (g2) [instance=i2] — active until 2099-01-01T00:00:00Z");
  });

  it("requests: empty per-perspective / approval / justification / unknown action", () => {
    expect(groupRequests([], "mine")).toContain("No pending PIM group requests submitted by you.");
    expect(groupRequests([], "approver")).toContain(
      "No pending PIM group approvals assigned to you.",
    );
    const out = groupRequests(
      [
        {
          id: "r1",
          groupId: "g1",
          principalId: "p",
          approvalId: "a1",
          justification: "needed",
          action: "selfActivate",
        },
        // no approvalId, no justification, no action
        { id: "r2", groupId: "g2", principalId: "p" },
      ],
      "mine",
    );
    expect(out).toContain("Pending PIM group requests submitted by you (2):");
    expect(out).toContain('[approval=a1] — "needed"');
    expect(out).toContain("action=selfActivate");
    expect(out).toContain("[request=r2] action=?");
  });
});

describe("role-entra format helpers", () => {
  it("eligible empty + non-empty branches", () => {
    expect(entraEligible([])).toContain("No eligible PIM Entra-role");
    const out = entraEligible([
      {
        id: "e1",
        roleDefinitionId: "role-1",
        principalId: "p",
        directoryScopeId: "/",
        memberType: "Direct",
        status: "Provisioned",
        roleDefinition: { id: "role-1", displayName: "Reader" },
        scheduleInfo: { expiration: { endDateTime: "2099-01-01T00:00:00Z" } },
      },
    ]);
    expect(out).toContain("Reader");
    expect(out).toContain("eligible until 2099-01-01T00:00:00Z");
  });

  it("active empty + branch with no endDateTime / no displayName", () => {
    expect(entraActive([])).toContain("No active PIM Entra-role");
    const out = entraActive([
      {
        id: "i1",
        roleDefinitionId: "role-1",
        principalId: "p",
        directoryScopeId: "/scoped",
      },
    ]);
    expect(out).toContain("- role-1");
    expect(out).toContain("/scoped");
  });

  it("requests empty per perspective + populated", () => {
    expect(entraRequests([], "mine")).toContain("No pending PIM Entra-role requests");
    expect(entraRequests([], "approver")).toContain("No pending PIM Entra-role approvals");
    const out = entraRequests(
      [
        {
          id: "r1",
          roleDefinitionId: "role-1",
          principalId: "p",
          directoryScopeId: "/",
          action: "selfActivate",
          status: "PendingApproval",
          justification: "go",
          approvalId: "a1",
          roleDefinition: { id: "role-1", displayName: "Reader" },
        },
        // missing extras
        { id: "r2", roleDefinitionId: "role-2", principalId: "p" },
      ],
      "approver",
    );
    expect(out).toContain('[approval=a1] — "go"');
    expect(out).toContain("[request=r2]");
  });
});

describe("role-azure format helpers", () => {
  it("roleLabel uses displayName when present, else short id", () => {
    expect(azureRoleLabel("/sub/role-1", { roleDefinition: { displayName: "Owner" } })).toBe(
      "Owner (role-1)",
    );
    expect(azureRoleLabel("/sub/role-1")).toBe("role-1");
  });

  it("scopeLabel covers display+id, id-only, and Tenant fallback", () => {
    expect(
      azureScopeLabel(undefined, { scope: { displayName: "Sub A", id: "/subscriptions/a" } }),
    ).toBe("Sub A /subscriptions/a");
    expect(azureScopeLabel("/subscriptions/b")).toBe("/subscriptions/b");
    expect(azureScopeLabel(undefined)).toBe("Tenant");
  });

  it("scopeFromAssignment prefers expanded scope.id, falls back to properties.scope", () => {
    expect(
      azureScopeFromAssignment({
        properties: { scope: "/sub/x", expandedProperties: { scope: { id: "/sub/y" } } },
      }),
    ).toBe("/sub/y");
    expect(azureScopeFromAssignment({ properties: { scope: "/sub/x" } })).toBe("/sub/x");
    expect(azureScopeFromAssignment({ properties: {} })).toBeUndefined();
  });

  it("eligible / active / requests cover empty + branches", () => {
    expect(azureEligible([])).toContain("No eligible PIM Azure-role");
    expect(azureActive([])).toContain("No active PIM Azure-role");
    expect(azureRequests([], "mine")).toContain("No PIM Azure-role requests submitted");
    expect(azureRequests([], "approver")).toContain("No PIM Azure-role approvals assigned");

    const eligibleOut = azureEligible([
      {
        id: "/scope/eligibilityScheduleInstances/e1",
        name: "e1",
        type: "Microsoft.Authorization/roleEligibilityScheduleInstances",
        properties: {
          principalId: "p",
          roleDefinitionId: "/scope/role-1",
          scope: "/scope",
          memberType: "Direct",
          endDateTime: "2099-01-01T00:00:00Z",
        },
      },
    ]);
    expect(eligibleOut).toContain("eligible until 2099-01-01T00:00:00Z");

    const requestsOut = azureRequests(
      [
        {
          id: "/scope/req/r1",
          name: "r1",
          type: "Microsoft.Authorization/roleAssignmentScheduleRequests",
          properties: {
            principalId: "p",
            roleDefinitionId: "/scope/role-1",
            scope: "/scope",
            requestType: "SelfActivate",
            status: "Provisioned",
            justification: "ok",
            approvalId: "ap1",
          },
        },
        {
          id: "/scope/req/r2",
          name: "r2",
          type: "Microsoft.Authorization/roleAssignmentScheduleRequests",
          properties: {
            principalId: "p",
            roleDefinitionId: "/scope/role-2",
            scope: "/scope",
          },
        },
      ],
      "mine",
    );
    expect(requestsOut).toContain('status=Provisioned [approval=ap1] — "ok"');
    expect(requestsOut).toContain("action=? status=?");
  });
});
