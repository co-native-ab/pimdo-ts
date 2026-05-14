import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";

import type * as MsalTypes from "@azure/msal-node";

import { StaticAuthenticator, MsalAuthenticator } from "../src/auth.js";
import { AuthenticationRequiredError, UserCancelledError } from "../src/errors.js";
import { Resource } from "../src/scopes.js";
import { testSignal, fetchCsrfToken } from "./helpers.js";

// ---------------------------------------------------------------------------
// vi.mock must be at the top level (hoisted by vitest)
// ---------------------------------------------------------------------------

vi.mock("@azure/msal-node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@azure/msal-node")>();
  return {
    ...actual,
    PublicClientApplication: vi.fn(),
  };
});

// Lazy import so the mock is in place before we reference it.
let msal: typeof import("@azure/msal-node");

beforeEach(async () => {
  msal = await import("@azure/msal-node");
});

// ---------------------------------------------------------------------------
// Temp-dir helpers (same pattern as config.test.ts)
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

/** Valid GUID used in tests since MsalAuthenticator now validates clientId shape. */
const TEST_CLIENT_ID = "30cdf00b-19c8-4fe6-94bd-2674ee51a3ff";

function getTempDir(): string {
  const dir = path.join(os.tmpdir(), `pimdo-auth-test-${crypto.randomUUID()}`);
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {
      /* ignore cleanup errors */
    });
  }
  tempDirs.length = 0;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helper: build a fake PCA returned by the mocked constructor
// ---------------------------------------------------------------------------

interface FakePCA {
  acquireTokenInteractive: ReturnType<typeof vi.fn>;
  acquireTokenSilent: ReturnType<typeof vi.fn>;
}

function installFakePCA(): FakePCA {
  const fakePCA: FakePCA = {
    acquireTokenInteractive: vi.fn(),
    acquireTokenSilent: vi.fn(),
  };

  // Must use a regular function (not arrow) so it can be called with `new`
  const ctor = vi.mocked(msal.PublicClientApplication);
  ctor.mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, fakePCA);
  } as never);

  return fakePCA;
}

// Helper to build a minimal AuthenticationResult
function authResult(
  overrides: Partial<MsalTypes.AuthenticationResult> = {},
): MsalTypes.AuthenticationResult {
  return {
    authority: "https://login.microsoftonline.com/common",
    uniqueId: "uid-1",
    tenantId: "tid-1",
    scopes: ["User.Read"],
    account: {
      homeAccountId: "home-1",
      environment: "login.microsoftonline.com",
      tenantId: "tid-1",
      username: "user@example.com",
      localAccountId: "local-1",
    },
    idToken: "id-token",
    idTokenClaims: {},
    accessToken: "access-token-123",
    fromCache: false,
    expiresOn: new Date(Date.now() + 3600 * 1000),
    tokenType: "Bearer",
    correlationId: "corr-1",
    ...overrides,
  };
}

// =========================================================================
// StaticAuthenticator
// =========================================================================

describe("StaticAuthenticator", () => {
  it("login resolves with a static message", async () => {
    const auth = new StaticAuthenticator("my-token");
    const result = await auth.login(testSignal());
    expect(result.message).toMatch(/static token/i);
  });

  it("token returns the fixed access token", async () => {
    const auth = new StaticAuthenticator("fixed-token");
    const token = await auth.tokenForResource(Resource.Graph, testSignal());
    expect(token).toBe("fixed-token");
  });

  it("logout is a no-op (does not throw)", async () => {
    const auth = new StaticAuthenticator("t");
    await expect(auth.logout(testSignal())).resolves.toBeUndefined();
  });

  it("isAuthenticated always returns true", async () => {
    const auth = new StaticAuthenticator("t");
    expect(await auth.isAuthenticated(testSignal())).toBe(true);
  });

  it("accountInfo returns username 'static-token'", async () => {
    const auth = new StaticAuthenticator("t");
    const info = await auth.accountInfo(testSignal());
    expect(info).toEqual({ username: "static-token" });
  });

  it("grantedScopes returns the default scope set", async () => {
    const auth = new StaticAuthenticator("t");
    const scopes = await auth.grantedScopes(testSignal());
    expect(Array.isArray(scopes)).toBe(true);
    expect(scopes.length).toBeGreaterThan(0);
  });
});

// =========================================================================
// MsalAuthenticator — constructor validation
// =========================================================================

describe("MsalAuthenticator constructor", () => {
  const noopOpen = () => Promise.resolve();

  it.each(["common", "consumers", "organizations"])(
    "accepts well-known tenant alias %s",
    (tenant) => {
      expect(
        () => new MsalAuthenticator(TEST_CLIENT_ID, tenant, getTempDir(), noopOpen),
      ).not.toThrow();
    },
  );

  it("accepts a GUID tenant id", () => {
    expect(
      () =>
        new MsalAuthenticator(
          TEST_CLIENT_ID,
          "11111111-2222-3333-4444-555555555555",
          getTempDir(),
          noopOpen,
        ),
    ).not.toThrow();
  });

  it("accepts a <name>.onmicrosoft.com tenant primary domain", () => {
    expect(
      () =>
        new MsalAuthenticator(TEST_CLIENT_ID, "contoso.onmicrosoft.com", getTempDir(), noopOpen),
    ).not.toThrow();
  });

  it.each([
    "",
    "not a tenant",
    "something-random",
    "contoso.com",
    "../../evil",
    "common/extra",
    "123",
  ])("rejects malformed tenant id %j", (tenant) => {
    expect(() => new MsalAuthenticator(TEST_CLIENT_ID, tenant, getTempDir(), noopOpen)).toThrow(
      /not a recognised authority form/,
    );
  });

  it("accepts a GUID client id", () => {
    expect(
      () => new MsalAuthenticator(TEST_CLIENT_ID, "common", getTempDir(), noopOpen),
    ).not.toThrow();
  });

  it.each([
    "",
    "client-id",
    "not-a-guid",
    "30cdf00b19c84fe694bd2674ee51a3ff",
    "30cdf00b-19c8-4fe6-94bd-2674ee51a3ff-extra",
    "javascript:alert(1)",
    "../etc/passwd",
  ])("rejects malformed client id %j", (badClientId) => {
    expect(() => new MsalAuthenticator(badClientId, "common", getTempDir(), noopOpen)).toThrow(
      /is not a valid Entra application/,
    );
  });
});

// =========================================================================
// MsalAuthenticator — login
// =========================================================================

describe("MsalAuthenticator.login", () => {
  it("completes via browser login when interactive succeeds", async () => {
    const dir = getTempDir();
    const openBrowser = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    const auth = new MsalAuthenticator(TEST_CLIENT_ID, "common", dir, openBrowser);

    const fakePCA = installFakePCA();
    fakePCA.acquireTokenInteractive.mockResolvedValue(authResult());

    const result = await auth.login(testSignal());

    expect(result.message).toContain("user@example.com");
    // Account file should be saved
    const accountPath = path.join(dir, "account.json");
    const raw = await fs.readFile(accountPath, "utf-8");
    const parsed = JSON.parse(raw) as { username: string };
    expect(parsed.username).toBe("user@example.com");
  });

  it("throws when browser login fails (no device code fallback)", async () => {
    const dir = getTempDir();
    const openBrowser = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    const auth = new MsalAuthenticator(TEST_CLIENT_ID, "common", dir, openBrowser);

    const fakePCA = installFakePCA();
    // Browser login fails
    fakePCA.acquireTokenInteractive.mockRejectedValue(new Error("cannot open browser"));

    await expect(auth.login(testSignal())).rejects.toThrow("cannot open browser");
  });

  it.skipIf(process.platform === "win32")("saves the account file with mode 0o600", async () => {
    const dir = getTempDir();
    const openBrowser = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    const auth = new MsalAuthenticator(TEST_CLIENT_ID, "common", dir, openBrowser);

    const fakePCA = installFakePCA();
    fakePCA.acquireTokenInteractive.mockResolvedValue(authResult());

    await auth.login(testSignal());

    const accountPath = path.join(dir, "account.json");
    const stat = await fs.stat(accountPath);
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

// =========================================================================
// MsalAuthenticator — token
// =========================================================================

describe("MsalAuthenticator.token", () => {
  it("returns access token when silent acquisition succeeds", async () => {
    const dir = getTempDir();
    await fs.mkdir(dir, { recursive: true });
    // Write a valid account file so loadAccount succeeds
    await fs.writeFile(
      path.join(dir, "account.json"),
      JSON.stringify({
        homeAccountId: "home-1",
        environment: "login.microsoftonline.com",
        tenantId: "tid-1",
        username: "user@example.com",
        localAccountId: "local-1",
      }),
    );

    const openBrowser = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    const auth = new MsalAuthenticator(TEST_CLIENT_ID, "common", dir, openBrowser);

    const fakePCA = installFakePCA();
    fakePCA.acquireTokenSilent.mockResolvedValue(authResult({ accessToken: "silent-token-xyz" }));

    const token = await auth.tokenForResource(Resource.Graph, testSignal());
    expect(token).toBe("silent-token-xyz");
  });

  it("throws AuthenticationRequiredError when no account file exists", async () => {
    const dir = getTempDir();
    await fs.mkdir(dir, { recursive: true });

    const openBrowser = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    const auth = new MsalAuthenticator(TEST_CLIENT_ID, "common", dir, openBrowser);

    installFakePCA();

    await expect(auth.tokenForResource(Resource.Graph, testSignal())).rejects.toThrow(
      AuthenticationRequiredError,
    );
  });

  it("throws AuthenticationRequiredError on InteractionRequiredAuthError", async () => {
    const dir = getTempDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "account.json"),
      JSON.stringify({
        homeAccountId: "home-1",
        environment: "login.microsoftonline.com",
        tenantId: "tid-1",
        username: "user@example.com",
        localAccountId: "local-1",
      }),
    );

    const openBrowser = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    const auth = new MsalAuthenticator(TEST_CLIENT_ID, "common", dir, openBrowser);

    const fakePCA = installFakePCA();
    fakePCA.acquireTokenSilent.mockRejectedValue(
      new msal.InteractionRequiredAuthError("interaction_required"),
    );

    await expect(auth.tokenForResource(Resource.Graph, testSignal())).rejects.toThrow(
      AuthenticationRequiredError,
    );
  });

  it("re-throws non-InteractionRequired errors from silent acquisition", async () => {
    const dir = getTempDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "account.json"),
      JSON.stringify({
        homeAccountId: "home-1",
        environment: "login.microsoftonline.com",
        tenantId: "tid-1",
        username: "user@example.com",
        localAccountId: "local-1",
      }),
    );

    const openBrowser = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    const auth = new MsalAuthenticator(TEST_CLIENT_ID, "common", dir, openBrowser);

    const fakePCA = installFakePCA();
    fakePCA.acquireTokenSilent.mockRejectedValue(new Error("network failure"));

    await expect(auth.tokenForResource(Resource.Graph, testSignal())).rejects.toThrow(
      "network failure",
    );
  });
});

// =========================================================================
// MsalAuthenticator — logout
// =========================================================================

/**
 * Helper: openBrowser mock that auto-POSTs to a given path after a short
 * delay. Now includes proper CSRF token handling (§5.4 hardening).
 */
function makeBrowserSpy(
  endpointPath: string,
): ReturnType<typeof vi.fn<(url: string) => Promise<void>>> {
  return vi.fn((url: string) => {
    void (async () => {
      await new Promise((r) => setTimeout(r, 150));
      // Fetch the CSRF token from the page before posting
      const csrfToken = await fetchCsrfToken(url);
      await fetch(`${url}${endpointPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csrfToken }),
      }).catch(() => {
        /* fire and forget */
      });
    })();
    return Promise.resolve();
  });
}

describe("MsalAuthenticator.logout", () => {
  it("clears cache files when user confirms", async () => {
    const dir = getTempDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "msal_cache.json"), "{}");
    await fs.writeFile(path.join(dir, "account.json"), "{}");

    const openBrowser = makeBrowserSpy("/confirm");
    const auth = new MsalAuthenticator(TEST_CLIENT_ID, "common", dir, openBrowser);

    await auth.logout(testSignal());

    await expect(fs.access(path.join(dir, "msal_cache.json"))).rejects.toThrow();
    await expect(fs.access(path.join(dir, "account.json"))).rejects.toThrow();
  });

  it("throws UserCancelledError when user cancels", async () => {
    const dir = getTempDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "msal_cache.json"), "{}");
    await fs.writeFile(path.join(dir, "account.json"), "{}");

    const openBrowser = makeBrowserSpy("/cancel");
    const auth = new MsalAuthenticator(TEST_CLIENT_ID, "common", dir, openBrowser);

    await expect(auth.logout(testSignal())).rejects.toThrow(UserCancelledError);

    // Files should NOT be deleted when cancelled
    await expect(fs.access(path.join(dir, "msal_cache.json"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(dir, "account.json"))).resolves.toBeUndefined();
  });

  it("clears tokens silently when browser cannot be opened", async () => {
    const dir = getTempDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "msal_cache.json"), "{}");
    await fs.writeFile(path.join(dir, "account.json"), "{}");

    const openBrowser = vi
      .fn<(url: string) => Promise<void>>()
      .mockRejectedValue(new Error("no browser available"));
    const auth = new MsalAuthenticator(TEST_CLIENT_ID, "common", dir, openBrowser);

    await auth.logout(testSignal());

    await expect(fs.access(path.join(dir, "msal_cache.json"))).rejects.toThrow();
    await expect(fs.access(path.join(dir, "account.json"))).rejects.toThrow();
  });

  it("does not throw when cache files do not exist (ENOENT ignored)", async () => {
    const dir = getTempDir();
    await fs.mkdir(dir, { recursive: true });
    // No cache files exist

    const openBrowser = makeBrowserSpy("/confirm");
    const auth = new MsalAuthenticator(TEST_CLIENT_ID, "common", dir, openBrowser);

    await expect(auth.logout(testSignal())).resolves.toBeUndefined();
  });

  it("still clears the remaining file when only one cache file exists", async () => {
    const dir = getTempDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "account.json"), "{}");
    // msal_cache.json does NOT exist

    const openBrowser = makeBrowserSpy("/confirm");
    const auth = new MsalAuthenticator(TEST_CLIENT_ID, "common", dir, openBrowser);

    await auth.logout(testSignal());

    await expect(fs.access(path.join(dir, "account.json"))).rejects.toThrow();
  });
});

// =========================================================================
// MsalAuthenticator — isAuthenticated
// =========================================================================

describe("MsalAuthenticator.isAuthenticated", () => {
  it("returns true when token() succeeds", async () => {
    const dir = getTempDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "account.json"),
      JSON.stringify({
        homeAccountId: "home-1",
        environment: "login.microsoftonline.com",
        tenantId: "tid-1",
        username: "user@example.com",
        localAccountId: "local-1",
      }),
    );

    const openBrowser = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    const auth = new MsalAuthenticator(TEST_CLIENT_ID, "common", dir, openBrowser);

    const fakePCA = installFakePCA();
    fakePCA.acquireTokenSilent.mockResolvedValue(authResult());

    expect(await auth.isAuthenticated(testSignal())).toBe(true);
  });

  it("returns false when no account file exists", async () => {
    const dir = getTempDir();
    await fs.mkdir(dir, { recursive: true });

    const openBrowser = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    const auth = new MsalAuthenticator(TEST_CLIENT_ID, "common", dir, openBrowser);

    installFakePCA();

    expect(await auth.isAuthenticated(testSignal())).toBe(false);
  });

  it("returns false when silent acquisition fails", async () => {
    const dir = getTempDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "account.json"),
      JSON.stringify({
        homeAccountId: "home-1",
        environment: "login.microsoftonline.com",
        tenantId: "tid-1",
        username: "user@example.com",
        localAccountId: "local-1",
      }),
    );

    const openBrowser = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    const auth = new MsalAuthenticator(TEST_CLIENT_ID, "common", dir, openBrowser);

    const fakePCA = installFakePCA();
    fakePCA.acquireTokenSilent.mockRejectedValue(new Error("expired"));

    expect(await auth.isAuthenticated(testSignal())).toBe(false);
  });
});

// =========================================================================
// MsalAuthenticator — accountInfo
// =========================================================================

describe("MsalAuthenticator.accountInfo", () => {
  it("returns username from saved account file", async () => {
    const dir = getTempDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "account.json"),
      JSON.stringify({
        homeAccountId: "home-1",
        environment: "login.microsoftonline.com",
        tenantId: "tid-1",
        username: "alice@example.com",
        localAccountId: "local-1",
      }),
    );

    const openBrowser = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    const auth = new MsalAuthenticator(TEST_CLIENT_ID, "common", dir, openBrowser);

    const info = await auth.accountInfo(testSignal());
    expect(info).toEqual({ username: "alice@example.com" });
  });

  it("returns null when no account file exists", async () => {
    const dir = getTempDir();
    await fs.mkdir(dir, { recursive: true });

    const openBrowser = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    const auth = new MsalAuthenticator(TEST_CLIENT_ID, "common", dir, openBrowser);

    const info = await auth.accountInfo(testSignal());
    expect(info).toBeNull();
  });

  it("returns null when account file contains invalid JSON", async () => {
    const dir = getTempDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "account.json"), "not-json{{{");

    const openBrowser = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    const auth = new MsalAuthenticator(TEST_CLIENT_ID, "common", dir, openBrowser);

    const info = await auth.accountInfo(testSignal());
    expect(info).toBeNull();
  });

  it("returns null when account file fails schema validation", async () => {
    const dir = getTempDir();
    await fs.mkdir(dir, { recursive: true });
    // Valid JSON but missing required 'username' field
    await fs.writeFile(path.join(dir, "account.json"), JSON.stringify({ homeAccountId: "h-1" }));

    const openBrowser = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    const auth = new MsalAuthenticator(TEST_CLIENT_ID, "common", dir, openBrowser);

    const info = await auth.accountInfo(testSignal());
    expect(info).toBeNull();
  });
});

// =========================================================================
// MsalAuthenticator — multi-resource silent probe (refresh-token reuse)
// =========================================================================

describe("MsalAuthenticator multi-resource silent probe", () => {
  const ARM_SCOPE = "https://management.azure.com/user_impersonation";

  it("login probes ARM silently and exposes ARM scope in grantedScopes when consent exists", async () => {
    const dir = getTempDir();
    const openBrowser = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    const auth = new MsalAuthenticator(TEST_CLIENT_ID, "common", dir, openBrowser);

    const fakePCA = installFakePCA();
    fakePCA.acquireTokenInteractive.mockResolvedValue(
      authResult({ scopes: ["User.Read", "RoleAssignmentSchedule.ReadWrite.Directory"] }),
    );
    // Simulates azidentity-style refresh-token reuse: the same login session
    // can mint an ARM token silently because the user previously consented
    // to the ARM permission for this app.
    fakePCA.acquireTokenSilent.mockResolvedValue(
      authResult({ scopes: [ARM_SCOPE], accessToken: "arm-token" }),
    );

    const result = await auth.login(testSignal());

    expect(fakePCA.acquireTokenSilent).toHaveBeenCalledWith(
      expect.objectContaining({ scopes: [ARM_SCOPE] }),
    );
    expect(result.grantedScopes).toContain("User.Read");
    expect(result.grantedScopes).toContain("RoleAssignmentSchedule.ReadWrite.Directory");
    expect(result.grantedScopes).toContain(ARM_SCOPE);
  });

  it("login still succeeds when the ARM silent probe needs interaction", async () => {
    const dir = getTempDir();
    const openBrowser = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    const auth = new MsalAuthenticator(TEST_CLIENT_ID, "common", dir, openBrowser);

    const fakePCA = installFakePCA();
    fakePCA.acquireTokenInteractive.mockResolvedValue(authResult({ scopes: ["User.Read"] }));
    fakePCA.acquireTokenSilent.mockRejectedValue(
      new msal.InteractionRequiredAuthError("interaction_required"),
    );

    const result = await auth.login(testSignal());

    // ARM consent is missing — ARM scope must NOT be in the granted set,
    // but login itself must still succeed and Graph scopes are intact.
    expect(result.grantedScopes).toContain("User.Read");
    expect(result.grantedScopes).not.toContain(ARM_SCOPE);
  });

  it("grantedScopes probes ARM silently after a server restart", async () => {
    const dir = getTempDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "account.json"),
      JSON.stringify({
        homeAccountId: "home-1",
        environment: "login.microsoftonline.com",
        tenantId: "tid-1",
        username: "user@example.com",
        localAccountId: "local-1",
      }),
    );

    const openBrowser = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    const auth = new MsalAuthenticator(TEST_CLIENT_ID, "common", dir, openBrowser);

    const fakePCA = installFakePCA();
    // First call: Graph silent probe (scopes from cache).
    // Second call: ARM silent probe (refresh-token reuse).
    fakePCA.acquireTokenSilent
      .mockResolvedValueOnce(authResult({ scopes: ["User.Read"] }))
      .mockResolvedValueOnce(authResult({ scopes: [ARM_SCOPE], accessToken: "arm" }));

    const scopes = await auth.grantedScopes(testSignal());

    expect(scopes).toContain("User.Read");
    expect(scopes).toContain(ARM_SCOPE);
  });
});

// =========================================================================
// MsalAuthenticator — PCA + AccountInfo caching (Phase 4 hot-path)
// =========================================================================

describe("MsalAuthenticator caching", () => {
  it("constructs PublicClientApplication once across multiple tokenForResource calls", async () => {
    const dir = getTempDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "account.json"),
      JSON.stringify({
        homeAccountId: "home-1",
        environment: "login.microsoftonline.com",
        tenantId: "tid-1",
        username: "user@example.com",
        localAccountId: "local-1",
      }),
    );

    const openBrowser = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    const auth = new MsalAuthenticator(TEST_CLIENT_ID, "common", dir, openBrowser);

    const fakePCA = installFakePCA();
    fakePCA.acquireTokenSilent.mockResolvedValue(authResult({ accessToken: "t" }));

    const ctor = vi.mocked(msal.PublicClientApplication);
    ctor.mockClear();

    await auth.tokenForResource(Resource.Graph, testSignal());
    await auth.tokenForResource(Resource.Graph, testSignal());
    await auth.tokenForResource(Resource.Arm, testSignal());

    expect(ctor).toHaveBeenCalledTimes(1);
  });

  it("loads account.json once and reuses the cached AccountInfo on subsequent calls", async () => {
    const dir = getTempDir();
    await fs.mkdir(dir, { recursive: true });
    const accountPath = path.join(dir, "account.json");
    await fs.writeFile(
      accountPath,
      JSON.stringify({
        homeAccountId: "home-1",
        environment: "login.microsoftonline.com",
        tenantId: "tid-1",
        username: "user@example.com",
        localAccountId: "local-1",
      }),
    );

    const openBrowser = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    const auth = new MsalAuthenticator(TEST_CLIENT_ID, "common", dir, openBrowser);

    const fakePCA = installFakePCA();
    fakePCA.acquireTokenSilent.mockResolvedValue(authResult({ accessToken: "t" }));

    // First call: must read from disk.
    await auth.tokenForResource(Resource.Graph, testSignal());

    // Delete the on-disk file so any second read would fail with ENOENT
    // (which loadAccount maps to `undefined` → AuthenticationRequiredError).
    // If the implementation re-reads, the next call rejects.
    await fs.unlink(accountPath);

    await expect(auth.tokenForResource(Resource.Graph, testSignal())).resolves.toBeDefined();
  });

  it("login replaces the cached PublicClientApplication and AccountInfo", async () => {
    const dir = getTempDir();
    const openBrowser = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    const auth = new MsalAuthenticator(TEST_CLIENT_ID, "common", dir, openBrowser);

    // Seed a pre-existing account on disk so a tokenForResource call
    // before login populates the in-memory cache for "alice".
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "account.json"),
      JSON.stringify({
        homeAccountId: "home-alice",
        environment: "login.microsoftonline.com",
        tenantId: "tid-1",
        username: "alice@example.com",
        localAccountId: "local-alice",
      }),
    );

    const fakePCA = installFakePCA();
    fakePCA.acquireTokenSilent.mockResolvedValue(authResult({ accessToken: "t" }));

    await auth.tokenForResource(Resource.Graph, testSignal());
    expect((await auth.accountInfo(testSignal()))?.username).toBe("alice@example.com");

    const ctor = vi.mocked(msal.PublicClientApplication);
    const callsBeforeLogin = ctor.mock.calls.length;

    // login switches to bob — must rebuild the PCA and replace the
    // cached account.
    fakePCA.acquireTokenInteractive.mockResolvedValue(
      authResult({
        scopes: ["User.Read"],
        account: {
          homeAccountId: "home-bob",
          environment: "login.microsoftonline.com",
          tenantId: "tid-1",
          username: "bob@example.com",
          localAccountId: "local-bob",
        },
      }),
    );

    await auth.login(testSignal());

    expect(ctor.mock.calls.length).toBeGreaterThan(callsBeforeLogin);
    expect((await auth.accountInfo(testSignal()))?.username).toBe("bob@example.com");
  });

  it("logout clears the cached PublicClientApplication and AccountInfo", async () => {
    const dir = getTempDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "account.json"),
      JSON.stringify({
        homeAccountId: "home-1",
        environment: "login.microsoftonline.com",
        tenantId: "tid-1",
        username: "user@example.com",
        localAccountId: "local-1",
      }),
    );
    await fs.writeFile(path.join(dir, "msal_cache.json"), "{}");

    // Use the silent-clear path (openBrowser rejects) so this test does
    // not depend on a real loopback server — keeps the assertion focused
    // on the in-memory cache invalidation rather than the browser flow.
    const openBrowser = vi
      .fn<(url: string) => Promise<void>>()
      .mockRejectedValue(new Error("no browser available"));
    const auth = new MsalAuthenticator(TEST_CLIENT_ID, "common", dir, openBrowser);

    const fakePCA = installFakePCA();
    fakePCA.acquireTokenSilent.mockResolvedValue(authResult({ accessToken: "t" }));

    // Prime the in-memory cache (account + PCA).
    await auth.tokenForResource(Resource.Graph, testSignal());

    const ctor = vi.mocked(msal.PublicClientApplication);
    const callsBeforeLogout = ctor.mock.calls.length;

    await auth.logout(testSignal());

    // Files were deleted by clearCacheFiles, and the in-memory account
    // cache was cleared — accountInfo must hit disk (ENOENT → null).
    expect(await auth.accountInfo(testSignal())).toBeNull();

    // Subsequent tokenForResource after logout has no account file and
    // must rebuild the PCA on next use.
    await expect(auth.tokenForResource(Resource.Graph, testSignal())).rejects.toThrow(
      AuthenticationRequiredError,
    );
    expect(ctor.mock.calls.length).toBeGreaterThan(callsBeforeLogout);
  });

  it("preserves unknown fields from account.json when forwarding to MSAL", async () => {
    const dir = getTempDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "account.json"),
      JSON.stringify({
        homeAccountId: "home-1",
        environment: "login.microsoftonline.com",
        tenantId: "tid-1",
        username: "user@example.com",
        localAccountId: "local-1",
        name: "User Example",
        nativeAccountId: "native-1",
      }),
    );

    const openBrowser = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    const auth = new MsalAuthenticator(TEST_CLIENT_ID, "common", dir, openBrowser);

    const fakePCA = installFakePCA();
    fakePCA.acquireTokenSilent.mockResolvedValue(authResult({ accessToken: "t" }));

    await auth.tokenForResource(Resource.Graph, testSignal());

    const firstCallArg = fakePCA.acquireTokenSilent.mock.calls[0]?.[0] as
      | { account?: Record<string, unknown> }
      | undefined;
    const passedAccount = firstCallArg?.account;
    expect(passedAccount?.["name"]).toBe("User Example");
    expect(passedAccount?.["nativeAccountId"]).toBe("native-1");
  });
});

// =========================================================================
// MsalAuthenticator — abort signal handling
// =========================================================================

describe("MsalAuthenticator abort handling", () => {
  function abortedSignal(): AbortSignal {
    const controller = new AbortController();
    controller.abort(new Error("pre-aborted"));
    return controller.signal;
  }

  it("tokenForResource rejects immediately when the signal is already aborted", async () => {
    const dir = getTempDir();
    const openBrowser = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    const auth = new MsalAuthenticator(TEST_CLIENT_ID, "common", dir, openBrowser);

    // No fake PCA installed — if we got past the abort check we'd
    // throw on `new msal.PublicClientApplication(...)`, which is also
    // a failure mode but would mask the early-return path under test.
    installFakePCA();

    await expect(auth.tokenForResource(Resource.Graph, abortedSignal())).rejects.toThrow(
      /pre-aborted/,
    );
  });

  it("login rejects immediately when the signal is already aborted", async () => {
    const dir = getTempDir();
    const openBrowser = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    const auth = new MsalAuthenticator(TEST_CLIENT_ID, "common", dir, openBrowser);

    installFakePCA();

    await expect(auth.login(abortedSignal())).rejects.toThrow(/pre-aborted/);
  });

  it("re-throws non-ENOENT errors when reading the account file", async () => {
    const dir = getTempDir();
    await fs.mkdir(dir, { recursive: true });
    // Create account.json as a *directory* so fs.readFile fails with
    // EISDIR (or similar) — not ENOENT and not a JSON parse error,
    // exercising the `throw err` branch in loadAccount.
    await fs.mkdir(path.join(dir, "account.json"));

    const openBrowser = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    const auth = new MsalAuthenticator(TEST_CLIENT_ID, "common", dir, openBrowser);

    await expect(auth.accountInfo(testSignal())).rejects.toThrow();
  });
});
