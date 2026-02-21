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

- [x] Create `src/tunnels/types.ts` with Zod schemas (`TunnelMode`, `TunnelStatus`, `TunnelProvider`, `TunnelStartInputSchema`) and TypeScript interfaces (`TunnelInfo`, `TunnelEvent`, `TunnelHealthEntry`, `TunnelHealthReport`, `TunnelManagerCallbacks`)
- [x] Add tunnel error classes to `src/errors/index.ts`: `TailscaleNotInstalledError`, `TailscaleNotAuthenticatedError`, `TunnelStartError`, `TunnelStopError`, `TunnelNotFoundError`, `FunnelNotEnabledError`, `TunnelHealthCheckError`, `FunnelProxyStartError`, `FunnelProxyRouteConflictError`
- [x] Extend `TunnelsSchema` in `src/config/jorchbot-config.ts` with `funnelProxy.port` (literal 8443) and `health` sub-schema (`intervalMs`, `failureThreshold`, `maxRestartAttempts`)
- [x] Add `project` (text, not null) and `funnelPath` (text, nullable) columns to `tunnels` table in `src/db/schema.ts`
- [x] Run `pnpm drizzle-kit generate` to create DB migration
- [x] Write tests for Zod schemas (valid/invalid inputs)
- [x] Ensure `pnpm check` passes

**Acceptance**: All types compile, error classes exist, config validates with new fields, DB migration applies cleanly.

---

## 4B — Tailscale Adapters (Serve + Funnel)

Adapters that wrap `src/infra/tailscale.ts` with JorchBot error handling.

- [x] Create `src/tunnels/adapters/tailscale-serve.ts` with `TailscaleServeAdapter` class
  - [x] `ensureAvailable()` — checks Tailscale binary + auth, caches hostname
  - [x] `getHostname()` — returns cached tailnet hostname
  - [x] `start(port)` — calls `tailscale serve --bg --yes <port>` via `runExec`, returns URL
  - [x] `stop(port)` — calls `tailscale serve off <port>` (best-effort)
  - [x] `isActive(port)` — checks `tailscale serve status --json`
- [x] Write `src/tunnels/adapters/tailscale-serve.test.ts`
  - [x] Test: `ensureAvailable()` throws `TailscaleNotInstalledError` when binary not found
  - [x] Test: `ensureAvailable()` throws `TailscaleNotAuthenticatedError` when not logged in
  - [x] Test: `start()` returns URL with correct hostname and port
  - [x] Test: `stop()` calls correct Tailscale command
  - [x] Test: `isActive()` returns true/false based on status output
- [x] Create `src/tunnels/adapters/tailscale-funnel.ts` with `TailscaleFunnelAdapter` class
  - [x] `start(port)` — calls `tailscale funnel --bg --yes <port>` via `runExec`
  - [x] `stop(port)` — calls `tailscale funnel off <port>` (best-effort)
  - [x] `isActive(port)` — checks `tailscale funnel status --json`
- [x] Write `src/tunnels/adapters/tailscale-funnel.test.ts`
  - [x] Test: `start()` throws `FunnelNotEnabledError` when Funnel not enabled
  - [x] Test: `start()` succeeds on valid port
  - [x] Test: `stop()` calls correct Tailscale command
- [x] Ensure `pnpm check` passes

**Acceptance**: Both adapters start/stop tunnels via mocked Tailscale commands with proper error types.

---

## 4C — DB Persistence Layer

CRUD operations for the `tunnels` table.

- [x] Create `src/tunnels/tunnel-db.ts` with `TunnelDb` class
  - [x] `insert(info, funnelPath?)` — insert tunnel record
  - [x] `updateStatus(tunnelId, status)` — update status column
  - [x] `listActive()` — return all records with status "active"
  - [x] `getById(tunnelId)` — return single record or undefined
- [x] Write `src/tunnels/tunnel-db.test.ts` (uses real SQLite via `JORCHBOT_DB_PATH` temp)
  - [x] Test: `insert()` creates record with all fields
  - [x] Test: `updateStatus()` changes status
  - [x] Test: `listActive()` returns only active tunnels
  - [x] Test: `getById()` returns record or undefined
  - [x] Test: cascade delete (when session is deleted, tunnels are deleted)
- [x] Ensure `pnpm check` passes

**Acceptance**: TunnelDb reads/writes the tunnels table correctly with proper error handling.

---

## 4D — Funnel Reverse Proxy

HTTP reverse proxy on port 8443 using `http-proxy` npm package.

- [x] Add `http-proxy` dependency: `pnpm add http-proxy && pnpm add -D @types/http-proxy`
- [x] Create `src/tunnels/funnel-proxy.ts` with `FunnelProxy` class
  - [x] Constructor takes port number (always 8443)
  - [x] `start()` — create HTTP server + proxy, listen on 127.0.0.1:8443
  - [x] `stop()` — close proxy and server
  - [x] `addRoute(route)` — add path → target mapping (throw on conflict)
  - [x] `removeRoute(path)` — remove route
  - [x] `listRoutes()` — return all routes
  - [x] `hasRoute(path)` — check existence
  - [x] `isRunning()` — check if server is listening
  - [x] `getPort()` — return port number
  - [x] Request handling: match longest path prefix, strip prefix, proxy to target
  - [x] WebSocket upgrade handling for HMR pass-through
  - [x] 502 response when upstream is down
  - [x] 404 response when no route matches
- [x] Write `src/tunnels/funnel-proxy.test.ts`
  - [x] Test: `start()` + `stop()` lifecycle
  - [x] Test: `addRoute()` registers route, `removeRoute()` removes it
  - [x] Test: duplicate `addRoute()` throws `FunnelProxyRouteConflictError`
  - [x] Test: HTTP request routed to correct target (use real HTTP server on random port)
  - [x] Test: path prefix is stripped before proxying
  - [x] Test: 404 for unmatched paths
  - [x] Test: WebSocket upgrade passes through (basic test)
- [x] Ensure `pnpm check` passes

**Acceptance**: Proxy routes HTTP/WS requests by path to local targets. Start/stop lifecycle works. Proper error handling.

---

## 4E — TunnelManager Orchestrator

The main TunnelManager that ties everything together.

- [x] Create `src/tunnels/manager.ts` with `TunnelManager` class (overwrite placeholder)
  - [x] Constructor takes `TunnelManagerDeps` (adapters, proxy, health, db, callbacks)
  - [x] `start(input)` — validate input, check Tailscale, start serve or request funnel confirmation
  - [x] `confirmFunnel(tunnelId)` — create funnel tunnel after user confirmation
  - [x] `cancelFunnel(tunnelId)` — discard pending confirmation
  - [x] `stop(tunnelId)` — stop by tunnel ID
  - [x] `stopByProjectPort(project, port)` — backward compat
  - [x] `stopByProject(project)` — stop all for project
  - [x] `stopBySession(sessionId)` — stop all for session
  - [x] `stopAll()` — shutdown cleanup
  - [x] `list()` / `listByProject()` / `get()` / `findByProjectPort()` — query methods
  - [x] `health()` — delegate to HealthMonitor
  - [x] `restore()` — sync DB with Tailscale reality on startup
- [x] Create `TunnelPendingConfirmation` sentinel class
- [x] Write `src/tunnels/manager.test.ts`
  - [x] Test: `start()` with serve mode creates tunnel, persists to DB, notifies
  - [x] Test: `start()` with funnel mode throws `TunnelPendingConfirmation`
  - [x] Test: `confirmFunnel()` creates funnel tunnel with proxy route
  - [x] Test: `cancelFunnel()` discards pending
  - [x] Test: `stop()` removes tunnel from memory and DB
  - [x] Test: `stopByProject()` removes all tunnels for project
  - [x] Test: `stopAll()` clears everything
  - [x] Test: `restore()` reconnects alive tunnels from DB
  - [x] Test: `restore()` marks dead tunnels as stopped
  - [x] Test: multiple tunnels per project (different ports)
- [x] Ensure `pnpm check` passes

**Acceptance**: TunnelManager orchestrates serve/funnel lifecycle with DB persistence, confirmation flow, and restore.

---

## 4F — Health Monitoring

Periodic health checks with auto-restart and backoff.

- [x] Create `src/tunnels/health.ts` with `HealthMonitor` class
  - [x] `start(manager)` — begin periodic checks (setInterval)
  - [x] `stop()` — stop checks (clearInterval)
  - [x] `checkAll(tunnels)` — return `TunnelHealthReport`
  - [x] Private: `runCheck()` — check each active tunnel
  - [x] Private: `handleFailure(tunnel)` — track failures, trigger restart with backoff
  - [x] Private: `attemptRestart(tunnel)` — try to restart failed tunnel
  - [x] Backoff schedule: 1s, 5s, 30s (max 3 attempts)
  - [x] After 3 failed restarts: mark as error, notify via callback
  - [x] Reset counters on successful check after failure
- [x] Write `src/tunnels/health.test.ts`
  - [x] Test: healthy tunnels have 0 consecutive failures
  - [x] Test: 3 consecutive failures trigger auto-restart
  - [x] Test: successful restart resets failure counters
  - [x] Test: after max retries, tunnel marked as error
  - [x] Test: `stop()` clears interval and counters
  - [x] Test: recovery emits `tunnel:health_restored` event
- [x] Ensure `pnpm check` passes

**Acceptance**: Health monitor detects failures, retries with backoff, gives up after 3 attempts, notifies on all state changes.

---

## 4G — Commands (Chat + CLI)

User-facing commands for tunnel management.

### Chat commands (CommandRouter)

- [x] Add `/tunnel` handler to `src/commands/router.ts`
  - [x] Parse: `<project> [port] [--public]`
  - [x] Resolve port from args, running task, or error
  - [x] Call `tunnelManager.start()`, handle `TunnelPendingConfirmation`
- [x] Add `/tunnel-stop` handler to `src/commands/router.ts`
  - [x] Parse: `<project> [port]`
  - [x] If port specified: `stopByProjectPort()`. Else: `stopByProject()`
- [x] Add `/tunnels` handler to `src/commands/router.ts`
  - [x] List all tunnels, grouped by mode (PRIVATE / PUBLIC)
- [x] Update `/help` handler to include tunnel commands
- [x] Update `/status` handler to include tunnel count
- [x] Add `tunnelManager` to `CommandRouterDeps` interface
- [x] Update button callback handler for new `tunnel_approve`/`tunnel_reject` format (tunnelId instead of project+port)

### CLI commands (Commander)

- [x] Add `jorchbot jb tunnel start <project> [--port] [--public]` command
- [x] Add `jorchbot jb tunnel stop <project> [--port]` command
- [x] Add `jorchbot jb tunnel list` command
- [x] Add `jorchbot jb tunnel status` command (health report)

### Tests

- [x] Test: `/tunnel frontend` starts serve tunnel
- [x] Test: `/tunnel frontend --public` triggers funnel confirmation
- [x] Test: `/tunnels` output format
- [x] Test: `/tunnel-stop frontend` stops all tunnels for project
- [x] Ensure `pnpm check` passes

**Acceptance**: All 3 chat commands work end-to-end. CLI tunnel subcommand registered. Help text updated.

---

## 4H — Migration, Integration, and Cleanup

Remove Phase 3 tunnel code, update all imports, verify integration.

- [x] Delete `src/jorchfile/tunnel.ts`
- [x] Delete `src/jorchfile/tunnel.test.ts`
- [x] Delete placeholder files:
  - [x] `src/tunnels/port-manager.ts` (PortManager stays in `src/jorchfile/`)
  - [x] `src/tunnels/tailscale.ts` (replaced by adapters)
- [x] Update import in `src/gateway/jorchbot-start.ts`: `TunnelManager` from `../tunnels/manager.js`
- [x] Update import in `src/jorchfile/executor.ts`: `TunnelManager` from `../tunnels/manager.js`
- [x] Update `JorchfileExecutor` API calls:
  - [x] `tunnelManager.start(...)` — add `sessionId` to input
  - [x] `tunnelManager.stop(project, port)` → `tunnelManager.stopByProjectPort(project, port)`
  - [x] `tunnelManager.stopAll(project)` → `tunnelManager.stopByProject(project)`
  - [x] `tunnelManager.listAll()` → `tunnelManager.list()`
- [x] Update `jorchbot-start.ts` TunnelManager construction (adapters, proxy, health, db, callbacks)
- [x] Update `jorchbot-start.ts` shutdown handler to call `tunnelManager.stopAll()`
- [x] Update `jorchbot-start.ts` button handlers for new tunnel_approve/reject format
- [x] Add `tunnelManager.restore()` call after session restore in gateway start
- [x] Update `onSessionDestroy` callback to use `tunnelManager.stopByProject()`
- [x] Run `pnpm check` — fix ALL errors (type, lint, format)
- [x] Run `pnpm test:fast` — verify no regressions
- [x] Run `pnpm build` — verify build succeeds

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
