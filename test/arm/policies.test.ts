// Tests for src/arm/policies.ts.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type http from "node:http";

import { ArmClient } from "../../src/arm/client.js";
import { getAzureRoleMaxDuration } from "../../src/arm/policies.js";
import { createMockArmServer, MockArmState } from "../mock-arm.js";
import { testSignal } from "../helpers.js";

describe("arm/policies.getAzureRoleMaxDuration", () => {
  let state: MockArmState;
  let server: http.Server;
  let client: ArmClient;

  beforeEach(async () => {
    state = new MockArmState();
    const started = await createMockArmServer(state);
    server = started.server;
    client = new ArmClient(started.url, "test-token");
  });

  afterEach(() => server.close());

  it("returns the maximumDuration for the matching (scope, roleDefinitionId)", async () => {
    state.policyAssignments.push({
      scope: "/subscriptions/sub-a",
      roleDefinitionId: "role-1",
      maximumDuration: "PT8H",
    });
    const max = await getAzureRoleMaxDuration(
      client,
      "/subscriptions/sub-a",
      "role-1",
      testSignal(),
    );
    expect(max).toBe("PT8H");
  });

  it("throws when no policy assignment exists for the scope", async () => {
    await expect(
      getAzureRoleMaxDuration(client, "/subscriptions/missing", "role-1", testSignal()),
    ).rejects.toThrow(/no role-management policy assignment/);
  });

  it("throws when the Expiration_EndUser_Assignment rule is missing", async () => {
    state.policyAssignments.push({
      scope: "/subscriptions/sub-a",
      roleDefinitionId: "role-1",
      maximumDuration: "PT8H",
      ruleId: "Some_Other_Rule",
    });
    await expect(
      getAzureRoleMaxDuration(client, "/subscriptions/sub-a", "role-1", testSignal()),
    ).rejects.toThrow(/Expiration_EndUser_Assignment/);
  });
});
