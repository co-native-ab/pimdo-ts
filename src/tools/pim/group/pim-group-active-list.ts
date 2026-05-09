// MCP tool: pim_group_active_list — list groups the signed-in user has
// currently activated.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { listActiveGroupAssignments } from "../../../graph/pim-group.js";
import type { ServerConfig } from "../../../server-config.js";
import { OAuthScope } from "../../../scopes.js";
import type { Tool, ToolDef } from "../../../tool-registry.js";
import { formatError } from "../../shared.js";
import { formatActiveAssignmentsText } from "./format.js";

const inputSchema = z.object({}).shape;

const def: ToolDef = {
  name: "pim_group_active_list",
  title: "List active PIM group assignments",
  description:
    "List Entra groups the signed-in user currently has activated via PIM, " +
    "with their active-until time.",
  requiredScopes: [OAuthScope.PrivilegedAssignmentScheduleReadWriteAzureADGroup],
};

function handler(config: ServerConfig): ToolCallback<typeof inputSchema> {
  return async (_args, { signal }) => {
    try {
      const items = await listActiveGroupAssignments(config.graphClient, signal);
      return {
        content: [{ type: "text", text: formatActiveAssignmentsText(items) }],
      };
    } catch (error) {
      return formatError(def.name, error);
    }
  };
}

export const pimGroupActiveListTool: Tool<typeof inputSchema> = {
  def,
  inputSchema,
  annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  handler,
};
