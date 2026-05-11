// Per-tool tests for the PIM Azure-role mutation tools (request,
// deactivate, approval_review). Mirrors the group / Entra-role mutation
// test files; covers error / cancel / no-match / per-row-error branches
// not exercised by the happy-path integration test in
// `test/integration/role-azure-flow.test.ts`.

import { describe, it, expect } from "vitest";

import { ArmClient } from "../../../../src/arm/client.js";
import { GraphClient } from "../../../../src/graph/client.js";
import { StaticAuthenticator } from "../../../../src/auth.js";
import type { ServerConfig } from "../../../../src/index.js";
import { MockArmState, createMockArmServer } from "../../../mock-arm.js";
import { MockGraphState, createMockGraphServer } from "../../../mock-graph.js";
import { fetchCsrfToken, testSignal } from "../../../helpers.js";

import { pimRoleAzureApprovalReviewTool } from "../../../../src/features/role-azure/tools/pim-role-azure-approval-review.js";
import { pimRoleAzureDeactivateTool } from "../../../../src/features/role-azure/tools/pim-role-azure-deactivate.js";
import { pimRoleAzureRequestTool } from "../../../../src/features/role-azure/tools/pim-role-azure-request.js";

interface ToolResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

interface Harness {
  config: ServerConfig;
  armState: MockArmState;
  graphState: MockGraphState;
  capturedUrls: string[];
  shutdown: () => Promise<void>;
}

async function setupHarness(opts?: {
  openBrowser?: (url: string) => Promise<void>;
  capturedUrls?: string[];
}): Promise<Harness> {
  const armState = new MockArmState();
  const armServer = await createMockArmServer(armState);
  const graphState = new MockGraphState();
  const graphServer = await createMockGraphServer(graphState);
  const capturedUrls = opts?.capturedUrls ?? [];
  const openBrowser =
    opts?.openBrowser ??
    ((u: string): Promise<void> => {
      capturedUrls.push(u);
      return Promise.resolve();
    });
  const config: ServerConfig = {
    authenticator: new StaticAuthenticator("fake-token"),
    graphBaseUrl: graphServer.url,
    graphBetaBaseUrl: graphServer.url,
    armBaseUrl: armServer.url,
    configDir: "/tmp/pimdo-role-azure-mutation-tests",
    graphClient: new GraphClient(graphServer.url, "fake-token"),
    graphBetaClient: new GraphClient(graphServer.url, "fake-token"),
    armClient: new ArmClient(armServer.url, "fake-token"),
    openBrowser,
  };
  return {
    config,
    armState,
    graphState,
    capturedUrls,
    shutdown: async (): Promise<void> => {
      await new Promise<void>((resolve) => {
        armServer.server.close(() => {
          resolve();
        });
      });
      await new Promise<void>((resolve) => {
        graphServer.server.close(() => {
          resolve();
        });
      });
    },
  };
}

async function callTool(
  tool: { handler: (config: ServerConfig) => unknown },
  config: ServerConfig,
  args: unknown,
): Promise<ToolResult> {
  type Cb = (a: unknown, extra: { signal: AbortSignal }) => Promise<ToolResult>;
  const cb = tool.handler(config) as Cb;
  return cb(args, { signal: testSignal() });
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function waitFor<T>(
  read: () => T | undefined,
  predicate?: (value: T) => boolean,
): Promise<T> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const value = read();
    if (value !== undefined && (!predicate || predicate(value))) return value;
    if (Date.now() >= deadline) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

const SCOPE = "/subscriptions/sub-a";
const ROLE_DEF = `${SCOPE}/providers/Microsoft.Authorization/roleDefinitions/role-1`;
const ELIG_ID = `${SCOPE}/providers/Microsoft.Authorization/roleEligibilityScheduleInstances/elig-1`;
const ACTIVE_ID = `${SCOPE}/providers/Microsoft.Authorization/roleAssignmentScheduleInstances/instance-1`;

// ---------------------------------------------------------------------------
// pim_role_azure_request
// ---------------------------------------------------------------------------

describe("pim_role_azure_request error / edge paths", () => {
  it("returns 'No PIM Azure-role eligibilities…' when nothing is eligible and no items are passed", async () => {
    const h = await setupHarness();
    try {
      const res = await callTool(pimRoleAzureRequestTool, h.config, {});
      expect(res.content[0]?.text).toContain("No PIM Azure-role eligibilities are available");
    } finally {
      await h.shutdown();
    }
  });

  it("returns 'None of the requested eligibility ids matched' when all items are unknown", async () => {
    const h = await setupHarness();
    try {
      h.armState.seedEligibility({ id: ELIG_ID, roleDefinitionId: ROLE_DEF, scope: SCOPE });
      const res = await callTool(pimRoleAzureRequestTool, h.config, {
        items: [{ eligibilityId: "ghost" }],
      });
      expect(res.content[0]?.text).toContain("None of the requested eligibility ids matched");
    } finally {
      await h.shutdown();
    }
  });

  it("returns 'Request cancelled.' when the user cancels the row form", async () => {
    const h = await setupHarness();
    try {
      h.armState.seedEligibility({ id: ELIG_ID, roleDefinitionId: ROLE_DEF, scope: SCOPE });
      h.armState.policyAssignments.push({
        scope: SCOPE,
        roleDefinitionId: ROLE_DEF,
        maximumDuration: "PT8H",
      });
      const promise = callTool(pimRoleAzureRequestTool, h.config, {});
      const url = await waitFor(() => h.capturedUrls.at(-1));
      const csrf = await fetchCsrfToken(url);
      await postJson(`${url}/cancel`, { csrfToken: csrf });
      const res = await promise;
      expect(res.content[0]?.text).toBe("Request cancelled.");
    } finally {
      await h.shutdown();
    }
  });

  it("warns + still proceeds when openBrowser rejects", async () => {
    const captured: string[] = [];
    const h = await setupHarness({
      capturedUrls: captured,
      openBrowser: (u) => {
        captured.push(u);
        return Promise.reject(new Error("xdg-open missing"));
      },
    });
    try {
      h.armState.seedEligibility({ id: ELIG_ID, roleDefinitionId: ROLE_DEF, scope: SCOPE });
      h.armState.policyAssignments.push({
        scope: SCOPE,
        roleDefinitionId: ROLE_DEF,
        maximumDuration: "PT8H",
      });
      const promise = callTool(pimRoleAzureRequestTool, h.config, {});
      const url = await waitFor(() => captured.at(-1));
      const csrf = await fetchCsrfToken(url);
      await postJson(`${url}/submit`, {
        csrfToken: csrf,
        rows: [{ id: ELIG_ID, justification: "go", duration: "PT2H" }],
      });
      const res = await promise;
      expect(res.content[0]?.text).toContain("Submitted 1 PIM Azure-role activation request(s)");
    } finally {
      await h.shutdown();
    }
  });

  it("rejects fabricated row ids at the flow boundary (defence-in-depth)", async () => {
    const h = await setupHarness();
    try {
      h.armState.seedEligibility({ id: ELIG_ID, roleDefinitionId: ROLE_DEF, scope: SCOPE });
      h.armState.policyAssignments.push({
        scope: SCOPE,
        roleDefinitionId: ROLE_DEF,
        maximumDuration: "PT8H",
      });
      const promise = callTool(pimRoleAzureRequestTool, h.config, {
        items: [{ eligibilityId: ELIG_ID }, { eligibilityId: "ghost" }],
      });
      const url = await waitFor(() => h.capturedUrls.at(-1));
      const csrf = await fetchCsrfToken(url);
      const rejectRes = await postJson(`${url}/submit`, {
        csrfToken: csrf,
        rows: [{ id: "fabricated", justification: "x", duration: "PT1H" }],
      });
      expect(rejectRes.status).toBe(500);
      await postJson(`${url}/submit`, {
        csrfToken: csrf,
        rows: [{ id: ELIG_ID, justification: "ok", duration: "PT1H" }],
      });
      const res = await promise;
      const text = res.content[0]?.text ?? "";
      expect(text).toContain("Submitted 1 PIM Azure-role activation request(s)");
      expect(text).toContain("Ignored unknown eligibility ids: ghost");
    } finally {
      await h.shutdown();
    }
  });

  it("returns 'Request failed:' when the initial ARM list call errors", async () => {
    const h = await setupHarness();
    await h.shutdown();
    const res = await callTool(pimRoleAzureRequestTool, h.config, {});
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("Request failed: ");
  });
});

// ---------------------------------------------------------------------------
// pim_role_azure_deactivate
// ---------------------------------------------------------------------------

describe("pim_role_azure_deactivate error / edge paths", () => {
  it("returns 'No active PIM Azure-role assignments to deactivate.' when nothing is active", async () => {
    const h = await setupHarness();
    try {
      const res = await callTool(pimRoleAzureDeactivateTool, h.config, {});
      expect(res.content[0]?.text).toContain("No active PIM Azure-role assignments to deactivate.");
    } finally {
      await h.shutdown();
    }
  });

  it("returns 'None of the requested instance ids matched' when all items are unknown", async () => {
    const h = await setupHarness();
    try {
      h.armState.seedEligibility({ id: ELIG_ID, roleDefinitionId: ROLE_DEF, scope: SCOPE });
      h.armState.seedActive({ id: ACTIVE_ID, roleDefinitionId: ROLE_DEF, scope: SCOPE });
      const res = await callTool(pimRoleAzureDeactivateTool, h.config, {
        items: [{ instanceId: "missing" }],
      });
      expect(res.content[0]?.text).toContain("None of the requested instance ids matched");
    } finally {
      await h.shutdown();
    }
  });

  it("returns 'Deactivation cancelled.' when the user cancels the row form", async () => {
    const h = await setupHarness();
    try {
      // listActiveRoleAzureAssignments derives scopes from eligibility; seed one.
      h.armState.seedEligibility({ id: ELIG_ID, roleDefinitionId: ROLE_DEF, scope: SCOPE });
      h.armState.seedActive({
        id: ACTIVE_ID,
        roleDefinitionId: ROLE_DEF,
        scope: SCOPE,
        endDateTime: "2099-01-01T00:00:00Z",
      });
      const promise = callTool(pimRoleAzureDeactivateTool, h.config, {});
      const url = await waitFor(() => h.capturedUrls.at(-1));
      const csrf = await fetchCsrfToken(url);
      await postJson(`${url}/cancel`, { csrfToken: csrf });
      const res = await promise;
      expect(res.content[0]?.text).toBe("Deactivation cancelled.");
    } finally {
      await h.shutdown();
    }
  });

  it("rejects fabricated row ids at the flow boundary (defence-in-depth)", async () => {
    const h = await setupHarness();
    try {
      h.armState.seedEligibility({ id: ELIG_ID, roleDefinitionId: ROLE_DEF, scope: SCOPE });
      h.armState.seedActive({ id: ACTIVE_ID, roleDefinitionId: ROLE_DEF, scope: SCOPE });
      const promise = callTool(pimRoleAzureDeactivateTool, h.config, {
        items: [{ instanceId: ACTIVE_ID }, { instanceId: "ghost" }],
      });
      const url = await waitFor(() => h.capturedUrls.at(-1));
      const csrf = await fetchCsrfToken(url);
      const rejectRes = await postJson(`${url}/submit`, {
        csrfToken: csrf,
        rows: [{ id: "fabricated", reason: "x" }],
      });
      expect(rejectRes.status).toBe(500);
      await postJson(`${url}/submit`, {
        csrfToken: csrf,
        rows: [{ id: ACTIVE_ID, reason: "done" }],
      });
      const res = await promise;
      const text = res.content[0]?.text ?? "";
      expect(text).toContain("Submitted 1 PIM Azure-role deactivation request(s)");
      expect(text).toContain("Ignored unknown instance ids: ghost");
    } finally {
      await h.shutdown();
    }
  });

  it("returns 'Deactivation failed:' when the initial ARM list call errors", async () => {
    const h = await setupHarness();
    await h.shutdown();
    const res = await callTool(pimRoleAzureDeactivateTool, h.config, {});
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("Deactivation failed: ");
  });
});

// ---------------------------------------------------------------------------
// pim_role_azure_approval_review
// ---------------------------------------------------------------------------

describe("pim_role_azure_approval_review error / edge paths", () => {
  it("returns 'No pending PIM Azure-role approvals…' when there are none", async () => {
    const h = await setupHarness();
    try {
      const res = await callTool(pimRoleAzureApprovalReviewTool, h.config, {});
      expect(res.content[0]?.text).toContain(
        "No pending PIM Azure-role approvals assigned to you.",
      );
    } finally {
      await h.shutdown();
    }
  });

  it("returns 'None of the requested approval ids matched' when all items are unknown", async () => {
    const h = await setupHarness();
    try {
      h.armState.seedPendingApproval({ roleDefinitionId: ROLE_DEF, scope: SCOPE });
      const res = await callTool(pimRoleAzureApprovalReviewTool, h.config, {
        items: [{ approvalId: "ghost" }],
      });
      expect(res.content[0]?.text).toContain("None of the requested approval ids matched");
    } finally {
      await h.shutdown();
    }
  });

  it("returns 'Approval review cancelled.' when the user cancels the row form", async () => {
    const h = await setupHarness();
    try {
      h.armState.seedPendingApproval({ roleDefinitionId: ROLE_DEF, scope: SCOPE });
      const promise = callTool(pimRoleAzureApprovalReviewTool, h.config, {});
      const url = await waitFor(() => h.capturedUrls.at(-1));
      const csrf = await fetchCsrfToken(url);
      await postJson(`${url}/cancel`, { csrfToken: csrf });
      const res = await promise;
      expect(res.content[0]?.text).toBe("Approval review cancelled.");
    } finally {
      await h.shutdown();
    }
  });

  it("returns 'Approval review failed:' when the initial ARM list call errors", async () => {
    const h = await setupHarness();
    await h.shutdown();
    const res = await callTool(pimRoleAzureApprovalReviewTool, h.config, {});
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("Approval review failed: ");
  });
});
