// MCP tool: pim_role_azure_active_list — list Azure resource roles
// the signed-in user has currently activated via PIM.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { listActiveRoleAzureAssignments } from "../client.js";
import type { ServerConfig } from "../../../server-config.js";
import { maxPagesSchema, pageSizeSchema, truncationWarning } from "../../../http/paging.js";
import { deriveRequiredScopes } from "../../../scopes-runtime.js";
import { ROLE_AZURE_SCOPES } from "../client.js";
import type { Tool, ToolDef } from "../../../tool-registry.js";
import { formatError } from "../../../tools/shared.js";
import { formatActiveAssignmentsText } from "../format.js";

const inputSchema = z.object({ pageSize: pageSizeSchema, maxPages: maxPagesSchema }).shape;

const def: ToolDef = {
  name: "pim_role_azure_active_list",
  title: "List active PIM Azure-role assignments",
  description:
    "List Azure resource roles the signed-in user currently has activated via PIM, " +
    "with their active-until time.",
  requiredScopes: deriveRequiredScopes([ROLE_AZURE_SCOPES]),
};

function handler(config: ServerConfig): ToolCallback<typeof inputSchema> {
  return async (args, { signal }) => {
    try {
      const result = await listActiveRoleAzureAssignments(config.armClient, signal, {
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

export const pimRoleAzureActiveListTool: Tool<typeof inputSchema> = {
  def,
  inputSchema,
  annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  handler,
};
