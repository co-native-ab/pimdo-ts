// MCP tool: pim_role_entra_eligible_list — list directory roles the
// signed-in user is eligible to activate via PIM.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { listEligibleRoleEntraAssignments } from "../../../graph/pim-role-entra.js";
import type { ServerConfig } from "../../../server-config.js";
import { OAuthScope } from "../../../scopes.js";
import type { Tool, ToolDef } from "../../../tool-registry.js";
import { formatError } from "../../shared.js";
import { formatEligibleAssignmentsText } from "./format.js";

const inputSchema = z.object({}).shape;

const def: ToolDef = {
  name: "pim_role_entra_eligible_list",
  title: "List eligible PIM Entra-role assignments",
  description:
    "List Entra (directory) roles the signed-in user is eligible to activate via PIM. " +
    "Returns the role display name, role definition id, eligibility id, directory scope, and any time bounds.",
  requiredScopes: [
    [OAuthScope.RoleEligibilityScheduleReadDirectory],
    [OAuthScope.RoleEligibilityScheduleReadWriteDirectory],
  ],
};

function handler(config: ServerConfig): ToolCallback<typeof inputSchema> {
  return async (_args, { signal }) => {
    try {
      const items = await listEligibleRoleEntraAssignments(config.graphClient, signal);
      return { content: [{ type: "text", text: formatEligibleAssignmentsText(items) }] };
    } catch (error) {
      return formatError(def.name, error);
    }
  };
}

export const pimRoleEntraEligibleListTool: Tool<typeof inputSchema> = {
  def,
  inputSchema,
  annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  handler,
};
