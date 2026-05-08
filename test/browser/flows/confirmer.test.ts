// Tests for the confirmerFlow loopback behaviour.

import { describe, it, expect, afterEach } from "vitest";

import { runConfirmerFlow } from "../../../src/browser/flows/confirmer.js";
import type { ConfirmerResult } from "../../../src/browser/flows/confirmer.js";
import type { RowFormHandle } from "../../../src/browser/flows/row-form.js";
import { fetchCsrfToken, testSignal } from "../../helpers.js";

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("confirmerFlow", () => {
  let handle: RowFormHandle<ConfirmerResult> | undefined;

  afterEach(() => {
    handle = undefined;
  });

  it("accepts confirmations with optional reason", async () => {
    handle = await runConfirmerFlow(
      {
        heading: "Deactivate access",
        subtitle: "Confirm which active assignments to deactivate.",
        submitLabel: "Deactivate",
        reasonLabel: "Reason",
        rows: [
          { id: "active-1", label: "Group A" },
          { id: "active-2", label: "Group B", subtitle: "Second group" },
        ],
      },
      testSignal(),
    );

    const html = await (await fetch(handle.url)).text();
    expect(html).toContain("Deactivate access");
    expect(html).toContain("Group A");

    const csrf = await fetchCsrfToken(handle.url);
    const res = await postJson(`${handle.url}/submit`, {
      csrfToken: csrf,
      rows: [
        { id: "active-1", reason: "" },
        { id: "active-2", reason: "Done with task" },
      ],
    });
    expect(res.status).toBe(200);

    const result = await handle.result;
    expect(result.rows).toEqual([
      { id: "active-1", reason: "" },
      { id: "active-2", reason: "Done with task" },
    ]);
  });
});
