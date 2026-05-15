// PIM operations for Entra Groups.
//
// Wraps the seven Microsoft Graph endpoints needed by the
// `pim_group_*` MCP tools:
//
//   - list eligible assignments (filterByCurrentUser=principal)
//   - list active  assignments (filterByCurrentUser=principal)
//   - list my pending requests (filterByCurrentUser=principal,
//     status='PendingApproval')
//   - list approval requests assigned to me (filterByCurrentUser=approver,
//     status='PendingApproval')
//   - request activation   (POST assignmentScheduleRequests, action=selfActivate)
//   - request deactivation (POST assignmentScheduleRequests, action=selfDeactivate)
//   - approve / deny an assignment (GET approval, find the live stage,
//     PATCH the stage with reviewResult + justification)
//
// Returns the parsed Graph payloads — formatting/UI is the tool layer's job.

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
  AssignmentApproval,
  AssignmentApprovalSchema,
  AssignmentApprovalStage,
  collectionSchema,
  GroupActiveAssignment,
  GroupActiveAssignmentSchema,
  GroupAssignmentRequest,
  GroupAssignmentRequestSchema,
  GroupEligibleAssignment,
  GroupEligibleAssignmentSchema,
  ScheduleInfo,
} from "../../graph/types.js";

const EligibleListSchema = collectionSchema(GroupEligibleAssignmentSchema);
const ActiveListSchema = collectionSchema(GroupActiveAssignmentSchema);
const RequestListSchema = collectionSchema(GroupAssignmentRequestSchema);

/** Decision sent to a PIM approval stage. */
export type ReviewResult = SubmittedApprovalDecision;

const PRIVILEGED_BASE = "/identityGovernance/privilegedAccess/group";

// ---------------------------------------------------------------------------
// List operations
// ---------------------------------------------------------------------------

/**
 * Microsoft Graph permissions for
 * `GET /identityGovernance/privilegedAccess/group/eligibilitySchedules/filterByCurrentUser(on='principal')`.
 *
 * pimdo never creates or deletes group eligibilities, so we request the
 * `Read` variant only. The `ReadWrite` variant would also satisfy this
 * call but is intentionally not requested — see ADR-0017 for the
 * single-variant policy.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/privilegedaccessgroupeligibilityschedule-filterbycurrentuser?view=graph-rest-1.0&tabs=http#permissions
 */
export const LIST_ELIGIBLE_GROUP_SCOPES: OAuthScope[][] = [
  [OAuthScope.PrivilegedEligibilityScheduleReadAzureADGroup],
];

/** GET eligibility schedules where the signed-in user is the principal. */
export async function listEligibleGroupAssignments(
  client: GraphClient,
  signal: AbortSignal,
): Promise<GroupEligibleAssignment[]> {
  await assertScopes(client.credential, LIST_ELIGIBLE_GROUP_SCOPES, signal);
  const path = `${PRIVILEGED_BASE}/eligibilitySchedules/filterByCurrentUser(on='principal')?$expand=group,principal`;
  const res = await client.request(HttpMethod.GET, path, signal);
  const parsed = await parseResponse(res, EligibleListSchema, "GET", path);
  return parsed.value;
}

/**
 * Microsoft Graph permissions for
 * `GET /identityGovernance/privilegedAccess/group/assignmentScheduleInstances/filterByCurrentUser(on='principal')`.
 *
 * The same `ReadWrite` scope used by self-activate / self-deactivate
 * implicitly covers list operations. The standalone `Read` variant
 * would also satisfy this call but is intentionally not requested —
 * see ADR-0017.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/privilegedaccessgroupassignmentscheduleinstance-filterbycurrentuser?view=graph-rest-1.0&tabs=http#permissions
 */
export const LIST_ACTIVE_GROUP_SCOPES: OAuthScope[][] = [
  [OAuthScope.PrivilegedAssignmentScheduleReadWriteAzureADGroup],
];

/** GET assignment-schedule instances where the signed-in user is the principal. */
export async function listActiveGroupAssignments(
  client: GraphClient,
  signal: AbortSignal,
): Promise<GroupActiveAssignment[]> {
  await assertScopes(client.credential, LIST_ACTIVE_GROUP_SCOPES, signal);
  const path = `${PRIVILEGED_BASE}/assignmentScheduleInstances/filterByCurrentUser(on='principal')?$expand=group,principal`;
  const res = await client.request(HttpMethod.GET, path, signal);
  const parsed = await parseResponse(res, ActiveListSchema, "GET", path);
  return parsed.value;
}

/**
 * Microsoft Graph permissions for
 * `GET /identityGovernance/privilegedAccess/group/assignmentScheduleRequests/filterByCurrentUser(on='principal'|'approver')`.
 *
 * Listing assignment-schedule requests is read-only on the wire, but
 * pimdo already requests `PrivilegedAssignmentSchedule.ReadWrite.AzureADGroup`
 * for the activate/deactivate/approve flows on the same surface, so we
 * reuse it here rather than asking the consumer to consent to a second
 * scope. The standalone `Read` variant would also satisfy this call —
 * see ADR-0017 for the single-variant policy.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/privilegedaccessgroupassignmentschedulerequest-filterbycurrentuser?view=graph-rest-1.0&tabs=http#permissions
 */
export const LIST_GROUP_REQUESTS_SCOPES: OAuthScope[][] = [
  [OAuthScope.PrivilegedAssignmentScheduleReadWriteAzureADGroup],
];

/**
 * Microsoft Graph permissions for
 * `POST /identityGovernance/privilegedAccess/group/assignmentScheduleRequests`
 * with `action=selfActivate` or `action=selfDeactivate`.
 *
 * Documented least-priv is `PrivilegedAssignmentSchedule.ReadWrite.AzureADGroup`.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/privilegedaccessgroup-post-assignmentschedulerequests?view=graph-rest-1.0&tabs=http#permissions
 */
export const WRITE_GROUP_SCHEDULE_SCOPES: OAuthScope[][] = [
  [OAuthScope.PrivilegedAssignmentScheduleReadWriteAzureADGroup],
];

/**
 * Microsoft Graph permissions for the group-approval flow:
 * `GET   /identityGovernance/privilegedAccess/group/assignmentApprovals/{id}` and
 * `PATCH /identityGovernance/privilegedAccess/group/assignmentApprovals/{id}/stages/{stageId}`.
 *
 * Documented least-priv is the Read variant for the GET and the
 * ReadWrite variant for the PATCH; our implementation always issues the
 * GET followed by the PATCH within the same flow, so we model the
 * combined least-priv as a single ReadWrite alternative.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/approval-get?view=graph-rest-1.0&tabs=http#permissions
 * @see https://learn.microsoft.com/en-us/graph/api/approvalstage-update?view=graph-rest-1.0&tabs=http#permissions
 */
export const APPROVE_GROUP_SCOPES: OAuthScope[][] = [
  [OAuthScope.PrivilegedAssignmentScheduleReadWriteAzureADGroup],
];

/** GET pending-approval assignment-schedule requests submitted by me. */
export async function listMyGroupRequests(
  client: GraphClient,
  signal: AbortSignal,
): Promise<GroupAssignmentRequest[]> {
  await assertScopes(client.credential, LIST_GROUP_REQUESTS_SCOPES, signal);
  return listRequests(client, CurrentUserFilter.Principal, signal);
}

/** GET pending-approval assignment-schedule requests where I am an approver. */
export async function listGroupApprovalRequests(
  client: GraphClient,
  signal: AbortSignal,
): Promise<GroupAssignmentRequest[]> {
  await assertScopes(client.credential, LIST_GROUP_REQUESTS_SCOPES, signal);
  return listRequests(client, CurrentUserFilter.Approver, signal);
}

async function listRequests(
  client: GraphClient,
  on: CurrentUserFilter,
  signal: AbortSignal,
): Promise<GroupAssignmentRequest[]> {
  const filter = encodeURIComponent("status eq 'PendingApproval'");
  const path = `${PRIVILEGED_BASE}/assignmentScheduleRequests/filterByCurrentUser(on='${on}')?$expand=group,principal&$filter=${filter}`;
  const res = await client.request(HttpMethod.GET, path, signal);
  const parsed = await parseResponse(res, RequestListSchema, "GET", path);
  return parsed.value;
}

// ---------------------------------------------------------------------------
// Activate / deactivate
// ---------------------------------------------------------------------------

export interface RequestGroupActivationParams {
  /** Object ID of the signed-in user. */
  principalId: string;
  groupId: string;
  justification: string;
  /** When omitted the caller is responsible for clamping against policy. */
  scheduleInfo: ScheduleInfo;
}

/** POST a `selfActivate` assignment-schedule request for the `member` access. */
export async function requestGroupActivation(
  client: GraphClient,
  params: RequestGroupActivationParams,
  signal: AbortSignal,
): Promise<GroupAssignmentRequest> {
  await assertScopes(client.credential, WRITE_GROUP_SCHEDULE_SCOPES, signal);
  const body = {
    accessId: "member",
    action: GraphScheduleAction.SelfActivate,
    principalId: params.principalId,
    groupId: params.groupId,
    justification: params.justification,
    scheduleInfo: params.scheduleInfo,
  };
  return postScheduleRequest(client, body, signal);
}

export interface RequestGroupDeactivationParams {
  principalId: string;
  groupId: string;
  justification: string;
}

/** POST a `selfDeactivate` assignment-schedule request for the `member` access. */
export async function requestGroupDeactivation(
  client: GraphClient,
  params: RequestGroupDeactivationParams,
  signal: AbortSignal,
): Promise<GroupAssignmentRequest> {
  await assertScopes(client.credential, WRITE_GROUP_SCHEDULE_SCOPES, signal);
  const body = {
    accessId: "member",
    action: GraphScheduleAction.SelfDeactivate,
    principalId: params.principalId,
    groupId: params.groupId,
    justification: params.justification,
  };
  return postScheduleRequest(client, body, signal);
}

async function postScheduleRequest(
  client: GraphClient,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<GroupAssignmentRequest> {
  const path = `${PRIVILEGED_BASE}/assignmentScheduleRequests`;
  const res = await client.request(HttpMethod.POST, path, body, signal);
  return parseResponse(res, GroupAssignmentRequestSchema, "POST", path);
}

/**
 * Cancel a pending PIM group assignment-schedule request that the
 * signed-in user submitted. Reuses the existing
 * {@link WRITE_GROUP_SCHEDULE_SCOPES} scope (same one used by self
 * activate / deactivate). Returns nothing — Graph responds with 204
 * No Content and the request body is empty.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/privilegedaccessgroupassignmentschedulerequest-cancel?view=graph-rest-1.0&tabs=http#permissions
 */
export async function cancelGroupAssignmentRequest(
  client: GraphClient,
  requestId: string,
  signal: AbortSignal,
): Promise<void> {
  await assertScopes(client.credential, WRITE_GROUP_SCHEDULE_SCOPES, signal);
  const path = `${PRIVILEGED_BASE}/assignmentScheduleRequests/${encodeURIComponent(requestId)}/cancel`;
  await client.request(HttpMethod.POST, path, {}, signal);
}

// ---------------------------------------------------------------------------
// Approve / deny
// ---------------------------------------------------------------------------

/**
 * Approve or deny a PIM group assignment. Looks up the approval (which
 * must have a single live stage in `NotReviewed/InProgress` and assigned
 * to the caller) and PATCHes that stage with the decision + justification.
 */
export async function approveGroupAssignment(
  client: GraphClient,
  approvalId: string,
  decision: ReviewResult,
  justification: string,
  signal: AbortSignal,
): Promise<void> {
  await assertScopes(client.credential, APPROVE_GROUP_SCOPES, signal);
  const approval = await getGroupAssignmentApproval(client, approvalId, signal);
  const stage = pickLiveStage(approval, approvalId);
  const path = `${PRIVILEGED_BASE}/assignmentApprovals/${encodeURIComponent(
    approvalId,
  )}/stages/${encodeURIComponent(stage.id)}`;
  const body = { reviewResult: decision, justification };
  // Graph returns 204 No Content on success; we don't parse the body.
  await client.request(HttpMethod.PATCH, path, body, signal);
}

async function getGroupAssignmentApproval(
  client: GraphClient,
  approvalId: string,
  signal: AbortSignal,
): Promise<AssignmentApproval> {
  const path = `${PRIVILEGED_BASE}/assignmentApprovals/${encodeURIComponent(approvalId)}?$expand=stages`;
  const res = await client.request(HttpMethod.GET, path, signal);
  return parseResponse(res, AssignmentApprovalSchema, "GET", path);
}

function pickLiveStage(approval: AssignmentApproval, approvalId: string): AssignmentApprovalStage {
  const candidates = approval.stages.filter(
    (s) =>
      s.status === ApprovalStageStatus.InProgress &&
      s.reviewResult === ApprovalStageReviewResult.NotReviewed &&
      s.assignedToMe === true,
  );
  const [stage, ...rest] = candidates;
  if (!stage) {
    throw new Error(`approval ${approvalId} has no live stage assigned to the current user`);
  }
  if (rest.length > 0) {
    throw new Error(
      `approval ${approvalId} has ${String(candidates.length)} live stages assigned to the current user; expected 1`,
    );
  }
  return stage;
}
