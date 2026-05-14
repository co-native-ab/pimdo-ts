// Unit tests for src/scopes-runtime.ts (assertScopes + deriveRequiredScopes).

import { describe, it, expect } from "vitest";

import { MissingScopeError } from "../src/errors.js";
import type { TokenCredential } from "../src/http/base-client.js";
import { OAuthScope } from "../src/scopes.js";
import { assertScopes, deriveRequiredScopes } from "../src/scopes-runtime.js";

const RW_DIR = OAuthScope.RoleEligibilityScheduleReadWriteDirectory;
const R_DIR = OAuthScope.RoleEligibilityScheduleReadDirectory;
const PA_RW = OAuthScope.PrivilegedAccessReadWriteAzureAD;
const RAS_RW = OAuthScope.RoleAssignmentScheduleReadWriteDirectory;
const POL_R = OAuthScope.RoleManagementPolicyReadDirectory;
const USER_READ = OAuthScope.UserRead;

function credWithScopes(grantedScopes: OAuthScope[]): TokenCredential {
  return {
    getToken: () => Promise.resolve("test-token"),
    grantedScopes: () => Promise.resolve(grantedScopes),
  };
}

describe("assertScopes", () => {
  it("returns when required is empty (always allowed)", async () => {
    const cred = credWithScopes([]);
    await expect(assertScopes(cred, [], AbortSignal.timeout(1000))).resolves.toBeUndefined();
  });

  it("skips the check when the credential does not expose grantedScopes", async () => {
    const cred: TokenCredential = { getToken: () => Promise.resolve("t") };
    await expect(
      assertScopes(cred, [[RW_DIR]], AbortSignal.timeout(1000)),
    ).resolves.toBeUndefined();
  });

  it("returns when granted scopes satisfy a single alternative", async () => {
    const cred = credWithScopes([R_DIR]);
    await expect(
      assertScopes(cred, [[R_DIR], [RW_DIR]], AbortSignal.timeout(1000)),
    ).resolves.toBeUndefined();
  });

  it("returns when granted scopes satisfy a conjunction alternative", async () => {
    const cred = credWithScopes([PA_RW, RAS_RW]);
    await expect(
      assertScopes(cred, [[PA_RW, RAS_RW]], AbortSignal.timeout(1000)),
    ).resolves.toBeUndefined();
  });

  it("throws MissingScopeError when no alternative is satisfied", async () => {
    const cred = credWithScopes([USER_READ]);
    await expect(
      assertScopes(cred, [[R_DIR], [RW_DIR]], AbortSignal.timeout(1000)),
    ).rejects.toBeInstanceOf(MissingScopeError);
  });

  it("missingExample picks the smallest gap when multiple alternatives are unsatisfied", async () => {
    // granted has PA_RW but not RAS_RW or R_DIR. Alternatives:
    //   - [PA_RW, RAS_RW]  → missing 1 (RAS_RW)
    //   - [R_DIR, RAS_RW]  → missing 2
    // Cheapest gap is RAS_RW.
    const cred = credWithScopes([PA_RW]);
    try {
      await assertScopes(
        cred,
        [
          [PA_RW, RAS_RW],
          [R_DIR, RAS_RW],
        ],
        AbortSignal.timeout(1000),
      );
      expect.fail("expected MissingScopeError");
    } catch (err) {
      expect(err).toBeInstanceOf(MissingScopeError);
      const e = err as MissingScopeError;
      expect(e.missingExample).toEqual([RAS_RW]);
      expect(e.granted).toEqual([PA_RW]);
      expect(e.required).toEqual([
        [PA_RW, RAS_RW],
        [R_DIR, RAS_RW],
      ]);
    }
  });

  it("error message names the missing scope and the requirement", async () => {
    const cred = credWithScopes([]);
    try {
      await assertScopes(cred, [[R_DIR], [RW_DIR]], AbortSignal.timeout(1000));
      expect.fail("expected MissingScopeError");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain(R_DIR);
      expect(msg).toContain(RW_DIR);
      expect(msg).toContain("OR");
    }
  });

  it("propagates abort", async () => {
    const cred: TokenCredential = {
      getToken: () => Promise.resolve("t"),
      grantedScopes: (signal) =>
        signal.aborted
          ? Promise.reject(signal.reason instanceof Error ? signal.reason : new Error("Aborted"))
          : Promise.resolve([R_DIR]),
    };
    const ctrl = new AbortController();
    ctrl.abort(new Error("cancelled"));
    await expect(assertScopes(cred, [[R_DIR]], ctrl.signal)).rejects.toThrow("cancelled");
  });
});

describe("deriveRequiredScopes", () => {
  it("returns [] for no call sites (always-enabled)", () => {
    expect(deriveRequiredScopes([])).toEqual([]);
  });

  it("returns [] when every call site has no alternatives", () => {
    expect(deriveRequiredScopes([[], []])).toEqual([]);
  });

  it("AND-merges single-alternative call sites", () => {
    // [[POL_R]] ∧ [[PA_RW]] → [[POL_R, PA_RW]] (sorted alphabetically)
    expect(deriveRequiredScopes([[[POL_R]], [[PA_RW]]])).toEqual([[PA_RW, POL_R]]);
  });

  it("strips ALWAYS_REQUIRED_SCOPES (User.Read) from each alternative", () => {
    // [[USER_READ]] alone collapses to [] (unconditionally enabled).
    expect(deriveRequiredScopes([[[USER_READ]]])).toEqual([]);
    // Mixed: [[USER_READ, PA_RW]] strips USER_READ → [[PA_RW]].
    expect(deriveRequiredScopes([[[USER_READ, PA_RW]]])).toEqual([[PA_RW]]);
  });

  it("expands an OR-pair call site against a single-alternative call site", () => {
    // ([[Read], [ReadWrite]]) ∧ [[POL_R]] → [[Read, POL_R], [ReadWrite, POL_R]],
    // each alternative sorted alphabetically.
    const out = deriveRequiredScopes([[[R_DIR], [RW_DIR]], [[POL_R]]]);
    expect(out).toContainEqual([R_DIR, POL_R]);
    expect(out).toContainEqual([RW_DIR, POL_R]);
    expect(out).toHaveLength(2);
  });

  it("intersection of [Read OR ReadWrite] with [ReadWrite] keeps only ReadWrite alternatives", () => {
    // ([[R], [RW]]) ∧ [[RW]] → cartesian: [[R, RW], [RW, RW]] → dedup → [[R, RW], [RW]].
    // After superset removal, [R, RW] is dropped (strict superset of [RW]).
    const out = deriveRequiredScopes([[[R_DIR], [RW_DIR]], [[RW_DIR]]]);
    expect(out).toEqual([[RW_DIR]]);
  });

  it("dedupes scopes that appear in multiple call sites", () => {
    // [[POL_R, PA_RW]] ∧ [[PA_RW]] → [[POL_R, PA_RW]] sorted to [[PA_RW, POL_R]]
    expect(deriveRequiredScopes([[[POL_R, PA_RW]], [[PA_RW]]])).toEqual([[PA_RW, POL_R]]);
  });

  it("each alternative is sorted for stable output", () => {
    const out = deriveRequiredScopes([[[POL_R]], [[PA_RW]], [[RAS_RW]]]);
    expect(out).toEqual([[PA_RW, RAS_RW, POL_R]]);
  });
});
