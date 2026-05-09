// Deterministic Graph fixtures for the pim_group_* tool families.

import type {
  GroupActiveAssignment,
  GroupAssignmentRequest,
  GroupEligibleAssignment,
} from "../../../../src/graph/types.js";

import type { ListScenarioId } from "../../scenarios.js";

const GUID = (n: number): string => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

function eligible(n: number): GroupEligibleAssignment {
  return {
    id: `el-${String(n)}`,
    groupId: GUID(n),
    principalId: GUID(99),
    accessId: "member",
    status: "Provisioned",
    scheduleInfo: {
      expiration: { type: "afterDateTime", endDateTime: "2030-01-01T00:00:00Z" },
    },
    group: { id: GUID(n), displayName: `Sample Group ${String(n)}` },
  };
}

function active(n: number): GroupActiveAssignment {
  return {
    id: `inst-${String(n)}`,
    groupId: GUID(n),
    principalId: GUID(99),
    accessId: "member",
    assignmentType: "Activated",
    startDateTime: "2030-01-01T00:00:00Z",
    endDateTime: "2030-01-01T08:00:00Z",
    group: { id: GUID(n), displayName: `Sample Group ${String(n)}` },
  };
}

function request(n: number, perspective: "mine" | "approver"): GroupAssignmentRequest {
  return {
    id: `req-${String(n)}`,
    groupId: GUID(n),
    principalId: GUID(99),
    accessId: "member",
    action: "selfActivate",
    approvalId: perspective === "approver" ? `appr-${String(n)}` : null,
    status: "PendingApproval",
    justification: "Need access to investigate ticket #1001.",
    createdDateTime: "2030-01-01T00:00:00Z",
    group: { id: GUID(n), displayName: `Sample Group ${String(n)}` },
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

export function eligibleFixtures(s: ListScenarioId): readonly GroupEligibleAssignment[] {
  return listFor(s, eligible);
}
export function activeFixtures(s: ListScenarioId): readonly GroupActiveAssignment[] {
  return listFor(s, active);
}
export function requestFixtures(
  s: ListScenarioId,
  perspective: "mine" | "approver",
): readonly GroupAssignmentRequest[] {
  return listFor(s, (n) => request(n, perspective));
}
