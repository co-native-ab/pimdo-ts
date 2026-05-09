// Tests for validateApiBaseUrl — the startup gate that prevents
// PIMDO_*_URL env vars from leaking Bearer tokens over plaintext.

import { describe, it, expect } from "vitest";

import { validateApiBaseUrl } from "../src/index.js";

describe("validateApiBaseUrl", () => {
  it("accepts https:// URLs", () => {
    expect(() =>
      validateApiBaseUrl("PIMDO_GRAPH_URL", "https://graph.microsoft.com/v1.0"),
    ).not.toThrow();
    expect(() => validateApiBaseUrl("PIMDO_ARM_URL", "https://management.azure.com")).not.toThrow();
  });

  it("accepts http:// URLs only for loopback hosts", () => {
    expect(() => validateApiBaseUrl("X", "http://localhost:3000")).not.toThrow();
    expect(() => validateApiBaseUrl("X", "http://127.0.0.1:3000")).not.toThrow();
  });

  it("rejects http:// URLs to non-loopback hosts", () => {
    expect(() => validateApiBaseUrl("PIMDO_GRAPH_URL", "http://attacker.example.com")).toThrow(
      /plain http:\/\/ is only allowed for localhost/,
    );
  });

  it("rejects unsupported protocols", () => {
    expect(() => validateApiBaseUrl("X", "file:///etc/passwd")).toThrow(/unsupported protocol/);
    expect(() => validateApiBaseUrl("X", "javascript:alert(1)")).toThrow(/unsupported protocol/);
  });

  it("rejects malformed URLs", () => {
    expect(() => validateApiBaseUrl("X", "not-a-url")).toThrow(/not a valid absolute URL/);
    expect(() => validateApiBaseUrl("X", "")).toThrow(/not a valid absolute URL/);
  });

  it("includes the env var name in the error", () => {
    expect(() => validateApiBaseUrl("PIMDO_ARM_URL", "ftp://x")).toThrow(/PIMDO_ARM_URL/);
  });
});
