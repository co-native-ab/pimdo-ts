// MCP tool: pim_group_active_list — list groups the signed-in user has
// currently activated.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { LIST_ACTIVE_GROUP_SCOPES, listActiveGroupAssignments } from "../client.js";
import type { ServerConfig } from "../../../server-config.js";
import { maxPagesSchema, pageSizeSchema, truncationWarning } from "../../../http/paging.js";
import { deriveRequiredScopes } from "../../../scopes-runtime.js";
import type { Tool, ToolDef } from "../../../tool-registry.js";
import { formatError } from "../../../tools/shared.js";
import { formatActiveAssignmentsText } from "../format.js";

const inputSchema = z.object({ pageSize: pageSizeSchema, maxPages: maxPagesSchema }).shape;

const def: ToolDef = {
  name: "pim_group_active_list",
  title: "List active PIM group assignments",
  description:
    "List Entra groups the signed-in user currently has activated via PIM, " +
    "with their active-until time.",
  requiredScopes: deriveRequiredScopes([LIST_ACTIVE_GROUP_SCOPES]),
};

function handler(config: ServerConfig): ToolCallback<typeof inputSchema> {
  return async (args, { signal }) => {
    try {
      const result = await listActiveGroupAssignments(config.graphClient, signal, {
        pageSize: args.pageSize,
        maxPages: args.maxPages,
      });
      return {
        content: [
          {
            type: "text",
            text: formatActiveAssignmentsText(result.items) + truncationWarning(result),
          },
        ],
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
