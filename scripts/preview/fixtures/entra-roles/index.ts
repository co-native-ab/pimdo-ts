// Deterministic Graph fixtures for the pim_role_entra_* tool families.

import type {
  RoleEntraActiveAssignment,
  RoleEntraAssignmentRequest,
  RoleEntraEligibleAssignment,
} from "../../../../src/graph/types.js";

import type { ListScenarioId } from "../../scenarios.js";

const GUID = (n: number): string => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ROLE_NAMES = [
  "Reports Reader",
  "Helpdesk Administrator",
  "User Administrator",
  "Groups Administrator",
  "Privileged Role Administrator",
  "Application Administrator",
  "Security Reader",
  "Conditional Access Administrator",
  "Global Reader",
  "Compliance Administrator",
];

function eligible(n: number): RoleEntraEligibleAssignment {
  return {
    id: `el-${String(n)}`,
    roleDefinitionId: GUID(n),
    principalId: GUID(99),
    directoryScopeId: "/",
    status: "Provisioned",
    scheduleInfo: {
      expiration: { type: "afterDateTime", endDateTime: "2030-01-01T00:00:00Z" },
    },
    roleDefinition: { id: GUID(n), displayName: ROLE_NAMES[(n - 1) % ROLE_NAMES.length] },
  };
}

function active(n: number): RoleEntraActiveAssignment {
  return {
    id: `inst-${String(n)}`,
    roleDefinitionId: GUID(n),
    principalId: GUID(99),
    directoryScopeId: "/",
    assignmentType: "Activated",
    startDateTime: "2030-01-01T00:00:00Z",
    endDateTime: "2030-01-01T08:00:00Z",
    roleDefinition: { id: GUID(n), displayName: ROLE_NAMES[(n - 1) % ROLE_NAMES.length] },
  };
}

function request(n: number, perspective: "mine" | "approver"): RoleEntraAssignmentRequest {
  return {
    id: `req-${String(n)}`,
    roleDefinitionId: GUID(n),
    principalId: GUID(99),
    directoryScopeId: "/",
    action: "selfActivate",
    approvalId: perspective === "approver" ? `appr-${String(n)}` : null,
    status: "PendingApproval",
    justification: "Need access to investigate ticket #1001.",
    createdDateTime: "2030-01-01T00:00:00Z",
    roleDefinition: { id: GUID(n), displayName: ROLE_NAMES[(n - 1) % ROLE_NAMES.length] },
  };
}

function listFor<T>(scenario: ListScenarioId, build: (n: number) => T): readonly T[] {
  switch (scenario) {
    case "empty":
      return [];
    case "single":
      return [build(1)];
    case "pair":
      return [build(1), build(2)];
    case "full":
      return [build(1), build(2), build(3), build(4), build(5)];
    case "next-page":
      return [build(6), build(7), build(8), build(9), build(10)];
  }
}

export function eligibleFixtures(s: ListScenarioId): readonly RoleEntraEligibleAssignment[] {
  return listFor(s, eligible);
}
export function activeFixtures(s: ListScenarioId): readonly RoleEntraActiveAssignment[] {
  return listFor(s, active);
}
export function requestFixtures(
  s: ListScenarioId,
  perspective: "mine" | "approver",
): readonly RoleEntraAssignmentRequest[] {
  return listFor(s, (n) => request(n, perspective));
}
