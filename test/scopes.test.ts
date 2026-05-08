// Unit tests for GraphScope/Resource enums, scope definitions, and helpers.

import { describe, it, expect } from "vitest";
import {
  GraphScope,
  Resource,
  AVAILABLE_SCOPES,
  ALWAYS_REQUIRED_SCOPES,
  defaultScopes,
  isGraphScope,
  resourceForScope,
  scopesForResource,
  toGraphScopes,
} from "../src/scopes.js";

describe("GraphScope enum", () => {
  it("has expected Graph PIM scope values", () => {
    expect(GraphScope.UserRead).toBe("User.Read");
    expect(GraphScope.OfflineAccess).toBe("offline_access");
    expect(GraphScope.PrivilegedAccessReadWriteAzureADGroup).toBe(
      "PrivilegedAccess.ReadWrite.AzureADGroup",
    );
    expect(GraphScope.RoleManagementReadWriteDirectory).toBe("RoleManagement.ReadWrite.Directory");
  });

  it("has the ARM user_impersonation scope", () => {
    expect(GraphScope.ArmUserImpersonation).toBe("https://management.azure.com/user_impersonation");
  });
});

describe("AVAILABLE_SCOPES", () => {
  it("contains every GraphScope enum value", () => {
    const scopeValues = AVAILABLE_SCOPES.map((s) => s.scope);
    for (const val of Object.values(GraphScope)) {
      expect(scopeValues).toContain(val);
    }
  });

  it("every definition has a label and description", () => {
    for (const def of AVAILABLE_SCOPES) {
      expect(def.label).toBeTruthy();
      expect(def.description).toBeTruthy();
    }
  });

  it("marks User.Read and offline_access as required", () => {
    const requiredScopes = AVAILABLE_SCOPES.filter((s) => s.required).map((s) => s.scope);
    expect(requiredScopes).toContain(GraphScope.UserRead);
    expect(requiredScopes).toContain(GraphScope.OfflineAccess);
  });

  it("marks PIM scopes (graph + ARM) as not required", () => {
    const optional = AVAILABLE_SCOPES.filter((s) => !s.required).map((s) => s.scope);
    expect(optional).toContain(GraphScope.PrivilegedAccessReadWriteAzureADGroup);
    expect(optional).toContain(GraphScope.RoleManagementReadWriteDirectory);
    expect(optional).toContain(GraphScope.ArmUserImpersonation);
  });
});

describe("ALWAYS_REQUIRED_SCOPES", () => {
  it("contains User.Read and offline_access", () => {
    expect(ALWAYS_REQUIRED_SCOPES).toContain(GraphScope.UserRead);
    expect(ALWAYS_REQUIRED_SCOPES).toContain(GraphScope.OfflineAccess);
  });

  it("does not contain optional PIM scopes", () => {
    expect(ALWAYS_REQUIRED_SCOPES).not.toContain(GraphScope.PrivilegedAccessReadWriteAzureADGroup);
    expect(ALWAYS_REQUIRED_SCOPES).not.toContain(GraphScope.ArmUserImpersonation);
  });
});

describe("defaultScopes", () => {
  it("returns all scopes", () => {
    const result = defaultScopes();
    for (const val of Object.values(GraphScope)) {
      expect(result).toContain(val);
    }
  });

  it("returns a new array each time", () => {
    const a = defaultScopes();
    const b = defaultScopes();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe("isGraphScope", () => {
  it("returns true for valid scope strings", () => {
    expect(isGraphScope("User.Read")).toBe(true);
    expect(isGraphScope("offline_access")).toBe(true);
    expect(isGraphScope("PrivilegedAccess.ReadWrite.AzureADGroup")).toBe(true);
    expect(isGraphScope("https://management.azure.com/user_impersonation")).toBe(true);
  });

  it("returns false for invalid strings", () => {
    expect(isGraphScope("Mail.Read")).toBe(false);
    expect(isGraphScope("Tasks.ReadWrite")).toBe(false);
    expect(isGraphScope("")).toBe(false);
    expect(isGraphScope("user.read")).toBe(false);
    expect(isGraphScope("USER.READ")).toBe(false);
  });
});

describe("toGraphScopes", () => {
  it("filters valid scopes from a mixed array", () => {
    const result = toGraphScopes([
      "User.Read",
      "invalid",
      "PrivilegedAccess.ReadWrite.AzureADGroup",
      "",
      "https://management.azure.com/user_impersonation",
    ]);
    expect(result).toEqual([
      GraphScope.UserRead,
      GraphScope.PrivilegedAccessReadWriteAzureADGroup,
      GraphScope.ArmUserImpersonation,
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(toGraphScopes([])).toEqual([]);
  });

  it("preserves all valid scopes", () => {
    const all = Object.values(GraphScope);
    expect(toGraphScopes(all)).toEqual(all);
  });
});

describe("resourceForScope", () => {
  it("maps the ARM scope to Resource.Arm", () => {
    expect(resourceForScope(GraphScope.ArmUserImpersonation)).toBe(Resource.Arm);
  });

  it("maps every other scope to Resource.Graph", () => {
    for (const s of Object.values(GraphScope)) {
      if (s === GraphScope.ArmUserImpersonation) continue;
      expect(resourceForScope(s)).toBe(Resource.Graph);
    }
  });
});

describe("scopesForResource", () => {
  const all = Object.values(GraphScope);

  it("returns only Graph scopes for Resource.Graph", () => {
    const graph = scopesForResource(all, Resource.Graph);
    expect(graph).not.toContain(GraphScope.ArmUserImpersonation);
    expect(graph).toContain(GraphScope.UserRead);
    expect(graph).toContain(GraphScope.PrivilegedAccessReadWriteAzureADGroup);
  });

  it("returns only ARM scopes for Resource.Arm", () => {
    expect(scopesForResource(all, Resource.Arm)).toEqual([GraphScope.ArmUserImpersonation]);
  });

  it("returns [] when no scopes match", () => {
    expect(scopesForResource([GraphScope.UserRead], Resource.Arm)).toEqual([]);
  });
});
