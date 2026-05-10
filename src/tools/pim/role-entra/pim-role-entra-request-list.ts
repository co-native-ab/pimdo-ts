// MCP tool: pim_role_entra_request_list — list pending PIM Entra-role
// activation requests submitted by the signed-in user.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { listMyRoleEntraRequests } from "../../../graph/pim-role-entra.js";
import type { ServerConfig } from "../../../server-config.js";
import { OAuthScope } from "../../../scopes.js";
import type { Tool, ToolDef } from "../../../tool-registry.js";
import { formatError } from "../../shared.js";
import { formatRequestsText } from "./format.js";

const inputSchema = z.object({}).shape;

const def: ToolDef = {
  name: "pim_role_entra_request_list",
  title: "List my pending PIM Entra-role requests",
  description:
    "List PIM Entra-role activation/deactivation requests the signed-in user " +
    "has submitted that are still pending approval.",
  requiredScopes: [OAuthScope.RoleManagementReadWriteDirectory],
};

function handler(config: ServerConfig): ToolCallback<typeof inputSchema> {
  return async (_args, { signal }) => {
    try {
      const items = await listMyRoleEntraRequests(config.graphClient, signal);
      return { content: [{ type: "text", text: formatRequestsText(items, "mine") }] };
    } catch (error) {
      return formatError(def.name, error);
    }
  };
}

export const pimRoleEntraRequestListTool: Tool<typeof inputSchema> = {
  def,
  inputSchema,
  annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  handler,
};
