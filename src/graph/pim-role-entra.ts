// PIM operations for Entra (directory) Roles.
//
// Wraps the seven Microsoft Graph endpoints needed by the
// `pim_role_entra_*` MCP tools. Mirrors `pim-group.ts` but targets the
// directory-role surface under `/roleManagement/directory/*`:
//
//   - list eligible assignments         (filterByCurrentUser='principal')
//   - list active   assignments         (filterByCurrentUser='principal')
//   - list my pending requests          (filterByCurrentUser='principal',
//                                        status='PendingApproval')
//   - list approvals assigned to me     (filterByCurrentUser='approver',
//                                        status='PendingApproval')
//   - request activation                (POST roleAssignmentScheduleRequests,
//                                        action=selfActivate)
//   - request deactivation              (POST roleAssignmentScheduleRequests,
//                                        action=selfDeactivate)
//   - approve / deny an assignment      (GET approval (BETA), find live step,
//                                        PATCH the step (BETA))
//
// The approval surface uses the Microsoft Graph `beta` endpoint for
// parity with `pimctl/internal/graph/pim_entra_role.go`. Callers pass a
// separate `betaClient` so we don't conflate beta/v1.0 base URLs.

import { GraphClient, HttpMethod, parseResponse } from "./client.js";
import {
  AssignmentApprovalStage,
  collectionSchema,
  RoleAssignmentApproval,
  RoleAssignmentApprovalSchema,
  RoleEntraActiveAssignment,
  RoleEntraActiveAssignmentSchema,
  RoleEntraAssignmentRequest,
  RoleEntraAssignmentRequestSchema,
  RoleEntraEligibleAssignment,
  RoleEntraEligibleAssignmentSchema,
  ScheduleInfo,
} from "./types.js";

const EligibleListSchema = collectionSchema(RoleEntraEligibleAssignmentSchema);
const ActiveListSchema = collectionSchema(RoleEntraActiveAssignmentSchema);
const RequestListSchema = collectionSchema(RoleEntraAssignmentRequestSchema);

/** Decision sent to a PIM approval step. */
export type ReviewResult = "Approve" | "Deny";

const ROLE_BASE = "/roleManagement/directory";

/** Tenant-wide directory scope identifier. */
export const DIRECTORY_SCOPE_ROOT = "/";

// ---------------------------------------------------------------------------
// List operations
// ---------------------------------------------------------------------------

/** GET eligibility schedules where the signed-in user is the principal. */
export async function listEligibleRoleEntraAssignments(
  client: GraphClient,
  signal: AbortSignal,
): Promise<RoleEntraEligibleAssignment[]> {
  const path = `${ROLE_BASE}/roleEligibilitySchedules/filterByCurrentUser(on='principal')?$expand=roleDefinition,principal`;
  const res = await client.request(HttpMethod.GET, path, signal);
  const parsed = await parseResponse(res, EligibleListSchema, "GET", path);
  return parsed.value;
}

/** GET role-assignment-schedule instances where the signed-in user is the principal. */
export async function listActiveRoleEntraAssignments(
  client: GraphClient,
  signal: AbortSignal,
): Promise<RoleEntraActiveAssignment[]> {
  const path = `${ROLE_BASE}/roleAssignmentScheduleInstances/filterByCurrentUser(on='principal')?$expand=roleDefinition,principal`;
  const res = await client.request(HttpMethod.GET, path, signal);
  const parsed = await parseResponse(res, ActiveListSchema, "GET", path);
  return parsed.value;
}

/** GET pending-approval role-assignment-schedule requests submitted by me. */
export async function listMyRoleEntraRequests(
  client: GraphClient,
  signal: AbortSignal,
): Promise<RoleEntraAssignmentRequest[]> {
  return listRequests(client, "principal", signal);
}

/** GET pending-approval role-assignment-schedule requests where I am an approver. */
export async function listRoleEntraApprovalRequests(
  client: GraphClient,
  signal: AbortSignal,
): Promise<RoleEntraAssignmentRequest[]> {
  return listRequests(client, "approver", signal);
}

async function listRequests(
  client: GraphClient,
  on: "principal" | "approver",
  signal: AbortSignal,
): Promise<RoleEntraAssignmentRequest[]> {
  const filter = encodeURIComponent("status eq 'PendingApproval'");
  const path = `${ROLE_BASE}/roleAssignmentScheduleRequests/filterByCurrentUser(on='${on}')?$expand=roleDefinition,principal&$filter=${filter}`;
  const res = await client.request(HttpMethod.GET, path, signal);
  const parsed = await parseResponse(res, RequestListSchema, "GET", path);
  return parsed.value;
}

// ---------------------------------------------------------------------------
// Activate / deactivate
// ---------------------------------------------------------------------------

export interface RequestRoleEntraActivationParams {
  /** Object ID of the signed-in user. */
  principalId: string;
  roleDefinitionId: string;
  /** Tenant-wide is `'/'`; AU-scoped is `/administrativeUnits/<id>` etc. */
  directoryScopeId: string;
  justification: string;
  scheduleInfo: ScheduleInfo;
}

/** POST a `selfActivate` role-assignment-schedule request. */
export async function requestRoleEntraActivation(
  client: GraphClient,
  params: RequestRoleEntraActivationParams,
  signal: AbortSignal,
): Promise<RoleEntraAssignmentRequest> {
  const body = {
    action: "selfActivate",
    principalId: params.principalId,
    roleDefinitionId: params.roleDefinitionId,
    directoryScopeId: params.directoryScopeId,
    justification: params.justification,
    scheduleInfo: params.scheduleInfo,
  };
  return postScheduleRequest(client, body, signal);
}

export interface RequestRoleEntraDeactivationParams {
  principalId: string;
  roleDefinitionId: string;
  directoryScopeId: string;
  justification: string;
}

/** POST a `selfDeactivate` role-assignment-schedule request. */
export async function requestRoleEntraDeactivation(
  client: GraphClient,
  params: RequestRoleEntraDeactivationParams,
  signal: AbortSignal,
): Promise<RoleEntraAssignmentRequest> {
  const body = {
    action: "selfDeactivate",
    principalId: params.principalId,
    roleDefinitionId: params.roleDefinitionId,
    directoryScopeId: params.directoryScopeId,
    justification: params.justification,
  };
  return postScheduleRequest(client, body, signal);
}

async function postScheduleRequest(
  client: GraphClient,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<RoleEntraAssignmentRequest> {
  const path = `${ROLE_BASE}/roleAssignmentScheduleRequests`;
  const res = await client.request(HttpMethod.POST, path, body, signal);
  return parseResponse(res, RoleEntraAssignmentRequestSchema, "POST", path);
}

// ---------------------------------------------------------------------------
// Approve / deny (BETA)
// ---------------------------------------------------------------------------

/**
 * Approve or deny a PIM Entra-role assignment. Looks up the approval on
 * the BETA endpoint (which exposes its decision points as `steps`),
 * picks the single live step assigned to the caller, and PATCHes that
 * step with the decision + justification.
 *
 * @param betaClient  GraphClient pointed at `https://graph.microsoft.com/beta`.
 */
export async function approveRoleEntraAssignment(
  betaClient: GraphClient,
  approvalId: string,
  decision: ReviewResult,
  justification: string,
  signal: AbortSignal,
): Promise<void> {
  const approval = await getRoleEntraApproval(betaClient, approvalId, signal);
  const step = pickLiveStep(approval, approvalId);
  const path = `${ROLE_BASE}/roleAssignmentApprovals/${encodeURIComponent(
    approvalId,
  )}/steps/${encodeURIComponent(step.id)}`;
  const body = { reviewResult: decision, justification };
  // Graph returns 204 No Content on success; we don't parse the body.
  await betaClient.request(HttpMethod.PATCH, path, body, signal);
}

async function getRoleEntraApproval(
  betaClient: GraphClient,
  approvalId: string,
  signal: AbortSignal,
): Promise<RoleAssignmentApproval> {
  const path = `${ROLE_BASE}/roleAssignmentApprovals/${encodeURIComponent(approvalId)}?$expand=steps`;
  const res = await betaClient.request(HttpMethod.GET, path, signal);
  return parseResponse(res, RoleAssignmentApprovalSchema, "GET", path);
}

function pickLiveStep(
  approval: RoleAssignmentApproval,
  approvalId: string,
): AssignmentApprovalStage {
  const candidates = approval.steps.filter(
    (s) => s.status === "InProgress" && s.reviewResult === "NotReviewed" && s.assignedToMe === true,
  );
  if (candidates.length === 0) {
    throw new Error(`approval ${approvalId} has no live step assigned to the current user`);
  }
  if (candidates.length > 1) {
    throw new Error(
      `approval ${approvalId} has ${String(candidates.length)} live steps assigned to the current user; expected 1`,
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return candidates[0]!;
}
