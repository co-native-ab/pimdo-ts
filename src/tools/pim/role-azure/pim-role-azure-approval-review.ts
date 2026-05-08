// MCP tool: pim_role_azure_approval_review — review pending PIM
// Azure-role approvals via the approver browser flow.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  approveRoleAzureAssignment,
  listRoleAzureApprovalRequests,
} from "../../../arm/pim-role-azure.js";
import type { RoleAzureAssignmentRequest } from "../../../arm/types.js";
import { UserCancelledError } from "../../../errors.js";
import type { ServerConfig } from "../../../index.js";
import { logger } from "../../../logger.js";
import { GraphScope } from "../../../scopes.js";
import type { Tool, ToolDef } from "../../../tool-registry.js";
import { formatError, retryHintForBrowserFlowError } from "../../shared.js";
import type { ApproverRowSpec } from "../../../browser/flows/approver.js";
import { runApproverFlow } from "../../../browser/flows/approver.js";
import { roleLabel, scopeLabel } from "./format.js";

const ItemSchema = z.object({
  approvalId: z.string().min(1).describe("The approval id from pim_role_azure_approval_list."),
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
  name: "pim_role_azure_approval_review",
  title: "Review PIM Azure-role approvals",
  description:
    "Open a browser form for the signed-in user (acting as approver) to " +
    "Approve, Deny, or Skip pending PIM Azure-role activation approvals. " +
    "Each Approve/Deny submits the decision via Azure Resource Manager `/batch`.",
  requiredScopes: [GraphScope.ArmUserImpersonation],
};

function pickApprovals(
  all: readonly RoleAzureAssignmentRequest[],
  items:
    | {
        approvalId: string;
        decision?: "Approve" | "Deny" | "Skip";
        justification?: string;
      }[]
    | undefined,
): {
  selected: {
    request: RoleAzureAssignmentRequest;
    decision?: "Approve" | "Deny" | "Skip";
    justification?: string;
  }[];
  missing: string[];
} {
  const byApprovalId = new Map<string, RoleAzureAssignmentRequest>();
  for (const r of all) {
    if (r.properties.approvalId) byApprovalId.set(r.properties.approvalId, r);
  }
  if (!items || items.length === 0) {
    return {
      selected: all.filter((r) => Boolean(r.properties.approvalId)).map((request) => ({ request })),
      missing: [],
    };
  }
  const selected: {
    request: RoleAzureAssignmentRequest;
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
      const requests = await listRoleAzureApprovalRequests(config.armClient, signal);
      const { selected, missing } = pickApprovals(requests, args.items);

      if (selected.length === 0) {
        const reason =
          missing.length > 0
            ? `None of the requested approval ids matched. Unknown ids: ${missing.join(", ")}.`
            : "No pending PIM Azure-role approvals assigned to you.";
        return { content: [{ type: "text", text: reason }] };
      }

      const rows: ApproverRowSpec[] = selected.map((s): ApproverRowSpec => {
        const expanded = s.request.properties.expandedProperties;
        return {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          id: s.request.properties.approvalId!,
          label: roleLabel(s.request.properties.roleDefinitionId, expanded),
          subtitle: scopeLabel(s.request.properties.scope, expanded),
          requestor: expanded?.principal?.displayName ?? s.request.properties.principalId,
          requestorJustification: s.request.properties.justification ?? "(no justification)",
          prefilledDecision: s.decision,
          prefilledJustification: s.justification,
        };
      });

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
        selected.map((s) => [s.request.properties.approvalId ?? "", s.request]),
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
          await approveRoleAzureAssignment(
            config.armClient,
            row.id,
            row.decision,
            row.justification,
            signal,
          );
          const label = roleLabel(
            request.properties.roleDefinitionId,
            request.properties.expandedProperties,
          );
          summaries.push(`- ${label}: ${row.decision}d [approval=${row.id}]`);
        } catch (err) {
          const label = roleLabel(
            request.properties.roleDefinitionId,
            request.properties.expandedProperties,
          );
          errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const head =
        summaries.length > 0
          ? `Recorded ${String(summaries.length)} PIM Azure-role approval decision(s):\n${summaries.join("\n")}`
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

export const pimRoleAzureApprovalReviewTool: Tool<typeof inputSchema> = {
  def,
  inputSchema,
  annotations: { readOnlyHint: false, openWorldHint: true, idempotentHint: false },
  handler,
};
