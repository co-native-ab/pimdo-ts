// MCP tool: pim_group_approval_review — review pending PIM group
// approvals via the approver browser flow.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { UserCancelledError } from "../../../errors.js";
import { approveGroupAssignment, listGroupApprovalRequests } from "../../../graph/pim-group.js";
import type { GroupAssignmentRequest } from "../../../graph/types.js";
import type { ServerConfig } from "../../../index.js";
import { logger } from "../../../logger.js";
import { GraphScope } from "../../../scopes.js";
import type { Tool, ToolDef } from "../../../tool-registry.js";
import { formatError, retryHintForBrowserFlowError } from "../../shared.js";
import type { ApproverRowSpec } from "../../../browser/flows/approver.js";
import { runApproverFlow } from "../../../browser/flows/approver.js";

const ItemSchema = z.object({
  approvalId: z.string().min(1).describe("The approval id from pim_group_approval_list."),
  decision: z
    .enum(["Approve", "Deny", "Skip"])
    .optional()
    .describe("Optional pre-selected decision."),
  justification: z.string().optional().describe("Optional pre-filled reviewer justification."),
});

const inputSchema = z.object({
  items: z
    .array(ItemSchema)
    .optional()
    .describe(
      "Optional preselected approvals. When omitted all pending approvals " +
        "assigned to the current user are shown in the browser form.",
    ),
}).shape;

const def: ToolDef = {
  name: "pim_group_approval_review",
  title: "Review PIM group approvals",
  description:
    "Open a browser form for the signed-in user (acting as approver) to " +
    "Approve, Deny, or Skip pending PIM group activation approvals. Each " +
    "Approve/Deny PATCHes the live approval stage via Microsoft Graph.",
  requiredScopes: [GraphScope.PrivilegedAccessReadWriteAzureADGroup],
};

function pickApprovals(
  all: readonly GroupAssignmentRequest[],
  items:
    | {
        approvalId: string;
        decision?: "Approve" | "Deny" | "Skip";
        justification?: string;
      }[]
    | undefined,
): {
  selected: {
    request: GroupAssignmentRequest;
    decision?: "Approve" | "Deny" | "Skip";
    justification?: string;
  }[];
  missing: string[];
} {
  // Group approvals are keyed by request, but the user-visible id is the
  // approvalId (one per request). Build a lookup by approvalId.
  const byApprovalId = new Map<string, GroupAssignmentRequest>();
  for (const r of all) {
    if (r.approvalId) byApprovalId.set(r.approvalId, r);
  }
  if (!items || items.length === 0) {
    return {
      selected: all
        .filter((r): r is GroupAssignmentRequest & { approvalId: string } => Boolean(r.approvalId))
        .map((request) => ({ request })),
      missing: [],
    };
  }
  const selected: {
    request: GroupAssignmentRequest;
    decision?: "Approve" | "Deny" | "Skip";
    justification?: string;
  }[] = [];
  const missing: string[] = [];
  for (const item of items) {
    const request = byApprovalId.get(item.approvalId);
    if (!request) {
      missing.push(item.approvalId);
      continue;
    }
    selected.push({ request, decision: item.decision, justification: item.justification });
  }
  return { selected, missing };
}

function handler(config: ServerConfig): ToolCallback<typeof inputSchema> {
  return async (args, { signal }) => {
    try {
      const requests = await listGroupApprovalRequests(config.graphClient, signal);
      const { selected, missing } = pickApprovals(requests, args.items);

      if (selected.length === 0) {
        const reason =
          missing.length > 0
            ? `None of the requested approval ids matched. Unknown ids: ${missing.join(", ")}.`
            : "No pending PIM group approvals assigned to you.";
        return { content: [{ type: "text", text: reason }] };
      }

      const rows: ApproverRowSpec[] = selected.map(
        (s): ApproverRowSpec => ({
          // The approval id is what the Graph PATCH uses; the request id
          // is metadata. Filter step above guarantees `approvalId` is set.
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          id: s.request.approvalId!,
          label: s.request.group?.displayName ?? s.request.groupId,
          subtitle: s.request.group?.description ?? s.request.groupId,
          requestor: s.request.principal?.displayName ?? s.request.principalId,
          requestorJustification: s.request.justification ?? "(no justification)",
          prefilledDecision: s.decision,
          prefilledJustification: s.justification,
        }),
      );

      const handle = await runApproverFlow({ rows }, signal);
      try {
        await config.openBrowser(handle.url);
      } catch (err) {
        logger.warn("failed to open browser; URL still printed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const result = await handle.result;

      const requestByApprovalId = new Map(
        selected.map((s) => [s.request.approvalId ?? "", s.request]),
      );
      const summaries: string[] = [];
      const errors: string[] = [];
      const missingTail =
        missing.length > 0 ? `\n\nIgnored unknown approval ids: ${missing.join(", ")}.` : "";

      for (const row of result.rows) {
        const request = requestByApprovalId.get(row.id);
        if (!request) {
          errors.push(`unknown approval id ${row.id}`);
          continue;
        }
        try {
          await approveGroupAssignment(
            config.graphClient,
            row.id,
            row.decision,
            row.justification,
            signal,
          );
          const label = request.group?.displayName ?? request.groupId;
          summaries.push(`- ${label}: ${row.decision}d [approval=${row.id}]`);
        } catch (err) {
          const label = request.group?.displayName ?? request.groupId;
          errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const head =
        summaries.length > 0
          ? `Recorded ${String(summaries.length)} PIM group approval decision(s):\n${summaries.join("\n")}`
          : "No approval decisions were recorded.";
      const errTail = errors.length > 0 ? `\n\nErrors:\n- ${errors.join("\n- ")}` : "";
      return { content: [{ type: "text", text: `${head}${errTail}${missingTail}` }] };
    } catch (error) {
      if (error instanceof UserCancelledError) {
        return { content: [{ type: "text", text: "Approval review cancelled." }] };
      }
      return formatError(def.name, error, {
        prefix: "Approval review failed: ",
        suffix: retryHintForBrowserFlowError(error),
      });
    }
  };
}

export const pimGroupApprovalReviewTool: Tool<typeof inputSchema> = {
  def,
  inputSchema,
  annotations: { readOnlyHint: false, openWorldHint: true, idempotentHint: false },
  handler,
};
