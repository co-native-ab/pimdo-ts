// Factory for `pim_<surface>_request` tools.
//
// Common to all three request tools (group / role-entra / role-azure):
// list eligibilities, optionally filter by ids, render the requester
// browser flow with a per-row max-duration lookup, and submit a
// self-activate request per confirmed row. The per-surface plug-points
// are captured in {@link RequestAdapter}.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { RequesterRowSpec } from "../../../browser/flows/requester.js";
import { runRequesterFlow } from "../../../browser/flows/requester.js";
import { UserCancelledError } from "../../../errors.js";
import type { ServerConfig } from "../../../server-config.js";
import { logger } from "../../../logger.js";
import type { Tool, ToolDef } from "../../../tool-registry.js";
import { formatError, retryHintForBrowserFlowError } from "../../shared.js";

/** Per-surface plug-points for the request tool factory. */
export interface RequestAdapter<Eligibility> {
  readonly def: ToolDef;
  /** Friendly noun used in summary messages (e.g. `"PIM group"`). */
  readonly noun: string;
  /** Name of the companion `*_eligible_list` tool (referenced in the input schema doc). */
  readonly eligibleListToolName: string;
  /** Empty-state message used when the user has no eligibilities. */
  readonly emptyStateMessage: string;
  /** List eligible assignments for the signed-in user. */
  readonly listEligible: (
    config: ServerConfig,
    signal: AbortSignal,
  ) => Promise<readonly Eligibility[]>;
  readonly eligibilityId: (e: Eligibility) => string;
  /** Build a requester row, including the per-row max-duration lookup. */
  readonly toRow: (
    config: ServerConfig,
    e: Eligibility,
    prefill: { defaultDuration?: string; justification?: string },
    signal: AbortSignal,
  ) => Promise<RequesterRowSpec>;
  readonly label: (e: Eligibility) => string;
  readonly submit: (
    config: ServerConfig,
    e: Eligibility,
    principalId: string,
    row: { duration: string; justification: string },
    signal: AbortSignal,
  ) => Promise<{ id: string }>;
  readonly principalId: (config: ServerConfig, signal: AbortSignal) => Promise<string>;
}

function buildInputSchema(eligibleListToolName: string) {
  const ItemSchema = z.object({
    eligibilityId: z
      .string()
      .min(1)
      .describe(`The eligibility schedule id from ${eligibleListToolName}.`),
    justification: z
      .string()
      .optional()
      .describe("Optional pre-filled justification shown in the browser form."),
    duration: z
      .string()
      .optional()
      .describe("Optional ISO-8601 duration prefilled in the form (clamped to policy max)."),
  });
  return z.object({
    items: z
      .array(ItemSchema)
      .optional()
      .describe(
        "Optional preselected eligibilities. When omitted the user picks from " +
          "all eligibilities in the browser form.",
      ),
  }).shape;
}

export type RequestInputSchema = ReturnType<typeof buildInputSchema>;

/** Build a `pim_<surface>_request` MCP tool from a per-surface adapter. */
export function buildRequestTool<Eligibility>(
  adapter: RequestAdapter<Eligibility>,
): Tool<RequestInputSchema> {
  const inputSchema = buildInputSchema(adapter.eligibleListToolName);
  const handler = (config: ServerConfig): ToolCallback<RequestInputSchema> => {
    return async (args, { signal }) => {
      try {
        const eligibilities = await adapter.listEligible(config, signal);
        const { selected, missing } = pickEligibilities(
          eligibilities,
          args.items,
          adapter.eligibilityId,
        );

        if (selected.length === 0) {
          const reason =
            missing.length > 0
              ? `None of the requested eligibility ids matched. Unknown ids: ${missing.join(", ")}.`
              : adapter.emptyStateMessage;
          return { content: [{ type: "text", text: reason }] };
        }

        const principalId = await adapter.principalId(config, signal);

        // Look up max-duration per row in parallel.
        const rows: RequesterRowSpec[] = await Promise.all(
          selected.map((s) =>
            adapter.toRow(
              config,
              s.eligibility,
              { defaultDuration: s.duration, justification: s.justification },
              signal,
            ),
          ),
        );

        const handle = await runRequesterFlow({ rows }, signal);
        try {
          await config.openBrowser(handle.url);
        } catch (err) {
          logger.warn("failed to open browser; URL still printed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }

        const result = await handle.result;

        const eligibilityById = new Map(
          selected.map((s) => [adapter.eligibilityId(s.eligibility), s.eligibility]),
        );
        const summaries: string[] = [];
        const errors: string[] = [];
        const missingTail =
          missing.length > 0 ? `\n\nIgnored unknown eligibility ids: ${missing.join(", ")}.` : "";

        for (const row of result.rows) {
          const eligibility = eligibilityById.get(row.id);
          if (!eligibility) {
            errors.push(`unknown eligibility id ${row.id}`);
            continue;
          }
          const label = adapter.label(eligibility);
          try {
            const created = await adapter.submit(
              config,
              eligibility,
              principalId,
              { duration: row.duration, justification: row.justification },
              signal,
            );
            summaries.push(`- ${label}: requested for ${row.duration} [request=${created.id}]`);
          } catch (err) {
            errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        const head =
          summaries.length > 0
            ? `Submitted ${String(summaries.length)} ${adapter.noun} activation request(s):\n${summaries.join("\n")}`
            : "No requests were submitted.";
        const errTail = errors.length > 0 ? `\n\nErrors:\n- ${errors.join("\n- ")}` : "";
        return { content: [{ type: "text", text: `${head}${errTail}${missingTail}` }] };
      } catch (error) {
        if (error instanceof UserCancelledError) {
          return { content: [{ type: "text", text: "Request cancelled." }] };
        }
        return formatError(adapter.def.name, error, {
          prefix: "Request failed: ",
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

function pickEligibilities<Eligibility>(
  all: readonly Eligibility[],
  items: { eligibilityId: string; justification?: string; duration?: string }[] | undefined,
  getId: (e: Eligibility) => string,
): {
  selected: { eligibility: Eligibility; justification?: string; duration?: string }[];
  missing: string[];
} {
  if (!items || items.length === 0) {
    return { selected: all.map((eligibility) => ({ eligibility })), missing: [] };
  }
  const byId = new Map(all.map((e) => [getId(e), e]));
  const selected: { eligibility: Eligibility; justification?: string; duration?: string }[] = [];
  const missing: string[] = [];
  for (const item of items) {
    const eligibility = byId.get(item.eligibilityId);
    if (!eligibility) {
      missing.push(item.eligibilityId);
      continue;
    }
    selected.push({
      eligibility,
      justification: item.justification,
      duration: item.duration,
    });
  }
  return { selected, missing };
}
