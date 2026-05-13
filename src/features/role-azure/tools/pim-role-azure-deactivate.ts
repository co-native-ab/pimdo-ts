// MCP tool: pim_role_azure_deactivate — deactivate one or more active
// PIM Azure-role assignments via the confirmer browser flow. Built from
// {@link buildDeactivateTool}.

import { listActiveRoleAzureAssignments, requestRoleAzureDeactivation } from "../client.js";
import type { RoleAzureActiveAssignment } from "../../../arm/types.js";
import { getMyObjectId } from "../../../graph/me.js";
import { deriveRequiredScopes } from "../../../scopes-runtime.js";
import { ROLE_AZURE_SCOPES } from "../client.js";
import { buildDeactivateTool } from "../../../tools/pim/factories/deactivate.js";
import { roleLabel, scopeFromAssignment, scopeLabel } from "../format.js";

export const pimRoleAzureDeactivateTool = buildDeactivateTool<RoleAzureActiveAssignment>({
  def: {
    name: "pim_role_azure_deactivate",
    title: "Deactivate active PIM Azure-role assignments",
    description:
      "Open a browser form for the signed-in user to confirm deactivation of " +
      "one or more currently-active PIM Azure-role assignments. Each confirmed " +
      "row submits a SelfDeactivate role-assignment-schedule request via Azure Resource Manager.",
    requiredScopes: deriveRequiredScopes([ROLE_AZURE_SCOPES]),
  },
  noun: "PIM Azure-role",
  activeListToolName: "pim_role_azure_active_list",
  listActive: (config, signal) => listActiveRoleAzureAssignments(config.armClient, signal),
  instanceId: (a) => a.id,
  toRow: (a, prefilledReason) => ({
    id: a.id,
    label: roleLabel(a.properties.roleDefinitionId, a.properties.expandedProperties),
    subtitle: a.properties.endDateTime
      ? `${scopeLabel(a.properties.scope, a.properties.expandedProperties)} — Active until ${a.properties.endDateTime}`
      : scopeLabel(a.properties.scope, a.properties.expandedProperties),
    prefilledReason,
  }),
  label: (a) => roleLabel(a.properties.roleDefinitionId, a.properties.expandedProperties),
  submit: (config, a, principalId, reason, signal) => {
    const scope = scopeFromAssignment(a);
    if (!scope) {
      throw new Error(`instance ${a.id} has no resolvable ARM scope`);
    }
    return requestRoleAzureDeactivation(
      config.armClient,
      scope,
      {
        principalId,
        roleDefinitionId: a.properties.roleDefinitionId,
        justification: reason,
      },
      signal,
    );
  },
  principalId: (config, signal) => getMyObjectId(config.graphClient, signal),
});
