// Runtime helpers for OAuth scope checking.
//
// Two pieces:
//
//   - `assertScopes(auth, required, signal)` — early scope guard called
//     by every Graph/ARM client function before its HTTP request. Fails
//     fast with a typed {@link MissingScopeError} when the signed-in
//     account is missing the scopes Microsoft documents for that
//     endpoint. Distinct from `AuthenticationRequiredError` so the
//     auto-relogin error path does not silently retry-and-fail.
//
//   - `deriveRequiredScopes(callSites)` — pure helper used by tool
//     descriptors. Given the per-call-site scope DNFs that a tool's
//     handler will exercise, returns the DNF intersection: the set of
//     alternatives that satisfy *every* call site at once. This becomes
//     the tool's `requiredScopes` for {@link syncToolState}, eliminating
//     drift between what the tool advertises and what its underlying
//     calls actually need.
//
// Both helpers operate on the same DNF shape used by
// {@link ToolDef.requiredScopes}: `OAuthScope[][]` is a disjunction of
// conjunctions. `[[A, B], [C]]` reads as "(A AND B) OR C".

import type { TokenCredential } from "./http/base-client.js";
import { MissingScopeError } from "./errors.js";
import { ALWAYS_REQUIRED_SCOPES, type OAuthScope } from "./scopes.js";

/**
 * Throw {@link MissingScopeError} when the credential cannot prove the
 * signed-in account satisfies at least one alternative in `required`.
 *
 * Matches the same DNF semantics as {@link syncToolState}: the
 * operation is allowed when at least one inner array is fully covered
 * by the granted scope set. Empty `required` is treated as "always
 * allowed" (matches the tool registry convention).
 *
 * If the credential does not implement `grantedScopes` (e.g. a test
 * client constructed from a plain-string token), the check is skipped.
 * Production code always uses the real {@link Authenticator}, which
 * always implements it; tests that exercise scope enforcement use
 * {@link MockAuthenticator}, which also always implements it.
 *
 * The `missingExample` carried on the thrown error is the single
 * alternative with the fewest missing scopes — the cheapest consent
 * the user could grant to satisfy the operation.
 */
export async function assertScopes(
  credential: TokenCredential,
  required: readonly (readonly OAuthScope[])[],
  signal: AbortSignal,
): Promise<void> {
  if (required.length === 0) return;
  if (!credential.grantedScopes) return;
  const granted = (await credential.grantedScopes(signal)) as readonly OAuthScope[];
  const grantedSet = new Set<OAuthScope>(granted);
  const satisfied = required.some((alternative) => alternative.every((s) => grantedSet.has(s)));
  if (satisfied) return;

  // Pick the alternative requiring the fewest *additional* scopes.
  let best: readonly OAuthScope[] = required[0] ?? [];
  let bestMissingCount = Number.POSITIVE_INFINITY;
  for (const alternative of required) {
    const missing = alternative.filter((s) => !grantedSet.has(s));
    if (missing.length < bestMissingCount) {
      best = missing;
      bestMissingCount = missing.length;
    }
  }
  throw new MissingScopeError(required, granted, best);
}

/**
 * Compute a tool's effective `requiredScopes` DNF from the per-call-site
 * scope DNFs its handler exercises.
 *
 * Each call site is itself a DNF (`OAuthScope[][]` — alternatives of
 * conjunctions). A scope set satisfies the tool iff it satisfies every
 * call site. The intersection is the cartesian product of one
 * alternative from each call site, with each chosen alternative
 * concatenated and de-duplicated.
 *
 * Examples:
 * - `[[A]]` ∧ `[[B]]` → `[[A, B]]`
 * - `[[A]] OR [[B]]` ∧ `[[C]]` → `[[A, C], [B, C]]`
 * - `[[A], [B]]` ∧ `[[A, C]]` → `[[A, C], [B, A, C]]`
 *
 * After the cartesian product we drop alternatives that are strict
 * supersets of another alternative (they would never be the cheapest
 * way to satisfy the tool) — keeps the gating decision and error
 * messages compact.
 *
 * Empty `callSites` returns `[]` (always-enabled, matching the
 * registry convention for a tool with no scope requirements).
 */
export function deriveRequiredScopes(
  callSites: readonly (readonly (readonly OAuthScope[])[])[],
): OAuthScope[][] {
  if (callSites.length === 0) return [];
  // Defensive: a call site declared with zero alternatives (`[]`) is a
  // bug — it would mean "no way to satisfy this call". Treat as always
  // allowed to avoid producing an empty cartesian product that would
  // disable the tool unconditionally.
  const nonEmpty = callSites.filter((cs) => cs.length > 0);
  if (nonEmpty.length === 0) return [];

  let acc: OAuthScope[][] = [[]];
  for (const callSite of nonEmpty) {
    const next: OAuthScope[][] = [];
    for (const partial of acc) {
      for (const alternative of callSite) {
        const merged = dedupe([...partial, ...alternative]);
        next.push(merged);
      }
    }
    acc = next;
  }

  // Strip ALWAYS_REQUIRED_SCOPES from each alternative — they are
  // always granted, so listing them in `requiredScopes` adds noise to
  // the gating decision and the auth_status output.
  const alwaysGranted = new Set<OAuthScope>(ALWAYS_REQUIRED_SCOPES);
  const stripped = acc.map((a) => a.filter((s) => !alwaysGranted.has(s)));
  // After stripping, an alternative may collapse to []. That means the
  // call site only requires always-granted scopes — the tool is
  // unconditionally enabled and we collapse to `[]` (matching the
  // registry convention).
  if (stripped.some((a) => a.length === 0)) return [];

  return removeSupersets(stripped).map((a) => [...a].sort());
}

function dedupe(scopes: readonly OAuthScope[]): OAuthScope[] {
  return Array.from(new Set(scopes));
}

function removeSupersets(alternatives: readonly OAuthScope[][]): OAuthScope[][] {
  const sets = alternatives.map((a) => new Set(a));
  return alternatives.filter((a, i) => {
    const me = sets[i] ?? new Set<OAuthScope>();
    return !alternatives.some((other, j) => {
      if (i === j) return false;
      const them = sets[j] ?? new Set<OAuthScope>();
      if (them.size >= me.size) return false; // strict subset only
      for (const s of them) if (!me.has(s)) return false;
      return true;
    });
  });
}
