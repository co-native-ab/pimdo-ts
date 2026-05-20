// MCP tool: pim_role_entra_eligible_list — list directory roles the
// signed-in user is eligible to activate via PIM.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { LIST_ELIGIBLE_ROLE_ENTRA_SCOPES, listEligibleRoleEntraAssignments } from "../client.js";
import type { ServerConfig } from "../../../server-config.js";
import { maxPagesSchema, pageSizeSchema, truncationWarning } from "../../../http/paging.js";
import { deriveRequiredScopes } from "../../../scopes-runtime.js";
import type { Tool, ToolDef } from "../../../tool-registry.js";
import { formatError } from "../../../tools/shared.js";
import { formatEligibleAssignmentsText } from "../format.js";

const inputSchema = z.object({ pageSize: pageSizeSchema, maxPages: maxPagesSchema }).shape;

const def: ToolDef = {
  name: "pim_role_entra_eligible_list",
  title: "List eligible PIM Entra-role assignments",
  description:
    "List Entra (directory) roles the signed-in user is eligible to activate via PIM. " +
    "Returns the role display name, role definition id, eligibility id, directory scope and any time bounds.",
  requiredScopes: deriveRequiredScopes([LIST_ELIGIBLE_ROLE_ENTRA_SCOPES]),
};

function handler(config: ServerConfig): ToolCallback<typeof inputSchema> {
  return async (args, { signal }) => {
    try {
      const result = await listEligibleRoleEntraAssignments(config.graphClient, signal, {
        pageSize: args.pageSize,
        maxPages: args.maxPages,
      });
      return {
        content: [
          {
            type: "text",
            text: formatEligibleAssignmentsText(result.items) + truncationWarning(result),
          },
        ],
      };
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
