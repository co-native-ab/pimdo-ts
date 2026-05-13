import type { OAuthScope } from "./scopes.js";

export function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Not logged in - use the login tool to authenticate with Microsoft");
    this.name = "AuthenticationRequiredError";
  }
}

export class UserCancelledError extends Error {
  constructor(message = "Cancelled by user") {
    super(message);
    this.name = "UserCancelledError";
  }
}

/**
 * Thrown when the signed-in account does not have the OAuth scopes
 * required for a Graph or ARM operation.
 *
 * Distinct from {@link AuthenticationRequiredError}: re-running login
 * with the same scope selection will not resolve a missing scope, so
 * the agent must surface this to the user (typically asking them to
 * grant the missing consent) rather than silently retrying login.
 *
 * `required` is the full DNF (disjunctive normal form) requirement:
 * a list of alternatives, each of which is a list of scopes that must
 * all be granted. `missingExample` is the cheapest single alternative
 * to make the operation succeed — the gap between `granted` and the
 * smallest unsatisfied alternative — so error messages can suggest
 * the minimum extra consent required.
 */
export class MissingScopeError extends Error {
  readonly required: readonly (readonly OAuthScope[])[];
  readonly granted: readonly OAuthScope[];
  readonly missingExample: readonly OAuthScope[];

  constructor(
    required: readonly (readonly OAuthScope[])[],
    granted: readonly OAuthScope[],
    missingExample: readonly OAuthScope[],
  ) {
    const requiredText = formatRequiredDnf(required);
    const missingText = missingExample.join(", ");
    super(
      `Missing OAuth scope(s) for this operation. Requires ${requiredText}. ` +
        `Currently granted: ${granted.length === 0 ? "<none>" : granted.join(", ")}. ` +
        `Re-run login and consent at least: ${missingText}.`,
    );
    this.name = "MissingScopeError";
    this.required = required;
    this.granted = granted;
    this.missingExample = missingExample;
  }
}

function formatRequiredDnf(required: readonly (readonly OAuthScope[])[]): string {
  if (required.length === 0) return "<none>";
  const parts = required.map((group) => {
    if (group.length === 0) return "<none>";
    if (group.length === 1) return group[0] as string;
    return `(${group.join(" AND ")})`;
  });
  return parts.length === 1 ? (parts[0] ?? "<none>") : parts.join(" OR ");
}
