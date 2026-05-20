// End-to-end pagination tests covering every PIM list endpoint.
//
// Seeds the mock servers with enough items to exceed the mock's default
// page size (50, matching the empirically observed Microsoft Graph
// default for filterByCurrentUser endpoints) and asserts that:
//
//   1. The client follows @odata.nextLink / nextLink until exhausted
//      (no silent 50-item cap, which is the bug this work fixes).
//   2. The truncation signal is surfaced when maxPages is hit.
//   3. The client never re-adds $top to a continuation URL (enforced
//      by the mock returning 400 on that combination).
//
// Each test seeds 250 items so we get five pages at pageSize=50 and
// two pages at pageSize=100. Both branches are exercised.

import { describe, it, expect } from "vitest";

import { GraphClient } from "../../src/graph/client.js";
import { ArmClient } from "../../src/arm/client.js";
import {
  listEligibleGroupAssignments,
  listActiveGroupAssignments,
  listMyGroupRequests,
  listGroupApprovalRequests,
} from "../../src/features/group/client.js";
import {
  listEligibleRoleEntraAssignments,
  listActiveRoleEntraAssignments,
  listMyRoleEntraRequests,
  listRoleEntraApprovalRequests,
} from "../../src/features/role-entra/client.js";
import {
  listEligibleRoleAzureAssignments,
  listActiveRoleAzureAssignments,
  listMyRoleAzureRequests,
  listRoleAzureApprovalRequests,
} from "../../src/features/role-azure/client.js";
import { getGroupMaxDuration, getDirectoryRoleMaxDuration } from "../../src/graph/policies.js";
import { getAzureRoleMaxDuration } from "../../src/arm/policies.js";

import { MockGraphState, createMockGraphServer } from "../mock-graph.js";
import { MockArmState, createMockArmServer } from "../mock-arm.js";
import { testSignal } from "../helpers.js";

const TOTAL = 250;

async function withGraph(
  fn: (state: MockGraphState, client: GraphClient) => Promise<void>,
): Promise<void> {
  const state = new MockGraphState();
  const { server, url } = await createMockGraphServer(state);
  const client = new GraphClient(url, "fake-token");
  try {
    await fn(state, client);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

async function withArm(
  fn: (state: MockArmState, client: ArmClient) => Promise<void>,
): Promise<void> {
  const state = new MockArmState();
  const { server, url } = await createMockArmServer(state);
  const client = new ArmClient(url, "fake-token");
  try {
    await fn(state, client);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

function seedGroupEligibilities(state: MockGraphState, n: number): void {
  for (let i = 0; i < n; i++) {
    state.seedEligibility({
      groupId: `g-${String(i)}`,
      group: { id: `g-${String(i)}`, displayName: `Group ${String(i)}` },
    });
  }
}

function seedGroupActives(state: MockGraphState, n: number): void {
  for (let i = 0; i < n; i++) {
    state.assignmentScheduleInstances.push({
      id: `inst-${String(i)}`,
      groupId: `g-${String(i)}`,
      principalId: "me-id",
      accessId: "member",
      memberType: "Direct",
      assignmentType: "Activated",
      group: { id: `g-${String(i)}`, displayName: `Group ${String(i)}` },
    });
  }
}

function seedGroupRequests(state: MockGraphState, n: number, side: "mine" | "approver"): void {
  const target = side === "mine" ? state.myRequests : state.approverRequests;
  for (let i = 0; i < n; i++) {
    target.push({
      id: `req-${side}-${String(i)}`,
      groupId: `g-${String(i)}`,
      principalId: "me-id",
      action: "selfActivate",
      status: "PendingApproval",
      group: { id: `g-${String(i)}`, displayName: `Group ${String(i)}` },
    });
  }
}

function seedRoleEntraEligibilities(state: MockGraphState, n: number): void {
  for (let i = 0; i < n; i++) {
    state.seedRoleEntraEligibility({
      roleDefinitionId: `role-${String(i)}`,
      roleDefinition: { id: `role-${String(i)}`, displayName: `Role ${String(i)}` },
    });
  }
}

function seedRoleEntraActives(state: MockGraphState, n: number): void {
  for (let i = 0; i < n; i++) {
    state.roleEntraAssignmentScheduleInstances.push({
      id: `re-inst-${String(i)}`,
      roleDefinitionId: `role-${String(i)}`,
      principalId: "me-id",
      directoryScopeId: "/",
      memberType: "Direct",
      assignmentType: "Activated",
      roleDefinition: { id: `role-${String(i)}`, displayName: `Role ${String(i)}` },
    });
  }
}

function seedRoleEntraRequests(state: MockGraphState, n: number, side: "mine" | "approver"): void {
  const target = side === "mine" ? state.roleEntraMyRequests : state.roleEntraApproverRequests;
  for (let i = 0; i < n; i++) {
    target.push({
      id: `re-req-${side}-${String(i)}`,
      roleDefinitionId: `role-${String(i)}`,
      principalId: "me-id",
      directoryScopeId: "/",
      action: "selfActivate",
      status: "PendingApproval",
    });
  }
}

function seedArmEligibilities(state: MockArmState, n: number, scope: string): void {
  for (let i = 0; i < n; i++) {
    state.seedEligibility({
      roleDefinitionId: `${scope}/providers/Microsoft.Authorization/roleDefinitions/role-${String(i)}`,
      scope,
    });
  }
}

function seedArmActives(state: MockArmState, n: number, scope: string): void {
  for (let i = 0; i < n; i++) {
    state.seedActive({
      roleDefinitionId: `${scope}/providers/Microsoft.Authorization/roleDefinitions/role-${String(i)}`,
      scope,
    });
  }
}

function seedArmRequests(state: MockArmState, n: number, side: "mine" | "approver"): void {
  const target = side === "mine" ? state.myRequests : state.approverRequests;
  for (let i = 0; i < n; i++) {
    target.push({
      id: `arm-req-${side}-${String(i)}`,
      name: `arm-req-${side}-${String(i)}`,
      type: "Microsoft.Authorization/roleAssignmentScheduleRequests",
      properties: {
        principalId: "me-id",
        roleDefinitionId: `role-${String(i)}`,
        scope: "/subscriptions/sub-1",
        requestType: side === "mine" ? "SelfActivate" : "AdminAssign",
        status: "PendingApproval",
      },
    });
  }
}

describe("pagination — Graph group list endpoints", () => {
  it("eligible: follows @odata.nextLink until exhausted", async () => {
    await withGraph(async (state, client) => {
      seedGroupEligibilities(state, TOTAL);
      const result = await listEligibleGroupAssignments(client, testSignal());
      expect(result.items).toHaveLength(TOTAL);
      expect(result.truncated).toBe(false);
      expect(result.pagesFetched).toBeGreaterThan(1);
    });
  });

  it("eligible: reports truncated when maxPages is hit", async () => {
    await withGraph(async (state, client) => {
      seedGroupEligibilities(state, TOTAL);
      const result = await listEligibleGroupAssignments(client, testSignal(), {
        pageSize: 50,
        maxPages: 2,
      });
      expect(result.items).toHaveLength(100);
      expect(result.truncated).toBe(true);
      expect(result.pagesFetched).toBe(2);
    });
  });

  it("active: follows continuation", async () => {
    await withGraph(async (state, client) => {
      seedGroupActives(state, TOTAL);
      const result = await listActiveGroupAssignments(client, testSignal());
      expect(result.items).toHaveLength(TOTAL);
    });
  });

  it("requests (mine + approver): both sides paginate", async () => {
    await withGraph(async (state, client) => {
      seedGroupRequests(state, TOTAL, "mine");
      seedGroupRequests(state, TOTAL, "approver");
      const mine = await listMyGroupRequests(client, testSignal());
      const approver = await listGroupApprovalRequests(client, testSignal());
      expect(mine.items).toHaveLength(TOTAL);
      expect(approver.items).toHaveLength(TOTAL);
    });
  });
});

describe("pagination — Graph role-entra list endpoints", () => {
  it("eligible: follows continuation", async () => {
    await withGraph(async (state, client) => {
      seedRoleEntraEligibilities(state, TOTAL);
      const result = await listEligibleRoleEntraAssignments(client, testSignal());
      expect(result.items).toHaveLength(TOTAL);
    });
  });

  it("active: follows continuation", async () => {
    await withGraph(async (state, client) => {
      seedRoleEntraActives(state, TOTAL);
      const result = await listActiveRoleEntraAssignments(client, testSignal());
      expect(result.items).toHaveLength(TOTAL);
    });
  });

  it("requests (mine + approver): both sides paginate", async () => {
    await withGraph(async (state, client) => {
      seedRoleEntraRequests(state, TOTAL, "mine");
      seedRoleEntraRequests(state, TOTAL, "approver");
      const mine = await listMyRoleEntraRequests(client, testSignal());
      const approver = await listRoleEntraApprovalRequests(client, testSignal());
      expect(mine.items).toHaveLength(TOTAL);
      expect(approver.items).toHaveLength(TOTAL);
    });
  });
});

describe("pagination — ARM role-azure list endpoints", () => {
  it("eligible: follows nextLink", async () => {
    await withArm(async (state, client) => {
      seedArmEligibilities(state, TOTAL, "/subscriptions/sub-1");
      const result = await listEligibleRoleAzureAssignments(client, testSignal());
      expect(result.items).toHaveLength(TOTAL);
    });
  });

  it("active: aggregates pages across scopes", async () => {
    await withArm(async (state, client) => {
      // listActiveRoleAzureAssignments derives scopes from eligibilities,
      // then issues one paginated call per scope.
      seedArmEligibilities(state, 1, "/subscriptions/sub-1");
      seedArmActives(state, TOTAL, "/subscriptions/sub-1");
      const result = await listActiveRoleAzureAssignments(client, testSignal());
      expect(result.items).toHaveLength(TOTAL);
    });
  });

  it("requests (mine + approver): both paginate", async () => {
    await withArm(async (state, client) => {
      seedArmRequests(state, TOTAL, "mine");
      seedArmRequests(state, TOTAL, "approver");
      const mine = await listMyRoleAzureRequests(client, testSignal());
      const approver = await listRoleAzureApprovalRequests(client, testSignal());
      expect(mine.items).toHaveLength(TOTAL);
      expect(approver.items).toHaveLength(TOTAL);
    });
  });
});

describe("pagination — policy lookups (single-result filters)", () => {
  it("getGroupMaxDuration goes through the paginator without error", async () => {
    await withGraph(async (state, client) => {
      state.policyAssignments.push({
        groupId: "g-1",
        maximumDuration: "PT8H",
      });
      const max = await getGroupMaxDuration(client, "g-1", testSignal());
      expect(max).toBe("PT8H");
    });
  });

  it("getDirectoryRoleMaxDuration goes through the paginator without error", async () => {
    await withGraph(async (state, client) => {
      state.directoryPolicyAssignments.push({
        roleDefinitionId: "role-1",
        scopeId: "/",
        maximumDuration: "PT4H",
      });
      const max = await getDirectoryRoleMaxDuration(client, "role-1", testSignal());
      expect(max).toBe("PT4H");
    });
  });

  it("getAzureRoleMaxDuration goes through the paginator without error", async () => {
    await withArm(async (state, client) => {
      state.policyAssignments.push({
        scope: "/subscriptions/sub-1",
        roleDefinitionId: "role-1",
        maximumDuration: "PT2H",
      });
      const max = await getAzureRoleMaxDuration(
        client,
        "/subscriptions/sub-1",
        "role-1",
        testSignal(),
      );
      expect(max).toBe("PT2H");
    });
  });
});
