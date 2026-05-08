// Unit tests for the read-only pim_role_azure_* list tools.

import { describe, it, expect } from "vitest";

import { ArmClient } from "../../../../src/arm/client.js";
import { GraphClient } from "../../../../src/graph/client.js";
import { StaticAuthenticator } from "../../../../src/auth.js";
import type { ServerConfig } from "../../../../src/index.js";
import { MockArmState, createMockArmServer } from "../../../mock-arm.js";
import { testSignal } from "../../../helpers.js";

import { pimRoleAzureActiveListTool } from "../../../../src/tools/pim/role-azure/pim-role-azure-active-list.js";
import { pimRoleAzureApprovalListTool } from "../../../../src/tools/pim/role-azure/pim-role-azure-approval-list.js";
import { pimRoleAzureEligibleListTool } from "../../../../src/tools/pim/role-azure/pim-role-azure-eligible-list.js";
import { pimRoleAzureRequestListTool } from "../../../../src/tools/pim/role-azure/pim-role-azure-request-list.js";

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

  it("request_list surfaces non-pending statuses (e.g. Provisioned) without the misleading 'Pending' heading", async () => {
    await withState(async (state, config) => {
      state.myRequests.push({
        id: "/subscriptions/sub-a/providers/Microsoft.Authorization/roleAssignmentScheduleRequests/req-2",
        properties: {
          principalId: "me-id",
          roleDefinitionId: "role-2",
          scope: "/subscriptions/sub-a",
          requestType: "SelfActivate",
          status: "Provisioned",
          expandedProperties: {
            roleDefinition: { id: "role-2", displayName: "Reader" },
          },
        },
      });
      const res = await call(pimRoleAzureRequestListTool, config);
      expect(res.content[0]?.text).toContain("status=Provisioned");
      expect(res.content[0]?.text).not.toContain("Pending PIM Azure-role requests");
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
});
