import { TailscaleNotInstalledError, TailscaleNotAuthenticatedError } from "../../errors/index.js";
import { findTailscaleBinary, getTailnetHostname } from "../../infra/tailscale.js";
import { runExec } from "../../process/exec.js";

export interface ServeStartResult {
  url: string;
}

/**
 * Tailscale Serve adapter for private (tailnet-only) tunnel mode.
 *
 * In VPN mesh mode, devices on the tailnet can access each other's ports
 * directly via MagicDNS hostname — no `tailscale serve` command needed.
 * This adapter just resolves the tailnet hostname and constructs the URL.
 */
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

  /** Get cached tailnet hostname (call ensureAvailable first) */
  async getHostname(): Promise<string> {
    if (!this.hostname) {
      await this.ensureAvailable();
    }
    return this.hostname!;
  }

  /**
   * "Start" a serve tunnel — resolves the URL for direct tailnet access.
   * No `tailscale serve` command is run. The tailnet mesh provides
   * direct port connectivity between devices.
   */
  async start(port: number): Promise<ServeStartResult> {
    const hostname = await this.getHostname();
    return { url: `http://${hostname}:${port}` };
  }

  /**
   * Stop is a no-op for serve mode — there's no `tailscale serve`
   * process to stop. Direct port access doesn't need cleanup.
   */
  async stop(_port: number): Promise<void> {
    // No-op: serve mode uses direct tailnet access
  }

  /**
   * Check if a port is reachable. For serve mode this is always true
   * since we don't control the service lifecycle — the user manages
   * their services (Docker, processes) independently.
   */
  async isActive(_port: number): Promise<boolean> {
    return true;
  }
}
