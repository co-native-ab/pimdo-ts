// Plain-text formatters for the pim_role_azure_* read tools.

import type {
  RoleAzureActiveAssignment,
  RoleAzureAssignmentRequest,
  RoleAzureEligibleAssignment,
} from "../../../arm/types.js";

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
  if (items.length === 0) {
    return "No eligible PIM Azure-role assignments.";
  }
  const lines = items.map((it) => {
    const expiry = it.properties.endDateTime;
    const tail = expiry ? ` — eligible until ${expiry}` : "";
    return `- ${roleLabel(it.properties.roleDefinitionId, it.properties.expandedProperties)} @ ${scopeLabel(
      it.properties.scope,
      it.properties.expandedProperties,
    )} [eligibility=${it.id}]${tail}`;
  });
  return [`Eligible PIM Azure-role assignments (${String(items.length)}):`, ...lines].join("\n");
}

export function formatActiveAssignmentsText(items: readonly RoleAzureActiveAssignment[]): string {
  if (items.length === 0) {
    return "No active PIM Azure-role assignments.";
  }
  const lines = items.map((it) => {
    const tail = it.properties.endDateTime ? ` — active until ${it.properties.endDateTime}` : "";
    return `- ${roleLabel(it.properties.roleDefinitionId, it.properties.expandedProperties)} @ ${scopeLabel(
      it.properties.scope,
      it.properties.expandedProperties,
    )} [instance=${it.id}]${tail}`;
  });
  return [`Active PIM Azure-role assignments (${String(items.length)}):`, ...lines].join("\n");
}

export function formatRequestsText(
  items: readonly RoleAzureAssignmentRequest[],
  perspective: "mine" | "approver",
): string {
  if (items.length === 0) {
    return perspective === "mine"
      ? "No PIM Azure-role requests submitted by you."
      : "No PIM Azure-role approvals assigned to you.";
  }
  const heading =
    perspective === "mine"
      ? `PIM Azure-role requests submitted by you (${String(items.length)}):`
      : `PIM Azure-role approvals assigned to you (${String(items.length)}):`;
  const lines = items.map((it) => {
    const j = it.properties.justification ? ` — "${it.properties.justification}"` : "";
    const approval = it.properties.approvalId ? ` [approval=${it.properties.approvalId}]` : "";
    const status = ` status=${it.properties.status ?? "?"}`;
    return `- ${roleLabel(it.properties.roleDefinitionId, it.properties.expandedProperties)} @ ${scopeLabel(
      it.properties.scope,
      it.properties.expandedProperties,
    )} [request=${it.id}] action=${it.properties.requestType ?? "?"}${status}${approval}${j}`;
  });
  return [heading, ...lines].join("\n");
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
