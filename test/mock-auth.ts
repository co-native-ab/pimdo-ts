// Mock authenticator for testing - controllable authentication state.
//
// Mirrors the {@link Authenticator} interface in `src/auth.ts` and
// returns the same token regardless of which {@link Resource} is
// requested, so tests can pass a single MockAuthenticator to both the
// graph and ARM clients.

import type { Authenticator, LoginOptions, LoginResult, AccountInfo } from "../src/auth.js";
import { AuthenticationRequiredError } from "../src/errors.js";
import { type OAuthScope, OAuthScope as GS, type Resource } from "../src/scopes.js";

/**
 * Default scopes returned by {@link MockAuthenticator}. Picks one
 * scope per PIM surface (groups, entra roles, azure roles) plus the
 * always-required login scopes — enough for tool-registry / scope
 * gating tests without enumerating every PIM scope.
 */
const DEFAULT_GRANTED_SCOPES: readonly OAuthScope[] = [
  GS.UserRead,
  GS.OfflineAccess,
  GS.PrivilegedEligibilityScheduleReadAzureADGroup,
  GS.PrivilegedAssignmentScheduleReadWriteAzureADGroup,
  GS.RoleEligibilityScheduleReadDirectory,
  GS.RoleAssignmentScheduleReadWriteDirectory,
  GS.PrivilegedAccessReadWriteAzureAD,
  GS.ArmUserImpersonation,
];

/**
 * A mock authenticator that can be controlled from tests.
 *
 * Starts unauthenticated (unless configured otherwise). When `browserLogin`
 * is true, login completes immediately. Otherwise it always rejects.
 */
export class MockAuthenticator implements Authenticator {
  private _token: string | null;
  private _username: string;
  private _browserLogin: boolean;
  private _logoutCalled = false;
  private _grantedScopes: OAuthScope[];
  private _lastLoginOpts: LoginOptions | undefined;

  constructor(opts?: {
    token?: string;
    username?: string;
    browserLogin?: boolean;
    grantedScopes?: OAuthScope[];
  }) {
    this._token = opts?.token ?? null;
    this._username = opts?.username ?? "test@example.com";
    this._browserLogin = opts?.browserLogin ?? true;
    this._grantedScopes = opts?.grantedScopes ?? [...DEFAULT_GRANTED_SCOPES];
  }

  login(signal: AbortSignal, opts?: LoginOptions): Promise<LoginResult> {
    if (signal.aborted)
      return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error("Aborted"));
    this._lastLoginOpts = opts;
    const isStepUp = opts?.claims !== undefined && opts.claims.length > 0;
    if (this._token && !isStepUp) {
      return Promise.resolve({
        message: "Already authenticated.",
        grantedScopes: this._grantedScopes,
      });
    }

    if (this._browserLogin) {
      this._token = "browser-token";
      return Promise.resolve({
        message: `Logged in as ${this._username}`,
        grantedScopes: this._grantedScopes,
      });
    }

    return Promise.reject(new Error("Could not open browser"));
  }

  tokenForResource(_resource: Resource, signal: AbortSignal): Promise<string> {
    if (signal.aborted)
      return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error("Aborted"));
    if (!this._token) {
      return Promise.reject(new AuthenticationRequiredError());
    }
    return Promise.resolve(this._token);
  }

  logout(signal: AbortSignal): Promise<void> {
    if (signal.aborted)
      return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error("Aborted"));
    this._token = null;
    this._logoutCalled = true;
    return Promise.resolve();
  }

  isAuthenticated(signal: AbortSignal): Promise<boolean> {
    if (signal.aborted)
      return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error("Aborted"));
    return Promise.resolve(this._token !== null);
  }

  accountInfo(signal: AbortSignal): Promise<AccountInfo | null> {
    if (signal.aborted)
      return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error("Aborted"));
    if (!this._token) return Promise.resolve(null);
    return Promise.resolve({ username: this._username });
  }

  grantedScopes(signal: AbortSignal): Promise<OAuthScope[]> {
    if (signal.aborted)
      return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error("Aborted"));
    if (!this._token) return Promise.resolve([]);
    return Promise.resolve(this._grantedScopes);
  }

  // ---- Test helpers ----

  /** Whether logout was called. */
  get wasLoggedOut(): boolean {
    return this._logoutCalled;
  }

  /** The opts passed to the most recent login call, or undefined. */
  get lastLoginOpts(): LoginOptions | undefined {
    return this._lastLoginOpts;
  }
}
