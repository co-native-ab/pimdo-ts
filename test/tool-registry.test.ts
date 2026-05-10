// Unit tests for tool registry: syncToolState, buildInstructions, registerTool.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { OAuthScope } from "../src/scopes.js";
import {
  syncToolState,
  buildInstructions,
  type ToolDef,
  type ToolEntry,
} from "../src/tool-registry.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fake ToolEntry with a mock RegisteredTool. */
function fakeEntry(name: string, requiredScopes: OAuthScope[][], enabled = true): ToolEntry {
  return {
    name,
    title: `Title: ${name}`,
    description: `Description for ${name}`,
    requiredScopes,
    registeredTool: {
      enabled,
      enable: vi.fn(function (this: { enabled: boolean }) {
        this.enabled = true;
      }),
      disable: vi.fn(function (this: { enabled: boolean }) {
        this.enabled = false;
      }),
    } as unknown as ToolEntry["registeredTool"],
  };
}

/** Create a fake McpServer with a mock sendToolListChanged. */
function fakeServer() {
  return { sendToolListChanged: vi.fn() } as unknown as Parameters<typeof syncToolState>[2];
}

// ---------------------------------------------------------------------------
// syncToolState
// ---------------------------------------------------------------------------

describe("syncToolState", () => {
  let entries: ToolEntry[];
  let server: ReturnType<typeof fakeServer>;

  beforeEach(() => {
    entries = [
      fakeEntry("login", [], true), // always enabled
      fakeEntry("auth_status", [], true), // always enabled
      fakeEntry("logout", [[OAuthScope.UserRead]], false),
      fakeEntry("pim_group_request", [[OAuthScope.PrivilegedAccessReadWriteAzureADGroup]], false),
      fakeEntry(
        "pim_role_entra_eligible_list",
        [[OAuthScope.RoleManagementReadWriteDirectory]],
        false,
      ),
      fakeEntry(
        "pim_role_entra_active_list",
        [[OAuthScope.RoleManagementReadWriteDirectory]],
        false,
      ),
      // Read tool that accepts EITHER Read or ReadWrite (DNF: two
      // single-scope alternatives). Mirrors pim_role_entra_eligible_list.
      fakeEntry(
        "pim_role_entra_eligible_list_disjunctive",
        [
          [OAuthScope.RoleEligibilityScheduleReadDirectory],
          [OAuthScope.RoleEligibilityScheduleReadWriteDirectory],
        ],
        false,
      ),
      // Mutation tool that requires BOTH scopes (DNF: one alternative
      // with two scopes). Mirrors pim_role_entra_deactivate.
      fakeEntry(
        "pim_role_entra_deactivate",
        [
          [
            OAuthScope.RoleManagementReadWriteDirectory,
            OAuthScope.RoleAssignmentScheduleReadWriteDirectory,
          ],
        ],
        false,
      ),
    ];
    server = fakeServer();
  });

  it("enables all tools when all scopes are granted", () => {
    const scopes = [
      OAuthScope.UserRead,
      OAuthScope.PrivilegedAccessReadWriteAzureADGroup,
      OAuthScope.RoleManagementReadWriteDirectory,
      OAuthScope.RoleAssignmentScheduleReadWriteDirectory,
      OAuthScope.RoleEligibilityScheduleReadDirectory,
    ];
    syncToolState(entries, scopes, server);

    for (const entry of entries) {
      expect(entry.registeredTool.enabled).toBe(true);
    }
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(server.sendToolListChanged).toHaveBeenCalledOnce();
  });

  it("enables always-enabled tools even with empty scopes", () => {
    syncToolState(entries, [], server);

    expect(entries[0]!.registeredTool.enabled).toBe(true); // login
    expect(entries[1]!.registeredTool.enabled).toBe(true); // auth_status
    expect(entries[2]!.registeredTool.enabled).toBe(false); // logout
    expect(entries[3]!.registeredTool.enabled).toBe(false); // pim_group_request
    expect(entries[4]!.registeredTool.enabled).toBe(false); // pim_role_entra_eligible_list
    expect(entries[5]!.registeredTool.enabled).toBe(false); // pim_role_entra_active_list
    expect(entries[6]!.registeredTool.enabled).toBe(false); // disjunctive
    expect(entries[7]!.registeredTool.enabled).toBe(false); // pim_role_entra_deactivate
  });

  it("enables PrivilegedAccess.ReadWrite.AzureADGroup tools only when group-PIM scope granted", () => {
    syncToolState(entries, [OAuthScope.PrivilegedAccessReadWriteAzureADGroup], server);

    expect(entries[3]!.registeredTool.enabled).toBe(true); // pim_group_request
    expect(entries[4]!.registeredTool.enabled).toBe(false);
    expect(entries[5]!.registeredTool.enabled).toBe(false);
  });

  it("RoleManagement.ReadWrite.Directory enables both read and write tools", () => {
    syncToolState(entries, [OAuthScope.RoleManagementReadWriteDirectory], server);

    expect(entries[4]!.registeredTool.enabled).toBe(true); // pim_role_entra_eligible_list
    expect(entries[5]!.registeredTool.enabled).toBe(true); // pim_role_entra_active_list
  });

  it("disjunctive tool enables when EITHER alternative is granted (Read or ReadWrite)", () => {
    // Read variant
    syncToolState(entries, [OAuthScope.RoleEligibilityScheduleReadDirectory], server);
    expect(entries[6]!.registeredTool.enabled).toBe(true);

    // ReadWrite variant — must also enable on its own (mirrors a tenant
    // downgrade keeping the read tool visible).
    entries[6]!.registeredTool.enabled = false;
    syncToolState(entries, [OAuthScope.RoleEligibilityScheduleReadWriteDirectory], server);
    expect(entries[6]!.registeredTool.enabled).toBe(true);

    // Neither — disabled.
    entries[6]!.registeredTool.enabled = true;
    syncToolState(entries, [OAuthScope.UserRead], server);
    expect(entries[6]!.registeredTool.enabled).toBe(false);
  });

  it("conjunctive tool enables only when ALL scopes in the alternative are granted", () => {
    // Only one of two scopes — must stay disabled.
    syncToolState(entries, [OAuthScope.RoleManagementReadWriteDirectory], server);
    expect(entries[7]!.registeredTool.enabled).toBe(false);

    // Other scope alone — also disabled.
    syncToolState(entries, [OAuthScope.RoleAssignmentScheduleReadWriteDirectory], server);
    expect(entries[7]!.registeredTool.enabled).toBe(false);

    // Both — enabled.
    syncToolState(
      entries,
      [
        OAuthScope.RoleManagementReadWriteDirectory,
        OAuthScope.RoleAssignmentScheduleReadWriteDirectory,
      ],
      server,
    );
    expect(entries[7]!.registeredTool.enabled).toBe(true);
  });

  it("does not call enable/disable on tools already in correct state", () => {
    // login is already enabled, should not call enable() again
    entries[0]!.registeredTool.enabled = true;
    syncToolState(entries, [], server);

    /* eslint-disable @typescript-eslint/unbound-method */
    expect(entries[0]!.registeredTool.enable).not.toHaveBeenCalled();
    expect(entries[0]!.registeredTool.disable).not.toHaveBeenCalled();
    /* eslint-enable @typescript-eslint/unbound-method */
  });

  it("disables previously enabled scope-gated tools when scopes are removed", () => {
    // Start with mail_send enabled
    entries[3]!.registeredTool.enabled = true;
    syncToolState(entries, [], server); // no scopes

    expect(entries[3]!.registeredTool.enabled).toBe(false);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(entries[3]!.registeredTool.disable).toHaveBeenCalled();
  });

  it("calls sendToolListChanged exactly once per sync", () => {
    syncToolState(
      entries,
      [
        OAuthScope.PrivilegedAccessReadWriteAzureADGroup,
        OAuthScope.RoleManagementReadWriteDirectory,
      ],
      server,
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(server.sendToolListChanged).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// buildInstructions
// ---------------------------------------------------------------------------

describe("buildInstructions", () => {
  const defs: ToolDef[] = [
    { name: "login", title: "Login", description: "Sign in to Microsoft", requiredScopes: [] },
    {
      name: "auth_status",
      title: "Auth Status",
      description: "Check auth state",
      requiredScopes: [],
    },
    {
      name: "pim_role_entra_request",
      title: "Send Email",
      description: "Send an email",
      requiredScopes: [[OAuthScope.PrivilegedAccessReadWriteAzureADGroup]],
    },
    {
      name: "pim_role_entra_eligible_list",
      title: "List Tasks",
      description: "List todo items",
      requiredScopes: [[OAuthScope.RoleManagementReadWriteDirectory]],
    },
    {
      name: "pim_role_entra_active_list",
      title: "Create Task",
      description: "Create a todo",
      requiredScopes: [[OAuthScope.RoleManagementReadWriteDirectory]],
    },
    {
      name: "pim_role_entra_eligible_list_disjunctive",
      title: "Eligible (read or read-write)",
      description: "Read eligibilities — accepts Read or ReadWrite",
      requiredScopes: [
        [OAuthScope.RoleEligibilityScheduleReadDirectory],
        [OAuthScope.RoleEligibilityScheduleReadWriteDirectory],
      ],
    },
    {
      name: "pim_role_entra_deactivate",
      title: "Deactivate",
      description: "Deactivate a role assignment",
      requiredScopes: [
        [
          OAuthScope.RoleAssignmentScheduleReadWriteDirectory,
          OAuthScope.RoleManagementReadWriteDirectory,
        ],
      ],
    },
  ];

  it("includes all tool names", () => {
    const text = buildInstructions(defs);
    for (const def of defs) {
      expect(text).toContain(def.name);
    }
  });

  it("includes all tool descriptions", () => {
    const text = buildInstructions(defs);
    for (const def of defs) {
      expect(text).toContain(def.description);
    }
  });

  it("groups always-available tools separately", () => {
    const text = buildInstructions(defs);
    expect(text).toContain("ALWAYS AVAILABLE:");
    // login and auth_status should be in the always-available section
    const alwaysSection = text.split("SCOPE-GATED")[0]!;
    expect(alwaysSection).toContain("login");
    expect(alwaysSection).toContain("auth_status");
  });

  it("groups scope-gated tools by scope", () => {
    const text = buildInstructions(defs);
    expect(text).toContain("SCOPE-GATED TOOLS:");
    expect(text).toContain("PrivilegedAccess.ReadWrite.AzureADGroup");
    expect(text).toContain("RoleManagement.ReadWrite.Directory");
  });

  it("renders disjunctive alternatives with OR and conjunctive ones with AND", () => {
    const text = buildInstructions(defs);
    // Disjunctive tool ("Read OR ReadWrite")
    expect(text).toContain("RoleEligibilitySchedule.Read.Directory");
    expect(text).toContain("RoleEligibilitySchedule.ReadWrite.Directory");
    expect(text).toMatch(/Read\.Directory.*OR.*ReadWrite\.Directory/);
    // Conjunctive tool ("RoleAssignmentSchedule … AND RoleManagement …")
    expect(text).toMatch(/RoleAssignmentSchedule\.ReadWrite\.Directory AND/);
  });

  it("includes behavior rules", () => {
    const text = buildInstructions(defs);
    expect(text).toContain("IMPORTANT BEHAVIOR RULES:");
    expect(text).toContain("authentication error");
    expect(text).toContain("login");
  });

  it("includes workflow guidance", () => {
    const text = buildInstructions(defs);
    expect(text).toContain("WORKFLOW:");
    expect(text).toContain("login");
  });

  it("mentions dynamic scope-based discovery", () => {
    const text = buildInstructions(defs);
    expect(text).toContain("dynamically enabled");
    expect(text).toContain("OAuth scopes");
  });
});
