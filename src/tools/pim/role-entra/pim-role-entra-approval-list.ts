// MCP tool: pim_role_entra_approval_list — list PIM Entra-role
// approvals assigned to the signed-in user as an approver.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { listRoleEntraApprovalRequests } from "../../../graph/pim-role-entra.js";
import type { ServerConfig } from "../../../server-config.js";
import { GraphScope } from "../../../scopes.js";
import type { Tool, ToolDef } from "../../../tool-registry.js";
import { formatError } from "../../shared.js";
import { formatRequestsText } from "./format.js";

const inputSchema = z.object({}).shape;

const def: ToolDef = {
  name: "pim_role_entra_approval_list",
  title: "List PIM Entra-role approvals assigned to me",
  description:
    "List pending PIM Entra-role activation requests where the signed-in user " +
    "is an approver and has not yet recorded a decision.",
  requiredScopes: [GraphScope.RoleManagementReadWriteDirectory],
};

function handler(config: ServerConfig): ToolCallback<typeof inputSchema> {
  return async (_args, { signal }) => {
    try {
      const items = await listRoleEntraApprovalRequests(config.graphClient, signal);
      return { content: [{ type: "text", text: formatRequestsText(items, "approver") }] };
    } catch (error) {
      return formatError(def.name, error);
    }
  };
}

export const pimRoleEntraApprovalListTool: Tool<typeof inputSchema> = {
  def,
  inputSchema,
  annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  handler,
};
