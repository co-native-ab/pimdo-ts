// Authentication module - MSAL-based token acquisition for Microsoft Graph.
//
// Uses interactive browser login exclusively. If the browser cannot be opened,
// login fails — there is no manual URL or device code fallback.

import { promises as fs } from "node:fs";
import path from "node:path";

import * as msal from "@azure/msal-node";
import { z } from "zod";

import { createMsalLoopback } from "./browser/flows/login.js";
import { showLogoutConfirmation } from "./browser/flows/logout.js";
import { AuthenticationRequiredError, isNodeError, UserCancelledError } from "./errors.js";
import { writeFileAtomic, writeJsonAtomic } from "./fs-options.js";
import { logger } from "./logger.js";
import { Resource, type OAuthScope, toOAuthScopes, defaultScopes } from "./scopes.js";

/**
 * Per-resource scope sets used for silent token acquisition.
 *
 * MSAL caches one token per resource (audience). We acquire the
 * minimal scope per resource that proves "this resource is reachable"
 * — `User.Read` for Graph (always granted post-login) and ARM's
 * `user_impersonation` for ARM. The token response surfaces the full
 * set of consented scopes for that resource, which we merge into
 * {@link MsalAuthenticator.cachedScopes}.
 *
 * Hoisted to module-load constants (typed `string[]` to satisfy MSAL's
 * `SilentFlowRequest.scopes`) so `tokenForResource` does not re-clone
 * the array with `[...]` on every call. Treated as read-only by
 * convention — no code path inside this module mutates them, and MSAL
 * does not mutate the array it is handed.
 */
const RESOURCE_PROBE_SCOPES: Readonly<Record<Resource, string[]>> = {
  [Resource.Graph]: ["User.Read"],
  [Resource.Arm]: ["https://management.azure.com/user_impersonation"],
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTHORITY_BASE = "https://login.microsoftonline.com";

/**
 * Allow-listed tenant identifiers per Microsoft's documented authority
 * forms. Defence-in-depth — `tenantId` is operator-controlled today
 * (`PIMDO_TENANT_ID`) but a malformed value would be silently
 * splatted into the OAuth authority URL.
 *
 *   - `common`, `consumers`, `organizations` — well-known aliases.
 *   - GUID — directory tenant id (case-insensitive).
 *   - `<name>.onmicrosoft.com` — tenant primary domain.
 */
const TENANT_ID_RE =
  /^(?:common|consumers|organizations|[0-9a-fA-F-]{36}|[a-z0-9-]+\.onmicrosoft\.com)$/i;

/**
 * Allow-listed client identifier shape — Entra application (client) IDs
 * are GUIDs. Defence-in-depth parity with {@link TENANT_ID_RE}: the
 * `clientId` is operator-controlled today (`PIMDO_CLIENT_ID`) and is
 * splatted into MSAL's OAuth authorize-URL query parameters. Catching
 * obviously-malformed values up-front produces a clear error instead of
 * a deep MSAL stack trace later.
 */
const CLIENT_ID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Default tenant: "common" allows any Microsoft account (personal + work/school). */
export const DEFAULT_TENANT_ID = "common";

const CACHE_FILE_NAME = "msal_cache.json";
const ACCOUNT_FILE_NAME = "account.json";

/** Timeout for the browser login flow (user must complete OAuth within this). */
const LOGIN_TIMEOUT_MS = 120_000; // 2 minutes

// ---------------------------------------------------------------------------
// Authenticator interface
// ---------------------------------------------------------------------------

/** Optional inputs for {@link Authenticator.login}. */
export interface LoginOptions {
  /**
   * Conditional Access claims-challenge JSON, lifted verbatim from a
   * {@link import("./errors.js").StepUpRequiredError}. When provided,
   * MSAL passes it to AAD on the interactive call so the user is
   * prompted to satisfy the policy (MFA, compliant device, etc.) and
   * the resulting access token carries the required `acrs` claim.
   */
  claims?: string;
  /**
   * Pre-populates AAD's username field, skipping the account picker.
   * When omitted and {@link claims} is set, defaults to the cached
   * account's username so step-up flows go straight to the right
   * account — matching Azure Portal / `az login --claims-challenge`
   * behaviour. Plain logins (no `claims`, no explicit `loginHint`)
   * keep today's `prompt=select_account` UX so users can switch
   * accounts.
   */
  loginHint?: string;
}

/** Abstraction for login + token acquisition. */
export interface Authenticator {
  /** Perform an interactive browser login. */
  login(signal: AbortSignal, opts?: LoginOptions): Promise<LoginResult>;

  /**
   * Acquire a cached access token for `resource`, refreshing silently
   * if needed. MSAL maintains a separate token per resource (audience),
   * so the same logged-in account can transparently address Microsoft
   * Graph and Azure Resource Manager.
   */
  tokenForResource(resource: Resource, signal: AbortSignal): Promise<string>;

  /** Clear cached tokens and account data. */
  logout(signal: AbortSignal): Promise<void>;

  /** Check whether a valid cached token exists (without prompting). */
  isAuthenticated(signal: AbortSignal): Promise<boolean>;

  /** Get info about the currently logged-in account, if any. */
  accountInfo(signal: AbortSignal): Promise<AccountInfo | null>;

  /** Get the scopes granted in the current auth session. Empty if not authenticated. */
  grantedScopes(signal: AbortSignal): Promise<OAuthScope[]>;
}

export interface LoginResult {
  /** Human-readable message about the login attempt. */
  message: string;
  /** Scopes granted by the auth server. */
  grantedScopes: OAuthScope[];
}

/** Basic info about the logged-in account. */
export interface AccountInfo {
  username: string;
}

// ---------------------------------------------------------------------------
// Internal utilities
// ---------------------------------------------------------------------------

/**
 * Races a promise against an AbortSignal so long-running MSAL operations
 * (e.g. silent token refresh) are cancelled when the caller aborts.
 */
function withSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted)
    return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error("Aborted"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void =>
      reject(signal.reason instanceof Error ? signal.reason : new Error("Aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

// ---------------------------------------------------------------------------
// File-based MSAL cache (mirrors Go's tokencache.go)
// ---------------------------------------------------------------------------

/**
 * MSAL cache plugin that persists token data to a JSON file.
 *
 * Note: the `ICachePlugin` interface (`beforeCacheAccess` / `afterCacheAccess`)
 * is defined by the MSAL library and does not include an AbortSignal parameter.
 * Signal-forwarding is intentionally omitted here — it is not possible without
 * changing the MSAL interface.
 */
function createFileCachePlugin(configDir: string): msal.ICachePlugin {
  const cachePath = path.join(configDir, CACHE_FILE_NAME);

  return {
    async beforeCacheAccess(context: msal.TokenCacheContext): Promise<void> {
      try {
        const data = await fs.readFile(cachePath, {
          encoding: "utf-8",
          signal: AbortSignal.timeout(5_000),
        });
        context.tokenCache.deserialize(data);
        logger.debug("loaded token cache", { path: cachePath });
      } catch (err: unknown) {
        if (isNodeError(err) && err.code === "ENOENT") {
          logger.debug("token cache file not found, starting fresh", {
            path: cachePath,
          });
          return;
        }
        throw err;
      }
    },

    async afterCacheAccess(context: msal.TokenCacheContext): Promise<void> {
      if (context.cacheHasChanged) {
        // Atomic write: ensures the freshly-created temp file's
        // restrictive `0o600` mode replaces any pre-existing file's
        // (potentially looser) perms via `rename`, and avoids partial
        // writes if the process is killed mid-flush.
        await writeFileAtomic(
          cachePath,
          context.tokenCache.serialize(),
          AbortSignal.timeout(5_000),
        );
        logger.debug("exported token cache", { path: cachePath });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Account persistence (mirrors Go's saveAccount/loadAccount)
// ---------------------------------------------------------------------------

async function saveAccount(
  account: msal.AccountInfo,
  configDir: string,
  signal: AbortSignal,
): Promise<void> {
  const accountPath = path.join(configDir, ACCOUNT_FILE_NAME);
  // Atomic write — see afterCacheAccess for rationale. JSON formatting
  // is delegated to writeJsonAtomic so it stays consistent with every
  // other persisted JSON file in the codebase.
  await writeJsonAtomic(accountPath, account, signal);
  logger.debug("saved account", { path: accountPath });
}

/**
 * Schema for the persisted account file. Tightened to the fields MSAL
 * actually consumes when looking an account up out of the token cache
 * (`acquireTokenSilent({ account })`) — `homeAccountId`, `environment`,
 * `tenantId`, `localAccountId` are all keys MSAL hashes into its cache
 * lookup; `username` is surfaced to the user. Any of them missing means
 * the file is unusable, so validation should fail fast rather than
 * limp on with a partially-typed account.
 *
 * `.loose()` preserves unknown fields from disk (e.g. future MSAL
 * additions like `idTokenClaims`, `name`, `nativeAccountId`) so we
 * don't silently strip them — they pass straight through to MSAL via
 * the explicit builder below.
 */
const AccountInfoSchema = z
  .object({
    homeAccountId: z.string(),
    environment: z.string(),
    tenantId: z.string(),
    username: z.string(),
    localAccountId: z.string(),
  })
  .loose();

/**
 * Build a typed `msal.AccountInfo` from a parsed account file. Round-
 * trips the values through an explicit object literal so the call site
 * does not need an `as msal.AccountInfo` cast: TypeScript verifies the
 * shape matches `msal.AccountInfo`'s required fields, and the loose
 * passthrough is forwarded via the `extras` rest so MSAL still sees
 * any optional fields persisted on disk.
 */
function buildAccountInfo(parsed: z.infer<typeof AccountInfoSchema>): msal.AccountInfo {
  const { homeAccountId, environment, tenantId, username, localAccountId, ...extras } = parsed;
  const account: msal.AccountInfo = {
    homeAccountId,
    environment,
    tenantId,
    username,
    localAccountId,
  };
  return Object.assign(account, extras);
}

async function loadAccount(
  configDir: string,
  signal: AbortSignal,
): Promise<msal.AccountInfo | undefined> {
  const accountPath = path.join(configDir, ACCOUNT_FILE_NAME);
  try {
    const data = await fs.readFile(accountPath, { encoding: "utf-8", signal });
    let account: unknown;
    try {
      account = JSON.parse(data);
    } catch {
      logger.error("Failed to parse account.json as JSON", { path: accountPath });
      return undefined;
    }
    // Validate minimal shape
    const parsed = AccountInfoSchema.safeParse(account);
    if (!parsed.success) {
      logger.error("Account file failed validation", {
        path: accountPath,
        error: parsed.error.message,
      });
      return undefined;
    }
    logger.debug("loaded account", {
      path: accountPath,
      username: parsed.data.username,
    });
    return buildAccountInfo(parsed.data);
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === "ENOENT") {
      logger.debug("account file not found", { path: accountPath });
      return undefined;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// MsalAuthenticator
// ---------------------------------------------------------------------------

/**
 * MSAL-based authenticator using interactive browser login exclusively.
 */
export class MsalAuthenticator implements Authenticator {
  private readonly clientId: string;
  private readonly tenantId: string;
  private readonly configDir: string;
  private readonly openBrowser: (url: string) => Promise<void>;
  private cachedScopes: OAuthScope[] = [];

  /**
   * Lazily-constructed MSAL `PublicClientApplication`. Held for the
   * lifetime of the authenticator so silent token acquisition does not
   * pay the cost of building a fresh PCA — and reloading the file
   * cache plugin — on every Graph or ARM request. Invalidated in
   * {@link login} (so `prompt: "select_account"` can switch accounts
   * cleanly) and {@link logout} (so the in-memory token cache is
   * dropped alongside the on-disk cache files).
   */
  private client: msal.PublicClientApplication | null = null;

  /**
   * Cached `AccountInfo` used to look the signed-in account up in the
   * MSAL token cache. Populated by {@link login} (from the interactive
   * result) or lazily by the first {@link tokenForResource} call
   * (read from disk). Invalidated in {@link login} and {@link logout}
   * for the same reasons as {@link client}.
   *
   * Holding it on the instance avoids the per-request `account.json`
   * read and closes a small race window where two concurrent silent
   * acquisitions could both observe a half-written cache during an
   * atomic rename.
   */
  private cachedAccount: msal.AccountInfo | null = null;

  constructor(
    clientId: string,
    tenantId: string,
    configDir: string,
    openBrowser: (url: string) => Promise<void>,
  ) {
    if (!CLIENT_ID_RE.test(clientId)) {
      throw new Error(
        `MsalAuthenticator: clientId ${JSON.stringify(clientId)} is not a valid Entra application ` +
          `(client) ID (expected a GUID like "00000000-0000-0000-0000-000000000000")`,
      );
    }
    if (!TENANT_ID_RE.test(tenantId)) {
      throw new Error(
        `MsalAuthenticator: tenantId ${JSON.stringify(tenantId)} is not a recognised authority form ` +
          `(expected "common", "consumers", "organizations", a GUID, or "<name>.onmicrosoft.com")`,
      );
    }
    this.clientId = clientId;
    this.tenantId = tenantId;
    this.configDir = configDir;
    this.openBrowser = openBrowser;
  }

  /**
   * Return the cached `PublicClientApplication`, constructing one on
   * first use. Subsequent calls reuse the same instance and its
   * in-memory copy of the file token cache, avoiding repeated disk
   * reads on the hot path.
   */
  private getClient(): msal.PublicClientApplication {
    if (this.client !== null) return this.client;
    this.client = new msal.PublicClientApplication({
      auth: {
        clientId: this.clientId,
        authority: `${AUTHORITY_BASE}/${this.tenantId}`,
      },
      cache: {
        cachePlugin: createFileCachePlugin(this.configDir),
      },
      system: {
        loggerOptions: {
          logLevel: msal.LogLevel.Warning,
          piiLoggingEnabled: false,
        },
      },
    });
    return this.client;
  }

  /**
   * Return the cached `AccountInfo`, loading it from disk on first use
   * if the authenticator has not yet observed a login during this
   * process. Returns `null` (rather than throwing) when no account
   * file exists, so callers can map that to
   * {@link AuthenticationRequiredError} at the appropriate boundary.
   */
  private async loadAccountCached(signal: AbortSignal): Promise<msal.AccountInfo | null> {
    if (this.cachedAccount !== null) return this.cachedAccount;
    const account = await loadAccount(this.configDir, signal);
    if (!account) return null;
    this.cachedAccount = account;
    return account;
  }

  async login(signal: AbortSignal, opts?: LoginOptions): Promise<LoginResult> {
    if (signal.aborted) throw signal.reason;
    const isStepUp = opts?.claims !== undefined && opts.claims.length > 0;
    logger.info("starting browser login", { stepUp: isStepUp });

    // `prompt: "select_account"` invites the user to switch accounts,
    // so any prior cached PCA / account from this process are now
    // stale. Drop them and rebuild lazily after the interactive flow.
    //
    // Step-up is the exception: we want the existing account, not a
    // picker, so keep cachedAccount around to use as the loginHint
    // default below — but still rebuild the PCA so MSAL re-evaluates
    // the cache after the new tokens land.
    const previousAccount = this.cachedAccount;
    this.client = null;
    if (!isStepUp) {
      this.cachedAccount = null;
    }

    const client = this.getClient();
    const loopback = createMsalLoopback(this.openBrowser, signal);

    // Default loginHint to the cached username on step-up so AAD
    // skips the account picker and drops the user straight onto MFA
    // for the right account.
    const loginHint =
      opts?.loginHint ?? (isStepUp ? (previousAccount?.username ?? undefined) : undefined);

    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      const interactiveRequest: msal.InteractiveRequest = {
        // Requesting only User.Read is intentional: Azure AD's admin consent
        // grants all required scopes (Tasks.ReadWrite, Mail.Send, offline_access)
        // regardless of which scopes are included in the interactive request.
        // The granted scopes are read from the token response and stored in
        // cachedScopes to drive dynamic tool visibility.
        scopes: ["User.Read"],
        // On step-up we want to re-authenticate the same account
        // (satisfying the missing factor), not invite an account
        // switch — so use prompt=login. Plain logins keep the
        // account picker.
        prompt: isStepUp ? "login" : "select_account",
        loopbackClient: loopback,
        openBrowser: async (authUrl: string) => {
          loopback.setAuthUrl(authUrl);
          await this.openBrowser(loopback.getRedirectUri());
        },
      };
      if (opts?.claims !== undefined && opts.claims.length > 0) {
        interactiveRequest.claims = opts.claims;
      }
      if (loginHint !== undefined) {
        interactiveRequest.loginHint = loginHint;
      }

      const racePromises: Promise<msal.AuthenticationResult>[] = [
        withSignal(client.acquireTokenInteractive(interactiveRequest), signal),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(
              new Error(
                "Browser login timed out — sign-in was not completed within the time limit.",
              ),
            );
          }, LOGIN_TIMEOUT_MS);
        }),
      ];

      const result = await Promise.race(racePromises);

      if (!result.account) {
        throw new Error("Browser authentication returned no account");
      }

      await saveAccount(result.account, this.configDir, signal);
      this.cachedAccount = result.account;
      this.cachedScopes = toOAuthScopes(result.scopes);
      logger.info("browser login successful", {
        resource: Resource.Graph,
        username: result.account.username,
        scopes: this.cachedScopes.join(", "),
      });

      // Probe every other resource silently. The interactive Graph login
      // returns a refresh token that can be exchanged for tokens against
      // any audience the user (or admin) has previously consented to for
      // this app — including Azure Resource Manager. Without this probe,
      // ARM-gated tools would stay disabled until the next manual login
      // even though the refresh token can mint an ARM token on demand.
      // Failures here are intentionally swallowed: a missing ARM consent
      // simply means ARM tools remain disabled until consent is granted.
      await this.probeAdditionalResources(signal);

      return {
        message: `Logged in as ${result.account.username}`,
        grantedScopes: this.cachedScopes,
      };
    } finally {
      clearTimeout(timeoutId);
      loopback.closeServer();
    }
  }

  /**
   * Silently probe every non-Graph resource and merge any returned
   * scopes into {@link cachedScopes}. The Graph probe is intentionally
   * skipped because it has already happened (interactive at login or
   * silent at startup) by the time this is called. Per-resource failures
   * are swallowed — they only mean "user has not consented to that
   * resource yet" and the corresponding tools simply stay disabled.
   */
  private async probeAdditionalResources(signal: AbortSignal): Promise<void> {
    for (const resource of Object.values(Resource)) {
      if (resource === Resource.Graph) continue;
      try {
        await this.tokenForResource(resource, signal);
        logger.debug("silent probe succeeded", { resource });
      } catch (err: unknown) {
        if (err instanceof AuthenticationRequiredError) {
          logger.debug("silent probe skipped (consent required)", { resource });
          continue;
        }
        // Unexpected errors (network, etc.) are non-fatal here — the user
        // is already logged in for Graph and can retry the ARM-gated tool
        // later, which will surface a clearer error then.
        logger.debug("silent probe failed", {
          resource,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  async tokenForResource(resource: Resource, signal: AbortSignal): Promise<string> {
    if (signal.aborted) throw signal.reason;
    const client = this.getClient();
    const account = await this.loadAccountCached(signal);

    if (!account) {
      throw new AuthenticationRequiredError();
    }

    logger.debug("acquiring token silently", {
      username: account.username,
      resource,
    });

    try {
      const result = await withSignal(
        client.acquireTokenSilent({
          account,
          // Per-resource probe scope. MSAL keys its cache by audience, so
          // requesting User.Read for Graph and user_impersonation for ARM
          // gives us a separate cached token per resource. The full set of
          // consented scopes for that resource is returned on `result.scopes`
          // and merged into cachedScopes for the dynamic-tools UI.
          //
          // The scope array is shared per-resource and built once at
          // module load (`RESOURCE_PROBE_SCOPES`), so no allocation
          // happens on the hot path here.
          scopes: RESOURCE_PROBE_SCOPES[resource],
        }),
        signal,
      );

      this.mergeCachedScopes(toOAuthScopes(result.scopes));
      logger.debug("token acquired", { resource });
      return result.accessToken;
    } catch (err: unknown) {
      if (err instanceof msal.InteractionRequiredAuthError) {
        throw new AuthenticationRequiredError();
      }
      throw err;
    }
  }

  /**
   * Union the freshly-observed `scopes` into {@link cachedScopes} so
   * dynamic-tools state reflects the granted scopes across every
   * resource the authenticator has acquired a token for in this
   * session, not just the most recent one.
   */
  private mergeCachedScopes(scopes: readonly OAuthScope[]): void {
    if (scopes.length === 0) return;
    const merged = new Set<OAuthScope>(this.cachedScopes);
    for (const s of scopes) merged.add(s);
    this.cachedScopes = Array.from(merged);
  }

  async logout(signal: AbortSignal): Promise<void> {
    try {
      await showLogoutConfirmation(this.openBrowser, (s) => this.clearCacheFiles(s), signal);
    } catch (err: unknown) {
      if (err instanceof UserCancelledError) throw err;
      // Browser unavailable or timed out — clear tokens silently
      logger.warn("could not show logout confirmation page, clearing tokens silently", {
        error: err instanceof Error ? err.message : String(err),
      });
      await this.clearCacheFiles(signal);
    }
    // Drop the in-memory state alongside the on-disk cache files so a
    // subsequent `tokenForResource` cannot serve a stale token out of
    // the previous PCA's in-memory cache.
    this.cachedScopes = [];
    this.cachedAccount = null;
    this.client = null;
  }

  private async clearCacheFiles(signal: AbortSignal): Promise<void> {
    const files = [
      path.join(this.configDir, CACHE_FILE_NAME),
      path.join(this.configDir, ACCOUNT_FILE_NAME),
    ];

    for (const f of files) {
      if (signal.aborted) throw signal.reason;
      try {
        await fs.unlink(f);
        logger.debug("removed cache file", { path: f });
      } catch (err: unknown) {
        if (isNodeError(err) && err.code === "ENOENT") {
          continue;
        }
        throw err;
      }
    }

    logger.info("logged out, token cache cleared");
  }

  async isAuthenticated(signal: AbortSignal): Promise<boolean> {
    try {
      await this.tokenForResource(Resource.Graph, signal);
      return true;
    } catch {
      return false;
    }
  }

  async accountInfo(signal: AbortSignal): Promise<AccountInfo | null> {
    const account = await this.loadAccountCached(signal);
    if (!account) return null;
    return { username: account.username };
  }

  async grantedScopes(signal: AbortSignal): Promise<OAuthScope[]> {
    // Always probe every resource silently so cachedScopes reflects the
    // full set of audiences the cached refresh token can mint tokens
    // for, not just the most-recently-used one. Without this, an MCP
    // server restart against an existing cache would leave ARM tools
    // disabled even though a silent ARM token is reachable.
    try {
      await this.tokenForResource(Resource.Graph, signal);
    } catch {
      // Graph silent acquisition failed — user is not authenticated for
      // any resource.
      return [];
    }
    await this.probeAdditionalResources(signal);
    return this.cachedScopes;
  }
}

// ---------------------------------------------------------------------------
// StaticAuthenticator (for testing / PIMDO_ACCESS_TOKEN)
// ---------------------------------------------------------------------------

export class StaticAuthenticator implements Authenticator {
  constructor(private readonly accessToken: string) {}

  login(_signal: AbortSignal, _opts?: LoginOptions): Promise<LoginResult> {
    return Promise.resolve({
      message: "Already authenticated with static token.",
      grantedScopes: defaultScopes(),
    });
  }

  tokenForResource(_resource: Resource, _signal: AbortSignal): Promise<string> {
    return Promise.resolve(this.accessToken);
  }

  async logout(_signal: AbortSignal): Promise<void> {
    // No-op for static authenticator
  }

  isAuthenticated(_signal: AbortSignal): Promise<boolean> {
    return Promise.resolve(true);
  }

  accountInfo(_signal: AbortSignal): Promise<AccountInfo | null> {
    return Promise.resolve({ username: "static-token" });
  }

  grantedScopes(_signal: AbortSignal): Promise<OAuthScope[]> {
    return Promise.resolve(defaultScopes());
  }
}
