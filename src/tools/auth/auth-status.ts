// MCP tool: auth_status — show authentication state, account, granted scopes,
// and pimdo version.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ServerConfig } from "../../server-config.js";
import { VERSION } from "../../index.js";
import type { Tool, ToolDef } from "../../tool-registry.js";
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
