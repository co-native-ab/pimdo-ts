// Bounded, truncatable pagination over Microsoft Graph + Azure Resource
// Manager list endpoints.
//
// Both surfaces follow the same wire contract:
//
//   - Initial request may pass `$top=<pageSize>` as a hint.
//   - Response carries the page in `value: T[]`.
//   - When more pages exist, the response carries a continuation URL —
//     `@odata.nextLink` (Graph) or `nextLink` (ARM). The URL is opaque
//     and absolute; clients must follow it verbatim and must NOT append
//     `$top` to it.
//
// Differences:
//
//   - Graph caps `$top` at 999; we ship 100 as the default to match
//     historical behaviour.
//   - ARM uses an opaque `$skiptoken` inside the `nextLink`. The server
//     decides the page size after the first request.
//
// Both pageSize and maxPages are caller-configurable so tools can expose
// them to the AI assistant. When the cap is hit we surface
// `truncated: true` rather than throwing — truncation is a *signal*,
// not a transport error.
//
// References:
//   - https://learn.microsoft.com/en-us/graph/paging
//   - https://learn.microsoft.com/en-us/rest/api/azure/paging-overview

import { z, type ZodType } from "zod";

import { HttpMethod, type BaseHttpClient } from "./base-client.js";

/** Default items requested per page (both Graph and ARM). */
export const DEFAULT_PAGE_SIZE = 100;

/** Default maximum number of pages fetched before truncating the result. */
export const DEFAULT_MAX_PAGES = 10;

/** Microsoft Graph's documented `$top` ceiling. */
export const MAX_PAGE_SIZE_GRAPH = 999;

/** Upper bound exposed via tool inputs. ARM does not document a ceiling. */
export const MAX_PAGE_SIZE = 999;

/** Upper bound exposed via tool inputs for the page cap. */
export const MAX_MAX_PAGES = 100;

/**
 * Caller-tunable knobs for a paginated read. Both fields are optional;
 * tools that don't surface them to users get the defaults above.
 */
export interface PageOptions {
  /** Items per page. Must be 1..MAX_PAGE_SIZE. */
  pageSize?: number;
  /** Maximum pages to fetch before reporting truncated. Must be 1..MAX_MAX_PAGES. */
  maxPages?: number;
}

/**
 * Result of a paginated read. Callers that don't care about truncation
 * can read `.items`; tools surface a warning when `truncated` is true so
 * the AI assistant can either re-run with a higher `maxPages` or
 * narrow the filter.
 */
export interface PagedResult<T> {
  items: T[];
  truncated: boolean;
  pagesFetched: number;
}

/**
 * Result of an upstream call that cannot be paginated. Used for the
 * Graph `filterByCurrentUser(on='approver')` endpoints, which are
 * hard-capped at {@link FILTER_BY_CURRENT_USER_CAP} items by Microsoft
 * Graph and never emit `@odata.nextLink`. The `cappedAt50` flag mirrors
 * the heuristic the formatter uses to warn the user: a response of
 * exactly 50 items is suspicious, and may indicate truncated data.
 */
export interface LimitedResult<T> {
  items: T[];
  cappedAt50: boolean;
}

/**
 * The empirically observed hard cap that real Microsoft Graph applies
 * to its `filterByCurrentUser(...)` function endpoints. Re-exported
 * from here so test fixtures and the format helpers can share one
 * source of truth.
 */
export const FILTER_BY_CURRENT_USER_CAP = 50;

/**
 * Render the heuristic warning printed by approver-side list
 * formatters when an upstream `filterByCurrentUser` response came
 * back exactly at the cap. Returns the empty string otherwise so
 * formatters can unconditionally concatenate the result.
 */
export function filterByCurrentUserCapWarning(result: LimitedResult<unknown>): string {
  if (!result.cappedAt50) return "";
  return (
    `\n! Microsoft Graph capped this response at ${String(FILTER_BY_CURRENT_USER_CAP)} item(s) ` +
    `(filterByCurrentUser has no pagination on the approver side); more pending approvals may exist.`
  );
}

function resolveOpts(opts: PageOptions | undefined): {
  pageSize: number;
  maxPages: number;
} {
  const pageSize = opts?.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = opts?.maxPages ?? DEFAULT_MAX_PAGES;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new Error(
      `pageSize must be an integer in 1..${String(MAX_PAGE_SIZE)} (got ${String(pageSize)})`,
    );
  }
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > MAX_MAX_PAGES) {
    throw new Error(
      `maxPages must be an integer in 1..${String(MAX_MAX_PAGES)} (got ${String(maxPages)})`,
    );
  }
  return { pageSize, maxPages };
}

/**
 * Inject `$top=<pageSize>` into a path that may already carry a query
 * string. Leaves the path untouched if `$top` is already present so
 * callers can opt out per-endpoint.
 */
function withTop(path: string, pageSize: number): string {
  if (/(\?|&)\$top=/.test(path)) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}$top=${String(pageSize)}`;
}

/**
 * Convert an absolute continuation URL into a path that can be passed
 * to `client.request` (which prepends `client.baseUrl`). The Microsoft
 * Graph `@odata.nextLink` is an absolute URL whose path already
 * includes the API version segment (e.g. `/v1.0/...`), so we MUST
 * strip the base-URL's pathname or the request URL ends up doubled
 * (`/v1.0/v1.0/...`). Falls back to the original string when URL
 * parsing fails so the caller fails loudly with a clear error instead
 * of silently truncating.
 */
export function toRelativePath(nextLink: string, baseUrl: string): string {
  if (nextLink.startsWith("/")) return nextLink;
  try {
    const u = new URL(nextLink);
    const tail = `${u.pathname}${u.search}`;
    const base = new URL(baseUrl);
    if (u.origin === base.origin && base.pathname !== "" && base.pathname !== "/") {
      // Strip the configured base-URL path prefix exactly once.
      const prefix = base.pathname.replace(/\/+$/, "");
      if (tail === prefix) return "/";
      if (tail.startsWith(`${prefix}/`)) return tail.slice(prefix.length);
    }
    return tail;
  } catch {
    return nextLink;
  }
}

/**
 * Page-envelope parser. Receives the raw `Response`, validates the
 * page-level wire shape, and returns the items plus the continuation
 * URL. Each surface plugs in its own implementation so the per-client
 * `ResponseParseError` is preserved end-to-end.
 */
export type PageParser<T> = (
  response: Response,
  method: string,
  path: string,
) => Promise<{ value: T[]; nextLink?: string }>;

async function paginate<T>(
  client: BaseHttpClient,
  initialPath: string,
  parsePage: PageParser<T>,
  opts: PageOptions | undefined,
  signal: AbortSignal,
): Promise<PagedResult<T>> {
  const { pageSize, maxPages } = resolveOpts(opts);

  const items: T[] = [];
  let nextPath: string | undefined = withTop(initialPath, pageSize);
  let pagesFetched = 0;

  while (nextPath !== undefined) {
    if (pagesFetched >= maxPages) {
      return { items, truncated: true, pagesFetched };
    }
    const currentPath: string = nextPath;
    const res = await client.request(HttpMethod.GET, currentPath, signal);
    const parsed = await parsePage(res, "GET", currentPath);
    items.push(...parsed.value);
    pagesFetched += 1;
    nextPath = parsed.nextLink ? toRelativePath(parsed.nextLink, client.baseUrl) : undefined;
  }

  return { items, truncated: false, pagesFetched };
}

/**
 * Paginate a Microsoft Graph list endpoint. Sends `$top=pageSize` on
 * the initial request only and follows `@odata.nextLink` until
 * exhausted or `maxPages` is reached.
 */
export function paginateGraph<T>(
  client: BaseHttpClient,
  initialPath: string,
  parsePage: PageParser<T>,
  opts: PageOptions | undefined,
  signal: AbortSignal,
): Promise<PagedResult<T>> {
  return paginate(client, initialPath, parsePage, opts, signal);
}

/**
 * Paginate an Azure Resource Manager list endpoint. Sends `$top=pageSize`
 * on the initial request only and follows `nextLink` until exhausted
 * or `maxPages` is reached.
 */
export function paginateArm<T>(
  client: BaseHttpClient,
  initialPath: string,
  parsePage: PageParser<T>,
  opts: PageOptions | undefined,
  signal: AbortSignal,
): Promise<PagedResult<T>> {
  return paginate(client, initialPath, parsePage, opts, signal);
}

/**
 * Build a {@link PageParser} from an item schema and a per-resource
 * `parseResponse` (the Graph or ARM client's). The page envelope
 * schema is the same shape on both surfaces aside from the continuation
 * key.
 */
export function graphPageParser<T>(
  itemSchema: ZodType<T>,
  parseResponse: <U>(
    response: Response,
    schema: ZodType<U>,
    method?: string,
    path?: string,
  ) => Promise<U>,
): PageParser<T> {
  const schema = z.object({
    value: z.array(itemSchema),
    "@odata.nextLink": z.string().optional(),
  });
  return async (response, method, path) => {
    const parsed = await parseResponse(response, schema, method, path);
    return { value: parsed.value, nextLink: parsed["@odata.nextLink"] };
  };
}

/** ARM page parser. See {@link graphPageParser}. */
export function armPageParser<T>(
  itemSchema: ZodType<T>,
  parseResponse: <U>(
    response: Response,
    schema: ZodType<U>,
    method?: string,
    path?: string,
  ) => Promise<U>,
): PageParser<T> {
  const schema = z.object({
    value: z.array(itemSchema),
    nextLink: z.string().optional(),
  });
  return async (response, method, path) => {
    const parsed = await parseResponse(response, schema, method, path);
    return { value: parsed.value, nextLink: parsed.nextLink };
  };
}

/**
 * Combine two `PagedResult`s as if their `items` were concatenated.
 * `truncated` is OR'd and `pagesFetched` is summed. Used by helpers
 * that issue multiple paginated calls (e.g. ARM active assignments
 * per scope) and need to roll the truncation signal up to the tool
 * layer.
 */
export function mergePaged<T>(a: PagedResult<T>, b: PagedResult<T>): PagedResult<T> {
  return {
    items: [...a.items, ...b.items],
    truncated: a.truncated || b.truncated,
    pagesFetched: a.pagesFetched + b.pagesFetched,
  };
}

/**
 * Render a one-line truncation warning that list-tool formatters append
 * to their output when `truncated` is true. Includes both the items-so-far
 * count and a concrete suggestion the assistant can act on.
 */
export function truncationWarning(result: PagedResult<unknown>): string {
  if (!result.truncated) return "";
  return (
    `\n! Truncated: showing ${String(result.items.length)} item(s) after ${String(result.pagesFetched)} page(s); ` +
    `more results are available. The internal cap of ${String(DEFAULT_PAGE_SIZE * DEFAULT_MAX_PAGES)} items was hit — narrow the query or contact maintainers to raise the cap.`
  );
}
