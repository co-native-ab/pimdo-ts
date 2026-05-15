// MCP tool: pim_role_entra_request_cancel — cancel one or more pending
// PIM Entra-role activation requests via the confirmer browser flow.
// Built from {@link buildCancelTool}.

import {
  cancelRoleEntraAssignmentRequest,
  LIST_ROLE_ENTRA_REQUESTS_SCOPES,
  ROLE_ENTRA_SCHEDULE_REQUEST_SCOPES,
  listMyRoleEntraRequests,
} from "../client.js";
import type { RoleEntraAssignmentRequest } from "../../../graph/types.js";
import { deriveRequiredScopes } from "../../../scopes-runtime.js";
import { buildCancelTool } from "../../../tools/pim/factories/cancel.js";

function shortId(value: string): string {
  const idx = value.lastIndexOf("/");
  return idx === -1 ? value : value.slice(idx + 1);
}

function requestLabel(r: RoleEntraAssignmentRequest): string {
  const display = r.roleDefinition?.displayName;
  const short = shortId(r.roleDefinitionId);
  return display ? `${display} (${short})` : short;
}

export const pimRoleEntraRequestCancelTool = buildCancelTool<RoleEntraAssignmentRequest>({
  def: {
    name: "pim_role_entra_request_cancel",
    title: "Cancel pending PIM Entra-role requests",
    description:
      "Open a browser form for the signed-in user to confirm cancellation of " +
      "one or more PIM Entra-role activation/deactivation requests that are " +
      "still waiting for approval. Each confirmed row POSTs the cancel " +
      "sub-resource via Microsoft Graph.",
    requiredScopes: deriveRequiredScopes([
      LIST_ROLE_ENTRA_REQUESTS_SCOPES,
      ROLE_ENTRA_SCHEDULE_REQUEST_SCOPES,
    ]),
  },
  noun: "PIM Entra-role",
  requestListToolName: "pim_role_entra_request_list",
  listPending: (config, signal) => listMyRoleEntraRequests(config.graphClient, signal),
  requestId: (r) => r.id,
  toRow: (r) => ({
    id: r.id,
    label: requestLabel(r),
    subtitle: `${r.action ?? "?"} · ${r.status ?? "?"}`,
  }),
  label: requestLabel,
  submit: (config, r, signal) => cancelRoleEntraAssignmentRequest(config.graphClient, r.id, signal),
});
