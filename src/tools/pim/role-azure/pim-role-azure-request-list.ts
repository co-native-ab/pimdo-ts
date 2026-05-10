// MCP tool: pim_role_azure_request_list — list pending PIM Azure-role
// activation requests submitted by the signed-in user.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { listMyRoleAzureRequests } from "../../../arm/pim-role-azure.js";
import type { ServerConfig } from "../../../server-config.js";
import { OAuthScope } from "../../../scopes.js";
import type { Tool, ToolDef } from "../../../tool-registry.js";
import { formatError } from "../../shared.js";
import { formatRequestsText } from "./format.js";

const inputSchema = z.object({}).shape;

const def: ToolDef = {
  name: "pim_role_azure_request_list",
  title: "List my pending PIM Azure-role requests",
  description:
    "List PIM Azure-role activation/deactivation requests the signed-in user " +
    "has submitted. Does not filter by status — surface " +
    "all visible schedule requests.",
  requiredScopes: [[OAuthScope.ArmUserImpersonation]],
};

function handler(config: ServerConfig): ToolCallback<typeof inputSchema> {
  return async (_args, { signal }) => {
    try {
      const items = await listMyRoleAzureRequests(config.armClient, signal);
      return { content: [{ type: "text", text: formatRequestsText(items, "mine") }] };
    } catch (error) {
      return formatError(def.name, error);
    }
  };
}

export const pimRoleAzureRequestListTool: Tool<typeof inputSchema> = {
  def,
  inputSchema,
  annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  handler,
};
