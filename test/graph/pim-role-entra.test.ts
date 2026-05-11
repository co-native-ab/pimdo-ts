// Tests for src/features/role-entra/client.ts driven by the PIM mock-graph.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type http from "node:http";

import { ApprovalDecision } from "../../src/enums.js";
import { GraphClient } from "../../src/graph/client.js";
import {
  approveRoleEntraAssignment,
  listActiveRoleEntraAssignments,
  listEligibleRoleEntraAssignments,
  listMyRoleEntraRequests,
  listRoleEntraApprovalRequests,
  requestRoleEntraActivation,
  requestRoleEntraDeactivation,
} from "../../src/features/role-entra/client.js";
import { createMockGraphServer, MockGraphState } from "../mock-graph.js";
import { testSignal } from "../helpers.js";

describe("graph/pim-role-entra", () => {
  let state: MockGraphState;
  let server: http.Server;
  let client: GraphClient;

  beforeEach(async () => {
    state = new MockGraphState();
    const started = await createMockGraphServer(state);
    server = started.server;
    client = new GraphClient(started.url, "test-token");
  });

  afterEach(() => {
    server.close();
  });

  it("listEligibleRoleEntraAssignments returns seeded entries", async () => {
    state.seedRoleEntraEligibility({ roleDefinitionId: "role-1" });
    state.seedRoleEntraEligibility({ roleDefinitionId: "role-2" });
    const result = await listEligibleRoleEntraAssignments(client, testSignal());
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.roleDefinitionId)).toEqual(["role-1", "role-2"]);
  });

  it("listActiveRoleEntraAssignments returns active instances", async () => {
    state.roleEntraAssignmentScheduleInstances.push({
      id: "active-1",
      roleDefinitionId: "role-1",
      principalId: "me-id",
      directoryScopeId: "/",
    });
    const result = await listActiveRoleEntraAssignments(client, testSignal());
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("active-1");
  });

  it("listMyRoleEntraRequests filters by status='PendingApproval'", async () => {
    state.roleEntraMyRequests.push(
      {
        id: "r1",
        roleDefinitionId: "role-1",
        principalId: "me-id",
        status: "PendingApproval",
        action: "selfActivate",
      },
      {
        id: "r2",
        roleDefinitionId: "role-2",
        principalId: "me-id",
        status: "Granted",
        action: "selfActivate",
      },
    );
    const result = await listMyRoleEntraRequests(client, testSignal());
    expect(result.map((r) => r.id)).toEqual(["r1"]);
  });

  it("listRoleEntraApprovalRequests returns approver-side pending requests", async () => {
    state.seedRoleEntraPendingApproval({ roleDefinitionId: "role-1" });
    const result = await listRoleEntraApprovalRequests(client, testSignal());
    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe("PendingApproval");
  });

  it("requestRoleEntraActivation POSTs the expected body", async () => {
    const created = await requestRoleEntraActivation(
      client,
      {
        principalId: "me-id",
        roleDefinitionId: "role-1",
        directoryScopeId: "/",
        justification: "needed",
        scheduleInfo: {
          startDateTime: "2026-01-01T00:00:00Z",
          expiration: { type: "afterDuration", duration: "PT2H" },
        },
      },
      testSignal(),
    );
    expect(created.id).toBeTruthy();
    expect(state.submittedRequests).toHaveLength(1);
    const body = state.submittedRequests[0]?.body;
    expect(body).toMatchObject({
      action: "selfActivate",
      principalId: "me-id",
      roleDefinitionId: "role-1",
      directoryScopeId: "/",
      justification: "needed",
    });
  });

  it("requestRoleEntraDeactivation POSTs selfDeactivate without scheduleInfo", async () => {
    await requestRoleEntraDeactivation(
      client,
      {
        principalId: "me-id",
        roleDefinitionId: "role-1",
        directoryScopeId: "/",
        justification: "done",
      },
      testSignal(),
    );
    expect(state.submittedRequests).toHaveLength(1);
    const body = state.submittedRequests[0]?.body;
    expect(body).toMatchObject({
      action: "selfDeactivate",
      principalId: "me-id",
      roleDefinitionId: "role-1",
      directoryScopeId: "/",
      justification: "done",
    });
    expect(body).not.toHaveProperty("scheduleInfo");
  });

  it("approveRoleEntraAssignment patches the live step with reviewResult+justification", async () => {
    const { request } = state.seedRoleEntraPendingApproval({ roleDefinitionId: "role-1" });
    await approveRoleEntraAssignment(
      client,
      request.approvalId ?? "",
      ApprovalDecision.Approve,
      "ok",
      testSignal(),
    );
    expect(state.patchedStages).toHaveLength(1);
    expect(state.patchedStages[0]?.body).toEqual({ reviewResult: "Approve", justification: "ok" });
  });

  it("approveRoleEntraAssignment rejects when no live step matches", async () => {
    const approvalId = "ap-1";
    state.roleEntraApprovals.set(approvalId, {
      id: approvalId,
      steps: [
        {
          id: "step-1",
          assignedToMe: true,
          reviewResult: "Approve",
          status: "Completed",
        },
      ],
    });
    await expect(
      approveRoleEntraAssignment(client, approvalId, ApprovalDecision.Approve, "x", testSignal()),
    ).rejects.toThrow(/no live step/);
  });
});
