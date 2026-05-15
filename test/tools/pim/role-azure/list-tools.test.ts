// Unit tests for the read-only pim_role_azure_* list tools.

import { describe, it, expect } from "vitest";

import { ArmClient } from "../../../../src/arm/client.js";
import { GraphClient } from "../../../../src/graph/client.js";
import { StaticAuthenticator } from "../../../../src/auth.js";
import type { ServerConfig } from "../../../../src/index.js";
import { MockArmState, createMockArmServer } from "../../../mock-arm.js";
import { testSignal } from "../../../helpers.js";

import { pimRoleAzureActiveListTool } from "../../../../src/features/role-azure/tools/pim-role-azure-active-list.js";
import { pimRoleAzureApprovalListTool } from "../../../../src/features/role-azure/tools/pim-role-azure-approval-list.js";
import { pimRoleAzureEligibleListTool } from "../../../../src/features/role-azure/tools/pim-role-azure-eligible-list.js";
import { pimRoleAzureRequestListTool } from "../../../../src/features/role-azure/tools/pim-role-azure-request-list.js";

interface ToolResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

async function withState(
  fn: (state: MockArmState, config: ServerConfig) => Promise<void>,
): Promise<void> {
  const state = new MockArmState();
  const { server, url } = await createMockArmServer(state);
  try {
    const config: ServerConfig = {
      authenticator: new StaticAuthenticator("fake-token"),
      graphBaseUrl: "http://127.0.0.1:1",
      graphBetaBaseUrl: "http://127.0.0.1:1",
      armBaseUrl: url,
      configDir: "/tmp/pimdo-role-azure-list-tests",
      graphClient: new GraphClient("http://127.0.0.1:1", "fake-token"),
      graphBetaClient: new GraphClient("http://127.0.0.1:1", "fake-token"),
      armClient: new ArmClient(url, "fake-token"),
      openBrowser: () => Promise.resolve(),
    };
    await fn(state, config);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
}

async function call(
  tool: { handler: (config: ServerConfig) => unknown },
  config: ServerConfig,
): Promise<ToolResult> {
  type Cb = (a: unknown, extra: { signal: AbortSignal }) => Promise<ToolResult>;
  const cb = tool.handler(config) as Cb;
  return cb({}, { signal: testSignal() });
}

describe("pim_role_azure list tools", () => {
  it("eligible_list reports the empty state", async () => {
    await withState(async (_state, config) => {
      const res = await call(pimRoleAzureEligibleListTool, config);
      expect(res.content[0]?.text).toContain("No eligible");
    });
  });

  it("eligible_list lists seeded eligibilities", async () => {
    await withState(async (state, config) => {
      state.seedEligibility({
        roleDefinitionId: "role-1",
        scope: "/subscriptions/sub-a",
        roleDisplayName: "Owner",
      });
      const res = await call(pimRoleAzureEligibleListTool, config);
      expect(res.content[0]?.text).toContain("Owner");
      expect(res.content[0]?.text).toContain("/subscriptions/sub-a");
    });
  });

  it("active_list reports the empty state", async () => {
    await withState(async (_state, config) => {
      const res = await call(pimRoleAzureActiveListTool, config);
      expect(res.content[0]?.text).toContain("No active");
    });
  });

  it("active_list suppresses status=Provisioned and hides terminal-status rows", async () => {
    await withState(async (state, config) => {
      state.seedEligibility({
        roleDefinitionId: "role-1",
        scope: "/subscriptions/sub-a",
        roleDisplayName: "Reader",
      });
      state.seedActive({
        id: "/subscriptions/sub-a/providers/Microsoft.Authorization/roleAssignmentScheduleInstances/keep",
        roleDefinitionId: "role-1",
        scope: "/subscriptions/sub-a",
        roleDisplayName: "Reader",
        status: "Provisioned",
      });
      state.seedActive({
        id: "/subscriptions/sub-a/providers/Microsoft.Authorization/roleAssignmentScheduleInstances/drop",
        roleDefinitionId: "role-1",
        scope: "/subscriptions/sub-a",
        roleDisplayName: "Reader",
        status: "Revoked",
      });
      const res = await call(pimRoleAzureActiveListTool, config);
      const text = res.content[0]?.text ?? "";
      // status=Provisioned is intentionally suppressed (steady-state noise);
      // see issue #38.
      expect(text).not.toContain("status=Provisioned");
      expect(text).toContain("/keep");
      expect(text).not.toContain("/drop");
      expect(text).not.toContain("status=Revoked");
    });
  });

  it("request_list reports my pending requests", async () => {
    await withState(async (state, config) => {
      state.myRequests.push({
        id: "/subscriptions/sub-a/providers/Microsoft.Authorization/roleAssignmentScheduleRequests/req-1",
        properties: {
          principalId: "me-id",
          roleDefinitionId: "role-1",
          scope: "/subscriptions/sub-a",
          requestType: "SelfActivate",
          status: "PendingApproval",
          expandedProperties: {
            roleDefinition: { id: "role-1", displayName: "Owner" },
          },
        },
      });
      const res = await call(pimRoleAzureRequestListTool, config);
      expect(res.content[0]?.text).toContain("Owner");
      expect(res.content[0]?.text).toContain("req-1");
      // status is surfaced inline in the REQUEST STATUS column and
      // the heading must NOT claim everything is "Pending" — the request
      // listing is not status-filtered server-side for ARM.
      expect(res.content[0]?.text).toContain("status=PendingApproval");
      expect(res.content[0]?.text).toMatch(/^PIM Azure-role requests submitted by you/m);
      expect(res.content[0]?.text).not.toContain("Pending PIM Azure-role requests");
    });
  });

  it("request_list surfaces non-Provisioned statuses (e.g. Granted) without the misleading 'Pending' heading", async () => {
    await withState(async (state, config) => {
      state.myRequests.push({
        id: "/subscriptions/sub-a/providers/Microsoft.Authorization/roleAssignmentScheduleRequests/req-2",
        properties: {
          principalId: "me-id",
          roleDefinitionId: "role-2",
          scope: "/subscriptions/sub-a",
          requestType: "SelfActivate",
          status: "Granted",
          expandedProperties: {
            roleDefinition: { id: "role-2", displayName: "Reader" },
          },
        },
      });
      const res = await call(pimRoleAzureRequestListTool, config);
      expect(res.content[0]?.text).toContain("status=Granted");
      expect(res.content[0]?.text).not.toContain("Pending PIM Azure-role requests");
    });
  });

  it("request_list (mine) does NOT include a `by=` requester tag", async () => {
    await withState(async (state, config) => {
      state.myRequests.push({
        id: "/subscriptions/sub-a/providers/Microsoft.Authorization/roleAssignmentScheduleRequests/req-3",
        properties: {
          principalId: "me-id",
          roleDefinitionId: "role-3",
          scope: "/subscriptions/sub-a",
          requestType: "SelfActivate",
          status: "PendingApproval",
          createdOn: "2026-05-15T08:18:15Z",
          expandedProperties: {
            principal: {
              id: "me-id",
              displayName: "Me",
              email: "me@example.com",
            },
            roleDefinition: { id: "role-3", displayName: "Reader" },
          },
        },
      });
      const res = await call(pimRoleAzureRequestListTool, config);
      const text = res.content[0]?.text ?? "";
      expect(text).toContain("created=2026-05-15T08:18:15Z");
      expect(text).not.toContain("by=");
    });
  });

  it("approval_list shows requester (by=) and createdOn for approver-perspective rows", async () => {
    await withState(async (state, config) => {
      state.seedPendingApproval({
        roleDefinitionId: "role-1",
        scope: "/subscriptions/sub-a",
        roleDisplayName: "Owner",
        requesterPrincipalId: "alice-id",
        requesterDisplayName: "Alice",
      });
      // Mock seeder doesn't expose `email` on ARM principals, so the
      // fallback should render the displayName.
      const res = await call(pimRoleAzureApprovalListTool, config);
      const text = res.content[0]?.text ?? "";
      expect(text).toContain("by=Alice");
      expect(text).toContain("status=PendingApproval");
    });
  });

  it("approval_list reports approver-side pending approvals", async () => {
    await withState(async (state, config) => {
      const req = state.seedPendingApproval({
        roleDefinitionId: "role-1",
        scope: "/subscriptions/sub-a",
        roleDisplayName: "Owner",
      });
      const res = await call(pimRoleAzureApprovalListTool, config);
      expect(res.content[0]?.text).toContain("Owner");
      expect(res.content[0]?.text).toContain(req.properties.approvalId ?? "");
    });
  });

  it("request_list tags pending SelfActivate as [stale] when (role+scope) eligibility is gone (#40)", async () => {
    await withState(async (state, config) => {
      state.seedEligibility({
        roleDefinitionId: "role-1",
        scope: "/subscriptions/sub-a",
        roleDisplayName: "Reader",
      });
      // Same role at a different subscription scope → stale.
      state.myRequests.push({
        id: "/subscriptions/sub-b/providers/Microsoft.Authorization/roleAssignmentScheduleRequests/req-stale",
        properties: {
          principalId: "me-id",
          roleDefinitionId: "role-1",
          scope: "/subscriptions/sub-b",
          requestType: "SelfActivate",
          status: "PendingApproval",
          expandedProperties: {
            roleDefinition: { id: "role-1", displayName: "Reader" },
            scope: { id: "/subscriptions/sub-b" },
          },
        },
      });
      // Same role+scope as the eligibility → live.
      state.myRequests.push({
        id: "/subscriptions/sub-a/providers/Microsoft.Authorization/roleAssignmentScheduleRequests/req-live",
        properties: {
          principalId: "me-id",
          roleDefinitionId: "role-1",
          scope: "/subscriptions/sub-a",
          requestType: "SelfActivate",
          status: "PendingApproval",
          expandedProperties: {
            roleDefinition: { id: "role-1", displayName: "Reader" },
            scope: { id: "/subscriptions/sub-a" },
          },
        },
      });
      const res = await call(pimRoleAzureRequestListTool, config);
      const text = res.content[0]?.text ?? "";
      const staleLine = text.split("\n").find((l) => l.includes("req-stale")) ?? "";
      const liveLine = text.split("\n").find((l) => l.includes("req-live")) ?? "";
      expect(staleLine).toContain("[stale]");
      expect(liveLine).not.toContain("[stale]");
    });
  });

  it("approval_list tags entries with no live stage assigned to me as [stale] (#40)", async () => {
    await withState(async (state, config) => {
      state.seedPendingApproval({
        roleDefinitionId: "role-live",
        scope: "/subscriptions/sub-a",
        roleDisplayName: "LiveRole",
      });
      const stale = state.seedPendingApproval({
        roleDefinitionId: "role-stale",
        scope: "/subscriptions/sub-a",
        roleDisplayName: "StaleRole",
        stages: [{ status: "Completed", reviewResult: "Approve", assignedToMe: true }],
      });
      const res = await call(pimRoleAzureApprovalListTool, config);
      const text = res.content[0]?.text ?? "";
      const staleLine =
        text.split("\n").find((l) => l.includes(stale.properties.approvalId ?? "")) ?? "";
      expect(staleLine).toContain("[stale]");
      expect(text.match(/\[stale\]/g)?.length ?? 0).toBe(1);
    });
  });
});

describe("pim_role_azure list tools error paths", () => {
  function brokenConfig(): ServerConfig {
    const dead = "http://127.0.0.1:1";
    return {
      authenticator: new StaticAuthenticator("fake-token"),
      graphBaseUrl: dead,
      graphBetaBaseUrl: dead,
      armBaseUrl: dead,
      configDir: "/tmp/pimdo-role-azure-list-tests-broken",
      graphClient: new GraphClient(dead, "fake-token"),
      graphBetaClient: new GraphClient(dead, "fake-token"),
      armClient: new ArmClient(dead, "fake-token"),
      openBrowser: () => Promise.resolve(),
    };
  }

  it.each([
    ["eligible_list", pimRoleAzureEligibleListTool],
    ["active_list", pimRoleAzureActiveListTool],
    ["request_list", pimRoleAzureRequestListTool],
    ["approval_list", pimRoleAzureApprovalListTool],
  ] as const)("%s surfaces an isError result when ARM is unreachable", async (_name, tool) => {
    const res = await call(tool, brokenConfig());
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toMatch(/fetch failed|ECONNREFUSED/i);
  });
});
