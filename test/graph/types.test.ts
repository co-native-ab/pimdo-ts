// Schema regression tests: Microsoft Graph returns `scheduleInfo` and
// `targetScheduleId` as explicit `null` for selfDeactivate assignment-schedule
// requests, so these fields must accept null (not just undefined).

import { describe, it, expect } from "vitest";

import {
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
