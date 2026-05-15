// MCP tool: pim_role_entra_request_list — list pending PIM Entra-role
// activation requests submitted by the signed-in user.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  LIST_ELIGIBLE_ROLE_ENTRA_SCOPES,
  LIST_ROLE_ENTRA_REQUESTS_SCOPES,
  listEligibleRoleEntraAssignments,
  listMyRoleEntraRequests,
} from "../client.js";
import type { ServerConfig } from "../../../server-config.js";
import { deriveRequiredScopes } from "../../../scopes-runtime.js";
import type { Tool, ToolDef } from "../../../tool-registry.js";
import { formatError } from "../../../tools/shared.js";
import { classifyStalePrincipalRequests } from "../../../tools/pim/stale.js";
import { formatRequestsText } from "../format.js";

const inputSchema = z.object({}).shape;

function entraTargetKey(roleDefinitionId: string, directoryScopeId: string | undefined): string {
  return `${roleDefinitionId}@${directoryScopeId ?? "/"}`;
}

const def: ToolDef = {
  name: "pim_role_entra_request_list",
  title: "List my pending PIM Entra-role requests",
  description:
    "List PIM Entra-role activation/deactivation requests the signed-in user " +
    "has submitted that are still pending approval. Stale requests " +
    "(selfActivate where the user has lost eligibility) are flagged " +
    "[stale] — they can be retracted via pim_role_entra_request_cancel.",
  requiredScopes: deriveRequiredScopes([
    LIST_ROLE_ENTRA_REQUESTS_SCOPES,
    LIST_ELIGIBLE_ROLE_ENTRA_SCOPES,
  ]),
};

function handler(config: ServerConfig): ToolCallback<typeof inputSchema> {
  return async (_args, { signal }) => {
    try {
      const items = await listMyRoleEntraRequests(config.graphClient, signal);
      const stale = await classifyStalePrincipalRequests(
        items,
        {
          requestKey: (r) => entraTargetKey(r.roleDefinitionId, r.directoryScopeId),
          action: (r) => r.action,
          requestId: (r) => r.id,
          liveEligibilityKeys: async (sig) => {
            const eligibilities = await listEligibleRoleEntraAssignments(config.graphClient, sig);
            return new Set(
              eligibilities.map((e) => entraTargetKey(e.roleDefinitionId, e.directoryScopeId)),
            );
          },
        },
        signal,
      );
      return { content: [{ type: "text", text: formatRequestsText(items, "mine", stale) }] };
    } catch (error) {
      return formatError(def.name, error);
    }
  };
}

export const pimRoleEntraRequestListTool: Tool<typeof inputSchema> = {
  def,
  inputSchema,
  annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  handler,
};
