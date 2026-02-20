# Phase 4 — Tunnel Manager — TODO

> **Total tasks**: 52
> **Sub-phases**: 4A through 4H
> **Dependency**: Phase 3 completed

---

## Sub-phase DAG

```
4A (Types + Errors + Config)
  │
  ├──→ 4B (Tailscale Adapters)
  │      │
  │      ├──→ 4D (Funnel Reverse Proxy)
  │      │
  │      └──→ 4C (DB Persistence)
  │             │
  │             └──→ 4E (TunnelManager Orchestrator)
  │                    │
  │                    ├──→ 4F (Health Monitoring)
  │                    │
  │                    └──→ 4G (Commands — Chat + CLI)
  │
  └──→ 4H (Migration + Integration + Cleanup)
```

---

## 4A — Types, Errors, and Config (Foundation)

Everything else depends on this. Types, error classes, and config schema extensions.

- [ ] Create `src/tunnels/types.ts` with Zod schemas (`TunnelMode`, `TunnelStatus`, `TunnelProvider`, `TunnelStartInputSchema`) and TypeScript interfaces (`TunnelInfo`, `TunnelEvent`, `TunnelHealthEntry`, `TunnelHealthReport`, `TunnelManagerCallbacks`)
- [ ] Add tunnel error classes to `src/errors/index.ts`: `TailscaleNotInstalledError`, `TailscaleNotAuthenticatedError`, `TunnelStartError`, `TunnelStopError`, `TunnelNotFoundError`, `FunnelNotEnabledError`, `TunnelHealthCheckError`, `FunnelProxyStartError`, `FunnelProxyRouteConflictError`
- [ ] Extend `TunnelsSchema` in `src/config/jorchbot-config.ts` with `funnelProxy.port` (literal 8443) and `health` sub-schema (`intervalMs`, `failureThreshold`, `maxRestartAttempts`)
- [ ] Add `project` (text, not null) and `funnelPath` (text, nullable) columns to `tunnels` table in `src/db/schema.ts`
- [ ] Run `pnpm drizzle-kit generate` to create DB migration
- [ ] Write tests for Zod schemas (valid/invalid inputs)
- [ ] Ensure `pnpm check` passes

**Acceptance**: All types compile, error classes exist, config validates with new fields, DB migration applies cleanly.

---

## 4B — Tailscale Adapters (Serve + Funnel)

Adapters that wrap `src/infra/tailscale.ts` with JorchBot error handling.

- [ ] Create `src/tunnels/adapters/tailscale-serve.ts` with `TailscaleServeAdapter` class
  - [ ] `ensureAvailable()` — checks Tailscale binary + auth, caches hostname
  - [ ] `getHostname()` — returns cached tailnet hostname
  - [ ] `start(port)` — calls `tailscale serve --bg --yes <port>` via `runExec`, returns URL
  - [ ] `stop(port)` — calls `tailscale serve off <port>` (best-effort)
  - [ ] `isActive(port)` — checks `tailscale serve status --json`
- [ ] Write `src/tunnels/adapters/tailscale-serve.test.ts`
  - [ ] Test: `ensureAvailable()` throws `TailscaleNotInstalledError` when binary not found
  - [ ] Test: `ensureAvailable()` throws `TailscaleNotAuthenticatedError` when not logged in
  - [ ] Test: `start()` returns URL with correct hostname and port
  - [ ] Test: `stop()` calls correct Tailscale command
  - [ ] Test: `isActive()` returns true/false based on status output
- [ ] Create `src/tunnels/adapters/tailscale-funnel.ts` with `TailscaleFunnelAdapter` class
  - [ ] `start(port)` — calls `tailscale funnel --bg --yes <port>` via `runExec`
  - [ ] `stop(port)` — calls `tailscale funnel off <port>` (best-effort)
  - [ ] `isActive(port)` — checks `tailscale funnel status --json`
- [ ] Write `src/tunnels/adapters/tailscale-funnel.test.ts`
  - [ ] Test: `start()` throws `FunnelNotEnabledError` when Funnel not enabled
  - [ ] Test: `start()` succeeds on valid port
  - [ ] Test: `stop()` calls correct Tailscale command
- [ ] Ensure `pnpm check` passes

**Acceptance**: Both adapters start/stop tunnels via mocked Tailscale commands with proper error types.

---

## 4C — DB Persistence Layer

CRUD operations for the `tunnels` table.

- [ ] Create `src/tunnels/tunnel-db.ts` with `TunnelDb` class
  - [ ] `insert(info, funnelPath?)` — insert tunnel record
  - [ ] `updateStatus(tunnelId, status)` — update status column
  - [ ] `listActive()` — return all records with status "active"
  - [ ] `getById(tunnelId)` — return single record or undefined
- [ ] Write `src/tunnels/tunnel-db.test.ts` (uses real SQLite via `JORCHBOT_DB_PATH` temp)
  - [ ] Test: `insert()` creates record with all fields
  - [ ] Test: `updateStatus()` changes status
  - [ ] Test: `listActive()` returns only active tunnels
  - [ ] Test: `getById()` returns record or undefined
  - [ ] Test: cascade delete (when session is deleted, tunnels are deleted)
- [ ] Ensure `pnpm check` passes

**Acceptance**: TunnelDb reads/writes the tunnels table correctly with proper error handling.

---

## 4D — Funnel Reverse Proxy

HTTP reverse proxy on port 8443 using `http-proxy` npm package.

- [ ] Add `http-proxy` dependency: `pnpm add http-proxy && pnpm add -D @types/http-proxy`
- [ ] Create `src/tunnels/funnel-proxy.ts` with `FunnelProxy` class
  - [ ] Constructor takes port number (always 8443)
  - [ ] `start()` — create HTTP server + proxy, listen on 127.0.0.1:8443
  - [ ] `stop()` — close proxy and server
  - [ ] `addRoute(route)` — add path → target mapping (throw on conflict)
  - [ ] `removeRoute(path)` — remove route
  - [ ] `listRoutes()` — return all routes
  - [ ] `hasRoute(path)` — check existence
  - [ ] `isRunning()` — check if server is listening
  - [ ] `getPort()` — return port number
  - [ ] Request handling: match longest path prefix, strip prefix, proxy to target
  - [ ] WebSocket upgrade handling for HMR pass-through
  - [ ] 502 response when upstream is down
  - [ ] 404 response when no route matches
- [ ] Write `src/tunnels/funnel-proxy.test.ts`
  - [ ] Test: `start()` + `stop()` lifecycle
  - [ ] Test: `addRoute()` registers route, `removeRoute()` removes it
  - [ ] Test: duplicate `addRoute()` throws `FunnelProxyRouteConflictError`
  - [ ] Test: HTTP request routed to correct target (use real HTTP server on random port)
  - [ ] Test: path prefix is stripped before proxying
  - [ ] Test: 404 for unmatched paths
  - [ ] Test: WebSocket upgrade passes through (basic test)
- [ ] Ensure `pnpm check` passes

**Acceptance**: Proxy routes HTTP/WS requests by path to local targets. Start/stop lifecycle works. Proper error handling.

---

## 4E — TunnelManager Orchestrator

The main TunnelManager that ties everything together.

- [ ] Create `src/tunnels/manager.ts` with `TunnelManager` class (overwrite placeholder)
  - [ ] Constructor takes `TunnelManagerDeps` (adapters, proxy, health, db, callbacks)
  - [ ] `start(input)` — validate input, check Tailscale, start serve or request funnel confirmation
  - [ ] `confirmFunnel(tunnelId)` — create funnel tunnel after user confirmation
  - [ ] `cancelFunnel(tunnelId)` — discard pending confirmation
  - [ ] `stop(tunnelId)` — stop by tunnel ID
  - [ ] `stopByProjectPort(project, port)` — backward compat
  - [ ] `stopByProject(project)` — stop all for project
  - [ ] `stopBySession(sessionId)` — stop all for session
  - [ ] `stopAll()` — shutdown cleanup
  - [ ] `list()` / `listByProject()` / `get()` / `findByProjectPort()` — query methods
  - [ ] `health()` — delegate to HealthMonitor
  - [ ] `restore()` — sync DB with Tailscale reality on startup
- [ ] Create `TunnelPendingConfirmation` sentinel class
- [ ] Write `src/tunnels/manager.test.ts`
  - [ ] Test: `start()` with serve mode creates tunnel, persists to DB, notifies
  - [ ] Test: `start()` with funnel mode throws `TunnelPendingConfirmation`
  - [ ] Test: `confirmFunnel()` creates funnel tunnel with proxy route
  - [ ] Test: `cancelFunnel()` discards pending
  - [ ] Test: `stop()` removes tunnel from memory and DB
  - [ ] Test: `stopByProject()` removes all tunnels for project
  - [ ] Test: `stopAll()` clears everything
  - [ ] Test: `restore()` reconnects alive tunnels from DB
  - [ ] Test: `restore()` marks dead tunnels as stopped
  - [ ] Test: multiple tunnels per project (different ports)
- [ ] Ensure `pnpm check` passes

**Acceptance**: TunnelManager orchestrates serve/funnel lifecycle with DB persistence, confirmation flow, and restore.

---

## 4F — Health Monitoring

Periodic health checks with auto-restart and backoff.

- [ ] Create `src/tunnels/health.ts` with `HealthMonitor` class
  - [ ] `start(manager)` — begin periodic checks (setInterval)
  - [ ] `stop()` — stop checks (clearInterval)
  - [ ] `checkAll(tunnels)` — return `TunnelHealthReport`
  - [ ] Private: `runCheck()` — check each active tunnel
  - [ ] Private: `handleFailure(tunnel)` — track failures, trigger restart with backoff
  - [ ] Private: `attemptRestart(tunnel)` — try to restart failed tunnel
  - [ ] Backoff schedule: 1s, 5s, 30s (max 3 attempts)
  - [ ] After 3 failed restarts: mark as error, notify via callback
  - [ ] Reset counters on successful check after failure
- [ ] Write `src/tunnels/health.test.ts`
  - [ ] Test: healthy tunnels have 0 consecutive failures
  - [ ] Test: 3 consecutive failures trigger auto-restart
  - [ ] Test: successful restart resets failure counters
  - [ ] Test: after max retries, tunnel marked as error
  - [ ] Test: `stop()` clears interval and counters
  - [ ] Test: recovery emits `tunnel:health_restored` event
- [ ] Ensure `pnpm check` passes

**Acceptance**: Health monitor detects failures, retries with backoff, gives up after 3 attempts, notifies on all state changes.

---

## 4G — Commands (Chat + CLI)

User-facing commands for tunnel management.

### Chat commands (CommandRouter)

- [ ] Add `/tunnel` handler to `src/commands/router.ts`
  - [ ] Parse: `<project> [port] [--public]`
  - [ ] Resolve port from args, running task, or error
  - [ ] Call `tunnelManager.start()`, handle `TunnelPendingConfirmation`
- [ ] Add `/tunnel-stop` handler to `src/commands/router.ts`
  - [ ] Parse: `<project> [port]`
  - [ ] If port specified: `stopByProjectPort()`. Else: `stopByProject()`
- [ ] Add `/tunnels` handler to `src/commands/router.ts`
  - [ ] List all tunnels, grouped by mode (PRIVATE / PUBLIC)
- [ ] Update `/help` handler to include tunnel commands
- [ ] Update `/status` handler to include tunnel count
- [ ] Add `tunnelManager` to `CommandRouterDeps` interface
- [ ] Update button callback handler for new `tunnel_approve`/`tunnel_reject` format (tunnelId instead of project+port)

### CLI commands (Commander)

- [ ] Add `jorchbot jb tunnel start <project> [--port] [--public]` command
- [ ] Add `jorchbot jb tunnel stop <project> [--port]` command
- [ ] Add `jorchbot jb tunnel list` command
- [ ] Add `jorchbot jb tunnel status` command (health report)

### Tests

- [ ] Test: `/tunnel frontend` starts serve tunnel
- [ ] Test: `/tunnel frontend --public` triggers funnel confirmation
- [ ] Test: `/tunnels` output format
- [ ] Test: `/tunnel-stop frontend` stops all tunnels for project
- [ ] Ensure `pnpm check` passes

**Acceptance**: All 3 chat commands work end-to-end. CLI tunnel subcommand registered. Help text updated.

---

## 4H — Migration, Integration, and Cleanup

Remove Phase 3 tunnel code, update all imports, verify integration.

- [ ] Delete `src/jorchfile/tunnel.ts`
- [ ] Delete `src/jorchfile/tunnel.test.ts`
- [ ] Delete placeholder files:
  - [ ] `src/tunnels/port-manager.ts` (PortManager stays in `src/jorchfile/`)
  - [ ] `src/tunnels/tailscale.ts` (replaced by adapters)
- [ ] Update import in `src/gateway/jorchbot-start.ts`: `TunnelManager` from `../tunnels/manager.js`
- [ ] Update import in `src/jorchfile/executor.ts`: `TunnelManager` from `../tunnels/manager.js`
- [ ] Update `JorchfileExecutor` API calls:
  - [ ] `tunnelManager.start(...)` — add `sessionId` to input
  - [ ] `tunnelManager.stop(project, port)` → `tunnelManager.stopByProjectPort(project, port)`
  - [ ] `tunnelManager.stopAll(project)` → `tunnelManager.stopByProject(project)`
  - [ ] `tunnelManager.listAll()` → `tunnelManager.list()`
- [ ] Update `jorchbot-start.ts` TunnelManager construction (adapters, proxy, health, db, callbacks)
- [ ] Update `jorchbot-start.ts` shutdown handler to call `tunnelManager.stopAll()`
- [ ] Update `jorchbot-start.ts` button handlers for new tunnel_approve/reject format
- [ ] Add `tunnelManager.restore()` call after session restore in gateway start
- [ ] Update `onSessionDestroy` callback to use `tunnelManager.stopByProject()`
- [ ] Run `pnpm check` — fix ALL errors (type, lint, format)
- [ ] Run `pnpm test:fast` — verify no regressions
- [ ] Run `pnpm build` — verify build succeeds

**Acceptance**: All Phase 3 tunnel tests replaced. All imports updated. Gateway starts cleanly. `pnpm check` passes with 0 errors.

---

## Summary

| Sub-phase | Description                | Tasks  | Depends on |
| --------- | -------------------------- | ------ | ---------- |
| **4A**    | Types, Errors, Config      | 7      | —          |
| **4B**    | Tailscale Adapters         | 13     | 4A         |
| **4C**    | DB Persistence             | 5      | 4A         |
| **4D**    | Funnel Reverse Proxy       | 7      | 4A         |
| **4E**    | TunnelManager Orchestrator | 7      | 4B, 4C, 4D |
| **4F**    | Health Monitoring          | 5      | 4E         |
| **4G**    | Commands (Chat + CLI)      | 12     | 4E         |
| **4H**    | Migration + Cleanup        | 13     | 4E, 4F, 4G |
| **Total** |                            | **52** |            |

**Recommended execution order**: 4A → 4B + 4C + 4D (parallel) → 4E → 4F + 4G (parallel) → 4H
