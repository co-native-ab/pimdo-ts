// End-to-end integration test for the PIM group tool surface.
//
// Exercises eligible_list → request → approval_list → approval_review
// → active_list → deactivate against a shared MockGraphState. Each
// browser-flow tool is driven by simulating the user POSTing the
// row-form submission to the loopback server (the tool itself opens
// the URL via an injected `openBrowser` stub that captures it).

import { describe, it, expect } from "vitest";

import { ArmClient } from "../../src/arm/client.js";
import { GraphClient } from "../../src/graph/client.js";
import { StaticAuthenticator } from "../../src/auth.js";
import type { ServerConfig } from "../../src/index.js";
import { MockGraphState, createMockGraphServer } from "../mock-graph.js";
import { fetchCsrfToken, testSignal } from "../helpers.js";

import { pimGroupActiveListTool } from "../../src/tools/pim/group/pim-group-active-list.js";
import { pimGroupApprovalListTool } from "../../src/tools/pim/group/pim-group-approval-list.js";
import { pimGroupApprovalReviewTool } from "../../src/tools/pim/group/pim-group-approval-review.js";
import { pimGroupDeactivateTool } from "../../src/tools/pim/group/pim-group-deactivate.js";
import { pimGroupEligibleListTool } from "../../src/tools/pim/group/pim-group-eligible-list.js";
import { pimGroupRequestListTool } from "../../src/tools/pim/group/pim-group-request-list.js";
import { pimGroupRequestTool } from "../../src/tools/pim/group/pim-group-request.js";

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
  const armClient = new ArmClient("http://127.0.0.1:1", "fake-token");
  const capturedUrls: string[] = [];
  const config: ServerConfig = {
    authenticator: auth,
    graphBaseUrl: url,
    armBaseUrl: "http://127.0.0.1:1",
    configDir: "/tmp/pimdo-int",
    graphClient,
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

describe("pim_group_* integration", () => {
  it("walks the full eligible → request → approve → active → deactivate flow", async () => {
    const harness = await setupHarness();
    try {
      const me = harness.state.me.id;
      harness.state.seedEligibility({
        id: "elig-1",
        groupId: "group-1",
        principalId: me,
        group: { id: "group-1", displayName: "Group One", description: "team alpha" },
      });
      harness.state.policyAssignments.push({
        groupId: "group-1",
        maximumDuration: "PT8H",
      });

      // 1) eligible_list
      const eligibleRes = await callTool(pimGroupEligibleListTool, harness.config, {});
      expect(eligibleRes.isError).toBeFalsy();
      expect(eligibleRes.content[0]?.text ?? "").toContain("Group One");
      expect(eligibleRes.content[0]?.text ?? "").toContain("elig-1");

      // 2) request — start the tool, then drive the loopback form.
      const requestPromise = callTool(pimGroupRequestTool, harness.config, {
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
      expect(requestResult.content[0]?.text ?? "").toContain("Group One");
      expect(harness.state.submittedRequests).toHaveLength(1);
      const submitted = harness.state.submittedRequests[0]!.body;
      expect(submitted["action"]).toBe("selfActivate");
      expect(submitted["principalId"]).toBe(me);
      expect(submitted["groupId"]).toBe("group-1");
      expect(submitted["justification"]).toBe("On-call shift");

      // 3) approval flow.
      const { approval } = harness.state.seedPendingApproval({
        groupId: "group-2",
        groupDisplayName: "Group Two",
        requesterDisplayName: "Bob",
        justification: "needs read",
      });

      const apprList = await callTool(pimGroupApprovalListTool, harness.config, {});
      expect(apprList.content[0]?.text ?? "").toContain("Group Two");
      expect(apprList.content[0]?.text ?? "").toContain(approval.id);

      const reviewPromise = callTool(pimGroupApprovalReviewTool, harness.config, {});
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
      harness.state.assignmentScheduleInstances.push({
        id: "instance-1",
        groupId: "group-1",
        principalId: me,
        accessId: "member",
        endDateTime: "2099-01-01T00:00:00Z",
        group: { id: "group-1", displayName: "Group One" },
      });

      const activeRes = await callTool(pimGroupActiveListTool, harness.config, {});
      expect(activeRes.content[0]?.text ?? "").toContain("Group One");
      expect(activeRes.content[0]?.text ?? "").toContain("instance-1");

      const deactivatePromise = callTool(pimGroupDeactivateTool, harness.config, {
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
      expect(deactivateBody["groupId"]).toBe("group-1");
      expect(deactivateBody["justification"]).toBe("done");

      // 5) request_list (returns nothing — myRequests not seeded).
      const myReqs = await callTool(pimGroupRequestListTool, harness.config, {});
      expect(myReqs.content[0]?.text ?? "").toContain("No pending");
    } finally {
      await harness.shutdown();
    }
  });
});
