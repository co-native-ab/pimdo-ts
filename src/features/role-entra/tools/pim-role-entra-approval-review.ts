// MCP tool: pim_role_entra_approval_review — review pending PIM
// Entra-role approvals via the approver browser flow. Built from
// {@link buildApprovalReviewTool}.

import {
  APPROVE_ROLE_ENTRA_SCOPES,
  LIST_ROLE_ENTRA_REQUESTS_SCOPES,
  approveRoleEntraAssignment,
  listRoleEntraApprovalRequests,
} from "../client.js";
import type { RoleEntraAssignmentRequest } from "../../../graph/types.js";
import { deriveRequiredScopes } from "../../../scopes-runtime.js";
import { buildApprovalReviewTool } from "../../../tools/pim/factories/approval-review.js";

function scopeLabel(directoryScopeId: string | undefined): string {
  if (!directoryScopeId || directoryScopeId === "/") return "Directory";
  return directoryScopeId;
}

export const pimRoleEntraApprovalReviewTool = buildApprovalReviewTool<RoleEntraAssignmentRequest>({
  def: {
    name: "pim_role_entra_approval_review",
    title: "Review PIM Entra-role approvals",
    description:
      "Open a browser form for the signed-in user (acting as approver) to " +
      "Approve, Deny or Skip pending PIM Entra-role activation approvals. " +
      "Each Approve/Deny PATCHes the live approval stage via the Microsoft Graph beta endpoint.",
    requiredScopes: deriveRequiredScopes([
      LIST_ROLE_ENTRA_REQUESTS_SCOPES,
      APPROVE_ROLE_ENTRA_SCOPES,
    ]),
  },
  noun: "PIM Entra-role",
  approvalListToolName: "pim_role_entra_approval_list",
  listApprovals: (config, signal) => listRoleEntraApprovalRequests(config.graphClient, signal),
  approvalId: (r) => r.approvalId,
  toRow: (r, approvalId, prefill) => ({
    id: approvalId,
    label: r.roleDefinition?.displayName ?? r.roleDefinitionId,
    subtitle: `${scopeLabel(r.directoryScopeId)} — ${
      r.roleDefinition?.description ?? r.roleDefinitionId
    }`,
    requestor: r.principal?.displayName ?? r.principalId,
    requestorJustification: r.justification ?? "(no justification)",
    prefilledDecision: prefill.decision,
    prefilledJustification: prefill.justification,
  }),
  label: (r) => r.roleDefinition?.displayName ?? r.roleDefinitionId,
  submit: (config, _r, approvalId, decision, justification, signal) =>
    approveRoleEntraAssignment(config.graphBetaClient, approvalId, decision, justification, signal),
});
