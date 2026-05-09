// Tests for the requesterFlow loopback behaviour.

import { describe, it, expect, afterEach } from "vitest";

import { runRequesterFlow } from "../../../src/browser/flows/requester.js";
import type { RowFormHandle } from "../../../src/browser/flows/row-form.js";
import type { RequesterResult } from "../../../src/browser/flows/requester.js";
import { fetchCsrfToken, testSignal } from "../../helpers.js";

async function postJson(url: string, body: unknown): Promise<{ res: Response; json: unknown }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { res, json };
}

describe("requesterFlow", () => {
  let handle: RowFormHandle<RequesterResult> | undefined;

  afterEach(() => {
    handle = undefined;
  });

  it("renders rows and accepts a valid submission", async () => {
    handle = await runRequesterFlow(
      {
        rows: [
          {
            id: "group-a",
            label: "Group A",
            subtitle: "First group",
            maxDuration: "PT8H",
            defaultDuration: "PT2H",
            prefilledJustification: "Routine on-call",
          },
          {
            id: "group-b",
            label: "Group B",
            maxDuration: "PT30M",
          },
        ],
      },
      testSignal(),
    );

    const pageRes = await fetch(handle.url);
    const html = await pageRes.text();
    expect(html).toContain("Request activation");
    expect(html).toContain("Group A");
    expect(html).toContain("Group B");
    expect(html).toContain("Routine on-call");

    const csrf = await fetchCsrfToken(handle.url);
    const { res } = await postJson(`${handle.url}/submit`, {
      csrfToken: csrf,
      rows: [{ id: "group-a", justification: "On-call rotation", duration: "PT2H" }],
    });
    expect(res.status).toBe(200);

    const result = await handle.result;
    expect(result.rows).toEqual([
      { id: "group-a", justification: "On-call rotation", duration: "PT2H" },
    ]);
  });

  it("rejects submissions missing required fields", async () => {
    handle = await runRequesterFlow(
      {
        rows: [{ id: "group-a", label: "Group A", maxDuration: "PT8H" }],
      },
      testSignal(),
    );

    const csrf = await fetchCsrfToken(handle.url);
    const { res } = await postJson(`${handle.url}/submit`, {
      csrfToken: csrf,
      rows: [{ id: "group-a", justification: "", duration: "PT1H" }],
    });
    expect(res.status).toBe(400);

    // Cancel to release the handle. Attach the rejection handler before
    // posting so we don't observe an unhandled-rejection warning.
    const expectation = expect(handle.result).rejects.toThrow();
    await postJson(`${handle.url}/cancel`, { csrfToken: csrf });
    await expectation;
  });

  it("rejects submissions for an unknown row id (defence-in-depth)", async () => {
    handle = await runRequesterFlow(
      {
        rows: [{ id: "group-a", label: "Group A", maxDuration: "PT8H" }],
      },
      testSignal(),
    );

    const csrf = await fetchCsrfToken(handle.url);
    const { res, json } = await postJson(`${handle.url}/submit`, {
      csrfToken: csrf,
      rows: [{ id: "group-other", justification: "j", duration: "PT1H" }],
    });
    expect(res.status).toBe(500);
    expect(String(json)).toContain("Unknown row id");

    const expectation = expect(handle.result).rejects.toThrow();
    await postJson(`${handle.url}/cancel`, { csrfToken: csrf });
    await expectation;
  });

  it("rejects submissions whose duration exceeds the policy max", async () => {
    handle = await runRequesterFlow(
      {
        rows: [{ id: "group-a", label: "Group A", maxDuration: "PT1H" }],
      },
      testSignal(),
    );

    const csrf = await fetchCsrfToken(handle.url);
    const { res, json } = await postJson(`${handle.url}/submit`, {
      csrfToken: csrf,
      rows: [{ id: "group-a", justification: "j", duration: "PT8H" }],
    });
    expect(res.status).toBe(500);
    expect(String(json)).toContain("exceeds policy maximum");

    const expectation = expect(handle.result).rejects.toThrow();
    await postJson(`${handle.url}/cancel`, { csrfToken: csrf });
    await expectation;
  });

  it("rejects submissions whose duration is malformed", async () => {
    handle = await runRequesterFlow(
      {
        rows: [{ id: "group-a", label: "Group A", maxDuration: "PT1H" }],
      },
      testSignal(),
    );

    const csrf = await fetchCsrfToken(handle.url);
    const { res, json } = await postJson(`${handle.url}/submit`, {
      csrfToken: csrf,
      rows: [{ id: "group-a", justification: "j", duration: "not-iso" }],
    });
    expect(res.status).toBe(500);
    expect(String(json)).toContain("Invalid duration");

    const expectation = expect(handle.result).rejects.toThrow();
    await postJson(`${handle.url}/cancel`, { csrfToken: csrf });
    await expectation;
  });
});
