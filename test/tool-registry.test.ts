// Unit tests for tool registry: syncToolState, buildInstructions, registerTool.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { GraphScope } from "../src/scopes.js";
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
function fakeEntry(name: string, requiredScopes: GraphScope[], enabled = true): ToolEntry {
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
      fakeEntry("logout", [GraphScope.UserRead], false),
      fakeEntry("pim_group_request", [GraphScope.PrivilegedAccessReadWriteAzureADGroup], false),
      fakeEntry(
        "pim_role_entra_eligible_list",
        [GraphScope.RoleManagementReadWriteDirectory],
        false,
      ),
      fakeEntry("pim_role_entra_active_list", [GraphScope.RoleManagementReadWriteDirectory], false),
    ];
    server = fakeServer();
  });

  it("enables all tools when all scopes are granted", () => {
    const scopes = [
      GraphScope.UserRead,
      GraphScope.PrivilegedAccessReadWriteAzureADGroup,
      GraphScope.RoleManagementReadWriteDirectory,
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
    expect(entries[3]!.registeredTool.enabled).toBe(false); // mail_send
    expect(entries[4]!.registeredTool.enabled).toBe(false); // todo_list
    expect(entries[5]!.registeredTool.enabled).toBe(false); // todo_create
  });

  it("enables PrivilegedAccess.ReadWrite.AzureADGroup tools only when group-PIM scope granted", () => {
    syncToolState(entries, [GraphScope.PrivilegedAccessReadWriteAzureADGroup], server);

    expect(entries[3]!.registeredTool.enabled).toBe(true); // mail_send
    expect(entries[4]!.registeredTool.enabled).toBe(false); // todo_list
    expect(entries[5]!.registeredTool.enabled).toBe(false); // todo_create
  });

  it("RoleManagement.ReadWrite.Directory enables both read and write tools", () => {
    syncToolState(entries, [GraphScope.RoleManagementReadWriteDirectory], server);

    expect(entries[4]!.registeredTool.enabled).toBe(true); // todo_list
    expect(entries[5]!.registeredTool.enabled).toBe(true); // todo_create
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
        GraphScope.PrivilegedAccessReadWriteAzureADGroup,
        GraphScope.RoleManagementReadWriteDirectory,
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
      requiredScopes: [GraphScope.PrivilegedAccessReadWriteAzureADGroup],
    },
    {
      name: "pim_role_entra_eligible_list",
      title: "List Tasks",
      description: "List todo items",
      requiredScopes: [GraphScope.RoleManagementReadWriteDirectory],
    },
    {
      name: "pim_role_entra_active_list",
      title: "Create Task",
      description: "Create a todo",
      requiredScopes: [GraphScope.RoleManagementReadWriteDirectory],
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
