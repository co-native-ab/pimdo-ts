// MCP tool: pim_role_entra_active_list — list directory roles the
// signed-in user has currently activated.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { LIST_ACTIVE_ROLE_ENTRA_SCOPES, listActiveRoleEntraAssignments } from "../client.js";
import type { ServerConfig } from "../../../server-config.js";
import { maxPagesSchema, pageSizeSchema, truncationWarning } from "../../../http/paging.js";
import { deriveRequiredScopes } from "../../../scopes-runtime.js";
import type { Tool, ToolDef } from "../../../tool-registry.js";
import { formatError } from "../../../tools/shared.js";
import { formatActiveAssignmentsText } from "../format.js";

const inputSchema = z.object({ pageSize: pageSizeSchema, maxPages: maxPagesSchema }).shape;

const def: ToolDef = {
  name: "pim_role_entra_active_list",
  title: "List active PIM Entra-role assignments",
  description:
    "List Entra (directory) roles the signed-in user currently has activated via PIM, " +
    "with their active-until time.",
  requiredScopes: deriveRequiredScopes([LIST_ACTIVE_ROLE_ENTRA_SCOPES]),
};

function handler(config: ServerConfig): ToolCallback<typeof inputSchema> {
  return async (args, { signal }) => {
    try {
      const result = await listActiveRoleEntraAssignments(config.graphClient, signal, {
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

export const pimRoleEntraActiveListTool: Tool<typeof inputSchema> = {
  def,
  inputSchema,
  annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  handler,
};
