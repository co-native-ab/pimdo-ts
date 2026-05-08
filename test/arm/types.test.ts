// Schema regression test: Azure Resource Manager returns `scheduleInfo` as
// explicit `null` for SelfDeactivate role-assignment-schedule requests, so the
// field must accept null (not just undefined).

import { describe, it, expect } from "vitest";

import { RoleAzureAssignmentRequestSchema } from "../../src/arm/types.js";

describe("arm/types SelfDeactivate response schema", () => {
  it("RoleAzureAssignmentRequestSchema parses a response with null scheduleInfo", () => {
    const payload = {
      id: "/subscriptions/x/providers/Microsoft.Authorization/roleAssignmentScheduleRequests/req-1",
      name: "req-1",
      type: "Microsoft.Authorization/RoleAssignmentScheduleRequests",
      properties: {
        principalId: "me",
        roleDefinitionId: "/subscriptions/x/providers/Microsoft.Authorization/roleDefinitions/r1",
        scope: "/subscriptions/x",
        requestType: "SelfDeactivate",
        status: "Revoked",
        justification: "done",
        scheduleInfo: null,
        createdOn: "2026-01-01T00:00:00Z",
      },
    };
    const parsed = RoleAzureAssignmentRequestSchema.parse(payload);
    expect(parsed.properties.scheduleInfo).toBeNull();
  });
});
