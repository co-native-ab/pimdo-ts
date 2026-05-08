// Smoke test for the `src/browser/index.ts` barrel re-export module.
// Just ensures every advertised public symbol is importable via the
// barrel — keeping the module honest as the underlying files evolve.

import { describe, it, expect } from "vitest";

import * as barrel from "../../src/browser/index.js";

describe("browser/index.ts barrel", () => {
  it("re-exports the documented public API", () => {
    const expected = [
      "openBrowser",
      "buildLoopbackCsp",
      "generateRandomToken",
      "validateLoopbackPostHeaders",
      "verifyCsrfToken",
      "runBrowserFlow",
      "readJsonWithCsrf",
      "respondAndClose",
      "loginFlow",
      "createMsalLoopback",
      "logoutFlow",
      "showLogoutConfirmation",
    ] as const;

    for (const name of expected) {
      expect(barrel).toHaveProperty(name);
      expect(typeof (barrel as Record<string, unknown>)[name]).toBe("function");
    }
  });
});
