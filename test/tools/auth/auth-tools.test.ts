// Unit tests for the auth_status / login / logout MCP tools.
//
// These tools are thin wrappers over the {@link Authenticator} interface
// — we drive them via {@link MockAuthenticator} to cover the happy /
// already-state / cancel / error branches without a real MSAL flow.

import { describe, it, expect } from "vitest";

import { ArmClient } from "../../../src/arm/client.js";
import type { Authenticator } from "../../../src/auth.js";
import { GraphClient } from "../../../src/graph/client.js";
import { UserCancelledError } from "../../../src/errors.js";
import type { ServerConfig } from "../../../src/index.js";
import { OAuthScope } from "../../../src/scopes.js";
import { authStatusTool } from "../../../src/tools/auth/auth-status.js";
import { loginTool } from "../../../src/tools/auth/login.js";
import { logoutTool } from "../../../src/tools/auth/logout.js";
import { MockAuthenticator } from "../../mock-auth.js";
import { testSignal } from "../../helpers.js";

interface ToolResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

function buildConfig(
  authenticator: Authenticator,
  onScopesChanged?: (scopes: OAuthScope[]) => void,
): ServerConfig {
  return {
    authenticator,
    graphBaseUrl: "http://127.0.0.1:1",
    graphBetaBaseUrl: "http://127.0.0.1:1",
    armBaseUrl: "http://127.0.0.1:1",
    configDir: "/tmp/pimdo-auth-tools-tests",
    graphClient: new GraphClient("http://127.0.0.1:1", "fake-token"),
    graphBetaClient: new GraphClient("http://127.0.0.1:1", "fake-token"),
    armClient: new ArmClient("http://127.0.0.1:1", "fake-token"),
    openBrowser: () => Promise.resolve(),
    onScopesChanged,
  };
}

async function call(
  tool: { handler: (c: ServerConfig) => unknown },
  c: ServerConfig,
  args: Record<string, unknown> = {},
): Promise<ToolResult> {
  type Cb = (a: unknown, extra: { signal: AbortSignal }) => Promise<ToolResult>;
  const cb = tool.handler(c) as Cb;
  return cb(args, { signal: testSignal() });
}

/** Authenticator stub where every method behaves per the supplied overrides. */
function stubAuth(overrides: Partial<Authenticator>): Authenticator {
  return {
    login: () => Promise.reject(new Error("not stubbed: login")),
    tokenForResource: () => Promise.reject(new Error("not stubbed: tokenForResource")),
    logout: () => Promise.resolve(),
    isAuthenticated: () => Promise.resolve(false),
    accountInfo: () => Promise.resolve(null),
    grantedScopes: () => Promise.resolve([]),
    ...overrides,
  };
}

describe("auth_status tool", () => {
  it("reports 'Not logged in' when unauthenticated", async () => {
    const auth = new MockAuthenticator();
    const res = await call(authStatusTool, buildConfig(auth));
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("Status: Not logged in");
    expect(text).toContain("login");
  });

  it("reports user, scopes, and version when logged in", async () => {
    const auth = new MockAuthenticator({ token: "tok", username: "alice@example.com" });
    const res = await call(authStatusTool, buildConfig(auth));
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("pimdo v");
    expect(text).toContain("Status: Logged in");
    expect(text).toContain("alice@example.com");
    expect(text).toContain("Scopes: ");
    expect(text).toContain(OAuthScope.UserRead);
  });

  it("omits the Scopes line when grantedScopes is empty", async () => {
    const auth = stubAuth({
      isAuthenticated: () => Promise.resolve(true),
      accountInfo: () => Promise.resolve({ username: "alice@example.com" }),
      grantedScopes: () => Promise.resolve([]),
    });
    const res = await call(authStatusTool, buildConfig(auth));
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("Status: Logged in");
    expect(text).not.toContain("Scopes:");
  });

  it("omits the User line when accountInfo returns null", async () => {
    const auth = stubAuth({
      isAuthenticated: () => Promise.resolve(true),
      accountInfo: () => Promise.resolve(null),
      grantedScopes: () => Promise.resolve([OAuthScope.UserRead]),
    });
    const res = await call(authStatusTool, buildConfig(auth));
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("Status: Logged in");
    expect(text).not.toContain("User:");
    expect(text).toContain("Scopes: User.Read");
  });

  it("formats an error result when the authenticator throws", async () => {
    const auth = stubAuth({ isAuthenticated: () => Promise.reject(new Error("boom")) });
    const res = await call(authStatusTool, buildConfig(auth));
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("Status check failed: boom");
  });

  it("lists hidden tools and their missing scopes when toolDefs is provided", async () => {
    const auth = stubAuth({
      isAuthenticated: () => Promise.resolve(true),
      accountInfo: () => Promise.resolve({ username: "alice@example.com" }),
      grantedScopes: () => Promise.resolve([OAuthScope.UserRead]),
    });
    const config = buildConfig(auth);
    config.toolDefs = [
      // Visible: no required scopes
      { name: "auth_status", title: "x", description: "x", requiredScopes: [] },
      // Visible: User.Read is granted
      {
        name: "visible_tool",
        title: "x",
        description: "x",
        requiredScopes: [[OAuthScope.UserRead]],
      },
      // Hidden: needs PrivilegedAssignmentSchedule.ReadWrite.AzureADGroup which is not granted
      {
        name: "pim_group_eligible_list",
        title: "x",
        description: "x",
        requiredScopes: [[OAuthScope.PrivilegedAssignmentScheduleReadWriteAzureADGroup]],
      },
    ];
    const res = await call(authStatusTool, config);
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("Hidden tools (1):");
    expect(text).toContain("pim_group_eligible_list");
    expect(text).toContain(OAuthScope.PrivilegedAssignmentScheduleReadWriteAzureADGroup);
    expect(text).not.toContain("visible_tool");
  });
});

describe("login tool", () => {
  it("returns 'Already logged in' when the authenticator already has a token", async () => {
    const auth = new MockAuthenticator({ token: "tok" });
    const res = await call(loginTool, buildConfig(auth));
    expect(res.isError).toBeFalsy();
    expect(res.content[0]?.text).toContain("Already logged in");
  });

  it("performs a browser login and notifies onScopesChanged", async () => {
    const auth = new MockAuthenticator({ browserLogin: true });
    const seen: OAuthScope[][] = [];
    const res = await call(
      loginTool,
      buildConfig(auth, (s) => seen.push(s)),
    );
    expect(res.isError).toBeFalsy();
    expect(res.content[0]?.text).toContain("Logged in as");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain(OAuthScope.UserRead);
  });

  it("returns 'Login cancelled.' on UserCancelledError", async () => {
    const auth = stubAuth({
      isAuthenticated: () => Promise.resolve(false),
      login: () => Promise.reject(new UserCancelledError("user closed")),
    });
    const res = await call(loginTool, buildConfig(auth));
    expect(res.isError).toBeFalsy();
    expect(res.content[0]?.text).toBe("Login cancelled.");
  });

  it("returns an error result when login fails", async () => {
    // browserLogin: false + no token => MockAuthenticator rejects with "Could not open browser"
    const auth = new MockAuthenticator({ browserLogin: false });
    const res = await call(loginTool, buildConfig(auth));
    expect(res.isError).toBe(true);
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("Login failed: ");
    expect(text).toContain("Could not open browser");
    expect(text).toContain("can call this tool again");
  });

  it("forwards claims and loginHint to the authenticator on step-up", async () => {
    // Step-up flow: user is already authenticated (token set), but a tool
    // returned a step-up error and the AI now calls login again with claims.
    const auth = new MockAuthenticator({ token: "tok", browserLogin: true });
    const claims = '{"access_token":{"acrs":{"essential":true,"value":"c1"}}}';
    const res = await call(loginTool, buildConfig(auth), {
      claims,
      loginHint: "user@example.com",
    });
    expect(res.isError).toBeFalsy();
    expect(auth.lastLoginOpts).toEqual({ claims, loginHint: "user@example.com" });
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("Logged in as");
    expect(text).toContain("Re-invoke the original tool");
  });

  it("does not short-circuit with 'Already logged in' when claims is supplied", async () => {
    const auth = new MockAuthenticator({ token: "tok", browserLogin: true });
    const claims = '{"access_token":{"acrs":{"essential":true,"value":"c1"}}}';
    const res = await call(loginTool, buildConfig(auth), { claims });
    expect(res.content[0]?.text).not.toContain("Already logged in");
    expect(auth.lastLoginOpts?.claims).toBe(claims);
  });
});

describe("logout tool", () => {
  it("returns 'Not logged in' when there is no session", async () => {
    const auth = new MockAuthenticator();
    const res = await call(logoutTool, buildConfig(auth));
    expect(res.isError).toBeFalsy();
    expect(res.content[0]?.text).toContain("Not logged in");
  });

  it("clears tokens and notifies onScopesChanged with [] on success", async () => {
    const auth = new MockAuthenticator({ token: "tok" });
    const seen: OAuthScope[][] = [];
    const res = await call(
      logoutTool,
      buildConfig(auth, (s) => seen.push(s)),
    );
    expect(res.isError).toBeFalsy();
    expect(res.content[0]?.text).toContain("Logged out successfully");
    expect(auth.wasLoggedOut).toBe(true);
    expect(seen).toEqual([[]]);
  });

  it("returns 'Logout cancelled.' on UserCancelledError", async () => {
    const auth = stubAuth({
      isAuthenticated: () => Promise.resolve(true),
      logout: () => Promise.reject(new UserCancelledError("user cancelled")),
    });
    const res = await call(logoutTool, buildConfig(auth));
    expect(res.isError).toBeFalsy();
    expect(res.content[0]?.text).toBe("Logout cancelled.");
  });

  it("returns an error result when logout fails", async () => {
    const auth = stubAuth({
      isAuthenticated: () => Promise.resolve(true),
      logout: () => Promise.reject(new Error("disk full")),
    });
    const res = await call(logoutTool, buildConfig(auth));
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("Logout failed: disk full");
  });
});
