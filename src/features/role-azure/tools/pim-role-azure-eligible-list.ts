// MCP tool: pim_role_azure_eligible_list — list Azure resource roles
// the signed-in user is eligible to activate via PIM.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { listEligibleRoleAzureAssignments } from "../client.js";
import type { ServerConfig } from "../../../server-config.js";
import { deriveRequiredScopes } from "../../../scopes-runtime.js";
import { ROLE_AZURE_SCOPES } from "../client.js";
import type { Tool, ToolDef } from "../../../tool-registry.js";
import { formatError } from "../../../tools/shared.js";
import { formatEligibleAssignmentsText } from "../format.js";

const inputSchema = z.object({}).shape;

const def: ToolDef = {
  name: "pim_role_azure_eligible_list",
  title: "List eligible PIM Azure-role assignments",
  description:
    "List Azure resource roles (subscriptions, resource groups, resources) the " +
    "signed-in user is eligible to activate via PIM. Returns the role display " +
    "name, role definition id, eligibility id, ARM scope and any time bounds.",
  requiredScopes: deriveRequiredScopes([ROLE_AZURE_SCOPES]),
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
