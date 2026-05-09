// MCP tool: pim_role_azure_request — request activation for one or
// more Azure resource roles via the requester browser flow. Built from
// {@link buildRequestTool}.

import {
  listEligibleRoleAzureAssignments,
  requestRoleAzureActivation,
} from "../../../arm/pim-role-azure.js";
import { getAzureRoleMaxDuration } from "../../../arm/policies.js";
import type { RoleAzureEligibleAssignment } from "../../../arm/types.js";
import { getMyObjectId } from "../../../graph/me.js";
import { GraphScope } from "../../../scopes.js";
import { buildRequestTool } from "../factories/request.js";
import { roleLabel, scopeFromAssignment, scopeLabel } from "./format.js";

export const pimRoleAzureRequestTool = buildRequestTool<RoleAzureEligibleAssignment>({
  def: {
    name: "pim_role_azure_request",
    title: "Request activation for PIM Azure roles",
    description:
      "Open a browser form for the signed-in user to confirm activation of " +
      "one or more PIM-eligible Azure resource roles. The user edits " +
      "justification and duration per row, then submits. Each confirmed " +
      "row creates a SelfActivate role-assignment-schedule request via Azure Resource Manager.",
    requiredScopes: [GraphScope.ArmUserImpersonation],
  },
  noun: "PIM Azure-role",
  eligibleListToolName: "pim_role_azure_eligible_list",
  emptyStateMessage: "No PIM Azure-role eligibilities are available for activation.",
  listEligible: (config, signal) => listEligibleRoleAzureAssignments(config.armClient, signal),
  eligibilityId: (e) => e.id,
  toRow: async (config, e, prefill, signal) => {
    const scope = scopeFromAssignment(e);
    if (!scope) {
      throw new Error(
        `eligibility ${e.id} has no resolvable ARM scope (missing properties.scope and expandedProperties.scope.id)`,
      );
    }
    const max = await getAzureRoleMaxDuration(
      config.armClient,
      scope,
      e.properties.roleDefinitionId,
      signal,
    );
    return {
      id: e.id,
      label: roleLabel(e.properties.roleDefinitionId, e.properties.expandedProperties),
      subtitle: scopeLabel(e.properties.scope, e.properties.expandedProperties),
      maxDuration: max,
      defaultDuration: prefill.defaultDuration,
      prefilledJustification: prefill.justification,
    };
  },
  label: (e) => roleLabel(e.properties.roleDefinitionId, e.properties.expandedProperties),
  submit: (config, e, principalId, row, signal) => {
    const scope = scopeFromAssignment(e);
    if (!scope) {
      throw new Error(`eligibility ${e.id} has no resolvable ARM scope`);
    }
    return requestRoleAzureActivation(
      config.armClient,
      scope,
      {
        principalId,
        roleDefinitionId: e.properties.roleDefinitionId,
        justification: row.justification,
        scheduleInfo: {
          startDateTime: new Date().toISOString(),
          expiration: { type: "AfterDuration", duration: row.duration },
        },
      },
      signal,
    );
  },
  principalId: (config, signal) => getMyObjectId(config.graphClient, signal),
});
