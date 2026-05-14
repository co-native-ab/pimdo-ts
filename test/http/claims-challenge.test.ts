import { describe, it, expect } from "vitest";

import { extractClaimsChallenge } from "../../src/http/claims-challenge.js";

const PIM_CLAIMS_JSON = '{"access_token":{"acrs":{"essential":true,"value":"c1"}}}';

function makeHeaders(init: Record<string, string>): Headers {
  return new Headers(init);
}

describe("extractClaimsChallenge", () => {
  it("returns null when no challenge is present", () => {
    expect(
      extractClaimsChallenge({
        headers: makeHeaders({}),
        body: '{"error":{"code":"NotFound","message":"nope"}}',
        message: "nope",
      }),
    ).toBeNull();
  });

  describe("WWW-Authenticate header", () => {
    it("extracts raw JSON claims from a Bearer challenge", () => {
      const headers = makeHeaders({
        "WWW-Authenticate": `Bearer authorization_uri="https://login.microsoftonline.com/common/oauth2/authorize", error="insufficient_claims", claims="${PIM_CLAIMS_JSON}"`,
      });
      const result = extractClaimsChallenge({ headers, body: "" });
      expect(result).toBe(PIM_CLAIMS_JSON);
    });

    it("extracts base64url-encoded JSON claims from a Bearer challenge", () => {
      const base64 = Buffer.from(PIM_CLAIMS_JSON).toString("base64url");
      const headers = makeHeaders({
        "WWW-Authenticate": `Bearer error="insufficient_claims", claims="${base64}"`,
      });
      const result = extractClaimsChallenge({ headers, body: "" });
      expect(result).toBe(PIM_CLAIMS_JSON);
    });

    it("returns null when the claims value is not parseable JSON or base64", () => {
      const headers = makeHeaders({
        "WWW-Authenticate": `Bearer claims="not-valid-anything!!!@@@"`,
      });
      const result = extractClaimsChallenge({ headers, body: "" });
      expect(result).toBeNull();
    });

    it("ignores Bearer challenges without a claims parameter", () => {
      const headers = makeHeaders({
        "WWW-Authenticate": `Bearer realm="example", error="invalid_token"`,
      });
      const result = extractClaimsChallenge({ headers, body: "" });
      expect(result).toBeNull();
    });
  });

  describe("PIM body fragment", () => {
    it("extracts URL-encoded claims from the parsed error message", () => {
      const message = `RoleAssignmentRequestAcrsValidationFailed: &claims=${encodeURIComponent(PIM_CLAIMS_JSON)}`;
      const result = extractClaimsChallenge({
        headers: makeHeaders({}),
        body: "",
        message,
      });
      expect(result).toBe(PIM_CLAIMS_JSON);
    });

    it("extracts URL-encoded claims from the raw body when no message is given", () => {
      const body = `{"error":{"code":"X","message":"&claims=${encodeURIComponent(PIM_CLAIMS_JSON)}"}}`;
      const result = extractClaimsChallenge({ headers: makeHeaders({}), body });
      expect(result).toBe(PIM_CLAIMS_JSON);
    });

    it("matches the real-world PIM URL-encoded payload verbatim", () => {
      const message =
        "&claims=%7B%22access_token%22%3A%7B%22acrs%22%3A%7B%22essential%22%3Atrue%2C%20%22value%22%3A%22c1%22%7D%7D%7D";
      const result = extractClaimsChallenge({
        headers: makeHeaders({}),
        body: "",
        message,
      });
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result!) as { access_token?: { acrs?: { value?: string } } };
      expect(parsed.access_token?.acrs?.value).toBe("c1");
    });

    it("returns null when the URL-encoded value is malformed", () => {
      const message = "error: &claims=%E0%A4%A"; // truncated percent-encoding
      const result = extractClaimsChallenge({
        headers: makeHeaders({}),
        body: "",
        message,
      });
      expect(result).toBeNull();
    });
  });

  it("prefers the WWW-Authenticate header over a body fragment when both are present", () => {
    const headerJson = '{"access_token":{"acrs":{"essential":true,"value":"c2"}}}';
    const headers = makeHeaders({
      "WWW-Authenticate": `Bearer claims="${headerJson}"`,
    });
    const message = `&claims=${encodeURIComponent(PIM_CLAIMS_JSON)}`;
    const result = extractClaimsChallenge({ headers, body: "", message });
    expect(result).toBe(headerJson);
  });
});
