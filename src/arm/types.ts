// Azure Resource Manager response envelope types and PIM domain shapes.
//
// Type definitions are paired with `loose()` zod schemas so we validate
// the wire shape we actually depend on while ignoring fields ARM adds in
// the future. Mirrors the pattern in `src/graph/types.ts`.
//
// All ARM PIM resources share the envelope `{ id, name, type, properties }`
// where `properties.expandedProperties` carries the human-friendly
// principal / role definition / scope display names. We model the
// fields the tool layer actually reads; everything else flows through
// thanks to `.loose()`.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Error envelope
// ---------------------------------------------------------------------------

/** ARM error response envelope. */
export interface ArmErrorEnvelope {
  error: {
    code: string;
    message: string;
  };
}

// ---------------------------------------------------------------------------
// Generic ARM list envelope
// ---------------------------------------------------------------------------

/** ARM list envelope: `{ value: T[], nextLink?: string }`. */
export const armListSchema = <T extends z.ZodType>(
  itemSchema: T,
): z.ZodObject<{ value: z.ZodArray<T>; nextLink: z.ZodOptional<z.ZodString> }> =>
  z.object({ value: z.array(itemSchema), nextLink: z.string().optional() });

// ---------------------------------------------------------------------------
// expandedProperties: principal / role definition / scope
// ---------------------------------------------------------------------------

/** Principal identity attached via `$expand`. */
export interface ArmExpandedPrincipal {
  id?: string;
  displayName?: string;
  email?: string;
  type?: string;
}

const ArmExpandedPrincipalSchema: z.ZodType<ArmExpandedPrincipal> = z
  .object({
    id: z.string().optional(),
    displayName: z.string().optional(),
    email: z.string().optional(),
    type: z.string().optional(),
  })
  .loose();

/** Role definition identity attached via `$expand`. */
export interface ArmExpandedRoleDefinition {
  id?: string;
  displayName?: string;
  type?: string;
}

const ArmExpandedRoleDefinitionSchema: z.ZodType<ArmExpandedRoleDefinition> = z
  .object({
    id: z.string().optional(),
    displayName: z.string().optional(),
    type: z.string().optional(),
  })
  .loose();

/** Scope identity attached via `$expand`. */
export interface ArmExpandedScope {
  id?: string;
  displayName?: string;
  /** ARM resource type (`subscription`, `resourcegroup`, `managementgroup`, ...). */
  type?: string;
}

const ArmExpandedScopeSchema: z.ZodType<ArmExpandedScope> = z
  .object({
    id: z.string().optional(),
    displayName: z.string().optional(),
    type: z.string().optional(),
  })
  .loose();

/** ExpandedProperties block returned with `$expand=principal,roleDefinition,scope`. */
export interface ArmExpandedProperties {
  principal?: ArmExpandedPrincipal;
  roleDefinition?: ArmExpandedRoleDefinition;
  scope?: ArmExpandedScope;
}

const ArmExpandedPropertiesSchema: z.ZodType<ArmExpandedProperties> = z
  .object({
    principal: ArmExpandedPrincipalSchema.optional(),
    roleDefinition: ArmExpandedRoleDefinitionSchema.optional(),
    scope: ArmExpandedScopeSchema.optional(),
  })
  .loose();

// ---------------------------------------------------------------------------
// ScheduleInfo (request schedule + expiration)
// ---------------------------------------------------------------------------

/** Expiration discriminator on ARM PIM payloads. */
export type ArmExpirationType = "AfterDateTime" | "AfterDuration" | "NoExpiration";

export interface ArmExpirationPattern {
  type?: ArmExpirationType;
  /** ISO-8601 duration, present when type is `AfterDuration`. */
  duration?: string | null;
  /** ISO-8601 instant, present when type is `AfterDateTime`. */
  endDateTime?: string | null;
}

const ArmExpirationPatternSchema: z.ZodType<ArmExpirationPattern> = z
  .object({
    type: z.enum(["AfterDateTime", "AfterDuration", "NoExpiration"]).optional(),
    duration: z.string().nullish(),
    endDateTime: z.string().nullish(),
  })
  .loose();

/** Schedule used in PIM activation requests. */
export interface ArmScheduleInfo {
  startDateTime?: string | null;
  expiration?: ArmExpirationPattern;
}

export const ArmScheduleInfoSchema: z.ZodType<ArmScheduleInfo> = z
  .object({
    startDateTime: z.string().nullish(),
    expiration: ArmExpirationPatternSchema.optional(),
  })
  .loose();

// ---------------------------------------------------------------------------
// RoleEligibilityScheduleInstance
// ---------------------------------------------------------------------------

/** PIM Azure-role eligibility instance (`Microsoft.Authorization/roleEligibilityScheduleInstances`). */
export interface RoleAzureEligibleAssignment {
  id: string;
  name?: string;
  type?: string;
  properties: {
    principalId: string;
    roleDefinitionId: string;
    /** ARM scope this assignment applies to (e.g. `/subscriptions/{id}`). */
    scope?: string;
    memberType?: string;
    condition?: string | null;
    startDateTime?: string | null;
    endDateTime?: string | null;
    expandedProperties?: ArmExpandedProperties;
  };
}

const ArmAssignmentPropertiesBase = {
  principalId: z.string(),
  roleDefinitionId: z.string(),
  scope: z.string().optional(),
  memberType: z.string().optional(),
  condition: z.string().nullish(),
  startDateTime: z.string().nullish(),
  endDateTime: z.string().nullish(),
  expandedProperties: ArmExpandedPropertiesSchema.optional(),
} as const;

export const RoleAzureEligibleAssignmentSchema: z.ZodType<RoleAzureEligibleAssignment> = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    type: z.string().optional(),
    properties: z.object(ArmAssignmentPropertiesBase).loose(),
  })
  .loose();

// ---------------------------------------------------------------------------
// RoleAssignmentScheduleInstance (active assignment)
// ---------------------------------------------------------------------------

/** PIM Azure-role active assignment instance. */
export interface RoleAzureActiveAssignment {
  id: string;
  name?: string;
  type?: string;
  properties: {
    principalId: string;
    principalType?: string;
    roleDefinitionId: string;
    scope?: string;
    memberType?: string;
    assignmentType?: string;
    status?: string;
    condition?: string | null;
    startDateTime?: string | null;
    endDateTime?: string | null;
    expandedProperties?: ArmExpandedProperties;
  };
}

export const RoleAzureActiveAssignmentSchema: z.ZodType<RoleAzureActiveAssignment> = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    type: z.string().optional(),
    properties: z
      .object({
        ...ArmAssignmentPropertiesBase,
        principalType: z.string().optional(),
        assignmentType: z.string().optional(),
        status: z.string().optional(),
      })
      .loose(),
  })
  .loose();

// ---------------------------------------------------------------------------
// RoleAssignmentScheduleRequest
// ---------------------------------------------------------------------------

/** PIM Azure-role assignment-schedule request (activation / deactivation). */
export interface RoleAzureAssignmentRequest {
  id: string;
  name?: string;
  type?: string;
  properties: {
    principalId: string;
    roleDefinitionId: string;
    scope?: string;
    /** `SelfActivate`, `SelfDeactivate`, etc. */
    requestType?: string;
    status?: string;
    justification?: string | null;
    condition?: string | null;
    scheduleInfo?: ArmScheduleInfo | null;
    /** Approval id (relative resource path) when an approval is required. */
    approvalId?: string | null;
    createdOn?: string | null;
    expandedProperties?: ArmExpandedProperties;
  };
}

export const RoleAzureAssignmentRequestSchema: z.ZodType<RoleAzureAssignmentRequest> = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    type: z.string().optional(),
    properties: z
      .object({
        principalId: z.string(),
        roleDefinitionId: z.string(),
        scope: z.string().optional(),
        requestType: z.string().optional(),
        status: z.string().optional(),
        justification: z.string().nullish(),
        condition: z.string().nullish(),
        scheduleInfo: ArmScheduleInfoSchema.nullish(),
        approvalId: z.string().nullish(),
        createdOn: z.string().nullish(),
        expandedProperties: ArmExpandedPropertiesSchema.optional(),
      })
      .loose(),
  })
  .loose();

// ---------------------------------------------------------------------------
// RoleManagementPolicyAssignment (max-duration lookup)
// ---------------------------------------------------------------------------

/** A single effective rule on an ARM role-management policy. */
export interface RoleManagementPolicyEffectiveRule {
  id?: string;
  /** ISO-8601 duration. */
  maximumDuration?: string;
  isExpirationRequired?: boolean;
}

const RoleManagementPolicyEffectiveRuleSchema: z.ZodType<RoleManagementPolicyEffectiveRule> = z
  .object({
    id: z.string().optional(),
    maximumDuration: z.string().optional(),
    isExpirationRequired: z.boolean().optional(),
  })
  .loose();

/** ARM role-management policy assignment (subset). */
export interface RoleManagementPolicyAssignment {
  id?: string;
  name?: string;
  type?: string;
  properties: {
    policyId?: string;
    roleDefinitionId?: string;
    scope?: string;
    effectiveRules?: RoleManagementPolicyEffectiveRule[];
  };
}

export const RoleManagementPolicyAssignmentSchema: z.ZodType<RoleManagementPolicyAssignment> = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    type: z.string().optional(),
    properties: z
      .object({
        policyId: z.string().optional(),
        roleDefinitionId: z.string().optional(),
        scope: z.string().optional(),
        effectiveRules: z.array(RoleManagementPolicyEffectiveRuleSchema).optional(),
      })
      .loose(),
  })
  .loose();

// ---------------------------------------------------------------------------
// /batch envelope (used by the approval review path)
// ---------------------------------------------------------------------------

/** A single ARM batch response entry. */
export interface ArmBatchResponse {
  name?: string;
  httpStatusCode: number;
  contentLength?: number;
  headers?: Record<string, string>;
  content?: unknown;
}

const ArmBatchResponseSchema: z.ZodType<ArmBatchResponse> = z
  .object({
    name: z.string().optional(),
    httpStatusCode: z.number(),
    contentLength: z.number().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    content: z.unknown().optional(),
  })
  .loose();

/** ARM batch responses envelope. */
export interface ArmBatchResponses {
  responses: ArmBatchResponse[];
}

export const ArmBatchResponsesSchema: z.ZodType<ArmBatchResponses> = z
  .object({
    responses: z.array(ArmBatchResponseSchema),
  })
  .loose();
