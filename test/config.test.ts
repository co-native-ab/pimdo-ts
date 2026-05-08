// Unit tests for `src/config.ts`.
//
// `configDir` resolves an XDG-style cache directory with platform-specific
// fallbacks; `migrateConfig` is a forward-compatible no-op stub. Both are
// pure / nearly-pure functions, so we cover the platform branches by
// stubbing `os.platform` / `os.homedir` and toggling the relevant env vars.

import { describe, it, expect, vi, afterEach } from "vitest";
import * as path from "node:path";

import { ConfigMigrationStatus, configDir, migrateConfig } from "../src/config.js";

// `os.platform` / `os.homedir` cannot be spy'd directly under ESM, so we
// `vi.mock` the module and provide controllable stubs. The `mockOs` handle
// is reset per test to keep cases independent.
const mockOs = vi.hoisted(() => ({
  platform: vi.fn<() => NodeJS.Platform>(() => "linux"),
  homedir: vi.fn<() => string>(() => "/home/jdoe"),
}));

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, ...mockOs };
});

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  mockOs.platform.mockReset().mockReturnValue("linux");
  mockOs.homedir.mockReset().mockReturnValue("/home/jdoe");
  process.env = { ...ORIGINAL_ENV };
});

describe("configDir", () => {
  it("returns a resolved override when one is provided", () => {
    expect(configDir("./relative/path")).toBe(path.resolve("./relative/path"));
    expect(configDir("/abs/path")).toBe("/abs/path");
  });

  it("uses %APPDATA%/pimdo-ts on win32 when APPDATA is set", () => {
    mockOs.platform.mockReturnValue("win32");
    mockOs.homedir.mockReturnValue("C:\\Users\\jdoe");
    process.env["APPDATA"] = "C:\\Users\\jdoe\\AppData\\Roaming";
    expect(configDir()).toBe(path.join("C:\\Users\\jdoe\\AppData\\Roaming", "pimdo-ts"));
  });

  it("falls back to <home>/AppData/Roaming/pimdo-ts on win32 without APPDATA", () => {
    mockOs.platform.mockReturnValue("win32");
    mockOs.homedir.mockReturnValue("C:\\Users\\jdoe");
    delete process.env["APPDATA"];
    expect(configDir()).toBe(path.join("C:\\Users\\jdoe", "AppData", "Roaming", "pimdo-ts"));
  });

  it("uses ~/Library/Application Support/pimdo-ts on darwin", () => {
    mockOs.platform.mockReturnValue("darwin");
    mockOs.homedir.mockReturnValue("/Users/jdoe");
    expect(configDir()).toBe(
      path.join("/Users/jdoe", "Library", "Application Support", "pimdo-ts"),
    );
  });

  it("uses $XDG_CONFIG_HOME/pimdo-ts on linux when XDG_CONFIG_HOME is set", () => {
    mockOs.platform.mockReturnValue("linux");
    mockOs.homedir.mockReturnValue("/home/jdoe");
    process.env["XDG_CONFIG_HOME"] = "/tmp/xdg";
    expect(configDir()).toBe(path.join("/tmp/xdg", "pimdo-ts"));
  });

  it("falls back to ~/.config/pimdo-ts on linux without XDG_CONFIG_HOME", () => {
    mockOs.platform.mockReturnValue("linux");
    mockOs.homedir.mockReturnValue("/home/jdoe");
    delete process.env["XDG_CONFIG_HOME"];
    expect(configDir()).toBe(path.join("/home/jdoe", ".config", "pimdo-ts"));
  });
});

describe("migrateConfig", () => {
  it("resolves with NoChange (forward-compatible no-op)", async () => {
    const ac = new AbortController();
    await expect(migrateConfig("/tmp/anywhere", ac.signal)).resolves.toBe(
      ConfigMigrationStatus.NoChange,
    );
  });
});
