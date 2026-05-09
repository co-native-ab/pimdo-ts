// MCP tool: pim_role_entra_active_list — list directory roles the
// signed-in user has currently activated.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { listActiveRoleEntraAssignments } from "../../../graph/pim-role-entra.js";
import type { ServerConfig } from "../../../server-config.js";
import { GraphScope } from "../../../scopes.js";
import type { Tool, ToolDef } from "../../../tool-registry.js";
import { formatError } from "../../shared.js";
import { formatActiveAssignmentsText } from "./format.js";

const inputSchema = z.object({}).shape;

const def: ToolDef = {
  name: "pim_role_entra_active_list",
  title: "List active PIM Entra-role assignments",
  description:
    "List Entra (directory) roles the signed-in user currently has activated via PIM, " +
    "with their active-until time.",
  requiredScopes: [GraphScope.RoleAssignmentScheduleReadWriteDirectory],
};

function handler(config: ServerConfig): ToolCallback<typeof inputSchema> {
  return async (_args, { signal }) => {
    try {
      const items = await listActiveRoleEntraAssignments(config.graphClient, signal);
      return { content: [{ type: "text", text: formatActiveAssignmentsText(items) }] };
    } catch (error) {
      return formatError(def.name, error);
    }
  };
}

export const pimRoleEntraActiveListTool: Tool<typeof inputSchema> = {
  def,
  inputSchema,
  annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  handler,
};
