// MCP tool: pim_role_azure_eligible_list — list Azure resource roles
// the signed-in user is eligible to activate via PIM.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { listEligibleRoleAzureAssignments } from "../../../arm/pim-role-azure.js";
import type { ServerConfig } from "../../../index.js";
import { GraphScope } from "../../../scopes.js";
import type { Tool, ToolDef } from "../../../tool-registry.js";
import { formatError } from "../../shared.js";
import { formatEligibleAssignmentsText } from "./format.js";

const inputSchema = z.object({}).shape;

const def: ToolDef = {
  name: "pim_role_azure_eligible_list",
  title: "List eligible PIM Azure-role assignments",
  description:
    "List Azure resource roles (subscriptions, resource groups, resources) the " +
    "signed-in user is eligible to activate via PIM. Returns the role display " +
    "name, role definition id, eligibility id, ARM scope, and any time bounds.",
  requiredScopes: [GraphScope.ArmUserImpersonation],
};

function handler(config: ServerConfig): ToolCallback<typeof inputSchema> {
  return async (_args, { signal }) => {
    try {
      const items = await listEligibleRoleAzureAssignments(config.armClient, signal);
      return { content: [{ type: "text", text: formatEligibleAssignmentsText(items) }] };
    } catch (error) {
      return formatError(def.name, error);
    }
  };
}

export const pimRoleAzureEligibleListTool: Tool<typeof inputSchema> = {
  def,
  inputSchema,
  annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  handler,
};
