// End-to-end pagination tests covering every PIM list endpoint.
//
// Two contracts are exercised:
//
//   1. Principal-side Graph list helpers query the unfiltered
//      collection with `?$filter=principalId eq '<my-oid>'` and follow
//      `@odata.nextLink` until exhausted. This bypasses the Microsoft
//      Graph `filterByCurrentUser` 50-item cap (see
//      microsoftgraph/microsoft-graph-docs#15755).
//
//   2. Approver-side Graph list helpers continue to use
//      `filterByCurrentUser(on='approver')` because there is no clean
//      OData substitute. They issue a single request, never send
//      `$top`, and return a `LimitedResult` that flags `cappedAt50`
//      when exactly 50 items come back.
//
// ARM list helpers paginate via real OData `$filter=asTarget()` /
// `asApprover()` and follow `nextLink` until exhausted; they were
// never affected by the Graph cap.
//
// The mock-graph routes back this contract: `filterByCurrentUser`
// paths reject `$top`/`$skip` and never emit a nextLink, while the
// unfiltered collections honour `$filter=principalId eq …` + `$top`
// + `@odata.nextLink` per the mock paging helper.

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
import { FILTER_BY_CURRENT_USER_CAP } from "../../src/http/paging.js";

import { MockGraphState, createMockGraphServer } from "../mock-graph.js";
import { MockArmState, createMockArmServer } from "../mock-arm.js";
import { testSignal } from "../helpers.js";

// Above the mock default page size (100) and above the
// filterByCurrentUser cap (50) so both contracts are exercised.
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
  it("eligible (principal): follows @odata.nextLink past the 50-item cap", async () => {
    await withGraph(async (state, client) => {
      seedGroupEligibilities(state, TOTAL);
      const result = await listEligibleGroupAssignments(client, testSignal());
      expect(result.items).toHaveLength(TOTAL);
      expect(result.truncated).toBe(false);
      expect(result.pagesFetched).toBeGreaterThan(1);
    });
  });

  it("active (principal): follows continuation past the 50-item cap", async () => {
    await withGraph(async (state, client) => {
      seedGroupActives(state, TOTAL);
      const result = await listActiveGroupAssignments(client, testSignal());
      expect(result.items).toHaveLength(TOTAL);
    });
  });

  it("requests (mine, principal): follows continuation past the 50-item cap", async () => {
    await withGraph(async (state, client) => {
      seedGroupRequests(state, TOTAL, "mine");
      const mine = await listMyGroupRequests(client, testSignal());
      expect(mine.items).toHaveLength(TOTAL);
    });
  });

  it("approval (approver): single request, caps at 50, flags cappedAt50", async () => {
    await withGraph(async (state, client) => {
      seedGroupRequests(state, TOTAL, "approver");
      const approver = await listGroupApprovalRequests(client, testSignal());
      expect(approver.items).toHaveLength(FILTER_BY_CURRENT_USER_CAP);
      expect(approver.cappedAt50).toBe(true);
    });
  });

  it("approval (approver): below the cap → cappedAt50 false", async () => {
    await withGraph(async (state, client) => {
      seedGroupRequests(state, 7, "approver");
      const approver = await listGroupApprovalRequests(client, testSignal());
      expect(approver.items).toHaveLength(7);
      expect(approver.cappedAt50).toBe(false);
    });
  });

  it("principal-side helpers resolve my object id only once across calls", async () => {
    await withGraph(async (state, client) => {
      seedGroupEligibilities(state, 10);
      seedGroupActives(state, 10);
      seedGroupRequests(state, 10, "mine");
      await listEligibleGroupAssignments(client, testSignal());
      await listActiveGroupAssignments(client, testSignal());
      await listMyGroupRequests(client, testSignal());
      expect(state.meCallCount).toBe(1);
    });
  });
});

describe("pagination — Graph role-entra list endpoints", () => {
  it("eligible (principal): follows continuation past the 50-item cap", async () => {
    await withGraph(async (state, client) => {
      seedRoleEntraEligibilities(state, TOTAL);
      const result = await listEligibleRoleEntraAssignments(client, testSignal());
      expect(result.items).toHaveLength(TOTAL);
    });
  });

  it("active (principal): follows continuation past the 50-item cap", async () => {
    await withGraph(async (state, client) => {
      seedRoleEntraActives(state, TOTAL);
      const result = await listActiveRoleEntraAssignments(client, testSignal());
      expect(result.items).toHaveLength(TOTAL);
    });
  });

  it("requests (mine, principal): follows continuation past the 50-item cap", async () => {
    await withGraph(async (state, client) => {
      seedRoleEntraRequests(state, TOTAL, "mine");
      const mine = await listMyRoleEntraRequests(client, testSignal());
      expect(mine.items).toHaveLength(TOTAL);
    });
  });

  it("approval (approver): single request, caps at 50, flags cappedAt50", async () => {
    await withGraph(async (state, client) => {
      seedRoleEntraRequests(state, TOTAL, "approver");
      const approver = await listRoleEntraApprovalRequests(client, testSignal());
      expect(approver.items).toHaveLength(FILTER_BY_CURRENT_USER_CAP);
      expect(approver.cappedAt50).toBe(true);
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
