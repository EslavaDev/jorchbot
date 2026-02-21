import { FunnelNotEnabledError, TunnelStartError } from "../../errors/index.js";
import { getTailscaleBinary } from "../../infra/tailscale.js";
import { runExec } from "../../process/exec.js";

export class TailscaleFunnelAdapter {
  /**
   * Start Tailscale Funnel.
   *
   * Uses `--https=<publicPort>` to explicitly bind the public-facing port.
   * Without this flag, Tailscale defaults ALL funnels to port 443,
   * which would overwrite the gateway's funnel mapping.
   *
   * Allowed public ports: 443, 8443, 10000.
   *
   * @param publicPort - The Tailscale Funnel public port (443, 8443, or 10000)
   * @param localPort  - The local port to forward traffic to (e.g., FunnelProxy on 9999)
   *
   * @throws {FunnelNotEnabledError} If Funnel is not enabled on tailnet
   * @throws {TunnelStartError} If the command fails
   */
  async start(publicPort: number, localPort: number): Promise<void> {
    const binary = await getTailscaleBinary();
    try {
      await runExec(
        binary,
        ["funnel", "--bg", "--yes", `--https=${publicPort}`, `localhost:${localPort}`],
        { timeoutMs: 15_000 },
      );
    } catch (err: unknown) {
      const errStr = err instanceof Error ? err.message : String(err);
      if (errStr.includes("Funnel is not enabled")) {
        throw new FunnelNotEnabledError(err);
      }
      throw new TunnelStartError("(funnel)", localPort, "funnel", err);
    }
  }

  /**
   * Stop Tailscale Funnel on a specific public HTTPS port.
   */
  async stop(publicPort: number): Promise<void> {
    const binary = await getTailscaleBinary();
    try {
      await runExec(binary, ["funnel", `--https=${publicPort}`, "off"], {
        timeoutMs: 15_000,
      });
    } catch {
      // best-effort
    }
  }

  /**
   * Check if Tailscale Funnel is active on a given public port.
   * Checks the JSON status output for the port in the hostname key
   * (e.g., "macbook.taild2991.ts.net:8443").
   */
  async isActive(publicPort: number): Promise<boolean> {
    const binary = await getTailscaleBinary();
    try {
      const { stdout } = await runExec(binary, ["funnel", "status", "--json"], {
        timeoutMs: 5000,
      });
      // Status JSON uses keys like "hostname.ts.net:8443"
      return stdout.includes(`:${publicPort}`);
    } catch {
      return false;
    }
  }
}
