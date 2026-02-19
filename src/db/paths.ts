import { homedir } from "node:os";
import { join } from "node:path";

const JORCHBOT_DIR = ".jorchbot";
const DB_FILENAME = "jorchbot.db";

/**
 * Resolve the absolute path to the SQLite database file.
 * Default: ~/.jorchbot/jorchbot.db
 * Override: JORCHBOT_DB_PATH environment variable
 */
export function resolveDbPath(): string {
  if (process.env.JORCHBOT_DB_PATH) {
    return process.env.JORCHBOT_DB_PATH;
  }
  return join(homedir(), JORCHBOT_DIR, DB_FILENAME);
}
