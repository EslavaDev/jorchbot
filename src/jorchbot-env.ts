/**
 * JorchBot environment variable aliasing.
 *
 * This module MUST be imported as the very first import in `src/entry.ts`
 * (before any OpenClaw module that reads `process.env`). It maps user-facing
 * `JORCHBOT_*` env vars to their `OPENCLAW_*` counterparts so the OpenClaw
 * internals work transparently while users never see "openclaw" in their
 * environment.
 *
 * It also sets the default state directory to `~/.jorchbot` so all config,
 * logs, sessions, and credentials live under a JorchBot-branded path.
 *
 * IMPORTANT: This file must NOT import anything that transitively loads
 * `src/config/paths.ts` — only `node:os` and `node:path` are safe here.
 */
import os from "node:os";
import path from "node:path";

/**
 * Map of user-facing JORCHBOT_* env vars → internal OPENCLAW_* env vars.
 *
 * JORCHBOT_* takes precedence: if both JORCHBOT_X and OPENCLAW_X are set,
 * JORCHBOT_X wins (overwrites OPENCLAW_X).
 */
const ENV_ALIASES: ReadonlyArray<readonly [jorchbot: string, openclaw: string]> = [
  // Paths & directories
  ["JORCHBOT_HOME", "OPENCLAW_HOME"],
  ["JORCHBOT_STATE_DIR", "OPENCLAW_STATE_DIR"],
  ["JORCHBOT_CONFIG_PATH", "OPENCLAW_CONFIG_PATH"],
  ["JORCHBOT_OAUTH_DIR", "OPENCLAW_OAUTH_DIR"],

  // Gateway
  ["JORCHBOT_GATEWAY_PORT", "OPENCLAW_GATEWAY_PORT"],
  ["JORCHBOT_GATEWAY_TOKEN", "OPENCLAW_GATEWAY_TOKEN"],
  ["JORCHBOT_GATEWAY_PASSWORD", "OPENCLAW_GATEWAY_PASSWORD"],

  // Process control
  ["JORCHBOT_NO_RESPAWN", "OPENCLAW_NO_RESPAWN"],
] as const;

for (const [jb, oc] of ENV_ALIASES) {
  const jbValue = process.env[jb]?.trim();
  if (jbValue) {
    process.env[oc] = jbValue;
  }
}

// Default state dir: ~/.jorchbot (only if neither JORCHBOT_STATE_DIR nor
// OPENCLAW_STATE_DIR was explicitly set by the user).
if (!process.env.OPENCLAW_STATE_DIR) {
  process.env.OPENCLAW_STATE_DIR = path.join(os.homedir(), ".jorchbot");
}
