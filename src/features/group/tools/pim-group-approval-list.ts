// MCP tool: pim_group_approval_list — list PIM group approvals assigned
// to the signed-in user as an approver.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { GROUP_PIM_RW_SCOPES, listGroupApprovalRequests } from "../client.js";
import type { ServerConfig } from "../../../server-config.js";
import { deriveRequiredScopes } from "../../../scopes-runtime.js";
import type { Tool, ToolDef } from "../../../tool-registry.js";
import { formatError } from "../../../tools/shared.js";
import { formatRequestsText } from "../format.js";

const inputSchema = z.object({}).shape;

const def: ToolDef = {
  name: "pim_group_approval_list",
  title: "List PIM group approvals assigned to me",
  description:
    "List pending PIM group activation requests where the signed-in user " +
    "is an approver and has not yet recorded a decision.",
  requiredScopes: deriveRequiredScopes([GROUP_PIM_RW_SCOPES]),
};

function handler(config: ServerConfig): ToolCallback<typeof inputSchema> {
  return async (_args, { signal }) => {
    try {
      const items = await listGroupApprovalRequests(config.graphClient, signal);
      return {
        content: [{ type: "text", text: formatRequestsText(items, "approver") }],
      };
    } catch (error) {
      return formatError(def.name, error);
    }
  };
}

export const pimGroupApprovalListTool: Tool<typeof inputSchema> = {
  def,
  inputSchema,
  annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  handler,
};
