// Look up the signed-in user's directory object ID via `/me?$select=id`.
//
// PIM activation/deactivation requests need the signed-in user's
// object ID as `principalId`. The token has it as a claim but we read
// it from Graph directly to avoid coupling the token shape to the tool
// layer. Tools should call this once per invocation.

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

/** Returns the signed-in user's directory object ID. */
export async function getMyObjectId(client: GraphClient, signal: AbortSignal): Promise<string> {
  await assertScopes(client.credential, GET_MY_OBJECT_ID_SCOPES, signal);
  const path = "/me?$select=id";
  const res = await client.request(HttpMethod.GET, path, signal);
  const me = await parseResponse(res, MeSchema, "GET", path);
  return me.id;
}
