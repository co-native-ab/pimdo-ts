// Tests for the approverFlow loopback behaviour.

import { describe, it, expect, afterEach } from "vitest";

import { runApproverFlow } from "../../../src/browser/flows/approver.js";
import type { ApproverResult } from "../../../src/browser/flows/approver.js";
import type { RowFormHandle } from "../../../src/browser/flows/row-form.js";
import { fetchCsrfToken, testSignal } from "../../helpers.js";

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("approverFlow", () => {
  let handle: RowFormHandle<ApproverResult> | undefined;

  afterEach(() => {
    handle = undefined;
  });

  it("accepts Approve / Deny decisions and skips Skip rows", async () => {
    handle = await runApproverFlow(
      {
        rows: [
          {
            id: "approval-1",
            label: "Group A",
            requestor: "Alice",
            requestorJustification: "On-call",
          },
          {
            id: "approval-2",
            label: "Group B",
            requestor: "Bob",
            requestorJustification: "Investigation",
          },
        ],
      },
      testSignal(),
    );

    const html = await (await fetch(handle.url)).text();
    expect(html).toContain("Review pending approvals");
    expect(html).toContain("Alice");
    expect(html).toContain("Bob");

    const csrf = await fetchCsrfToken(handle.url);
    const res = await postJson(`${handle.url}/submit`, {
      csrfToken: csrf,
      rows: [
        { id: "approval-1", decision: "Approve", justification: "Looks good" },
        { id: "approval-2", decision: "Deny", justification: "Wrong scope" },
      ],
    });
    expect(res.status).toBe(200);

    const result = await handle.result;
    expect(result.rows).toEqual([
      { id: "approval-1", decision: "Approve", justification: "Looks good" },
      { id: "approval-2", decision: "Deny", justification: "Wrong scope" },
    ]);
  });
});
