// MCP tool: pim_role_azure_request_list — list pending PIM Azure-role
// activation requests submitted by the signed-in user.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { listEligibleRoleAzureAssignments, listMyRoleAzureRequests } from "../client.js";
import type { ServerConfig } from "../../../server-config.js";
import { deriveRequiredScopes } from "../../../scopes-runtime.js";
import { ROLE_AZURE_SCOPES } from "../client.js";
import type { Tool, ToolDef } from "../../../tool-registry.js";
import { formatError } from "../../../tools/shared.js";
import { classifyStalePrincipalRequests, includeStaleField } from "../../../tools/pim/stale.js";
import { staleHiddenTrailer } from "../../../tools/pim/format-shared.js";
import { formatRequestsText, scopeFromAssignment } from "../format.js";

const inputSchema = z.object({ includeStale: includeStaleField }).shape;

function azureTargetKey(roleDefinitionId: string, scope: string | undefined): string {
  return `${roleDefinitionId}@${scope ?? ""}`;
}

const def: ToolDef = {
  name: "pim_role_azure_request_list",
  title: "List my pending PIM Azure-role requests",
  description:
    "List PIM Azure-role activation/deactivation requests the signed-in user " +
    "has submitted. Does not filter by status - surface " +
    "all visible schedule requests. Stale entries " +
    "(SelfActivate where the user has lost eligibility) are hidden by " +
    "default; pass includeStale: true to include them - they can then " +
    "be retracted via pim_role_azure_request_cancel.",
  requiredScopes: deriveRequiredScopes([ROLE_AZURE_SCOPES]),
};

function handler(config: ServerConfig): ToolCallback<typeof inputSchema> {
  return async (args, { signal }) => {
    try {
      const items = await listMyRoleAzureRequests(config.armClient, signal);
      const stale = await classifyStalePrincipalRequests(
        items,
        {
          requestKey: (r) => azureTargetKey(r.properties.roleDefinitionId, scopeFromAssignment(r)),
          action: (r) => r.properties.requestType,
          requestId: (r) => r.id,
          liveEligibilityKeys: async (sig) => {
            const eligibilities = await listEligibleRoleAzureAssignments(config.armClient, sig);
            return new Set(
              eligibilities.map((e) =>
                azureTargetKey(e.properties.roleDefinitionId, scopeFromAssignment(e)),
              ),
            );
          },
        },
        signal,
      );
      const includeStale = args.includeStale ?? false;
      if (includeStale) {
        return { content: [{ type: "text", text: formatRequestsText(items, "mine", stale) }] };
      }
      const visible = items.filter((it) => !stale.has(it.id));
      const body = formatRequestsText(visible, "mine");
      const trailer = staleHiddenTrailer(stale.size, "pim_role_azure_request_cancel");
      return {
        content: [{ type: "text", text: trailer ? `${body}\n${trailer}` : body }],
      };
    } catch (error) {
      return formatError(def.name, error);
    }
  };
}

export const pimRoleAzureRequestListTool: Tool<typeof inputSchema> = {
  def,
  inputSchema,
  annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  handler,
};
