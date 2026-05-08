// MCP tool: pim_group_eligible_list — list groups the signed-in user is
// eligible to activate via PIM.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { listEligibleGroupAssignments } from "../../../graph/pim-group.js";
import type { ServerConfig } from "../../../index.js";
import { GraphScope } from "../../../scopes.js";
import type { Tool, ToolDef } from "../../../tool-registry.js";
import { formatError } from "../../shared.js";
import { formatEligibleAssignmentsText } from "./format.js";

const inputSchema = z.object({}).shape;

const def: ToolDef = {
  name: "pim_group_eligible_list",
  title: "List eligible PIM group assignments",
  description:
    "List Entra groups the signed-in user is eligible to activate via PIM. " +
    "Returns the group display name, id, eligibility id, and any time bounds.",
  requiredScopes: [GraphScope.PrivilegedEligibilityScheduleReadWriteAzureADGroup],
};

function handler(config: ServerConfig): ToolCallback<typeof inputSchema> {
  return async (_args, { signal }) => {
    try {
      const items = await listEligibleGroupAssignments(config.graphClient, signal);
      return {
        content: [{ type: "text", text: formatEligibleAssignmentsText(items) }],
      };
    } catch (error) {
      return formatError(def.name, error);
    }
  };
}

export const pimGroupEligibleListTool: Tool<typeof inputSchema> = {
  def,
  inputSchema,
  annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  handler,
};
