// Shared HTTP-server boilerplate for the Microsoft Graph and Azure
// Resource Manager mocks (`test/mock-graph.ts`, `test/mock-arm.ts`).
//
// Each concrete mock plugs in its own route handler and error-envelope
// shape; everything else (listening on an ephemeral port, JSON read/write,
// 404/500 wrapping) lives here.

import http from "node:http";

/** Minimal handler signature: per-request work runs inside try/catch in the base. */
export type MockRouteHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
) => Promise<void>;

/**
 * Spin up a localhost HTTP server bound to an ephemeral port and resolve
 * with the live `http.Server` plus its `http://127.0.0.1:<port>` URL.
 *
 * The supplied `handle` is invoked for every request; uncaught errors are
 * funnelled into a 500 response via `writeErrorEnvelope` if the headers
 * have not been sent yet.
 */
export function startMockServer(
  handle: MockRouteHandler,
  writeErrorEnvelope: (
    res: http.ServerResponse,
    status: number,
    code: string,
    message: string,
  ) => void,
): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      void handle(req, res).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        if (!res.headersSent) writeErrorEnvelope(res, 500, "InternalError", message);
        else res.end();
      });
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") {
        reject(new Error("unexpected server address"));
        return;
      }
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

/** Write a JSON response with the given status. */
export function jsonResponse(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/** Read the request body as JSON; returns `{}` for empty bodies. */
export async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf-8");
  if (text.length === 0) return {};
  return JSON.parse(text) as Record<string, unknown>;
}
