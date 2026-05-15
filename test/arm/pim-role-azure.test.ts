// Tests for src/features/role-azure/client.ts driven by the ARM mock.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type http from "node:http";

import { ArmClient } from "../../src/arm/client.js";
import { ApprovalDecision } from "../../src/enums.js";
import {
  approveRoleAzureAssignment,
  cancelRoleAzureAssignmentRequest,
  listActiveRoleAzureAssignments,
  listEligibleRoleAzureAssignments,
  listMyPendingRoleAzureRequests,
  listMyRoleAzureRequests,
  listRoleAzureApprovalRequests,
  requestRoleAzureActivation,
  requestRoleAzureDeactivation,
} from "../../src/features/role-azure/client.js";
import { createMockArmServer, MockArmState } from "../mock-arm.js";
import { testSignal } from "../helpers.js";

describe("arm/pim-role-azure", () => {
  let state: MockArmState;
  let server: http.Server;
  let client: ArmClient;

  beforeEach(async () => {
    state = new MockArmState();
    const started = await createMockArmServer(state);
    server = started.server;
    client = new ArmClient(started.url, "test-token");
  });

  afterEach(() => {
    server.close();
  });

  it("listEligibleRoleAzureAssignments returns seeded eligibilities", async () => {
    state.seedEligibility({ roleDefinitionId: "role-1", scope: "/subscriptions/sub-a" });
    state.seedEligibility({ roleDefinitionId: "role-2", scope: "/subscriptions/sub-b" });
    const result = await listEligibleRoleAzureAssignments(client, testSignal());
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.properties.roleDefinitionId)).toEqual(["role-1", "role-2"]);
  });

  it("listActiveRoleAzureAssignments queries each eligible scope and filters non-User principals", async () => {
    state.seedEligibility({ roleDefinitionId: "role-1", scope: "/subscriptions/sub-a" });
    state.seedActive({
      id: "/subscriptions/sub-a/providers/Microsoft.Authorization/roleAssignmentScheduleInstances/active-1",
      roleDefinitionId: "role-1",
      scope: "/subscriptions/sub-a",
    });
    // A non-User principal should be skipped.
    const list = state.activeInstancesByScope.get("/subscriptions/sub-a") ?? [];
    list.push({
      id: "/subscriptions/sub-a/providers/Microsoft.Authorization/roleAssignmentScheduleInstances/sp-1",
      properties: {
        principalId: "sp-1",
        principalType: "ServicePrincipal",
        roleDefinitionId: "role-1",
        scope: "/subscriptions/sub-a",
      },
    });

    const result = await listActiveRoleAzureAssignments(client, testSignal());
    expect(result).toHaveLength(1);
    expect(result[0]?.properties.principalId).toBe("me-id");
  });

  it("listActiveRoleAzureAssignments filters terminal lifecycle statuses", async () => {
    state.seedEligibility({ roleDefinitionId: "role-1", scope: "/subscriptions/sub-a" });
    state.seedActive({
      id: "/subscriptions/sub-a/providers/Microsoft.Authorization/roleAssignmentScheduleInstances/active-keep",
      roleDefinitionId: "role-1",
      scope: "/subscriptions/sub-a",
      status: "Provisioned",
    });
    state.seedActive({
      id: "/subscriptions/sub-a/providers/Microsoft.Authorization/roleAssignmentScheduleInstances/active-revoked",
      roleDefinitionId: "role-1",
      scope: "/subscriptions/sub-a",
      status: "Revoked",
    });
    state.seedActive({
      id: "/subscriptions/sub-a/providers/Microsoft.Authorization/roleAssignmentScheduleInstances/active-expired",
      roleDefinitionId: "role-1",
      scope: "/subscriptions/sub-a",
      status: "Expired",
    });
    state.seedActive({
      id: "/subscriptions/sub-a/providers/Microsoft.Authorization/roleAssignmentScheduleInstances/active-unknown",
      roleDefinitionId: "role-1",
      scope: "/subscriptions/sub-a",
      status: "SomeNewStatus",
    });

    const result = await listActiveRoleAzureAssignments(client, testSignal());
    const ids = result.map((r) => r.id);
    expect(ids).toContain(
      "/subscriptions/sub-a/providers/Microsoft.Authorization/roleAssignmentScheduleInstances/active-keep",
    );
    expect(ids).toContain(
      "/subscriptions/sub-a/providers/Microsoft.Authorization/roleAssignmentScheduleInstances/active-unknown",
    );
    expect(ids).not.toContain(
      "/subscriptions/sub-a/providers/Microsoft.Authorization/roleAssignmentScheduleInstances/active-revoked",
    );
    expect(ids).not.toContain(
      "/subscriptions/sub-a/providers/Microsoft.Authorization/roleAssignmentScheduleInstances/active-expired",
    );
  });

  it("listActiveRoleAzureAssignments returns [] when no eligibilities", async () => {
    const result = await listActiveRoleAzureAssignments(client, testSignal());
    expect(result).toEqual([]);
  });

  it("listMyRoleAzureRequests reads from the asTarget() endpoint", async () => {
    state.myRequests.push({
      id: "/subscriptions/x/providers/Microsoft.Authorization/roleAssignmentScheduleRequests/r1",
      properties: {
        principalId: "me-id",
        roleDefinitionId: "role-1",
        scope: "/subscriptions/x",
        requestType: "SelfActivate",
        status: "PendingApproval",
      },
    });
    const result = await listMyRoleAzureRequests(client, testSignal());
    expect(result).toHaveLength(1);
    expect(result[0]?.properties.status).toBe("PendingApproval");
  });

  it("listRoleAzureApprovalRequests reads from the asApprover() endpoint", async () => {
    state.seedPendingApproval({ roleDefinitionId: "role-1", scope: "/subscriptions/x" });
    const result = await listRoleAzureApprovalRequests(client, testSignal());
    expect(result).toHaveLength(1);
    expect(result[0]?.properties.status).toBe("PendingApproval");
  });

  it("requestRoleAzureActivation PUTs the expected body to the scoped path", async () => {
    const created = await requestRoleAzureActivation(
      client,
      "/subscriptions/sub-a",
      {
        principalId: "me-id",
        roleDefinitionId: "role-1",
        justification: "needed",
        scheduleInfo: {
          startDateTime: "2026-01-01T00:00:00Z",
          expiration: { type: "AfterDuration", duration: "PT2H" },
        },
      },
      testSignal(),
    );
    expect(created.id).toContain("/subscriptions/sub-a");
    expect(state.submittedRequests).toHaveLength(1);
    const submitted = state.submittedRequests[0]!;
    expect(submitted.scope).toBe("/subscriptions/sub-a");
    expect(submitted.body["properties"]).toMatchObject({
      principalId: "me-id",
      roleDefinitionId: "role-1",
      requestType: "SelfActivate",
      justification: "needed",
    });
  });

  it("requestRoleAzureDeactivation PUTs SelfDeactivate without scheduleInfo", async () => {
    await requestRoleAzureDeactivation(
      client,
      "/subscriptions/sub-a",
      {
        principalId: "me-id",
        roleDefinitionId: "role-1",
        justification: "done",
      },
      testSignal(),
    );
    expect(state.submittedRequests).toHaveLength(1);
    const props = state.submittedRequests[0]!.body["properties"] as Record<string, unknown>;
    expect(props["requestType"]).toBe("SelfDeactivate");
    expect(props).not.toHaveProperty("scheduleInfo");
  });

  it("approveRoleAzureAssignment posts a single batch entry with the inner stages PUT", async () => {
    const approvalId =
      "/providers/Microsoft.Authorization/roleAssignmentApprovals/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    await approveRoleAzureAssignment(
      client,
      approvalId,
      ApprovalDecision.Approve,
      "looks good",
      testSignal(),
    );
    expect(state.batchRequests).toHaveLength(1);
    const requests = state.batchRequests[0]!.body["requests"] as Record<string, unknown>[];
    expect(requests).toHaveLength(1);
    const inner = requests[0]!;
    expect(inner["httpMethod"]).toBe("PUT");
    expect(String(inner["url"])).toContain(
      "/roleAssignmentApprovals/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/stages/",
    );
    expect(inner["content"]).toMatchObject({
      properties: { reviewResult: "Approve", justification: "looks good" },
    });
  });

  it("approveRoleAzureAssignment accepts a bare approval UUID", async () => {
    await approveRoleAzureAssignment(client, "deadbeef", ApprovalDecision.Deny, "no", testSignal());
    const requests = state.batchRequests[0]!.body["requests"] as Record<string, unknown>[];
    expect(String(requests[0]!["url"])).toContain(
      "/roleAssignmentApprovals/deadbeef/stages/deadbeef",
    );
  });

  it("approveRoleAzureAssignment throws when the inner response is >=400", async () => {
    state.failingApprovals.add("badbad");
    await expect(
      approveRoleAzureAssignment(client, "badbad", ApprovalDecision.Approve, "x", testSignal()),
    ).rejects.toThrow(/HTTP 400/);
  });

  it("listMyPendingRoleAzureRequests filters out non-PendingApproval entries", async () => {
    state.myRequests.push(
      {
        id: "/subscriptions/sub-a/providers/Microsoft.Authorization/roleAssignmentScheduleRequests/req-1",
        name: "req-1",
        type: "Microsoft.Authorization/roleAssignmentScheduleRequests",
        properties: {
          principalId: "me-id",
          roleDefinitionId: "role-1",
          scope: "/subscriptions/sub-a",
          requestType: "SelfActivate",
          status: "PendingApproval",
        },
      },
      {
        id: "/subscriptions/sub-a/providers/Microsoft.Authorization/roleAssignmentScheduleRequests/req-2",
        name: "req-2",
        type: "Microsoft.Authorization/roleAssignmentScheduleRequests",
        properties: {
          principalId: "me-id",
          roleDefinitionId: "role-1",
          scope: "/subscriptions/sub-a",
          requestType: "SelfActivate",
          status: "Granted",
        },
      },
    );
    const result = await listMyPendingRoleAzureRequests(client, testSignal());
    expect(result.map((r) => r.name)).toEqual(["req-1"]);
    // Sanity-check: the unfiltered helper still returns both.
    const unfiltered = await listMyRoleAzureRequests(client, testSignal());
    expect(unfiltered.map((r) => r.name)).toEqual(["req-1", "req-2"]);
  });

  it("cancelRoleAzureAssignmentRequest POSTs to the cancel sub-resource at the given scope", async () => {
    await cancelRoleAzureAssignmentRequest(client, "/subscriptions/sub-a", "req-7", testSignal());
    expect(state.cancelledRequests).toEqual([{ scope: "/subscriptions/sub-a", name: "req-7" }]);
  });
});
