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

/** GET eligibility schedules where the signed-in user is the principal. */
export async function listEligibleGroupAssignments(
  client: GraphClient,
  signal: AbortSignal,
): Promise<GroupEligibleAssignment[]> {
  const path = `${PRIVILEGED_BASE}/eligibilitySchedules/filterByCurrentUser(on='principal')?$expand=group,principal`;
  const res = await client.request(HttpMethod.GET, path, signal);
  const parsed = await parseResponse(res, EligibleListSchema, "GET", path);
  return parsed.value;
}

/** GET assignment-schedule instances where the signed-in user is the principal. */
export async function listActiveGroupAssignments(
  client: GraphClient,
  signal: AbortSignal,
): Promise<GroupActiveAssignment[]> {
  const path = `${PRIVILEGED_BASE}/assignmentScheduleInstances/filterByCurrentUser(on='principal')?$expand=group,principal`;
  const res = await client.request(HttpMethod.GET, path, signal);
  const parsed = await parseResponse(res, ActiveListSchema, "GET", path);
  return parsed.value;
}

/** GET pending-approval assignment-schedule requests submitted by me. */
export async function listMyGroupRequests(
  client: GraphClient,
  signal: AbortSignal,
): Promise<GroupAssignmentRequest[]> {
  return listRequests(client, CurrentUserFilter.Principal, signal);
}

/** GET pending-approval assignment-schedule requests where I am an approver. */
export async function listGroupApprovalRequests(
  client: GraphClient,
  signal: AbortSignal,
): Promise<GroupAssignmentRequest[]> {
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
