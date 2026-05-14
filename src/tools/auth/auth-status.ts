// MCP tool: auth_status — show authentication state, account, granted scopes,
// and pimdo version.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ServerConfig } from "../../server-config.js";
import { VERSION } from "../../index.js";
import { type OAuthScope } from "../../scopes.js";
import { formatRequiredScopes, type Tool, type ToolDef } from "../../tool-registry.js";
import { formatError } from "../shared.js";

const inputSchema = z.object({}).shape;

const def: ToolDef = {
  name: "auth_status",
  title: "Authentication Status",
  description:
    "Check current authentication status, logged-in user, granted scopes, and " +
    "server version. A good first tool to call when diagnosing PIM access " +
    "issues or confirming that the right consent has been granted.",
  requiredScopes: [],
};

/**
 * Pick the alternative requiring the fewest additional scopes — the
 * cheapest consent gap to grant in order to enable the tool. Mirrors
 * the logic in {@link assertScopes} so the human and machine sides
 * agree on which scopes to suggest.
 */
function cheapestMissingScopes(
  required: readonly (readonly OAuthScope[])[],
  granted: ReadonlySet<OAuthScope>,
): readonly OAuthScope[] {
  let best: readonly OAuthScope[] = required[0] ?? [];
  let bestCount = Number.POSITIVE_INFINITY;
  for (const alt of required) {
    const missing = alt.filter((s) => !granted.has(s));
    if (missing.length < bestCount) {
      best = missing;
      bestCount = missing.length;
    }
  }
  return best;
}

function handler(config: ServerConfig): ToolCallback<typeof inputSchema> {
  return async (_args, { signal }) => {
    try {
      const lines: string[] = [];
      lines.push(`pimdo v${VERSION}`);
      lines.push("");

      const authenticated = await config.authenticator.isAuthenticated(signal);
      if (authenticated) {
        const info = await config.authenticator.accountInfo(signal);
        lines.push(`Status: Logged in`);
        if (info) {
          lines.push(`User: ${info.username}`);
        }

        const scopes = await config.authenticator.grantedScopes(signal);
        if (scopes.length > 0) {
          lines.push(`Scopes: ${scopes.join(", ")}`);
        }

        // Surface tools that are currently hidden because their
        // requiredScopes are not satisfied. Common cause: the tenant's
        // admin consent omitted a scope (or downgraded a requested
        // `ReadWrite` scope to its `Read` variant — pimdo intentionally
        // does not accept the `Read` variant as a fallback for tools
        // that need `ReadWrite`; see ADR-0017).
        if (config.toolDefs) {
          const grantedSet = new Set<OAuthScope>(scopes);
          const hidden = config.toolDefs.filter(
            (d) =>
              d.requiredScopes.length > 0 &&
              !d.requiredScopes.some((alt) => alt.every((s) => grantedSet.has(s))),
          );
          if (hidden.length > 0) {
            lines.push("");
            lines.push(`Hidden tools (${String(hidden.length)}):`);
            for (const d of hidden) {
              const missing = cheapestMissingScopes(d.requiredScopes, grantedSet);
              const required = formatRequiredScopes(d.requiredScopes);
              lines.push(`  - ${d.name} — missing ${missing.join(", ")} (requires ${required})`);
            }
          }
        }
      } else {
        lines.push("Status: Not logged in");
        lines.push('Use the "login" tool to authenticate with Microsoft.');
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (error: unknown) {
      return formatError("status check", error, { prefix: "Status check failed: " });
    }
  };
}

export const authStatusTool: Tool<typeof inputSchema> = {
  def,
  inputSchema,
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler,
};
