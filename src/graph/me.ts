// Look up the signed-in user's directory object ID via `/me?$select=id`.
//
// PIM activation/deactivation requests need the signed-in user's
// object ID as `principalId`. The token has it as a claim but we read
// it from Graph directly to avoid coupling the token shape to the tool
// layer.
//
// The list helpers under `src/features/{group,role-entra}/client.ts`
// also resolve the OID — they switched away from the broken
// `filterByCurrentUser` functions onto the unfiltered collections with
// `?$filter=principalId eq '<oid>'` and need an OID to interpolate. To
// avoid a per-list-call round-trip we cache the answer per
// {@link GraphClient} instance via a WeakMap.

import { GraphClient, HttpMethod, parseResponse } from "./client.js";
import { OAuthScope } from "../scopes.js";
import { assertScopes } from "../scopes-runtime.js";
import { MeSchema } from "./types.js";

/**
 * Microsoft Graph permissions for `GET /me`.
 *
 * `User.Read` is always-granted (it is the bootstrap scope every pimdo
 * login asks for) so this resolves to the empty DNF after
 * {@link deriveRequiredScopes} strips always-required scopes — but we
 * still call {@link assertScopes} so that a future caller who passes a
 * test credential without `User.Read` gets a clear error rather than a
 * 403 from Graph.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/user-get?view=graph-rest-1.0&tabs=http#permissions
 */
export const GET_MY_OBJECT_ID_SCOPES: OAuthScope[][] = [[OAuthScope.UserRead]];

const oidCache = new WeakMap<GraphClient, Promise<string>>();

/**
 * Returns the signed-in user's directory object ID. The result is
 * cached per {@link GraphClient} instance so repeated calls within the
 * same MCP-tool invocation (e.g. listing eligibilities then active
 * assignments) only issue one `/me` round-trip. The cache stores the
 * promise itself so concurrent callers share the in-flight request.
 *
 * Failures are not cached: the rejected promise is evicted so a
 * subsequent call retries.
 */
export async function getMyObjectId(client: GraphClient, signal: AbortSignal): Promise<string> {
  const cached = oidCache.get(client);
  if (cached !== undefined) return cached;
  const promise = (async () => {
    await assertScopes(client.credential, GET_MY_OBJECT_ID_SCOPES, signal);
    const path = "/me?$select=id";
    const res = await client.request(HttpMethod.GET, path, signal);
    const me = await parseResponse(res, MeSchema, "GET", path);
    return me.id;
  })();
  oidCache.set(client, promise);
  try {
    return await promise;
  } catch (err) {
    oidCache.delete(client);
    throw err;
  }
}
