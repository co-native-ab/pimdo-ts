// Regression test: Microsoft Graph's @odata.nextLink is absolute and
// includes the API-version path segment (e.g. /v1.0/...). The paginator
// passes the result back through `client.request`, which prepends the
// configured baseUrl. If we don't strip the baseUrl's path prefix the
// follow-up URL ends up doubled — `/v1.0/v1.0/identityGovernance/...`
// — and Graph returns HTTP 400 "Resource not found for the segment
// 'v1.0'". This test pins the contract.

import { describe, expect, it } from "vitest";

import { toRelativePath } from "../../src/http/paging.js";

describe("toRelativePath", () => {
  it("strips the baseUrl's path prefix from an absolute Graph nextLink", () => {
    const next =
      "https://graph.microsoft.com/v1.0/identityGovernance/privilegedAccess/group/eligibilitySchedules/filterByCurrentUser(on='principal')?$expand=group%2cprincipal&$skip=50";
    const rel = toRelativePath(next, "https://graph.microsoft.com/v1.0");
    expect(rel).toBe(
      "/identityGovernance/privilegedAccess/group/eligibilitySchedules/filterByCurrentUser(on='principal')?$expand=group%2cprincipal&$skip=50",
    );
  });

  it("handles a trailing slash on the baseUrl path", () => {
    const next = "https://graph.microsoft.com/v1.0/foo/bar?x=1";
    expect(toRelativePath(next, "https://graph.microsoft.com/v1.0/")).toBe("/foo/bar?x=1");
  });

  it("returns the full path when the baseUrl has no path prefix (ARM-style)", () => {
    const next = "https://management.azure.com/subscriptions/abc?$skiptoken=xyz";
    expect(toRelativePath(next, "https://management.azure.com")).toBe(
      "/subscriptions/abc?$skiptoken=xyz",
    );
  });

  it("does not strip when origins differ", () => {
    const next = "https://other.example.com/v1.0/foo";
    expect(toRelativePath(next, "https://graph.microsoft.com/v1.0")).toBe("/v1.0/foo");
  });

  it("passes through an already-relative nextLink unchanged", () => {
    expect(toRelativePath("/v1.0/foo?bar=1", "https://graph.microsoft.com/v1.0")).toBe(
      "/v1.0/foo?bar=1",
    );
  });

  it("returns the input verbatim when parsing fails", () => {
    expect(toRelativePath("::not-a-url::", "https://graph.microsoft.com/v1.0")).toBe(
      "::not-a-url::",
    );
  });
});
