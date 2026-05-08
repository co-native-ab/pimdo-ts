// Tests for src/graph/pim-group.ts driven by the PIM mock-graph.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type http from "node:http";

import { GraphClient } from "../../src/graph/client.js";
import {
  approveGroupAssignment,
  listActiveGroupAssignments,
  listEligibleGroupAssignments,
  listGroupApprovalRequests,
  listMyGroupRequests,
  requestGroupActivation,
  requestGroupDeactivation,
} from "../../src/graph/pim-group.js";
import { createMockGraphServer, MockGraphState } from "../mock-graph.js";
import { testSignal } from "../helpers.js";

describe("graph/pim-group", () => {
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

  it("listEligibleGroupAssignments returns seeded entries", async () => {
    state.seedEligibility({ groupId: "group-1" });
    state.seedEligibility({ groupId: "group-2" });
    const result = await listEligibleGroupAssignments(client, testSignal());
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.groupId)).toEqual(["group-1", "group-2"]);
  });

  it("listActiveGroupAssignments returns active instances", async () => {
    state.assignmentScheduleInstances.push({
      id: "active-1",
      groupId: "group-1",
      principalId: "me-id",
      accessId: "member",
    });
    const result = await listActiveGroupAssignments(client, testSignal());
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("active-1");
  });

  it("listMyGroupRequests filters by status='PendingApproval'", async () => {
    state.myRequests.push(
      {
        id: "r1",
        groupId: "g1",
        principalId: "me-id",
        status: "PendingApproval",
        action: "selfActivate",
      },
      {
        id: "r2",
        groupId: "g2",
        principalId: "me-id",
        status: "Granted",
        action: "selfActivate",
      },
    );
    const result = await listMyGroupRequests(client, testSignal());
    expect(result.map((r) => r.id)).toEqual(["r1"]);
  });

  it("listGroupApprovalRequests returns approver-side pending requests", async () => {
    state.seedPendingApproval({ groupId: "g1" });
    const result = await listGroupApprovalRequests(client, testSignal());
    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe("PendingApproval");
  });

  it("requestGroupActivation POSTs the expected body", async () => {
    const created = await requestGroupActivation(
      client,
      {
        principalId: "me-id",
        groupId: "g1",
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
      accessId: "member",
      action: "selfActivate",
      principalId: "me-id",
      groupId: "g1",
      justification: "needed",
    });
  });

  it("requestGroupDeactivation POSTs selfDeactivate without scheduleInfo", async () => {
    await requestGroupDeactivation(
      client,
      { principalId: "me-id", groupId: "g1", justification: "done" },
      testSignal(),
    );
    expect(state.submittedRequests).toHaveLength(1);
    const body = state.submittedRequests[0]?.body;
    expect(body).toMatchObject({
      accessId: "member",
      action: "selfDeactivate",
      principalId: "me-id",
      groupId: "g1",
      justification: "done",
    });
    expect(body).not.toHaveProperty("scheduleInfo");
  });

  it("approveGroupAssignment patches the live stage with reviewResult+justification", async () => {
    const { request } = state.seedPendingApproval({ groupId: "g1" });
    await approveGroupAssignment(client, request.approvalId ?? "", "Approve", "ok", testSignal());
    expect(state.patchedStages).toHaveLength(1);
    expect(state.patchedStages[0]?.body).toEqual({ reviewResult: "Approve", justification: "ok" });
  });

  it("approveGroupAssignment rejects when no live stage matches", async () => {
    // Create an approval whose stage is already completed.
    const approvalId = "ap-1";
    state.approvals.set(approvalId, {
      id: approvalId,
      stages: [
        {
          id: "stage-1",
          assignedToMe: true,
          reviewResult: "Approve",
          status: "Completed",
        },
      ],
    });
    await expect(
      approveGroupAssignment(client, approvalId, "Approve", "x", testSignal()),
    ).rejects.toThrow(/no live stage/);
  });
});
