// Unit tests for the read-only pim_group_* list tools.
// Drives the tool handlers against the shared MockGraphState fake.

import { describe, it, expect } from "vitest";

import { ArmClient } from "../../../../src/arm/client.js";
import { GraphClient } from "../../../../src/graph/client.js";
import { StaticAuthenticator } from "../../../../src/auth.js";
import type { ServerConfig } from "../../../../src/index.js";
import { MockGraphState, createMockGraphServer } from "../../../mock-graph.js";
import { testSignal } from "../../../helpers.js";

import { pimGroupActiveListTool } from "../../../../src/tools/pim/group/pim-group-active-list.js";
import { pimGroupApprovalListTool } from "../../../../src/tools/pim/group/pim-group-approval-list.js";
import { pimGroupEligibleListTool } from "../../../../src/tools/pim/group/pim-group-eligible-list.js";
import { pimGroupRequestListTool } from "../../../../src/tools/pim/group/pim-group-request-list.js";

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
      configDir: "/tmp/pimdo-list-tests",
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

describe("pim_group list tools", () => {
  it("eligible_list reports the empty state", async () => {
    await withState(async (_state, config) => {
      const res = await call(pimGroupEligibleListTool, config);
      expect(res.content[0]?.text).toContain("No eligible");
    });
  });

  it("eligible_list lists seeded eligibilities", async () => {
    await withState(async (state, config) => {
      state.seedEligibility({
        groupId: "g1",
        group: { id: "g1", displayName: "Alpha" },
      });
      const res = await call(pimGroupEligibleListTool, config);
      expect(res.content[0]?.text).toContain("Alpha");
    });
  });

  it("active_list reports the empty state", async () => {
    await withState(async (_state, config) => {
      const res = await call(pimGroupActiveListTool, config);
      expect(res.content[0]?.text).toContain("No active");
    });
  });

  it("request_list reports my pending requests", async () => {
    await withState(async (state, config) => {
      state.myRequests.push({
        id: "req-1",
        groupId: "g1",
        principalId: "me-id",
        action: "selfActivate",
        status: "PendingApproval",
        justification: "needed",
        group: { id: "g1", displayName: "Alpha" },
      });
      const res = await call(pimGroupRequestListTool, config);
      expect(res.content[0]?.text).toContain("Alpha");
      expect(res.content[0]?.text).toContain("req-1");
    });
  });

  it("approval_list reports approver-side pending approvals", async () => {
    await withState(async (state, config) => {
      const { approval } = state.seedPendingApproval({
        groupId: "g2",
        groupDisplayName: "Beta",
      });
      const res = await call(pimGroupApprovalListTool, config);
      expect(res.content[0]?.text).toContain("Beta");
      expect(res.content[0]?.text).toContain(approval.id);
    });
  });
});

describe("pim_group list tools error paths", () => {
  // Build a config whose graph client points at a closed port so every
  // outbound request fails. This exercises the catch branch in each list
  // tool's handler (formatError).
  function brokenConfig(): ServerConfig {
    const dead = "http://127.0.0.1:1";
    return {
      authenticator: new StaticAuthenticator("fake-token"),
      graphBaseUrl: dead,
      graphBetaBaseUrl: dead,
      armBaseUrl: dead,
      configDir: "/tmp/pimdo-list-tests-broken",
      graphClient: new GraphClient(dead, "fake-token"),
      graphBetaClient: new GraphClient(dead, "fake-token"),
      armClient: new ArmClient(dead, "fake-token"),
      openBrowser: () => Promise.resolve(),
    };
  }

  it.each([
    ["eligible_list", pimGroupEligibleListTool],
    ["active_list", pimGroupActiveListTool],
    ["request_list", pimGroupRequestListTool],
    ["approval_list", pimGroupApprovalListTool],
  ] as const)("%s surfaces an isError result when Graph is unreachable", async (_name, tool) => {
    const res = await call(tool, brokenConfig());
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toMatch(/fetch failed|ECONNREFUSED/i);
  });
});
