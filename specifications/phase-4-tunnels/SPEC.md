# Phase 4 — Tunnel Manager

> **Status**: Pending
> **Dependency**: Phase 2 (completed), Phase 3 (completed — basic tunnel in `src/jorchfile/tunnel.ts`)
> **Deliverable**: Production-grade TunnelManager with DB persistence, health monitoring, reverse proxy, lifecycle management, and full command integration (API + CLI + chat)
> **When finished**: `/tunnel frontend` starts a private Tailscale Serve tunnel and sends the URL to the chat. `/tunnels` lists all active tunnels with status. `/tunnel frontend --public` starts a Funnel tunnel on port 8443 with path-based reverse proxy. Tunnels persist across gateway restarts. Health monitoring detects downed tunnels within 60 seconds. `jorchbot jb tunnel` works from the CLI.

---

## Table of Contents

1. [WHY — Why this phase](#1-why--why-this-phase)
2. [WHAT — What is delivered](#2-what--what-is-delivered)
3. [Architecture](#3-architecture)
4. [Configuration Schema](#4-configuration-schema)
5. [Error Definitions](#5-error-definitions)
6. [TunnelManager — Orchestrator](#6-tunnelmanager--orchestrator)
7. [Tailscale Adapters](#7-tailscale-adapters)
8. [Funnel Reverse Proxy](#8-funnel-reverse-proxy)
9. [DB Persistence](#9-db-persistence)
10. [Health Monitoring](#10-health-monitoring)
11. [Lifecycle Management](#11-lifecycle-management)
12. [Commands — API + CLI + Chat](#12-commands--api--cli--chat)
13. [Migration from Phase 3](#13-migration-from-phase-3)
14. [Testing Strategy](#14-testing-strategy)
15. [Acceptance Criteria](#15-acceptance-criteria)

---

## 1. WHY — Why this phase

Phase 3 delivered a basic `TunnelManager` in `src/jorchfile/tunnel.ts` (181 lines) that auto-starts Tailscale Serve/Funnel when `/dev` runs a background task with `tunnel` configured in the Jorchfile. It works but has fundamental limitations:

- **In-memory only** — tunnel state is lost on gateway restart. Tailscale keeps tunnels alive (via `--bg`), but JorchBot has no idea they exist after a restart.
- **No health monitoring** — if Tailscale crashes or a tunnel goes down, JorchBot never detects it.
- **No auto-restart** — downed tunnels stay down until the user manually intervenes.
- **No DB persistence** — the `tunnels` table in SQLite (defined in Phase 0) is never used.
- **No reverse proxy** — Funnel is limited to ports 443, 8443, 10000. Multiple public projects can't share a single Funnel port.
- **No standalone commands** — tunnels only start as side effects of `/dev`. There's no `/tunnel`, `/tunnels`, or `/tunnel-stop` command.
- **Channel-coupled** — the `sendReply`/`sendButtons` callbacks are passed directly, making the manager tightly coupled to the current chat session.

**Tunnels are a core security component.** JorchBot's philosophy is that **nothing is exposed to the internet by default** — all access goes through Tailscale's WireGuard mesh VPN. This phase builds a production-grade tunnel system that:

1. Is **channel-agnostic** — works with WhatsApp today, Telegram tomorrow, mobile app later
2. **Persists state** — survives gateway restarts, syncs with real Tailscale state
3. **Self-heals** — detects failures, retries with backoff, notifies users
4. **Scales** — multiple tunnels per project, multiple projects per Funnel port via reverse proxy
5. Has **first-class commands** — API, CLI, and chat commands for full tunnel control

### What this phase builds

1. **TunnelManager** — new orchestrator in `src/tunnels/manager.ts` (replaces Phase 3's `src/jorchfile/tunnel.ts`)
2. **TailscaleServeAdapter** — private tunnels, wraps `src/infra/tailscale.ts`
3. **TailscaleFunnelAdapter** — public tunnels, wraps `src/infra/tailscale.ts`
4. **FunnelProxy** — reverse proxy on port 8443 using `http-proxy` for path-based routing
5. **DB persistence** — reads/writes the existing `tunnels` table
6. **Health monitoring** — periodic checks, auto-restart with backoff
7. **Lifecycle management** — tunnels tied to sessions, cleanup on shutdown
8. **Commands** — `/tunnel`, `/tunnels`, `/tunnel-stop` in chat + `jorchbot jb tunnel` CLI
9. **Tailscale detection** — clear errors when Tailscale is not installed/authenticated

### What is NOT built (later phases)

- Custom domains — not supported by Tailscale Funnel
- TCP/UDP raw tunneling — Funnel is HTTPS only
- GUI dashboard for tunnels — Phase 6
- Tunnel analytics — Phase 6

---

## 2. WHAT — What is delivered

### 2.1 Two tunnel modes

| Mode                | Command                       | Access                  | Port limit  | Reverse proxy    |
| ------------------- | ----------------------------- | ----------------------- | ----------- | ---------------- |
| **Serve** (default) | `tailscale serve --bg <port>` | Tailnet only (VPN mesh) | None        | No               |
| **Funnel** (opt-in) | `tailscale funnel --bg 8443`  | Public internet         | Always 8443 | Yes (path-based) |

**Serve** is the default. Every device in the user's tailnet can access the tunnel. No port limits. Direct port mapping: `https://<device>.tailnet.ts.net:<port>`.

**Funnel** requires explicit user confirmation (public internet exposure). Always uses port 8443. A reverse proxy maps paths to local ports: `https://<device>.tailnet.ts.net:8443/frontend` → `localhost:3000`.

### 2.2 Multiple tunnels per project

A single project can have multiple tunnels on different ports. Example: React dev server on 3000 + Storybook on 6006. Each tunnel is tracked independently in the DB.

For Serve mode, each tunnel gets its own direct URL.

For Funnel mode, all public tunnels share port 8443 and are differentiated by path. The reverse proxy handles routing.

### 2.3 Funnel reverse proxy

The reverse proxy is **only for Funnel** (Serve doesn't need it — no port limits).

Architecture:

```
Internet → Tailscale Funnel (port 8443) → FunnelProxy (localhost:8443)
                                            ├─ /frontend  → localhost:3000
                                            ├─ /backend   → localhost:8000
                                            └─ /storybook → localhost:6006
```

The proxy:

- Starts automatically when the first Funnel tunnel is created
- Stops automatically when the last Funnel tunnel is removed
- Supports WebSocket pass-through (required for HMR)
- Uses `http-proxy` npm package

### 2.4 Tunnel commands

**Chat commands** (via CommandRouter):

| Command                             | Action                                  |
| ----------------------------------- | --------------------------------------- |
| `/tunnel <project> [port]`          | Start Serve tunnel for project          |
| `/tunnel <project> [port] --public` | Start Funnel tunnel (with confirmation) |
| `/tunnel-stop <project> [port]`     | Stop tunnel(s) for project              |
| `/tunnels`                          | List all active tunnels                 |

**CLI commands** (via Commander):

```bash
jorchbot jb tunnel start <project> [--port 3000] [--public]
jorchbot jb tunnel stop <project> [--port 3000]
jorchbot jb tunnel list
jorchbot jb tunnel status
```

---

## 3. Architecture

### 3.1 Module structure

```
src/tunnels/
├── manager.ts              # TunnelManager orchestrator
├── manager.test.ts         # Unit tests for TunnelManager
├── adapters/
│   ├── tailscale-serve.ts  # TailscaleServeAdapter
│   ├── tailscale-serve.test.ts
│   ├── tailscale-funnel.ts # TailscaleFunnelAdapter
│   └── tailscale-funnel.test.ts
├── funnel-proxy.ts         # FunnelProxy (http-proxy based)
├── funnel-proxy.test.ts
├── health.ts               # HealthMonitor
├── health.test.ts
├── tunnel-db.ts            # DB persistence layer
├── tunnel-db.test.ts
├── types.ts                # Shared types and Zod schemas
└── errors.ts               # Re-exports from src/errors/index.ts (convenience)
```

### 3.2 Dependency flow

```
CommandRouter / CLI / JorchfileExecutor
        │
        ▼
  TunnelManager (orchestrator)
   ├── TailscaleServeAdapter ──→ src/infra/tailscale.ts
   ├── TailscaleFunnelAdapter ──→ src/infra/tailscale.ts
   ├── FunnelProxy ──→ http-proxy
   ├── HealthMonitor
   └── TunnelDb ──→ src/db/ (Drizzle ORM)
```

### 3.3 Layer separation

The TunnelManager is **channel-agnostic**. It does not import anything from `src/channels/`, `extensions/kapso/`, or any messaging adapter. It communicates with the outside world through **callback functions** injected via dependency injection:

```typescript
interface TunnelManagerCallbacks {
  /** Notify the user about tunnel events (started, stopped, error, health) */
  onNotify: (event: TunnelEvent) => void;
  /** Ask user confirmation for Funnel (public exposure) */
  onConfirmFunnel: (tunnelId: string, project: string, port: number) => void;
}
```

The gateway wiring layer (`jorchbot-start.ts`) connects these callbacks to the actual messaging system (Kapso today, Telegram/app later).

---

## 4. Configuration Schema

### 4.1 Extending the existing config

The existing `TunnelsSchema` in `src/config/jorchbot-config.ts` needs to be extended:

```typescript
import { z } from "zod";

const TailscaleSchema = z.object({
  enabled: z.boolean().default(true),
});

const FunnelProxySchema = z.object({
  /** Port used by Tailscale Funnel. Always 8443. */
  port: z.literal(8443).default(8443),
});

const HealthSchema = z.object({
  /** Health check interval in milliseconds */
  intervalMs: z.number().int().min(5000).default(30_000),
  /** Number of consecutive failures before marking tunnel as error */
  failureThreshold: z.number().int().min(1).default(3),
  /** Maximum auto-restart attempts before giving up */
  maxRestartAttempts: z.number().int().min(0).default(3),
});

const TunnelsSchema = z.object({
  defaultMode: z.enum(["serve", "funnel"]).default("serve"),
  tailscale: TailscaleSchema.default(TailscaleSchema.parse({})),
  funnelProxy: FunnelProxySchema.default(FunnelProxySchema.parse({})),
  health: HealthSchema.default(HealthSchema.parse({})),
});
```

### 4.2 Jorchfile tunnel config (existing)

The Jorchfile `tunnel` field is already parsed by Phase 3:

```makefile
PROJECT frontend
  path = ~/projects/my-app/frontend
  port = 3000
  tunnel = serve              # "serve" | "funnel"
  funnelPath = /frontend      # path for Funnel reverse proxy (default: /<project-name>)
```

The `funnelPath` field is new — it overrides the default path (`/<project-name>`) for the Funnel reverse proxy. This field is parsed by the Jorchfile parser (Phase 3 code — extend if needed).

---

## 5. Error Definitions

All new error classes are added to `src/errors/index.ts`, extending `JorchBotError`:

```typescript
// --- Tunnel errors (Phase 4) ---

/** Tailscale binary not found or not in PATH */
export class TailscaleNotInstalledError extends JorchBotError {
  constructor(cause?: unknown) {
    super("Tailscale is not installed or not in PATH. Install: https://tailscale.com/download", {
      cause,
    });
  }
}

/** Tailscale is installed but not authenticated (not logged in) */
export class TailscaleNotAuthenticatedError extends JorchBotError {
  constructor(cause?: unknown) {
    super("Tailscale is not authenticated. Run: tailscale up", { cause });
  }
}

/** Failed to start a tunnel (Tailscale command failed) */
export class TunnelStartError extends JorchBotError {
  constructor(project: string, port: number, mode: string, cause?: unknown) {
    super(`Failed to start ${mode} tunnel for "${project}" on port ${port}`, { cause });
  }
}

/** Failed to stop a tunnel */
export class TunnelStopError extends JorchBotError {
  constructor(tunnelId: string, cause?: unknown) {
    super(`Failed to stop tunnel ${tunnelId}`, { cause });
  }
}

/** Tunnel not found by ID or project+port */
export class TunnelNotFoundError extends JorchBotError {
  constructor(identifier: string) {
    super(`Tunnel not found: ${identifier}`);
  }
}

/** Tailscale Funnel is not enabled on the tailnet/device */
export class FunnelNotEnabledError extends JorchBotError {
  constructor(cause?: unknown) {
    super(
      "Tailscale Funnel is not enabled on this tailnet/device. " +
        "Enable in admin console: https://login.tailscale.com/admin",
      { cause },
    );
  }
}

/** Health check detected a tunnel failure */
export class TunnelHealthCheckError extends JorchBotError {
  constructor(tunnelId: string, consecutiveFailures: number, cause?: unknown) {
    super(`Tunnel ${tunnelId} failed health check (${consecutiveFailures} consecutive failures)`, {
      cause,
    });
  }
}

/** Funnel reverse proxy failed to start */
export class FunnelProxyStartError extends JorchBotError {
  constructor(port: number, cause?: unknown) {
    super(`Failed to start Funnel reverse proxy on port ${port}`, { cause });
  }
}

/** Funnel reverse proxy route conflict (duplicate path) */
export class FunnelProxyRouteConflictError extends JorchBotError {
  constructor(path: string) {
    super(`Funnel proxy route conflict: path "${path}" is already registered`);
  }
}
```

---

## 6. TunnelManager — Orchestrator

### 6.1 Types

File: `src/tunnels/types.ts`

```typescript
import { z } from "zod";

// --- Tunnel modes ---

export const TunnelMode = z.enum(["serve", "funnel"]);
export type TunnelMode = z.infer<typeof TunnelMode>;

export const TunnelStatus = z.enum(["starting", "active", "stopped", "error"]);
export type TunnelStatus = z.infer<typeof TunnelStatus>;

export const TunnelProvider = z.enum(["tailscale-serve", "tailscale-funnel"]);
export type TunnelProvider = z.infer<typeof TunnelProvider>;

// --- Tunnel start input (validated at boundary) ---

export const TunnelStartInputSchema = z.object({
  /** Project name (from Jorchfile or manual) */
  project: z.string().min(1),
  /** Session ID that owns this tunnel */
  sessionId: z.string().min(1),
  /** Local port to expose */
  localPort: z.number().int().min(1).max(65535),
  /** Tunnel mode: serve (private) or funnel (public) */
  mode: TunnelMode.default("serve"),
  /** Custom path for Funnel reverse proxy (default: /<project>) */
  funnelPath: z.string().optional(),
});

export type TunnelStartInput = z.infer<typeof TunnelStartInputSchema>;

// --- Active tunnel info (internal, no runtime validation needed) ---

export interface TunnelInfo {
  /** UUID */
  id: string;
  /** Owning session ID */
  sessionId: string;
  /** Project name */
  project: string;
  /** Local port being tunneled */
  localPort: number;
  /** Port assigned by Tailscale (same as localPort for Serve, 8443 for Funnel) */
  assignedPort: number;
  /** Full URL to access the tunnel */
  url: string;
  /** Provider identifier */
  provider: TunnelProvider;
  /** Tunnel mode */
  mode: TunnelMode;
  /** Current status */
  status: TunnelStatus;
  /** When the tunnel was created */
  createdAt: Date;
}

// --- Events emitted by TunnelManager ---

export type TunnelEvent =
  | { type: "tunnel:started"; tunnel: TunnelInfo }
  | { type: "tunnel:stopped"; tunnelId: string; project: string }
  | { type: "tunnel:error"; tunnelId: string; project: string; error: string }
  | { type: "tunnel:health_restored"; tunnelId: string; project: string }
  | { type: "tunnel:restart_failed"; tunnelId: string; project: string; attempts: number };

// --- Health report ---

export interface TunnelHealthEntry {
  tunnelId: string;
  project: string;
  url: string;
  healthy: boolean;
  lastCheckAt: Date;
  consecutiveFailures: number;
}

export interface TunnelHealthReport {
  tunnels: TunnelHealthEntry[];
  allHealthy: boolean;
}
```

### 6.2 TunnelManager class

File: `src/tunnels/manager.ts`

```typescript
import crypto from "node:crypto";
import type { TunnelManagerCallbacks } from "./types.js";
import type { TunnelInfo, TunnelStartInput, TunnelEvent, TunnelHealthReport } from "./types.js";
import { TunnelStartInputSchema } from "./types.js";
import {
  TunnelNotFoundError,
  TunnelStartError,
  TailscaleNotInstalledError,
} from "../errors/index.js";
import type { TailscaleServeAdapter } from "./adapters/tailscale-serve.js";
import type { TailscaleFunnelAdapter } from "./adapters/tailscale-funnel.js";
import type { FunnelProxy } from "./funnel-proxy.js";
import type { HealthMonitor } from "./health.js";
import type { TunnelDb } from "./tunnel-db.js";

export interface TunnelManagerDeps {
  serveAdapter: TailscaleServeAdapter;
  funnelAdapter: TailscaleFunnelAdapter;
  funnelProxy: FunnelProxy;
  healthMonitor: HealthMonitor;
  db: TunnelDb;
  callbacks: TunnelManagerCallbacks;
}

export interface TunnelManagerCallbacks {
  onNotify: (event: TunnelEvent) => void;
  onConfirmFunnel: (tunnelId: string, project: string, port: number) => void;
}

export class TunnelManager {
  private deps: TunnelManagerDeps;
  /** In-memory cache of active tunnels, keyed by tunnel ID */
  private activeTunnels = new Map<string, TunnelInfo>();
  /** Pending Funnel confirmations: tunnelId → TunnelStartInput */
  private pendingConfirmations = new Map<string, TunnelStartInput>();

  constructor(deps: TunnelManagerDeps) {
    this.deps = deps;
  }

  /**
   * Start a new tunnel.
   *
   * For serve mode: starts immediately.
   * For funnel mode: asks for user confirmation first (public exposure).
   *
   * @throws {TailscaleNotInstalledError} If Tailscale is not available
   * @throws {TunnelStartError} If the Tailscale command fails
   */
  async start(rawInput: TunnelStartInput): Promise<TunnelInfo> {
    const input = TunnelStartInputSchema.parse(rawInput);

    // Check Tailscale availability
    await this.deps.serveAdapter.ensureAvailable();

    if (input.mode === "funnel") {
      return this.startFunnelWithConfirmation(input);
    }

    return this.startServe(input);
  }

  /**
   * Called when user confirms Funnel creation (from button callback).
   *
   * @throws {TunnelNotFoundError} If the pending confirmation is not found
   * @throws {TunnelStartError} If the Tailscale command fails
   */
  async confirmFunnel(tunnelId: string): Promise<TunnelInfo> {
    const input = this.pendingConfirmations.get(tunnelId);
    if (!input) {
      throw new TunnelNotFoundError(`pending confirmation ${tunnelId}`);
    }
    this.pendingConfirmations.delete(tunnelId);
    return this.startFunnelDirect(input, tunnelId);
  }

  /** Cancel a pending Funnel confirmation */
  cancelFunnel(tunnelId: string): void {
    this.pendingConfirmations.delete(tunnelId);
  }

  /**
   * Stop a specific tunnel by ID.
   *
   * @throws {TunnelNotFoundError} If the tunnel is not found
   */
  async stop(tunnelId: string): Promise<void> {
    const tunnel = this.activeTunnels.get(tunnelId);
    if (!tunnel) {
      throw new TunnelNotFoundError(tunnelId);
    }

    await this.stopTunnel(tunnel);
  }

  /** Stop a specific tunnel by project + port. Best-effort (no throw if not found). */
  async stopByProjectPort(project: string, port: number): Promise<void> {
    const tunnel = this.findByProjectPort(project, port);
    if (tunnel) {
      await this.stopTunnel(tunnel);
    }
  }

  /** Stop all tunnels for a given project. Best-effort. */
  async stopByProject(project: string): Promise<void> {
    const tunnels = this.listByProject(project);
    for (const tunnel of tunnels) {
      try {
        await this.stopTunnel(tunnel);
      } catch {
        // best-effort — continue stopping others
      }
    }
  }

  /** Stop all tunnels for a given session. Best-effort. */
  async stopBySession(sessionId: string): Promise<void> {
    const tunnels = [...this.activeTunnels.values()].filter((t) => t.sessionId === sessionId);
    for (const tunnel of tunnels) {
      try {
        await this.stopTunnel(tunnel);
      } catch {
        // best-effort
      }
    }
  }

  /** Stop all active tunnels. Used during gateway shutdown. */
  async stopAll(): Promise<void> {
    for (const tunnel of [...this.activeTunnels.values()]) {
      try {
        await this.stopTunnel(tunnel);
      } catch {
        // best-effort
      }
    }
    // Stop the Funnel proxy if running
    await this.deps.funnelProxy.stop();
  }

  /** List all active tunnels */
  list(): TunnelInfo[] {
    return [...this.activeTunnels.values()];
  }

  /** List tunnels for a specific project */
  listByProject(project: string): TunnelInfo[] {
    return [...this.activeTunnels.values()].filter((t) => t.project === project);
  }

  /** Get a tunnel by ID */
  get(tunnelId: string): TunnelInfo | undefined {
    return this.activeTunnels.get(tunnelId);
  }

  /** Find tunnel by project + port */
  findByProjectPort(project: string, port: number): TunnelInfo | undefined {
    return [...this.activeTunnels.values()].find(
      (t) => t.project === project && t.localPort === port,
    );
  }

  /** Get health report for all active tunnels */
  async health(): Promise<TunnelHealthReport> {
    return this.deps.healthMonitor.checkAll(this.list());
  }

  /**
   * Restore tunnel state from DB on gateway restart.
   *
   * Compares DB records against actual Tailscale state. Reconnects known
   * tunnels, marks missing ones as stopped, and kills orphans.
   */
  async restore(): Promise<number> {
    const dbTunnels = this.deps.db.listActive();
    let restored = 0;

    for (const record of dbTunnels) {
      // Check if Tailscale still has this tunnel active
      const isAlive = await this.checkTailscaleAlive(record);
      if (isAlive) {
        const info: TunnelInfo = {
          id: record.id,
          sessionId: record.sessionId,
          project: record.project,
          localPort: record.localPort,
          assignedPort: record.assignedPort ?? record.localPort,
          url: record.url ?? "",
          provider: record.provider,
          mode: record.mode,
          status: "active",
          createdAt: record.createdAt,
        };
        this.activeTunnels.set(info.id, info);

        // Re-add Funnel proxy route if applicable
        if (info.mode === "funnel") {
          const path = record.funnelPath ?? `/${record.project}`;
          this.deps.funnelProxy.addRoute({
            path,
            target: `http://localhost:${info.localPort}`,
            project: info.project,
          });
        }

        restored++;
      } else {
        // Tunnel is gone — mark as stopped in DB
        this.deps.db.updateStatus(record.id, "stopped");
      }
    }

    // Start health monitor if we have active tunnels
    if (restored > 0) {
      this.deps.healthMonitor.start(this);
    }

    // If any Funnel tunnels were restored, ensure proxy is running
    const hasFunnel = [...this.activeTunnels.values()].some((t) => t.mode === "funnel");
    if (hasFunnel && !this.deps.funnelProxy.isRunning()) {
      await this.deps.funnelProxy.start();
    }

    return restored;
  }

  // --- Private methods ---

  private async startServe(input: TunnelStartInput): Promise<TunnelInfo> {
    const id = crypto.randomUUID();

    const result = await this.deps.serveAdapter.start(input.localPort);

    const info: TunnelInfo = {
      id,
      sessionId: input.sessionId,
      project: input.project,
      localPort: input.localPort,
      assignedPort: input.localPort,
      url: result.url,
      provider: "tailscale-serve",
      mode: "serve",
      status: "active",
      createdAt: new Date(),
    };

    this.activeTunnels.set(id, info);
    this.deps.db.insert(info);
    this.deps.healthMonitor.start(this);
    this.deps.callbacks.onNotify({ type: "tunnel:started", tunnel: info });

    return info;
  }

  private startFunnelWithConfirmation(input: TunnelStartInput): never {
    // Generate a tunnel ID for tracking the pending confirmation
    const tunnelId = crypto.randomUUID();
    this.pendingConfirmations.set(tunnelId, input);
    this.deps.callbacks.onConfirmFunnel(tunnelId, input.project, input.localPort);

    // This method doesn't return a TunnelInfo — the tunnel is created
    // asynchronously when the user confirms. We throw to signal this.
    // The caller should handle TunnelPendingConfirmationError.
    throw new TunnelPendingConfirmation(tunnelId);
  }

  private async startFunnelDirect(input: TunnelStartInput, tunnelId: string): Promise<TunnelInfo> {
    // Ensure Funnel proxy is running
    if (!this.deps.funnelProxy.isRunning()) {
      await this.deps.funnelProxy.start();
      // Ensure Tailscale Funnel is enabled on the proxy port
      await this.deps.funnelAdapter.start(this.deps.funnelProxy.getPort());
    }

    // Determine proxy path
    const funnelPath = input.funnelPath ?? `/${input.project}`;

    // Add route to proxy
    this.deps.funnelProxy.addRoute({
      path: funnelPath,
      target: `http://localhost:${input.localPort}`,
      project: input.project,
    });

    const hostname = await this.deps.serveAdapter.getHostname();
    const proxyPort = this.deps.funnelProxy.getPort();
    const url = `https://${hostname}:${proxyPort}${funnelPath}`;

    const info: TunnelInfo = {
      id: tunnelId,
      sessionId: input.sessionId,
      project: input.project,
      localPort: input.localPort,
      assignedPort: proxyPort,
      url,
      provider: "tailscale-funnel",
      mode: "funnel",
      status: "active",
      createdAt: new Date(),
    };

    this.activeTunnels.set(tunnelId, info);
    this.deps.db.insert(info, funnelPath);
    this.deps.healthMonitor.start(this);
    this.deps.callbacks.onNotify({ type: "tunnel:started", tunnel: info });

    return info;
  }

  private async stopTunnel(tunnel: TunnelInfo): Promise<void> {
    if (tunnel.mode === "serve") {
      await this.deps.serveAdapter.stop(tunnel.localPort);
    } else {
      // Remove proxy route
      const record = this.deps.db.getById(tunnel.id);
      const path = record?.funnelPath ?? `/${tunnel.project}`;
      this.deps.funnelProxy.removeRoute(path);

      // If no more Funnel tunnels, stop proxy and Funnel
      const remainingFunnel = [...this.activeTunnels.values()].filter(
        (t) => t.mode === "funnel" && t.id !== tunnel.id,
      );
      if (remainingFunnel.length === 0) {
        await this.deps.funnelProxy.stop();
        await this.deps.funnelAdapter.stop(this.deps.funnelProxy.getPort());
      }
    }

    this.activeTunnels.delete(tunnel.id);
    this.deps.db.updateStatus(tunnel.id, "stopped");
    this.deps.callbacks.onNotify({
      type: "tunnel:stopped",
      tunnelId: tunnel.id,
      project: tunnel.project,
    });

    // Stop health monitor if no more active tunnels
    if (this.activeTunnels.size === 0) {
      this.deps.healthMonitor.stop();
    }
  }

  /**
   * Check if a tunnel is still alive in Tailscale.
   * Used during restore() to validate DB state against reality.
   */
  private async checkTailscaleAlive(record: { localPort: number; mode: string }): Promise<boolean> {
    if (record.mode === "serve") {
      return this.deps.serveAdapter.isActive(record.localPort);
    }
    // For Funnel, check if the proxy port is still in Funnel config
    return this.deps.funnelAdapter.isActive(this.deps.funnelProxy.getPort());
  }
}

/**
 * Sentinel class thrown when Funnel creation is pending user confirmation.
 * Not a real error — used for control flow. Callers should check
 * `instanceof TunnelPendingConfirmation` and handle accordingly.
 */
export class TunnelPendingConfirmation {
  readonly tunnelId: string;
  constructor(tunnelId: string) {
    this.tunnelId = tunnelId;
  }
}
```

### 6.3 Key design decisions

1. **UUID for tunnel IDs** — not `project:port` because a project can have multiple tunnels.
2. **Pending confirmations map** — Funnel requires async user confirmation. The tunnel ID is generated upfront and stored in a pending map. When the user confirms, `confirmFunnel(tunnelId)` completes creation.
3. **`TunnelPendingConfirmation`** — a sentinel class (not an Error) thrown by `start()` for Funnel mode. Callers must handle this to send confirmation buttons.
4. **Health monitor reference** — TunnelManager passes `this` to HealthMonitor so it can access tunnel list and trigger restarts.
5. **Restore on startup** — `restore()` is called during gateway start, compares DB with Tailscale reality.

---

## 7. Tailscale Adapters

Both adapters **wrap** the existing functions in `src/infra/tailscale.ts`. They add:

- JorchBot-specific error classes
- Port-level start/stop (not global reset)
- Active status checking

### 7.1 TailscaleServeAdapter

File: `src/tunnels/adapters/tailscale-serve.ts`

```typescript
import {
  getTailscaleBinary,
  getTailnetHostname,
  findTailscaleBinary,
} from "../../infra/tailscale.js";
import { runExec } from "../../process/exec.js";
import {
  TailscaleNotInstalledError,
  TailscaleNotAuthenticatedError,
  TunnelStartError,
} from "../../errors/index.js";

interface ServeStartResult {
  url: string;
}

export class TailscaleServeAdapter {
  private hostname: string | null = null;

  /**
   * Check that Tailscale is installed and authenticated.
   * Caches hostname for subsequent calls.
   *
   * @throws {TailscaleNotInstalledError}
   * @throws {TailscaleNotAuthenticatedError}
   */
  async ensureAvailable(): Promise<void> {
    const binary = await findTailscaleBinary();
    if (!binary) {
      throw new TailscaleNotInstalledError();
    }

    try {
      this.hostname = await getTailnetHostname(runExec, binary);
    } catch (err: unknown) {
      throw new TailscaleNotAuthenticatedError(err);
    }
  }

  /** Get cached hostname (call ensureAvailable first) */
  async getHostname(): Promise<string> {
    if (!this.hostname) {
      await this.ensureAvailable();
    }
    return this.hostname!;
  }

  /**
   * Start Tailscale Serve on a port.
   *
   * @throws {TunnelStartError}
   */
  async start(port: number): Promise<ServeStartResult> {
    const binary = await getTailscaleBinary();
    try {
      await runExec(binary, ["serve", "--bg", "--yes", `${port}`], {
        timeoutMs: 15_000,
      });
    } catch (err: unknown) {
      throw new TunnelStartError("(unknown)", port, "serve", err);
    }

    const hostname = await this.getHostname();
    return { url: `https://${hostname}:${port}` };
  }

  /**
   * Stop Tailscale Serve on a specific port.
   * Uses `tailscale serve off <port>` (per-port, not global reset).
   */
  async stop(port: number): Promise<void> {
    const binary = await getTailscaleBinary();
    try {
      await runExec(binary, ["serve", "off", `${port}`], {
        timeoutMs: 15_000,
      });
    } catch {
      // best-effort — port may already be stopped
    }
  }

  /**
   * Check if Tailscale Serve is active on a given port.
   * Parses `tailscale serve status --json`.
   */
  async isActive(port: number): Promise<boolean> {
    const binary = await getTailscaleBinary();
    try {
      const { stdout } = await runExec(binary, ["serve", "status", "--json"], {
        timeoutMs: 5000,
      });
      const status = JSON.parse(stdout) as Record<string, unknown>;
      // Check if port is in the active serve config
      return JSON.stringify(status).includes(`${port}`);
    } catch {
      return false;
    }
  }
}
```

### 7.2 TailscaleFunnelAdapter

File: `src/tunnels/adapters/tailscale-funnel.ts`

```typescript
import { getTailscaleBinary } from "../../infra/tailscale.js";
import { runExec } from "../../process/exec.js";
import { FunnelNotEnabledError, TunnelStartError } from "../../errors/index.js";

export class TailscaleFunnelAdapter {
  /**
   * Start Tailscale Funnel on a port (always 8443).
   *
   * @throws {FunnelNotEnabledError} If Funnel is not enabled on tailnet
   * @throws {TunnelStartError} If the command fails
   */
  async start(port: number): Promise<void> {
    const binary = await getTailscaleBinary();
    try {
      await runExec(binary, ["funnel", "--bg", "--yes", `${port}`], {
        timeoutMs: 15_000,
      });
    } catch (err: unknown) {
      const errStr = err instanceof Error ? err.message : String(err);
      if (errStr.includes("Funnel is not enabled")) {
        throw new FunnelNotEnabledError(err);
      }
      throw new TunnelStartError("(funnel)", port, "funnel", err);
    }
  }

  /**
   * Stop Tailscale Funnel on a specific port.
   */
  async stop(port: number): Promise<void> {
    const binary = await getTailscaleBinary();
    try {
      await runExec(binary, ["funnel", "off", `${port}`], {
        timeoutMs: 15_000,
      });
    } catch {
      // best-effort
    }
  }

  /**
   * Check if Tailscale Funnel is active on a given port.
   */
  async isActive(port: number): Promise<boolean> {
    const binary = await getTailscaleBinary();
    try {
      const { stdout } = await runExec(binary, ["funnel", "status", "--json"], {
        timeoutMs: 5000,
      });
      return stdout.includes(`${port}`);
    } catch {
      return false;
    }
  }
}
```

---

## 8. Funnel Reverse Proxy

File: `src/tunnels/funnel-proxy.ts`

Uses `http-proxy` npm package. Must be installed as a dependency.

```bash
pnpm add http-proxy
pnpm add -D @types/http-proxy
```

### 8.1 FunnelProxy class

```typescript
import http from "node:http";
import httpProxy from "http-proxy";
import { FunnelProxyStartError, FunnelProxyRouteConflictError } from "../errors/index.js";

export interface FunnelProxyRoute {
  /** URL path prefix (e.g., "/frontend") */
  path: string;
  /** Target URL (e.g., "http://localhost:3000") */
  target: string;
  /** Project name for identification */
  project: string;
}

export class FunnelProxy {
  private port: number;
  private routes = new Map<string, FunnelProxyRoute>();
  private server: http.Server | null = null;
  private proxy: httpProxy | null = null;

  constructor(port: number) {
    this.port = port;
  }

  /** Get the port the proxy listens on */
  getPort(): number {
    return this.port;
  }

  /** Is the proxy server currently running? */
  isRunning(): boolean {
    return this.server !== null && this.server.listening;
  }

  /**
   * Start the reverse proxy server.
   *
   * @throws {FunnelProxyStartError}
   */
  async start(): Promise<void> {
    if (this.isRunning()) {
      return;
    }

    this.proxy = httpProxy.createProxyServer({
      ws: true,
      changeOrigin: true,
    });

    this.proxy.on("error", (err, _req, res) => {
      if (res && "writeHead" in res && !res.headersSent) {
        (res as http.ServerResponse).writeHead(502, { "Content-Type": "text/plain" });
        (res as http.ServerResponse).end("Bad Gateway — upstream is not responding");
      }
    });

    this.server = http.createServer((req, res) => {
      const route = this.matchRoute(req.url ?? "/");
      if (!route) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found — no tunnel route matches this path");
        return;
      }

      // Strip the route prefix from the URL
      req.url = req.url!.slice(route.path.length) || "/";
      this.proxy!.web(req, res, { target: route.target });
    });

    // WebSocket upgrade handling
    this.server.on("upgrade", (req, socket, head) => {
      const route = this.matchRoute(req.url ?? "/");
      if (!route) {
        socket.destroy();
        return;
      }

      req.url = req.url!.slice(route.path.length) || "/";
      this.proxy!.ws(req, socket, head, { target: route.target });
    });

    return new Promise<void>((resolve, reject) => {
      this.server!.listen(this.port, "127.0.0.1", () => {
        resolve();
      });
      this.server!.on("error", (err) => {
        reject(new FunnelProxyStartError(this.port, err));
      });
    });
  }

  /** Stop the reverse proxy server */
  async stop(): Promise<void> {
    if (this.proxy) {
      this.proxy.close();
      this.proxy = null;
    }

    if (this.server) {
      return new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
        this.server = null;
      });
    }
  }

  /**
   * Add a route to the proxy.
   *
   * @throws {FunnelProxyRouteConflictError} If path already registered
   */
  addRoute(route: FunnelProxyRoute): void {
    const normalized = this.normalizePath(route.path);
    if (this.routes.has(normalized)) {
      throw new FunnelProxyRouteConflictError(normalized);
    }
    this.routes.set(normalized, { ...route, path: normalized });
  }

  /** Remove a route by path */
  removeRoute(path: string): void {
    const normalized = this.normalizePath(path);
    this.routes.delete(normalized);
  }

  /** List all registered routes */
  listRoutes(): FunnelProxyRoute[] {
    return [...this.routes.values()];
  }

  /** Check if a path is registered */
  hasRoute(path: string): boolean {
    return this.routes.has(this.normalizePath(path));
  }

  private matchRoute(url: string): FunnelProxyRoute | undefined {
    // Find the longest matching prefix
    let bestMatch: FunnelProxyRoute | undefined;
    let bestLength = 0;

    for (const route of this.routes.values()) {
      if (url.startsWith(route.path) && route.path.length > bestLength) {
        bestMatch = route;
        bestLength = route.path.length;
      }
    }

    return bestMatch;
  }

  private normalizePath(path: string): string {
    // Ensure path starts with / and doesn't end with /
    let p = path.startsWith("/") ? path : `/${path}`;
    if (p.length > 1 && p.endsWith("/")) {
      p = p.slice(0, -1);
    }
    return p;
  }
}
```

### 8.2 WebSocket support

The `http-proxy` library supports WebSocket proxying natively via the `ws: true` option and the `server.on("upgrade", ...)` handler. This is critical for HMR (Hot Module Replacement) used by Vite, Next.js, and other dev frameworks.

No extra libraries needed for WebSocket pass-through.

---

## 9. DB Persistence

File: `src/tunnels/tunnel-db.ts`

Uses the existing `tunnels` table from `src/db/schema.ts` (defined in Phase 0).

### 9.1 Schema note

The existing schema has:

- `id` (PK), `sessionId` (FK → sessions), `localPort`, `assignedPort`, `url`
- `provider` (tailscale-serve | tailscale-funnel)
- `mode` (serve | funnel), `status` (active | stopped | error)
- `createdAt`

**New column needed**: `funnel_path` (text, nullable) — stores the Funnel proxy path for restore.

This requires a new Drizzle migration. Add the column to `src/db/schema.ts`:

```typescript
export const tunnels = sqliteTable("tunnels", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .references(() => sessions.id, { onDelete: "cascade" })
    .notNull(),
  localPort: integer("local_port").notNull(),
  assignedPort: integer("assigned_port"),
  url: text("url"),
  provider: text("provider", {
    enum: ["tailscale-serve", "tailscale-funnel"],
  }).notNull(),
  mode: text("mode", { enum: ["serve", "funnel"] })
    .notNull()
    .default("serve"),
  status: text("status", { enum: ["active", "stopped", "error"] })
    .notNull()
    .default("active"),
  funnelPath: text("funnel_path"), // NEW — Phase 4
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
```

### 9.2 TunnelDb class

```typescript
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { tunnels } from "../db/schema.js";
import { JorchBotDbQueryError } from "../errors/index.js";
import type { TunnelInfo, TunnelProvider, TunnelMode } from "./types.js";

export interface TunnelRecord {
  id: string;
  sessionId: string;
  project: string;
  localPort: number;
  assignedPort: number | null;
  url: string | null;
  provider: TunnelProvider;
  mode: TunnelMode;
  status: string;
  funnelPath: string | null;
  createdAt: Date;
}

export class TunnelDb {
  /**
   * Insert a new tunnel record.
   * @throws {JorchBotDbQueryError}
   */
  insert(info: TunnelInfo, funnelPath?: string): void {
    try {
      const db = getDb();
      db.insert(tunnels)
        .values({
          id: info.id,
          sessionId: info.sessionId,
          localPort: info.localPort,
          assignedPort: info.assignedPort,
          url: info.url,
          provider: info.provider,
          mode: info.mode,
          status: info.status,
          funnelPath: funnelPath ?? null,
          createdAt: info.createdAt,
        })
        .run();
    } catch (err: unknown) {
      throw new JorchBotDbQueryError(`Failed to insert tunnel ${info.id}`, { cause: err });
    }
  }

  /**
   * Update tunnel status.
   * @throws {JorchBotDbQueryError}
   */
  updateStatus(tunnelId: string, status: "active" | "stopped" | "error"): void {
    try {
      const db = getDb();
      db.update(tunnels).set({ status }).where(eq(tunnels.id, tunnelId)).run();
    } catch (err: unknown) {
      throw new JorchBotDbQueryError(`Failed to update tunnel ${tunnelId}`, { cause: err });
    }
  }

  /**
   * List all tunnels with "active" status.
   * Used during restore() to find tunnels that should still be alive.
   */
  listActive(): TunnelRecord[] {
    try {
      const db = getDb();
      const rows = db.select().from(tunnels).where(eq(tunnels.status, "active")).all();
      return rows.map((r) => this.toRecord(r));
    } catch (err: unknown) {
      throw new JorchBotDbQueryError("Failed to list active tunnels", { cause: err });
    }
  }

  /** Get a tunnel by ID */
  getById(tunnelId: string): TunnelRecord | undefined {
    try {
      const db = getDb();
      const row = db.select().from(tunnels).where(eq(tunnels.id, tunnelId)).get();
      return row ? this.toRecord(row) : undefined;
    } catch (err: unknown) {
      throw new JorchBotDbQueryError(`Failed to get tunnel ${tunnelId}`, { cause: err });
    }
  }

  private toRecord(row: typeof tunnels.$inferSelect): TunnelRecord {
    // Drizzle infers the session project from a JOIN — but we don't need it
    // for tunnel ops. The TunnelManager has it in memory.
    // We need to resolve "project" from the sessions table.
    // For simplicity, store project name redundantly in the tunnel record
    // or resolve it via JOIN.
    //
    // Decision: We'll need to add a `project` column to the tunnels table
    // OR join with sessions. See section 9.3.
    return {
      id: row.id,
      sessionId: row.sessionId,
      project: "", // resolved via join — see 9.3
      localPort: row.localPort,
      assignedPort: row.assignedPort,
      url: row.url,
      provider: row.provider as TunnelProvider,
      mode: row.mode as TunnelMode,
      status: row.status,
      funnelPath: row.funnelPath ?? null,
      createdAt: row.createdAt,
    };
  }
}
```

### 9.3 Schema decision: `project` column

The current `tunnels` table has `sessionId` but no `project` column. To get the project name, we need to JOIN with `sessions`. However, during `restore()`, the session may not be loaded yet.

**Decision**: Add a `project` column to the `tunnels` table for denormalization. This avoids the JOIN dependency and makes `restore()` self-contained.

Add to `src/db/schema.ts`:

```typescript
export const tunnels = sqliteTable("tunnels", {
  // ... existing columns ...
  project: text("project").notNull(), // NEW — Phase 4 (denormalized)
  funnelPath: text("funnel_path"), // NEW — Phase 4
  // ...
});
```

This requires a migration: `pnpm drizzle-kit generate`.

---

## 10. Health Monitoring

File: `src/tunnels/health.ts`

### 10.1 HealthMonitor class

```typescript
import type { TunnelManager } from "./manager.js";
import type { TunnelInfo, TunnelHealthEntry, TunnelHealthReport } from "./types.js";

interface HealthMonitorConfig {
  /** Check interval in ms (default: 30000) */
  intervalMs: number;
  /** Consecutive failures before marking as error (default: 3) */
  failureThreshold: number;
  /** Max restart attempts before giving up (default: 3) */
  maxRestartAttempts: number;
}

export class HealthMonitor {
  private config: HealthMonitorConfig;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private manager: TunnelManager | null = null;
  /** Track consecutive failures per tunnel ID */
  private failureCounts = new Map<string, number>();
  /** Track restart attempts per tunnel ID */
  private restartAttempts = new Map<string, number>();

  constructor(config: HealthMonitorConfig) {
    this.config = config;
  }

  /** Start periodic health checking */
  start(manager: TunnelManager): void {
    this.manager = manager;
    if (this.intervalHandle) {
      return; // already running
    }
    this.intervalHandle = setInterval(() => {
      void this.runCheck();
    }, this.config.intervalMs);
  }

  /** Stop health checking */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.manager = null;
    this.failureCounts.clear();
    this.restartAttempts.clear();
  }

  /** Run a health check on all active tunnels */
  async checkAll(tunnels: TunnelInfo[]): Promise<TunnelHealthReport> {
    const entries: TunnelHealthEntry[] = [];

    for (const tunnel of tunnels) {
      if (tunnel.status !== "active") continue;

      const healthy = await this.checkSingle(tunnel);
      const failures = this.failureCounts.get(tunnel.id) ?? 0;

      entries.push({
        tunnelId: tunnel.id,
        project: tunnel.project,
        url: tunnel.url,
        healthy,
        lastCheckAt: new Date(),
        consecutiveFailures: failures,
      });
    }

    return {
      tunnels: entries,
      allHealthy: entries.every((e) => e.healthy),
    };
  }

  private async runCheck(): Promise<void> {
    if (!this.manager) return;

    const tunnels = this.manager.list();
    for (const tunnel of tunnels) {
      if (tunnel.status !== "active") continue;

      const healthy = await this.checkSingle(tunnel);
      if (healthy) {
        const hadFailures = (this.failureCounts.get(tunnel.id) ?? 0) > 0;
        this.failureCounts.set(tunnel.id, 0);
        this.restartAttempts.set(tunnel.id, 0);
        if (hadFailures) {
          // Tunnel recovered
          this.manager["deps"].callbacks.onNotify({
            type: "tunnel:health_restored",
            tunnelId: tunnel.id,
            project: tunnel.project,
          });
        }
      } else {
        const count = (this.failureCounts.get(tunnel.id) ?? 0) + 1;
        this.failureCounts.set(tunnel.id, count);

        if (count >= this.config.failureThreshold) {
          await this.handleFailure(tunnel);
        }
      }
    }
  }

  private async checkSingle(tunnel: TunnelInfo): Promise<boolean> {
    // For Serve tunnels: check if Tailscale serve is still active on the port
    // For Funnel tunnels: check if the proxy route target is responding
    //
    // We use a simple HTTP GET to the tunnel URL with a short timeout.
    // If the upstream service is down, that's fine — we're checking if the
    // *tunnel* is alive, not the service. For Serve, we check tailscale
    // serve status. For Funnel, we check if the proxy port is listening.
    try {
      if (tunnel.mode === "serve") {
        return await this.manager!["deps"].serveAdapter.isActive(tunnel.localPort);
      }
      // Funnel: check if proxy is still running
      return this.manager!["deps"].funnelProxy.isRunning();
    } catch {
      return false;
    }
  }

  private async handleFailure(tunnel: TunnelInfo): Promise<void> {
    if (!this.manager) return;

    const attempts = this.restartAttempts.get(tunnel.id) ?? 0;

    if (attempts >= this.config.maxRestartAttempts) {
      // Max retries reached — mark as error, notify, stop trying
      this.manager["deps"].db.updateStatus(tunnel.id, "error");
      this.manager["deps"].callbacks.onNotify({
        type: "tunnel:restart_failed",
        tunnelId: tunnel.id,
        project: tunnel.project,
        attempts,
      });
      this.failureCounts.delete(tunnel.id);
      this.restartAttempts.delete(tunnel.id);
      return;
    }

    // Try to restart with exponential backoff
    const backoffMs = [1000, 5000, 30_000][attempts] ?? 30_000;
    this.restartAttempts.set(tunnel.id, attempts + 1);

    setTimeout(() => {
      void this.attemptRestart(tunnel);
    }, backoffMs);
  }

  private async attemptRestart(tunnel: TunnelInfo): Promise<void> {
    if (!this.manager) return;

    try {
      if (tunnel.mode === "serve") {
        await this.manager["deps"].serveAdapter.start(tunnel.localPort);
      }
      // Reset failure counters on successful restart
      this.failureCounts.set(tunnel.id, 0);
      this.manager["deps"].db.updateStatus(tunnel.id, "active");
      this.manager["deps"].callbacks.onNotify({
        type: "tunnel:health_restored",
        tunnelId: tunnel.id,
        project: tunnel.project,
      });
    } catch {
      // Will be retried on next health check cycle
      this.manager["deps"].callbacks.onNotify({
        type: "tunnel:error",
        tunnelId: tunnel.id,
        project: tunnel.project,
        error: `Restart attempt ${this.restartAttempts.get(tunnel.id) ?? 0} failed`,
      });
    }
  }
}
```

### 10.2 Backoff schedule

| Attempt   | Delay                                  |
| --------- | -------------------------------------- |
| 1st       | 1 second                               |
| 2nd       | 5 seconds                              |
| 3rd       | 30 seconds                             |
| After 3rd | Give up — mark as `error`, notify user |

The user must manually restart with `/tunnel <project>` after max retries.

---

## 11. Lifecycle Management

### 11.1 Tunnel ↔ Session binding

Tunnels are bound to sessions via `sessionId`. When a session is destroyed, all its tunnels are stopped automatically.

The existing `onSessionDestroy` callback in `jorchbot-start.ts` already calls `tunnelManager.stopAll(project)`. For Phase 4, this changes to `tunnelManager.stopByProject(project)`.

### 11.2 Gateway shutdown

During shutdown, `TunnelManager.stopAll()`:

1. Stops all active Tailscale Serve tunnels (per-port)
2. Removes all Funnel proxy routes
3. Stops the Funnel proxy server
4. Stops the Tailscale Funnel
5. Stops the health monitor
6. Updates all tunnel records in DB to `stopped`

### 11.3 Gateway restart (restore)

During startup, `TunnelManager.restore()`:

1. Reads all `active` tunnel records from DB
2. For each record, checks if Tailscale still has it alive
3. If alive: adds to in-memory cache, re-registers Funnel proxy routes
4. If dead: marks as `stopped` in DB
5. Starts health monitor if any tunnels were restored
6. Starts Funnel proxy if any Funnel tunnels were restored

### 11.4 Jorchfile hot-reload

When the Jorchfile is reloaded and a project is removed or modified, `tunnelManager.stopByProject(project)` is called for affected projects. This is already wired in the Phase 3 code (just needs the import path updated).

---

## 12. Commands — API + CLI + Chat

### 12.1 Chat commands (CommandRouter)

Add these handlers to `src/commands/router.ts`:

```typescript
// In the switch statement of handleCommand():
case "tunnel":
  await this.handleTunnel(args);
  return;
case "tunnel-stop":
  await this.handleTunnelStop(args);
  return;
case "tunnels":
  await this.handleTunnels();
  return;
```

**`/tunnel <project> [port] [--public]`**:

```typescript
private async handleTunnel(args: string[]): Promise<void> {
  const [project, ...rest] = args;
  if (!project) {
    await this.deps.sendReply("Usage: /tunnel <project> [port] [--public]");
    return;
  }

  const isPublic = rest.includes("--public");
  const portArg = rest.find((a) => !a.startsWith("--"));
  const port = portArg ? Number.parseInt(portArg, 10) : undefined;

  // Resolve session and port
  const session = this.deps.sessionManager.getByProject(project);
  if (!session) {
    await this.deps.sendReply(
      `No active session for "${project}". Use /new ${project} first.`,
    );
    return;
  }

  // Port: explicit arg > running task port > error
  const resolvedPort = port ?? this.resolveProjectPort(project);
  if (!resolvedPort) {
    await this.deps.sendReply(
      `No port found for "${project}". Specify a port: /tunnel ${project} 3000`,
    );
    return;
  }

  const mode = isPublic ? "funnel" : "serve";

  try {
    const result = await this.deps.tunnelManager.start({
      project,
      sessionId: session.id,
      localPort: resolvedPort,
      mode,
    });
    // Result is returned for serve mode.
    // For funnel mode, TunnelPendingConfirmation is thrown and handled below.
  } catch (err: unknown) {
    if (err instanceof TunnelPendingConfirmation) {
      // Confirmation buttons are sent by the TunnelManager callback.
      // Nothing to do here.
      return;
    }
    await this.deps.sendReply(
      `Failed to start tunnel: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
```

**`/tunnels`**:

```typescript
private async handleTunnels(): Promise<void> {
  const allTunnels = this.deps.tunnelManager.list();
  if (allTunnels.length === 0) {
    await this.deps.sendReply("No active tunnels.");
    return;
  }

  const serveTunnels = allTunnels.filter((t) => t.mode === "serve");
  const funnelTunnels = allTunnels.filter((t) => t.mode === "funnel");

  const lines: string[] = ["*Active tunnels:*", ""];

  if (serveTunnels.length > 0) {
    lines.push("*PRIVATE (tailnet only):*");
    for (const t of serveTunnels) {
      lines.push(`  ${t.project} → ${t.url} (Serve, port ${t.localPort})`);
    }
    lines.push("");
  }

  if (funnelTunnels.length > 0) {
    lines.push("*PUBLIC (internet):*");
    for (const t of funnelTunnels) {
      lines.push(`  ${t.project} → ${t.url} (Funnel, port ${t.localPort})`);
    }
  }

  await this.deps.sendReply(lines.join("\n"));
}
```

**`/tunnel-stop <project> [port]`**:

```typescript
private async handleTunnelStop(args: string[]): Promise<void> {
  const [project, portArg] = args;
  if (!project) {
    await this.deps.sendReply("Usage: /tunnel-stop <project> [port]");
    return;
  }

  if (portArg) {
    const port = Number.parseInt(portArg, 10);
    await this.deps.tunnelManager.stopByProjectPort(project, port);
    await this.deps.sendReply(`[${project}] Tunnel on port ${port} stopped.`);
  } else {
    await this.deps.tunnelManager.stopByProject(project);
    await this.deps.sendReply(`[${project}] All tunnels stopped.`);
  }
}
```

### 12.2 CLI commands (Commander)

Register in `src/cli/program/register.jorchbot.ts`:

```typescript
jbCommand
  .command("tunnel")
  .description("Manage tunnels")
  .addCommand(
    new Command("start")
      .argument("<project>")
      .option("-p, --port <port>", "Local port to expose")
      .option("--public", "Use Funnel (public internet) instead of Serve (tailnet)")
      .description("Start a tunnel")
      .action(async (project, opts) => {
        /* ... */
      }),
  )
  .addCommand(
    new Command("stop")
      .argument("<project>")
      .option("-p, --port <port>", "Specific port to stop")
      .description("Stop tunnel(s)")
      .action(async (project, opts) => {
        /* ... */
      }),
  )
  .addCommand(
    new Command("list").description("List active tunnels").action(async () => {
      /* ... */
    }),
  )
  .addCommand(
    new Command("status").description("Health status of all tunnels").action(async () => {
      /* ... */
    }),
  );
```

### 12.3 Help text update

Add to the `/help` output:

```
*Tunnels:*
/tunnel <project> [port] — Start private tunnel (Serve)
/tunnel <project> [port] --public — Start public tunnel (Funnel)
/tunnel-stop <project> [port] — Stop tunnel(s)
/tunnels — List all active tunnels
```

---

## 13. Migration from Phase 3

### 13.1 Files to remove

- `src/jorchfile/tunnel.ts` — replaced by `src/tunnels/manager.ts`
- `src/jorchfile/tunnel.test.ts` — replaced by `src/tunnels/manager.test.ts`
- `src/tunnels/manager.ts` (placeholder) — overwritten
- `src/tunnels/tailscale.ts` (placeholder) — overwritten
- `src/tunnels/port-manager.ts` (placeholder) — overwritten (PortManager stays in `src/jorchfile/port-manager.ts`)

### 13.2 Import updates

Files that import from `src/jorchfile/tunnel.ts`:

1. **`src/gateway/jorchbot-start.ts`** — change import:

   ```typescript
   // Before:
   import { TunnelManager } from "../jorchfile/tunnel.js";
   // After:
   import { TunnelManager } from "../tunnels/manager.js";
   ```

2. **`src/jorchfile/executor.ts`** — change import:
   ```typescript
   // Before:
   import type { TunnelManager } from "./tunnel.js";
   // After:
   import type { TunnelManager } from "../tunnels/manager.js";
   ```

### 13.3 Interface changes

The Phase 3 TunnelManager had:

```typescript
constructor(deps: { sendReply, sendButtons })
start(input: { project, port, mode })
startServe(input: { project, port, mode })
stop(project, port)
stopAll(project)
listAll(): ActiveTunnel[]
```

The Phase 4 TunnelManager has:

```typescript
constructor(deps: TunnelManagerDeps)  // adapters, proxy, health, db, callbacks
start(input: TunnelStartInput)        // includes sessionId
confirmFunnel(tunnelId)
cancelFunnel(tunnelId)
stop(tunnelId)                        // by tunnel ID, not project+port
stopByProjectPort(project, port)      // backward compat
stopByProject(project)                // replaces stopAll(project)
stopBySession(sessionId)
stopAll()                             // no args — stops everything
list(): TunnelInfo[]                  // replaces listAll()
listByProject(project)
restore(): Promise<number>
health(): Promise<TunnelHealthReport>
```

The `JorchfileExecutor` needs to update its calls:

- `tunnelManager.start(...)` — add `sessionId` field
- `tunnelManager.stop(project, port)` → `tunnelManager.stopByProjectPort(project, port)`
- `tunnelManager.stopAll(project)` → `tunnelManager.stopByProject(project)`
- `tunnelManager.listAll()` → `tunnelManager.list()`

### 13.4 Gateway wiring

In `jorchbot-start.ts`, the TunnelManager construction changes from:

```typescript
const tunnelManager = new TunnelManager({ sendReply, sendButtons });
```

To:

```typescript
import { TailscaleServeAdapter } from "../tunnels/adapters/tailscale-serve.js";
import { TailscaleFunnelAdapter } from "../tunnels/adapters/tailscale-funnel.js";
import { FunnelProxy } from "../tunnels/funnel-proxy.js";
import { HealthMonitor } from "../tunnels/health.js";
import { TunnelDb } from "../tunnels/tunnel-db.js";
import { TunnelManager, TunnelPendingConfirmation } from "../tunnels/manager.js";

const serveAdapter = new TailscaleServeAdapter();
const funnelAdapter = new TailscaleFunnelAdapter();
const funnelProxy = new FunnelProxy(config.tunnels.funnelProxy.port);
const healthMonitor = new HealthMonitor({
  intervalMs: config.tunnels.health.intervalMs,
  failureThreshold: config.tunnels.health.failureThreshold,
  maxRestartAttempts: config.tunnels.health.maxRestartAttempts,
});
const tunnelDb = new TunnelDb();

const tunnelManager = new TunnelManager({
  serveAdapter,
  funnelAdapter,
  funnelProxy,
  healthMonitor,
  db: tunnelDb,
  callbacks: {
    onNotify: (event) => {
      // Route event to the appropriate chat based on event type
      // Uses sendReplyTo with the session owner's phone
      switch (event.type) {
        case "tunnel:started":
          // Find session owner phone and send tunnel URL
          break;
        case "tunnel:stopped":
          break;
        case "tunnel:error":
          // Send error notification
          break;
        case "tunnel:restart_failed":
          // Send critical notification
          break;
      }
    },
    onConfirmFunnel: (tunnelId, project, port) => {
      // Send confirmation buttons to the current sender
      void sendButtons(
        `[${project}] This will expose port ${port} to the public internet via Funnel.\n` +
          `URL: https://<device>.ts.net:8443/${project}\n` +
          `Anyone with the link can access it.`,
        [
          {
            id: JSON.stringify({ type: "tunnel_approve", tunnelId }),
            title: "Expose publicly",
          },
          {
            id: JSON.stringify({ type: "tunnel_reject", tunnelId }),
            title: "Cancel",
          },
        ],
      );
    },
  },
});

// Restore tunnels from DB
const restoredTunnels = await tunnelManager.restore();
if (restoredTunnels > 0) {
  console.log(`[jorchbot] restored ${restoredTunnels} active tunnel(s)`);
}
```

The button callback handler also needs updating:

```typescript
} else if (payload.type === "tunnel_approve") {
  const { tunnelId } = payload as { tunnelId: string };
  try {
    const tunnel = await tunnelManager.confirmFunnel(tunnelId);
    await sendReplyTo(senderPhone, `[${tunnel.project}] Funnel active: ${tunnel.url}`);
  } catch (err: unknown) {
    await sendReplyTo(
      senderPhone,
      `Tunnel failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
} else if (payload.type === "tunnel_reject") {
  const { tunnelId } = payload as { tunnelId: string };
  tunnelManager.cancelFunnel(tunnelId);
  await sendReplyTo(senderPhone, "Tunnel creation cancelled.");
}
```

---

## 14. Testing Strategy

### 14.1 Approach

All tests are **unit tests** with mocked Tailscale commands. No real Tailscale binary is invoked.

### 14.2 Test files

| File                                            | Tests                                  |
| ----------------------------------------------- | -------------------------------------- |
| `src/tunnels/manager.test.ts`                   | TunnelManager orchestration            |
| `src/tunnels/adapters/tailscale-serve.test.ts`  | ServeAdapter start/stop/isActive       |
| `src/tunnels/adapters/tailscale-funnel.test.ts` | FunnelAdapter start/stop/isActive      |
| `src/tunnels/funnel-proxy.test.ts`              | FunnelProxy routing, WebSocket         |
| `src/tunnels/health.test.ts`                    | HealthMonitor cycles, backoff, restart |
| `src/tunnels/tunnel-db.test.ts`                 | DB CRUD operations                     |

### 14.3 Mock strategy

**Tailscale commands**: Mock `runExec` from `src/process/exec.js` using `vi.mock()`.

**DB**: Use real SQLite with `JORCHBOT_DB_PATH` set to a temp file per test.

**http-proxy**: Mock the `http-proxy` module for FunnelProxy tests. For integration-level proxy tests, use a real HTTP server on a random port.

### 14.4 Example test: TunnelManager

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TunnelManager, TunnelPendingConfirmation } from "./manager.js";
import type { TunnelManagerDeps } from "./manager.js";

describe("TunnelManager", () => {
  let manager: TunnelManager;
  let deps: TunnelManagerDeps;

  beforeEach(() => {
    deps = {
      serveAdapter: {
        ensureAvailable: vi.fn().mockResolvedValue(undefined),
        getHostname: vi.fn().mockResolvedValue("mydevice.ts.net"),
        start: vi.fn().mockResolvedValue({ url: "https://mydevice.ts.net:3000" }),
        stop: vi.fn().mockResolvedValue(undefined),
        isActive: vi.fn().mockResolvedValue(true),
      },
      funnelAdapter: {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        isActive: vi.fn().mockResolvedValue(true),
      },
      funnelProxy: {
        getPort: vi.fn().mockReturnValue(8443),
        isRunning: vi.fn().mockReturnValue(false),
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        addRoute: vi.fn(),
        removeRoute: vi.fn(),
        listRoutes: vi.fn().mockReturnValue([]),
        hasRoute: vi.fn().mockReturnValue(false),
      },
      healthMonitor: {
        start: vi.fn(),
        stop: vi.fn(),
        checkAll: vi.fn().mockResolvedValue({ tunnels: [], allHealthy: true }),
      },
      db: {
        insert: vi.fn(),
        updateStatus: vi.fn(),
        listActive: vi.fn().mockReturnValue([]),
        getById: vi.fn().mockReturnValue(undefined),
      },
      callbacks: {
        onNotify: vi.fn(),
        onConfirmFunnel: vi.fn(),
      },
    } as unknown as TunnelManagerDeps;

    manager = new TunnelManager(deps);
  });

  it("start() with serve mode creates tunnel and notifies", async () => {
    const result = await manager.start({
      project: "frontend",
      sessionId: "session-1",
      localPort: 3000,
      mode: "serve",
    });

    expect(result.project).toBe("frontend");
    expect(result.mode).toBe("serve");
    expect(result.url).toBe("https://mydevice.ts.net:3000");
    expect(result.status).toBe("active");
    expect(deps.serveAdapter.start).toHaveBeenCalledWith(3000);
    expect(deps.db.insert).toHaveBeenCalledTimes(1);
    expect(deps.callbacks.onNotify).toHaveBeenCalledWith(
      expect.objectContaining({ type: "tunnel:started" }),
    );
  });

  it("start() with funnel mode throws TunnelPendingConfirmation", async () => {
    try {
      await manager.start({
        project: "frontend",
        sessionId: "session-1",
        localPort: 3000,
        mode: "funnel",
      });
      expect.unreachable("should throw");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(TunnelPendingConfirmation);
      expect(deps.callbacks.onConfirmFunnel).toHaveBeenCalledTimes(1);
    }
  });

  it("confirmFunnel() creates tunnel after user confirms", async () => {
    // Start funnel (pending)
    let pendingId: string | undefined;
    try {
      await manager.start({
        project: "frontend",
        sessionId: "session-1",
        localPort: 3000,
        mode: "funnel",
      });
    } catch (err: unknown) {
      if (err instanceof TunnelPendingConfirmation) {
        pendingId = err.tunnelId;
      }
    }

    expect(pendingId).toBeDefined();

    // Confirm
    const result = await manager.confirmFunnel(pendingId!);

    expect(result.mode).toBe("funnel");
    expect(result.url).toContain("8443");
    expect(deps.funnelProxy.start).toHaveBeenCalled();
    expect(deps.funnelAdapter.start).toHaveBeenCalledWith(8443);
    expect(deps.funnelProxy.addRoute).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/frontend" }),
    );
  });

  it("stopByProject() stops all tunnels for a project", async () => {
    await manager.start({
      project: "frontend",
      sessionId: "s1",
      localPort: 3000,
      mode: "serve",
    });
    await manager.start({
      project: "frontend",
      sessionId: "s1",
      localPort: 6006,
      mode: "serve",
    });

    expect(manager.list()).toHaveLength(2);

    await manager.stopByProject("frontend");

    expect(manager.list()).toHaveLength(0);
    expect(deps.serveAdapter.stop).toHaveBeenCalledTimes(2);
  });

  it("restore() reconnects tunnels from DB", async () => {
    deps.db.listActive = vi.fn().mockReturnValue([
      {
        id: "tunnel-1",
        sessionId: "s1",
        project: "frontend",
        localPort: 3000,
        assignedPort: 3000,
        url: "https://mydevice.ts.net:3000",
        provider: "tailscale-serve",
        mode: "serve",
        status: "active",
        funnelPath: null,
        createdAt: new Date(),
      },
    ]);
    deps.serveAdapter.isActive = vi.fn().mockResolvedValue(true);

    const restored = await manager.restore();

    expect(restored).toBe(1);
    expect(manager.list()).toHaveLength(1);
    expect(deps.healthMonitor.start).toHaveBeenCalled();
  });

  it("restore() marks dead tunnels as stopped", async () => {
    deps.db.listActive = vi.fn().mockReturnValue([
      {
        id: "tunnel-dead",
        sessionId: "s1",
        project: "backend",
        localPort: 8000,
        assignedPort: 8000,
        url: "https://mydevice.ts.net:8000",
        provider: "tailscale-serve",
        mode: "serve",
        status: "active",
        funnelPath: null,
        createdAt: new Date(),
      },
    ]);
    deps.serveAdapter.isActive = vi.fn().mockResolvedValue(false);

    const restored = await manager.restore();

    expect(restored).toBe(0);
    expect(deps.db.updateStatus).toHaveBeenCalledWith("tunnel-dead", "stopped");
  });
});
```

---

## 15. Acceptance Criteria

### 15.1 Core functionality

- [ ] `TunnelManager` creates and manages Serve tunnels
- [ ] `TunnelManager` creates and manages Funnel tunnels (with confirmation)
- [ ] Multiple tunnels per project work correctly
- [ ] Funnel always uses port 8443 with reverse proxy
- [ ] Reverse proxy routes requests by path to correct local ports
- [ ] WebSocket pass-through works (HMR)
- [ ] Tunnels are persisted in SQLite `tunnels` table
- [ ] Tunnels survive gateway restart (restore from DB + Tailscale sync)
- [ ] Orphan tunnels (in DB but not in Tailscale) are marked as stopped

### 15.2 Health & lifecycle

- [ ] Health monitor checks tunnels every 30 seconds (configurable)
- [ ] 3 consecutive failures trigger auto-restart with backoff (1s, 5s, 30s)
- [ ] After 3 failed restarts, tunnel marked as `error` and user notified
- [ ] Tunnels stop when session is destroyed
- [ ] All tunnels stop on gateway shutdown
- [ ] Jorchfile hot-reload stops affected tunnels

### 15.3 Commands

- [ ] `/tunnel <project> [port]` starts Serve tunnel and sends URL
- [ ] `/tunnel <project> [port] --public` starts Funnel with confirmation
- [ ] `/tunnel-stop <project> [port]` stops tunnel(s)
- [ ] `/tunnels` lists all active tunnels by mode
- [ ] `jorchbot jb tunnel start/stop/list/status` work from CLI
- [ ] `/help` includes tunnel commands

### 15.4 Error handling

- [ ] Clear error when Tailscale not installed (with install link)
- [ ] Clear error when Tailscale not authenticated (with `tailscale up` instruction)
- [ ] Clear error when Funnel not enabled on tailnet (with admin console link)
- [ ] All errors extend `JorchBotError` with cause chaining

### 15.5 Testing

- [ ] All unit tests pass with mocked Tailscale
- [ ] `pnpm check` passes (0 errors, 0 warnings)
- [ ] No regressions in existing Phase 3 tests

### 15.6 Migration

- [ ] `src/jorchfile/tunnel.ts` removed
- [ ] `src/jorchfile/tunnel.test.ts` removed
- [ ] All imports updated
- [ ] `JorchfileExecutor` uses new TunnelManager API
- [ ] Gateway wiring updated in `jorchbot-start.ts`
- [ ] DB migration generated for new columns (`project`, `funnel_path`)
