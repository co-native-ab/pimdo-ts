// Per-tool tests for the PIM Entra-role mutation tools (request,
// deactivate, approval_review). Focuses on the error / cancel / no-match
// / per-row-error branches not exercised by the happy-path integration
// test in `test/integration/role-entra-flow.test.ts`.

import { describe, it, expect } from "vitest";

import { ArmClient } from "../../../../src/arm/client.js";
import { GraphClient } from "../../../../src/graph/client.js";
import { StaticAuthenticator } from "../../../../src/auth.js";
import type { ServerConfig } from "../../../../src/index.js";
import { MockGraphState, createMockGraphServer } from "../../../mock-graph.js";
import { fetchCsrfToken, testSignal } from "../../../helpers.js";

import { pimRoleEntraApprovalReviewTool } from "../../../../src/features/role-entra/tools/pim-role-entra-approval-review.js";
import { pimRoleEntraDeactivateTool } from "../../../../src/features/role-entra/tools/pim-role-entra-deactivate.js";
import { pimRoleEntraRequestCancelTool } from "../../../../src/features/role-entra/tools/pim-role-entra-request-cancel.js";
import { pimRoleEntraRequestTool } from "../../../../src/features/role-entra/tools/pim-role-entra-request.js";

interface ToolResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

interface Harness {
  config: ServerConfig;
  state: MockGraphState;
  capturedUrls: string[];
  shutdown: () => Promise<void>;
}

async function setupHarness(opts?: {
  openBrowser?: (url: string) => Promise<void>;
  capturedUrls?: string[];
}): Promise<Harness> {
  const state = new MockGraphState();
  const { server, url } = await createMockGraphServer(state);
  const capturedUrls = opts?.capturedUrls ?? [];
  const openBrowser =
    opts?.openBrowser ??
    ((u: string): Promise<void> => {
      capturedUrls.push(u);
      return Promise.resolve();
    });
  const config: ServerConfig = {
    authenticator: new StaticAuthenticator("fake-token"),
    graphBaseUrl: url,
    graphBetaBaseUrl: url,
    armBaseUrl: "http://127.0.0.1:1",
    configDir: "/tmp/pimdo-role-entra-mutation-tests",
    graphClient: new GraphClient(url, "fake-token"),
    graphBetaClient: new GraphClient(url, "fake-token"),
    armClient: new ArmClient("http://127.0.0.1:1", "fake-token"),
    openBrowser,
  };
  return {
    config,
    state,
    capturedUrls,
    shutdown: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
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

// ---------------------------------------------------------------------------
// pim_role_entra_request
// ---------------------------------------------------------------------------

describe("pim_role_entra_request error / edge paths", () => {
  it("returns 'No PIM Entra-role eligibilities…' when nothing is eligible and no items are passed", async () => {
    const h = await setupHarness();
    try {
      const res = await callTool(pimRoleEntraRequestTool, h.config, {});
      expect(res.isError).toBeFalsy();
      expect(res.content[0]?.text).toContain("No PIM Entra-role eligibilities are available");
    } finally {
      await h.shutdown();
    }
  });

  it("returns 'None of the requested eligibility ids matched' when all items are unknown", async () => {
    const h = await setupHarness();
    try {
      h.state.seedRoleEntraEligibility({
        id: "elig-1",
        roleDefinitionId: "role-1",
        roleDefinition: { id: "role-1", displayName: "Global Reader" },
      });
      const res = await callTool(pimRoleEntraRequestTool, h.config, {
        items: [{ eligibilityId: "missing-a" }, { eligibilityId: "missing-b" }],
      });
      expect(res.content[0]?.text).toContain("None of the requested eligibility ids matched");
      expect(res.content[0]?.text).toContain("missing-a, missing-b");
    } finally {
      await h.shutdown();
    }
  });

  it("returns 'Request cancelled.' when the user cancels the row form", async () => {
    const h = await setupHarness();
    try {
      h.state.seedRoleEntraEligibility({
        id: "elig-1",
        roleDefinitionId: "role-1",
        roleDefinition: { id: "role-1", displayName: "Global Reader" },
      });
      h.state.directoryPolicyAssignments.push({
        scopeId: "/",
        roleDefinitionId: "role-1",
        maximumDuration: "PT8H",
      });
      const promise = callTool(pimRoleEntraRequestTool, h.config, {});
      const url = await waitFor(() => h.capturedUrls.at(-1));
      const csrf = await fetchCsrfToken(url);
      await postJson(`${url}/cancel`, { csrfToken: csrf });
      const res = await promise;
      expect(res.isError).toBeFalsy();
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
      h.state.seedRoleEntraEligibility({
        id: "elig-1",
        roleDefinitionId: "role-1",
        roleDefinition: { id: "role-1", displayName: "Global Reader" },
      });
      h.state.directoryPolicyAssignments.push({
        scopeId: "/",
        roleDefinitionId: "role-1",
        maximumDuration: "PT8H",
      });
      const promise = callTool(pimRoleEntraRequestTool, h.config, {});
      const url = await waitFor(() => captured.at(-1));
      const csrf = await fetchCsrfToken(url);
      await postJson(`${url}/submit`, {
        csrfToken: csrf,
        rows: [{ id: "elig-1", justification: "go", duration: "PT2H" }],
      });
      const res = await promise;
      expect(res.isError).toBeFalsy();
      expect(res.content[0]?.text).toContain("Submitted 1 PIM Entra-role activation request(s)");
    } finally {
      await h.shutdown();
    }
  });

  it("rejects fabricated row ids at the flow boundary (defence-in-depth)", async () => {
    const h = await setupHarness();
    try {
      h.state.seedRoleEntraEligibility({
        id: "elig-1",
        roleDefinitionId: "role-1",
        roleDefinition: { id: "role-1", displayName: "Global Reader" },
      });
      h.state.directoryPolicyAssignments.push({
        scopeId: "/",
        roleDefinitionId: "role-1",
        maximumDuration: "PT8H",
      });
      const promise = callTool(pimRoleEntraRequestTool, h.config, {
        items: [
          { eligibilityId: "elig-1", justification: "ok", duration: "PT1H" },
          { eligibilityId: "ghost", justification: "x", duration: "PT1H" },
        ],
      });
      const url = await waitFor(() => h.capturedUrls.at(-1));
      const csrf = await fetchCsrfToken(url);
      // The flow rejects a fabricated row id with HTTP 500 — the handler
      // never sees it.
      const rejectRes = await postJson(`${url}/submit`, {
        csrfToken: csrf,
        rows: [{ id: "fabricated", justification: "x", duration: "PT1H" }],
      });
      expect(rejectRes.status).toBe(500);
      await postJson(`${url}/submit`, {
        csrfToken: csrf,
        rows: [{ id: "elig-1", justification: "ok", duration: "PT1H" }],
      });
      const res = await promise;
      const text = res.content[0]?.text ?? "";
      expect(text).toContain("Submitted 1 PIM Entra-role activation request(s)");
      expect(text).toContain("Ignored unknown eligibility ids: ghost");
    } finally {
      await h.shutdown();
    }
  });

  it("returns 'Request failed:' when the initial Graph list call errors", async () => {
    const h = await setupHarness();
    // Shut the mock server down so the very first list call fails fast.
    await h.shutdown();
    const res = await callTool(pimRoleEntraRequestTool, h.config, {});
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("Request failed: ");
    expect(res.content[0]?.text).toContain("can call this tool again");
  });
});

// ---------------------------------------------------------------------------
// pim_role_entra_deactivate
// ---------------------------------------------------------------------------

describe("pim_role_entra_deactivate error / edge paths", () => {
  it("returns 'No active PIM Entra-role assignments to deactivate.' when nothing is active", async () => {
    const h = await setupHarness();
    try {
      const res = await callTool(pimRoleEntraDeactivateTool, h.config, {});
      expect(res.content[0]?.text).toContain("No active PIM Entra-role assignments to deactivate.");
    } finally {
      await h.shutdown();
    }
  });

  it("returns 'None of the requested instance ids matched' when all items are unknown", async () => {
    const h = await setupHarness();
    try {
      h.state.roleEntraAssignmentScheduleInstances.push({
        id: "instance-1",
        roleDefinitionId: "role-1",
        principalId: h.state.me.id,
        directoryScopeId: "/",
        roleDefinition: { id: "role-1", displayName: "Global Reader" },
      });
      const res = await callTool(pimRoleEntraDeactivateTool, h.config, {
        items: [{ instanceId: "missing" }],
      });
      expect(res.content[0]?.text).toContain("None of the requested instance ids matched");
      expect(res.content[0]?.text).toContain("missing");
    } finally {
      await h.shutdown();
    }
  });

  it("returns 'Deactivation cancelled.' when the user cancels the row form", async () => {
    const h = await setupHarness();
    try {
      h.state.roleEntraAssignmentScheduleInstances.push({
        id: "instance-1",
        roleDefinitionId: "role-1",
        principalId: h.state.me.id,
        directoryScopeId: "/",
        endDateTime: "2099-01-01T00:00:00Z",
        roleDefinition: { id: "role-1", displayName: "Global Reader" },
      });
      const promise = callTool(pimRoleEntraDeactivateTool, h.config, {});
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
      h.state.roleEntraAssignmentScheduleInstances.push({
        id: "instance-1",
        roleDefinitionId: "role-1",
        principalId: h.state.me.id,
        directoryScopeId: "/",
        roleDefinition: { id: "role-1", displayName: "Global Reader" },
      });
      const promise = callTool(pimRoleEntraDeactivateTool, h.config, {
        items: [{ instanceId: "instance-1" }, { instanceId: "ghost" }],
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
        rows: [{ id: "instance-1", reason: "done" }],
      });
      const res = await promise;
      const text = res.content[0]?.text ?? "";
      expect(text).toContain("Submitted 1 PIM Entra-role deactivation request(s)");
      expect(text).toContain("Ignored unknown instance ids: ghost");
    } finally {
      await h.shutdown();
    }
  });

  it("returns 'Deactivation failed:' when the initial Graph list call errors", async () => {
    const h = await setupHarness();
    await h.shutdown();
    const res = await callTool(pimRoleEntraDeactivateTool, h.config, {});
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("Deactivation failed: ");
  });
});

// ---------------------------------------------------------------------------
// pim_role_entra_approval_review
// ---------------------------------------------------------------------------

describe("pim_role_entra_approval_review error / edge paths", () => {
  it("returns 'No pending PIM Entra-role approvals…' when there are none", async () => {
    const h = await setupHarness();
    try {
      const res = await callTool(pimRoleEntraApprovalReviewTool, h.config, {});
      expect(res.content[0]?.text).toContain(
        "No pending PIM Entra-role approvals assigned to you.",
      );
    } finally {
      await h.shutdown();
    }
  });

  it("returns 'None of the requested approval ids matched' when all items are unknown", async () => {
    const h = await setupHarness();
    try {
      h.state.seedRoleEntraPendingApproval({
        roleDefinitionId: "role-2",
        roleDisplayName: "User Administrator",
      });
      const res = await callTool(pimRoleEntraApprovalReviewTool, h.config, {
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
      h.state.seedRoleEntraPendingApproval({
        roleDefinitionId: "role-2",
        roleDisplayName: "User Administrator",
      });
      const promise = callTool(pimRoleEntraApprovalReviewTool, h.config, {});
      const url = await waitFor(() => h.capturedUrls.at(-1));
      const csrf = await fetchCsrfToken(url);
      await postJson(`${url}/cancel`, { csrfToken: csrf });
      const res = await promise;
      expect(res.content[0]?.text).toBe("Approval review cancelled.");
    } finally {
      await h.shutdown();
    }
  });

  it("returns 'Approval review failed:' when the initial Graph list call errors", async () => {
    const h = await setupHarness();
    await h.shutdown();
    const res = await callTool(pimRoleEntraApprovalReviewTool, h.config, {});
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("Approval review failed: ");
  });
});

// ---------------------------------------------------------------------------
// pim_role_entra_request_cancel
// ---------------------------------------------------------------------------

describe("pim_role_entra_request_cancel error / edge paths", () => {
  it("returns 'No pending PIM Entra-role requests to cancel.' when nothing is pending", async () => {
    const h = await setupHarness();
    try {
      const res = await callTool(pimRoleEntraRequestCancelTool, h.config, {});
      expect(res.content[0]?.text).toContain("No pending PIM Entra-role requests to cancel.");
    } finally {
      await h.shutdown();
    }
  });

  it("returns 'None of the requested request ids matched' when all items are unknown", async () => {
    const h = await setupHarness();
    try {
      h.state.roleEntraMyRequests.push({
        id: "role-req-1",
        roleDefinitionId: "role-def-1",
        principalId: h.state.me.id,
        directoryScopeId: "/",
        action: "selfActivate",
        status: "PendingApproval",
        roleDefinition: { id: "role-def-1", displayName: "Role One" },
      });
      const res = await callTool(pimRoleEntraRequestCancelTool, h.config, {
        items: [{ requestId: "ghost" }],
      });
      expect(res.content[0]?.text).toContain("None of the requested request ids matched");
    } finally {
      await h.shutdown();
    }
  });

  it("submits the cancel POST on confirmation", async () => {
    const h = await setupHarness();
    try {
      h.state.roleEntraMyRequests.push({
        id: "role-req-1",
        roleDefinitionId: "role-def-1",
        principalId: h.state.me.id,
        directoryScopeId: "/",
        action: "selfActivate",
        status: "PendingApproval",
        roleDefinition: { id: "role-def-1", displayName: "Role One" },
      });
      const promise = callTool(pimRoleEntraRequestCancelTool, h.config, {});
      const url = await waitFor(() => h.capturedUrls.at(-1));
      const csrf = await fetchCsrfToken(url);
      await postJson(`${url}/submit`, {
        csrfToken: csrf,
        rows: [{ id: "role-req-1" }],
      });
      const res = await promise;
      expect(res.content[0]?.text).toContain("Submitted 1 PIM Entra-role cancellation(s)");
      expect(h.state.cancelledRequests.some((c) => c.path.endsWith("/role-req-1/cancel"))).toBe(
        true,
      );
    } finally {
      await h.shutdown();
    }
  });

  it("returns 'Cancellation cancelled.' when the user cancels the row form", async () => {
    const h = await setupHarness();
    try {
      h.state.roleEntraMyRequests.push({
        id: "role-req-1",
        roleDefinitionId: "role-def-1",
        principalId: h.state.me.id,
        directoryScopeId: "/",
        action: "selfActivate",
        status: "PendingApproval",
        roleDefinition: { id: "role-def-1", displayName: "Role One" },
      });
      const promise = callTool(pimRoleEntraRequestCancelTool, h.config, {});
      const url = await waitFor(() => h.capturedUrls.at(-1));
      const csrf = await fetchCsrfToken(url);
      await postJson(`${url}/cancel`, { csrfToken: csrf });
      const res = await promise;
      expect(res.content[0]?.text).toBe("Cancellation cancelled.");
    } finally {
      await h.shutdown();
    }
  });

  it("returns 'Cancellation failed:' when the initial Graph list call errors", async () => {
    const h = await setupHarness();
    await h.shutdown();
    const res = await callTool(pimRoleEntraRequestCancelTool, h.config, {});
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("Cancellation failed: ");
  });
});
