# Phase 6 — GUI de Configuracion — TODO

> Generated from `specifications/phase-6-gui/SPEC.md` + `docs/phase-6-gui.md`
> Each phase is a self-contained unit of work. Complete all tasks in a phase before starting the next.
> **Convention**: Every task specifies the exact file(s), function(s), and values involved.

---

## Phase A — Mount Control UI on Gateway (6A)

**Goal**: Serve the Lit SPA from `jorchbot-start.ts` at `http://localhost:18789/`.

- [x] A.1 — In `src/gateway/jorchbot-start.ts`, add imports:
  - `import { handleControlUiHttpRequest } from "./control-ui.js"`
  - `import { resolveControlUiRootSync } from "../infra/control-ui-assets.js"`
- [x] A.2 — In `src/gateway/jorchbot-start.ts`, after all existing route definitions (`/webhooks`, `/health`, `/api/*`), call `resolveControlUiRootSync({})` to locate `dist/control-ui/` assets
- [x] A.3 — If `controlUiRoot` is truthy, mount `handleControlUiHttpRequest` as final Express middleware with options:
  - `controlUiRoot` — resolved path
  - `basePath: ""`
  - `assistantName: "JorchBot"`
  - `bootstrapConfigPath: "/__jorchbot/control-ui-config.json"`
  - Log: `[jorchbot] Control UI mounted at http://${host}:${port}/`
- [x] A.4 — If `controlUiRoot` is falsy, log warning: `[jorchbot] Control UI assets not found — run 'pnpm ui:build'` — do NOT crash
- [x] A.5 — In `src/gateway/control-ui-contract.ts`, change `CONTROL_UI_BOOTSTRAP_CONFIG_PATH` from `"/__openclaw/control-ui-config.json"` to `"/__jorchbot/control-ui-config.json"`
- [ ] A.6 — Build UI assets: `pnpm ui:build` — verify `dist/control-ui/index.html` exists
- [ ] A.7 — **Verify**: `http://localhost:18789/` loads the SPA (returns `index.html`)
- [ ] A.8 — **Verify**: `/webhooks/kapso` POST still works (not captured by SPA catch-all)
- [ ] A.9 — **Verify**: `/health` GET returns 200 (not captured by SPA catch-all)
- [ ] A.10 — **Verify**: `/__jorchbot/control-ui-config.json` returns JSON with `assistantName: "JorchBot"`
- [ ] A.11 — **Verify**: Unknown path `/foo/bar` returns `index.html` (SPA client-side routing fallback)
- [ ] A.12 — **Verify**: Static assets (`.js`, `.css`) return correct MIME types, missing assets return 404 (not index.html)
- [x] A.13 — Write test in `src/gateway/control-ui.test.ts`: bootstrap config endpoint returns `{ assistantName: "JorchBot", basePath: "" }`
- [x] A.14 — `pnpm check` — 0 errors, 0 warnings

---

## Phase B — Re-branding OpenClaw → JorchBot (6B)

**Goal**: Replace all visible "OpenClaw" references with "JorchBot" branding. Reference: `docs/gui-jorchbot.md` section 3 for exact line numbers.

**HTML + Root Component:**

- [x] B.1 — `ui/index.html`: `<title>OpenClaw Control</title>` → `<title>JorchBot Control</title>`
- [x] B.2 — `ui/index.html`: `<openclaw-app></openclaw-app>` → `<jorchbot-app></jorchbot-app>`
- [x] B.3 — `ui/src/ui/app.ts`: `@customElement("openclaw-app")` → `@customElement("jorchbot-app")`
- [x] B.4 — `ui/src/ui/app.ts`: `class OpenClawApp` → `class JorchBotApp` (+ backward-compat type alias `export type { JorchBotApp as OpenClawApp }`)
- [x] B.5 — `ui/src/ui/app.ts`: `window.__OPENCLAW_CONTROL_UI_BASE_PATH__` → `window.__JORCHBOT_CONTROL_UI_BASE_PATH__` (kept deprecated old prop for backward compat)

**CSS:**

- [x] B.6 — `ui/src/styles/base.css` dark mode: `--accent: #ff5c5c` → `--accent: #6366f1`, `--primary: #ff5c5c` → `--primary: #6366f1`
- [x] B.7 — `ui/src/styles/base.css` light mode: `--accent: #dc2626` → `--accent: #4f46e5`, `--primary: #dc2626` → `--primary: #4f46e5`
- [x] B.8 — `ui/src/styles/base.css`: `openclaw-app { display: block; }` → `jorchbot-app { display: block; }`

**localStorage Keys (4 files):**

- [x] B.9 — `ui/src/ui/storage.ts`: `"openclaw.control.settings.v1"` → `"jorchbot.control.settings.v1"`
- [x] B.10 — `ui/src/ui/device-auth.ts`: `"openclaw.device.auth.v1"` → `"jorchbot.device.auth.v1"`
- [x] B.11 — `ui/src/ui/device-identity.ts`: `"openclaw-device-identity-v1"` → `"jorchbot-device-identity-v1"`
- [x] B.12 — `ui/src/i18n/lib/translate.ts`: `"openclaw.i18n.locale"` → `"jorchbot.i18n.locale"`

**Gateway Client:**

- [x] B.13 — `ui/src/ui/app-gateway.ts`: `clientName: "openclaw-control-ui"` → `clientName: "jorchbot-control-ui"` (+ updated `GATEWAY_CLIENT_IDS.CONTROL_UI` in `src/gateway/protocol/client-info.ts`)

**Render/Branding:**

- [x] B.14 — `ui/src/ui/app-render.ts`: logo alt text `"OpenClaw"` → `"JorchBot"`
- [x] B.15 — `ui/src/ui/app-render.ts`: brand title `"OPENCLAW"` → `"JORCHBOT"`
- [x] B.16 — `ui/src/ui/app-render.ts`: subtitle `"Gateway Dashboard"` → `"Remote Dev"`
- [x] B.17 — `ui/src/ui/app-render.ts`: docs link `"https://docs.openclaw.ai"` → `"https://github.com/EslavaDev/jorchbot"`

**i18n Locales:**

- [x] B.18 — `ui/src/i18n/locales/en.ts` + `pt-BR.ts` + `zh-CN.ts` + `zh-TW.ts`: all references to `~/.openclaw/openclaw.json` → `~/.jorchbot/config.json`

**View-Specific:**

- [x] B.19 — `ui/src/ui/views/overview.ts`: CLI command references `openclaw` → `jorchbot`, docs URLs → GitHub repo, token placeholder → `JORCHBOT_GATEWAY_TOKEN`
- [x] B.20 — `ui/src/ui/views/debug.ts`: CLI reference `openclaw security audit` → `jorchbot security audit`
- [x] B.21 — `ui/src/ui/views/usage.ts`: export filenames `openclaw-usage-*` → `jorchbot-usage-*`
- [x] B.22 — `ui/src/ui/app-scroll.ts`: export filename `openclaw-logs-*` → `jorchbot-logs-*`
- [x] B.23 — `ui/src/ui/views/skills-grouping.ts`: `"openclaw-workspace"` group names → added `"jorchbot-*"` alongside `"openclaw-*"` for backward compat
- [x] B.24 — `ui/src/ui/app-settings.ts`: reads `__JORCHBOT_CONTROL_UI_BASE_PATH__` first, falls back to deprecated `__OPENCLAW_CONTROL_UI_BASE_PATH__`

**Assets:**

- [x] B.25 — Replace `ui/public/favicon.svg` with JorchBot logo (indigo `#6366f1` gradient, "J" letter)
- [ ] B.26 — Replace `ui/public/favicon-32.png` with JorchBot favicon 32x32 (requires PNG generation from SVG)
- [ ] B.27 — Replace `ui/public/apple-touch-icon.png` with JorchBot touch icon (requires PNG generation from SVG)

**Tests:**

- [x] B.28 — `ui/src/ui/navigation.browser.test.ts`: `window.__OPENCLAW_CONTROL_UI_BASE_PATH__` → `window.__JORCHBOT_CONTROL_UI_BASE_PATH__` (+ updated test helpers and localStorage key references)

**Additional fixes (discovered during grep audit):**

- [x] B.28b — `ui/src/ui/navigation.test.ts`: subtitle assertion `openclaw.json` → `jorchbot`
- [x] B.28c — `ui/src/ui/views/skills.ts`: bundled badge check now recognizes both `jorchbot-bundled` and `openclaw-bundled`
- [x] B.28d — `ui/src/ui/views/chat.ts`: message marker reads `__jorchbot` with `__openclaw` fallback
- [x] B.28e — `ui/src/ui/test-helpers/app-mount.ts`: updated element name, import, and window global

**Verify:**

- [ ] B.29 — `pnpm ui:build` — succeeds
- [x] B.30 — `grep -ri "openclaw" ui/src/ --include="*.ts" --include="*.css" --include="*.html"` — remaining refs are code-level only (type alias, deprecated window prop, legacy localStorage key, GitHub issue comment, test URL paths)
- [x] B.31 — `pnpm check` — tsc: 0 errors; lint: 0 warnings, 0 errors

---

## Phase C — WebSocket Server + Config/Status RPC (6C)

**Goal**: Implement minimal WS server with core RPC handlers. The UI can connect, handshake, and call config/status methods.

**Prerequisite config (needed by WS server):**

- [x] C.1 — In `src/config/jorchbot-config.ts`, add `GuiSchema = z.object({ funnel: z.boolean().default(false) })` and add `gui: GuiSchema.default(GuiSchema.parse({}))` to `JorchBotConfigSchema` (this is needed by C.11 below)
- [x] C.2 — Create `src/gateway/tailnet-ip.ts` exporting `isTailnetIp(ip: string): boolean`:
  - Parse IPv4, handle `::ffff:` mapped IPv6, allow loopback (`127.0.0.1`, `::1`)
  - Check CGNAT range `100.64.0.0/10`: `(ipNum & 0xffc00000) === 0x64400000`
  - Return `false` for malformed input, empty string
- [x] C.3 — Write `src/gateway/tailnet-ip.test.ts` (10 cases per SPEC section 19.2): tailnet IPs (`100.64.0.1`, `100.127.255.255`), non-tailnet (`100.128.0.1`, `8.8.8.8`), IPv6-mapped (`::ffff:100.100.50.25`), loopback (`127.0.0.1`, `::1`), malformed, empty

**Error classes (all 7 from SPEC section 5):**

- [x] C.4 — In `src/errors/index.ts`, add these 7 error classes extending `JorchBotError`:
  1. `WsServerStartError(cause?)` — "Failed to start WebSocket server"
  2. `WsMethodNotFoundError(method)` — `Unknown RPC method: "${method}"`
  3. `WsRpcError(method, cause?)` — `RPC handler for "${method}" failed`
  4. `WsConnectError(reason)` — `WebSocket connect failed: ${reason}`
  5. `GuiAccessDeniedError(ip, reason)` — `GUI access denied for ${ip}: ${reason}`
  6. `DeviceBlockedError(deviceId)` — `Device "${deviceId}" is blocked`
  7. `GuiFunnelConfirmationError(reason)` — `Funnel toggle failed: ${reason}`

**WS types (in jorchbot-ws.ts):**

- [x] C.5 — Create `src/gateway/jorchbot-ws.ts` with these types:
  - `WsRequestFrame = { type: "req"; id: number; method: string; params?: Record<string, unknown> }`
  - `WsResponseFrame = { type: "res"; id: number; ok: boolean; payload?: unknown; error?: { code: string; message: string } }`
  - `WsEventFrame = { type: "event"; event: string; payload: unknown; seq: number }`
  - `WsClient = { ws: WebSocket; id: string; clientName?: string; deviceId?: string; authenticated: boolean; connectedAt: number }`
  - `RpcHandler = (params: Record<string, unknown>, client: WsClient) => Promise<unknown> | unknown`

**WS server implementation:**

- [x] C.6 — In `jorchbot-ws.ts`, export `attachJorchBotWsServer(deps: JorchBotWsServerDeps): JorchBotWsServer` where:
  - `JorchBotWsServerDeps = { httpServer: Server; handlers: Record<string, RpcHandler>; requireAuth: boolean; isIpAllowed: (ip: string) => boolean }`
  - `JorchBotWsServer = { broadcast(event, payload): void; getConnectedClients(): WsClient[]; close(): void }`
- [x] C.7 — Implement `noServer` WebSocket upgrade: `deps.httpServer.on("upgrade", ...)` — check IP via `deps.isIpAllowed(ip)`, reject with `403` socket write if denied, else `wss.handleUpgrade()`
- [x] C.8 — On `"connection"` event: create `WsClient` with `crypto.randomUUID()` id, add to `clients` Map, start 10s handshake timeout — close with code `4001` if `connect` not received
- [x] C.9 — Implement message handler: parse JSON, reject non-`"req"` type, require `connect` as first message (reject with `AUTH_REQUIRED` otherwise), then route to `handlers[method]`
- [x] C.10 — Implement `sendResponse(ws, id, payload)` and `sendError(ws, id, code, message)` helpers — serialize `WsResponseFrame` JSON and send
- [x] C.11 — Implement `connect` handler: mark `client.authenticated = true`, extract `clientName` from params, respond with `hello-ok` payload:
  ```
  { type: "hello-ok", protocolVersion: 3, gateway: { version: "1.0.0", methods: [...handlerKeys], events: JB_EVENTS } }
  ```
- [x] C.12 — Define `JB_EVENTS` array: `["jb.session.output", "jb.session.state", "jb.tunnel.state", "jb.proxy.state", "jb.device.paired", "jb.approval"]`
- [x] C.13 — Implement `broadcast(event, payload)`: increment `eventSeq`, build `WsEventFrame`, send JSON to all authenticated clients with `readyState === OPEN`
- [x] C.14 — On `"close"` and `"error"` events: clear handshake timer, delete client from Map

**RPC handlers:**

- [x] C.15 — Create `src/gateway/jorchbot-ws-handlers.ts` exporting `buildRpcHandlers(deps): Record<string, RpcHandler>` where deps includes `sessionManager`, `tunnelManager`, `jorchfileExecutor`, `config`, `getUptime`
- [x] C.16 — Implement `health` handler: return `{ ok: true, uptime: getUptime() }`
- [x] C.17 — Implement `status` / `jb.status` handler: return `{ uptime, activeSessions: sessionManager.listActive().length, activeTunnels: tunnelManager.list().length, focusedProject }`
- [x] C.18 — Implement `config.get` handler: call `loadConfig()`, return `{ config: JSON.stringify(config, null, 2) }`
- [x] C.19 — Implement `config.set` handler: parse `params.config` as JSON, validate with `JorchBotConfigSchema.parse()`, call `saveConfig()`, return `{ ok: true }`
- [x] C.20 — Implement `config.apply` handler: call `loadConfig()`, update in-memory config reference, return `{ ok: true, reloaded: true }`
- [x] C.21 — Implement `config.schema` handler: return JSON schema description for UI display

**Event helpers:**

- [x] C.22 — Create `src/gateway/jorchbot-ws-events.ts`: export typed helper `broadcastSessionState(ws, project, state)`, `broadcastTunnelEvent(ws, event)`, `broadcastSessionOutput(ws, project, text)`

**EventEmitter on existing managers:**

- [x] C.23 — In `src/sessions/jorchbot/manager.ts`: add `extends EventEmitter` to `SessionManager`, emit `"stateChange"` (project, `{ contextPercent, mode, status, focused }`) at state change points, emit `"output"` (project, text) when ClaudeRunner produces text
- [x] C.24 — In `src/tunnels/manager.ts`: add `extends EventEmitter` to `TunnelManager`, emit `"tunnelEvent"` (TunnelEvent) at start/stop/health events

**Integration in gateway:**

- [x] C.25 — In `src/gateway/jorchbot-start.ts`: change `app.listen(port, host)` to `const server = app.listen(port, host)` — store the HTTP server reference
- [x] C.26 — In `jorchbot-start.ts`: call `buildRpcHandlers({ sessionManager, tunnelManager, jorchfileExecutor: () => jorchfileExecutor, config, getUptime: () => Math.floor((Date.now() - startTime) / 1000) })`
- [x] C.27 — In `jorchbot-start.ts`: call `attachJorchBotWsServer({ httpServer: server, handlers, requireAuth: config.gui.funnel, isIpAllowed: isTailnetIp })`
- [x] C.28 — Wire events: `sessionManager.on("stateChange", ...)` → `wsServer.broadcast("jb.session.state", ...)`
- [x] C.29 — Wire events: `sessionManager.on("output", ...)` → `wsServer.broadcast("jb.session.output", ...)`
- [x] C.30 — Wire events: `tunnelManager.on("tunnelEvent", ...)` → `wsServer.broadcast("jb.tunnel.state", ...)`
- [x] C.31 — Add `wsServer.close()` to the gateway shutdown handler

**Tests:**

- [x] C.32 — Write `src/gateway/jorchbot-ws.test.ts`: connection, handshake timeout (10s → close 4001), connect → hello-ok, RPC dispatch to handler, unknown method → `METHOD_NOT_FOUND`, invalid JSON → `PARSE_ERROR`, broadcast to authenticated clients only, unauthenticated message before connect → `AUTH_REQUIRED`
- [x] C.33 — Write `src/gateway/jorchbot-ws-handlers.test.ts`: `health` returns uptime, `jb.status` returns counts, `config.get` returns serialized config, `config.set` validates and saves, `config.set` with invalid schema → error

**Verify:**

- [ ] C.34 — Start gateway, open `http://localhost:18789/` — UI shows "connected" status pill (green)
- [ ] C.35 — Open 2 browser tabs simultaneously — both connect, no interference
- [ ] C.36 — Kill gateway process, restart — UI auto-reconnects within 15s (exponential backoff 800ms→15s)
- [x] C.37 — `pnpm check` — 0 errors, 0 warnings

---

## Phase D — GUI Access Middleware + Device Auth (6D)

**Goal**: Enforce tailnet-only or device-auth access to GUI. `gui.funnel` config was added in Phase C.

**GUI access middleware:**

- [x] D.1 — Create `src/gateway/gui-access.ts` exporting `createGuiAccessMiddleware(getConfig: () => JorchBotConfig)`:
  - Define `BYPASS_PREFIXES = ["/webhooks/", "/health", "/__jorchbot/", "/api/"]`
  - If `req.path` starts with any bypass prefix → `next()` (always pass)
  - If `config.gui.funnel === true` → `next()` (all IPs allowed, auth at WS level)
  - If `config.gui.funnel === false` → check `isTailnetIp(req.ip ?? req.socket.remoteAddress ?? "")`:
    - Tailnet IP → `next()`
    - Non-tailnet → `res.status(403).json({ error: "Access denied. GUI restricted to tailnet." })`
- [x] D.2 — Write `src/gateway/gui-access.test.ts` (use `express` + `fetch`):
  - `/health` always passes (gui.funnel=false)
  - `/webhooks/kapso` always passes (gui.funnel=false)
  - `/__jorchbot/control-ui-config.json` always passes (gui.funnel=false)
  - `/api/documents/123` always passes (gui.funnel=false)
  - `/overview` with loopback IP → 200 (gui.funnel=false)
  - `/overview` with gui.funnel=true → 200 (any IP)
- [x] D.3 — In `jorchbot-start.ts`: mount `createGuiAccessMiddleware(() => config)` BEFORE Control UI middleware, AFTER existing API routes (`/webhooks`, `/health`, `/api/*`)
- [x] D.4 — In `jorchbot-ws.ts` upgrade handler: apply same `isTailnetIp()` check when `!deps.requireAuth` — already implemented in C.7, verified it works

**Device auth (when gui.funnel=true):**

- [x] D.5 — In `jorchbot-ws.ts` `connect` handler: when `deps.requireAuth === true`:
  1. Check `connectParams.device?.publicKey` and `connectParams.device?.signature`
  2. If missing → send `connect.challenge` event with `nonce: crypto.randomBytes(32).toString("base64url")`, return without authenticating
  3. If present → verify signature via `DeviceAuthCallbacks.verifyDevice()`
  4. If verification fails → `sendError(ws, id, "AUTH_FAILED", reason)`, `ws.close(4003)`
  5. If new device → `persistDeviceToken()` callback stores token
- [x] D.6 — Integrate `isDeviceBlocked(deviceId)` check in connect handler — reject blocked devices with `DEVICE_BLOCKED` error code + `ws.close(4003)`
- [x] D.7 — Persist approved device tokens via `DeviceAuthCallbacks.persistDeviceToken()` callback (key: `device.tokens.${deviceId}`)

**Tests:**

- [x] D.8 — Test `gui.funnel=false` + non-tailnet IP → 403 on HTTP (unit test with mock req.ip="8.8.8.8")
- [x] D.9 — Test `gui.funnel=false` + loopback → 200 on HTTP
- [x] D.10 — Test `gui.funnel=true` + WS connect without device params → `connect.challenge` event
- [x] D.11 — Test `/webhooks/kapso` always passes regardless of gui.funnel value
- [x] D.12 — `pnpm check` — 0 errors, 0 warnings

---

## Phase E — Tab Management (6E)

**Goal**: Show only relevant tabs, add 3 new tab routes, rename "nodes" → "Devices".

- [x] E.1 — In `ui/src/ui/navigation.ts`, extend `Tab` union type with: `| "workspaces" | "tunnels" | "jorchfile"`
- [x] E.2 — Define `const HIDDEN_TABS: ReadonlySet<Tab> = new Set(["chat", "instances", "usage", "cron", "agents", "skills"])`
- [x] E.3 — Define `JB_TAB_GROUPS` array with 4 groups:
  - `{ label: "jorchbot", tabs: ["overview", "workspaces", "sessions"] }`
  - `{ label: "infrastructure", tabs: ["tunnels", "channels"] }`
  - `{ label: "configuration", tabs: ["jorchfile", "config"] }`
  - `{ label: "system", tabs: ["nodes", "debug", "logs"] }` — "nodes" displayed as "Devices"
- [x] E.4 — Export `VISIBLE_TAB_GROUPS`: filter `HIDDEN_TABS` from `JB_TAB_GROUPS`, remove empty groups
- [x] E.5 — Define `JB_TAB_TITLES: Partial<Record<Tab, string>>` = `{ nodes: "Devices", workspaces: "Workspaces", tunnels: "Tunnels", jorchfile: "Jorchfile" }`
- [x] E.6 — Update `titleForTab(tab)` to check `JB_TAB_TITLES[tab]` first, fall back to existing i18n lookup
- [x] E.7 — Update `pathForTab(tab, basePath)` to handle `"workspaces"` → `/workspaces`, `"tunnels"` → `/tunnels`, `"jorchfile"` → `/jorchfile`
- [x] E.8 — Update `tabFromPath(pathname, basePath)` to recognize new paths
- [x] E.9 — In `ui/src/ui/app-render.ts`: replace sidebar rendering to use `VISIBLE_TAB_GROUPS` instead of `TAB_GROUPS`
- [x] E.10 — Implement fallback: if URL matches a hidden tab, redirect to `/overview` — no crash, no blank page
- [ ] E.11 — **Verify**: sidebar shows 10 tabs in 4 groups: overview, workspaces, sessions | tunnels, channels | jorchfile, config | devices, debug, logs
- [ ] E.12 — **Verify**: navigating to `/chat` (hidden) → redirects to `/overview`
- [x] E.13 — `pnpm check` — 0 errors, 0 warnings

---

## Phase F — Adapt Existing Tabs (6F)

**Goal**: Connect overview, sessions, channels, config, logs, debug to JorchBot data via RPC. No duplicate handlers — all handlers live in `jorchbot-ws-handlers.ts`.

**RPC handlers (add to `buildRpcHandlers` in `jorchbot-ws-handlers.ts`):**

- [x] F.1 — `sessions.list` handler: call `sessionManager.listActive()`, map to `{ key, label: project, mode, outputMode, contextPercent, focused, status, createdAt }`
- [x] F.2 — `sessions.patch` handler: update session mode/output via `sessionManager.setMode()` / `sessionManager.setOutputMode()` — resolves project from key or project param via `resolveProjectFromKey()`
- [x] F.3 — `sessions.delete` handler: call `sessionManager.destroy(project)` — resolves project from key or project param
- [x] F.4 — `sessions.compact` handler: call `sessionManager.checkContextGuard(project)` — returns context % (placeholder for full compaction)
- [x] F.5 — `sessions.usage` handler: return context % and level from `checkContextGuard()`
- [x] F.6 — `channels.status` handler: return `[{ id: "kapso", name: "WhatsApp (Kapso)", enabled, status, webhookUrl }, { id: "telegram", name: "Telegram", enabled, status }]`
- [x] F.7 — `logs.tail` handler: implement `LogBuffer` ring buffer class in `src/gateway/log-buffer.ts`:
  - `push(line: string)` — add line, evict oldest if over capacity (default 1000 lines)
  - `tail(limit: number)` — return last N lines
  - Wire: intercept `console.log`/`console.error`/`console.warn` in `jorchbot-start.ts`, push to LogBuffer
- [x] F.8 — `logs.tail` handler: call `logBuffer.tail(params.limit ?? 100)`, return `{ lines, cursor, truncated }`

**Adapt UI views:**

- [x] F.9 — In `ui/src/ui/views/overview.ts`: adapted stat cards to show Workspaces/Uptime/Channels, notes section updated with Workspaces/Tunnels info
- [x] F.10 — In sessions view: existing sessions controller already fetches from `sessions.list` RPC — handler returns correct `SessionsListResult` shape
- [x] F.11 — In channels view: existing channels controller already fetches from `channels.status` RPC — handler returns correct shape
- [ ] F.12 — **Verify**: config tab loads `jorchbot.json`, saves changes, Zod validates on save
- [ ] F.13 — **Verify**: logs tab shows real-time gateway output via `logs.tail`

**Tests:**

- [x] F.14 — Write handler tests: `sessions.list` returns correct shape, `channels.status` returns both channels, `logs.tail` returns lines from buffer, `logs.tail` respects limit, `sessions.usage` null when not found, `sessions.usage` returns context info (19 tests total, all pass)
- [x] F.15 — `pnpm check` — 0 errors, 0 warnings

---

## Phase G — Tab Workspaces (6G)

**Goal**: Full workspace management tab with CRUD, focus model, context gauge, commands, and real-time updates.

**Types (in `jorchbot-ws-handlers.ts` or shared types file):**

- [x] G.1 — Define `WorkspaceView` type: `{ id, name, path, systemPrompt?, allowedTools?, mode, outputMode, enabled, focused, contextPercent, status, lastMessage?, lastMessageAt?, commands: WorkspaceCommand[] }`
- [x] G.2 — Define `WorkspaceCommand` type: `{ name, command, description? }`

**RPC handlers — workspace CRUD (from `docs/phase-6-gui.md` RPC table):**

- [x] G.3 — `jb.workspaces.list` handler: call `sessionManager.listActive()`, map each to `WorkspaceView` including `getProjectCommands(project)` from JorchfileExecutor
- [x] G.4 — `jb.workspaces.get` handler: take `params.id`, call `sessionManager.get(id)`, throw `SessionNotFoundError` if missing, return `WorkspaceView`
- [x] G.5 — `jb.workspaces.create` handler: validate `params` with `CreateSessionInputSchema`, call `sessionManager.create(input)`, return created session
- [x] G.6 — `jb.workspaces.update` handler: take `params.project` + fields to update (mode, outputMode, systemPrompt, allowedTools), call corresponding SessionManager methods
- [x] G.7 — `jb.workspaces.delete` handler: take `params.project`, call `sessionManager.stopByProject(project)`, delete from DB
- [x] G.8 — `jb.workspaces.enable` handler: take `params.project` + `params.enabled`, pause/resume workspace

**RPC handlers — session actions:**

- [x] G.9 — `jb.session.focus` handler: take `params.project`, call `sessionManager.setFocused("gui", project)` — use synthetic `"gui"` phone for GUI-initiated focus
- [x] G.10 — `jb.session.compact` handler: take `params.project`, call `sessionManager.compact(project)`
- [x] G.11 — `jb.session.stop` handler: take `params.project`, call `sessionManager.stopByProject(project)`
- [x] G.12 — `jb.session.restart` handler: take `params.project`, stop session, then re-create with same params (path, systemPrompt, allowedTools, mode, outputMode)

**RPC handlers — workspace commands CRUD:**

- [x] G.13 — `jb.workspaces.commands.list` handler: take `params.project`, return commands from JorchfileExecutor
- [x] G.14 — `jb.workspaces.commands.create` handler: take `params.project`, `params.name`, `params.command`, `params.description?` — add to Jorchfile, trigger hot-reload
- [x] G.15 — `jb.workspaces.commands.delete` handler: take `params.project`, `params.name` — remove from Jorchfile, trigger hot-reload

**Lit component:**

- [x] G.16 — Create `ui/src/ui/views/jb-workspaces.ts` as pure render function (follows existing codebase pattern — not `@customElement`):
  - `WorkspacesProps` type with loading, result, error, callbacks
  - `renderWorkspaces(props)` renders workspace list
  - Controller functions in `ui/src/ui/controllers/workspaces.ts`
  - State fields in `app.ts` and `app-view-state.ts`
  - Real-time updates via `jb.session.state` event in `app-gateway.ts`
- [x] G.17 — Render workspace cards: name, path, context % bar gauge, mode badge (`confirm`/`plan`/`auto`), output mode, status dot (green=running, gray=stopped, red=error), focused badge
- [x] G.18 — Context bar gauge: `<div>` with width=contextPercent%, color = `var(--ok)` if <70%, `var(--warn)` if 70-89%, `var(--danger)` if ≥90%
- [x] G.19 — Action buttons per card: "Focus" (hidden if already focused), "Compact", "Stop" — each calls corresponding `jb.session.*` RPC
- [x] G.20 — "Restart" action button in card — calls `jb.session.restart`
- [x] G.21 — Create workspace wired via `onCreate` callback prop — calls `jb.workspaces.create`
- [x] G.22 — Commands section in workspace card: list commands with name pills
- [x] G.23 — Disabled/paused workspaces: show "Delete" button only when `!ws.enabled`
- [x] G.24 — Wired `renderWorkspaces` in `app-render.ts` for the `"workspaces"` tab route

**Tests:**

- [x] G.25 — Write handler tests: `jb.workspaces.list` returns correct WorkspaceView shape (3 tests), `jb.workspaces.create` validates input (2 tests), `jb.session.focus` calls switchFocus with "gui" (1 test), `jb.session.restart` stops then recreates (2 tests), plus workspace CRUD, compact, stop, and commands tests (20 new tests total, all pass)
- [ ] G.26 — **Verify**: workspace cards update context % in real-time without page refresh
- [x] G.27 — `pnpm check` — 0 errors, 0 warnings

---

## Phase H — Tab Tunnels + FunnelProxy Management (6H)

**Goal**: Full tunnel management tab with Serve/Funnel list, FunnelProxy route management, health status.

**RPC handlers — tunnels:**

- [x] H.1 — `jb.tunnels.list` handler: call `tunnelManager.list()`, return `{ tunnels }` with id, project, localPort, url, provider, mode, status
- [x] H.2 — `jb.tunnels.create` handler: validate with `TunnelStartInputSchema.parse(params)`, call `tunnelManager.start(input)`, return created tunnel
- [x] H.3 — `jb.tunnels.delete` handler: take `params.tunnelId`, call `tunnelManager.stop(tunnelId)`, return `{ ok: true }`

**RPC handlers — proxy routes:**

- [x] H.4 — `jb.proxy.routes.list` handler: get `FunnelProxy` from tunnelManager, call `funnelProxy.listRoutes()`, return `{ routes }` with path and target
- [x] H.5 — `jb.proxy.routes.add` handler: take `params.path` and `params.target`, call `funnelProxy.addRoute(path, target)`, return `{ ok: true }`
- [x] H.6 — `jb.proxy.routes.remove` handler: take `params.path`, call `funnelProxy.removeRoute(path)`, return `{ ok: true }`
- [x] H.7 — `jb.proxy.status` handler: return `{ running: funnelProxy.isRunning(), port: funnelProxy.getPort(), routeCount: funnelProxy.listRoutes().length }`

**FunnelProxy `/proxy/` prefix enforcement:**

- [x] H.8 — In `src/tunnels/funnel-proxy.ts`, add `private normalizePath(path: string): string` method:
  - Ensure leading `/`: `let p = path.startsWith("/") ? path : "/" + path`
  - Ensure `/proxy/` prefix: `if (!p.startsWith("/proxy/")) p = "/proxy" + p`
  - Remove trailing slash (except root): `p.endsWith("/") && p.length > 1 ? p.slice(0, -1) : p`
- [x] H.9 — In `FunnelProxy.addRoute()`: call `this.normalizePath(path)` before storing — throw `FunnelProxyRouteConflictError` if route already exists
- [x] H.10 — Update `src/tunnels/funnel-proxy.test.ts`: test that `addRoute("frontend", ...)` becomes `/proxy/frontend`, `addRoute("/api", ...)` becomes `/proxy/api`, `addRoute("/proxy/demo", ...)` stays `/proxy/demo`
- [x] H.11 — Migrate existing DB routes: if any `funnelPath` in tunnels table lacks `/proxy/` prefix, update them (handled by normalizePath in addRoute, called during restore)

**Lit component:**

- [x] H.12 — Create `ui/src/ui/views/jb-tunnels.ts` as pure render function (follows codebase pattern):
  - `TunnelsProps` type with loading, tunnelsResult, proxyRoutesResult, proxyStatusResult, error, callbacks
  - `renderTunnels(props)` renders full tunnels tab
  - Controller functions in `ui/src/ui/controllers/tunnels.ts`
  - State fields in `app.ts` and `app-view-state.ts`
  - Real-time updates via `jb.tunnel.state` and `jb.proxy.state` events in `app-gateway.ts`
- [x] H.13 — Render "Tailscale Tunnels" section: list with Serve/Funnel badges, URL (clickable), status dot, Stop button
- [x] H.14 — Render "+ Create Tunnel" form: handled by controller `createTunnel()` with project, sessionId, localPort, mode params
- [x] H.15 — Render "Funnel Proxy" section: header with Running/Stopped status, port, route count. Route list with path, target, project, Remove button
- [x] H.16 — Render "+ Add Proxy Route" form: handled by controller `addProxyRoute()` with path and target params
- [x] H.17 — Wired `renderTunnels` in `app-render.ts` for the `"tunnels"` tab route

**Tests:**

- [x] H.18 — Write handler tests: `jb.tunnels.list` returns array, `jb.tunnels.create` validates input + handles TunnelPendingConfirmation, `jb.tunnels.delete` stops tunnel, `jb.proxy.routes.list`/add/remove, `jb.proxy.status` returns running state (9 tests)
- [x] H.19 — `pnpm check` — 0 errors, 0 warnings

---

## Phase I — Tab Devices (6I)

**Goal**: Extend "nodes" tab with device blacklist, extended info, and approval management from the GUI.

**DB schema:**

- [x] I.1 — In `src/db/schema.ts`, add `deviceBlacklist` table:
  ```
  deviceId: text("device_id").primaryKey()
  reason: text("reason")
  blockedAt: integer("blocked_at", { mode: "timestamp" }).notNull()
  ```
- [x] I.2 — Run `pnpm drizzle-kit generate` to create migration file in `src/db/migrations/`

**Device blacklist functions:**

- [x] I.3 — Create `src/gateway/device-blacklist.ts` exporting:
  - `blockDevice(db, deviceId, reason?)` — insert into `deviceBlacklist` with `blockedAt: new Date()`
  - `unblockDevice(db, deviceId)` — delete from `deviceBlacklist` by `deviceId`
  - `isDeviceBlocked(db, deviceId): boolean` — query `deviceBlacklist` by `deviceId`
  - `listBlockedDevices(db)` — return all blocked devices

**RPC handlers:**

- [x] I.4 — `jb.devices.block` handler: take `params.deviceId` + `params.reason?`, call `blockDevice()`, return `{ ok: true }`
- [x] I.5 — `jb.devices.unblock` handler: take `params.deviceId`, call `unblockDevice()`, return `{ ok: true }`

**UI changes:**

- [x] I.6 — In nodes/devices view: change header text from "Nodes" to "Devices"
- [x] I.7 — Add "Approved" section: list approved devices from `device.pair.list` RPC with columns: name, last access, IP address, [Revoke] [Block] buttons
- [x] I.8 — Add "Pending" section: list pending pairing requests with columns: device info, 6-digit code, IP, [Approve] [Reject] [Block] buttons
- [x] I.9 — Add "Blocked" section: list blocked devices from `jb.devices.block` data with [Unblock] button
- [x] I.10 — Add notification badge on "Devices" tab in sidebar when `pendingCount > 0`
- [x] I.11 — Subscribe to `jb.device.paired` events: add new devices to list in real-time, update badge count

**Tests:**

- [x] I.12 — Write `src/gateway/device-blacklist.test.ts`: blockDevice inserts, unblockDevice deletes, isDeviceBlocked returns true/false, listBlockedDevices returns all
- [x] I.13 — Write handler tests: `jb.devices.block` persists to DB, `jb.devices.unblock` removes from DB
- [x] I.14 — `pnpm check` — 0 errors, 0 warnings

---

## Phase J — Tab Jorchfile Editor (6J)

**Goal**: Visual Jorchfile editor with structured form mode and raw text mode.

**RPC handlers:**

- [x] J.1 — `jb.jorchfile.get` handler: get `JorchfileExecutor` from deps, call `getJorchfile()`, map projects to `{ name, path, commands: { dev?, build?, test?, ... }, instructions?, approve?, output?, port?, tunnel? }`, return `{ jorchfile: { projects, settings } }`
- [x] J.2 — `jb.jorchfile.set` handler: take `params.content` (raw string), resolve Jorchfile path, write with `writeFileSync(path, content, { mode: 0o600 })` — JorchfileWatcher detects change and hot-reloads. Return `{ ok: true }`
- [x] J.3 — `jb.jorchfile.commands` handler: take `params.project`, return available commands (built-in + custom) for that project from JorchfileExecutor

**Lit component:**

- [x] J.4 — Create `ui/src/ui/views/jb-jorchfile.ts` as pure render function (following codebase pattern):
  - `JorchfileProps` type with loading, jorchfile, error, dirty, textMode, rawContent, and callbacks
  - State managed in `app-view-state.ts` and `app.ts` via `@state()` properties
  - Controller in `ui/src/ui/controllers/jorchfile.ts` with `loadJorchfile`, `saveJorchfile`, `reloadJorchfile`, `serializeJorchfile`
  - Data fetched via `jb.jorchfile.get` RPC on tab navigation
- [x] J.5 — **Form mode**: render each PROJECT as expandable `<details>` section with:
  - Header: project name (editable), path (editable)
  - Commands section: `dev`, `build`, `test`, custom commands — each with text input
  - Settings: `tunnel` (checkbox), `port` (number input), `instructions` (textarea), `approve` (select: confirm/plan/auto), `output` (select: verbose/summary/silent)
- [x] J.6 — **Text mode**: raw `<textarea>` with monospace font, Makefile-style content, manual editing
- [x] J.7 — Toggle button: "Form" / "Text" — switching from form to text serializes current state to raw, switching from text to form parses raw content
- [x] J.8 — "Save" button: calls `jb.jorchfile.set` with serialized content, clears `dirty` flag
- [x] J.9 — "Reload" button: re-fetches from `jb.jorchfile.get`, overwrites local state, clears `dirty`
- [x] J.10 — "+ Add Project" button in form mode: adds empty project section with name input
- [x] J.11 — "Remove Project" button per section: removes project from form state (marks dirty)
- [x] J.12 — "+ Add Command" / "Remove Command" buttons per project for custom commands
- [x] J.13 — Validation: highlight required fields (path), validate port range (1-65535), show error text below invalid fields
- [x] J.14 — Register `renderJorchfile` in `app-render.ts` for the `"jorchfile"` tab route

**Tests:**

- [x] J.15 — Write handler tests: `jb.jorchfile.get` returns parsed Jorchfile, `jb.jorchfile.set` writes to disk, `jb.jorchfile.commands` returns project commands
- [x] J.16 — `pnpm check` — 0 errors, 0 warnings

---

## Phase K — /gui Command + Funnel Toggle (6K)

**Goal**: `/gui` sends URL to WhatsApp. `/gui funnel on|off` toggles public exposure with 4-digit confirmation code.

**Command implementation:**

- [x] K.1 — Create `src/commands/gui-command.ts` exporting:
  - `FunnelConfirmation = { action: "on" | "off"; code: string; expiresAt: number }`
  - `GuiCommandDeps = { sendReply, getPort, getPendingConfirmation, setPendingConfirmation }`
  - `handleGuiCommand(args: string, deps: GuiCommandDeps): Promise<void>`
  - `handleFunnelConfirmation(text: string, deps: GuiCommandDeps): Promise<boolean>`
- [x] K.2 — `/gui` (no args): detect Tailscale hostname via `TailscaleServeAdapter.getHostname()`, build URL (`http://` for tailnet, `https://` for funnel), send reply with URL + mode info + accessibility note
- [x] K.3 — `/gui funnel on`: generate 4-digit code (`Math.floor(1000 + Math.random() * 9000)`), store as `FunnelConfirmation` with `expiresAt: Date.now() + 60_000`, send reply: "To confirm, reply with the code: XXXX (expires in 60 seconds)"
- [x] K.4 — `/gui funnel off`: same pattern, action="off", description about restricting to tailnet
- [x] K.5 — `handleFunnelConfirmation(text, deps)`:
  1. If no pending confirmation → return `false`
  2. If `Date.now() > expiresAt` → clear pending, send "expired" reply, return `true`
  3. If `text.trim() !== code` → return `false` (not consumed, might be regular text)
  4. If code matches → clear pending, `loadConfig()`, set `config.gui.funnel = (action === "on")`, `saveConfig(config)`, send success reply, return `true`

**Tailscale Funnel management on toggle:**

- [x] K.6 — When toggling to `gui.funnel = true`: call Tailscale Funnel to expose port 18789 publicly, update GUI access middleware state
- [x] K.7 — When toggling to `gui.funnel = false`: call Tailscale Funnel off for port 18789, update GUI access middleware state

**Integration:**

- [x] K.8 — Register `/gui` command in CommandRouter with handler that calls `handleGuiCommand(args, guiCommandDeps)`
- [x] K.9 — In `jorchbot-start.ts` `onMessage` handler, BEFORE CommandRouter dispatch, AFTER approval feedback check: call `handleFunnelConfirmation(messageText, guiCommandDeps)` — if returns `true`, skip further processing

**Tests:**

- [x] K.10 — Write `src/commands/gui-command.test.ts`:
  - `/gui` calls sendReply with URL containing hostname and port
  - `/gui funnel on` sets pending confirmation with 4-digit code, calls sendReply with code
  - Correct code within 60s → confirms, calls saveConfig, sends success reply
  - Wrong code → returns false (not consumed)
  - Expired code → returns true, sends "expired" reply, clears pending
  - `/gui invalid` → sends usage message
- [x] K.11 — `pnpm check` — 0 errors, 0 warnings

---

## Phase L — Mobile Responsive (6L)

**Goal**: GUI usable on phone screens (320px–428px width, breakpoint at 640px).

**CSS changes:**

- [ ] L.1 — Sidebar: `@media (max-width: 640px)` → hide sidebar, show hamburger toggle button in header, sidebar opens as fixed overlay with `z-index: 100`
- [ ] L.2 — Workspace cards: single-column grid `grid-template-columns: 1fr` at ≤640px
- [ ] L.3 — Touch targets: all `<button>`, action items, interactive elements → `min-height: 44px; min-width: 44px`
- [ ] L.4 — Content padding: reduce to `12px` on mobile
- [ ] L.5 — Remove all hover-dependent interactions: ensure no functionality requires `:hover` — use click/tap only, hover styles are supplemental only

**Per-tab verification:**

- [ ] L.6 — Tunnel list: verify URLs don't overflow, cards stack vertically, stop buttons tappable
- [ ] L.7 — Jorchfile editor: force form mode on ≤640px (hide text mode toggle), fields stack vertically
- [ ] L.8 — Devices tab: sections stack vertically, all buttons tappable
- [ ] L.9 — Logs tab: touch scroll works, auto-scroll toggle accessible
- [ ] L.10 — Overview: workspace summary cards stack, context bars readable

**Testing:**

- [ ] L.11 — Test in Chrome DevTools: iPhone SE (375×667), iPhone 14 (390×844), Pixel 5 (393×851)
- [ ] L.12 — Verify all tabs accessible via hamburger menu
- [ ] L.13 — `pnpm check` — 0 errors, 0 warnings

---

## Final Verification

**Automated:**

- [ ] V.1 — `pnpm check` passes (0 errors, 0 warnings)
- [ ] V.2 — `pnpm test:fast` passes (all existing + new tests)
- [ ] V.3 — `pnpm ui:build` succeeds without errors

**Integration tests (SPEC section 19.3):**

- [ ] V.4 — Write integration test: mount full gateway with Control UI → verify SPA loads at `/`
- [ ] V.5 — Write integration test: connect WebSocket → verify `connect` → `hello-ok` handshake → RPC round-trip (`config.get`)
- [ ] V.6 — Write integration test: create session via WS RPC → verify it appears in `jb.workspaces.list` response

**Manual smoke tests:**

- [ ] V.7 — Load GUI at `http://localhost:18789/`, navigate all 10 visible tabs, verify no console errors
- [ ] V.8 — `/gui` command from WhatsApp → sends URL
- [ ] V.9 — Create workspace from GUI → appears in list with context %
- [ ] V.10 — Stop workspace from GUI → status updates in real-time
- [ ] V.11 — Create/stop tunnel from GUI → URL appears/disappears
- [ ] V.12 — Add/remove proxy route from GUI
- [ ] V.13 — Edit Jorchfile from GUI → save → hot-reload picks up changes
- [ ] V.14 — Block/unblock device from GUI
- [ ] V.15 — Mobile browser (phone in tailnet) → all tabs usable

**Branding:**

- [ ] V.16 — `grep -ri "openclaw" ui/src/ --include="*.ts" --include="*.css" --include="*.html"` → 0 matches in user-visible strings
