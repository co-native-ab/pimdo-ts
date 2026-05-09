// MCP tool: pim_group_approval_review — review pending PIM group
// approvals via the approver browser flow. Built from
// {@link buildApprovalReviewTool}.

import { approveGroupAssignment, listGroupApprovalRequests } from "../../../graph/pim-group.js";
import type { GroupAssignmentRequest } from "../../../graph/types.js";
import { GraphScope } from "../../../scopes.js";
import { buildApprovalReviewTool } from "../factories/approval-review.js";

export const pimGroupApprovalReviewTool = buildApprovalReviewTool<GroupAssignmentRequest>({
  def: {
    name: "pim_group_approval_review",
    title: "Review PIM group approvals",
    description:
      "Open a browser form for the signed-in user (acting as approver) to " +
      "Approve, Deny, or Skip pending PIM group activation approvals. Each " +
      "Approve/Deny PATCHes the live approval stage via Microsoft Graph.",
    requiredScopes: [GraphScope.PrivilegedAccessReadWriteAzureADGroup],
  },
  noun: "PIM group",
  approvalListToolName: "pim_group_approval_list",
  listApprovals: (config, signal) => listGroupApprovalRequests(config.graphClient, signal),
  approvalId: (r) => r.approvalId,
  toRow: (r, prefill) => ({
    // The approval id is what the Graph PATCH uses; the request id is metadata.
    // The factory's pre-filter guarantees `approvalId` is set.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    id: r.approvalId!,
    label: r.group?.displayName ?? r.groupId,
    subtitle: r.group?.description ?? r.groupId,
    requestor: r.principal?.displayName ?? r.principalId,
    requestorJustification: r.justification ?? "(no justification)",
    prefilledDecision: prefill.decision,
    prefilledJustification: prefill.justification,
  }),
  label: (r) => r.group?.displayName ?? r.groupId,
  submit: (config, _r, approvalId, decision, justification, signal) =>
    approveGroupAssignment(config.graphClient, approvalId, decision, justification, signal),
});
