// Schema regression tests: Microsoft Graph returns `scheduleInfo` and
// `targetScheduleId` as explicit `null` for selfDeactivate assignment-schedule
// requests, so these fields must accept null (not just undefined).

import { describe, it, expect } from "vitest";

import {
  AssignmentApprovalSchema,
  GroupAssignmentRequestSchema,
  RoleEntraAssignmentRequestSchema,
} from "../../src/graph/types.js";

describe("graph/types selfDeactivate response schemas", () => {
  it("RoleEntraAssignmentRequestSchema parses a 201 with null scheduleInfo and targetScheduleId", () => {
    const payload = {
      id: "req-1",
      roleDefinitionId: "role-1",
      principalId: "me",
      directoryScopeId: "/",
      action: "selfDeactivate",
      status: "Revoked",
      justification: "done",
      scheduleInfo: null,
      targetScheduleId: null,
      createdDateTime: "2026-01-01T00:00:00Z",
      completedDateTime: "2026-01-01T00:00:00Z",
    };
    const parsed = RoleEntraAssignmentRequestSchema.parse(payload);
    expect(parsed.scheduleInfo).toBeNull();
    expect(parsed.targetScheduleId).toBeNull();
  });

  it("GroupAssignmentRequestSchema parses a 201 with null scheduleInfo", () => {
    const payload = {
      id: "req-1",
      groupId: "group-1",
      principalId: "me",
      action: "selfDeactivate",
      status: "Revoked",
      justification: "done",
      scheduleInfo: null,
      createdDateTime: "2026-01-01T00:00:00Z",
      completedDateTime: "2026-01-01T00:00:00Z",
    };
    const parsed = GroupAssignmentRequestSchema.parse(payload);
    expect(parsed.scheduleInfo).toBeNull();
  });
});

// Microsoft Graph returns `reviewedBy` as explicit `null` on approval
// stages that have not yet been actioned (the common case when the
// approver opens the review page). The schema must therefore accept
// null in addition to undefined / a populated reviewer object.
describe("AssignmentApprovalSchema unactioned-stage tolerance", () => {
  it("parses a stage whose reviewedBy is explicit null", () => {
    const payload = {
      id: "approval-1",
      stages: [
        {
          id: "stage-1",
          assignedToMe: true,
          reviewResult: "NotReviewed",
          status: "InProgress",
          justification: null,
          reviewedBy: null,
          reviewedDateTime: null,
        },
      ],
    };
    const parsed = AssignmentApprovalSchema.parse(payload);
    expect(parsed.stages[0]?.reviewedBy).toBeNull();
  });
});
