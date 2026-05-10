// Unit tests for OAuthScope/Resource enums, scope definitions, and helpers.

import { describe, it, expect } from "vitest";
import {
  OAuthScope,
  Resource,
  AVAILABLE_SCOPES,
  ALWAYS_REQUIRED_SCOPES,
  defaultScopes,
  isOAuthScope,
  resourceForScope,
  scopesForResource,
  toOAuthScopes,
} from "../src/scopes.js";

describe("OAuthScope enum", () => {
  it("has expected Graph PIM scope values", () => {
    expect(OAuthScope.UserRead).toBe("User.Read");
    expect(OAuthScope.OfflineAccess).toBe("offline_access");
    expect(OAuthScope.PrivilegedAccessReadWriteAzureADGroup).toBe(
      "PrivilegedAccess.ReadWrite.AzureADGroup",
    );
    expect(OAuthScope.RoleManagementReadWriteDirectory).toBe("RoleManagement.ReadWrite.Directory");
  });

  it("has the ARM user_impersonation scope", () => {
    expect(OAuthScope.ArmUserImpersonation).toBe("https://management.azure.com/user_impersonation");
  });
});

describe("AVAILABLE_SCOPES", () => {
  it("contains every OAuthScope enum value", () => {
    const scopeValues = AVAILABLE_SCOPES.map((s) => s.scope);
    for (const val of Object.values(OAuthScope)) {
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
    expect(requiredScopes).toContain(OAuthScope.UserRead);
    expect(requiredScopes).toContain(OAuthScope.OfflineAccess);
  });

  it("marks PIM scopes (graph + ARM) as not required", () => {
    const optional = AVAILABLE_SCOPES.filter((s) => !s.required).map((s) => s.scope);
    expect(optional).toContain(OAuthScope.PrivilegedAccessReadWriteAzureADGroup);
    expect(optional).toContain(OAuthScope.RoleManagementReadWriteDirectory);
    expect(optional).toContain(OAuthScope.ArmUserImpersonation);
  });
});

describe("ALWAYS_REQUIRED_SCOPES", () => {
  it("contains User.Read and offline_access", () => {
    expect(ALWAYS_REQUIRED_SCOPES).toContain(OAuthScope.UserRead);
    expect(ALWAYS_REQUIRED_SCOPES).toContain(OAuthScope.OfflineAccess);
  });

  it("does not contain optional PIM scopes", () => {
    expect(ALWAYS_REQUIRED_SCOPES).not.toContain(OAuthScope.PrivilegedAccessReadWriteAzureADGroup);
    expect(ALWAYS_REQUIRED_SCOPES).not.toContain(OAuthScope.ArmUserImpersonation);
  });
});

describe("defaultScopes", () => {
  it("returns all scopes", () => {
    const result = defaultScopes();
    for (const val of Object.values(OAuthScope)) {
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

describe("isOAuthScope", () => {
  it("returns true for valid scope strings", () => {
    expect(isOAuthScope("User.Read")).toBe(true);
    expect(isOAuthScope("offline_access")).toBe(true);
    expect(isOAuthScope("PrivilegedAccess.ReadWrite.AzureADGroup")).toBe(true);
    expect(isOAuthScope("https://management.azure.com/user_impersonation")).toBe(true);
  });

  it("returns false for invalid strings", () => {
    expect(isOAuthScope("Mail.Read")).toBe(false);
    expect(isOAuthScope("Tasks.ReadWrite")).toBe(false);
    expect(isOAuthScope("")).toBe(false);
    expect(isOAuthScope("user.read")).toBe(false);
    expect(isOAuthScope("USER.READ")).toBe(false);
  });
});

describe("toOAuthScopes", () => {
  it("filters valid scopes from a mixed array", () => {
    const result = toOAuthScopes([
      "User.Read",
      "invalid",
      "PrivilegedAccess.ReadWrite.AzureADGroup",
      "",
      "https://management.azure.com/user_impersonation",
    ]);
    expect(result).toEqual([
      OAuthScope.UserRead,
      OAuthScope.PrivilegedAccessReadWriteAzureADGroup,
      OAuthScope.ArmUserImpersonation,
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(toOAuthScopes([])).toEqual([]);
  });

  it("preserves all valid scopes", () => {
    const all = Object.values(OAuthScope);
    expect(toOAuthScopes(all)).toEqual(all);
  });
});

describe("resourceForScope", () => {
  it("maps the ARM scope to Resource.Arm", () => {
    expect(resourceForScope(OAuthScope.ArmUserImpersonation)).toBe(Resource.Arm);
  });

  it("maps every other scope to Resource.Graph", () => {
    for (const s of Object.values(OAuthScope)) {
      if (s === OAuthScope.ArmUserImpersonation) continue;
      expect(resourceForScope(s)).toBe(Resource.Graph);
    }
  });
});

describe("scopesForResource", () => {
  const all = Object.values(OAuthScope);

  it("returns only Graph scopes for Resource.Graph", () => {
    const graph = scopesForResource(all, Resource.Graph);
    expect(graph).not.toContain(OAuthScope.ArmUserImpersonation);
    expect(graph).toContain(OAuthScope.UserRead);
    expect(graph).toContain(OAuthScope.PrivilegedAccessReadWriteAzureADGroup);
  });

  it("returns only ARM scopes for Resource.Arm", () => {
    expect(scopesForResource(all, Resource.Arm)).toEqual([OAuthScope.ArmUserImpersonation]);
  });

  it("returns [] when no scopes match", () => {
    expect(scopesForResource([OAuthScope.UserRead], Resource.Arm)).toEqual([]);
  });
});
