// End-to-end integration test for the PIM Entra-role tool surface.

import { describe, it, expect } from "vitest";

import { ArmClient } from "../../src/arm/client.js";
import { GraphClient } from "../../src/graph/client.js";
import { StaticAuthenticator } from "../../src/auth.js";
import type { ServerConfig } from "../../src/index.js";
import { MockGraphState, createMockGraphServer } from "../mock-graph.js";
import { fetchCsrfToken, testSignal } from "../helpers.js";

import { pimRoleEntraActiveListTool } from "../../src/tools/pim/role-entra/pim-role-entra-active-list.js";
import { pimRoleEntraApprovalListTool } from "../../src/tools/pim/role-entra/pim-role-entra-approval-list.js";
import { pimRoleEntraApprovalReviewTool } from "../../src/tools/pim/role-entra/pim-role-entra-approval-review.js";
import { pimRoleEntraDeactivateTool } from "../../src/tools/pim/role-entra/pim-role-entra-deactivate.js";
import { pimRoleEntraEligibleListTool } from "../../src/tools/pim/role-entra/pim-role-entra-eligible-list.js";
import { pimRoleEntraRequestListTool } from "../../src/tools/pim/role-entra/pim-role-entra-request-list.js";
import { pimRoleEntraRequestTool } from "../../src/tools/pim/role-entra/pim-role-entra-request.js";

interface Harness {
  config: ServerConfig;
  state: MockGraphState;
  capturedUrls: string[];
  shutdown: () => Promise<void>;
}

async function setupHarness(): Promise<Harness> {
  const state = new MockGraphState();
  const { server, url } = await createMockGraphServer(state);
  const auth = new StaticAuthenticator("fake-token");
  const graphClient = new GraphClient(url, "fake-token");
  const graphBetaClient = new GraphClient(url, "fake-token");
  const armClient = new ArmClient("http://127.0.0.1:1", "fake-token");
  const capturedUrls: string[] = [];
  const config: ServerConfig = {
    authenticator: auth,
    graphBaseUrl: url,
    graphBetaBaseUrl: url,
    armBaseUrl: "http://127.0.0.1:1",
    configDir: "/tmp/pimdo-role-entra-int",
    graphClient,
    graphBetaClient,
    armClient,
    openBrowser: (u: string): Promise<void> => {
      capturedUrls.push(u);
      return Promise.resolve();
    },
  };
  const shutdown = (): Promise<void> =>
    new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  return { config, state, capturedUrls, shutdown };
}

interface ToolResult {
  content: { type: string; text: string }[];
  isError?: boolean;
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
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined && (!predicate || predicate(value))) return value;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor: timed out waiting for value");
}

describe("pim_role_entra_* integration", () => {
  it("walks the full eligible → request → approve → active → deactivate flow", async () => {
    const harness = await setupHarness();
    try {
      const me = harness.state.me.id;
      harness.state.seedRoleEntraEligibility({
        id: "elig-1",
        roleDefinitionId: "role-1",
        principalId: me,
        directoryScopeId: "/",
        roleDefinition: { id: "role-1", displayName: "Global Reader", description: "read all" },
      });
      harness.state.directoryPolicyAssignments.push({
        scopeId: "/",
        roleDefinitionId: "role-1",
        maximumDuration: "PT8H",
      });

      // 1) eligible_list
      const eligibleRes = await callTool(pimRoleEntraEligibleListTool, harness.config, {});
      expect(eligibleRes.isError).toBeFalsy();
      expect(eligibleRes.content[0]?.text ?? "").toContain("Global Reader");
      expect(eligibleRes.content[0]?.text ?? "").toContain("elig-1");

      // 2) request — start the tool, then drive the loopback form.
      const requestPromise = callTool(pimRoleEntraRequestTool, harness.config, {
        items: [{ eligibilityId: "elig-1", justification: "On-call shift", duration: "PT2H" }],
      });

      const url = await waitFor(() => harness.capturedUrls.at(-1));
      const csrf = await fetchCsrfToken(url);
      const submitRes = await postJson(`${url}/submit`, {
        csrfToken: csrf,
        rows: [{ id: "elig-1", justification: "On-call shift", duration: "PT2H" }],
      });
      expect(submitRes.status).toBe(200);

      const requestResult = await requestPromise;
      expect(requestResult.isError).toBeFalsy();
      expect(requestResult.content[0]?.text ?? "").toContain("Global Reader");
      expect(harness.state.submittedRequests).toHaveLength(1);
      const submitted = harness.state.submittedRequests[0]!.body;
      expect(submitted["action"]).toBe("selfActivate");
      expect(submitted["principalId"]).toBe(me);
      expect(submitted["roleDefinitionId"]).toBe("role-1");
      expect(submitted["directoryScopeId"]).toBe("/");
      expect(submitted["justification"]).toBe("On-call shift");

      // 3) approval flow.
      const { approval } = harness.state.seedRoleEntraPendingApproval({
        roleDefinitionId: "role-2",
        roleDisplayName: "User Administrator",
        requesterDisplayName: "Bob",
        justification: "needs admin",
      });

      const apprList = await callTool(pimRoleEntraApprovalListTool, harness.config, {});
      expect(apprList.content[0]?.text ?? "").toContain("User Administrator");
      expect(apprList.content[0]?.text ?? "").toContain(approval.id);

      const reviewPromise = callTool(pimRoleEntraApprovalReviewTool, harness.config, {});
      const reviewUrl = await waitFor(
        () => harness.capturedUrls.at(-1),
        (last) => last !== url,
      );
      const reviewCsrf = await fetchCsrfToken(reviewUrl);
      const reviewSubmit = await postJson(`${reviewUrl}/submit`, {
        csrfToken: reviewCsrf,
        rows: [{ id: approval.id, decision: "Approve", justification: "OK by me" }],
      });
      expect(reviewSubmit.status).toBe(200);
      const reviewResult = await reviewPromise;
      expect(reviewResult.isError).toBeFalsy();
      expect(harness.state.patchedStages).toHaveLength(1);
      expect(harness.state.patchedStages[0]!.body["reviewResult"]).toBe("Approve");

      // 4) deactivate flow.
      harness.state.roleEntraAssignmentScheduleInstances.push({
        id: "instance-1",
        roleDefinitionId: "role-1",
        principalId: me,
        directoryScopeId: "/",
        endDateTime: "2099-01-01T00:00:00Z",
        roleDefinition: { id: "role-1", displayName: "Global Reader" },
      });

      const activeRes = await callTool(pimRoleEntraActiveListTool, harness.config, {});
      expect(activeRes.content[0]?.text ?? "").toContain("Global Reader");
      expect(activeRes.content[0]?.text ?? "").toContain("instance-1");

      const deactivatePromise = callTool(pimRoleEntraDeactivateTool, harness.config, {
        items: [{ instanceId: "instance-1", reason: "done" }],
      });
      const deactivateUrl = await waitFor(
        () => harness.capturedUrls.at(-1),
        (last) => last !== reviewUrl,
      );
      const deactivateCsrf = await fetchCsrfToken(deactivateUrl);
      const deactivateSubmit = await postJson(`${deactivateUrl}/submit`, {
        csrfToken: deactivateCsrf,
        rows: [{ id: "instance-1", reason: "done" }],
      });
      expect(deactivateSubmit.status).toBe(200);
      const deactivateResult = await deactivatePromise;
      expect(deactivateResult.isError).toBeFalsy();
      const deactivateBody =
        harness.state.submittedRequests[harness.state.submittedRequests.length - 1]!.body;
      expect(deactivateBody["action"]).toBe("selfDeactivate");
      expect(deactivateBody["roleDefinitionId"]).toBe("role-1");
      expect(deactivateBody["directoryScopeId"]).toBe("/");
      expect(deactivateBody["justification"]).toBe("done");

      // 5) request_list (returns nothing — myRequests not seeded).
      const myReqs = await callTool(pimRoleEntraRequestListTool, harness.config, {});
      expect(myReqs.content[0]?.text ?? "").toContain("No pending");
    } finally {
      await harness.shutdown();
    }
  });
});
