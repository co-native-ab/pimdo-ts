// Tests for the Microsoft Graph HTTP client.
//
// pimdo-ts has no PIM-specific Graph fake yet (mock-graph is added in
// phase 2), so these tests drive a small in-process http.createServer
// that returns canned handlers per request — enough to cover transport
// concerns: bearer auth, Content-Type, error envelopes, timeouts, and
// retry/backoff with Retry-After. PIM-shape Graph behaviour is covered
// by the mock-graph tests in phases 2-3.

import { describe, it, expect } from "vitest";
import http from "node:http";
import { z } from "zod";

import { testSignal } from "../helpers.js";
import {
  GraphClient,
  GraphResponseParseError,
  HttpMethod,
  RequestError,
  parseResponse,
} from "../../src/graph/client.js";

/** Start a local HTTP server that delegates each request to the next handler. */
async function makeServer(
  handlers: ((req: http.IncomingMessage, res: http.ServerResponse) => void)[],
): Promise<{ server: http.Server; url: string }> {
  let call = 0;
  const server = http.createServer((req, res) => {
    const handler = handlers[call] ?? handlers[handlers.length - 1];
    call++;
    handler!(req, res);
  });
  const url = await new Promise<string>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") {
        reject(new Error("unexpected address"));
        return;
      }
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
  return { server, url };
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}

const noDelay = (): Promise<void> => Promise.resolve();

describe("GraphClient transport", () => {
  it("sends Authorization Bearer header", async () => {
    let captured: string | undefined;
    const { server, url } = await makeServer([
      (req, res) => {
        captured = req.headers.authorization;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
      },
    ]);
    try {
      const client = new GraphClient(url, "test-token");
      const response = await client.request(HttpMethod.GET, "/me", testSignal());
      expect(response.status).toBe(200);
      expect(captured).toBe("Bearer test-token");
    } finally {
      await closeServer(server);
    }
  });

  it("sends Content-Type: application/json on JSON requests", async () => {
    let captured: string | undefined;
    const { server, url } = await makeServer([
      (req, res) => {
        captured = req.headers["content-type"];
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end("{}");
      },
    ]);
    try {
      const client = new GraphClient(url, "tok");
      const response = await client.request(HttpMethod.POST, "/post", { hi: 1 }, testSignal());
      expect(response.status).toBe(202);
      expect(captured).toBe("application/json");
    } finally {
      await closeServer(server);
    }
  });

  // Regression: Node's undici fetch defaults Accept-Language to "*", which
  // Microsoft Graph rejects on PIM endpoints with "CultureNotFoundException:
  // * is an invalid culture identifier". The client must override that.
  it("sends a well-formed Accept-Language header (not undici's default '*')", async () => {
    let captured: string | undefined;
    const { server, url } = await makeServer([
      (req, res) => {
        captured = req.headers["accept-language"];
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
      },
    ]);
    try {
      const client = new GraphClient(url, "tok");
      await client.request(HttpMethod.GET, "/me", testSignal());
      expect(captured).toBeDefined();
      expect(captured).not.toBe("*");
      expect(captured).toBe("en");
    } finally {
      await closeServer(server);
    }
  });

  it("throws RequestError on 4xx with proper code/message/method/path", async () => {
    const { server, url } = await makeServer([
      (_req, res) => {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "NotFound", message: "not found" } }));
      },
    ]);
    try {
      const client = new GraphClient(url, "tok");
      await expect(client.request(HttpMethod.GET, "/some/missing", testSignal())).rejects.toSatisfy(
        (err: unknown) => {
          const gre = err as RequestError;
          return (
            gre instanceof RequestError &&
            gre.resource === "graph" &&
            gre.statusCode === 404 &&
            gre.code === "NotFound" &&
            gre.responseMessage === "not found" &&
            gre.method === "GET" &&
            gre.path === "/some/missing"
          );
        },
      );
    } finally {
      await closeServer(server);
    }
  });

  it("handles unparseable error bodies gracefully (UnknownError)", async () => {
    const { server, url } = await makeServer([
      (_req, res) => {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("something went wrong");
      },
    ]);
    try {
      const client = new GraphClient(url, "tok");
      await expect(client.request(HttpMethod.GET, "/anything", testSignal())).rejects.toSatisfy(
        (err: unknown) => {
          const gre = err as RequestError;
          return (
            gre instanceof RequestError &&
            gre.resource === "graph" &&
            gre.code === "UnknownError" &&
            gre.responseMessage === "something went wrong" &&
            gre.statusCode === 500
          );
        },
      );
    } finally {
      await closeServer(server);
    }
  });
});

describe("GraphClient timeouts", () => {
  it("throws RequestError on request timeout", async () => {
    const { server, url } = await makeServer([
      () => {
        // Intentionally hang - never respond
      },
    ]);
    try {
      const timeoutClient = new GraphClient(url, "tok", 100);
      await expect(timeoutClient.request(HttpMethod.GET, "/hang", testSignal())).rejects.toSatisfy(
        (err: unknown) => {
          const gre = err as RequestError;
          return (
            gre instanceof RequestError &&
            gre.resource === "graph" &&
            gre.code === "TimeoutError" &&
            gre.responseMessage.includes("timed out")
          );
        },
      );
    } finally {
      await closeServer(server);
    }
  });
});

describe("GraphClient retry logic", () => {
  it("retries on 429 then succeeds", async () => {
    const { server, url } = await makeServer([
      (_req, res) => {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "TooManyRequests", message: "slow down" } }));
      },
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      },
    ]);
    try {
      const client = new GraphClient(url, "tok", 30000, 3, noDelay);
      const resp = await client.request(HttpMethod.GET, "/foo", testSignal());
      expect(resp.status).toBe(200);
    } finally {
      await closeServer(server);
    }
  });

  it("parses Retry-After header (seconds)", async () => {
    let capturedDelayMs = -1;
    const capturingDelay = (ms: number): Promise<void> => {
      capturedDelayMs = ms;
      return Promise.resolve();
    };
    const { server, url } = await makeServer([
      (_req, res) => {
        res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "1" });
        res.end(JSON.stringify({ error: { code: "TooManyRequests", message: "wait" } }));
      },
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      },
    ]);
    try {
      const client = new GraphClient(url, "tok", 30000, 3, capturingDelay);
      await client.request(HttpMethod.GET, "/foo", testSignal());
      expect(capturedDelayMs).toBe(1000);
    } finally {
      await closeServer(server);
    }
  });

  it("does not retry on 400/404", async () => {
    let callCount = 0;
    const { server, url } = await makeServer([
      (_req, res) => {
        callCount++;
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "NotFound", message: "nope" } }));
      },
    ]);
    try {
      const client = new GraphClient(url, "tok", 30000, 3, noDelay);
      await expect(client.request(HttpMethod.GET, "/foo", testSignal())).rejects.toThrow(
        RequestError,
      );
      expect(callCount).toBe(1);
    } finally {
      await closeServer(server);
    }
  });

  it("throws after max retries are exhausted", async () => {
    let callCount = 0;
    const { server, url } = await makeServer([
      (_req, res) => {
        callCount++;
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "ServiceUnavailable", message: "try again" } }));
      },
    ]);
    try {
      const client = new GraphClient(url, "tok", 30000, 2, noDelay);
      await expect(client.request(HttpMethod.GET, "/foo", testSignal())).rejects.toThrow(
        RequestError,
      );
      expect(callCount).toBe(3); // 1 initial + 2 retries
    } finally {
      await closeServer(server);
    }
  });

  it("throws TypeError when called with a body but no AbortSignal", async () => {
    const client = new GraphClient("https://example.invalid", "tok");
    await expect(
      // Force the bad shape: a non-AbortSignal third arg with no fourth arg.
      // This is not reachable through the public overloads but guards the
      // implementation signature.
      (
        client.request as unknown as (
          method: HttpMethod,
          path: string,
          bodyOrSignal: unknown,
          signal?: AbortSignal,
        ) => Promise<Response>
      )(HttpMethod.POST, "/x", { hi: 1 }),
    ).rejects.toThrow(TypeError);
  });
});

describe("parseResponse", () => {
  it("parses and validates a JSON body against a Zod schema", async () => {
    const schema = z.object({ id: z.string(), n: z.number() });
    const response = new Response(JSON.stringify({ id: "abc", n: 42 }), { status: 200 });
    await expect(parseResponse(response, schema)).resolves.toEqual({ id: "abc", n: 42 });
  });

  it("throws GraphResponseParseError on invalid JSON", async () => {
    const schema = z.object({ id: z.string() });
    const response = new Response("not json", { status: 200 });
    await expect(parseResponse(response, schema)).rejects.toBeInstanceOf(GraphResponseParseError);
  });

  it("throws GraphResponseParseError when the body fails schema validation", async () => {
    const schema = z.object({ id: z.string() });
    const response = new Response(JSON.stringify({ id: 123 }), { status: 200 });
    await expect(parseResponse(response, schema)).rejects.toBeInstanceOf(GraphResponseParseError);
  });
});
