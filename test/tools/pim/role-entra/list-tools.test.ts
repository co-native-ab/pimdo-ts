// Unit tests for the read-only pim_role_entra_* list tools.

import { describe, it, expect } from "vitest";

import { ArmClient } from "../../../../src/arm/client.js";
import { GraphClient } from "../../../../src/graph/client.js";
import { StaticAuthenticator } from "../../../../src/auth.js";
import type { ServerConfig } from "../../../../src/index.js";
import { MockGraphState, createMockGraphServer } from "../../../mock-graph.js";
import { testSignal } from "../../../helpers.js";

import { pimRoleEntraActiveListTool } from "../../../../src/features/role-entra/tools/pim-role-entra-active-list.js";
import { pimRoleEntraApprovalListTool } from "../../../../src/features/role-entra/tools/pim-role-entra-approval-list.js";
import { pimRoleEntraEligibleListTool } from "../../../../src/features/role-entra/tools/pim-role-entra-eligible-list.js";
import { pimRoleEntraRequestListTool } from "../../../../src/features/role-entra/tools/pim-role-entra-request-list.js";

interface ToolResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

async function withState(
  fn: (state: MockGraphState, config: ServerConfig) => Promise<void>,
): Promise<void> {
  const state = new MockGraphState();
  const { server, url } = await createMockGraphServer(state);
  try {
    const config: ServerConfig = {
      authenticator: new StaticAuthenticator("fake-token"),
      graphBaseUrl: url,
      graphBetaBaseUrl: url,
      armBaseUrl: "http://127.0.0.1:1",
      configDir: "/tmp/pimdo-role-entra-list-tests",
      graphClient: new GraphClient(url, "fake-token"),
      graphBetaClient: new GraphClient(url, "fake-token"),
      armClient: new ArmClient("http://127.0.0.1:1", "fake-token"),
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

describe("pim_role_entra list tools", () => {
  it("eligible_list reports the empty state", async () => {
    await withState(async (_state, config) => {
      const res = await call(pimRoleEntraEligibleListTool, config);
      expect(res.content[0]?.text).toContain("No eligible");
    });
  });

  it("eligible_list lists seeded eligibilities", async () => {
    await withState(async (state, config) => {
      state.seedRoleEntraEligibility({
        roleDefinitionId: "role-1",
        roleDefinition: { id: "role-1", displayName: "Global Reader" },
      });
      const res = await call(pimRoleEntraEligibleListTool, config);
      expect(res.content[0]?.text).toContain("Global Reader");
      expect(res.content[0]?.text).toContain("Directory");
    });
  });

  it("active_list reports the empty state", async () => {
    await withState(async (_state, config) => {
      const res = await call(pimRoleEntraActiveListTool, config);
      expect(res.content[0]?.text).toContain("No active");
    });
  });

  it("request_list reports my pending requests", async () => {
    await withState(async (state, config) => {
      state.roleEntraMyRequests.push({
        id: "req-1",
        roleDefinitionId: "role-1",
        principalId: "me-id",
        action: "selfActivate",
        status: "PendingApproval",
        justification: "needed",
        roleDefinition: { id: "role-1", displayName: "Global Reader" },
      });
      const res = await call(pimRoleEntraRequestListTool, config);
      expect(res.content[0]?.text).toContain("Global Reader");
      expect(res.content[0]?.text).toContain("req-1");
    });
  });

  it("approval_list reports approver-side pending approvals", async () => {
    await withState(async (state, config) => {
      const { approval } = state.seedRoleEntraPendingApproval({
        roleDefinitionId: "role-2",
        roleDisplayName: "User Administrator",
      });
      const res = await call(pimRoleEntraApprovalListTool, config);
      expect(res.content[0]?.text).toContain("User Administrator");
      expect(res.content[0]?.text).toContain(approval.id);
    });
  });

  it("approval_list shows requester (by=UPN) and request status", async () => {
    await withState(async (state, config) => {
      state.seedRoleEntraPendingApproval({
        roleDefinitionId: "role-3",
        roleDisplayName: "Application Administrator",
        requesterPrincipalId: "alice-id",
        requesterDisplayName: "Alice",
      });
      const res = await call(pimRoleEntraApprovalListTool, config);
      const text = res.content[0]?.text ?? "";
      expect(text).toContain("by=other@example.com");
      expect(text).toContain("status=PendingApproval");
    });
  });

  it("request_list (mine) suppresses by= and renders status + created timestamp", async () => {
    await withState(async (state, config) => {
      state.roleEntraMyRequests.push({
        id: "req-2",
        roleDefinitionId: "role-4",
        principalId: "me-id",
        directoryScopeId: "/",
        action: "selfActivate",
        status: "PendingApproval",
        createdDateTime: "2026-05-15T08:18:15Z",
        roleDefinition: { id: "role-4", displayName: "Reports Reader" },
        principal: {
          id: "me-id",
          displayName: "Me",
          userPrincipalName: "me@example.com",
        },
      });
      const res = await call(pimRoleEntraRequestListTool, config);
      const text = res.content[0]?.text ?? "";
      expect(text).toContain("status=PendingApproval");
      expect(text).toContain("created=2026-05-15T08:18:15Z");
      expect(text).not.toContain("by=");
      // completed= is suppressed because the request hasn't completed yet —
      // the helper-level unit test covers the suppression rule directly.
      expect(text).not.toContain("completed=");
    });
  });

  it("request_list tags pending selfActivate as [stale] when (role+scope) eligibility is gone (#40)", async () => {
    await withState(async (state, config) => {
      // Eligible at root for role-1; pending at root for role-1 (live)
      // and at root for role-99 (stale, no eligibility).
      state.seedRoleEntraEligibility({
        roleDefinitionId: "role-1",
        directoryScopeId: "/",
        roleDefinition: { id: "role-1", displayName: "Reader" },
      });
      state.roleEntraMyRequests.push({
        id: "req-live",
        roleDefinitionId: "role-1",
        principalId: "me-id",
        directoryScopeId: "/",
        action: "selfActivate",
        status: "PendingApproval",
        roleDefinition: { id: "role-1", displayName: "Reader" },
      });
      state.roleEntraMyRequests.push({
        id: "req-stale",
        roleDefinitionId: "role-99",
        principalId: "me-id",
        directoryScopeId: "/",
        action: "selfActivate",
        status: "PendingApproval",
        roleDefinition: { id: "role-99", displayName: "Gone" },
      });
      const res = await call(pimRoleEntraRequestListTool, config);
      const text = res.content[0]?.text ?? "";
      const staleLine = text.split("\n").find((l) => l.includes("req-stale")) ?? "";
      const liveLine = text.split("\n").find((l) => l.includes("req-live")) ?? "";
      expect(staleLine).toContain("[stale]");
      expect(liveLine).not.toContain("[stale]");
    });
  });

  it("request_list distinguishes stale by directoryScopeId for the same role (#40)", async () => {
    await withState(async (state, config) => {
      // Eligible at AU scope only.
      state.seedRoleEntraEligibility({
        roleDefinitionId: "role-1",
        directoryScopeId: "/administrativeUnits/au-1",
      });
      // Pending at root (different scope) → stale.
      state.roleEntraMyRequests.push({
        id: "req-other-scope",
        roleDefinitionId: "role-1",
        principalId: "me-id",
        directoryScopeId: "/",
        action: "selfActivate",
        status: "PendingApproval",
        roleDefinition: { id: "role-1", displayName: "Reader" },
      });
      const res = await call(pimRoleEntraRequestListTool, config);
      expect(res.content[0]?.text).toContain("[stale]");
    });
  });

  it("approval_list tags entries with no live step assigned to me as [stale] (#40)", async () => {
    await withState(async (state, config) => {
      state.seedRoleEntraPendingApproval({
        roleDefinitionId: "role-live",
        roleDisplayName: "LiveRole",
      });
      const stale = state.seedRoleEntraPendingApproval({
        roleDefinitionId: "role-stale",
        roleDisplayName: "StaleRole",
        step: { status: "Completed", reviewResult: "Approve" },
      });
      const res = await call(pimRoleEntraApprovalListTool, config);
      const text = res.content[0]?.text ?? "";
      const staleLine = text.split("\n").find((l) => l.includes(stale.request.id)) ?? "";
      expect(staleLine).toContain("[stale]");
      expect(text.match(/\[stale\]/g)?.length ?? 0).toBe(1);
    });
  });
});

describe("pim_role_entra list tools error paths", () => {
  function brokenConfig(): ServerConfig {
    const dead = "http://127.0.0.1:1";
    return {
      authenticator: new StaticAuthenticator("fake-token"),
      graphBaseUrl: dead,
      graphBetaBaseUrl: dead,
      armBaseUrl: dead,
      configDir: "/tmp/pimdo-role-entra-list-tests-broken",
      graphClient: new GraphClient(dead, "fake-token"),
      graphBetaClient: new GraphClient(dead, "fake-token"),
      armClient: new ArmClient(dead, "fake-token"),
      openBrowser: () => Promise.resolve(),
    };
  }

  it.each([
    ["eligible_list", pimRoleEntraEligibleListTool],
    ["active_list", pimRoleEntraActiveListTool],
    ["request_list", pimRoleEntraRequestListTool],
    ["approval_list", pimRoleEntraApprovalListTool],
  ] as const)("%s surfaces an isError result when Graph is unreachable", async (_name, tool) => {
    const res = await call(tool, brokenConfig());
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toMatch(/fetch failed|ECONNREFUSED/i);
  });
});
