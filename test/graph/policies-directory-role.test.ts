// Tests for src/graph/policies.getDirectoryRoleMaxDuration.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type http from "node:http";

import { GraphClient } from "../../src/graph/client.js";
import { getDirectoryRoleMaxDuration } from "../../src/graph/policies.js";
import { createMockGraphServer, MockGraphState } from "../mock-graph.js";
import { testSignal } from "../helpers.js";

describe("graph/policies.getDirectoryRoleMaxDuration", () => {
  let state: MockGraphState;
  let server: http.Server;
  let client: GraphClient;

  beforeEach(async () => {
    state = new MockGraphState();
    const started = await createMockGraphServer(state);
    server = started.server;
    client = new GraphClient(started.url, "test-token");
  });

  afterEach(() => server.close());

  it("returns the maximumDuration for the matching directory role", async () => {
    state.directoryPolicyAssignments.push({
      scopeId: "/",
      roleDefinitionId: "role-1",
      maximumDuration: "PT4H",
    });
    const max = await getDirectoryRoleMaxDuration(client, "role-1", testSignal());
    expect(max).toBe("PT4H");
  });

  it("throws when no policy assignment exists for the directory role", async () => {
    await expect(getDirectoryRoleMaxDuration(client, "missing", testSignal())).rejects.toThrow(
      /no role-management policy assignment/,
    );
  });

  it("throws when the Expiration_EndUser_Assignment rule is missing", async () => {
    state.directoryPolicyAssignments.push({
      scopeId: "/",
      roleDefinitionId: "role-1",
      maximumDuration: "PT4H",
      ruleId: "Some_Other_Rule",
    });
    await expect(getDirectoryRoleMaxDuration(client, "role-1", testSignal())).rejects.toThrow(
      /Expiration_EndUser_Assignment/,
    );
  });
});
