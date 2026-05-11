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

import type { ZodType } from "zod";

import { ArmClient, HttpMethod, parseResponse } from "../../arm/client.js";
import {
  armListSchema,
  ArmBatchResponsesSchema,
  ArmScheduleInfoSchema,
  RoleAzureActiveAssignment,
  RoleAzureActiveAssignmentSchema,
  RoleAzureAssignmentRequest,
  RoleAzureAssignmentRequestSchema,
  RoleAzureEligibleAssignment,
  RoleAzureEligibleAssignmentSchema,
  type ArmScheduleInfo,
} from "../../arm/types.js";

const EligibleListSchema = armListSchema(RoleAzureEligibleAssignmentSchema);
const ActiveListSchema = armListSchema(RoleAzureActiveAssignmentSchema);
const RequestListSchema = armListSchema(RoleAzureAssignmentRequestSchema);

/** Decision sent to a PIM approval stage. */
export type ReviewResult = "Approve" | "Deny";

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

/** GET role-eligibility-schedule instances where the signed-in user is the principal. */
export async function listEligibleRoleAzureAssignments(
  client: ArmClient,
  signal: AbortSignal,
): Promise<RoleAzureEligibleAssignment[]> {
  const filter = encodeURIComponent("asTarget()");
  const path =
    `/providers/${PROVIDER}/roleEligibilityScheduleInstances` +
    `?api-version=${ARM_ROLES_API_VERSION}&$filter=${filter}`;
  return getAllPages(client, path, EligibleListSchema, signal);
}

/**
 * GET role-assignment-schedule instances where the signed-in user is the
 * principal. ARM rejects an empty-scope listing for active assignments
 * (returns []), so we derive scopes from the eligibility list.
 */
export async function listActiveRoleAzureAssignments(
  client: ArmClient,
  signal: AbortSignal,
): Promise<RoleAzureActiveAssignment[]> {
  const eligibilities = await listEligibleRoleAzureAssignments(client, signal);
  const scopes = new Set<string>();
  for (const e of eligibilities) {
    const scope = e.properties.expandedProperties?.scope?.id ?? e.properties.scope;
    if (scope) scopes.add(scope);
  }
  if (scopes.size === 0) return [];

  const filter = encodeURIComponent("asTarget()");
  const result: RoleAzureActiveAssignment[] = [];
  for (const scope of scopes) {
    const path =
      `/${trimLeadingSlash(scope)}/providers/${PROVIDER}/roleAssignmentScheduleInstances` +
      `?api-version=${ARM_ROLES_API_VERSION}&$filter=${filter}`;
    const items = await getAllPages(client, path, ActiveListSchema, signal);
    for (const item of items) {
      // Only surface user principals.
      if (item.properties.principalType === undefined || item.properties.principalType === "User") {
        result.push(item);
      }
    }
  }
  return result;
}

/** GET role-assignment-schedule requests where the signed-in user is the principal. */
export async function listMyRoleAzureRequests(
  client: ArmClient,
  signal: AbortSignal,
): Promise<RoleAzureAssignmentRequest[]> {
  return listRequests(client, "asTarget()", signal);
}

/** GET role-assignment-schedule requests where the signed-in user is an approver. */
export async function listRoleAzureApprovalRequests(
  client: ArmClient,
  signal: AbortSignal,
): Promise<RoleAzureAssignmentRequest[]> {
  return listRequests(client, "asApprover()", signal);
}

async function listRequests(
  client: ArmClient,
  filterExpr: "asTarget()" | "asApprover()",
  signal: AbortSignal,
): Promise<RoleAzureAssignmentRequest[]> {
  const filter = encodeURIComponent(filterExpr);
  const path =
    `/providers/${PROVIDER}/roleAssignmentScheduleRequests` +
    `?api-version=${ARM_ROLES_API_VERSION}&$filter=${filter}`;
  return getAllPages(client, path, RequestListSchema, signal);
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
  // Sanity check the schedule shape before we PUT.
  ArmScheduleInfoSchema.parse(params.scheduleInfo);
  const body = {
    properties: {
      principalId: params.principalId,
      roleDefinitionId: params.roleDefinitionId,
      requestType: "SelfActivate",
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
  const body = {
    properties: {
      principalId: params.principalId,
      roleDefinitionId: params.roleDefinitionId,
      requestType: "SelfDeactivate",
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

interface ListPage<T> {
  value: T[];
  nextLink?: string;
}

async function getAllPages<T>(
  client: ArmClient,
  initialPath: string,
  schema: ZodType<ListPage<T>>,
  signal: AbortSignal,
): Promise<T[]> {
  const out: T[] = [];
  let nextPath: string | undefined = initialPath;
  while (nextPath !== undefined) {
    const currentPath: string = nextPath;
    const res = await client.request(HttpMethod.GET, currentPath, signal);
    const parsed = await parseResponse(res, schema, "GET", currentPath);
    out.push(...parsed.value);
    nextPath = parsed.nextLink ? toRelativePath(parsed.nextLink) : undefined;
  }
  return out;
}

/**
 * ARM `nextLink` values are absolute URLs. The ArmClient is rooted at
 * `https://management.azure.com`, so we strip the origin to use it as a
 * relative path. If the `nextLink` happens to point at a different host
 * we leave it as-is and let the caller fail loudly.
 */
function toRelativePath(nextLink: string): string {
  try {
    const u = new URL(nextLink);
    return `${u.pathname}${u.search}`;
  } catch {
    return nextLink;
  }
}

function trimLeadingSlash(value: string): string {
  return value.startsWith("/") ? value.slice(1) : value;
}
