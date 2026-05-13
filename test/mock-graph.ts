// PIM-focused HTTP-level fake of Microsoft Graph.
//
// Stands in for graph.microsoft.com in tests by serving the small slice
// of endpoints the PIM-Group surface drives in phase 2:
//
//   - GET    /me
//   - GET    /identityGovernance/privilegedAccess/group/eligibilitySchedules/
//              filterByCurrentUser(on='principal')
//   - GET    /identityGovernance/privilegedAccess/group/assignmentScheduleInstances/
//              filterByCurrentUser(on='principal')
//   - GET    /identityGovernance/privilegedAccess/group/assignmentScheduleRequests/
//              filterByCurrentUser(on='principal'|'approver')
//   - POST   /identityGovernance/privilegedAccess/group/assignmentScheduleRequests
//   - GET    /identityGovernance/privilegedAccess/group/assignmentApprovals/{id}
//   - PATCH  /identityGovernance/privilegedAccess/group/assignmentApprovals/{id}/
//              stages/{stageId}
//   - GET    /policies/roleManagementPolicyAssignments
//
// State is mutable and seedable; tests assert on `state.submittedRequests`
// and `state.patchedStages` to verify outbound calls.

import http from "node:http";

import { jsonResponse, readJson, startMockServer } from "./mock-server-base.js";
import { enforceScopes } from "./mock-scope-enforcement.js";
import {
  GROUP_PIM_RW_SCOPES,
  LIST_ACTIVE_GROUP_SCOPES,
  LIST_ELIGIBLE_GROUP_SCOPES,
} from "../src/features/group/client.js";
import {
  APPROVE_ROLE_ENTRA_SCOPES,
  LIST_ACTIVE_ROLE_ENTRA_SCOPES,
  LIST_ELIGIBLE_ROLE_ENTRA_SCOPES,
  LIST_ROLE_ENTRA_REQUESTS_SCOPES,
  ROLE_ENTRA_SCHEDULE_REQUEST_SCOPES,
} from "../src/features/role-entra/client.js";
import { GET_MY_OBJECT_ID_SCOPES } from "../src/graph/me.js";
import {
  GET_DIRECTORY_ROLE_MAX_DURATION_SCOPES,
  GET_GROUP_MAX_DURATION_SCOPES,
} from "../src/graph/policies.js";
import type {
  AssignmentApproval,
  AssignmentApprovalStage,
  GraphErrorEnvelope,
  GroupActiveAssignment,
  GroupAssignmentRequest,
  GroupEligibleAssignment,
  RoleAssignmentApproval,
  RoleEntraActiveAssignment,
  RoleEntraAssignmentRequest,
  RoleEntraEligibleAssignment,
  User,
} from "../src/graph/types.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** A submitted POST body captured for assertions. */
export interface SubmittedRequest {
  body: Record<string, unknown>;
  method: string;
  path: string;
}

/** A patched approval stage captured for assertions. */
export interface PatchedStage {
  approvalId: string;
  stageId: string;
  body: Record<string, unknown>;
}

/** A role-management policy assignment + the rules visible via $expand. */
export interface MockPolicyAssignment {
  groupId: string;
  /** ISO-8601, e.g. "PT8H". */
  maximumDuration: string;
  /** Override the rule id used in the response (defaults to `Expiration_EndUser_Assignment`). */
  ruleId?: string;
  isExpirationRequired?: boolean;
}

/**
 * Directory-scoped role-management policy assignment, used by Entra-role
 * tests. Mirrors {@link MockPolicyAssignment} but keyed by
 * `(scopeId, roleDefinitionId)` rather than groupId.
 */
export interface MockDirectoryPolicyAssignment {
  /** Tenant root is `'/'`; AU-scoped is e.g. `/administrativeUnits/<id>`. */
  scopeId: string;
  roleDefinitionId: string;
  /** ISO-8601, e.g. "PT8H". */
  maximumDuration: string;
  /** Override the rule id used in the response (defaults to `Expiration_EndUser_Assignment`). */
  ruleId?: string;
  isExpirationRequired?: boolean;
}

export class MockGraphState {
  /** Returned by `GET /me`. */
  me: User = {
    id: "me-id",
    displayName: "Test User",
    mail: "test@example.com",
    userPrincipalName: "test@example.com",
  };

  /** Returned for filterByCurrentUser(on='principal') eligibility schedules. */
  eligibilitySchedules: GroupEligibleAssignment[] = [];

  /** Returned for filterByCurrentUser(on='principal') assignment-schedule instances. */
  assignmentScheduleInstances: GroupActiveAssignment[] = [];

  /** Returned for filterByCurrentUser(on='principal') assignment-schedule requests. */
  myRequests: GroupAssignmentRequest[] = [];

  /** Returned for filterByCurrentUser(on='approver') assignment-schedule requests. */
  approverRequests: GroupAssignmentRequest[] = [];

  /** Returned for the Entra-role filterByCurrentUser(on='principal') eligibility schedules. */
  roleEntraEligibilitySchedules: RoleEntraEligibleAssignment[] = [];

  /** Returned for the Entra-role filterByCurrentUser(on='principal') schedule instances. */
  roleEntraAssignmentScheduleInstances: RoleEntraActiveAssignment[] = [];

  /** Entra-role filterByCurrentUser(on='principal') schedule requests. */
  roleEntraMyRequests: RoleEntraAssignmentRequest[] = [];

  /** Entra-role filterByCurrentUser(on='approver') schedule requests. */
  roleEntraApproverRequests: RoleEntraAssignmentRequest[] = [];

  /** Entra-role approvals (BETA), keyed by id. */
  roleEntraApprovals = new Map<string, RoleAssignmentApproval>();

  /** Approvals keyed by id. */
  approvals = new Map<string, AssignmentApproval>();

  /** Policy assignments keyed by groupId + roleDefinitionId=member. */
  policyAssignments: MockPolicyAssignment[] = [];

  /** Directory-scoped policy assignments (Entra-role surface). */
  directoryPolicyAssignments: MockDirectoryPolicyAssignment[] = [];

  /** Captured POST bodies (assignmentScheduleRequests). */
  submittedRequests: SubmittedRequest[] = [];

  /** Captured PATCH bodies (assignment approval stages). */
  patchedStages: PatchedStage[] = [];

  private nextId = 1;

  genId(prefix = "mock"): string {
    const id = `${prefix}-${String(this.nextId)}`;
    this.nextId++;
    return id;
  }

  /** Convenience: seed a single eligibility entry returning the created object. */
  seedEligibility(
    partial: Partial<GroupEligibleAssignment> & { groupId: string },
  ): GroupEligibleAssignment {
    const e: GroupEligibleAssignment = {
      id: partial.id ?? this.genId("elig"),
      groupId: partial.groupId,
      principalId: partial.principalId ?? this.me.id,
      memberType: partial.memberType ?? "Direct",
      accessId: partial.accessId ?? "member",
      status: partial.status ?? "Provisioned",
      scheduleInfo: partial.scheduleInfo,
      group: partial.group,
      principal: partial.principal,
    };
    this.eligibilitySchedules.push(e);
    return e;
  }

  /** Convenience: seed a single approver-side pending request + matching approval. */
  seedPendingApproval(partial: {
    groupId: string;
    requesterPrincipalId?: string;
    requesterDisplayName?: string;
    justification?: string;
    groupDisplayName?: string;
    stage?: Partial<AssignmentApprovalStage>;
  }): { request: GroupAssignmentRequest; approval: AssignmentApproval } {
    const approvalId = this.genId("approval");
    const stageId = this.genId("stage");
    const stage: AssignmentApprovalStage = {
      id: stageId,
      assignedToMe: true,
      reviewResult: "NotReviewed",
      status: "InProgress",
      ...partial.stage,
    };
    const approval: AssignmentApproval = { id: approvalId, stages: [stage] };
    this.approvals.set(approvalId, approval);

    const request: GroupAssignmentRequest = {
      id: this.genId("req"),
      groupId: partial.groupId,
      principalId: partial.requesterPrincipalId ?? "other-user",
      accessId: "member",
      action: "selfActivate",
      approvalId,
      status: "PendingApproval",
      justification: partial.justification ?? "needs access",
      group: { id: partial.groupId, displayName: partial.groupDisplayName ?? "Mock Group" },
      principal: {
        id: partial.requesterPrincipalId ?? "other-user",
        displayName: partial.requesterDisplayName ?? "Other User",
        mail: "other@example.com",
        userPrincipalName: "other@example.com",
      },
    };
    this.approverRequests.push(request);
    return { request, approval };
  }

  /** Convenience: seed a single Entra-role eligibility entry. */
  seedRoleEntraEligibility(
    partial: Partial<RoleEntraEligibleAssignment> & { roleDefinitionId: string },
  ): RoleEntraEligibleAssignment {
    const e: RoleEntraEligibleAssignment = {
      id: partial.id ?? this.genId("role-elig"),
      roleDefinitionId: partial.roleDefinitionId,
      principalId: partial.principalId ?? this.me.id,
      directoryScopeId: partial.directoryScopeId ?? "/",
      memberType: partial.memberType ?? "Direct",
      status: partial.status ?? "Provisioned",
      scheduleInfo: partial.scheduleInfo,
      roleDefinition: partial.roleDefinition,
      principal: partial.principal,
    };
    this.roleEntraEligibilitySchedules.push(e);
    return e;
  }

  /** Convenience: seed a pending Entra-role approval + matching approver request. */
  seedRoleEntraPendingApproval(partial: {
    roleDefinitionId: string;
    directoryScopeId?: string;
    requesterPrincipalId?: string;
    requesterDisplayName?: string;
    justification?: string;
    roleDisplayName?: string;
    step?: Partial<AssignmentApprovalStage>;
  }): { request: RoleEntraAssignmentRequest; approval: RoleAssignmentApproval } {
    const approvalId = this.genId("role-approval");
    const stepId = this.genId("role-step");
    const step: AssignmentApprovalStage = {
      id: stepId,
      assignedToMe: true,
      reviewResult: "NotReviewed",
      status: "InProgress",
      ...partial.step,
    };
    const approval: RoleAssignmentApproval = { id: approvalId, steps: [step] };
    this.roleEntraApprovals.set(approvalId, approval);

    const request: RoleEntraAssignmentRequest = {
      id: this.genId("role-req"),
      roleDefinitionId: partial.roleDefinitionId,
      principalId: partial.requesterPrincipalId ?? "other-user",
      directoryScopeId: partial.directoryScopeId ?? "/",
      action: "selfActivate",
      approvalId,
      status: "PendingApproval",
      justification: partial.justification ?? "needs access",
      roleDefinition: {
        id: partial.roleDefinitionId,
        displayName: partial.roleDisplayName ?? "Mock Role",
      },
      principal: {
        id: partial.requesterPrincipalId ?? "other-user",
        displayName: partial.requesterDisplayName ?? "Other User",
        mail: "other@example.com",
        userPrincipalName: "other@example.com",
      },
    };
    this.roleEntraApproverRequests.push(request);
    return { request, approval };
  }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

export function createMockGraphServer(
  state: MockGraphState,
): Promise<{ server: http.Server; url: string }> {
  return startMockServer((req, res) => handleRequest(state, req, res), errorResponse);
}

async function handleRequest(
  state: MockGraphState,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const rawUrl = req.url ?? "/";
  const parsed = new URL(rawUrl, "http://127.0.0.1");
  const pathname = decodeURIComponent(parsed.pathname);
  const method = req.method ?? "GET";

  // GET /me
  if (method === "GET" && pathname === "/me") {
    if (!enforceScopes(req, res, GET_MY_OBJECT_ID_SCOPES, errorResponse)) return;
    return jsonResponse(res, 200, state.me);
  }

  // /identityGovernance/privilegedAccess/group/...
  const PIM = "/identityGovernance/privilegedAccess/group";

  if (
    method === "GET" &&
    pathname === `${PIM}/eligibilitySchedules/filterByCurrentUser(on='principal')`
  ) {
    if (!enforceScopes(req, res, LIST_ELIGIBLE_GROUP_SCOPES, errorResponse)) return;
    return jsonResponse(res, 200, { value: state.eligibilitySchedules });
  }

  if (
    method === "GET" &&
    pathname === `${PIM}/assignmentScheduleInstances/filterByCurrentUser(on='principal')`
  ) {
    if (!enforceScopes(req, res, LIST_ACTIVE_GROUP_SCOPES, errorResponse)) return;
    return jsonResponse(res, 200, { value: state.assignmentScheduleInstances });
  }

  // assignmentScheduleRequests/filterByCurrentUser(on='principal'|'approver')
  const reqListMatch =
    /^\/identityGovernance\/privilegedAccess\/group\/assignmentScheduleRequests\/filterByCurrentUser\(on='(principal|approver)'\)$/.exec(
      pathname,
    );
  if (method === "GET" && reqListMatch) {
    if (!enforceScopes(req, res, GROUP_PIM_RW_SCOPES, errorResponse)) return;
    const on = reqListMatch[1] as "principal" | "approver";
    const all = on === "principal" ? state.myRequests : state.approverRequests;
    const filter = parsed.searchParams.get("$filter");
    const filtered = applyStatusFilter(all, filter);
    return jsonResponse(res, 200, { value: filtered });
  }

  // POST assignmentScheduleRequests
  if (method === "POST" && pathname === `${PIM}/assignmentScheduleRequests`) {
    if (!enforceScopes(req, res, GROUP_PIM_RW_SCOPES, errorResponse)) return;
    const body = await readJson(req);
    state.submittedRequests.push({ body, method, path: pathname });
    const created: GroupAssignmentRequest = {
      id: state.genId("req"),
      groupId: stringField(body, "groupId") ?? "",
      principalId: stringField(body, "principalId") ?? "",
      accessId: stringField(body, "accessId"),
      action: stringField(body, "action"),
      status: "Granted",
      justification: stringField(body, "justification"),
      scheduleInfo: body["scheduleInfo"] as GroupAssignmentRequest["scheduleInfo"],
    };
    return jsonResponse(res, 201, created);
  }

  // GET / PATCH assignmentApprovals/{id}/...
  const approvalGet =
    /^\/identityGovernance\/privilegedAccess\/group\/assignmentApprovals\/([^/]+)$/.exec(pathname);
  if (method === "GET" && approvalGet) {
    if (!enforceScopes(req, res, GROUP_PIM_RW_SCOPES, errorResponse)) return;
    const approvalId = approvalGet[1] ?? "";
    const approval = state.approvals.get(approvalId);
    if (!approval) return errorResponse(res, 404, "NotFound", `approval ${approvalId} not found`);
    return jsonResponse(res, 200, approval);
  }

  const stagePatch =
    /^\/identityGovernance\/privilegedAccess\/group\/assignmentApprovals\/([^/]+)\/stages\/([^/]+)$/.exec(
      pathname,
    );
  if (method === "PATCH" && stagePatch) {
    if (!enforceScopes(req, res, GROUP_PIM_RW_SCOPES, errorResponse)) return;
    const approvalId = stagePatch[1] ?? "";
    const stageId = stagePatch[2] ?? "";
    const approval = state.approvals.get(approvalId);
    if (!approval) return errorResponse(res, 404, "NotFound", `approval ${approvalId} not found`);
    const stage = approval.stages.find((s) => s.id === stageId);
    if (!stage) return errorResponse(res, 404, "NotFound", `stage ${stageId} not found`);
    const body = await readJson(req);
    state.patchedStages.push({ approvalId, stageId, body });
    if (typeof body["reviewResult"] === "string") stage.reviewResult = body["reviewResult"];
    if (typeof body["justification"] === "string") stage.justification = body["justification"];
    stage.status = "Completed";
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /policies/roleManagementPolicyAssignments?$filter=...
  if (method === "GET" && pathname === "/policies/roleManagementPolicyAssignments") {
    const filter = parsed.searchParams.get("$filter") ?? "";
    const scopeType = extractScopeTypeFromPolicyFilter(filter);
    const policyScopes =
      scopeType === "Directory"
        ? GET_DIRECTORY_ROLE_MAX_DURATION_SCOPES
        : GET_GROUP_MAX_DURATION_SCOPES;
    if (!enforceScopes(req, res, policyScopes, errorResponse)) return;
    if (scopeType === "Directory") {
      const scopeId = extractScopeIdFromPolicyFilter(filter);
      const roleDefinitionId = extractRoleDefinitionIdFromPolicyFilter(filter);
      const matches = state.directoryPolicyAssignments.filter(
        (p) =>
          (!scopeId || p.scopeId === scopeId) &&
          (!roleDefinitionId || p.roleDefinitionId === roleDefinitionId),
      );
      const value = matches.map((m) => ({
        id: `dir-assignment-${m.scopeId}-${m.roleDefinitionId}`,
        policy: {
          id: `dir-policy-${m.scopeId}-${m.roleDefinitionId}`,
          rules: [
            {
              id: m.ruleId ?? "Expiration_EndUser_Assignment",
              isExpirationRequired: m.isExpirationRequired ?? true,
              maximumDuration: m.maximumDuration,
            },
          ],
        },
      }));
      return jsonResponse(res, 200, { value });
    }
    const groupId = extractScopeIdFromPolicyFilter(filter);
    const matches = groupId
      ? state.policyAssignments.filter((p) => p.groupId === groupId)
      : state.policyAssignments;
    const value = matches.map((m) => ({
      id: `assignment-${m.groupId}`,
      policy: {
        id: `policy-${m.groupId}`,
        rules: [
          {
            id: m.ruleId ?? "Expiration_EndUser_Assignment",
            isExpirationRequired: m.isExpirationRequired ?? true,
            maximumDuration: m.maximumDuration,
          },
        ],
      },
    }));
    return jsonResponse(res, 200, { value });
  }

  // ---------------------------------------------------------------------------
  // Entra-role surface (v1.0 list/POST + beta approvals)
  // ---------------------------------------------------------------------------

  const ROLE = "/roleManagement/directory";

  if (
    method === "GET" &&
    pathname === `${ROLE}/roleEligibilitySchedules/filterByCurrentUser(on='principal')`
  ) {
    if (!enforceScopes(req, res, LIST_ELIGIBLE_ROLE_ENTRA_SCOPES, errorResponse)) return;
    return jsonResponse(res, 200, { value: state.roleEntraEligibilitySchedules });
  }

  if (
    method === "GET" &&
    pathname === `${ROLE}/roleAssignmentScheduleInstances/filterByCurrentUser(on='principal')`
  ) {
    if (!enforceScopes(req, res, LIST_ACTIVE_ROLE_ENTRA_SCOPES, errorResponse)) return;
    return jsonResponse(res, 200, { value: state.roleEntraAssignmentScheduleInstances });
  }

  const roleReqListMatch =
    /^\/roleManagement\/directory\/roleAssignmentScheduleRequests\/filterByCurrentUser\(on='(principal|approver)'\)$/.exec(
      pathname,
    );
  if (method === "GET" && roleReqListMatch) {
    if (!enforceScopes(req, res, LIST_ROLE_ENTRA_REQUESTS_SCOPES, errorResponse)) return;
    const on = roleReqListMatch[1] as "principal" | "approver";
    const all = on === "principal" ? state.roleEntraMyRequests : state.roleEntraApproverRequests;
    const filter = parsed.searchParams.get("$filter");
    const filtered = applyRoleEntraStatusFilter(all, filter);
    return jsonResponse(res, 200, { value: filtered });
  }

  if (method === "POST" && pathname === `${ROLE}/roleAssignmentScheduleRequests`) {
    if (!enforceScopes(req, res, ROLE_ENTRA_SCHEDULE_REQUEST_SCOPES, errorResponse)) return;
    const body = await readJson(req);
    state.submittedRequests.push({ body, method, path: pathname });
    const created: RoleEntraAssignmentRequest = {
      id: state.genId("role-req"),
      roleDefinitionId: stringField(body, "roleDefinitionId") ?? "",
      principalId: stringField(body, "principalId") ?? "",
      directoryScopeId: stringField(body, "directoryScopeId"),
      action: stringField(body, "action"),
      status: "Granted",
      justification: stringField(body, "justification"),
      scheduleInfo: body["scheduleInfo"] as RoleEntraAssignmentRequest["scheduleInfo"],
    };
    return jsonResponse(res, 201, created);
  }

  // BETA approval GET / step PATCH
  const roleApprovalGet = /^\/roleManagement\/directory\/roleAssignmentApprovals\/([^/]+)$/.exec(
    pathname,
  );
  if (method === "GET" && roleApprovalGet) {
    if (!enforceScopes(req, res, APPROVE_ROLE_ENTRA_SCOPES, errorResponse)) return;
    const approvalId = roleApprovalGet[1] ?? "";
    const approval = state.roleEntraApprovals.get(approvalId);
    if (!approval)
      return errorResponse(res, 404, "NotFound", `role approval ${approvalId} not found`);
    return jsonResponse(res, 200, approval);
  }

  const roleStepPatch =
    /^\/roleManagement\/directory\/roleAssignmentApprovals\/([^/]+)\/steps\/([^/]+)$/.exec(
      pathname,
    );
  if (method === "PATCH" && roleStepPatch) {
    if (!enforceScopes(req, res, APPROVE_ROLE_ENTRA_SCOPES, errorResponse)) return;
    const approvalId = roleStepPatch[1] ?? "";
    const stepId = roleStepPatch[2] ?? "";
    const approval = state.roleEntraApprovals.get(approvalId);
    if (!approval)
      return errorResponse(res, 404, "NotFound", `role approval ${approvalId} not found`);
    const step = approval.steps.find((s) => s.id === stepId);
    if (!step) return errorResponse(res, 404, "NotFound", `role step ${stepId} not found`);
    const body = await readJson(req);
    state.patchedStages.push({ approvalId, stageId: stepId, body });
    if (typeof body["reviewResult"] === "string") step.reviewResult = body["reviewResult"];
    if (typeof body["justification"] === "string") step.justification = body["justification"];
    step.status = "Completed";
    res.writeHead(204);
    res.end();
    return;
  }

  errorResponse(res, 404, "NotFound", `mock graph: no route for ${method} ${pathname}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorResponse(
  res: http.ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  const env: GraphErrorEnvelope = { error: { code, message } };
  jsonResponse(res, status, env);
}

function stringField(body: Record<string, unknown>, key: string): string | undefined {
  const v = body[key];
  return typeof v === "string" ? v : undefined;
}

function applyStatusFilter(
  items: GroupAssignmentRequest[],
  filter: string | null,
): GroupAssignmentRequest[] {
  if (!filter) return items;
  const m = /^status eq '([^']+)'$/.exec(filter);
  if (!m) return items;
  return items.filter((r) => r.status === m[1]);
}

function applyRoleEntraStatusFilter(
  items: RoleEntraAssignmentRequest[],
  filter: string | null,
): RoleEntraAssignmentRequest[] {
  if (!filter) return items;
  const m = /^status eq '([^']+)'$/.exec(filter);
  if (!m) return items;
  return items.filter((r) => r.status === m[1]);
}

/** Extract `<scopeId>` from `scopeId eq '<scopeId>' and ...`. */
function extractScopeIdFromPolicyFilter(filter: string): string | null {
  const m = /scopeId eq '([^']+)'/.exec(filter);
  return m ? (m[1] ?? null) : null;
}

/** Extract scopeType (`Group` | `Directory` | …) from a policy `$filter`. */
function extractScopeTypeFromPolicyFilter(filter: string): string | null {
  const m = /scopeType eq '([^']+)'/.exec(filter);
  return m ? (m[1] ?? null) : null;
}

/** Extract `<roleDefinitionId>` from `roleDefinitionId eq '<roleDefinitionId>'`. */
function extractRoleDefinitionIdFromPolicyFilter(filter: string): string | null {
  const m = /roleDefinitionId eq '([^']+)'/.exec(filter);
  return m ? (m[1] ?? null) : null;
}
