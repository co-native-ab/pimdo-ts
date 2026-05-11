// MCP tool: pim_role_azure_approval_list — list PIM Azure-role
// approvals assigned to the signed-in user as an approver.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { listRoleAzureApprovalRequests } from "../client.js";
import type { ServerConfig } from "../../../server-config.js";
import { OAuthScope } from "../../../scopes.js";
import type { Tool, ToolDef } from "../../../tool-registry.js";
import { formatError } from "../../../tools/shared.js";
import { formatRequestsText } from "../format.js";

const inputSchema = z.object({}).shape;

const def: ToolDef = {
  name: "pim_role_azure_approval_list",
  title: "List PIM Azure-role approvals assigned to me",
  description:
    "List PIM Azure-role activation requests where the signed-in user " +
    "is an approver. Does not filter by status — surface " +
    "the full approver-side queue.",
  requiredScopes: [[OAuthScope.ArmUserImpersonation]],
};

function handler(config: ServerConfig): ToolCallback<typeof inputSchema> {
  return async (_args, { signal }) => {
    try {
      const items = await listRoleAzureApprovalRequests(config.armClient, signal);
      return { content: [{ type: "text", text: formatRequestsText(items, "approver") }] };
    } catch (error) {
      return formatError(def.name, error);
    }
  };
}

export const pimRoleAzureApprovalListTool: Tool<typeof inputSchema> = {
  def,
  inputSchema,
  annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  handler,
};
