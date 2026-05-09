// Deterministic ARM fixtures for the pim_role_azure_* tool families.

import type {
  RoleAzureActiveAssignment,
  RoleAzureAssignmentRequest,
  RoleAzureEligibleAssignment,
} from "../../../../src/arm/types.js";

import type { ListScenarioId } from "../../scenarios.js";

const SUB = "00000000-0000-0000-0000-000000000001";
const ROLE_DEF = (n: number): string =>
  `/subscriptions/${SUB}/providers/Microsoft.Authorization/roleDefinitions/role-def-${String(n)}`;
const SCOPE = `/subscriptions/${SUB}`;
const PRINCIPAL = "00000000-0000-0000-0000-000000000099";

const ROLE_NAMES = [
  "Reader",
  "Contributor",
  "Owner",
  "User Access Administrator",
  "Storage Blob Data Reader",
  "Key Vault Secrets User",
  "Network Contributor",
  "Virtual Machine Contributor",
  "Monitoring Reader",
  "Cost Management Reader",
];

function expanded(
  n: number,
): NonNullable<RoleAzureEligibleAssignment["properties"]["expandedProperties"]> {
  return {
    principal: { id: PRINCIPAL, displayName: "Alice Example", type: "User" },
    roleDefinition: { id: ROLE_DEF(n), displayName: ROLE_NAMES[(n - 1) % ROLE_NAMES.length] },
    scope: { id: SCOPE, displayName: "Sample Subscription", type: "subscription" },
  };
}

function eligible(n: number): RoleAzureEligibleAssignment {
  return {
    id: `el-${String(n)}`,
    properties: {
      principalId: PRINCIPAL,
      roleDefinitionId: ROLE_DEF(n),
      scope: SCOPE,
      memberType: "Direct",
      startDateTime: "2030-01-01T00:00:00Z",
      endDateTime: "2030-01-01T08:00:00Z",
      expandedProperties: expanded(n),
    },
  };
}

function active(n: number): RoleAzureActiveAssignment {
  return {
    id: `inst-${String(n)}`,
    properties: {
      principalId: PRINCIPAL,
      roleDefinitionId: ROLE_DEF(n),
      scope: SCOPE,
      memberType: "Direct",
      assignmentType: "Activated",
      status: "Accepted",
      startDateTime: "2030-01-01T00:00:00Z",
      endDateTime: "2030-01-01T08:00:00Z",
      expandedProperties: expanded(n),
    },
  };
}

function request(n: number, perspective: "mine" | "approver"): RoleAzureAssignmentRequest {
  return {
    id: `req-${String(n)}`,
    properties: {
      principalId: PRINCIPAL,
      roleDefinitionId: ROLE_DEF(n),
      scope: SCOPE,
      requestType: "SelfActivate",
      status: "PendingApproval",
      justification: "Need access to investigate ticket #1001.",
      approvalId: perspective === "approver" ? `appr-${String(n)}` : null,
      createdOn: "2030-01-01T00:00:00Z",
      expandedProperties: expanded(n),
    },
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

export function eligibleFixtures(s: ListScenarioId): readonly RoleAzureEligibleAssignment[] {
  return listFor(s, eligible);
}
export function activeFixtures(s: ListScenarioId): readonly RoleAzureActiveAssignment[] {
  return listFor(s, active);
}
export function requestFixtures(
  s: ListScenarioId,
  perspective: "mine" | "approver",
): readonly RoleAzureAssignmentRequest[] {
  return listFor(s, (n) => request(n, perspective));
}
