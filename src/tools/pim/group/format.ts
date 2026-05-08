// Plain-text formatters for the pim_group_* read tools.

import type {
  GroupActiveAssignment,
  GroupAssignmentRequest,
  GroupEligibleAssignment,
} from "../../../graph/types.js";

function groupLabel(groupId: string, group: { displayName?: string } | undefined): string {
  return group?.displayName ? `${group.displayName} (${groupId})` : groupId;
}

export function formatEligibleAssignmentsText(items: readonly GroupEligibleAssignment[]): string {
  if (items.length === 0) {
    return "No eligible PIM group assignments.";
  }
  const lines = items.map((it) => {
    const expiry = it.scheduleInfo?.expiration?.endDateTime;
    const tail = expiry ? ` — eligible until ${expiry}` : "";
    return `- ${groupLabel(it.groupId, it.group)} [eligibility=${it.id}]${tail}`;
  });
  return [`Eligible PIM group assignments (${String(items.length)}):`, ...lines].join("\n");
}

export function formatActiveAssignmentsText(items: readonly GroupActiveAssignment[]): string {
  if (items.length === 0) {
    return "No active PIM group assignments.";
  }
  const lines = items.map((it) => {
    const tail = it.endDateTime ? ` — active until ${it.endDateTime}` : "";
    return `- ${groupLabel(it.groupId, it.group)} [instance=${it.id}]${tail}`;
  });
  return [`Active PIM group assignments (${String(items.length)}):`, ...lines].join("\n");
}

export function formatRequestsText(
  items: readonly GroupAssignmentRequest[],
  perspective: "mine" | "approver",
): string {
  if (items.length === 0) {
    return perspective === "mine"
      ? "No pending PIM group requests submitted by you."
      : "No pending PIM group approvals assigned to you.";
  }
  const heading =
    perspective === "mine"
      ? `Pending PIM group requests submitted by you (${String(items.length)}):`
      : `Pending PIM group approvals assigned to you (${String(items.length)}):`;
  const lines = items.map((it) => {
    const j = it.justification ? ` — "${it.justification}"` : "";
    const approval = it.approvalId ? ` [approval=${it.approvalId}]` : "";
    return `- ${groupLabel(it.groupId, it.group)} [request=${it.id}] action=${it.action ?? "?"}${approval}${j}`;
  });
  return [heading, ...lines].join("\n");
}
