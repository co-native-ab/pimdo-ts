// PIM operations for Azure (resource) Roles.
//
// Wraps the seven Azure Resource Manager endpoints needed by the
// `pim_role_azure_*` MCP tools. Mirrors `src/graph/pim-role-entra.ts`
// but targets ARM under `/providers/Microsoft.Authorization/role*`:
//
//   - list eligible assignments         (asTarget())
//   - list active   assignments         (per scope, asTarget())
//   - list my pending requests          (asTarget())
//   - list approver-side requests       (asApprover())
//   - request activation                (PUT roleAssignmentScheduleRequests/{uuid},
//                                        requestType=SelfActivate)
//   - request deactivation              (PUT roleAssignmentScheduleRequests/{uuid},
//                                        requestType=SelfDeactivate)
//   - approve / deny an assignment      (POST /batch with PUT to
//                                        roleAssignmentApprovals/{id}/stages/{id})
//
// API versions:
//   - role* resources:                  2020-10-01
//   - roleAssignmentApprovals stage PUT 2021-01-01-preview
//   - /batch:                           2020-06-01
//
// The approve path uses the Azure portal's `/batch` trick because the
// direct PUT to `roleAssignmentApprovals` does not work for delegated
// tokens — see the comment on `approveRoleAzureAssignment`.

import { randomUUID } from "node:crypto";

import { ArmClient, HttpMethod, parseResponse } from "../../arm/client.js";
import { OAuthScope } from "../../scopes.js";
import { assertScopes } from "../../scopes-runtime.js";
import {
  ArmBatchResponsesSchema,
  ArmScheduleInfoSchema,
  RoleAzureActiveAssignment,
  RoleAzureActiveAssignmentSchema,
  RoleAzureApprovalSchema,
  RoleAzureAssignmentRequest,
  RoleAzureAssignmentRequestSchema,
  RoleAzureEligibleAssignment,
  RoleAzureEligibleAssignmentSchema,
  type ArmScheduleInfo,
} from "../../arm/types.js";
import { ArmScheduleRequestType, type SubmittedApprovalDecision } from "../../enums.js";
import { armPageParser, mergePaged, paginateArm, type PagedResult } from "../../http/paging.js";

const eligiblePageParser = armPageParser(RoleAzureEligibleAssignmentSchema, parseResponse);
const activePageParser = armPageParser(RoleAzureActiveAssignmentSchema, parseResponse);
const requestPageParser = armPageParser(RoleAzureAssignmentRequestSchema, parseResponse);

/** Decision sent to a PIM approval stage. */
export type ReviewResult = SubmittedApprovalDecision;

/** API version for `Microsoft.Authorization/role*` resources. */
export const ARM_ROLES_API_VERSION = "2020-10-01";

/** API version used inside the batch PUT to `roleAssignmentApprovals/.../stages`. */
export const ARM_APPROVAL_STAGES_API_VERSION = "2021-01-01-preview";

/** API version of the ARM `/batch` endpoint. */
export const ARM_BATCH_API_VERSION = "2020-06-01";

const PROVIDER = "Microsoft.Authorization";

// ---------------------------------------------------------------------------
// List operations
// ---------------------------------------------------------------------------

/**
 * Azure Resource Manager permissions for every PIM Azure-role
 * operation. ARM uses a single `user_impersonation` scope that
 * authorises the call; the server-side RBAC then determines whether
 * the caller may read or write the target resource.
 *
 * @see https://learn.microsoft.com/en-us/rest/api/authorization/role-assignment-schedule-requests
 */
export const ROLE_AZURE_SCOPES: OAuthScope[][] = [[OAuthScope.ArmUserImpersonation]];

/** GET role-eligibility-schedule instances where the signed-in user is the principal. */
export async function listEligibleRoleAzureAssignments(
  client: ArmClient,
  signal: AbortSignal,
): Promise<PagedResult<RoleAzureEligibleAssignment>> {
  await assertScopes(client.credential, ROLE_AZURE_SCOPES, signal);
  const filter = encodeURIComponent("asTarget()");
  const path =
    `/providers/${PROVIDER}/roleEligibilityScheduleInstances` +
    `?api-version=${ARM_ROLES_API_VERSION}&$filter=${filter}`;
  return paginateArm(client, path, eligiblePageParser, undefined, signal);
}

/**
 * Lifecycle statuses that indicate the active assignment is no longer
 * effective. ARM may continue to return revoked/expired instances on
 * `roleAssignmentScheduleInstances` for a short period after a
 * deactivation, so we drop them client-side to keep the active-list
 * tool aligned with what the user can actually use.
 *
 * Anything not in this set (including unknown statuses) is preserved
 * so we never accidentally hide a truly active assignment.
 */
const TERMINAL_ACTIVE_STATUSES = new Set<string>([
  "Revoked",
  "Revoking",
  "Expired",
  "Canceled",
  "Cancelled",
  "Denied",
  "Failed",
]);

function isActiveStatus(status: string | undefined): boolean {
  if (!status) return true;
  return !TERMINAL_ACTIVE_STATUSES.has(status);
}

/**
 * GET role-assignment-schedule instances where the signed-in user is the
 * principal. ARM rejects an empty-scope listing for active assignments
 * (returns []), so we derive scopes from the eligibility list.
 *
 * Truncation propagates from both the eligibility lookup and the
 * per-scope active queries — the AI surface reports the result as
 * truncated when *any* underlying page was capped.
 */
export async function listActiveRoleAzureAssignments(
  client: ArmClient,
  signal: AbortSignal,
): Promise<PagedResult<RoleAzureActiveAssignment>> {
  await assertScopes(client.credential, ROLE_AZURE_SCOPES, signal);
  const eligibilityResult = await listEligibleRoleAzureAssignments(client, signal);
  const scopes = new Set<string>();
  for (const e of eligibilityResult.items) {
    const scope = e.properties.expandedProperties?.scope?.id ?? e.properties.scope;
    if (scope) scopes.add(scope);
  }
  if (scopes.size === 0) {
    return {
      items: [],
      truncated: eligibilityResult.truncated,
      pagesFetched: eligibilityResult.pagesFetched,
    };
  }

  const filter = encodeURIComponent("asTarget()");
  let aggregate: PagedResult<RoleAzureActiveAssignment> = {
    items: [],
    truncated: eligibilityResult.truncated,
    pagesFetched: eligibilityResult.pagesFetched,
  };
  for (const scope of scopes) {
    const path =
      `/${trimLeadingSlash(scope)}/providers/${PROVIDER}/roleAssignmentScheduleInstances` +
      `?api-version=${ARM_ROLES_API_VERSION}&$filter=${filter}`;
    const page = await paginateArm(client, path, activePageParser, undefined, signal);
    const filtered: PagedResult<RoleAzureActiveAssignment> = {
      items: page.items.filter(
        (item) =>
          (item.properties.principalType === undefined ||
            item.properties.principalType === "User") &&
          isActiveStatus(item.properties.status),
      ),
      truncated: page.truncated,
      pagesFetched: page.pagesFetched,
    };
    aggregate = mergePaged(aggregate, filtered);
  }
  return aggregate;
}

/** GET role-assignment-schedule requests where the signed-in user is the principal. */
export async function listMyRoleAzureRequests(
  client: ArmClient,
  signal: AbortSignal,
): Promise<PagedResult<RoleAzureAssignmentRequest>> {
  await assertScopes(client.credential, ROLE_AZURE_SCOPES, signal);
  return listRequests(client, "asTarget()", signal);
}

/** GET role-assignment-schedule requests where the signed-in user is an approver. */
export async function listRoleAzureApprovalRequests(
  client: ArmClient,
  signal: AbortSignal,
): Promise<PagedResult<RoleAzureAssignmentRequest>> {
  await assertScopes(client.credential, ROLE_AZURE_SCOPES, signal);
  return listRequests(client, "asApprover()", signal);
}

async function listRequests(
  client: ArmClient,
  filterExpr: "asTarget()" | "asApprover()",
  signal: AbortSignal,
): Promise<PagedResult<RoleAzureAssignmentRequest>> {
  const filter = encodeURIComponent(filterExpr);
  const path =
    `/providers/${PROVIDER}/roleAssignmentScheduleRequests` +
    `?api-version=${ARM_ROLES_API_VERSION}&$filter=${filter}`;
  return paginateArm(client, path, requestPageParser, undefined, signal);
}

// ---------------------------------------------------------------------------
// Activate / deactivate
// ---------------------------------------------------------------------------

export interface RequestRoleAzureActivationParams {
  /** Object ID of the signed-in user (Entra `oid`). */
  principalId: string;
  roleDefinitionId: string;
  justification: string;
  scheduleInfo: ArmScheduleInfo;
}

/** PUT a `SelfActivate` role-assignment-schedule request at `scope`. */
export async function requestRoleAzureActivation(
  client: ArmClient,
  scope: string,
  params: RequestRoleAzureActivationParams,
  signal: AbortSignal,
): Promise<RoleAzureAssignmentRequest> {
  await assertScopes(client.credential, ROLE_AZURE_SCOPES, signal);
  // Sanity check the schedule shape before we PUT.
  ArmScheduleInfoSchema.parse(params.scheduleInfo);
  const body = {
    properties: {
      principalId: params.principalId,
      roleDefinitionId: params.roleDefinitionId,
      requestType: ArmScheduleRequestType.SelfActivate,
      justification: params.justification,
      scheduleInfo: params.scheduleInfo,
    },
  };
  return putScheduleRequest(client, scope, body, signal);
}

export interface RequestRoleAzureDeactivationParams {
  principalId: string;
  roleDefinitionId: string;
  justification: string;
}

/** PUT a `SelfDeactivate` role-assignment-schedule request at `scope`. */
export async function requestRoleAzureDeactivation(
  client: ArmClient,
  scope: string,
  params: RequestRoleAzureDeactivationParams,
  signal: AbortSignal,
): Promise<RoleAzureAssignmentRequest> {
  await assertScopes(client.credential, ROLE_AZURE_SCOPES, signal);
  const body = {
    properties: {
      principalId: params.principalId,
      roleDefinitionId: params.roleDefinitionId,
      requestType: ArmScheduleRequestType.SelfDeactivate,
      justification: params.justification,
    },
  };
  return putScheduleRequest(client, scope, body, signal);
}

async function putScheduleRequest(
  client: ArmClient,
  scope: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<RoleAzureAssignmentRequest> {
  const name = randomUUID();
  const path =
    `/${trimLeadingSlash(scope)}/providers/${PROVIDER}/roleAssignmentScheduleRequests/${name}` +
    `?api-version=${ARM_ROLES_API_VERSION}`;
  const res = await client.request(HttpMethod.PUT, path, body, signal);
  return parseResponse(res, RoleAzureAssignmentRequestSchema, "PUT", path);
}

/**
 * GET role-assignment-schedule requests where the signed-in user is the
 * principal, filtered client-side to those still `PendingApproval`.
 *
 * Unlike Graph (where `$filter=status eq 'PendingApproval'` is supported
 * server-side), the ARM endpoint does not honour a status filter on
 * `roleAssignmentScheduleRequests`, so we filter after the fact. The
 * unfiltered helper {@link listMyRoleAzureRequests} is kept as the
 * source for `pim_role_azure_request_list`, which intentionally
 * surfaces all visible request states.
 */
export async function listMyPendingRoleAzureRequests(
  client: ArmClient,
  signal: AbortSignal,
): Promise<PagedResult<RoleAzureAssignmentRequest>> {
  const all = await listMyRoleAzureRequests(client, signal);
  return {
    items: all.items.filter((r) => r.properties.status === "PendingApproval"),
    truncated: all.truncated,
    pagesFetched: all.pagesFetched,
  };
}

/**
 * GET role-assignment-schedule requests where the signed-in user is an
 * approver, filtered client-side to those still `PendingApproval`.
 *
 * Mirrors {@link listMyPendingRoleAzureRequests} on the principal side
 * — see that helper for the rationale (ARM doesn't honour
 * `$filter=status eq 'PendingApproval'` on this endpoint, so we filter
 * after the fact).
 */
export async function listPendingRoleAzureApprovalRequests(
  client: ArmClient,
  signal: AbortSignal,
): Promise<PagedResult<RoleAzureAssignmentRequest>> {
  const all = await listRoleAzureApprovalRequests(client, signal);
  return {
    items: all.items.filter((r) => r.properties.status === "PendingApproval"),
    truncated: all.truncated,
    pagesFetched: all.pagesFetched,
  };
}

/**
 * Probe whether the signed-in user still has a live, NotReviewed stage
 * on the given Azure-role approval. Used by the approver-side stale
 * classifier (#40). The direct GET on `roleAssignmentApprovals/{id}` is
 * undocumented for delegated tokens — the existing approve flow uses a
 * `/batch` PUT for that reason — but a delegated GET has been observed
 * to succeed in practice. If the GET returns an error it is allowed to
 * propagate so the `*_approval_list` tool surfaces the failure instead
 * of silently mis-classifying.
 */
export async function hasLiveRoleAzureApprovalStageForMe(
  client: ArmClient,
  approvalId: string,
  signal: AbortSignal,
): Promise<boolean> {
  await assertScopes(client.credential, ROLE_AZURE_SCOPES, signal);
  const uuid = extractApprovalUuid(approvalId);
  const path =
    `/providers/${PROVIDER}/roleAssignmentApprovals/${uuid}` +
    `?api-version=${ARM_APPROVAL_STAGES_API_VERSION}&$expand=stages`;
  const res = await client.request(HttpMethod.GET, path, signal);
  const approval = await parseResponse(res, RoleAzureApprovalSchema, "GET", path);
  const stages = approval.properties.stages ?? [];
  return stages.some(
    (s) =>
      s.properties.status === "InProgress" &&
      s.properties.reviewResult === "NotReviewed" &&
      s.properties.assignedToMe === true,
  );
}

/**
 * Cancel a pending PIM Azure-role assignment-schedule request that the
 * signed-in user submitted. Reuses {@link ROLE_AZURE_SCOPES}; ARM
 * responds with 204 No Content. The full ARM relative path requires
 * the original request's ARM scope (e.g. `/subscriptions/<id>`) and
 * the request name (the trailing UUID under
 * `roleAssignmentScheduleRequests/`).
 *
 * @see https://learn.microsoft.com/en-us/rest/api/authorization/role-assignment-schedule-requests/cancel
 */
export async function cancelRoleAzureAssignmentRequest(
  client: ArmClient,
  scope: string,
  requestName: string,
  signal: AbortSignal,
): Promise<void> {
  await assertScopes(client.credential, ROLE_AZURE_SCOPES, signal);
  const path =
    `/${trimLeadingSlash(scope)}/providers/${PROVIDER}/roleAssignmentScheduleRequests/${encodeURIComponent(requestName)}/cancel` +
    `?api-version=${ARM_ROLES_API_VERSION}`;
  await client.request(HttpMethod.POST, path, signal);
}

// ---------------------------------------------------------------------------
// Approve / deny (via /batch — see file-level comment)
// ---------------------------------------------------------------------------

/**
 * Approve or deny a PIM Azure-role assignment. ARM does not expose a
 * working delegated PUT to `roleAssignmentApprovals/.../stages/{id}`, so
 * we replicate the Azure portal's `/batch` trick.
 *
 * `approvalId` may be the full ARM relative path
 * (`/providers/Microsoft.Authorization/roleAssignmentApprovals/{uuid}`)
 * or just the bare UUID — the latter is what the assignment request
 * surfaces in `properties.approvalId` for tenant-scoped approvals.
 */
export async function approveRoleAzureAssignment(
  client: ArmClient,
  approvalId: string,
  decision: ReviewResult,
  justification: string,
  signal: AbortSignal,
): Promise<void> {
  await assertScopes(client.credential, ROLE_AZURE_SCOPES, signal);
  const approvalUuid = extractApprovalUuid(approvalId);
  const innerName = randomUUID();
  const innerUrl =
    `/providers/${PROVIDER}/roleAssignmentApprovals/${approvalUuid}` +
    `/stages/${approvalUuid}?api-version=${ARM_APPROVAL_STAGES_API_VERSION}`;

  const batchBody = {
    requests: [
      {
        url: innerUrl,
        httpMethod: "PUT",
        content: {
          properties: {
            reviewResult: decision,
            justification,
          },
        },
        name: innerName,
      },
    ],
  };

  const path = `/batch?api-version=${ARM_BATCH_API_VERSION}`;
  const res = await client.request(HttpMethod.POST, path, batchBody, signal);
  const parsed = await parseResponse(res, ArmBatchResponsesSchema, "POST", path);
  if (parsed.responses.length !== 1) {
    throw new Error(
      `expected 1 batch response, got ${String(parsed.responses.length)} for approval ${approvalUuid}`,
    );
  }
  const inner = parsed.responses[0];
  if (!inner) {
    throw new Error(`empty batch response for approval ${approvalUuid}`);
  }
  if (inner.httpStatusCode >= 400) {
    throw new Error(
      `batch approval PUT failed for ${approvalUuid}: HTTP ${String(inner.httpStatusCode)}`,
    );
  }
}

function extractApprovalUuid(approvalId: string): string {
  if (!approvalId) {
    throw new Error("approvalId is required");
  }
  const trimmed = approvalId.replace(/\/$/, "");
  const lastSlash = trimmed.lastIndexOf("/");
  return lastSlash === -1 ? trimmed : trimmed.slice(lastSlash + 1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function trimLeadingSlash(value: string): string {
  return value.startsWith("/") ? value.slice(1) : value;
}
