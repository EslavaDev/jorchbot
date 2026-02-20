import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface TunnelStartInput {
  project: string;
  port: number;
  mode: "serve" | "funnel";
}

export interface ActiveTunnel {
  project: string;
  port: number;
  mode: "serve" | "funnel";
  url: string;
}

interface TunnelManagerDeps {
  sendReply: (text: string) => Promise<void>;
  sendButtons: (text: string, buttons: Array<{ id: string; title: string }>) => Promise<void>;
}

export class TunnelManager {
  private activeTunnels = new Map<string, ActiveTunnel>(); // key = "project:port"
  private deps: TunnelManagerDeps;

  constructor(deps: TunnelManagerDeps) {
    this.deps = deps;
  }

  /**
   * Start a Tailscale tunnel for a project.
   * For funnel mode, asks user confirmation first (public exposure).
   */
  async start(input: TunnelStartInput): Promise<void> {
    const available = await this.isTailscaleAvailable();
    if (!available) {
      await this.deps.sendReply(
        `[${input.project}] Tailscale not installed. Tunnel skipped. Install: https://tailscale.com/download`,
      );
      return;
    }

    if (input.mode === "funnel") {
      // Funnel is public — ask confirmation
      await this.deps.sendButtons(
        `[${input.project}] Funnel exposes port ${input.port} to the public internet. Continue?`,
        [
          {
            id: JSON.stringify({
              type: "tunnel_approve",
              project: input.project,
              port: input.port,
            }),
            title: "Yes, expose",
          },
          {
            id: JSON.stringify({
              type: "tunnel_reject",
              project: input.project,
              port: input.port,
            }),
            title: "Cancel",
          },
        ],
      );
      return;
    }

    // serve mode — start immediately
    await this.startServe(input);
  }

  /**
   * Actually start the Tailscale serve/funnel command.
   * Called directly for serve mode, or after user confirmation for funnel mode.
   */
  async startServe(input: TunnelStartInput): Promise<void> {
    const command =
      input.mode === "funnel"
        ? `tailscale funnel --bg ${input.port}`
        : `tailscale serve --bg ${input.port}`;

    try {
      await execAsync(command);
    } catch (err: unknown) {
      await this.deps.sendReply(
        `[${input.project}] Failed to start tunnel: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    // Get tunnel URL from tailscale status
    const url = await this.getTunnelUrl();
    const key = `${input.project}:${input.port}`;
    const tunnel: ActiveTunnel = {
      project: input.project,
      port: input.port,
      mode: input.mode,
      url: url ?? `https://localhost:${input.port}`,
    };
    this.activeTunnels.set(key, tunnel);

    await this.deps.sendReply(
      `[${input.project}] Tunnel active: ${tunnel.url} (${input.mode}, port ${input.port})`,
    );
  }

  /** Stop a tunnel for a specific project+port. Best-effort. */
  async stop(project: string, port: number): Promise<void> {
    const key = `${project}:${port}`;
    const tunnel = this.activeTunnels.get(key);
    if (!tunnel) {
      return; // best-effort
    }

    const command =
      tunnel.mode === "funnel" ? `tailscale funnel off ${port}` : `tailscale serve off ${port}`;

    try {
      await execAsync(command);
    } catch {
      // best-effort — don't throw if already stopped
    }

    this.activeTunnels.delete(key);
  }

  /** Stop all tunnels for a project. Best-effort. */
  async stopAll(project: string): Promise<void> {
    const toRemove: string[] = [];
    for (const [key, tunnel] of this.activeTunnels) {
      if (tunnel.project === project) {
        toRemove.push(key);
        const command =
          tunnel.mode === "funnel"
            ? `tailscale funnel off ${tunnel.port}`
            : `tailscale serve off ${tunnel.port}`;
        try {
          await execAsync(command);
        } catch {
          // best-effort
        }
      }
    }
    for (const key of toRemove) {
      this.activeTunnels.delete(key);
    }
  }

  /** List all active tunnels */
  listAll(): ActiveTunnel[] {
    return [...this.activeTunnels.values()];
  }

  private async isTailscaleAvailable(): Promise<boolean> {
    try {
      await execAsync("tailscale version");
      return true;
    } catch {
      return false;
    }
  }

  private async getTunnelUrl(): Promise<string | null> {
    try {
      const { stdout } = await execAsync("tailscale status --json");
      const status = JSON.parse(stdout) as { Self?: { DNSName?: string } };
      const dnsName = status.Self?.DNSName;
      if (dnsName) {
        // Remove trailing dot if present
        const clean = dnsName.endsWith(".") ? dnsName.slice(0, -1) : dnsName;
        return `https://${clean}`;
      }
    } catch {
      // ignore — URL is best-effort
    }
    return null;
  }
}
