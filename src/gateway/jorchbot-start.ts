import { loadConfig } from "../config/jorchbot-config-loader.js";
import { closeDb, getDb } from "../db/index.js";
import { JorchBotError } from "../errors/index.js";

interface StartOptions {
  port?: string;
  host?: string;
}

/**
 * Start the JorchBot gateway.
 *
 * 1. Load config
 * 2. Initialize database (auto-migrate)
 * 3. Register shutdown handlers
 * 4. Log startup info
 *
 * @throws {JorchBotConfigParseError} If config is invalid
 * @throws {JorchBotDbInitError} If database fails to initialize
 * @throws {JorchBotGatewayStartError} If gateway server fails to start
 */
export async function startGateway(opts: StartOptions): Promise<void> {
  try {
    const config = loadConfig();
    const port = opts.port ? Number.parseInt(opts.port, 10) : config.gateway.port;
    const host = opts.host ?? config.gateway.host;

    // Initialize database (creates file + runs migrations)
    getDb();

    // Register graceful shutdown
    const shutdown = () => {
      console.log("[jorchbot] shutting down...");
      closeDb();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    console.log(`[jorchbot] gateway ready on ${host}:${port}`);
    console.log("[jorchbot] database initialized");
    console.log("[jorchbot] press Ctrl+C to stop");

    // Phase 0: no actual gateway server yet — just hold the process open
    // The actual OpenClaw gateway integration happens in Phase 1+
    await new Promise(() => {});
  } catch (err: unknown) {
    if (err instanceof JorchBotError) {
      console.error(`[jorchbot] ${err.name}: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}
