// Factory for `pim_<surface>_approval_review` tools.
//
// All three approval-review tools (group / role-entra / role-azure) follow
// the same shape: list pending approvals assigned to the signed-in user,
// optionally filter by approvalId, render the approver browser flow, and
// PATCH each approval with the chosen Approve/Deny/Skip decision. Per-
// surface plug-points are captured in {@link ApprovalReviewAdapter}.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ApproverRowSpec } from "../../../browser/flows/approver.js";
import { runApproverFlow } from "../../../browser/flows/approver.js";
import { UserCancelledError } from "../../../errors.js";
import type { ServerConfig } from "../../../server-config.js";
import { logger } from "../../../logger.js";
import type { Tool, ToolDef } from "../../../tool-registry.js";
import { formatError, retryHintForBrowserFlowError } from "../../shared.js";

/** Per-surface plug-points for the approval-review tool factory. */
export interface ApprovalReviewAdapter<Request> {
  readonly def: ToolDef;
  /** Friendly noun used in summary messages (e.g. `"PIM group"`). */
  readonly noun: string;
  /** Name of the companion `*_approval_list` tool. */
  readonly approvalListToolName: string;
  /** List pending approvals assigned to the signed-in user. */
  readonly listApprovals: (
    config: ServerConfig,
    signal: AbortSignal,
  ) => Promise<readonly Request[]>;
  /** Extract the approval id from a request, or `undefined`/`null` if missing. */
  readonly approvalId: (r: Request) => string | null | undefined;
  /** Render an approval as an approver row. `approvalId` is the resolved id. */
  readonly toRow: (
    r: Request,
    approvalId: string,
    prefill: { decision?: "Approve" | "Deny" | "Skip"; justification?: string },
  ) => ApproverRowSpec;
  readonly label: (r: Request) => string;
  /** Submit the chosen decision for the given approval id. */
  readonly submit: (
    config: ServerConfig,
    request: Request,
    approvalId: string,
    decision: "Approve" | "Deny",
    justification: string,
    signal: AbortSignal,
  ) => Promise<void>;
}

function buildInputSchema(approvalListToolName: string) {
  const ItemSchema = z.object({
    approvalId: z.string().min(1).describe(`The approval id from ${approvalListToolName}.`),
    decision: z
      .enum(["Approve", "Deny", "Skip"])
      .optional()
      .describe("Optional pre-selected decision."),
    justification: z.string().optional().describe("Optional pre-filled reviewer justification."),
  });
  return z.object({
    items: z
      .array(ItemSchema)
      .optional()
      .describe(
        "Optional preselected approvals. When omitted all pending approvals " +
          "assigned to the current user are shown in the browser form.",
      ),
  }).shape;
}

export type ApprovalReviewInputSchema = ReturnType<typeof buildInputSchema>;

/** Build a `pim_<surface>_approval_review` MCP tool from a per-surface adapter. */
export function buildApprovalReviewTool<Request>(
  adapter: ApprovalReviewAdapter<Request>,
): Tool<ApprovalReviewInputSchema> {
  const inputSchema = buildInputSchema(adapter.approvalListToolName);
  const handler = (config: ServerConfig): ToolCallback<ApprovalReviewInputSchema> => {
    return async (args, { signal }) => {
      try {
        const requests = await adapter.listApprovals(config, signal);
        const { selected, missing } = pickApprovals(requests, args.items, adapter.approvalId);

        if (selected.length === 0) {
          const reason =
            missing.length > 0
              ? `None of the requested approval ids matched. Unknown ids: ${missing.join(", ")}.`
              : `No pending ${adapter.noun} approvals assigned to you.`;
          return { content: [{ type: "text", text: reason }] };
        }

        const rows: ApproverRowSpec[] = selected.map((s) =>
          adapter.toRow(s.request, s.approvalId, {
            decision: s.decision,
            justification: s.justification,
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

        const requestByApprovalId = new Map(selected.map((s) => [s.approvalId, s.request]));
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
          const label = adapter.label(request);
          try {
            await adapter.submit(config, request, row.id, row.decision, row.justification, signal);
            summaries.push(`- ${label}: ${row.decision}d [approval=${row.id}]`);
          } catch (err) {
            errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        const head =
          summaries.length > 0
            ? `Recorded ${String(summaries.length)} ${adapter.noun} approval decision(s):\n${summaries.join("\n")}`
            : "No approval decisions were recorded.";
        const errTail = errors.length > 0 ? `\n\nErrors:\n- ${errors.join("\n- ")}` : "";
        return { content: [{ type: "text", text: `${head}${errTail}${missingTail}` }] };
      } catch (error) {
        if (error instanceof UserCancelledError) {
          return { content: [{ type: "text", text: "Approval review cancelled." }] };
        }
        return formatError(adapter.def.name, error, {
          prefix: "Approval review failed: ",
          suffix: retryHintForBrowserFlowError(error),
        });
      }
    };
  };

  return {
    def: adapter.def,
    inputSchema,
    annotations: { readOnlyHint: false, openWorldHint: true, idempotentHint: false },
    handler,
  };
}

function pickApprovals<Request>(
  all: readonly Request[],
  items:
    | {
        approvalId: string;
        decision?: "Approve" | "Deny" | "Skip";
        justification?: string;
      }[]
    | undefined,
  getApprovalId: (r: Request) => string | null | undefined,
): {
  selected: {
    request: Request;
    approvalId: string;
    decision?: "Approve" | "Deny" | "Skip";
    justification?: string;
  }[];
  missing: string[];
} {
  const byApprovalId = new Map<string, Request>();
  for (const r of all) {
    const id = getApprovalId(r);
    if (id) byApprovalId.set(id, r);
  }
  if (!items || items.length === 0) {
    const selected: {
      request: Request;
      approvalId: string;
      decision?: "Approve" | "Deny" | "Skip";
      justification?: string;
    }[] = [];
    for (const request of all) {
      const id = getApprovalId(request);
      if (id) selected.push({ request, approvalId: id });
    }
    return { selected, missing: [] };
  }
  const selected: {
    request: Request;
    approvalId: string;
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
    selected.push({
      request,
      approvalId: item.approvalId,
      decision: item.decision,
      justification: item.justification,
    });
  }
  return { selected, missing };
}
