// End-to-end integration test for the PIM Azure-role tool surface.

import { describe, it, expect } from "vitest";

import { ArmClient } from "../../src/arm/client.js";
import { GraphClient } from "../../src/graph/client.js";
import { StaticAuthenticator } from "../../src/auth.js";
import type { ServerConfig } from "../../src/index.js";
import { MockArmState, createMockArmServer } from "../mock-arm.js";
import { MockGraphState, createMockGraphServer } from "../mock-graph.js";
import { fetchCsrfToken, testSignal } from "../helpers.js";

import { pimRoleAzureActiveListTool } from "../../src/tools/pim/role-azure/pim-role-azure-active-list.js";
import { pimRoleAzureApprovalListTool } from "../../src/tools/pim/role-azure/pim-role-azure-approval-list.js";
import { pimRoleAzureApprovalReviewTool } from "../../src/tools/pim/role-azure/pim-role-azure-approval-review.js";
import { pimRoleAzureDeactivateTool } from "../../src/tools/pim/role-azure/pim-role-azure-deactivate.js";
import { pimRoleAzureEligibleListTool } from "../../src/tools/pim/role-azure/pim-role-azure-eligible-list.js";
import { pimRoleAzureRequestListTool } from "../../src/tools/pim/role-azure/pim-role-azure-request-list.js";
import { pimRoleAzureRequestTool } from "../../src/tools/pim/role-azure/pim-role-azure-request.js";

interface Harness {
  config: ServerConfig;
  armState: MockArmState;
  graphState: MockGraphState;
  capturedUrls: string[];
  shutdown: () => Promise<void>;
}

async function setupHarness(): Promise<Harness> {
  const armState = new MockArmState();
  const armServer = await createMockArmServer(armState);
  const graphState = new MockGraphState();
  const graphServer = await createMockGraphServer(graphState);
  const auth = new StaticAuthenticator("fake-token");
  const capturedUrls: string[] = [];
  const config: ServerConfig = {
    authenticator: auth,
    graphBaseUrl: graphServer.url,
    graphBetaBaseUrl: graphServer.url,
    armBaseUrl: armServer.url,
    configDir: "/tmp/pimdo-role-azure-int",
    graphClient: new GraphClient(graphServer.url, "fake-token"),
    graphBetaClient: new GraphClient(graphServer.url, "fake-token"),
    armClient: new ArmClient(armServer.url, "fake-token"),
    openBrowser: (u: string): Promise<void> => {
      capturedUrls.push(u);
      return Promise.resolve();
    },
  };
  const shutdown = async (): Promise<void> => {
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
  };
  return { config, armState, graphState, capturedUrls, shutdown };
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

describe("pim_role_azure_* integration", () => {
  it("walks the full eligible → request → approve → active → deactivate flow", async () => {
    const harness = await setupHarness();
    try {
      const me = harness.graphState.me.id;
      const scope = "/subscriptions/sub-a";
      const roleDefId = `${scope}/providers/Microsoft.Authorization/roleDefinitions/role-1`;
      harness.armState.seedEligibility({
        id: "elig-1",
        roleDefinitionId: roleDefId,
        scope,
        principalId: me,
        roleDisplayName: "Owner",
      });
      harness.armState.policyAssignments.push({
        scope,
        roleDefinitionId: roleDefId,
        maximumDuration: "PT8H",
      });

      // 1) eligible_list
      const eligibleRes = await callTool(pimRoleAzureEligibleListTool, harness.config, {});
      expect(eligibleRes.isError).toBeFalsy();
      expect(eligibleRes.content[0]?.text ?? "").toContain("Owner");
      expect(eligibleRes.content[0]?.text ?? "").toContain("elig-1");

      // 2) request — start the tool, then drive the loopback form.
      const requestPromise = callTool(pimRoleAzureRequestTool, harness.config, {
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
      expect(requestResult.content[0]?.text ?? "").toContain("Owner");
      expect(harness.armState.submittedRequests).toHaveLength(1);
      const submitted = harness.armState.submittedRequests[0]!;
      expect(submitted.scope).toBe(scope);
      const props = submitted.body["properties"] as Record<string, unknown>;
      expect(props["requestType"]).toBe("SelfActivate");
      expect(props["principalId"]).toBe(me);
      expect(props["roleDefinitionId"]).toBe(roleDefId);
      expect(props["justification"]).toBe("On-call shift");

      // 3) approval flow.
      const pending = harness.armState.seedPendingApproval({
        roleDefinitionId: `${scope}/providers/Microsoft.Authorization/roleDefinitions/role-2`,
        scope,
        roleDisplayName: "User Access Administrator",
        requesterDisplayName: "Bob",
        justification: "needs admin",
      });

      const apprList = await callTool(pimRoleAzureApprovalListTool, harness.config, {});
      expect(apprList.content[0]?.text ?? "").toContain("User Access Administrator");
      expect(apprList.content[0]?.text ?? "").toContain(pending.properties.approvalId ?? "");

      const reviewPromise = callTool(pimRoleAzureApprovalReviewTool, harness.config, {});
      const reviewUrl = await waitFor(
        () => harness.capturedUrls.at(-1),
        (last) => last !== url,
      );
      const reviewCsrf = await fetchCsrfToken(reviewUrl);
      const reviewSubmit = await postJson(`${reviewUrl}/submit`, {
        csrfToken: reviewCsrf,
        rows: [
          {
            id: pending.properties.approvalId,
            decision: "Approve",
            justification: "OK by me",
          },
        ],
      });
      expect(reviewSubmit.status).toBe(200);
      const reviewResult = await reviewPromise;
      expect(reviewResult.isError).toBeFalsy();
      expect(harness.armState.batchRequests).toHaveLength(1);
      const inner = (
        harness.armState.batchRequests[0]!.body["requests"] as Record<string, unknown>[]
      )[0]!;
      expect(inner["content"]).toMatchObject({
        properties: { reviewResult: "Approve", justification: "OK by me" },
      });

      // 4) deactivate flow.
      harness.armState.seedActive({
        id: `${scope}/providers/Microsoft.Authorization/roleAssignmentScheduleInstances/instance-1`,
        roleDefinitionId: roleDefId,
        scope,
        principalId: me,
        endDateTime: "2099-01-01T00:00:00Z",
        roleDisplayName: "Owner",
      });

      const activeRes = await callTool(pimRoleAzureActiveListTool, harness.config, {});
      expect(activeRes.content[0]?.text ?? "").toContain("Owner");
      expect(activeRes.content[0]?.text ?? "").toContain("instance-1");

      const deactivatePromise = callTool(pimRoleAzureDeactivateTool, harness.config, {
        items: [
          {
            instanceId: `${scope}/providers/Microsoft.Authorization/roleAssignmentScheduleInstances/instance-1`,
            reason: "done",
          },
        ],
      });
      const deactivateUrl = await waitFor(
        () => harness.capturedUrls.at(-1),
        (last) => last !== reviewUrl,
      );
      const deactivateCsrf = await fetchCsrfToken(deactivateUrl);
      const deactivateSubmit = await postJson(`${deactivateUrl}/submit`, {
        csrfToken: deactivateCsrf,
        rows: [
          {
            id: `${scope}/providers/Microsoft.Authorization/roleAssignmentScheduleInstances/instance-1`,
            reason: "done",
          },
        ],
      });
      expect(deactivateSubmit.status).toBe(200);
      const deactivateResult = await deactivatePromise;
      expect(deactivateResult.isError).toBeFalsy();
      const deactivateProps = harness.armState.submittedRequests[
        harness.armState.submittedRequests.length - 1
      ]!.body["properties"] as Record<string, unknown>;
      expect(deactivateProps["requestType"]).toBe("SelfDeactivate");
      expect(deactivateProps["roleDefinitionId"]).toBe(roleDefId);
      expect(deactivateProps["justification"]).toBe("done");

      // 5) request_list (returns nothing — myRequests not seeded).
      const myReqs = await callTool(pimRoleAzureRequestListTool, harness.config, {});
      expect(myReqs.content[0]?.text ?? "").toContain("No pending");
    } finally {
      await harness.shutdown();
    }
  });
});
