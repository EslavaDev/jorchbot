import { loadConfig } from "../config/jorchbot-config-loader.js";

/**
 * Show JorchBot gateway status.
 *
 * Phase 0: Shows config info. Full gateway probe comes in later phases.
 */
export async function showStatus(): Promise<void> {
  try {
    const config = loadConfig();
    console.log("[jorchbot] status: stopped");
    console.log(`[jorchbot] config port: ${config.gateway.port}`);
    console.log(`[jorchbot] config host: ${config.gateway.host}`);
    console.log(`[jorchbot] db path: ${config.db.path}`);
  } catch {
    console.log("[jorchbot] status: not configured");
  }
}
