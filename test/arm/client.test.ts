// Tests for the Azure Resource Manager HTTP client. Mirrors the shape
// of test/graph/client.test.ts: a small in-process http server returns
// canned handlers per request, exercised against ArmClient to cover
// bearer auth, error envelopes, retry/backoff with Retry-After, and
// timeouts.

import { describe, it, expect } from "vitest";
import http from "node:http";
import { z } from "zod";

import { testSignal } from "../helpers.js";
import {
  ArmClient,
  ArmRequestError,
  ArmResponseParseError,
  HttpMethod,
  parseResponse,
} from "../../src/arm/client.js";

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

describe("ArmClient transport", () => {
  it("sends Authorization Bearer header from the credential", async () => {
    let captured: string | undefined;
    const { server, url } = await makeServer([
      (req, res) => {
        captured = req.headers.authorization;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
      },
    ]);
    try {
      const client = new ArmClient(url, {
        getToken: () => Promise.resolve("arm-token"),
      });
      const response = await client.request(
        HttpMethod.GET,
        "/subscriptions?api-version=2022-12-01",
        testSignal(),
      );
      expect(response.status).toBe(200);
      expect(captured).toBe("Bearer arm-token");
    } finally {
      await closeServer(server);
    }
  });

  it("sends Content-Type application/json on requests with a body", async () => {
    let captured: string | undefined;
    const { server, url } = await makeServer([
      (req, res) => {
        captured = req.headers["content-type"];
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end("{}");
      },
    ]);
    try {
      const client = new ArmClient(url, "arm-token");
      const response = await client.request(
        HttpMethod.PUT,
        "/some/resource?api-version=2022-12-01",
        { body: 1 },
        testSignal(),
      );
      expect(response.status).toBe(202);
      expect(captured).toBe("application/json");
    } finally {
      await closeServer(server);
    }
  });

  // Mirrors the GraphClient regression: undici's default Accept-Language
  // of "*" is rejected by some Microsoft endpoints as an invalid culture.
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
      const client = new ArmClient(url, "arm-token");
      await client.request(HttpMethod.GET, "/subscriptions?api-version=2022-12-01", testSignal());
      expect(captured).toBeDefined();
      expect(captured).not.toBe("*");
      expect(captured).toBe("en");
    } finally {
      await closeServer(server);
    }
  });

  it("strips trailing slashes from baseUrl", async () => {
    let capturedPath: string | undefined;
    const { server, url } = await makeServer([
      (req, res) => {
        capturedPath = req.url;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
      },
    ]);
    try {
      const client = new ArmClient(`${url}//`, "arm-token");
      await client.request(HttpMethod.GET, "/subs", testSignal());
      expect(capturedPath).toBe("/subs");
    } finally {
      await closeServer(server);
    }
  });

  it("throws ArmRequestError on 4xx with parsed code/message", async () => {
    const { server, url } = await makeServer([
      (_req, res) => {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "AuthorizationFailed", message: "no rights" } }));
      },
    ]);
    try {
      const client = new ArmClient(url, "arm-token");
      await expect(
        client.request(HttpMethod.GET, "/subscriptions/x?api-version=2022-12-01", testSignal()),
      ).rejects.toSatisfy((err: unknown) => {
        const are = err as ArmRequestError;
        return (
          are instanceof ArmRequestError &&
          are.statusCode === 403 &&
          are.code === "AuthorizationFailed" &&
          are.armMessage === "no rights" &&
          are.method === "GET"
        );
      });
    } finally {
      await closeServer(server);
    }
  });

  it("falls back to UnknownError on unparseable error bodies", async () => {
    const { server, url } = await makeServer([
      (_req, res) => {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("boom");
      },
    ]);
    try {
      const client = new ArmClient(url, "arm-token");
      await expect(client.request(HttpMethod.GET, "/foo", testSignal())).rejects.toSatisfy(
        (err: unknown) => {
          const are = err as ArmRequestError;
          return (
            are instanceof ArmRequestError &&
            are.code === "UnknownError" &&
            are.armMessage === "boom" &&
            are.statusCode === 500
          );
        },
      );
    } finally {
      await closeServer(server);
    }
  });
});

describe("ArmClient timeouts", () => {
  it("throws ArmRequestError with TimeoutError code", async () => {
    const { server, url } = await makeServer([
      () => {
        // Hang
      },
    ]);
    try {
      const client = new ArmClient(url, "arm-token", 100);
      await expect(client.request(HttpMethod.GET, "/hang", testSignal())).rejects.toSatisfy(
        (err: unknown) => {
          const are = err as ArmRequestError;
          return (
            are instanceof ArmRequestError &&
            are.code === "TimeoutError" &&
            are.armMessage.includes("timed out")
          );
        },
      );
    } finally {
      await closeServer(server);
    }
  });
});

describe("ArmClient retry logic", () => {
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
      const client = new ArmClient(url, "arm-token", 30000, 3, noDelay);
      const resp = await client.request(HttpMethod.GET, "/foo", testSignal());
      expect(resp.status).toBe(200);
    } finally {
      await closeServer(server);
    }
  });

  it("retries on 503", async () => {
    const { server, url } = await makeServer([
      (_req, res) => {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "ServiceUnavailable", message: "later" } }));
      },
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      },
    ]);
    try {
      const client = new ArmClient(url, "arm-token", 30000, 3, noDelay);
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
        res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "2" });
        res.end(JSON.stringify({ error: { code: "TooManyRequests", message: "wait" } }));
      },
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      },
    ]);
    try {
      const client = new ArmClient(url, "arm-token", 30000, 3, capturingDelay);
      await client.request(HttpMethod.GET, "/foo", testSignal());
      expect(capturedDelayMs).toBe(2000);
    } finally {
      await closeServer(server);
    }
  });

  it("does not retry on 404", async () => {
    let callCount = 0;
    const { server, url } = await makeServer([
      (_req, res) => {
        callCount++;
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "NotFound", message: "nope" } }));
      },
    ]);
    try {
      const client = new ArmClient(url, "arm-token", 30000, 3, noDelay);
      await expect(client.request(HttpMethod.GET, "/foo", testSignal())).rejects.toThrow(
        ArmRequestError,
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
        res.writeHead(504, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "GatewayTimeout", message: "gone" } }));
      },
    ]);
    try {
      const client = new ArmClient(url, "arm-token", 30000, 2, noDelay);
      await expect(client.request(HttpMethod.GET, "/foo", testSignal())).rejects.toThrow(
        ArmRequestError,
      );
      expect(callCount).toBe(3);
    } finally {
      await closeServer(server);
    }
  });
});

describe("parseResponse (arm)", () => {
  it("parses and validates a JSON body against a Zod schema", async () => {
    const schema = z.object({ id: z.string(), n: z.number() });
    const response = new Response(JSON.stringify({ id: "abc", n: 42 }), { status: 200 });
    await expect(parseResponse(response, schema)).resolves.toEqual({ id: "abc", n: 42 });
  });

  it("throws ArmResponseParseError on invalid JSON", async () => {
    const schema = z.object({ id: z.string() });
    const response = new Response("not json", { status: 200 });
    await expect(parseResponse(response, schema)).rejects.toBeInstanceOf(ArmResponseParseError);
  });

  it("throws ArmResponseParseError when the body fails schema validation", async () => {
    const schema = z.object({ id: z.string() });
    const response = new Response(JSON.stringify({ id: 123 }), { status: 200 });
    await expect(parseResponse(response, schema)).rejects.toBeInstanceOf(ArmResponseParseError);
  });
});
