// MCP tool: pim_group_approval_list — list PIM group approvals assigned
// to the signed-in user as an approver.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  APPROVE_GROUP_SCOPES,
  LIST_GROUP_REQUESTS_SCOPES,
  hasLiveGroupApprovalStageForMe,
  listGroupApprovalRequests,
} from "../client.js";
import type { ServerConfig } from "../../../server-config.js";
import { deriveRequiredScopes } from "../../../scopes-runtime.js";
import type { Tool, ToolDef } from "../../../tool-registry.js";
import { formatError } from "../../../tools/shared.js";
import { classifyStaleApproverRequests } from "../../../tools/pim/stale.js";
import { formatRequestsText } from "../format.js";

const inputSchema = z.object({}).shape;

const def: ToolDef = {
  name: "pim_group_approval_list",
  title: "List PIM group approvals assigned to me",
  description:
    "List pending PIM group activation requests where the signed-in user " +
    "is an approver and has not yet recorded a decision. Stale requests " +
    "(no live stage assigned to the caller) are flagged [stale].",
  requiredScopes: deriveRequiredScopes([LIST_GROUP_REQUESTS_SCOPES, APPROVE_GROUP_SCOPES]),
};

function handler(config: ServerConfig): ToolCallback<typeof inputSchema> {
  return async (_args, { signal }) => {
    try {
      const items = await listGroupApprovalRequests(config.graphClient, signal);
      const stale = await classifyStaleApproverRequests(
        items,
        {
          requestId: (r) => r.id,
          hasLiveStage: async (r, sig) => {
            if (!r.approvalId) return false;
            return hasLiveGroupApprovalStageForMe(config.graphClient, r.approvalId, sig);
          },
        },
        signal,
      );
      return {
        content: [{ type: "text", text: formatRequestsText(items, "approver", stale) }],
      };
    } catch (error) {
      return formatError(def.name, error);
    }
  };
}

export const pimGroupApprovalListTool: Tool<typeof inputSchema> = {
  def,
  inputSchema,
  annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  handler,
};
