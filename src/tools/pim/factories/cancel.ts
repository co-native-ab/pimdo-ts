// Factory for `pim_<surface>_request_cancel` tools.
//
// All three cancel tools (group / role-entra / role-azure) follow the
// identical pattern: list the caller's PendingApproval requests,
// optionally filter by a caller-supplied list of request ids, render
// the confirmer browser flow in no-reason mode (the underlying cancel
// APIs accept no body), and POST the cancel sub-resource per
// confirmed row. Only the data types, the list/submit functions, and
// the wording differ — those are the per-surface plug-points captured
// by {@link CancelAdapter}.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ConfirmerRowSpec } from "../../../browser/flows/confirmer.js";
import { runConfirmerFlow } from "../../../browser/flows/confirmer.js";
import { UserCancelledError } from "../../../errors.js";
import type { ServerConfig } from "../../../server-config.js";
import { logger } from "../../../logger.js";
import type { Tool, ToolDef } from "../../../tool-registry.js";
import { formatError, retryHintForBrowserFlowError } from "../../shared.js";

/** Per-surface plug-points for the cancel tool factory. */
export interface CancelAdapter<Request> {
  /** Tool descriptor (name, title, description, requiredScopes). */
  readonly def: ToolDef;
  /** Friendly noun used in summary messages (e.g. `"PIM group"`). */
  readonly noun: string;
  /** Name of the companion `*_request_list` tool (referenced in the input schema doc). */
  readonly requestListToolName: string;
  /** List the signed-in user's PendingApproval schedule requests. */
  readonly listPending: (config: ServerConfig, signal: AbortSignal) => Promise<readonly Request[]>;
  /** Extract the request id used in the input schema. */
  readonly requestId: (r: Request) => string;
  /** Render a pending request as a confirmer row. */
  readonly toRow: (r: Request) => ConfirmerRowSpec;
  /** Human-readable label used in summaries / error reporting. */
  readonly label: (r: Request) => string;
  /** POST the cancel sub-resource for `r`. */
  readonly submit: (config: ServerConfig, r: Request, signal: AbortSignal) => Promise<void>;
}

function buildInputSchema(requestListToolName: string) {
  const ItemSchema = z.object({
    requestId: z
      .string()
      .min(1)
      .describe(`The pending request id from ${requestListToolName}.`),
  });
  return z.object({
    items: z
      .array(ItemSchema)
      .optional()
      .describe(
        "Optional preselected pending requests. When omitted the user picks " +
          "from all pending requests in the browser form.",
      ),
  }).shape;
}

export type CancelInputSchema = ReturnType<typeof buildInputSchema>;

/**
 * Build a `pim_<surface>_request_cancel` MCP tool from a per-surface
 * adapter. The returned tool annotations are always
 * `{ readOnlyHint: false, destructiveHint: false, idempotentHint: false }`
 * — cancelling a pending request never grants access, so it is not
 * destructive in the MCP sense, but it is also not idempotent (calling
 * cancel twice will surface a server error on the second attempt).
 */
export function buildCancelTool<Request>(
  adapter: CancelAdapter<Request>,
): Tool<CancelInputSchema> {
  const inputSchema = buildInputSchema(adapter.requestListToolName);
  const handler = (config: ServerConfig): ToolCallback<CancelInputSchema> => {
    return async (args, { signal }) => {
      try {
        const pending = await adapter.listPending(config, signal);
        const { selected, missing } = pickRequests(pending, args.items, adapter.requestId);

        if (selected.length === 0) {
          const reason =
            missing.length > 0
              ? `None of the requested request ids matched. Unknown ids: ${missing.join(", ")}.`
              : `No pending ${adapter.noun} requests to cancel.`;
          return { content: [{ type: "text", text: reason }] };
        }

        const rows: ConfirmerRowSpec[] = selected.map((r) => adapter.toRow(r));

        const handle = await runConfirmerFlow(
          {
            heading: `Cancel ${adapter.noun} requests`,
            subtitle: "Confirm which pending requests to cancel.",
            submitLabel: "Cancel",
            showReason: false,
            rows,
          },
          signal,
        );
        try {
          await config.openBrowser(handle.url);
        } catch (err) {
          logger.warn("failed to open browser; URL still printed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }

        const result = await handle.result;

        const requestById = new Map(selected.map((r) => [adapter.requestId(r), r]));
        const summaries: string[] = [];
        const errors: string[] = [];
        const missingTail =
          missing.length > 0 ? `\n\nIgnored unknown request ids: ${missing.join(", ")}.` : "";

        for (const row of result.rows) {
          const request = requestById.get(row.id);
          if (!request) {
            errors.push(`unknown request id ${row.id}`);
            continue;
          }
          const label = adapter.label(request);
          try {
            await adapter.submit(config, request, signal);
            summaries.push(`- ${label}: cancellation submitted [request=${row.id}]`);
          } catch (err) {
            errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        const head =
          summaries.length > 0
            ? `Submitted ${String(summaries.length)} ${adapter.noun} cancellation(s):\n${summaries.join("\n")}`
            : "No cancellations were submitted.";
        const errTail = errors.length > 0 ? `\n\nErrors:\n- ${errors.join("\n- ")}` : "";
        return { content: [{ type: "text", text: `${head}${errTail}${missingTail}` }] };
      } catch (error) {
        if (error instanceof UserCancelledError) {
          return { content: [{ type: "text", text: "Cancellation cancelled." }] };
        }
        return formatError(adapter.def.name, error, {
          prefix: "Cancellation failed: ",
          suffix: retryHintForBrowserFlowError(error),
        });
      }
    };
  };

  return {
    def: adapter.def,
    inputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    handler,
  };
}

function pickRequests<Request>(
  all: readonly Request[],
  items: { requestId: string }[] | undefined,
  getId: (r: Request) => string,
): {
  selected: Request[];
  missing: string[];
} {
  if (!items || items.length === 0) {
    return { selected: [...all], missing: [] };
  }
  const byId = new Map(all.map((r) => [getId(r), r]));
  const selected: Request[] = [];
  const missing: string[] = [];
  for (const item of items) {
    const request = byId.get(item.requestId);
    if (!request) {
      missing.push(item.requestId);
      continue;
    }
    selected.push(request);
  }
  return { selected, missing };
}
