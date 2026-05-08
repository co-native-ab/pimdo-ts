// ARM PIM role-management policy lookups.
//
// `getAzureRoleMaxDuration` reads the policy assignment that governs the
// given (`scope`, `roleDefinitionId`), walks its `effectiveRules` array,
// and returns the `maximumDuration` from the
// `Expiration_EndUser_Assignment` rule. This is the upper bound the
// requester flow uses to clamp the user's chosen activation duration.
//
// Mirrors `pimctl/internal/azurerm/azurerm.go::PIMAzureRoleGetMaximumExpirationByRoleID`.

import { ArmClient, HttpMethod, parseResponse } from "./client.js";
import {
  armListSchema,
  RoleManagementPolicyAssignmentSchema,
  type RoleManagementPolicyAssignment,
} from "./types.js";

const PolicyListSchema = armListSchema(RoleManagementPolicyAssignmentSchema);

/** Identifier used by ARM for the end-user assignment expiration rule. */
const END_USER_ASSIGNMENT_RULE_ID = "Expiration_EndUser_Assignment";

/** API version for the ARM role-management resources. */
export const ARM_API_VERSION = "2020-10-01";

/**
 * Look up the `maximumDuration` (ISO-8601) the policy attached to
 * `(scope, roleDefinitionId)` allows for end-user activation requests.
 *
 * Throws if the lookup returns no policy assignment, the policy has no
 * `effectiveRules`, or the `Expiration_EndUser_Assignment` rule has no
 * `maximumDuration`.
 *
 * @param scope ARM scope (e.g. `/subscriptions/{id}` or
 *   `/subscriptions/{id}/resourceGroups/{rg}`). Must not include a leading
 *   provider segment — pimctl passes the raw scope unchanged.
 */
export async function getAzureRoleMaxDuration(
  client: ArmClient,
  scope: string,
  roleDefinitionId: string,
  signal: AbortSignal,
): Promise<string> {
  const filter = encodeURIComponent(`roleDefinitionId eq '${roleDefinitionId}'`);
  const path =
    `/${trimLeadingSlash(scope)}/providers/Microsoft.Authorization/roleManagementPolicyAssignments` +
    `?api-version=${ARM_API_VERSION}&$filter=${filter}`;
  const response = await client.request(HttpMethod.GET, path, signal);
  const parsed = await parseResponse(response, PolicyListSchema, "GET", path);

  const assignments = parsed.value;
  if (assignments.length === 0) {
    throw new Error(
      `no role-management policy assignment found for ${roleDefinitionId} at scope ${scope}`,
    );
  }
  const policy: RoleManagementPolicyAssignment | undefined = assignments[0];
  const rules = policy?.properties.effectiveRules;
  if (!rules || rules.length === 0) {
    throw new Error(`policy for role ${roleDefinitionId} at scope ${scope} has no effectiveRules`);
  }
  const rule = rules.find((r) => r.id === END_USER_ASSIGNMENT_RULE_ID);
  if (!rule) {
    throw new Error(
      `policy for role ${roleDefinitionId} at scope ${scope} has no ${END_USER_ASSIGNMENT_RULE_ID} rule`,
    );
  }
  if (!rule.maximumDuration) {
    throw new Error(
      `policy for role ${roleDefinitionId} at scope ${scope} has no maximumDuration on the ${END_USER_ASSIGNMENT_RULE_ID} rule`,
    );
  }
  return rule.maximumDuration;
}

function trimLeadingSlash(value: string): string {
  return value.startsWith("/") ? value.slice(1) : value;
}
