// Plain-text formatters for the pim_role_azure_* read tools.

import type {
  RoleAzureActiveAssignment,
  RoleAzureAssignmentRequest,
  RoleAzureEligibleAssignment,
} from "../../arm/types.js";
import {
  approvalTag,
  expiryTail,
  formatBulletList,
  justificationTail,
} from "../../tools/pim/format-shared.js";

function shortId(resourceId: string): string {
  const idx = resourceId.lastIndexOf("/");
  return idx === -1 ? resourceId : resourceId.slice(idx + 1);
}

export function roleLabel(
  roleDefinitionId: string,
  expanded?: { roleDefinition?: { displayName?: string } },
): string {
  const display = expanded?.roleDefinition?.displayName;
  const short = shortId(roleDefinitionId);
  return display ? `${display} (${short})` : short;
}

export function scopeLabel(
  propertiesScope: string | undefined,
  expanded?: { scope?: { displayName?: string; id?: string } },
): string {
  const display = expanded?.scope?.displayName;
  const id = expanded?.scope?.id ?? propertiesScope;
  if (display && id) return `${display} ${id}`;
  return id ?? "Tenant";
}

export function formatEligibleAssignmentsText(
  items: readonly RoleAzureEligibleAssignment[],
): string {
  return formatBulletList(
    items,
    `Eligible PIM Azure-role assignments (${String(items.length)}):`,
    "No eligible PIM Azure-role assignments.",
    (it) =>
      `- ${roleLabel(it.properties.roleDefinitionId, it.properties.expandedProperties)} @ ${scopeLabel(
        it.properties.scope,
        it.properties.expandedProperties,
      )} [eligibility=${it.id}]${expiryTail("eligible", it.properties.endDateTime)}`,
  );
}

export function formatActiveAssignmentsText(items: readonly RoleAzureActiveAssignment[]): string {
  return formatBulletList(
    items,
    `Active PIM Azure-role assignments (${String(items.length)}):`,
    "No active PIM Azure-role assignments.",
    (it) =>
      `- ${roleLabel(it.properties.roleDefinitionId, it.properties.expandedProperties)} @ ${scopeLabel(
        it.properties.scope,
        it.properties.expandedProperties,
      )} [instance=${it.id}]${expiryTail("active", it.properties.endDateTime)}`,
  );
}

export function formatRequestsText(
  items: readonly RoleAzureAssignmentRequest[],
  perspective: "mine" | "approver",
): string {
  const empty =
    perspective === "mine"
      ? "No PIM Azure-role requests submitted by you."
      : "No PIM Azure-role approvals assigned to you.";
  const heading =
    perspective === "mine"
      ? `PIM Azure-role requests submitted by you (${String(items.length)}):`
      : `PIM Azure-role approvals assigned to you (${String(items.length)}):`;
  return formatBulletList(
    items,
    heading,
    empty,
    (it) =>
      `- ${roleLabel(it.properties.roleDefinitionId, it.properties.expandedProperties)} @ ${scopeLabel(
        it.properties.scope,
        it.properties.expandedProperties,
      )} [request=${it.id}] action=${it.properties.requestType ?? "?"} status=${it.properties.status ?? "?"}${approvalTag(it.properties.approvalId)}${justificationTail(it.properties.justification)}`,
  );
}

/**
 * Resolve the ARM scope a request/assignment applies to.
 * Prefers `expandedProperties.scope.id`, falls back to `properties.scope`.
 */
export function scopeFromAssignment(item: {
  properties: {
    scope?: string;
    expandedProperties?: { scope?: { id?: string } };
  };
}): string | undefined {
  return item.properties.expandedProperties?.scope?.id ?? item.properties.scope;
}
