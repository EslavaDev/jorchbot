import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { TunnelNotFoundError } from "../errors/index.js";
import type { TailscaleFunnelAdapter } from "./adapters/tailscale-funnel.js";
import type { TailscaleServeAdapter } from "./adapters/tailscale-serve.js";
import type { FunnelProxy } from "./funnel-proxy.js";
import type { HealthMonitor } from "./health.js";
import type { TunnelDb } from "./tunnel-db.js";
import type {
  TunnelManagerCallbacks,
  TunnelInfo,
  TunnelStartInput,
  TunnelHealthReport,
} from "./types.js";
import { TunnelStartInputSchema } from "./types.js";

export interface TunnelManagerDeps {
  serveAdapter: TailscaleServeAdapter;
  funnelAdapter: TailscaleFunnelAdapter;
  funnelProxy: FunnelProxy;
  /** Tailscale Funnel public port (443, 8443, or 10000) */
  funnelPublicPort: number;
  healthMonitor: HealthMonitor;
  db: TunnelDb;
  callbacks: TunnelManagerCallbacks;
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

export class TunnelManager extends EventEmitter {
  private deps: TunnelManagerDeps;
  /** In-memory cache of active tunnels, keyed by tunnel ID */
  private activeTunnels = new Map<string, TunnelInfo>();
  /** Pending Funnel confirmations: tunnelId → TunnelStartInput */
  private pendingConfirmations = new Map<string, TunnelStartInput>();

  constructor(deps: TunnelManagerDeps) {
    super();
    this.deps = deps;
  }

  /**
   * Start a new tunnel.
   *
   * - Serve mode: resolves tailnet URL immediately (direct VPN mesh access).
   * - Funnel mode with autoConfirm: starts immediately (Jorchfile-configured).
   * - Funnel mode without autoConfirm: asks for user confirmation first.
   *
   * @throws {TailscaleNotInstalledError} If Tailscale is not available
   * @throws {TunnelStartError} If the Tailscale command fails
   * @throws {TunnelPendingConfirmation} If funnel mode needs user confirmation
   */
  async start(rawInput: TunnelStartInput): Promise<TunnelInfo> {
    const input = TunnelStartInputSchema.parse(rawInput);

    // Check Tailscale availability (needed for hostname resolution)
    await this.deps.serveAdapter.ensureAvailable();

    if (input.mode === "funnel") {
      if (input.autoConfirm) {
        const tunnelId = crypto.randomUUID();
        return this.startFunnelDirect(input, tunnelId);
      }
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
    for (const tunnel of this.activeTunnels.values()) {
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

  /** Get the FunnelProxy instance for direct route management (GUI) */
  getFunnelProxy(): FunnelProxy {
    return this.deps.funnelProxy;
  }

  /** Get health report for all active tunnels */
  async health(): Promise<TunnelHealthReport> {
    return this.deps.healthMonitor.checkAll(this.list());
  }

  /**
   * Restore tunnel state from DB on gateway restart.
   *
   * - Serve tunnels: always restored (direct tailnet access, no Tailscale state to check).
   * - Funnel tunnels: checked against actual Tailscale Funnel state.
   */
  async restore(): Promise<number> {
    const dbTunnels = this.deps.db.listActive();
    let restored = 0;

    for (const record of dbTunnels) {
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

  /**
   * Start a serve tunnel — direct tailnet access.
   * No `tailscale serve` command needed. VPN mesh provides direct connectivity.
   */
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
    const startEvent = { type: "tunnel:started" as const, tunnel: info };
    this.deps.callbacks.onNotify(startEvent);
    this.emit("tunnelEvent", startEvent);

    return info;
  }

  private startFunnelWithConfirmation(input: TunnelStartInput): never {
    const tunnelId = crypto.randomUUID();
    this.pendingConfirmations.set(tunnelId, input);
    this.deps.callbacks.onConfirmFunnel(tunnelId, input.project, input.localPort);

    throw new TunnelPendingConfirmation(tunnelId);
  }

  private async startFunnelDirect(input: TunnelStartInput, tunnelId: string): Promise<TunnelInfo> {
    // Ensure Funnel proxy is running
    if (!this.deps.funnelProxy.isRunning()) {
      await this.deps.funnelProxy.start();
      // Ensure Tailscale Funnel is enabled: public port → local proxy port
      await this.deps.funnelAdapter.start(
        this.deps.funnelPublicPort,
        this.deps.funnelProxy.getPort(),
      );
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
    const publicPort = this.deps.funnelPublicPort;
    const url = `https://${hostname}:${publicPort}${funnelPath}`;

    const info: TunnelInfo = {
      id: tunnelId,
      sessionId: input.sessionId,
      project: input.project,
      localPort: input.localPort,
      assignedPort: publicPort,
      url,
      provider: "tailscale-funnel",
      mode: "funnel",
      status: "active",
      createdAt: new Date(),
    };

    this.activeTunnels.set(tunnelId, info);
    this.deps.db.insert(info, funnelPath);
    this.deps.healthMonitor.start(this);
    const funnelStartEvent = { type: "tunnel:started" as const, tunnel: info };
    this.deps.callbacks.onNotify(funnelStartEvent);
    this.emit("tunnelEvent", funnelStartEvent);

    return info;
  }

  private async stopTunnel(tunnel: TunnelInfo): Promise<void> {
    if (tunnel.mode === "serve") {
      // No-op for serve — direct tailnet access, nothing to stop in Tailscale
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
        await this.deps.funnelAdapter.stop(this.deps.funnelPublicPort);
      }
    }

    this.activeTunnels.delete(tunnel.id);
    this.deps.db.updateStatus(tunnel.id, "stopped");
    const stopEvent = {
      type: "tunnel:stopped" as const,
      tunnelId: tunnel.id,
      project: tunnel.project,
    };
    this.deps.callbacks.onNotify(stopEvent);
    this.emit("tunnelEvent", stopEvent);

    // Stop health monitor if no more active tunnels
    if (this.activeTunnels.size === 0) {
      this.deps.healthMonitor.stop();
    }
  }

  /**
   * Check if a tunnel is still alive.
   * - Serve: always true (direct tailnet, we don't control the service)
   * - Funnel: check if proxy port is in Tailscale Funnel config
   */
  private async checkTailscaleAlive(record: { localPort: number; mode: string }): Promise<boolean> {
    if (record.mode === "serve") {
      // Serve tunnels use direct tailnet access — always considered alive
      return true;
    }
    // For Funnel, check if the public port is still in Funnel config
    return this.deps.funnelAdapter.isActive(this.deps.funnelPublicPort);
  }
}
