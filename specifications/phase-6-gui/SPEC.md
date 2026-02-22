# Phase 6 — GUI de Configuracion

> **Status**: Pending
> **Dependency**: Phase 4 (completed — tunnels), Phase 2 (completed — multi-session), Phase 3 (completed — Jorchfile)
> **Deliverable**: Web dashboard (Lit 3.x) served from the gateway, with WebSocket RPC, device auth, branding, tab management, and workspace/tunnel/Jorchfile GUI
> **When finished**: Open `http://<device>.tailnet.ts.net:18789` from your phone (in the tailnet) and see active workspaces with context %, live logs, tunnel status, and Jorchfile editor. `/gui` sends the URL to WhatsApp. `/gui funnel on` exposes the GUI to the internet with device auth.

---

## Table of Contents

1. [WHY — Why this phase](#1-why--why-this-phase)
2. [WHAT — What is delivered](#2-what--what-is-delivered)
3. [Architecture Overview](#3-architecture-overview)
4. [Configuration Schema](#4-configuration-schema)
5. [Error Definitions](#5-error-definitions)
6. [Sub-phase 6A — Mount Control UI on Gateway](#6-sub-phase-6a--mount-control-ui-on-gateway)
7. [Sub-phase 6B — Re-branding OpenClaw → JorchBot](#7-sub-phase-6b--re-branding-openclaw--jorchbot)
8. [Sub-phase 6C — WebSocket Server](#8-sub-phase-6c--websocket-server)
9. [Sub-phase 6D — Device Auth & gui.funnel](#9-sub-phase-6d--device-auth--guifunnel)
10. [Sub-phase 6E — Tab Management](#10-sub-phase-6e--tab-management)
11. [Sub-phase 6F — Adapt Existing Tabs](#11-sub-phase-6f--adapt-existing-tabs)
12. [Sub-phase 6G — Tab Workspaces](#12-sub-phase-6g--tab-workspaces)
13. [Sub-phase 6H — Tab Tunnels + FunnelProxy](#13-sub-phase-6h--tab-tunnels--funnelproxy)
14. [Sub-phase 6I — Tab Devices](#14-sub-phase-6i--tab-devices)
15. [Sub-phase 6J — Tab Jorchfile](#15-sub-phase-6j--tab-jorchfile)
16. [Sub-phase 6K — /gui Command + Funnel Toggle](#16-sub-phase-6k--gui-command--funnel-toggle)
17. [Sub-phase 6L — Mobile Responsive](#17-sub-phase-6l--mobile-responsive)
18. [DB Schema Changes](#18-db-schema-changes)
19. [Testing Strategy](#19-testing-strategy)
20. [Acceptance Criteria](#20-acceptance-criteria)

---

## 1. WHY — Why this phase

Phases 1–5 built a fully functional remote development tool controlled exclusively via WhatsApp. All configuration, monitoring, and management happens through chat commands (`/new`, `/list`, `/mode`, `/tunnel`, etc.) and text output.

This works but has **three fundamental limitations**:

1. **Chat is linear** — monitoring 3 running sessions, 4 tunnels, and context % requires `/list`, `/tunnels`, `/status` — one-at-a-time, each consuming WhatsApp message space.
2. **Configuration is blind** — editing `~/.jorchbot/jorchbot.json` or the Jorchfile requires shell access. There's no visual editor, no validation feedback, no live preview.
3. **Device management is CLI-only** — approving device pairing (`jorchbot device approve 847293`) requires terminal access. If you're on your phone via WhatsApp, you can't approve a new browser accessing the GUI.

A web dashboard solves all three by providing:

- **At-a-glance monitoring** — workspaces, context %, tunnels, logs in a single view
- **Visual configuration** — edit Jorchfile projects, toggle tunnels, manage devices
- **Mobile accessibility** — usable from a phone browser via Tailscale VPN mesh (private by default) or Funnel (public with device auth)

### What is built

1. **Control UI mounted on gateway** — the existing OpenClaw Lit 3.x SPA, served from port 18789
2. **Re-branding** — all "OpenClaw" references replaced with "JorchBot"
3. **WebSocket server** — minimal WS server with RPC protocol compatible with the existing UI client
4. **Device auth + `gui.funnel`** — tailnet IP restriction (default) or device auth for public Funnel
5. **Tab management** — 6 tabs hidden, 6 adapted, 3 new (workspaces, tunnels, jorchfile)
6. **New tabs** — Workspaces (CRUD, focus, context gauge), Tunnels (Serve/Funnel + FunnelProxy routes), Devices (extends nodes with blacklist), Jorchfile (visual editor)
7. **`/gui` command** — sends URL to WhatsApp, toggles Funnel with 4-digit confirmation
8. **Mobile responsive** — usable on 320px–428px screens

### What is NOT built (later phases / out of scope)

- API key management (Phase 8)
- TOTP 2FA (Phase 8 — device auth is sufficient for Phase 6)
- Analytics / usage metrics dashboard
- Dark/light theme toggle (inherits OpenClaw theme system as-is)
- Push notifications from the GUI
- Chat interface in the GUI (WhatsApp/Telegram is the chat channel)
- Custom domains for Funnel (Tailscale limitation)

---

## 2. WHAT — What is delivered

### 2.1 Two-layer architecture (GUI-specific)

```
LAYER 1 (reuse from OpenClaw):
  - Control UI framework (Lit 3.x + Vite 7.x)
  - Asset serving from gateway (handleControlUiHttpRequest)
  - WebSocket client (GatewayBrowserClient) with auto-reconnect
  - Device auth (ECDSA P-256 challenge-response)
  - i18n system
  - CSS design system (variables, fonts, shadows)

LAYER 2 (build for JorchBot):
  - WebSocket server in jorchbot-start.ts (src/gateway/jorchbot-ws.ts)
  - Re-branding (40+ changes across ui/ and src/)
  - New tabs: workspaces, tunnels, jorchfile, devices (extended)
  - RPC handlers: ~25 jb.* methods + ~20 adapted OpenClaw methods
  - gui.funnel config + tailnet IP middleware
  - /gui command (chat)
```

### 2.2 Access model

| Mode                  | Config               | Access                        | Auth                      | When                                        |
| --------------------- | -------------------- | ----------------------------- | ------------------------- | ------------------------------------------- |
| **Tailnet** (default) | `gui.funnel = false` | VPN mesh only (100.64.0.0/10) | None needed               | Personal use on your own devices            |
| **Funnel** (opt-in)   | `gui.funnel = true`  | Public internet               | Device auth (ECDSA P-256) | Share with external, or when not on tailnet |

In both modes: `/webhooks/*`, `/health`, and `/__jorchbot/*` always pass without restriction (Kapso needs public webhooks).

### 2.3 Tab strategy

| Tab                 | Decision | Source                                           |
| ------------------- | -------- | ------------------------------------------------ |
| overview            | ADAPT    | Workspace summary, context %, tunnels, uptime    |
| sessions            | ADAPT    | JorchBot sessions from DB + ClaudeRunner state   |
| channels            | ADAPT    | Kapso/Telegram status                            |
| config              | KEEP     | Visual editor for `jorchbot.json` (both layers)  |
| debug               | KEEP     | Gateway health + diagnostics                     |
| logs                | KEEP     | Real-time log viewer                             |
| nodes → **devices** | EXTEND   | Device pairing + blacklist + exec approvals      |
| chat                | HIDE     | JorchBot uses WhatsApp, not web chat             |
| instances           | HIDE     | OpenClaw instance presence, N/A                  |
| usage               | HIDE     | Simplified into overview                         |
| cron                | HIDE     | Not relevant                                     |
| agents              | HIDE     | OpenClaw multi-agent, N/A                        |
| skills              | HIDE     | OpenClaw skills, N/A                             |
| **workspaces**      | NEW      | CRUD, focus model, context gauge, commands       |
| **tunnels**         | NEW      | Serve/Funnel list + FunnelProxy route management |
| **jorchfile**       | NEW      | Visual Jorchfile editor (requires Phase 3)       |

---

## 3. Architecture Overview

### 3.1 Request flow

```
Browser on phone (Tailscale VPN mesh)
  │
  ├─ HTTP GET /* ──────────────────→ Express middleware chain:
  │    1. /webhooks/*           → Kapso webhook handlers (always pass)
  │    2. /health               → Health check (always pass)
  │    3. /api/tool-approval/*  → Claude Code hook API (existing)
  │    4. /api/documents/*      → Document storage (existing)
  │    5. GUI access middleware  → Check gui.funnel + IP/auth
  │    6. /__jorchbot/*         → Bootstrap config (always pass)
  │    7. /*                    → Control UI SPA (handleControlUiHttpRequest)
  │
  └─ WS upgrade ──────────────────→ jorchbot-ws.ts:
       1. GUI access check (same as HTTP)
       2. WebSocket handshake
       3. connect RPC (challenge-response if gui.funnel=true)
       4. hello-ok with system snapshot
       5. Bidirectional: RPC requests + server-push events
```

### 3.2 File layout (new/modified files)

```
src/gateway/
  jorchbot-start.ts          # MODIFY — mount Control UI + WS server
  jorchbot-ws.ts             # NEW — WebSocket server + RPC dispatcher
  jorchbot-ws-handlers.ts    # NEW — RPC method implementations
  jorchbot-ws-events.ts      # NEW — Event broadcasting helpers
  tailnet-ip.ts              # NEW — isTailnetIp() helper
  gui-access.ts              # NEW — Express middleware for gui.funnel
  control-ui-contract.ts     # MODIFY — change path to /__jorchbot/

src/config/
  jorchbot-config.ts         # MODIFY — add gui.funnel field

src/errors/
  index.ts                   # MODIFY — add GUI error classes

src/db/
  schema.ts                  # MODIFY — add device_blacklist table

ui/
  index.html                 # MODIFY — title, custom element
  src/ui/app.ts              # MODIFY — class name, custom element
  src/ui/app-render.ts       # MODIFY — branding, logo, links
  src/ui/app-gateway.ts      # MODIFY — client name
  src/ui/navigation.ts       # MODIFY — tab filtering + new tabs
  src/ui/storage.ts          # MODIFY — localStorage key
  src/ui/device-auth.ts      # MODIFY — localStorage key
  src/ui/device-identity.ts  # MODIFY — localStorage key
  src/styles/base.css        # MODIFY — accent color, element selector
  src/i18n/lib/translate.ts  # MODIFY — localStorage key
  src/i18n/locales/*.ts      # MODIFY — config path references
  src/ui/views/jb-workspaces.ts  # NEW — Workspaces tab component
  src/ui/views/jb-tunnels.ts     # NEW — Tunnels tab component
  src/ui/views/jb-jorchfile.ts   # NEW — Jorchfile tab component
  public/favicon.svg             # REPLACE — JorchBot logo
```

---

## 4. Configuration Schema

### 4.1 New `gui` section in JorchBotConfigSchema

```typescript
// src/config/jorchbot-config.ts — addition

const GuiSchema = z.object({
  /** Expose GUI to the internet via Tailscale Funnel.
   *  When false (default), only tailnet IPs (100.64.0.0/10) can access the GUI.
   *  When true, device auth (ECDSA P-256) protects the GUI. */
  funnel: z.boolean().default(false),
});

export const JorchBotConfigSchema = z.object({
  gateway: GatewaySchema.default(GatewaySchema.parse({})),
  db: DbSchema.default(DbSchema.parse({})),
  channels: ChannelsSchema.default(ChannelsSchema.parse({})),
  tunnels: TunnelsSchema.default(TunnelsSchema.parse({})),
  approvals: ApprovalsSchema.default(ApprovalsSchema.parse({})),
  sessions: SessionsSchema.default(SessionsSchema.parse({})),
  gui: GuiSchema.default(GuiSchema.parse({})), // NEW
});
```

**Why a separate `gui` section?** The `gui.funnel` field controls a security boundary (tailnet-only vs public internet). It deserves its own namespace rather than being buried inside `gateway` or `tunnels`. Future Phase 8 may add `gui.totp`, `gui.sessionTimeout`, etc.

### 4.2 Updated config.json example

```jsonc
// ~/.jorchbot/jorchbot.json (relevant section)
{
  "gateway": {
    "port": 18789,
    "host": "127.0.0.1",
  },
  "jorchbot": {
    "gui": {
      "funnel": false,
    },
    // ... other sections unchanged
  },
}
```

---

## 5. Error Definitions

Add to `src/errors/index.ts`:

```typescript
// --- GUI errors (Phase 6) ---

/** WebSocket server failed to start or attach to HTTP server */
export class WsServerStartError extends JorchBotError {
  constructor(cause?: unknown) {
    super("Failed to start WebSocket server", {
      cause: cause instanceof Error ? cause : undefined,
    });
  }
}

/** WebSocket RPC method not found */
export class WsMethodNotFoundError extends JorchBotError {
  constructor(method: string) {
    super(`Unknown RPC method: "${method}"`);
  }
}

/** WebSocket RPC handler threw an error */
export class WsRpcError extends JorchBotError {
  constructor(method: string, cause?: unknown) {
    super(`RPC handler for "${method}" failed`, {
      cause: cause instanceof Error ? cause : undefined,
    });
  }
}

/** WebSocket connect handshake failed (auth, protocol, etc.) */
export class WsConnectError extends JorchBotError {
  constructor(reason: string) {
    super(`WebSocket connect failed: ${reason}`);
  }
}

/** GUI access denied (not on tailnet, no device auth) */
export class GuiAccessDeniedError extends JorchBotError {
  constructor(ip: string, reason: string) {
    super(`GUI access denied for ${ip}: ${reason}`);
  }
}

/** Device blocked (on blacklist) */
export class DeviceBlockedError extends JorchBotError {
  constructor(deviceId: string) {
    super(`Device "${deviceId}" is blocked`);
  }
}

/** /gui funnel toggle confirmation failed (wrong code, expired) */
export class GuiFunnelConfirmationError extends JorchBotError {
  constructor(reason: string) {
    super(`Funnel toggle failed: ${reason}`);
  }
}
```

---

## 6. Sub-phase 6A — Mount Control UI on Gateway

### 6A.1 WHY

The gateway (`jorchbot-start.ts`) currently serves only:

- `GET/POST /webhooks/kapso`
- `GET /health`
- `POST /api/tool-approval/*`
- `GET /api/documents/*`

It does NOT serve the Control UI. The Lit SPA is built and sitting in `dist/control-ui/` but nothing mounts it.

### 6A.2 WHAT

Mount `handleControlUiHttpRequest` from `src/gateway/control-ui.ts` as Express middleware, AFTER all existing routes, so the SPA serves as a catch-all.

### 6A.3 HOW

```typescript
// src/gateway/jorchbot-start.ts — additions

import { handleControlUiHttpRequest } from "./control-ui.js";
import { resolveControlUiRootSync } from "../infra/control-ui-assets.js";

// Inside startGateway(), after all existing route definitions:

// --- Phase 6: Control UI ---
const controlUiRoot = resolveControlUiRootSync({});

if (controlUiRoot) {
  // Mount Control UI as final middleware (SPA catch-all).
  // All specific routes (/webhooks, /health, /api/*) are registered above
  // and take priority. This serves static assets + index.html fallback.
  app.use((req, res, next) => {
    const handled = handleControlUiHttpRequest(req, res, {
      controlUiRoot,
      basePath: "",
      assistantName: "JorchBot",
      bootstrapConfigPath: "/__jorchbot/control-ui-config.json",
    });
    if (!handled) {
      next();
    }
  });
  console.log(`[jorchbot] Control UI mounted at http://${host}:${port}/`);
} else {
  console.warn("[jorchbot] Control UI assets not found — run 'pnpm ui:build'");
}
```

### 6A.4 Bootstrap config path

Modify `src/gateway/control-ui-contract.ts`:

```typescript
// BEFORE
export const CONTROL_UI_BOOTSTRAP_CONFIG_PATH = "/__openclaw/control-ui-config.json";

// AFTER
export const CONTROL_UI_BOOTSTRAP_CONFIG_PATH = "/__jorchbot/control-ui-config.json";
```

The `handleControlUiHttpRequest` function accepts `bootstrapConfigPath` as an option, so we pass `"/__jorchbot/control-ui-config.json"` in the mount call above. The `assistantName` is set to `"JorchBot"` via the options.

### 6A.5 Build pipeline

The existing build pipeline works as-is:

```bash
pnpm ui:build    # Vite → dist/control-ui/
```

`resolveControlUiRootSync` already searches `dist/control-ui/` relative to multiple locations (import.meta.url, cwd, package.json). No changes needed.

### 6A.6 Acceptance criteria

- `http://localhost:18789/` loads the Lit SPA
- `/__jorchbot/control-ui-config.json` returns `{ assistantName: "JorchBot", ... }`
- `/webhooks/kapso`, `/health`, `/api/*` still work (not intercepted by SPA)
- Static assets (JS, CSS) load with correct MIME types
- Unknown paths return `index.html` (SPA client-side routing)

---

## 7. Sub-phase 6B — Re-branding OpenClaw → JorchBot

### 7B.1 WHY

The Control UI displays "OpenClaw" in the title, logo, colors, localStorage keys, i18n strings, and code references. Users should see "JorchBot" everywhere.

### 7B.2 WHAT — Complete branding inventory

The full inventory is documented in `docs/gui-jorchbot.md` section 3. Key changes:

**HTML (`ui/index.html`)**:

```html
<!-- BEFORE -->
<title>OpenClaw Control</title>
<openclaw-app></openclaw-app>

<!-- AFTER -->
<title>JorchBot Control</title>
<jorchbot-app></jorchbot-app>
```

**Root component (`ui/src/ui/app.ts`)**:

```typescript
// BEFORE
window.__OPENCLAW_CONTROL_UI_BASE_PATH__
@customElement("openclaw-app")
export class OpenClawApp extends LitElement

// AFTER
window.__JORCHBOT_CONTROL_UI_BASE_PATH__
@customElement("jorchbot-app")
export class JorchBotApp extends LitElement
```

**CSS (`ui/src/styles/base.css`)**:

```css
/* BEFORE */
--accent: #ff5c5c;
--primary: #ff5c5c;
openclaw-app {
  display: block;
}

/* AFTER */
--accent: #6366f1; /* Indigo — JorchBot brand color */
--primary: #6366f1;
jorchbot-app {
  display: block;
}
```

**Light mode CSS**:

```css
/* BEFORE */
--accent: #dc2626;
--primary: #dc2626;

/* AFTER */
--accent: #4f46e5; /* Indigo-600 for light mode */
--primary: #4f46e5;
```

**localStorage keys**:

```typescript
// storage.ts:      "openclaw.control.settings.v1" → "jorchbot.control.settings.v1"
// device-auth.ts:  "openclaw.device.auth.v1"      → "jorchbot.device.auth.v1"
// device-identity: "openclaw-device-identity-v1"   → "jorchbot-device-identity-v1"
// translate.ts:    "openclaw.i18n.locale"          → "jorchbot.i18n.locale"
```

**Gateway client name (`ui/src/ui/app-gateway.ts`)**:

```typescript
// BEFORE
clientName: "openclaw-control-ui";

// AFTER
clientName: "jorchbot-control-ui";
```

**Render branding (`ui/src/ui/app-render.ts`)**:

```typescript
// Logo alt text: "OpenClaw" → "JorchBot"
// Brand title: "OPENCLAW" → "JORCHBOT"
// Subtitle: "Gateway Dashboard" → "Remote Dev"
// Docs link: "https://docs.openclaw.ai" → remove or point to JorchBot repo
```

**i18n locales** — all locale files referencing `~/.openclaw/openclaw.json`:

```typescript
// BEFORE: "Edit ~/.openclaw/openclaw.json safely."
// AFTER:  "Edit ~/.jorchbot/config.json safely."
```

**Server-side**:

```typescript
// control-ui-contract.ts: "/__openclaw/..." → "/__jorchbot/..."
// (already done in 6A)
```

**Export filenames**:

```typescript
// usage.ts: "openclaw-usage-*" → "jorchbot-usage-*"
// app-scroll.ts: "openclaw-logs-*" → "jorchbot-logs-*"
```

**Favicons**: Replace `ui/public/favicon.svg`, `favicon-32.png`, `apple-touch-icon.png` with JorchBot logo.

**Tests**:

```typescript
// navigation.browser.test.ts:
// window.__OPENCLAW_CONTROL_UI_BASE_PATH__ → window.__JORCHBOT_CONTROL_UI_BASE_PATH__
```

### 7B.3 HOW

These are all find-and-replace operations. Apply them file by file, using the exact line numbers from `docs/gui-jorchbot.md` section 3. Rebuild UI after changes: `pnpm ui:build`.

### 7B.4 Acceptance criteria

- Title bar shows "JorchBot Control"
- Brand area shows "JORCHBOT" with indigo accent color
- No visible "OpenClaw" text anywhere in the UI
- localStorage uses `jorchbot.*` keys (old `openclaw.*` keys ignored gracefully)
- `pnpm check` passes (including UI workspace)

---

## 8. Sub-phase 6C — WebSocket Server

### 8C.1 WHY

The Control UI communicates exclusively via WebSocket RPC. Without a WS server, the UI loads but can't connect to the backend. The OpenClaw gateway's WS server (`src/gateway/server/ws-connection.ts`) is too heavy — it depends on multi-agent, canvas host, node management, and ~104 RPC methods. JorchBot needs a minimal WS server that implements only the ~45 methods it needs.

### 8C.2 WHAT

A new file `src/gateway/jorchbot-ws.ts` that:

1. Attaches to the existing Express HTTP server via `upgrade` event
2. Handles the `connect` handshake (protocol negotiation, optional device auth)
3. Routes RPC requests to handlers
4. Broadcasts events to connected clients
5. Manages client lifecycle (connect, disconnect, reconnect)

### 8C.3 HOW

#### 8C.3.1 Core types

```typescript
// src/gateway/jorchbot-ws.ts

import type { IncomingMessage } from "node:http";
import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";

/** Frame sent by the browser client */
type WsRequestFrame = {
  type: "req";
  id: number;
  method: string;
  params?: Record<string, unknown>;
};

/** Frame sent by the server in response */
type WsResponseFrame = {
  type: "res";
  id: number;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string };
};

/** Server-push event frame */
type WsEventFrame = {
  type: "event";
  event: string;
  payload: unknown;
  seq: number;
  stateVersion?: { presence?: number; health?: number };
};

/** Connected client metadata */
type WsClient = {
  ws: WebSocket;
  id: string;
  clientName?: string;
  deviceId?: string;
  authenticated: boolean;
  connectedAt: number;
};

/** RPC method handler */
type RpcHandler = (params: Record<string, unknown>, client: WsClient) => Promise<unknown> | unknown;

/** Map of method name → handler */
type RpcHandlers = Record<string, RpcHandler>;
```

#### 8C.3.2 Server attachment

```typescript
export interface JorchBotWsServerDeps {
  httpServer: Server;
  handlers: RpcHandlers;
  /** Whether device auth is required (gui.funnel = true) */
  requireAuth: boolean;
  /** Check if an IP is allowed (tailnet check when gui.funnel = false) */
  isIpAllowed: (ip: string) => boolean;
}

export function attachJorchBotWsServer(deps: JorchBotWsServerDeps): JorchBotWsServer {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Map<string, WsClient>();
  let eventSeq = 0;

  deps.httpServer.on("upgrade", (req: IncomingMessage, socket, head) => {
    // Check IP restriction before upgrading
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

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const clientId = crypto.randomUUID();
    const client: WsClient = {
      ws,
      id: clientId,
      authenticated: false,
      connectedAt: Date.now(),
    };
    clients.set(clientId, client);

    // Handshake timeout: client must send `connect` within 10 seconds
    const handshakeTimer = setTimeout(() => {
      if (!client.authenticated) {
        ws.close(4001, "Handshake timeout");
        clients.delete(clientId);
      }
    }, 10_000);

    ws.on("message", (raw: Buffer) => {
      void handleMessage(raw, client, deps, handshakeTimer);
    });

    ws.on("close", () => {
      clearTimeout(handshakeTimer);
      clients.delete(clientId);
    });

    ws.on("error", () => {
      clearTimeout(handshakeTimer);
      clients.delete(clientId);
    });
  });

  // ... message handling and broadcast implementation

  return {
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
      wss.close();
    },
  };
}
```

#### 8C.3.3 Message handling

```typescript
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

  if (frame.type !== "req") return;

  // The first message MUST be "connect"
  if (!client.authenticated) {
    if (frame.method !== "connect") {
      sendError(client.ws, frame.id, "AUTH_REQUIRED", "First message must be connect");
      return;
    }
    clearTimeout(handshakeTimer);
    // Handle connect (see 6D for auth flow)
    client.authenticated = true;
    client.clientName = (frame.params?.clientName as string) ?? undefined;
    sendResponse(client.ws, frame.id, buildHelloPayload());
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

function sendResponse(ws: WebSocket, id: number, payload: unknown): void {
  const frame: WsResponseFrame = { type: "res", id, ok: true, payload };
  ws.send(JSON.stringify(frame));
}

function sendError(ws: WebSocket, id: number, code: string, message: string): void {
  const frame: WsResponseFrame = { type: "res", id, ok: false, error: { code, message } };
  ws.send(JSON.stringify(frame));
}
```

#### 8C.3.4 Hello payload

The `connect` response must match what the existing UI client expects:

```typescript
function buildHelloPayload(): Record<string, unknown> {
  return {
    type: "hello-ok",
    protocolVersion: 3,
    gateway: {
      version: "1.0.0", // JorchBot version
      methods: Object.keys(allHandlers),
      events: JB_EVENTS,
    },
  };
}

const JB_EVENTS = [
  "jb.session.output",
  "jb.session.state",
  "jb.tunnel.state",
  "jb.proxy.state",
  "jb.device.paired",
  "jb.approval",
] as const;
```

#### 8C.3.5 Integration with jorchbot-start.ts

```typescript
// src/gateway/jorchbot-start.ts — changes

import { attachJorchBotWsServer } from "./jorchbot-ws.js";
import { buildRpcHandlers } from "./jorchbot-ws-handlers.js";
import { isTailnetIp } from "./tailnet-ip.js";

// Replace app.listen() with:
const server = app.listen(port, host, () => {
  console.log(`[jorchbot] gateway ready on ${host}:${port}`);
});

// Attach WebSocket server
const handlers = buildRpcHandlers({
  sessionManager,
  tunnelManager,
  jorchfileExecutor: () => jorchfileExecutor,
  config,
  getUptime: () => Math.floor((Date.now() - startTime) / 1000),
});

const wsServer = attachJorchBotWsServer({
  httpServer: server,
  handlers,
  requireAuth: config.gui.funnel,
  isIpAllowed: (ip) => isTailnetIp(ip),
});

// Wire session/tunnel events to WebSocket broadcast
sessionManager.on("stateChange", (project, state) => {
  wsServer.broadcast("jb.session.state", { project, ...state });
});
sessionManager.on("output", (project, text) => {
  wsServer.broadcast("jb.session.output", { project, text });
});
tunnelManager.on("tunnelEvent", (event) => {
  wsServer.broadcast("jb.tunnel.state", event);
});
```

> **Note**: SessionManager and TunnelManager don't currently extend EventEmitter. Sub-phase 6C will add event emission to both classes. This is a focused change: add `extends EventEmitter` and `this.emit()` calls at state change points.

### 8C.4 Acceptance criteria

- UI connects via WebSocket, completes `connect` handshake, shows connected status
- RPC calls work: `config.get` returns the current config
- Server-push events arrive in the UI (e.g., session state changes)
- Auto-reconnect works: kill and restart gateway → UI reconnects within 15s
- Multiple browser tabs connect simultaneously without interference

---

## 9. Sub-phase 6D — Device Auth & gui.funnel

### 9D.1 WHY

The gateway (port 18789) is exposed to the network. When `gui.funnel = false`, only tailnet devices should access the GUI. When `gui.funnel = true`, the GUI is public and needs authentication.

### 9D.2 WHAT — Tailnet IP detection

```typescript
// src/gateway/tailnet-ip.ts

/** Tailscale CGNAT range: 100.64.0.0/10 */
const TAILSCALE_CGNAT_PREFIX = 0x64400000; // 100.64.0.0
const TAILSCALE_CGNAT_MASK = 0xffc00000; // /10

/**
 * Check if an IP address belongs to the Tailscale CGNAT range (100.64.0.0/10).
 * Handles IPv4-mapped IPv6 addresses (::ffff:100.x.x.x).
 */
export function isTailnetIp(ip: string): boolean {
  // Handle IPv4-mapped IPv6 (::ffff:100.x.x.x) and IPv6 loopback (::1)
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;

  // Also allow loopback for local development
  if (v4 === "127.0.0.1" || ip === "::1") return true;

  const parts = v4.split(".");
  if (parts.length !== 4) return false;

  const nums = parts.map(Number);
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;

  const ipNum = (nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3];
  return (ipNum & TAILSCALE_CGNAT_MASK) === TAILSCALE_CGNAT_PREFIX;
}
```

### 9D.3 WHAT — GUI access middleware

```typescript
// src/gateway/gui-access.ts

import type { NextFunction, Request, Response } from "express";
import type { JorchBotConfig } from "../config/jorchbot-config.js";
import { isTailnetIp } from "./tailnet-ip.js";

/** Paths that always pass without any access check */
const BYPASS_PREFIXES = ["/webhooks/", "/health", "/__jorchbot/", "/api/"];

/**
 * Express middleware that enforces GUI access based on gui.funnel config.
 *
 * When gui.funnel = false: only tailnet IPs (100.64.0.0/10) + loopback pass.
 * When gui.funnel = true: all IPs pass (device auth happens at WebSocket level).
 *
 * @throws {GuiAccessDeniedError} — never thrown as middleware; sends 403 directly.
 */
export function createGuiAccessMiddleware(getConfig: () => JorchBotConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Always allow bypass paths
    if (BYPASS_PREFIXES.some((p) => req.path.startsWith(p))) {
      next();
      return;
    }

    const config = getConfig();

    // gui.funnel = true → all IPs allowed (device auth at WS level)
    if (config.gui.funnel) {
      next();
      return;
    }

    // gui.funnel = false → tailnet IPs only
    const ip = req.ip ?? req.socket.remoteAddress ?? "";
    if (isTailnetIp(ip)) {
      next();
      return;
    }

    res.status(403).json({ error: "Access denied. GUI restricted to tailnet." });
  };
}
```

### 9D.4 WHAT — Device auth (WebSocket level)

When `gui.funnel = true`, the `connect` handshake includes device auth:

1. Server sends `connect.challenge` event with a random nonce
2. Client signs `version|deviceId|clientId|...|nonce` with Ed25519 private key
3. Server verifies signature with the device's stored public key
4. If new device → server sends pairing code (6 digits), user approves via CLI or GUI

The existing OpenClaw device auth implementation in `src/gateway/device-auth.ts` (builds signed payloads) and `ui/src/ui/device-identity.ts` (generates Ed25519 keys) + `ui/src/ui/device-auth.ts` (stores tokens) already implement this flow. JorchBot reuses it.

**Implementation**: In the `connect` handler of `jorchbot-ws.ts`, when `config.gui.funnel = true`:

```typescript
// Inside handleConnect() in jorchbot-ws.ts

if (deps.requireAuth) {
  const devicePublicKey = connectParams.device?.publicKey;
  const signature = connectParams.device?.signature;
  const nonce = connectParams.device?.nonce;

  if (!devicePublicKey || !signature) {
    // Send challenge nonce for the client to sign
    const challenge = crypto.randomBytes(32).toString("base64url");
    sendEvent(client.ws, "connect.challenge", { nonce: challenge });
    return; // Client will reconnect with signed nonce
  }

  // Verify signature using stored device tokens
  // Reuse OpenClaw's device auth verification logic
  const verified = await verifyDeviceAuth(devicePublicKey, signature, nonce);
  if (!verified.ok) {
    sendError(client.ws, frame.id, "AUTH_FAILED", verified.reason);
    client.ws.close(4003, "Auth failed");
    return;
  }

  client.deviceId = verified.deviceId;

  // If new device, return token for storage
  if (verified.newToken) {
    // Include token in hello-ok payload for the client to store
    sendResponse(client.ws, frame.id, {
      ...buildHelloPayload(),
      deviceAuth: { token: verified.newToken },
    });
    return;
  }
}
```

### 9D.5 Integration

```typescript
// src/gateway/jorchbot-start.ts — additions

import { createGuiAccessMiddleware } from "./gui-access.js";

// Mount BEFORE Control UI, AFTER existing API routes:
app.use(createGuiAccessMiddleware(() => config));
```

### 9D.6 Acceptance criteria

- `gui.funnel = false` + IP outside 100.64.0.0/10 → 403 Forbidden
- `gui.funnel = false` + IP 100.100.x.x → passes, UI loads
- `gui.funnel = false` + localhost (127.0.0.1) → passes (development)
- `gui.funnel = true` + any IP → UI loads, WS requires device auth
- `/webhooks/kapso` always works regardless of `gui.funnel`
- `/health` always works regardless of `gui.funnel`

---

## 10. Sub-phase 6E — Tab Management

### 10E.1 WHAT

Hide 6 irrelevant tabs, add 3 new tabs, rename "nodes" to "devices". This is done via configuration in `navigation.ts`, NOT by deleting code.

### 10E.2 HOW

```typescript
// ui/src/ui/navigation.ts — modifications

// Existing Tab type needs new entries
export type Tab =
  | "chat" | "overview" | "channels" | "instances" | "sessions"
  | "usage" | "cron" | "agents" | "skills" | "nodes"
  | "config" | "debug" | "logs"
  // JorchBot additions:
  | "workspaces" | "tunnels" | "jorchfile";

const HIDDEN_TABS: ReadonlySet<Tab> = new Set([
  "chat", "instances", "usage", "cron", "agents", "skills",
]);

// Original TAB_GROUPS remain unchanged (for upstream merge-ability).
// Add JorchBot-specific groups:
const JB_TAB_GROUPS: Array<{ label: string; tabs: Tab[] }> = [
  { label: "jorchbot", tabs: ["overview", "workspaces", "sessions"] },
  { label: "infrastructure", tabs: ["tunnels", "channels"] },
  { label: "configuration", tabs: ["jorchfile", "config"] },
  { label: "system", tabs: ["nodes", "debug", "logs"] }, // "nodes" displayed as "Devices"
];

/**
 * Visible tab groups for JorchBot.
 * Filters out hidden tabs and remaps labels.
 */
export const VISIBLE_TAB_GROUPS = JB_TAB_GROUPS.map((group) => ({
  ...group,
  tabs: group.tabs.filter((tab) => !HIDDEN_TABS.has(tab)),
})).filter((group) => group.tabs.length > 0);

// Title mapping for renamed/new tabs
const JB_TAB_TITLES: Partial<Record<Tab, string>> = {
  nodes: "Devices",      // Renamed from "Nodes"
  workspaces: "Workspaces",
  tunnels: "Tunnels",
  jorchfile: "Jorchfile",
};

export function titleForTab(tab: Tab): string {
  return JB_TAB_TITLES[tab] ?? /* existing i18n lookup */;
}
```

### 10E.3 Acceptance criteria

- Only relevant tabs visible: overview, workspaces, sessions, tunnels, channels, jorchfile, config, devices, debug, logs
- Navigating to `/chat` (hidden tab URL) shows a "not found" or redirects to overview — no crash
- "nodes" tab shows as "Devices" in sidebar
- Tab groups are reorganized for JorchBot context

---

## 11. Sub-phase 6F — Adapt Existing Tabs

### 11F.1 Overview tab

Connect to JorchBot data instead of OpenClaw data:

- **Workspaces summary**: list active sessions from `SessionManager.listActive()` via `jb.workspaces.list` RPC
- **Context gauge**: per-workspace context % from `sessions` table
- **Active tunnels**: count from `TunnelManager.list()` via `jb.tunnels.list` RPC
- **Uptime**: from `jb.status` RPC

### 11F.2 Sessions tab

Adapt existing sessions view to show JorchBot sessions:

```typescript
// RPC handler for sessions.list — adapted
"sessions.list": async () => {
  const sessions = sessionManager.listActive();
  return {
    sessions: sessions.map((s) => ({
      key: s.id,
      label: s.project,
      mode: s.mode,
      outputMode: s.outputMode,
      contextPercent: s.contextPercent,
      focused: s.focused,
      status: s.status,
      createdAt: s.createdAt,
    })),
  };
},
```

### 11F.3 Channels tab

Show Kapso/Telegram connection status:

```typescript
// RPC handler for channels.status — adapted
"channels.status": async () => {
  return {
    channels: [
      {
        id: "kapso",
        name: "WhatsApp (Kapso)",
        enabled: config.channels.kapso.enabled,
        status: config.channels.kapso.enabled ? "connected" : "disabled",
        webhookUrl: `http://${host}:${port}/webhooks/kapso`,
      },
      {
        id: "telegram",
        name: "Telegram",
        enabled: config.channels.telegram.enabled,
        status: config.channels.telegram.enabled ? "connected" : "disabled",
      },
    ],
  };
},
```

### 11F.4 Config tab

The existing config tab uses `config.get`/`config.set` RPC. Adapt to load/save `jorchbot.json`:

```typescript
"config.get": async () => {
  const config = loadConfig();
  return { config: JSON.stringify(config, null, 2) };
},

"config.set": async (params) => {
  const raw = params.config as string;
  const parsed = JorchBotConfigSchema.parse(JSON.parse(raw));
  saveConfig(parsed);
  return { ok: true };
},
```

### 11F.5 Logs and Debug tabs

Connect to gateway console output. The logs tab already uses `logs.tail` RPC — implement a handler that reads from gateway log buffer:

```typescript
"logs.tail": async (params) => {
  const limit = (params.limit as number) ?? 100;
  const logs = logBuffer.tail(limit);
  return { logs };
},
```

### 11F.6 Acceptance criteria

- Overview shows workspace cards with context % gauges
- Sessions tab lists all active sessions with mode/status
- Channels tab shows Kapso enabled/disabled
- Config tab loads and saves `jorchbot.json`
- Logs tab shows real-time gateway output

---

## 12. Sub-phase 6G — Tab Workspaces

### 12G.1 WHY

The workspaces tab is the primary GUI feature — visual management of JorchBot projects that replaces `/list`, `/new`, `/switch`, `/stop` chat commands.

### 12G.2 WHAT — Workspace type

```typescript
// Matches the GUI's view of a workspace, assembled from multiple sources:
// - Session DB table
// - ClaudeRunner state (context %)
// - FocusModel (focused flag)
// - Jorchfile (commands)
type WorkspaceView = {
  id: string;
  name: string; // project name
  path: string; // filesystem path
  systemPrompt?: string;
  allowedTools?: string[];
  mode: "confirm" | "plan" | "auto";
  outputMode: "verbose" | "summary" | "silent";
  enabled: boolean; // active vs paused
  focused: boolean;
  contextPercent: number;
  status: "running" | "stopped" | "error" | "paused";
  lastMessage?: string;
  lastMessageAt?: number;
  commands: WorkspaceCommand[];
};

type WorkspaceCommand = {
  name: string; // no slash, e.g., "deploy"
  command: string; // shell command
  description?: string;
};
```

### 12G.3 RPC Methods

```typescript
// src/gateway/jorchbot-ws-handlers.ts — workspace handlers

"jb.workspaces.list": async () => {
  const active = sessionManager.listActive();
  const workspaces: WorkspaceView[] = active.map((session) => ({
    id: session.id,
    name: session.project,
    path: session.path,
    mode: session.mode,
    outputMode: session.outputMode,
    enabled: session.status !== "paused",
    focused: session.focused,
    contextPercent: session.contextPercent,
    status: session.status,
    lastMessage: session.lastMessage,
    lastMessageAt: session.lastMessageAt,
    commands: getProjectCommands(session.project),
  }));
  return { workspaces };
},

"jb.workspaces.get": async (params) => {
  const id = params.id as string;
  const session = sessionManager.get(id);
  if (!session) throw new SessionNotFoundError(id);
  return { workspace: buildWorkspaceView(session) };
},

"jb.session.focus": async (params) => {
  const project = params.project as string;
  // Focus model requires a phone — use a synthetic "gui" phone for GUI-initiated focus
  sessionManager.setFocused("gui", project);
  return { ok: true };
},

"jb.session.compact": async (params) => {
  const project = params.project as string;
  await sessionManager.compact(project);
  return { ok: true };
},

"jb.session.stop": async (params) => {
  const project = params.project as string;
  await sessionManager.stopByProject(project);
  return { ok: true };
},

"jb.session.restart": async (params) => {
  const project = params.project as string;
  const session = sessionManager.getByProject(project);
  if (!session) throw new SessionNotFoundError(project);
  await sessionManager.stopByProject(project);
  await sessionManager.create({
    project,
    path: session.path,
    systemPrompt: session.systemPrompt,
    allowedTools: session.allowedTools,
    initialMode: session.mode,
    initialOutputMode: session.outputMode,
  });
  return { ok: true };
},
```

### 12G.4 Lit component

```typescript
// ui/src/ui/views/jb-workspaces.ts

import { html, css, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

@customElement("jb-workspaces")
export class JbWorkspaces extends LitElement {
  @state() workspaces: WorkspaceView[] = [];
  @state() loading = true;

  async connectedCallback() {
    super.connectedCallback();
    await this.loadWorkspaces();
  }

  async loadWorkspaces() {
    this.loading = true;
    const result = await this.gateway.request("jb.workspaces.list", {});
    this.workspaces = result.workspaces;
    this.loading = false;
  }

  private renderWorkspaceCard(ws: WorkspaceView) {
    const contextColor =
      ws.contextPercent >= 90
        ? "var(--danger)"
        : ws.contextPercent >= 70
          ? "var(--warn)"
          : "var(--ok)";

    return html`
      <div class="workspace-card ${ws.focused ? "focused" : ""}">
        <div class="card-header">
          <span class="status-dot ${ws.status}"></span>
          <span class="name">${ws.name}</span>
          ${ws.focused ? html`<span class="badge">focused</span>` : ""}
        </div>
        <div class="path">${ws.path}</div>
        <div class="context-bar">
          <div
            class="context-fill"
            style="width:${ws.contextPercent}%;background:${contextColor}"
          ></div>
          <span class="context-label">${ws.contextPercent}%</span>
        </div>
        <div class="mode">${ws.mode} + ${ws.outputMode}</div>
        <div class="actions">
          ${ws.focused ? "" : html`<button @click=${() => this.focus(ws.name)}>Focus</button>`}
          <button @click=${() => this.compact(ws.name)}>Compact</button>
          <button @click=${() => this.stop(ws.name)}>Stop</button>
        </div>
      </div>
    `;
  }

  // ... action methods: focus(), compact(), stop(), restart()
}
```

### 12G.5 Real-time updates

The workspaces tab subscribes to `jb.session.state` events to update context % and status without polling:

```typescript
// In jb-workspaces.ts
this.gateway.on(
  "jb.session.state",
  (payload: { project: string; contextPercent: number; status: string }) => {
    const ws = this.workspaces.find((w) => w.name === payload.project);
    if (ws) {
      ws.contextPercent = payload.contextPercent;
      ws.status = payload.status;
      this.requestUpdate();
    }
  },
);
```

### 12G.6 Acceptance criteria

- Workspace cards show name, path, context %, mode, status
- Context bar is green (<70%), amber (70-89%), red (≥90%)
- Focus button changes the focused session
- Compact button triggers context compaction
- Stop button stops the ClaudeRunner
- Real-time context % updates without page refresh

---

## 13. Sub-phase 6H — Tab Tunnels + FunnelProxy

### 13H.1 RPC Methods

```typescript
"jb.tunnels.list": async () => {
  const tunnels = tunnelManager.list();
  return { tunnels };
},

"jb.tunnels.create": async (params) => {
  const input = TunnelStartInputSchema.parse(params);
  const tunnel = await tunnelManager.start(input);
  return { tunnel };
},

"jb.tunnels.delete": async (params) => {
  const tunnelId = params.tunnelId as string;
  await tunnelManager.stop(tunnelId);
  return { ok: true };
},

"jb.proxy.routes.list": async () => {
  const funnelProxy = tunnelManager.getFunnelProxy();
  return { routes: funnelProxy.listRoutes() };
},

"jb.proxy.routes.add": async (params) => {
  const path = params.path as string;
  const target = params.target as string;
  const funnelProxy = tunnelManager.getFunnelProxy();
  funnelProxy.addRoute(path, target);
  return { ok: true };
},

"jb.proxy.routes.remove": async (params) => {
  const path = params.path as string;
  const funnelProxy = tunnelManager.getFunnelProxy();
  funnelProxy.removeRoute(path);
  return { ok: true };
},

"jb.proxy.status": async () => {
  const funnelProxy = tunnelManager.getFunnelProxy();
  return {
    running: funnelProxy.isRunning(),
    port: funnelProxy.getPort(),
    routeCount: funnelProxy.listRoutes().length,
  };
},
```

### 13H.2 `/proxy/` prefix enforcement

Per the Phase 6 doc, all FunnelProxy routes must have the `/proxy/` prefix. Modify `FunnelProxy.addRoute()`:

```typescript
// src/tunnels/funnel-proxy.ts — modification

addRoute(path: string, target: string): void {
  const normalized = this.normalizePath(path);
  if (this.routes.has(normalized)) {
    throw new FunnelProxyRouteConflictError(normalized);
  }
  this.routes.set(normalized, target);
}

private normalizePath(path: string): string {
  // Ensure /proxy/ prefix
  let p = path.startsWith("/") ? path : `/${path}`;
  if (!p.startsWith("/proxy/")) {
    p = `/proxy${p}`;
  }
  // Remove trailing slash
  return p.endsWith("/") && p.length > 1 ? p.slice(0, -1) : p;
}
```

### 13H.3 Lit component

```typescript
// ui/src/ui/views/jb-tunnels.ts

@customElement("jb-tunnels")
export class JbTunnels extends LitElement {
  @state() tunnels: TunnelInfo[] = [];
  @state() proxyRoutes: Array<{ path: string; target: string }> = [];
  @state() proxyStatus = { running: false, port: 0, routeCount: 0 };

  // Render tunnel list with Serve/Funnel badges, URLs, stop buttons
  // Render proxy routes section with add/remove buttons
  // Subscribe to jb.tunnel.state and jb.proxy.state events
}
```

### 13H.4 Acceptance criteria

- Tunnel list shows all active tunnels with URLs
- Private (Serve) and public (Funnel) tunnels are visually differentiated
- Create/stop tunnels from GUI
- FunnelProxy routes visible with health status
- Add/remove proxy routes from GUI
- All proxy routes have `/proxy/` prefix

---

## 14. Sub-phase 6I — Tab Devices

### 14I.1 WHAT

Extend the existing "nodes" tab with JorchBot-specific device management.

### 14I.2 New RPC methods

```typescript
"jb.devices.block": async (params) => {
  const deviceId = params.deviceId as string;
  blockDevice(deviceId); // Persists to DB
  return { ok: true };
},

"jb.devices.unblock": async (params) => {
  const deviceId = params.deviceId as string;
  unblockDevice(deviceId);
  return { ok: true };
},
```

### 14I.3 Device blacklist table

```typescript
// src/db/schema.ts — addition

export const deviceBlacklist = sqliteTable("device_blacklist", {
  deviceId: text("device_id").primaryKey(),
  reason: text("reason"),
  blockedAt: integer("blocked_at", { mode: "timestamp" }).notNull(),
});
```

### 14I.4 Acceptance criteria

- Tab renamed from "Nodes" to "Devices"
- Approved devices listed with last access info
- Block/unblock buttons work
- Pending pairing requests visible with approve/reject/block buttons
- Badge shows when devices are pending approval

---

## 15. Sub-phase 6J — Tab Jorchfile

### 15J.1 WHAT

Visual editor for the Jorchfile. Renders each PROJECT as an expandable section with editable fields.

### 15J.2 RPC Methods

```typescript
"jb.jorchfile.get": async () => {
  const executor = getJorchfileExecutor();
  if (!executor) return { jorchfile: null };
  const jorchfile = executor.getJorchfile();
  return {
    jorchfile: {
      projects: jorchfile.projects.map((p) => ({
        name: p.name,
        path: p.path,
        commands: p.commands,
        instructions: p.instructions,
        approve: p.approve,
        output: p.output,
        port: p.port,
        tunnel: p.tunnel,
      })),
      settings: jorchfile.settings,
    },
  };
},

"jb.jorchfile.set": async (params) => {
  const content = params.content as string;
  // Write raw Jorchfile content to disk.
  // The JorchfileWatcher will detect the change and hot-reload.
  const jorchfilePath = resolveJorchfilePath();
  writeFileSync(jorchfilePath, content, { mode: 0o600 });
  return { ok: true };
},
```

### 15J.3 Lit component

The Jorchfile editor has two modes:

1. **Form mode** — structured fields per project (default, mobile-friendly)
2. **Text mode** — raw Makefile-style text editor (toggle)

### 15J.4 Acceptance criteria

- Jorchfile loads and displays as structured form
- Each project section is expandable/collapsible
- Fields editable: path, dev, build, test, tunnel, port, instructions, approve, output
- Save writes to disk, hot-reload picks up changes
- Toggle between form and text editor modes

---

## 16. Sub-phase 6K — /gui Command + Funnel Toggle

### 16K.1 WHAT

Chat command `/gui` sends the GUI URL to WhatsApp. Sub-command `/gui funnel on|off` toggles public exposure with a 4-digit confirmation code.

### 16K.2 HOW — Command implementation

```typescript
// src/commands/gui-command.ts

import { TailscaleServeAdapter } from "../tunnels/adapters/tailscale-serve.js";
import { loadConfig, saveConfig } from "../config/jorchbot-config-loader.js";

interface GuiCommandDeps {
  sendReply: (text: string) => Promise<void>;
  getPort: () => number;
  getPendingConfirmation: () => FunnelConfirmation | null;
  setPendingConfirmation: (c: FunnelConfirmation | null) => void;
}

type FunnelConfirmation = {
  action: "on" | "off";
  code: string;
  expiresAt: number;
};

export async function handleGuiCommand(args: string, deps: GuiCommandDeps): Promise<void> {
  const parts = args.trim().split(/\s+/);

  if (parts.length === 0 || parts[0] === "") {
    // /gui — send URL
    const adapter = new TailscaleServeAdapter();
    await adapter.ensureAvailable();
    const hostname = await adapter.getHostname();
    const port = deps.getPort();
    const config = loadConfig();

    const url = config.gui.funnel ? `https://${hostname}:${port}` : `http://${hostname}:${port}`;

    const mode = config.gui.funnel ? "public (Funnel + device auth)" : "tailnet only";

    await deps.sendReply(
      `JorchBot GUI:\n${url}\n\nMode: ${mode}\nAccessible from ${config.gui.funnel ? "any browser (with device auth)" : "devices in your tailnet"}.`,
    );
    return;
  }

  if (parts[0] === "funnel" && (parts[1] === "on" || parts[1] === "off")) {
    const action = parts[1] as "on" | "off";
    const code = String(Math.floor(1000 + Math.random() * 9000)); // 4-digit code
    const expiresAt = Date.now() + 60_000; // 60 seconds

    deps.setPendingConfirmation({ action, code, expiresAt });

    const description =
      action === "on"
        ? "expose the GUI to the internet via Funnel (with device auth)"
        : "restrict the GUI to tailnet only";

    await deps.sendReply(
      `You are about to ${description}.\n\nTo confirm, reply with the code: ${code}\n(expires in 60 seconds)`,
    );
    return;
  }

  await deps.sendReply("Usage: /gui or /gui funnel on|off");
}

/**
 * Called when a message arrives that might be a funnel confirmation code.
 * Returns true if the message was consumed as a confirmation code.
 */
export async function handleFunnelConfirmation(
  text: string,
  deps: GuiCommandDeps,
): Promise<boolean> {
  const pending = deps.getPendingConfirmation();
  if (!pending) return false;

  // Check expiration
  if (Date.now() > pending.expiresAt) {
    deps.setPendingConfirmation(null);
    await deps.sendReply("Funnel toggle expired. Use /gui funnel on|off to try again.");
    return true;
  }

  if (text.trim() !== pending.code) return false;

  // Code matches — execute the toggle
  deps.setPendingConfirmation(null);
  const config = loadConfig();
  config.gui.funnel = pending.action === "on";
  saveConfig(config);

  if (pending.action === "on") {
    await deps.sendReply(
      "GUI is now public via Funnel.\nDevice auth activated. New browsers will need pairing.",
    );
  } else {
    await deps.sendReply("GUI restricted to tailnet.\nOnly devices in your tailnet can access it.");
  }

  return true;
}
```

### 16K.3 Integration with CommandRouter

Register `/gui` in the CommandRouter. The funnel confirmation code interception hooks into the `onMessage` flow in `jorchbot-start.ts`, before the CommandRouter:

```typescript
// In jorchbot-start.ts onMessage handler, before router.route():

// Check for pending funnel confirmation code
if (messageText && !messageText.startsWith("/")) {
  const consumed = await handleFunnelConfirmation(messageText, guiCommandDeps);
  if (consumed) return;
}
```

### 16K.4 Acceptance criteria

- `/gui` sends the GUI URL with access mode info
- `/gui funnel on` shows 4-digit code prompt
- Replying with correct code within 60s toggles gui.funnel
- Wrong code or timeout → cancellation message
- After toggling to `on`, device auth middleware activates
- After toggling to `off`, tailnet restriction activates

---

## 17. Sub-phase 6L — Mobile Responsive

### 17L.1 WHAT

Make the GUI usable on phones (320px–428px width).

### 17L.2 HOW

Add responsive CSS to existing Lit components:

```css
/* Mobile breakpoints */
@media (max-width: 640px) {
  /* Stack workspace cards vertically */
  .workspace-grid {
    grid-template-columns: 1fr;
  }

  /* Collapse sidebar into hamburger */
  .sidebar {
    display: none;
  }
  .sidebar.open {
    display: block;
    position: fixed;
    z-index: 100;
  }

  /* Larger touch targets */
  button,
  .action-item {
    min-height: 44px;
    min-width: 44px;
  }

  /* Smaller padding */
  .content {
    padding: 12px;
  }
}
```

Key considerations:

- Sidebar collapses to hamburger menu
- Workspace cards stack vertically (single column)
- Touch-friendly buttons (44px minimum)
- No hover-dependent interactions
- Jorchfile editor uses form mode (not text) on mobile

### 17L.3 Acceptance criteria

- GUI is usable from Safari/Chrome on iPhone and Android
- All tabs are accessible via hamburger menu
- Workspace cards readable without horizontal scroll
- Buttons are tappable without precision

---

## 18. DB Schema Changes

### 18.1 New table: device_blacklist

```typescript
// src/db/schema.ts — addition

export const deviceBlacklist = sqliteTable("device_blacklist", {
  deviceId: text("device_id").primaryKey(),
  reason: text("reason"),
  blockedAt: integer("blocked_at", { mode: "timestamp" }).notNull(),
});
```

### 18.2 Migration

Generate migration after adding the table:

```bash
pnpm drizzle-kit generate
```

This creates a new SQL migration file in `src/db/migrations/` that adds the `device_blacklist` table.

---

## 19. Testing Strategy

### 19.1 Unit tests

| File                                       | Tests                                                          |
| ------------------------------------------ | -------------------------------------------------------------- |
| `src/gateway/tailnet-ip.test.ts`           | IPv4, IPv6-mapped IPv4, loopback, non-tailnet, edge cases      |
| `src/gateway/gui-access.test.ts`           | Bypass paths, tailnet allow, non-tailnet deny, funnel mode     |
| `src/gateway/jorchbot-ws.test.ts`          | Connection, handshake, RPC dispatch, unknown method, broadcast |
| `src/gateway/jorchbot-ws-handlers.test.ts` | Each RPC handler individually                                  |
| `src/commands/gui-command.test.ts`         | /gui URL, /gui funnel on/off, confirmation code, expiry        |

### 19.2 Test examples

```typescript
// src/gateway/tailnet-ip.test.ts

import { describe, expect, it } from "vitest";
import { isTailnetIp } from "./tailnet-ip.js";

describe("isTailnetIp", () => {
  it("accepts tailnet IP 100.64.0.1", () => {
    expect(isTailnetIp("100.64.0.1")).toBe(true);
  });

  it("accepts tailnet IP 100.127.255.255 (upper bound of /10)", () => {
    expect(isTailnetIp("100.127.255.255")).toBe(true);
  });

  it("rejects IP outside tailnet range (100.128.0.1)", () => {
    expect(isTailnetIp("100.128.0.1")).toBe(false);
  });

  it("accepts IPv4-mapped IPv6 tailnet address", () => {
    expect(isTailnetIp("::ffff:100.100.50.25")).toBe(true);
  });

  it("rejects IPv4-mapped IPv6 non-tailnet address", () => {
    expect(isTailnetIp("::ffff:192.168.1.1")).toBe(false);
  });

  it("accepts loopback 127.0.0.1", () => {
    expect(isTailnetIp("127.0.0.1")).toBe(true);
  });

  it("accepts IPv6 loopback ::1", () => {
    expect(isTailnetIp("::1")).toBe(true);
  });

  it("rejects public IP", () => {
    expect(isTailnetIp("8.8.8.8")).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(isTailnetIp("not-an-ip")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isTailnetIp("")).toBe(false);
  });
});
```

```typescript
// src/gateway/gui-access.test.ts

import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createGuiAccessMiddleware } from "./gui-access.js";
import type { JorchBotConfig } from "../config/jorchbot-config.js";
import { JorchBotConfigSchema } from "../config/jorchbot-config.js";

function buildApp(guiFunnel: boolean) {
  const config = JorchBotConfigSchema.parse({ gui: { funnel: guiFunnel } });
  const app = express();
  app.set("trust proxy", true);
  app.use(createGuiAccessMiddleware(() => config as JorchBotConfig));
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.get("/webhooks/kapso", (_req, res) => res.json({ ok: true }));
  app.get("/overview", (_req, res) => res.json({ tab: "overview" }));
  return app;
}

describe("GUI access middleware", () => {
  it("always passes /health regardless of gui.funnel", async () => {
    const app = buildApp(false);
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
  });

  it("always passes /webhooks/kapso regardless of gui.funnel", async () => {
    const app = buildApp(false);
    const res = await request(app).get("/webhooks/kapso");
    expect(res.status).toBe(200);
  });

  // Note: supertest uses 127.0.0.1 which is allowed as loopback
  it("allows loopback when gui.funnel=false", async () => {
    const app = buildApp(false);
    const res = await request(app).get("/overview");
    expect(res.status).toBe(200);
  });

  it("allows all IPs when gui.funnel=true", async () => {
    const app = buildApp(true);
    const res = await request(app).get("/overview");
    expect(res.status).toBe(200);
  });
});
```

```typescript
// src/commands/gui-command.test.ts

import { describe, expect, it, vi, beforeEach } from "vitest";
import { handleGuiCommand, handleFunnelConfirmation } from "./gui-command.js";

describe("gui command", () => {
  const sendReply = vi.fn<(text: string) => Promise<void>>();
  let pendingConfirmation: { action: "on" | "off"; code: string; expiresAt: number } | null = null;

  const deps = {
    sendReply,
    getPort: () => 18789,
    getPendingConfirmation: () => pendingConfirmation,
    setPendingConfirmation: (c: typeof pendingConfirmation) => {
      pendingConfirmation = c;
    },
  };

  beforeEach(() => {
    sendReply.mockClear();
    pendingConfirmation = null;
  });

  it("/gui funnel on sets pending confirmation with 4-digit code", async () => {
    await handleGuiCommand("funnel on", deps);

    expect(sendReply).toHaveBeenCalledTimes(1);
    const message = sendReply.mock.calls[0][0];
    expect(message).toContain("To confirm, reply with the code:");
    expect(pendingConfirmation).not.toBeNull();
    expect(pendingConfirmation!.action).toBe("on");
    expect(pendingConfirmation!.code).toMatch(/^\d{4}$/);
  });

  it("correct code confirms funnel toggle", async () => {
    pendingConfirmation = { action: "on", code: "1234", expiresAt: Date.now() + 60_000 };

    const consumed = await handleFunnelConfirmation("1234", deps);

    expect(consumed).toBe(true);
    expect(pendingConfirmation).toBeNull();
    expect(sendReply).toHaveBeenCalledTimes(1);
    expect(sendReply.mock.calls[0][0]).toContain("public via Funnel");
  });

  it("wrong code is not consumed", async () => {
    pendingConfirmation = { action: "on", code: "1234", expiresAt: Date.now() + 60_000 };

    const consumed = await handleFunnelConfirmation("5678", deps);

    expect(consumed).toBe(false);
    expect(pendingConfirmation).not.toBeNull(); // Still pending
  });

  it("expired code rejects with message", async () => {
    pendingConfirmation = { action: "on", code: "1234", expiresAt: Date.now() - 1000 };

    const consumed = await handleFunnelConfirmation("1234", deps);

    expect(consumed).toBe(true);
    expect(sendReply).toHaveBeenCalledTimes(1);
    expect(sendReply.mock.calls[0][0]).toContain("expired");
  });
});
```

### 19.3 Integration tests

- Mount the full gateway with Control UI → verify SPA loads
- Connect WebSocket → verify handshake + RPC round-trip
- End-to-end: create session via WS → verify workspace appears in `jb.workspaces.list`

---

## 20. Acceptance Criteria

### 20.1 Core

- [ ] Control UI loads from `http://localhost:18789/` (same port as gateway)
- [ ] Branding shows "JorchBot" everywhere (title, logo, colors, localStorage keys)
- [ ] WebSocket connects, handshakes, and supports RPC requests
- [ ] `gui.funnel=false`: only tailnet IPs + loopback access GUI
- [ ] `gui.funnel=true`: device auth protects GUI + WebSocket
- [ ] `/webhooks/*` and `/health` always work without restriction

### 20.2 Tabs

- [ ] 6 tabs hidden (chat, instances, usage, cron, agents, skills) — no crash on direct URL access
- [ ] "nodes" tab renamed to "Devices"
- [ ] Overview shows workspaces with context % in real-time
- [ ] Sessions tab lists sessions with mode/status
- [ ] Channels tab shows Kapso/Telegram enabled/disabled
- [ ] Config tab loads and saves `jorchbot.json`
- [ ] Logs tab shows real-time gateway output
- [ ] Tab Workspaces: CRUD, focus model, context gauge, compact, stop
- [ ] Tab Tunnels: list, create, stop, Serve/Funnel differentiation, proxy routes
- [ ] Tab Devices: approve, revoke, block, unblock devices
- [ ] Tab Jorchfile: load, edit, save with hot-reload

### 20.3 Commands

- [ ] `/gui` sends URL to WhatsApp with access mode info
- [ ] `/gui funnel on` prompts 4-digit code, toggles on confirmation
- [ ] `/gui funnel off` prompts 4-digit code, toggles on confirmation
- [ ] Code expires after 60 seconds

### 20.4 Mobile

- [ ] GUI usable on 320px–428px screens
- [ ] All tabs accessible via collapsed navigation
- [ ] Touch-friendly (44px min tap targets)

### 20.5 Quality

- [ ] All tests pass (`pnpm test:fast`)
- [ ] `pnpm check` passes (0 errors, 0 warnings)
- [ ] No "OpenClaw" text visible in the UI
- [ ] No console errors on page load

---

## Anti-patterns — What NOT to Do

1. **Do NOT rebuild the UI in React/Vue/Svelte** — Lit 3.x works. The SPA has 12 tabs already.
2. **Do NOT create a separate app on another port** — the UI MUST serve from port 18789.
3. **Do NOT delete OpenClaw code** — hidden tabs/methods are filtered, not removed. Preserves upstream merge-ability.
4. **Do NOT use the full OpenClaw gateway** — its WS server has too many dependencies (multi-agent, canvas, etc.). Build a minimal WS server.
5. **Do NOT create REST endpoints** — the Control UI uses WebSocket RPC exclusively. Only `/health` and existing `/api/*` remain as HTTP.
6. **Do NOT leave the GUI without auth** — when `gui.funnel = true`, device auth is mandatory.
7. **Do NOT hardcode "JorchBot"** — use `assistantName` from bootstrap config and i18n strings.
8. **Do NOT mix RPC namespaces** — JorchBot methods use `jb.*` prefix. Adapted OpenClaw methods keep their original names.

---

## Relation to Other Phases

| Phase       | Relation                       | Impact                            |
| ----------- | ------------------------------ | --------------------------------- |
| **Phase 1** | Gateway + ClaudeRunner running | Prerequisite for 6A               |
| **Phase 2** | SessionManager, FocusModel     | Data source for Workspaces tab    |
| **Phase 3** | Jorchfile engine + hot-reload  | Data source for Jorchfile tab     |
| **Phase 4** | TunnelManager + FunnelProxy    | Prerequisite for 6H (tunnels tab) |
| **Phase 5** | Approval modes, output filters | Enhances Workspaces tab display   |
| **Phase 7** | Telegram channel               | Appears in Channels tab           |
| **Phase 8** | TOTP 2FA, encryption           | Layer on top of device auth (6D)  |

---

## Key Reference Files

| File                                 | Purpose                                         |
| ------------------------------------ | ----------------------------------------------- |
| `src/gateway/jorchbot-start.ts`      | Gateway entry point — modify to mount UI + WS   |
| `src/gateway/control-ui.ts`          | HTTP handler for SPA serving + bootstrap config |
| `src/gateway/control-ui-contract.ts` | Bootstrap config path constant                  |
| `src/infra/control-ui-assets.ts`     | Asset resolution + auto-build                   |
| `ui/src/ui/navigation.ts`            | Tab definitions and routing                     |
| `ui/src/ui/app.ts`                   | Root Lit component                              |
| `ui/src/ui/app-render.ts`            | Render with branding                            |
| `ui/src/ui/app-gateway.ts`           | WebSocket client integration                    |
| `ui/src/ui/gateway.ts`               | `GatewayBrowserClient` class                    |
| `ui/src/ui/storage.ts`               | localStorage settings                           |
| `ui/src/ui/device-auth.ts`           | Device auth token storage                       |
| `ui/src/ui/device-identity.ts`       | Ed25519 key pair generation                     |
| `ui/src/styles/base.css`             | CSS variables (colors, fonts)                   |
| `docs/gui-jorchbot.md`               | Full technical audit of Control UI              |
| `docs/phase-6-gui.md`                | Phase overview with sub-phases                  |
