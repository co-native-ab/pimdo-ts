// Pagination helper for the Graph + ARM mock servers.
//
// Real Microsoft Graph + Azure Resource Manager list endpoints return
// `value: T[]` with an optional continuation URL (`@odata.nextLink` /
// `nextLink`) when more pages are available. The mocks here mirror that
// contract so the production paginator is exercised end-to-end:
//
//   - `$top=<n>` on the request controls the page size (defaults to all
//     remaining items if absent).
//   - Subsequent pages are followed via `$skiptoken=<index>`.
//   - It is an error to send `$top` together with `$skiptoken` on the
//     same request — the production client must NOT re-add `$top` to
//     a continuation URL. The mock returns 400 if it sees this combo
//     so the test catches the bug at the exact point of regression.

import http from "node:http";

import { jsonResponse } from "./mock-server-base.js";

export interface PageResult<T> {
  /** Slice to return for this request. */
  pageItems: readonly T[];
  /** Continuation URL to emit, or `undefined` for the final page. */
  nextLink: string | undefined;
  /** Error response sent in lieu of the page slice. `true` when terminal. */
  errored: boolean;
}

/** Variant of {@link buildPage} for ARM (uses bare `nextLink`). */
export const ARM_NEXT_LINK = "nextLink";

/** Variant of {@link buildPage} for Graph (uses `@odata.nextLink`). */
export const GRAPH_NEXT_LINK = "@odata.nextLink";

/**
 * Default page size used by the mock when the request omits `$top`.
 * Matches the empirically observed Microsoft Graph default for the PIM
 * `filterByCurrentUser` endpoints (around 50), which is the very bug
 * this paginator exists to work around.
 */
export const MOCK_DEFAULT_PAGE_SIZE = 50;

/**
 * Slice `items` according to the `$top` and `$skiptoken` parameters on
 * the request URL and return the page + continuation URL. If the client
 * sent a malformed paging request the helper writes a 400 to `res` and
 * returns `errored: true`; the route handler should just `return` in
 * that case.
 *
 * The continuation URL is built from the request's own pathname + an
 * updated `$skiptoken`, with `$top` stripped. Tests assert the loop
 * follows it verbatim.
 */
export function buildPage<T>(
  items: readonly T[],
  req: http.IncomingMessage,
  res: http.ServerResponse,
  errorResponse: (res: http.ServerResponse, status: number, code: string, message: string) => void,
): PageResult<T> {
  const rawUrl = req.url ?? "/";
  const parsed = new URL(rawUrl, `http://${req.headers.host ?? "127.0.0.1"}`);

  const skipTokenRaw = parsed.searchParams.get("$skiptoken");
  const topRaw = parsed.searchParams.get("$top");

  // A continuation call must NOT re-introduce $top. The production
  // paginator goes to lengths to avoid this; if a regression ever
  // reintroduces it we want the test to fail loudly here.
  if (skipTokenRaw !== null && topRaw !== null) {
    errorResponse(
      res,
      400,
      "InvalidPagingRequest",
      `mock paging: continuation request must not re-include $top (got $top=${topRaw} with $skiptoken=${skipTokenRaw})`,
    );
    return { pageItems: [], nextLink: undefined, errored: true };
  }

  let pageSize = MOCK_DEFAULT_PAGE_SIZE;
  if (topRaw !== null) {
    const parsedTop = Number.parseInt(topRaw, 10);
    if (!Number.isInteger(parsedTop) || parsedTop < 1) {
      errorResponse(
        res,
        400,
        "InvalidPagingRequest",
        `mock paging: $top must be a positive integer (got ${topRaw})`,
      );
      return { pageItems: [], nextLink: undefined, errored: true };
    }
    pageSize = parsedTop;
  }

  let skip = 0;
  if (skipTokenRaw !== null) {
    const parsedSkip = Number.parseInt(skipTokenRaw, 10);
    if (!Number.isInteger(parsedSkip) || parsedSkip < 0) {
      errorResponse(
        res,
        400,
        "InvalidPagingRequest",
        `mock paging: $skiptoken must be a non-negative integer (got ${skipTokenRaw})`,
      );
      return { pageItems: [], nextLink: undefined, errored: true };
    }
    skip = parsedSkip;
  }

  const slice = items.slice(skip, skip + pageSize);
  const nextSkip = skip + slice.length;
  let nextLink: string | undefined;
  if (nextSkip < items.length) {
    const nextParams = new URLSearchParams(parsed.searchParams);
    // $top is only valid on the first request. Strip before emitting
    // the continuation URL so the production client never has a reason
    // to add its own.
    nextParams.delete("$top");
    nextParams.set("$skiptoken", String(nextSkip));
    nextLink = `${parsed.origin}${parsed.pathname}?${nextParams.toString()}`;
  }
  return { pageItems: slice, nextLink, errored: false };
}

/**
 * Convenience: page `items`, JSON-respond with `{ value, <nextKey>? }`,
 * and return whether the response was written. Callers `return` after
 * calling so the route handler short-circuits.
 */
export function respondPaged(
  items: readonly unknown[],
  req: http.IncomingMessage,
  res: http.ServerResponse,
  nextKey: typeof GRAPH_NEXT_LINK | typeof ARM_NEXT_LINK,
  errorResponse: (res: http.ServerResponse, status: number, code: string, message: string) => void,
): void {
  const page = buildPage(items, req, res, errorResponse);
  if (page.errored) return;
  const body: Record<string, unknown> = { value: page.pageItems };
  if (page.nextLink !== undefined) body[nextKey] = page.nextLink;
  jsonResponse(res, 200, body);
}

/**
 * Hard server-side cap used by real Microsoft Graph `filterByCurrentUser`
 * functions: at most 50 items, **never** an `@odata.nextLink`. Empirically
 * the only way to see more is to call the underlying collection with an
 * explicit `?$filter=principalId eq '<oid>'` (see
 * microsoftgraph/microsoft-graph-docs#15755).
 */
export const FILTER_BY_CURRENT_USER_CAP = 50;

/**
 * Mirror of the real Graph `filterByCurrentUser` contract for tests:
 *
 *   - Reject `$top`, `$skip`, `$skiptoken` with 400 (the real endpoint
 *     ignores them silently, but a 400 is the strongest signal we can
 *     emit to lock the contract in tests — the production code MUST NOT
 *     send any of these to a filterByCurrentUser path).
 *   - Truncate `items` at {@link FILTER_BY_CURRENT_USER_CAP}.
 *   - Never emit a continuation URL, even when truncated.
 *
 * Returns true when a response (success or 400) was written and the
 * route handler should `return`.
 */
export function respondFilterByCurrentUserCapped(
  items: readonly unknown[],
  req: http.IncomingMessage,
  res: http.ServerResponse,
  errorResponse: (res: http.ServerResponse, status: number, code: string, message: string) => void,
): void {
  const rawUrl = req.url ?? "/";
  const parsed = new URL(rawUrl, `http://${req.headers.host ?? "127.0.0.1"}`);
  for (const forbidden of ["$top", "$skip", "$skiptoken"] as const) {
    if (parsed.searchParams.has(forbidden)) {
      errorResponse(
        res,
        400,
        "InvalidPagingRequest",
        `mock filterByCurrentUser: ${forbidden} is not supported on this endpoint (real Graph caps at ${String(FILTER_BY_CURRENT_USER_CAP)} items with no nextLink; the production client must not send paging params here)`,
      );
      return;
    }
  }
  jsonResponse(res, 200, { value: items.slice(0, FILTER_BY_CURRENT_USER_CAP) });
}
