// MCP tool: pim_role_azure_request_cancel — cancel one or more pending
// PIM Azure-role activation requests via the confirmer browser flow.
// Built from {@link buildCancelTool}.

import { cancelRoleAzureAssignmentRequest, listMyPendingRoleAzureRequests } from "../client.js";
import type { RoleAzureAssignmentRequest } from "../../../arm/types.js";
import { deriveRequiredScopes } from "../../../scopes-runtime.js";
import { ROLE_AZURE_SCOPES } from "../client.js";
import { buildCancelTool } from "../../../tools/pim/factories/cancel.js";
import { roleLabel, scopeFromAssignment, scopeLabel } from "../format.js";

export const pimRoleAzureRequestCancelTool = buildCancelTool<RoleAzureAssignmentRequest>({
  def: {
    name: "pim_role_azure_request_cancel",
    title: "Cancel pending PIM Azure-role requests",
    description:
      "Open a browser form for the signed-in user to confirm cancellation of " +
      "one or more PIM Azure-role activation/deactivation requests that are " +
      "still waiting for approval. Each confirmed row POSTs the cancel " +
      "sub-resource via Azure Resource Manager.",
    requiredScopes: deriveRequiredScopes([ROLE_AZURE_SCOPES]),
  },
  noun: "PIM Azure-role",
  requestListToolName: "pim_role_azure_request_list",
  listPending: (config, signal) => listMyPendingRoleAzureRequests(config.armClient, signal),
  requestId: (r) => r.id,
  toRow: (r) => ({
    id: r.id,
    label: roleLabel(r.properties.roleDefinitionId, r.properties.expandedProperties),
    subtitle: `${r.properties.requestType ?? "?"} · ${scopeLabel(
      r.properties.scope,
      r.properties.expandedProperties,
    )}`,
  }),
  label: (r) => roleLabel(r.properties.roleDefinitionId, r.properties.expandedProperties),
  submit: (config, r, signal) => {
    const scope = scopeFromAssignment(r);
    if (!scope) {
      throw new Error(`request ${r.id} has no resolvable ARM scope`);
    }
    if (!r.name) {
      throw new Error(`request ${r.id} has no resolvable name`);
    }
    return cancelRoleAzureAssignmentRequest(config.armClient, scope, r.name, signal);
  },
});
