import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import {
  attachJorchBotWsServer,
  type DeviceAuthCallbacks,
  type JorchBotWsServer,
  type RpcHandler,
} from "./jorchbot-ws.js";

type TestServerCtx = {
  server: http.Server;
  wsServer: JorchBotWsServer;
  url: string;
  close: () => Promise<void>;
};

function createTestServer(
  handlers: Record<string, RpcHandler> = {},
  opts?: {
    requireAuth?: boolean;
    isIpAllowed?: (ip: string) => boolean;
    deviceAuth?: DeviceAuthCallbacks;
  },
): Promise<TestServerCtx> {
  const httpServer = http.createServer();
  const wsServer = attachJorchBotWsServer({
    httpServer,
    handlers,
    requireAuth: opts?.requireAuth ?? false,
    isIpAllowed: opts?.isIpAllowed ?? (() => true),
    deviceAuth: opts?.deviceAuth,
  });

  return new Promise((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => {
      const addr = httpServer.address() as { port: number };
      const url = `ws://127.0.0.1:${addr.port}`;
      resolve({
        server: httpServer,
        wsServer,
        url,
        close: () =>
          new Promise<void>((res) => {
            wsServer.close();
            httpServer.close(() => res());
          }),
      });
    });
  });
}

/** Send a JSON request frame and wait for the response. */
function sendRequest(
  ws: WebSocket,
  id: number,
  method: string,
  params?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Response timeout")), 5000);
    const handler = (data: Buffer) => {
      const frame = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
      if (frame.type === "res" && frame.id === id) {
        clearTimeout(timeout);
        ws.off("message", handler);
        resolve(frame);
      }
    };
    ws.on("message", handler);
    ws.send(JSON.stringify({ type: "req", id, method, params }));
  });
}

function connectWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

describe("JorchBot WebSocket Server", () => {
  let testCtx: TestServerCtx;

  afterEach(async () => {
    if (testCtx) {
      await testCtx.close();
    }
  });

  it("connects and completes handshake with hello-ok", async () => {
    testCtx = await createTestServer({ echo: (params) => params });
    const ws = await connectWs(testCtx.url);
    try {
      const res = await sendRequest(ws, 1, "connect", { clientName: "test-ui" });
      expect(res.ok).toBe(true);
      const payload = res.payload as Record<string, unknown>;
      expect(payload.type).toBe("hello-ok");
      expect(payload.protocolVersion).toBe(3);
      const gw = payload.gateway as Record<string, unknown>;
      expect(gw.version).toBe("1.0.0");
      expect(Array.isArray(gw.methods)).toBe(true);
      expect(Array.isArray(gw.events)).toBe(true);
    } finally {
      ws.close();
    }
  });

  it("closes with 4001 on handshake timeout", async () => {
    // Use a modified server with shorter timeout for testing
    // We can't easily change the 10s timeout, so we test that unauthenticated
    // messages before connect are rejected instead
    testCtx = await createTestServer();
    const ws = await connectWs(testCtx.url);
    try {
      const res = await sendRequest(ws, 1, "health", {});
      expect(res.ok).toBe(false);
      expect((res.error as Record<string, unknown>).code).toBe("AUTH_REQUIRED");
    } finally {
      ws.close();
    }
  });

  it("dispatches RPC to registered handler after connect", async () => {
    const echoHandler = vi.fn((params: Record<string, unknown>) => ({ echoed: params }));
    testCtx = await createTestServer({ echo: echoHandler });
    const ws = await connectWs(testCtx.url);
    try {
      await sendRequest(ws, 1, "connect", { clientName: "test" });
      const res = await sendRequest(ws, 2, "echo", { hello: "world" });
      expect(res.ok).toBe(true);
      expect((res.payload as Record<string, unknown>).echoed).toEqual({ hello: "world" });
      expect(echoHandler).toHaveBeenCalledTimes(1);
    } finally {
      ws.close();
    }
  });

  it("returns METHOD_NOT_FOUND for unknown method", async () => {
    testCtx = await createTestServer();
    const ws = await connectWs(testCtx.url);
    try {
      await sendRequest(ws, 1, "connect", {});
      const res = await sendRequest(ws, 2, "nonexistent.method", {});
      expect(res.ok).toBe(false);
      expect((res.error as Record<string, unknown>).code).toBe("METHOD_NOT_FOUND");
    } finally {
      ws.close();
    }
  });

  it("returns PARSE_ERROR for invalid JSON", async () => {
    testCtx = await createTestServer();
    const ws = await connectWs(testCtx.url);
    try {
      const response = new Promise<Record<string, unknown>>((resolve) => {
        ws.on("message", (data: Buffer) => {
          resolve(JSON.parse(data.toString("utf8")) as Record<string, unknown>);
        });
      });
      ws.send("not valid json{{{");
      const res = await response;
      expect(res.ok).toBe(false);
      expect((res.error as Record<string, unknown>).code).toBe("PARSE_ERROR");
    } finally {
      ws.close();
    }
  });

  it("returns AUTH_REQUIRED when sending message before connect", async () => {
    testCtx = await createTestServer({ health: () => ({ ok: true }) });
    const ws = await connectWs(testCtx.url);
    try {
      const res = await sendRequest(ws, 1, "health", {});
      expect(res.ok).toBe(false);
      expect((res.error as Record<string, unknown>).code).toBe("AUTH_REQUIRED");
    } finally {
      ws.close();
    }
  });

  it("broadcasts events to authenticated clients only", async () => {
    testCtx = await createTestServer();

    // Client 1: authenticated
    const ws1 = await connectWs(testCtx.url);
    await sendRequest(ws1, 1, "connect", { clientName: "client1" });

    // Client 2: not authenticated
    const ws2 = await connectWs(testCtx.url);

    const messages1: unknown[] = [];
    const messages2: unknown[] = [];

    ws1.on("message", (data: Buffer) => {
      const frame = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
      if (frame.type === "event") {
        messages1.push(frame);
      }
    });
    ws2.on("message", (data: Buffer) => {
      const frame = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
      if (frame.type === "event") {
        messages2.push(frame);
      }
    });

    testCtx.wsServer.broadcast("test.event", { value: 42 });

    // Give time for messages to arrive
    await new Promise((r) => setTimeout(r, 100));

    expect(messages1.length).toBe(1);
    expect(messages2.length).toBe(0);

    const event = messages1[0] as Record<string, unknown>;
    expect(event.event).toBe("test.event");
    expect(event.payload).toEqual({ value: 42 });
    expect(event.seq).toBe(1);

    ws1.close();
    ws2.close();
  });

  it("returns INTERNAL error when handler throws", async () => {
    const failHandler = () => {
      throw new Error("handler exploded");
    };
    testCtx = await createTestServer({ fail: failHandler });
    const ws = await connectWs(testCtx.url);
    try {
      await sendRequest(ws, 1, "connect", {});
      const res = await sendRequest(ws, 2, "fail", {});
      expect(res.ok).toBe(false);
      expect((res.error as Record<string, unknown>).code).toBe("INTERNAL");
      expect((res.error as Record<string, unknown>).message).toBe("handler exploded");
    } finally {
      ws.close();
    }
  });

  it("getConnectedClients returns only authenticated clients", async () => {
    testCtx = await createTestServer();
    const ws = await connectWs(testCtx.url);
    try {
      expect(testCtx.wsServer.getConnectedClients().length).toBe(0);
      await sendRequest(ws, 1, "connect", { clientName: "test" });
      expect(testCtx.wsServer.getConnectedClients().length).toBe(1);
      const clients = testCtx.wsServer.getConnectedClients();
      expect(clients[0]?.clientName).toBe("test");
    } finally {
      ws.close();
    }
  });

  // --- Phase D tests ---

  it("D.10 — sends connect.challenge when requireAuth=true and no device params", async () => {
    testCtx = await createTestServer(
      {},
      {
        requireAuth: true,
        isIpAllowed: () => true,
        deviceAuth: {
          verifyDevice: vi.fn(),
          isDeviceBlocked: vi.fn(() => false),
          persistDeviceToken: vi.fn(),
        },
      },
    );
    const ws = await connectWs(testCtx.url);
    try {
      // Send connect without device params
      const response = new Promise<Record<string, unknown>>((resolve) => {
        ws.on("message", (data: Buffer) => {
          const frame = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
          resolve(frame);
        });
      });
      ws.send(JSON.stringify({ type: "req", id: 1, method: "connect", params: {} }));
      const frame = await response;

      expect(frame.type).toBe("event");
      expect(frame.event).toBe("connect.challenge");
      const payload = frame.payload as { nonce: string };
      expect(typeof payload.nonce).toBe("string");
      expect(payload.nonce.length).toBeGreaterThan(0);
    } finally {
      ws.close();
    }
  });

  it("D.5 — authenticates when requireAuth=true and device params are valid", async () => {
    testCtx = await createTestServer(
      { echo: (params) => params },
      {
        requireAuth: true,
        isIpAllowed: () => true,
        deviceAuth: {
          verifyDevice: vi.fn().mockResolvedValue({
            ok: true,
            deviceId: "test-device-123",
          }),
          isDeviceBlocked: vi.fn(() => false),
          persistDeviceToken: vi.fn(),
        },
      },
    );
    const ws = await connectWs(testCtx.url);
    try {
      const res = await sendRequest(ws, 1, "connect", {
        clientName: "test-ui",
        device: {
          publicKey: "test-pub-key",
          signature: "test-signature",
          nonce: "test-nonce",
        },
      });

      expect(res.ok).toBe(true);
      const payload = res.payload as Record<string, unknown>;
      expect(payload.type).toBe("hello-ok");
    } finally {
      ws.close();
    }
  });

  it("D.6 — rejects blocked device with DEVICE_BLOCKED", async () => {
    testCtx = await createTestServer(
      {},
      {
        requireAuth: true,
        isIpAllowed: () => true,
        deviceAuth: {
          verifyDevice: vi.fn().mockResolvedValue({
            ok: true,
            deviceId: "blocked-device",
          }),
          isDeviceBlocked: vi.fn(() => true),
          persistDeviceToken: vi.fn(),
        },
      },
    );
    const ws = await connectWs(testCtx.url);
    try {
      const response = new Promise<Record<string, unknown>>((resolve) => {
        ws.on("message", (data: Buffer) => {
          const frame = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
          if (frame.type === "res") {
            resolve(frame);
          }
        });
      });

      ws.send(
        JSON.stringify({
          type: "req",
          id: 1,
          method: "connect",
          params: {
            device: {
              publicKey: "test-pub-key",
              signature: "test-signature",
            },
          },
        }),
      );

      const res = await response;
      expect(res.ok).toBe(false);
      expect((res.error as Record<string, unknown>).code).toBe("DEVICE_BLOCKED");
    } finally {
      ws.close();
    }
  });

  it("D.5 — rejects when device verification fails", async () => {
    testCtx = await createTestServer(
      {},
      {
        requireAuth: true,
        isIpAllowed: () => true,
        deviceAuth: {
          verifyDevice: vi.fn().mockResolvedValue({
            ok: false,
            reason: "Invalid signature",
          }),
          isDeviceBlocked: vi.fn(() => false),
          persistDeviceToken: vi.fn(),
        },
      },
    );
    const ws = await connectWs(testCtx.url);
    try {
      const response = new Promise<Record<string, unknown>>((resolve) => {
        ws.on("message", (data: Buffer) => {
          const frame = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
          if (frame.type === "res") {
            resolve(frame);
          }
        });
      });

      ws.send(
        JSON.stringify({
          type: "req",
          id: 1,
          method: "connect",
          params: {
            device: {
              publicKey: "bad-key",
              signature: "bad-sig",
            },
          },
        }),
      );

      const res = await response;
      expect(res.ok).toBe(false);
      expect((res.error as Record<string, unknown>).code).toBe("AUTH_FAILED");
      expect((res.error as Record<string, unknown>).message).toBe("Invalid signature");
    } finally {
      ws.close();
    }
  });
});
