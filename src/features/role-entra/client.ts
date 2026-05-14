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
// The approval surface uses the Microsoft Graph `beta` endpoint, since
// that is currently the only channel exposing the assignment-approvals
// surface. Callers pass a separate `betaClient` so we don't conflate
// beta/v1.0 base URLs.

import {
  ApprovalStageReviewResult,
  ApprovalStageStatus,
  CurrentUserFilter,
  GraphScheduleAction,
  type SubmittedApprovalDecision,
} from "../../enums.js";
import { GraphClient, HttpMethod, parseResponse } from "../../graph/client.js";
import { OAuthScope } from "../../scopes.js";
import { assertScopes } from "../../scopes-runtime.js";
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
} from "../../graph/types.js";

const EligibleListSchema = collectionSchema(RoleEntraEligibleAssignmentSchema);
const ActiveListSchema = collectionSchema(RoleEntraActiveAssignmentSchema);
const RequestListSchema = collectionSchema(RoleEntraAssignmentRequestSchema);

/** Decision sent to a PIM approval step. */
export type ReviewResult = SubmittedApprovalDecision;

const ROLE_BASE = "/roleManagement/directory";

/** Tenant-wide directory scope identifier. */
export const DIRECTORY_SCOPE_ROOT = "/";

// ---------------------------------------------------------------------------
// List operations
// ---------------------------------------------------------------------------

/**
 * Microsoft Graph permissions for
 * `GET /roleManagement/directory/roleEligibilitySchedules/filterByCurrentUser(on='principal')`.
 *
 * pimdo never creates or deletes Entra-role eligibilities, so we
 * request the `Read` variant only. The `ReadWrite` variant would also
 * satisfy this call but is intentionally not requested — see ADR-0017.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/rbacapplication-list-roleeligibilityschedules?view=graph-rest-1.0&tabs=http#permissions
 */
export const LIST_ELIGIBLE_ROLE_ENTRA_SCOPES: OAuthScope[][] = [
  [OAuthScope.RoleEligibilityScheduleReadDirectory],
];

/** GET eligibility schedules where the signed-in user is the principal. */
export async function listEligibleRoleEntraAssignments(
  client: GraphClient,
  signal: AbortSignal,
): Promise<RoleEntraEligibleAssignment[]> {
  await assertScopes(client.credential, LIST_ELIGIBLE_ROLE_ENTRA_SCOPES, signal);
  const path = `${ROLE_BASE}/roleEligibilitySchedules/filterByCurrentUser(on='principal')?$expand=roleDefinition,principal`;
  const res = await client.request(HttpMethod.GET, path, signal);
  const parsed = await parseResponse(res, EligibleListSchema, "GET", path);
  return parsed.value;
}

/**
 * Microsoft Graph permissions for
 * `GET /roleManagement/directory/roleAssignmentScheduleInstances/filterByCurrentUser(on='principal')`.
 *
 * The same `ReadWrite` scope used by self-activate / self-deactivate
 * implicitly covers list operations. The standalone `Read` variant
 * would also satisfy this call but is intentionally not requested —
 * see ADR-0017.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/rbacapplication-list-roleassignmentscheduleinstances?view=graph-rest-1.0&tabs=http#permissions
 */
export const LIST_ACTIVE_ROLE_ENTRA_SCOPES: OAuthScope[][] = [
  [OAuthScope.RoleAssignmentScheduleReadWriteDirectory],
];

/** GET role-assignment-schedule instances where the signed-in user is the principal. */
export async function listActiveRoleEntraAssignments(
  client: GraphClient,
  signal: AbortSignal,
): Promise<RoleEntraActiveAssignment[]> {
  await assertScopes(client.credential, LIST_ACTIVE_ROLE_ENTRA_SCOPES, signal);
  const path = `${ROLE_BASE}/roleAssignmentScheduleInstances/filterByCurrentUser(on='principal')?$expand=roleDefinition,principal`;
  const res = await client.request(HttpMethod.GET, path, signal);
  const parsed = await parseResponse(res, ActiveListSchema, "GET", path);
  return parsed.value;
}

/**
 * Microsoft Graph permissions for
 * `GET /roleManagement/directory/roleAssignmentScheduleRequests/filterByCurrentUser(on='principal'|'approver')`.
 *
 * Reuses the `ReadWrite` scope already required by the activation /
 * deactivation / approval flows on the same surface so consumers don't
 * have to consent to the standalone `Read` variant as well — see
 * ADR-0017.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/rbacapplication-list-roleassignmentschedulerequests?view=graph-rest-1.0&tabs=http#permissions
 */
export const LIST_ROLE_ENTRA_REQUESTS_SCOPES: OAuthScope[][] = [
  [OAuthScope.RoleAssignmentScheduleReadWriteDirectory],
];

/** GET pending-approval role-assignment-schedule requests submitted by me. */
export async function listMyRoleEntraRequests(
  client: GraphClient,
  signal: AbortSignal,
): Promise<RoleEntraAssignmentRequest[]> {
  await assertScopes(client.credential, LIST_ROLE_ENTRA_REQUESTS_SCOPES, signal);
  return listRequests(client, CurrentUserFilter.Principal, signal);
}

/** GET pending-approval role-assignment-schedule requests where I am an approver. */
export async function listRoleEntraApprovalRequests(
  client: GraphClient,
  signal: AbortSignal,
): Promise<RoleEntraAssignmentRequest[]> {
  await assertScopes(client.credential, LIST_ROLE_ENTRA_REQUESTS_SCOPES, signal);
  return listRequests(client, CurrentUserFilter.Approver, signal);
}

async function listRequests(
  client: GraphClient,
  on: CurrentUserFilter,
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

/**
 * Microsoft Graph permissions for
 * `POST /roleManagement/directory/roleAssignmentScheduleRequests`
 * with `action=selfActivate` or `action=selfDeactivate`.
 *
 * Documented least-priv is `RoleAssignmentSchedule.ReadWrite.Directory`.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/rbacapplication-post-roleassignmentschedulerequests?view=graph-rest-1.0&tabs=http#permissions
 */
export const ROLE_ENTRA_SCHEDULE_REQUEST_SCOPES: OAuthScope[][] = [
  [OAuthScope.RoleAssignmentScheduleReadWriteDirectory],
];

/** POST a `selfActivate` role-assignment-schedule request. */
export async function requestRoleEntraActivation(
  client: GraphClient,
  params: RequestRoleEntraActivationParams,
  signal: AbortSignal,
): Promise<RoleEntraAssignmentRequest> {
  await assertScopes(client.credential, ROLE_ENTRA_SCHEDULE_REQUEST_SCOPES, signal);
  const body = {
    action: GraphScheduleAction.SelfActivate,
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
  await assertScopes(client.credential, ROLE_ENTRA_SCHEDULE_REQUEST_SCOPES, signal);
  const body = {
    action: GraphScheduleAction.SelfDeactivate,
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
 * Microsoft Graph permissions for the BETA approval surface — `GET`
 * the approval and `PATCH` a step. Both are exposed under
 * `/roleManagement/directory/roleAssignmentApprovals/...` only on the
 * BETA endpoint.
 *
 * **Docs vs. observed.** The Microsoft Graph documentation only lists
 * `RoleAssignmentSchedule.{Read,ReadWrite}.Directory` as required for
 * the GET (`approval-get`) and PATCH (`approvalstep-update`) on the
 * BETA approvals surface. In practice (verified against a live tenant
 * via the `pim_role_entra_approval_review` tool) the PATCH returns
 * HTTP 403 unless the caller also holds
 * `PrivilegedAccess.ReadWrite.AzureAD`. Issuing the GET and the PATCH
 * always happens within the same review flow, so the combined runtime
 * requirement is modeled as a single AND-alternative below.
 *
 * **Do NOT collapse this back to a single docs-aligned scope** without
 * re-testing live in a real tenant — removing the
 * `PrivilegedAccess.ReadWrite.AzureAD` requirement will silently
 * re-break the approval flow in tenants that mirror the observed
 * behavior.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/approval-get?view=graph-rest-beta&tabs=http#permissions
 * @see https://learn.microsoft.com/en-us/graph/api/approvalstep-update?view=graph-rest-beta&tabs=http#permissions
 */
export const APPROVE_ROLE_ENTRA_SCOPES: OAuthScope[][] = [
  [
    OAuthScope.RoleAssignmentScheduleReadWriteDirectory,
    OAuthScope.PrivilegedAccessReadWriteAzureAD,
  ],
];

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
  await assertScopes(betaClient.credential, APPROVE_ROLE_ENTRA_SCOPES, signal);
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
    (s) =>
      s.status === ApprovalStageStatus.InProgress &&
      s.reviewResult === ApprovalStageReviewResult.NotReviewed &&
      s.assignedToMe === true,
  );
  const [step, ...rest] = candidates;
  if (!step) {
    throw new Error(`approval ${approvalId} has no live step assigned to the current user`);
  }
  if (rest.length > 0) {
    throw new Error(
      `approval ${approvalId} has ${String(candidates.length)} live steps assigned to the current user; expected 1`,
    );
  }
  return step;
}
