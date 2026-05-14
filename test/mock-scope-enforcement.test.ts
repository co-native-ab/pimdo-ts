// Tests for the bearer-token-encoded scope enforcement layer in the
// Microsoft Graph and ARM mocks. Covers two things:
//
//   1. The encoder/decoder/enforcer helpers in `mock-scope-enforcement.ts`
//      in isolation.
//
//   2. End-to-end: when a Graph or ARM client is wired with a credential
//      that returns a `mock-scopes:` token whose decoded scope set does
//      NOT satisfy the route's documented DNF, the mock returns a 403
//      Graph/ARM error envelope — even when `assertScopes` is bypassed
//      (which is the whole point of having a defence-in-depth layer at
//      the mock level).

import http from "node:http";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { ArmClient } from "../src/arm/client.js";
import { GraphClient } from "../src/graph/client.js";
import { OAuthScope } from "../src/scopes.js";
import { listEligibleRoleEntraAssignments } from "../src/features/role-entra/client.js";
import { listEligibleRoleAzureAssignments } from "../src/features/role-azure/client.js";
import { createMockArmServer, MockArmState } from "./mock-arm.js";
import { createMockGraphServer, MockGraphState } from "./mock-graph.js";
import { enforceScopes, mockTokenForScopes, parseBearerScopes } from "./mock-scope-enforcement.js";
import { testSignal } from "./helpers.js";

describe("mockTokenForScopes / parseBearerScopes", () => {
  it("round-trips a non-empty scope set", () => {
    const tok = mockTokenForScopes([OAuthScope.UserRead, OAuthScope.OfflineAccess]);
    expect(tok).toBe("mock-scopes:User.Read,offline_access");
    const decoded = parseBearerScopes(`Bearer ${tok}`);
    expect(decoded).toEqual([OAuthScope.UserRead, OAuthScope.OfflineAccess]);
  });

  it("encodes an empty scope set as a syntactically valid token", () => {
    expect(mockTokenForScopes([])).toBe("mock-scopes:");
    expect(parseBearerScopes("Bearer mock-scopes:")).toEqual([]);
  });

  it("returns null for non-mock bearer tokens (enforcement bypass)", () => {
    expect(parseBearerScopes("Bearer fake-token")).toBeNull();
    expect(parseBearerScopes("Bearer test-token")).toBeNull();
    expect(parseBearerScopes(undefined)).toBeNull();
    expect(parseBearerScopes("Basic dXNlcjpwYXNz")).toBeNull();
  });

  it("accepts the lowercase `bearer` prefix", () => {
    expect(parseBearerScopes("bearer mock-scopes:User.Read")).toEqual([OAuthScope.UserRead]);
  });
});

describe("enforceScopes", () => {
  function fakeRes(): { res: http.ServerResponse; written: { status?: number; body?: string } } {
    const written: { status?: number; body?: string } = {};
    const res = {
      writeHead(status: number) {
        written.status = status;
        return this as unknown as http.ServerResponse;
      },
      end(body?: string) {
        written.body = body;
        return this as unknown as http.ServerResponse;
      },
    } as unknown as http.ServerResponse;
    return { res, written };
  }

  function fakeReq(token: string | undefined): http.IncomingMessage {
    return { headers: { authorization: token } } as unknown as http.IncomingMessage;
  }

  function writeError(
    res: http.ServerResponse,
    status: number,
    code: string,
    message: string,
  ): void {
    res.writeHead(status);
    res.end(JSON.stringify({ error: { code, message } }));
  }

  it("returns true and writes nothing when required is empty", () => {
    const { res, written } = fakeRes();
    const ok = enforceScopes(fakeReq("Bearer mock-scopes:"), res, [], writeError);
    expect(ok).toBe(true);
    expect(written.status).toBeUndefined();
  });

  it("returns true (bypass) for non-mock bearer tokens", () => {
    const { res, written } = fakeRes();
    const ok = enforceScopes(
      fakeReq("Bearer fake-token"),
      res,
      [[OAuthScope.RoleAssignmentScheduleReadWriteDirectory]],
      writeError,
    );
    expect(ok).toBe(true);
    expect(written.status).toBeUndefined();
  });

  it("accepts a request whose scopes satisfy at least one DNF alternative", () => {
    const { res, written } = fakeRes();
    const ok = enforceScopes(
      fakeReq(`Bearer ${mockTokenForScopes([OAuthScope.RoleEligibilityScheduleReadDirectory])}`),
      res,
      [
        [OAuthScope.RoleEligibilityScheduleReadDirectory],
        [OAuthScope.RoleEligibilityScheduleReadWriteDirectory],
      ],
      writeError,
    );
    expect(ok).toBe(true);
    expect(written.status).toBeUndefined();
  });

  it("rejects with 403 and lists the cheapest missing scope", () => {
    const { res, written } = fakeRes();
    const ok = enforceScopes(
      fakeReq(`Bearer ${mockTokenForScopes([OAuthScope.UserRead])}`),
      res,
      [
        [OAuthScope.RoleEligibilityScheduleReadDirectory],
        [OAuthScope.RoleEligibilityScheduleReadWriteDirectory],
      ],
      writeError,
    );
    expect(ok).toBe(false);
    expect(written.status).toBe(403);
    expect(written.body).toContain("Forbidden");
    // The cheapest alternative requires exactly 1 scope.
    expect(written.body).toContain("RoleEligibilitySchedule");
  });
});

describe("end-to-end mock enforcement (defence in depth)", () => {
  let server: http.Server | undefined;
  let url = "";
  let armServer: http.Server | undefined;
  let armUrl = "";

  beforeEach(async () => {
    const graph = await createMockGraphServer(new MockGraphState());
    server = graph.server;
    url = graph.url;
    const arm = await createMockArmServer(new MockArmState());
    armServer = arm.server;
    armUrl = arm.url;
  });

  afterEach(() => {
    server?.close();
    armServer?.close();
  });

  /** Credential without `grantedScopes`, so `assertScopes` is bypassed. */
  function bypassCredential(scopes: readonly OAuthScope[]) {
    return {
      getToken: () => Promise.resolve(mockTokenForScopes(scopes)),
    };
  }

  it("Graph mock returns 403 when bearer scopes miss the route DNF", async () => {
    // Only User.Read granted — the listEligibleRoleEntraAssignments route
    // requires RoleEligibilitySchedule.{Read,ReadWrite}.Directory.
    const client = new GraphClient(url, bypassCredential([OAuthScope.UserRead]));
    await expect(listEligibleRoleEntraAssignments(client, testSignal())).rejects.toThrow(
      /Forbidden|403|RoleEligibilitySchedule/,
    );
  });

  it("Graph mock allows a downgraded Read variant of the eligibility scope", async () => {
    const client = new GraphClient(
      url,
      bypassCredential([OAuthScope.RoleEligibilityScheduleReadDirectory]),
    );
    await expect(listEligibleRoleEntraAssignments(client, testSignal())).resolves.toBeInstanceOf(
      Array,
    );
  });

  it("ARM mock returns 403 when bearer scopes miss the user_impersonation scope", async () => {
    const client = new ArmClient(armUrl, bypassCredential([OAuthScope.UserRead]));
    await expect(listEligibleRoleAzureAssignments(client, testSignal())).rejects.toThrow(
      /Forbidden|403|user_impersonation/,
    );
  });

  it("ARM mock accepts a request with user_impersonation granted", async () => {
    const client = new ArmClient(armUrl, bypassCredential([OAuthScope.ArmUserImpersonation]));
    await expect(listEligibleRoleAzureAssignments(client, testSignal())).resolves.toBeInstanceOf(
      Array,
    );
  });
});
