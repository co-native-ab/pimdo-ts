// PIM role-management policy lookups.
//
// `getGroupMaxDuration` reads the policy assignment that governs the
// `member` access on a given group, walks its expanded `rules` array,
// and returns the `maximumDuration` from the
// `Expiration_EndUser_Assignment` rule. This is the upper bound the
// requester flow uses to clamp the user's chosen activation duration.
//
// Mirrors `pimctl/internal/graph/pim_group.go::PIMGroupGetMaximumExpirationByGroupID`.

import { z } from "zod";

import { GraphClient, HttpMethod, parseResponse } from "./client.js";
import { collectionSchema, UnifiedRoleManagementPolicyExpirationRuleSchema } from "./types.js";

const RuleSchema = z
  .object({
    id: z.string(),
    isExpirationRequired: z.boolean().optional(),
    maximumDuration: z.string().optional(),
  })
  .loose();

const PolicyAssignmentSchema = z
  .object({
    id: z.string().optional(),
    policy: z
      .object({
        id: z.string().optional(),
        rules: z.array(RuleSchema).optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

const PolicyAssignmentsResponseSchema = collectionSchema(PolicyAssignmentSchema);

/** Identifier used by Microsoft Graph for the end-user assignment expiration rule. */
const END_USER_ASSIGNMENT_RULE_ID = "Expiration_EndUser_Assignment";

/**
 * Look up the `maximumDuration` (ISO-8601) the policy attached to
 * `groupId/member` allows for end-user activation requests.
 *
 * Throws if the lookup returns no policy assignment, the policy has no
 * expanded `rules`, or the `Expiration_EndUser_Assignment` rule has no
 * `maximumDuration`.
 */
export async function getGroupMaxDuration(
  client: GraphClient,
  groupId: string,
  signal: AbortSignal,
): Promise<string> {
  const filter = encodeURIComponent(
    `scopeId eq '${groupId}' and scopeType eq 'Group' and roleDefinitionId eq 'member'`,
  );
  const expand = encodeURIComponent("policy($expand=rules)");
  const path = `/policies/roleManagementPolicyAssignments?$filter=${filter}&$expand=${expand}`;

  const response = await client.request(HttpMethod.GET, path, signal);
  const parsed = await parseResponse(response, PolicyAssignmentsResponseSchema, "GET", path);

  const assignments = parsed.value;
  if (assignments.length === 0) {
    throw new Error(`no role-management policy assignment found for group ${groupId}`);
  }
  // Graph returns one assignment per (scope, roleDefinition) pair.
  const policy = assignments[0]?.policy;
  if (!policy?.rules || policy.rules.length === 0) {
    throw new Error(`policy for group ${groupId} has no rules`);
  }
  const rule = policy.rules.find((r) => r.id === END_USER_ASSIGNMENT_RULE_ID);
  if (!rule) {
    throw new Error(`policy for group ${groupId} has no ${END_USER_ASSIGNMENT_RULE_ID} rule`);
  }
  // Re-parse with the canonical rule schema so callers get a typed object
  // even though we currently only return the duration string.
  const ruleParsed = UnifiedRoleManagementPolicyExpirationRuleSchema.parse(rule);
  if (!ruleParsed.maximumDuration) {
    throw new Error(
      `policy for group ${groupId} has no maximumDuration on the ${END_USER_ASSIGNMENT_RULE_ID} rule`,
    );
  }
  return ruleParsed.maximumDuration;
}
