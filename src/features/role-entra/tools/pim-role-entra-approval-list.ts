// MCP tool: pim_role_entra_approval_list — list PIM Entra-role
// approvals assigned to the signed-in user as an approver.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  APPROVE_ROLE_ENTRA_SCOPES,
  LIST_ROLE_ENTRA_REQUESTS_SCOPES,
  hasLiveRoleEntraApprovalStepForMe,
  listRoleEntraApprovalRequests,
} from "../client.js";
import type { ServerConfig } from "../../../server-config.js";
import { deriveRequiredScopes } from "../../../scopes-runtime.js";
import type { Tool, ToolDef } from "../../../tool-registry.js";
import { formatError } from "../../../tools/shared.js";
import { classifyStaleApproverRequests, includeStaleField } from "../../../tools/pim/stale.js";
import { staleHiddenTrailer } from "../../../tools/pim/format-shared.js";
import { formatRequestsText } from "../format.js";

const inputSchema = z.object({ includeStale: includeStaleField }).shape;

const def: ToolDef = {
  name: "pim_role_entra_approval_list",
  title: "List PIM Entra-role approvals assigned to me",
  description:
    "List pending PIM Entra-role activation requests where the signed-in user " +
    "is an approver and has not yet recorded a decision. Stale entries " +
    "(no live step assigned to the caller) are hidden by default; pass " +
    "includeStale: true to include them.",
  requiredScopes: deriveRequiredScopes([
    LIST_ROLE_ENTRA_REQUESTS_SCOPES,
    APPROVE_ROLE_ENTRA_SCOPES,
  ]),
};

function handler(config: ServerConfig): ToolCallback<typeof inputSchema> {
  return async (args, { signal }) => {
    try {
      const items = await listRoleEntraApprovalRequests(config.graphClient, signal);
      const stale = await classifyStaleApproverRequests(
        items,
        {
          requestId: (r) => r.id,
          hasLiveStage: async (r, sig) => {
            if (!r.approvalId) return false;
            return hasLiveRoleEntraApprovalStepForMe(config.graphBetaClient, r.approvalId, sig);
          },
        },
        signal,
      );
      const includeStale = args.includeStale ?? false;
      if (includeStale) {
        return { content: [{ type: "text", text: formatRequestsText(items, "approver", stale) }] };
      }
      const visible = items.filter((it) => !stale.has(it.id));
      const body = formatRequestsText(visible, "approver");
      const trailer = staleHiddenTrailer(stale.size);
      return {
        content: [{ type: "text", text: trailer ? `${body}\n${trailer}` : body }],
      };
    } catch (error) {
      return formatError(def.name, error);
    }
  };
}

export const pimRoleEntraApprovalListTool: Tool<typeof inputSchema> = {
  def,
  inputSchema,
  annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  handler,
};
