// Claims-challenge parser.
//
// Microsoft Graph and Azure Resource Manager use the OAuth 2.0 / CAE
// "claims challenge" pattern to demand step-up authentication
// (Conditional Access auth context — e.g. requires MFA `c1`, compliant
// device, or a session-risk policy). The challenge is delivered in one
// of two shapes:
//
//   1. Standard CAE / OAuth: a `WWW-Authenticate: Bearer ...,
//      claims="<base64-or-json>"` header on a 401 response.
//   2. PIM-specific: the JSON error body's `error.message` carries a
//      URL-encoded `&claims=<json>` fragment on a 400
//      `RoleAssignmentRequestAcrsValidationFailed` (and friends).
//
// `extractClaimsChallenge` is a pure function that recognises both forms
// and returns the JSON claims string (suitable for handing straight to
// MSAL's `acquireTokenInteractive({ claims })`), or `null` when no
// challenge is present. The HTTP layer calls it from the existing
// `>= 400` branch — see `BaseHttpClient.performRequest`.

export interface ClaimsChallengeInput {
  /** Response headers (used to read `WWW-Authenticate`). */
  readonly headers: Headers;
  /** Raw response body text — checked for the PIM `&claims=` fragment. */
  readonly body: string;
  /** Parsed error message (from envelope) — also checked for `&claims=`. */
  readonly message?: string;
}

/**
 * Try to extract a claims-challenge JSON string from a response.
 *
 * Returns the decoded claims JSON ready to pass to MSAL, or `null` if
 * no challenge is present.
 */
export function extractClaimsChallenge(input: ClaimsChallengeInput): string | null {
  const fromHeader = extractFromWwwAuthenticate(input.headers.get("www-authenticate"));
  if (fromHeader !== null) return fromHeader;

  const fromMessage = extractFromMessageFragment(input.message);
  if (fromMessage !== null) return fromMessage;

  return extractFromMessageFragment(input.body);
}

/**
 * Parse the `WWW-Authenticate` header for a `claims=...` parameter.
 *
 * Three shapes are recognised, in order:
 *
 *   1. `claims="<base64url>"` — the documented CAE encoding.
 *   2. `claims="<raw JSON>"` — non-spec but pragmatic; the JSON
 *      contains literal unescaped double-quotes that defeat a naive
 *      RFC 7235 quoted-string parser, so we brace-balance instead.
 *   3. `claims=<unquoted token>` (no quotes).
 *
 * Returns the decoded JSON string, or `null` if no parseable claims
 * parameter is present.
 */
function extractFromWwwAuthenticate(headerValue: string | null): string | null {
  if (!headerValue) return null;

  // Find the start of a `claims=` parameter (case-insensitive).
  const startMatch = /(^|[\s,;])claims\s*=\s*/i.exec(headerValue);
  if (!startMatch) return null;
  const after = headerValue.slice(startMatch.index + startMatch[0].length);
  if (after.length === 0) return null;

  // Quoted form.
  if (after.startsWith('"')) {
    // Try a brace-balanced JSON extraction first to tolerate raw
    // unescaped JSON values. This succeeds when the value starts with
    // `{` and contains only ASCII (no bare `"` outside string
    // literals — JSON strings are themselves quoted).
    if (after.startsWith('"{')) {
      const json = extractBalancedJson(after.slice(1));
      if (json !== null) {
        return decodeClaimsValue(json);
      }
    }
    // Fall back to standard RFC 7235 quoted-string with backslash
    // escapes — appropriate for a base64url value.
    const re = /^"((?:[^"\\]|\\.)*)"/;
    const match = re.exec(after);
    if (!match) return null;
    const rawValue = (match[1] ?? "").replace(/\\(.)/g, "$1");
    return decodeClaimsValue(rawValue);
  }

  // Unquoted form: read up to the next comma / whitespace.
  const tokenMatch = /^([^,\s]+)/.exec(after);
  if (!tokenMatch) return null;
  return decodeClaimsValue(tokenMatch[1] ?? "");
}

/**
 * Read a balanced JSON object starting at the first `{` of `text`.
 * Tracks string boundaries (with backslash escapes) so braces inside
 * string literals don't confuse the depth counter. Returns the
 * substring (including the outer braces) or `null` when no balanced
 * object is found.
 */
function extractBalancedJson(text: string): string | null {
  if (!text.startsWith("{")) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(0, i + 1);
      }
    }
  }
  return null;
}

/**
 * Find a `claims=<url-encoded JSON>` fragment in an arbitrary text
 * blob (PIM error message or body). We accept both `&claims=` (as
 * returned by Microsoft Graph PIM today) and a leading `?claims=` /
 * `claims=` for robustness.
 */
function extractFromMessageFragment(text: string | undefined): string | null {
  if (!text) return null;

  const re = /[?&]claims=([^&\s"]+)/i;
  const match = re.exec(text);
  if (!match) return null;
  const rawValue = match[1] ?? "";
  if (rawValue.length === 0) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(rawValue);
  } catch {
    return null;
  }
  return decodeClaimsValue(decoded);
}

/**
 * Normalise a claims value (from header or body fragment) into a JSON
 * string. Accepts either raw JSON or base64url(JSON) per the CAE spec.
 * Returns `null` if the value is neither.
 */
function decodeClaimsValue(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  // Already JSON?
  if (trimmed.startsWith("{")) {
    return isValidJson(trimmed) ? trimmed : null;
  }

  // Try base64url → JSON.
  const base64 = trimmed.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  let decoded: string;
  try {
    decoded = Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return null;
  }
  return isValidJson(decoded) ? decoded : null;
}

function isValidJson(s: string): boolean {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}
