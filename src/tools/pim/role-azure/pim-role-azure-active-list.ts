// MCP tool: pim_role_azure_active_list — list Azure resource roles
// the signed-in user has currently activated via PIM.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { listActiveRoleAzureAssignments } from "../../../arm/pim-role-azure.js";
import type { ServerConfig } from "../../../server-config.js";
import { OAuthScope } from "../../../scopes.js";
import type { Tool, ToolDef } from "../../../tool-registry.js";
import { formatError } from "../../shared.js";
import { formatActiveAssignmentsText } from "./format.js";

const inputSchema = z.object({}).shape;

const def: ToolDef = {
  name: "pim_role_azure_active_list",
  title: "List active PIM Azure-role assignments",
  description:
    "List Azure resource roles the signed-in user currently has activated via PIM, " +
    "with their active-until time.",
  requiredScopes: [OAuthScope.ArmUserImpersonation],
};

function handler(config: ServerConfig): ToolCallback<typeof inputSchema> {
  return async (_args, { signal }) => {
    try {
      const items = await listActiveRoleAzureAssignments(config.armClient, signal);
      return { content: [{ type: "text", text: formatActiveAssignmentsText(items) }] };
    } catch (error) {
      return formatError(def.name, error);
    }
  };
}

export const pimRoleAzureActiveListTool: Tool<typeof inputSchema> = {
  def,
  inputSchema,
  annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  handler,
};
