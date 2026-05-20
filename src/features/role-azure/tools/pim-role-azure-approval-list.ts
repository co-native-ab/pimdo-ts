// MCP tool: pim_role_azure_approval_list — list PIM Azure-role
// approvals assigned to the signed-in user as an approver.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { hasLiveRoleAzureApprovalStageForMe, listRoleAzureApprovalRequests } from "../client.js";
import type { ServerConfig } from "../../../server-config.js";
import { deriveRequiredScopes } from "../../../scopes-runtime.js";
import { ROLE_AZURE_SCOPES } from "../client.js";
import type { Tool, ToolDef } from "../../../tool-registry.js";
import { formatError } from "../../../tools/shared.js";
import { classifyStaleApproverRequests, includeStaleField } from "../../../tools/pim/stale.js";
import { staleHiddenTrailer } from "../../../tools/pim/format-shared.js";
import { maxPagesSchema, pageSizeSchema, truncationWarning } from "../../../http/paging.js";
import { formatRequestsText } from "../format.js";

const inputSchema = z.object({
  includeStale: includeStaleField,
  pageSize: pageSizeSchema,
  maxPages: maxPagesSchema,
}).shape;

const def: ToolDef = {
  name: "pim_role_azure_approval_list",
  title: "List PIM Azure-role approvals assigned to me",
  description:
    "List PIM Azure-role activation requests where the signed-in user " +
    "is an approver. Does not filter by status - surface " +
    "the full approver-side queue. Stale entries (no live stage " +
    "assigned to the caller) are hidden by default; pass " +
    "includeStale: true to include them.",
  requiredScopes: deriveRequiredScopes([ROLE_AZURE_SCOPES]),
};

function handler(config: ServerConfig): ToolCallback<typeof inputSchema> {
  return async (args, { signal }) => {
    try {
      const result = await listRoleAzureApprovalRequests(config.armClient, signal, {
        pageSize: args.pageSize,
        maxPages: args.maxPages,
      });
      const items = result.items;
      const stale = await classifyStaleApproverRequests(
        items,
        {
          requestId: (r) => r.id,
          hasLiveStage: async (r, sig) => {
            const approvalId = r.properties.approvalId;
            if (!approvalId) return false;
            return hasLiveRoleAzureApprovalStageForMe(config.armClient, approvalId, sig);
          },
        },
        signal,
      );
      const warning = truncationWarning(result);
      const includeStale = args.includeStale ?? false;
      if (includeStale) {
        return {
          content: [{ type: "text", text: formatRequestsText(items, "approver", stale) + warning }],
        };
      }
      const visible = items.filter((it) => !stale.has(it.id));
      const body = formatRequestsText(visible, "approver");
      const trailer = staleHiddenTrailer(stale.size);
      return {
        content: [{ type: "text", text: (trailer ? `${body}\n${trailer}` : body) + warning }],
      };
    } catch (error) {
      return formatError(def.name, error);
    }
  };
}

export const pimRoleAzureApprovalListTool: Tool<typeof inputSchema> = {
  def,
  inputSchema,
  annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  handler,
};
