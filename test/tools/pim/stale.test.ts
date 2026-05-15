import { describe, expect, it, vi } from "vitest";

import {
  classifyStaleApproverRequests,
  classifyStalePrincipalRequests,
  isSelfActivate,
} from "../../../src/tools/pim/stale.js";

interface Req {
  id: string;
  action: string;
  groupId: string;
}

const make = (id: string, action: string, groupId: string): Req => ({ id, action, groupId });

describe("isSelfActivate", () => {
  it("recognises Graph and ARM casings", () => {
    expect(isSelfActivate("selfActivate")).toBe(true);
    expect(isSelfActivate("SelfActivate")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isSelfActivate("selfDeactivate")).toBe(false);
    expect(isSelfActivate("adminAssign")).toBe(false);
    expect(isSelfActivate(null)).toBe(false);
    expect(isSelfActivate(undefined)).toBe(false);
    expect(isSelfActivate("")).toBe(false);
  });
});

describe("classifyStalePrincipalRequests", () => {
  const adapter = (live: ReadonlySet<string>, throws?: Error) => ({
    requestKey: (r: Req) => r.groupId,
    action: (r: Req) => r.action,
    requestId: (r: Req) => r.id,
    liveEligibilityKeys: vi.fn((): Promise<ReadonlySet<string>> => {
      if (throws) return Promise.reject(throws);
      return Promise.resolve(live);
    }),
  });

  it("returns empty for an empty request list and skips the eligibility fetch", async () => {
    const a = adapter(new Set());
    const out = await classifyStalePrincipalRequests([], a, new AbortController().signal);
    expect(out.size).toBe(0);
    expect(a.liveEligibilityKeys).not.toHaveBeenCalled();
  });

  it("skips the eligibility fetch when no request is selfActivate", async () => {
    const a = adapter(new Set(["g1"]));
    const out = await classifyStalePrincipalRequests(
      [make("r1", "selfDeactivate", "g1"), make("r2", "adminAssign", "g2")],
      a,
      new AbortController().signal,
    );
    expect(out.size).toBe(0);
    expect(a.liveEligibilityKeys).not.toHaveBeenCalled();
  });

  it("does not tag selfActivate requests with matching eligibility", async () => {
    const a = adapter(new Set(["g1", "g2"]));
    const out = await classifyStalePrincipalRequests(
      [make("r1", "selfActivate", "g1"), make("r2", "selfActivate", "g2")],
      a,
      new AbortController().signal,
    );
    expect(out.size).toBe(0);
  });

  it("tags selfActivate requests with no matching eligibility", async () => {
    const a = adapter(new Set(["g2"]));
    const out = await classifyStalePrincipalRequests(
      [make("r1", "selfActivate", "g1"), make("r2", "selfActivate", "g2")],
      a,
      new AbortController().signal,
    );
    expect([...out]).toEqual(["r1"]);
  });

  it("never tags selfDeactivate even when no eligibility matches", async () => {
    const a = adapter(new Set());
    const out = await classifyStalePrincipalRequests(
      [make("r1", "selfDeactivate", "g1")],
      a,
      new AbortController().signal,
    );
    expect(out.size).toBe(0);
  });

  it("propagates errors from the eligibility fetch", async () => {
    const a = adapter(new Set(), new Error("boom"));
    await expect(
      classifyStalePrincipalRequests(
        [make("r1", "selfActivate", "g1")],
        a,
        new AbortController().signal,
      ),
    ).rejects.toThrow("boom");
  });
});

describe("classifyStaleApproverRequests", () => {
  it("tags only requests where hasLiveStage returns false", async () => {
    const out = await classifyStaleApproverRequests(
      [{ id: "r1" }, { id: "r2" }, { id: "r3" }],
      {
        requestId: (r: { id: string }) => r.id,
        hasLiveStage: vi.fn((r: { id: string }) => Promise.resolve(r.id !== "r2")),
      },
      new AbortController().signal,
    );
    expect([...out]).toEqual(["r2"]);
  });

  it("propagates errors from the per-row probe", async () => {
    await expect(
      classifyStaleApproverRequests(
        [{ id: "r1" }],
        {
          requestId: (r) => r.id,
          hasLiveStage: () => Promise.reject(new Error("nope")),
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("nope");
  });

  it("returns empty for an empty list", async () => {
    const probe = vi.fn();
    const out = await classifyStaleApproverRequests(
      [],
      { requestId: (r: { id: string }) => r.id, hasLiveStage: probe },
      new AbortController().signal,
    );
    expect(out.size).toBe(0);
    expect(probe).not.toHaveBeenCalled();
  });
});
