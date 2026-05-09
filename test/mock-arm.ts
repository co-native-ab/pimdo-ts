// PIM-focused HTTP-level fake of Azure Resource Manager.
//
// Stands in for `https://management.azure.com` in tests by serving the
// small slice of endpoints the PIM Azure-role surface drives:
//
//   - GET    /providers/Microsoft.Authorization/roleEligibilityScheduleInstances
//              ?api-version=2020-10-01&$filter=asTarget()
//   - GET    /{scope}/providers/Microsoft.Authorization/roleAssignmentScheduleInstances
//              ?api-version=2020-10-01&$filter=asTarget()
//   - GET    /providers/Microsoft.Authorization/roleAssignmentScheduleRequests
//              ?api-version=2020-10-01&$filter=asTarget()|asApprover()
//   - PUT    /{scope}/providers/Microsoft.Authorization/roleAssignmentScheduleRequests/{name}
//              ?api-version=2020-10-01
//   - GET    /{scope}/providers/Microsoft.Authorization/roleManagementPolicyAssignments
//              ?api-version=2020-10-01&$filter=roleDefinitionId eq '...'
//   - POST   /batch?api-version=2020-06-01
//
// State is mutable and seedable; tests assert on
// `state.submittedRequests` and `state.batchRequests` to verify outbound
// calls. Mirrors the route-table style of `test/mock-graph.ts`.

import http from "node:http";

import { jsonResponse, readJson, startMockServer } from "./mock-server-base.js";
import type {
  ArmErrorEnvelope,
  RoleAzureActiveAssignment,
  RoleAzureAssignmentRequest,
  RoleAzureEligibleAssignment,
} from "../src/arm/types.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** A captured outbound PUT/POST against a request schedule URL. */
export interface SubmittedArmRequest {
  scope: string;
  name: string;
  body: Record<string, unknown>;
}

/** A captured /batch POST body. */
export interface BatchArmRequest {
  body: Record<string, unknown>;
}

/** A role-management policy assignment + its `Expiration_EndUser_Assignment` rule. */
export interface MockArmPolicyAssignment {
  scope: string;
  roleDefinitionId: string;
  /** ISO-8601, e.g. "PT8H". */
  maximumDuration: string;
  /** Override the rule id used in the response (defaults to `Expiration_EndUser_Assignment`). */
  ruleId?: string;
  isExpirationRequired?: boolean;
}

export class MockArmState {
  /** ARM eligibility instances returned for `asTarget()` (tenant listing). */
  eligibilityInstances: RoleAzureEligibleAssignment[] = [];

  /** ARM active-assignment instances keyed by scope. */
  activeInstancesByScope = new Map<string, RoleAzureActiveAssignment[]>();

  /** Schedule requests returned for `asTarget()`. */
  myRequests: RoleAzureAssignmentRequest[] = [];

  /** Schedule requests returned for `asApprover()`. */
  approverRequests: RoleAzureAssignmentRequest[] = [];

  /** Role-management policy assignments. */
  policyAssignments: MockArmPolicyAssignment[] = [];

  /** Captured PUT bodies (one per role-assignment-schedule request). */
  submittedRequests: SubmittedArmRequest[] = [];

  /** Captured POST /batch bodies. */
  batchRequests: BatchArmRequest[] = [];

  /**
   * Approval ids that should reject in /batch (e.g. to test failures).
   * If absent, all approvals succeed with HTTP 204.
   */
  failingApprovals = new Set<string>();

  private nextId = 1;

  genId(prefix = "mock"): string {
    const id = `${prefix}-${String(this.nextId)}`;
    this.nextId++;
    return id;
  }

  /** Convenience: seed a single eligibility entry returning the created object. */
  seedEligibility(partial: {
    id?: string;
    roleDefinitionId: string;
    scope: string;
    principalId?: string;
    roleDisplayName?: string;
    scopeDisplayName?: string;
  }): RoleAzureEligibleAssignment {
    const id =
      partial.id ??
      `${partial.scope}/providers/Microsoft.Authorization/roleEligibilityScheduleInstances/${this.genId("elig")}`;
    const e: RoleAzureEligibleAssignment = {
      id,
      name: id.slice(id.lastIndexOf("/") + 1),
      type: "Microsoft.Authorization/roleEligibilityScheduleInstances",
      properties: {
        principalId: partial.principalId ?? "me-id",
        roleDefinitionId: partial.roleDefinitionId,
        scope: partial.scope,
        memberType: "Direct",
        expandedProperties: {
          principal: { id: partial.principalId ?? "me-id", displayName: "Test User" },
          roleDefinition: {
            id: partial.roleDefinitionId,
            displayName: partial.roleDisplayName ?? "Mock Azure Role",
          },
          scope: {
            id: partial.scope,
            displayName: partial.scopeDisplayName ?? partial.scope,
            type: "subscription",
          },
        },
      },
    };
    this.eligibilityInstances.push(e);
    return e;
  }

  /** Convenience: seed an active instance under a scope. */
  seedActive(partial: {
    id?: string;
    roleDefinitionId: string;
    scope: string;
    principalId?: string;
    endDateTime?: string;
    roleDisplayName?: string;
  }): RoleAzureActiveAssignment {
    const id =
      partial.id ??
      `${partial.scope}/providers/Microsoft.Authorization/roleAssignmentScheduleInstances/${this.genId("active")}`;
    const a: RoleAzureActiveAssignment = {
      id,
      name: id.slice(id.lastIndexOf("/") + 1),
      type: "Microsoft.Authorization/roleAssignmentScheduleInstances",
      properties: {
        principalId: partial.principalId ?? "me-id",
        principalType: "User",
        roleDefinitionId: partial.roleDefinitionId,
        scope: partial.scope,
        memberType: "Direct",
        assignmentType: "Activated",
        endDateTime: partial.endDateTime ?? null,
        expandedProperties: {
          roleDefinition: {
            id: partial.roleDefinitionId,
            displayName: partial.roleDisplayName ?? "Mock Azure Role",
          },
          scope: { id: partial.scope, displayName: partial.scope, type: "subscription" },
        },
      },
    };
    const list = this.activeInstancesByScope.get(partial.scope) ?? [];
    list.push(a);
    this.activeInstancesByScope.set(partial.scope, list);
    return a;
  }

  /** Convenience: seed a single approver-side pending request. */
  seedPendingApproval(partial: {
    roleDefinitionId: string;
    scope: string;
    requesterPrincipalId?: string;
    requesterDisplayName?: string;
    justification?: string;
    roleDisplayName?: string;
    approvalId?: string;
  }): RoleAzureAssignmentRequest {
    const approvalId =
      partial.approvalId ??
      `/providers/Microsoft.Authorization/roleAssignmentApprovals/${this.genId("approval")}`;
    const id = `${partial.scope}/providers/Microsoft.Authorization/roleAssignmentScheduleRequests/${this.genId("req")}`;
    const r: RoleAzureAssignmentRequest = {
      id,
      name: id.slice(id.lastIndexOf("/") + 1),
      type: "Microsoft.Authorization/roleAssignmentScheduleRequests",
      properties: {
        principalId: partial.requesterPrincipalId ?? "other-user",
        roleDefinitionId: partial.roleDefinitionId,
        scope: partial.scope,
        requestType: "SelfActivate",
        status: "PendingApproval",
        justification: partial.justification ?? "needs access",
        approvalId,
        expandedProperties: {
          principal: {
            id: partial.requesterPrincipalId ?? "other-user",
            displayName: partial.requesterDisplayName ?? "Other User",
          },
          roleDefinition: {
            id: partial.roleDefinitionId,
            displayName: partial.roleDisplayName ?? "Mock Azure Role",
          },
          scope: { id: partial.scope, displayName: partial.scope, type: "subscription" },
        },
      },
    };
    this.approverRequests.push(r);
    return r;
  }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

export function createMockArmServer(
  state: MockArmState,
): Promise<{ server: http.Server; url: string }> {
  return startMockServer((req, res) => handleRequest(state, req, res), errorResponse);
}

const PROVIDER = "providers/Microsoft.Authorization";

interface ParsedArmPath {
  /** Scope without trailing slash, e.g. `/subscriptions/abc`, or `""` for the tenant root. */
  scope: string;
  /** Resource segment(s) after `providers/Microsoft.Authorization/`, e.g. `roleEligibilityScheduleInstances`. */
  resourcePath: string;
}

function parseArmPath(pathname: string): ParsedArmPath | undefined {
  // Strip leading `/` for predictable matching.
  const trimmed = pathname.replace(/^\/+/, "");
  const idx = trimmed.indexOf(PROVIDER);
  if (idx === -1) return undefined;
  const before = trimmed.slice(0, idx).replace(/\/+$/, "");
  const after = trimmed.slice(idx + PROVIDER.length).replace(/^\/+/, "");
  return { scope: before === "" ? "" : `/${before}`, resourcePath: after };
}

async function handleRequest(
  state: MockArmState,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const rawUrl = req.url ?? "/";
  const parsed = new URL(rawUrl, "http://127.0.0.1");
  const pathname = decodeURIComponent(parsed.pathname);
  const method = req.method ?? "GET";

  // POST /batch
  if (method === "POST" && pathname === "/batch") {
    const body = await readJson(req);
    state.batchRequests.push({ body });
    const requests = (body["requests"] as Record<string, unknown>[] | undefined) ?? [];
    const responses = requests.map((r): Record<string, unknown> => {
      const url = typeof r["url"] === "string" ? r["url"] : "";
      const m = /\/roleAssignmentApprovals\/([^/]+)\//.exec(url);
      const approvalUuid = m?.[1] ?? "";
      const fail = approvalUuid !== "" && state.failingApprovals.has(approvalUuid);
      return {
        name: typeof r["name"] === "string" ? r["name"] : "",
        httpStatusCode: fail ? 400 : 204,
        contentLength: 0,
        headers: {},
      };
    });
    return jsonResponse(res, 200, { responses });
  }

  const arm = parseArmPath(pathname);
  if (!arm) {
    errorResponse(res, 404, "NotFound", `mock arm: no route for ${method} ${pathname}`);
    return;
  }

  const filter = parsed.searchParams.get("$filter") ?? "";

  // GET roleEligibilityScheduleInstances (tenant) — asTarget()
  if (
    method === "GET" &&
    arm.scope === "" &&
    arm.resourcePath === "roleEligibilityScheduleInstances"
  ) {
    return jsonResponse(res, 200, { value: state.eligibilityInstances });
  }

  // GET roleAssignmentScheduleInstances (per scope) — asTarget()
  if (
    method === "GET" &&
    arm.resourcePath === "roleAssignmentScheduleInstances" &&
    arm.scope !== ""
  ) {
    const items = state.activeInstancesByScope.get(arm.scope) ?? [];
    return jsonResponse(res, 200, { value: items });
  }

  // GET roleAssignmentScheduleRequests (tenant) — asTarget()|asApprover()
  if (
    method === "GET" &&
    arm.scope === "" &&
    arm.resourcePath === "roleAssignmentScheduleRequests"
  ) {
    if (filter.includes("asApprover")) {
      return jsonResponse(res, 200, { value: state.approverRequests });
    }
    return jsonResponse(res, 200, { value: state.myRequests });
  }

  // PUT roleAssignmentScheduleRequests/{name}
  const reqMatch = /^roleAssignmentScheduleRequests\/([^/]+)$/.exec(arm.resourcePath);
  if (method === "PUT" && reqMatch && arm.scope !== "") {
    const name = reqMatch[1] ?? "";
    const body = await readJson(req);
    state.submittedRequests.push({ scope: arm.scope, name, body });
    const props = (body["properties"] as Record<string, unknown> | undefined) ?? {};
    const created: RoleAzureAssignmentRequest = {
      id: `${arm.scope}/providers/Microsoft.Authorization/roleAssignmentScheduleRequests/${name}`,
      name,
      type: "Microsoft.Authorization/roleAssignmentScheduleRequests",
      properties: {
        principalId: typeof props["principalId"] === "string" ? props["principalId"] : "",
        roleDefinitionId:
          typeof props["roleDefinitionId"] === "string" ? props["roleDefinitionId"] : "",
        scope: arm.scope,
        requestType: typeof props["requestType"] === "string" ? props["requestType"] : undefined,
        status: "Granted",
        justification:
          typeof props["justification"] === "string" ? props["justification"] : undefined,
      },
    };
    return jsonResponse(res, 201, created);
  }

  // GET roleManagementPolicyAssignments (per scope)
  if (method === "GET" && arm.resourcePath === "roleManagementPolicyAssignments") {
    const roleDefinitionId = extractRoleDefinitionIdFromFilter(filter);
    const matches = state.policyAssignments.filter(
      (p) =>
        (arm.scope === "" || p.scope === arm.scope) &&
        (!roleDefinitionId || p.roleDefinitionId === roleDefinitionId),
    );
    const value = matches.map((m) => ({
      id: `${m.scope}/providers/Microsoft.Authorization/roleManagementPolicyAssignments/dir-${m.roleDefinitionId}`,
      name: `dir-${m.roleDefinitionId}`,
      type: "Microsoft.Authorization/roleManagementPolicyAssignments",
      properties: {
        policyId: `policy-${m.roleDefinitionId}`,
        roleDefinitionId: m.roleDefinitionId,
        scope: m.scope,
        effectiveRules: [
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

  errorResponse(res, 404, "NotFound", `mock arm: no route for ${method} ${pathname}`);
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
  const env: ArmErrorEnvelope = { error: { code, message } };
  jsonResponse(res, status, env);
}

function extractRoleDefinitionIdFromFilter(filter: string): string | null {
  const m = /roleDefinitionId eq '([^']+)'/.exec(filter);
  return m ? (m[1] ?? null) : null;
}
