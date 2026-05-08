// Look up the signed-in user's directory object ID via `/me?$select=id`.
//
// PIM activation/deactivation requests need the signed-in user's
// object ID as `principalId`. The token has it as a claim but we read
// it from Graph directly to avoid coupling the token shape to the tool
// layer. Tools should call this once per invocation.

import { GraphClient, HttpMethod, parseResponse } from "./client.js";
import { MeSchema } from "./types.js";

/** Returns the signed-in user's directory object ID. */
export async function getMyObjectId(client: GraphClient, signal: AbortSignal): Promise<string> {
  const path = "/me?$select=id";
  const res = await client.request(HttpMethod.GET, path, signal);
  const me = await parseResponse(res, MeSchema, "GET", path);
  return me.id;
}
