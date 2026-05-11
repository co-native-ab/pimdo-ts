// Per-tool tests for the PIM group mutation tools (request, deactivate,
// approval_review). Mirrors the Entra-role mutation-tools suite, focused
// on error / cancel / no-match / per-row-error branches not covered by
// the happy-path integration test in `test/integration/group-flow.test.ts`.

import { describe, it, expect } from "vitest";

import { ArmClient } from "../../../../src/arm/client.js";
import { GraphClient } from "../../../../src/graph/client.js";
import { StaticAuthenticator } from "../../../../src/auth.js";
import type { ServerConfig } from "../../../../src/index.js";
import { MockGraphState, createMockGraphServer } from "../../../mock-graph.js";
import { fetchCsrfToken, testSignal } from "../../../helpers.js";

import { pimGroupApprovalReviewTool } from "../../../../src/features/group/tools/pim-group-approval-review.js";
import { pimGroupDeactivateTool } from "../../../../src/features/group/tools/pim-group-deactivate.js";
import { pimGroupRequestTool } from "../../../../src/features/group/tools/pim-group-request.js";

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
    configDir: "/tmp/pimdo-group-mutation-tests",
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
// pim_group_request
// ---------------------------------------------------------------------------

describe("pim_group_request error / edge paths", () => {
  it("returns 'No PIM group eligibilities…' when nothing is eligible and no items are passed", async () => {
    const h = await setupHarness();
    try {
      const res = await callTool(pimGroupRequestTool, h.config, {});
      expect(res.content[0]?.text).toContain("No PIM group eligibilities are available");
    } finally {
      await h.shutdown();
    }
  });

  it("returns 'None of the requested eligibility ids matched' when all items are unknown", async () => {
    const h = await setupHarness();
    try {
      h.state.seedEligibility({
        id: "elig-1",
        groupId: "group-1",
        group: { id: "group-1", displayName: "Group One" },
      });
      const res = await callTool(pimGroupRequestTool, h.config, {
        items: [{ eligibilityId: "ghost" }],
      });
      expect(res.content[0]?.text).toContain("None of the requested eligibility ids matched");
      expect(res.content[0]?.text).toContain("ghost");
    } finally {
      await h.shutdown();
    }
  });

  it("returns 'Request cancelled.' when the user cancels the row form", async () => {
    const h = await setupHarness();
    try {
      h.state.seedEligibility({
        id: "elig-1",
        groupId: "group-1",
        group: { id: "group-1", displayName: "Group One" },
      });
      h.state.policyAssignments.push({ groupId: "group-1", maximumDuration: "PT8H" });
      const promise = callTool(pimGroupRequestTool, h.config, {});
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
      h.state.seedEligibility({
        id: "elig-1",
        groupId: "group-1",
        group: { id: "group-1", displayName: "Group One" },
      });
      h.state.policyAssignments.push({ groupId: "group-1", maximumDuration: "PT8H" });
      const promise = callTool(pimGroupRequestTool, h.config, {});
      const url = await waitFor(() => captured.at(-1));
      const csrf = await fetchCsrfToken(url);
      await postJson(`${url}/submit`, {
        csrfToken: csrf,
        rows: [{ id: "elig-1", justification: "go", duration: "PT2H" }],
      });
      const res = await promise;
      expect(res.content[0]?.text).toContain("Submitted 1 PIM group activation request(s)");
    } finally {
      await h.shutdown();
    }
  });

  it("rejects fabricated row ids at the flow boundary (defence-in-depth)", async () => {
    const h = await setupHarness();
    try {
      h.state.seedEligibility({
        id: "elig-1",
        groupId: "group-1",
        group: { id: "group-1", displayName: "Group One" },
      });
      h.state.policyAssignments.push({ groupId: "group-1", maximumDuration: "PT8H" });
      const promise = callTool(pimGroupRequestTool, h.config, {
        items: [{ eligibilityId: "elig-1" }, { eligibilityId: "ghost" }],
      });
      const url = await waitFor(() => h.capturedUrls.at(-1));
      const csrf = await fetchCsrfToken(url);
      // Fabricated id is rejected by the flow before the handler is invoked.
      const rejectRes = await postJson(`${url}/submit`, {
        csrfToken: csrf,
        rows: [{ id: "fabricated", justification: "x", duration: "PT1H" }],
      });
      expect(rejectRes.status).toBe(500);
      // A second submission with only the legitimate row succeeds.
      await postJson(`${url}/submit`, {
        csrfToken: csrf,
        rows: [{ id: "elig-1", justification: "ok", duration: "PT1H" }],
      });
      const res = await promise;
      const text = res.content[0]?.text ?? "";
      expect(text).toContain("Submitted 1 PIM group activation request(s)");
      expect(text).toContain("Ignored unknown eligibility ids: ghost");
    } finally {
      await h.shutdown();
    }
  });

  it("returns 'Request failed:' when the initial Graph list call errors", async () => {
    const h = await setupHarness();
    await h.shutdown();
    const res = await callTool(pimGroupRequestTool, h.config, {});
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("Request failed: ");
  });
});

// ---------------------------------------------------------------------------
// pim_group_deactivate
// ---------------------------------------------------------------------------

describe("pim_group_deactivate error / edge paths", () => {
  it("returns 'No active PIM group assignments to deactivate.' when nothing is active", async () => {
    const h = await setupHarness();
    try {
      const res = await callTool(pimGroupDeactivateTool, h.config, {});
      expect(res.content[0]?.text).toContain("No active PIM group assignments to deactivate.");
    } finally {
      await h.shutdown();
    }
  });

  it("returns 'None of the requested instance ids matched' when all items are unknown", async () => {
    const h = await setupHarness();
    try {
      h.state.assignmentScheduleInstances.push({
        id: "instance-1",
        groupId: "group-1",
        principalId: h.state.me.id,
        accessId: "member",
        memberType: "Direct",
        group: { id: "group-1", displayName: "Group One" },
      });
      const res = await callTool(pimGroupDeactivateTool, h.config, {
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
      h.state.assignmentScheduleInstances.push({
        id: "instance-1",
        groupId: "group-1",
        principalId: h.state.me.id,
        accessId: "member",
        memberType: "Direct",
        endDateTime: "2099-01-01T00:00:00Z",
        group: { id: "group-1", displayName: "Group One" },
      });
      const promise = callTool(pimGroupDeactivateTool, h.config, {});
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
      h.state.assignmentScheduleInstances.push({
        id: "instance-1",
        groupId: "group-1",
        principalId: h.state.me.id,
        accessId: "member",
        memberType: "Direct",
        group: { id: "group-1", displayName: "Group One" },
      });
      const promise = callTool(pimGroupDeactivateTool, h.config, {
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
      expect(text).toContain("Submitted 1 PIM group deactivation request(s)");
      expect(text).toContain("Ignored unknown instance ids: ghost");
    } finally {
      await h.shutdown();
    }
  });

  it("returns 'Deactivation failed:' when the initial Graph list call errors", async () => {
    const h = await setupHarness();
    await h.shutdown();
    const res = await callTool(pimGroupDeactivateTool, h.config, {});
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("Deactivation failed: ");
  });
});

// ---------------------------------------------------------------------------
// pim_group_approval_review
// ---------------------------------------------------------------------------

describe("pim_group_approval_review error / edge paths", () => {
  it("returns 'No pending PIM group approvals…' when there are none", async () => {
    const h = await setupHarness();
    try {
      const res = await callTool(pimGroupApprovalReviewTool, h.config, {});
      expect(res.content[0]?.text).toContain("No pending PIM group approvals assigned to you.");
    } finally {
      await h.shutdown();
    }
  });

  it("returns 'None of the requested approval ids matched' when all items are unknown", async () => {
    const h = await setupHarness();
    try {
      h.state.seedPendingApproval({ groupId: "group-2", groupDisplayName: "Group Two" });
      const res = await callTool(pimGroupApprovalReviewTool, h.config, {
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
      h.state.seedPendingApproval({ groupId: "group-2", groupDisplayName: "Group Two" });
      const promise = callTool(pimGroupApprovalReviewTool, h.config, {});
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
    const res = await callTool(pimGroupApprovalReviewTool, h.config, {});
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("Approval review failed: ");
  });
});
