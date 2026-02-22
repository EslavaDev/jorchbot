import crypto from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

// --- Types (C.5) ---

/** Frame sent by the browser client */
export type WsRequestFrame = {
  type: "req";
  id: number;
  method: string;
  params?: Record<string, unknown>;
};

/** Frame sent by the server in response */
export type WsResponseFrame = {
  type: "res";
  id: number;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string };
};

/** Server-push event frame */
export type WsEventFrame = {
  type: "event";
  event: string;
  payload: unknown;
  seq: number;
};

/** Connected client metadata */
export type WsClient = {
  ws: WebSocket;
  id: string;
  clientName?: string;
  deviceId?: string;
  authenticated: boolean;
  connectedAt: number;
};

/** RPC method handler */
export type RpcHandler = (params: Record<string, unknown>, client: WsClient) => unknown;

// --- Events (C.12) ---

export const JB_EVENTS = [
  "jb.session.output",
  "jb.session.state",
  "jb.tunnel.state",
  "jb.proxy.state",
  "jb.device.paired",
  "jb.approval",
] as const;

// --- Server deps & return type (C.6) ---

export interface JorchBotWsServerDeps {
  httpServer: Server;
  handlers: Record<string, RpcHandler>;
  /** Whether device auth is required (gui.funnel = true) */
  requireAuth: boolean;
  /** Check if an IP is allowed (tailnet check when gui.funnel = false) */
  isIpAllowed: (ip: string) => boolean;
  /** Device auth callbacks (only needed when requireAuth = true) */
  deviceAuth?: DeviceAuthCallbacks;
}

export interface JorchBotWsServer {
  broadcast(event: string, payload: unknown): void;
  getConnectedClients(): WsClient[];
  close(): void;
}

// --- Device auth types (D.5) ---

/** Device credentials sent by the client during connect */
export interface DeviceConnectParams {
  publicKey: string;
  signature: string;
  nonce?: string;
}

/** Result of device verification */
export interface DeviceVerifyResult {
  ok: boolean;
  reason?: string;
  deviceId?: string;
  /** Token for the client to store (new device) */
  newToken?: string;
}

/** Callbacks for device auth (only used when requireAuth=true) */
export interface DeviceAuthCallbacks {
  /** Verify device signature and token */
  verifyDevice: (params: DeviceConnectParams) => Promise<DeviceVerifyResult>;
  /** Check if a device is on the blocklist */
  isDeviceBlocked: (deviceId: string) => boolean;
  /** Persist approved device token to settings table */
  persistDeviceToken: (deviceId: string, token: string) => void;
}

// --- Response helpers (C.10) ---

function sendResponse(ws: WebSocket, id: number, payload: unknown): void {
  const frame: WsResponseFrame = { type: "res", id, ok: true, payload };
  ws.send(JSON.stringify(frame));
}

function sendError(ws: WebSocket, id: number, code: string, message: string): void {
  const frame: WsResponseFrame = { type: "res", id, ok: false, error: { code, message } };
  ws.send(JSON.stringify(frame));
}

/** Send a server-push event to a single client */
function sendEvent(ws: WebSocket, event: string, payload: unknown, seq: number): void {
  const frame: WsEventFrame = { type: "event", event, payload, seq };
  ws.send(JSON.stringify(frame));
}

// --- Server implementation (C.6-C.14) ---

export function attachJorchBotWsServer(deps: JorchBotWsServerDeps): JorchBotWsServer {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Map<string, WsClient>();
  let eventSeq = 0;

  // C.7 — noServer WebSocket upgrade
  deps.httpServer.on("upgrade", (req: IncomingMessage, socket, head) => {
    const ip = req.socket.remoteAddress ?? "";
    if (!deps.requireAuth && !deps.isIpAllowed(ip)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  // C.8 — connection event
  wss.on("connection", (ws: WebSocket) => {
    const clientId = crypto.randomUUID();
    const client: WsClient = {
      ws,
      id: clientId,
      authenticated: false,
      connectedAt: Date.now(),
    };
    clients.set(clientId, client);

    // 10s handshake timeout — close with 4001 if connect not received
    const handshakeTimer = setTimeout(() => {
      if (!client.authenticated) {
        ws.close(4001, "Handshake timeout");
        clients.delete(clientId);
      }
    }, 10_000);

    // C.9 — message handler
    ws.on("message", (raw: Buffer) => {
      void handleMessage(raw, client, deps, handshakeTimer);
    });

    // C.14 — close and error cleanup
    ws.on("close", () => {
      clearTimeout(handshakeTimer);
      clients.delete(clientId);
    });

    ws.on("error", () => {
      clearTimeout(handshakeTimer);
      clients.delete(clientId);
    });
  });

  return {
    // C.13 — broadcast to authenticated clients
    broadcast(event: string, payload: unknown) {
      eventSeq++;
      const frame: WsEventFrame = { type: "event", event, payload, seq: eventSeq };
      const data = JSON.stringify(frame);
      for (const client of clients.values()) {
        if (client.authenticated && client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(data);
        }
      }
    },

    getConnectedClients() {
      return [...clients.values()].filter((c) => c.authenticated);
    },

    close() {
      for (const client of clients.values()) {
        client.ws.close();
      }
      clients.clear();
      wss.close();
    },
  };
}

// C.9 — message routing
async function handleMessage(
  raw: Buffer,
  client: WsClient,
  deps: JorchBotWsServerDeps,
  handshakeTimer: NodeJS.Timeout,
): Promise<void> {
  let frame: WsRequestFrame;
  try {
    frame = JSON.parse(raw.toString()) as WsRequestFrame;
  } catch {
    sendError(client.ws, 0, "PARSE_ERROR", "Invalid JSON");
    return;
  }

  if (frame.type !== "req") {
    return;
  }

  // The first message MUST be "connect"
  if (!client.authenticated) {
    if (frame.method !== "connect") {
      sendError(client.ws, frame.id, "AUTH_REQUIRED", "First message must be connect");
      return;
    }
    clearTimeout(handshakeTimer);

    // D.5 — Device auth when requireAuth = true (gui.funnel = true)
    if (deps.requireAuth && deps.deviceAuth) {
      const device = frame.params?.device as
        | { publicKey?: string; signature?: string; nonce?: string }
        | undefined;

      if (!device?.publicKey || !device?.signature) {
        // No device credentials → send challenge nonce for the client to sign
        const nonce = crypto.randomBytes(32).toString("base64url");
        sendEvent(client.ws, "connect.challenge", { nonce }, 0);
        return;
      }

      // Verify device signature
      const result = await deps.deviceAuth.verifyDevice({
        publicKey: device.publicKey,
        signature: device.signature,
        nonce: device.nonce,
      });

      if (!result.ok) {
        sendError(client.ws, frame.id, "AUTH_FAILED", result.reason ?? "Device auth failed");
        client.ws.close(4003, "Auth failed");
        return;
      }

      // D.6 — Check device blocklist
      if (result.deviceId && deps.deviceAuth.isDeviceBlocked(result.deviceId)) {
        sendError(client.ws, frame.id, "DEVICE_BLOCKED", `Device "${result.deviceId}" is blocked`);
        client.ws.close(4003, "Device blocked");
        return;
      }

      client.deviceId = result.deviceId;

      // D.7 — Persist token for new devices
      if (result.newToken && result.deviceId) {
        deps.deviceAuth.persistDeviceToken(result.deviceId, result.newToken);
      }
    }

    // C.11 — connect handler: authenticate and send hello-ok
    client.authenticated = true;
    client.clientName = (frame.params?.clientName as string) ?? undefined;

    const helloPayload: Record<string, unknown> = {
      type: "hello-ok",
      protocolVersion: 3,
      gateway: {
        version: "1.0.0",
        methods: Object.keys(deps.handlers),
        events: JB_EVENTS,
      },
    };
    sendResponse(client.ws, frame.id, helloPayload);
    return;
  }

  // Route to handler
  const handler = deps.handlers[frame.method];
  if (!handler) {
    sendError(client.ws, frame.id, "METHOD_NOT_FOUND", `Unknown method: ${frame.method}`);
    return;
  }

  try {
    const result = await handler(frame.params ?? {}, client);
    sendResponse(client.ws, frame.id, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendError(client.ws, frame.id, "INTERNAL", message);
  }
}
