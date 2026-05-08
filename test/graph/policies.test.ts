// Tests for src/graph/policies.ts.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type http from "node:http";

import { GraphClient } from "../../src/graph/client.js";
import { getGroupMaxDuration } from "../../src/graph/policies.js";
import { createMockGraphServer, MockGraphState } from "../mock-graph.js";
import { testSignal } from "../helpers.js";

describe("graph/policies.getGroupMaxDuration", () => {
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

  it("returns the maximumDuration for the matching group", async () => {
    state.policyAssignments.push({ groupId: "g1", maximumDuration: "PT8H" });
    const max = await getGroupMaxDuration(client, "g1", testSignal());
    expect(max).toBe("PT8H");
  });

  it("throws when no policy assignment exists for the group", async () => {
    await expect(getGroupMaxDuration(client, "missing", testSignal())).rejects.toThrow(
      /no role-management policy assignment/,
    );
  });

  it("throws when the Expiration_EndUser_Assignment rule is missing", async () => {
    state.policyAssignments.push({
      groupId: "g1",
      maximumDuration: "PT8H",
      ruleId: "Some_Other_Rule",
    });
    await expect(getGroupMaxDuration(client, "g1", testSignal())).rejects.toThrow(
      /Expiration_EndUser_Assignment/,
    );
  });
});
