// Bearer-token scope encoding + per-route enforcement helpers used by
// the in-process Microsoft Graph and ARM mocks.
//
// This is the second line of defence behind {@link assertScopes}: even
// if a feature client function ever forgets the early scope guard, the
// mock servers will still reject the request with a realistic
// `403 Forbidden` envelope when the bearer token's encoded scope set
// does not satisfy the route's documented scope DNF.
//
// Opt-in. Enforcement is keyed on the bearer token format:
//
//   - `mock-scopes:<scope1>,<scope2>,...` — enforce against the
//     decoded scope set. The decoded set may be empty.
//   - anything else (e.g. `fake-token`, `test-token`) — bypass.
//
// This bypass keeps the dozens of pre-existing transport-layer tests
// (which use bare-string tokens) working unchanged. Tests that want
// to exercise enforcement opt in by routing through
// {@link MockAuthenticator} with `encodeBearerScopes: true`, or by
// passing a `mockTokenForScopes(...)` literal directly to
// `GraphClient`/`ArmClient`.

import type http from "node:http";

import type { OAuthScope } from "../src/scopes.js";

const PREFIX = "mock-scopes:";

/**
 * Encode an OAuth scope set as a bearer token the mock servers will
 * recognise and enforce. Empty `scopes` produces a syntactically valid
 * mock token that satisfies no DNF except `[]` (always-allowed).
 */
export function mockTokenForScopes(scopes: readonly OAuthScope[]): string {
  return `${PREFIX}${scopes.join(",")}`;
}

/**
 * Decode the bearer token from an `Authorization: Bearer <token>` header.
 * Returns:
 *
 *   - `OAuthScope[]` (possibly empty) if the token uses the
 *     `mock-scopes:` prefix.
 *   - `null` if the header is absent, malformed, or uses any other
 *     bearer literal — meaning "enforcement bypassed for this request".
 */
export function parseBearerScopes(authHeader: string | undefined): OAuthScope[] | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!m) return null;
  const token = (m[1] ?? "").trim();
  if (!token.startsWith(PREFIX)) return null;
  const csv = token.slice(PREFIX.length);
  if (csv === "") return [];
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0) as OAuthScope[];
}

/**
 * Check that the request's bearer-token scope set satisfies at least
 * one alternative in `required` (the DNF semantics shared with
 * {@link assertScopes} and {@link syncToolState}). Returns:
 *
 *   - `true` when the request may proceed (either enforcement is
 *     bypassed for this token format, or `required` is empty, or at
 *     least one alternative is satisfied).
 *   - `false` after writing a 403 error envelope to `res`. The caller
 *     should `return` immediately.
 */
export function enforceScopes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  required: readonly (readonly OAuthScope[])[],
  writeError: (res: http.ServerResponse, status: number, code: string, message: string) => void,
): boolean {
  if (required.length === 0) return true;
  const granted = parseBearerScopes(headerString(req.headers.authorization));
  if (granted === null) return true; // bypass for non-mock tokens
  const grantedSet = new Set<OAuthScope>(granted);
  const ok = required.some((alt) => alt.every((s) => grantedSet.has(s)));
  if (ok) return true;

  // Pick the alternative with the fewest missing scopes — same heuristic
  // assertScopes uses for `MissingScopeError.missingExample`, so the
  // diagnostic messages line up between the two layers.
  let bestMissing: readonly OAuthScope[] = required[0] ?? [];
  let bestCount = Number.POSITIVE_INFINITY;
  for (const alt of required) {
    const missing = alt.filter((s) => !grantedSet.has(s));
    if (missing.length < bestCount) {
      bestMissing = missing;
      bestCount = missing.length;
    }
  }
  writeError(
    res,
    403,
    "Forbidden",
    `Mock scope enforcement: missing required scope(s) ${bestMissing.join(", ")}`,
  );
  return false;
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
