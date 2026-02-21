import type { TunnelInfo, TunnelHealthEntry, TunnelHealthReport, TunnelEvent } from "./types.js";

interface HealthMonitorConfig {
  /** Check interval in ms (default: 30000) */
  intervalMs: number;
  /** Consecutive failures before marking as error (default: 3) */
  failureThreshold: number;
  /** Max restart attempts before giving up (default: 3) */
  maxRestartAttempts: number;
}

export interface HealthMonitorDeps {
  /** Check if a serve tunnel is active on a port */
  isServeActive: (port: number) => Promise<boolean>;
  /** Check if the funnel proxy is running */
  isFunnelProxyRunning: () => boolean;
  /** Update tunnel status in DB */
  updateDbStatus: (tunnelId: string, status: "active" | "stopped" | "error") => void;
  /** Notify about tunnel events */
  onNotify: (event: TunnelEvent) => void;
}

/** Minimal interface for the TunnelManager that HealthMonitor needs */
interface TunnelListProvider {
  list(): TunnelInfo[];
}

export class HealthMonitor {
  private config: HealthMonitorConfig;
  private monitorDeps: HealthMonitorDeps | null = null;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private tunnelListProvider: TunnelListProvider | null = null;
  /** Track consecutive failures per tunnel ID */
  private failureCounts = new Map<string, number>();
  /** Track restart attempts per tunnel ID */
  private restartAttempts = new Map<string, number>();

  constructor(config: HealthMonitorConfig, deps?: HealthMonitorDeps) {
    this.config = config;
    this.monitorDeps = deps ?? null;
  }

  /** Set deps after construction (allows deferred wiring) */
  setDeps(deps: HealthMonitorDeps): void {
    this.monitorDeps = deps;
  }

  /** Start periodic health checking */
  start(provider: TunnelListProvider): void {
    this.tunnelListProvider = provider;
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
    this.tunnelListProvider = null;
    this.failureCounts.clear();
    this.restartAttempts.clear();
  }

  /** Run a health check on all active tunnels */
  async checkAll(tunnels: TunnelInfo[]): Promise<TunnelHealthReport> {
    const entries: TunnelHealthEntry[] = [];

    for (const tunnel of tunnels) {
      if (tunnel.status !== "active") {
        continue;
      }

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
    if (!this.tunnelListProvider || !this.monitorDeps) {
      return;
    }

    const tunnels = this.tunnelListProvider.list();
    for (const tunnel of tunnels) {
      if (tunnel.status !== "active") {
        continue;
      }

      const healthy = await this.checkSingle(tunnel);
      if (healthy) {
        const hadFailures = (this.failureCounts.get(tunnel.id) ?? 0) > 0;
        this.failureCounts.set(tunnel.id, 0);
        this.restartAttempts.set(tunnel.id, 0);
        if (hadFailures) {
          this.monitorDeps.onNotify({
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
    if (!this.monitorDeps) {
      return false;
    }

    try {
      if (tunnel.mode === "serve") {
        return await this.monitorDeps.isServeActive(tunnel.localPort);
      }
      return this.monitorDeps.isFunnelProxyRunning();
    } catch {
      return false;
    }
  }

  private async handleFailure(tunnel: TunnelInfo): Promise<void> {
    if (!this.monitorDeps) {
      return;
    }

    const attempts = this.restartAttempts.get(tunnel.id) ?? 0;

    if (attempts >= this.config.maxRestartAttempts) {
      this.monitorDeps.updateDbStatus(tunnel.id, "error");
      this.monitorDeps.onNotify({
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
    if (!this.monitorDeps) {
      return;
    }

    try {
      if (tunnel.mode === "serve") {
        await this.monitorDeps.isServeActive(tunnel.localPort);
      }
      this.failureCounts.set(tunnel.id, 0);
      this.monitorDeps.updateDbStatus(tunnel.id, "active");
      this.monitorDeps.onNotify({
        type: "tunnel:health_restored",
        tunnelId: tunnel.id,
        project: tunnel.project,
      });
    } catch {
      this.monitorDeps.onNotify({
        type: "tunnel:error",
        tunnelId: tunnel.id,
        project: tunnel.project,
        error: `Restart attempt ${this.restartAttempts.get(tunnel.id) ?? 0} failed`,
      });
    }
  }
}
