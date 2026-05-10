// Tests for validateApiBaseUrl and resolveStaticToken — the startup
// gates that prevent PIMDO_*_URL env vars from leaking Bearer tokens
// over plaintext or to arbitrary hosts, and prevent PIMDO_ACCESS_TOKEN
// from silently swapping the MSAL login flow.

import { describe, it, expect } from "vitest";

import { resolveStaticToken, validateApiBaseUrl } from "../src/index.js";

describe("validateApiBaseUrl", () => {
  it("accepts https:// URLs to allow-listed Microsoft hosts", () => {
    expect(() =>
      validateApiBaseUrl("PIMDO_GRAPH_URL", "https://graph.microsoft.com/v1.0"),
    ).not.toThrow();
    expect(() => validateApiBaseUrl("PIMDO_ARM_URL", "https://management.azure.com")).not.toThrow();
  });

  it("accepts https:// URLs to sovereign-cloud Microsoft hosts", () => {
    expect(() => validateApiBaseUrl("X", "https://graph.microsoft.us/v1.0")).not.toThrow();
    expect(() => validateApiBaseUrl("X", "https://dod-graph.microsoft.us/v1.0")).not.toThrow();
    expect(() =>
      validateApiBaseUrl("X", "https://microsoftgraph.chinacloudapi.cn/v1.0"),
    ).not.toThrow();
    expect(() => validateApiBaseUrl("X", "https://management.usgovcloudapi.net")).not.toThrow();
    expect(() => validateApiBaseUrl("X", "https://management.chinacloudapi.cn")).not.toThrow();
    // Retired Germany cloud — kept on the allow-list for completeness.
    expect(() => validateApiBaseUrl("X", "https://graph.microsoft.de/v1.0")).not.toThrow();
    expect(() => validateApiBaseUrl("X", "https://management.microsoftazure.de")).not.toThrow();
  });

  it("rejects https:// URLs to unrecognised hosts by default", () => {
    expect(() => validateApiBaseUrl("PIMDO_GRAPH_URL", "https://attacker.example.com")).toThrow(
      /not a recognised Microsoft Graph or ARM endpoint/,
    );
    expect(() => validateApiBaseUrl("X", "https://graph.microsoft.com.attacker.example")).toThrow(
      /not a recognised/,
    );
  });

  it("accepts unrecognised https:// hosts when allowInsecureHosts is true", () => {
    expect(() => validateApiBaseUrl("X", "https://mock.example.test", true)).not.toThrow();
  });

  it("accepts http:// URLs only for loopback hosts", () => {
    expect(() => validateApiBaseUrl("X", "http://localhost:3000")).not.toThrow();
    expect(() => validateApiBaseUrl("X", "http://127.0.0.1:3000")).not.toThrow();
  });

  it("rejects http:// URLs to non-loopback hosts even with allowInsecureHosts", () => {
    expect(() => validateApiBaseUrl("PIMDO_GRAPH_URL", "http://attacker.example.com")).toThrow(
      /plain http:\/\/ is only allowed for localhost/,
    );
    expect(() => validateApiBaseUrl("X", "http://attacker.example.com", true)).toThrow(
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

describe("resolveStaticToken", () => {
  it("returns undefined when PIMDO_ACCESS_TOKEN is not set", () => {
    expect(resolveStaticToken({})).toEqual({ token: undefined });
    expect(resolveStaticToken({ PIMDO_ACCESS_TOKEN: "" })).toEqual({ token: undefined });
  });

  it("returns the token when the interlock is set to 'true'", () => {
    expect(
      resolveStaticToken({
        PIMDO_ACCESS_TOKEN: "abc.def.ghi",
        PIMDO_ALLOW_STATIC_TOKEN: "true",
      }),
    ).toEqual({ token: "abc.def.ghi" });
  });

  it("throws when PIMDO_ACCESS_TOKEN is set without the interlock", () => {
    expect(() => resolveStaticToken({ PIMDO_ACCESS_TOKEN: "abc.def.ghi" })).toThrow(
      /PIMDO_ALLOW_STATIC_TOKEN=true is required/,
    );
  });

  it("throws when the interlock is any value other than 'true'", () => {
    expect(() =>
      resolveStaticToken({
        PIMDO_ACCESS_TOKEN: "abc.def.ghi",
        PIMDO_ALLOW_STATIC_TOKEN: "1",
      }),
    ).toThrow(/PIMDO_ALLOW_STATIC_TOKEN=true is required/);
    expect(() =>
      resolveStaticToken({
        PIMDO_ACCESS_TOKEN: "abc.def.ghi",
        PIMDO_ALLOW_STATIC_TOKEN: "yes",
      }),
    ).toThrow(/PIMDO_ALLOW_STATIC_TOKEN=true is required/);
  });
});
