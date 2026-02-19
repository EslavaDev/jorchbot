import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ZodError } from "zod";
import {
  JorchBotConfigNotFoundError,
  JorchBotConfigParseError,
  JorchBotConfigValidationError,
} from "../errors/index.js";
import { JorchBotConfigSchema, type JorchBotConfig } from "./jorchbot-config.js";

function resolveConfigDir(): string {
  return process.env.JORCHBOT_CONFIG_DIR ?? join(homedir(), ".jorchbot");
}

function resolveConfigPath(): string {
  return join(resolveConfigDir(), "config.json");
}

function ensureConfigDir(dir: string): void {
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch (err: unknown) {
      throw new JorchBotConfigNotFoundError(
        `Cannot create config directory ${dir}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }
}

function writeConfigFile(filePath: string, config: JorchBotConfig): void {
  writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
  });
}

/**
 * Save JorchBot configuration to ~/.jorchbot/config.json.
 *
 * Creates the config directory if it doesn't exist.
 *
 * @throws {JorchBotConfigNotFoundError} If the config directory cannot be created
 */
export function saveConfig(config: JorchBotConfig): void {
  const configDir = resolveConfigDir();
  ensureConfigDir(configDir);
  writeConfigFile(resolveConfigPath(), config);
}

/**
 * Load JorchBot configuration from ~/.jorchbot/config.json.
 *
 * If the file doesn't exist, creates it with defaults.
 * If the file exists but is invalid, throws with a clear error.
 *
 * Respects `JORCHBOT_CONFIG_DIR` env var to override the config directory.
 *
 * @throws {JorchBotConfigNotFoundError} If the config directory cannot be created or file cannot be read
 * @throws {JorchBotConfigParseError} If the JSON is malformed
 * @throws {JorchBotConfigValidationError} If the config fails zod validation
 */
export function loadConfig(): JorchBotConfig {
  const configDir = resolveConfigDir();
  const configFile = resolveConfigPath();

  ensureConfigDir(configDir);

  if (!existsSync(configFile)) {
    const defaults = JorchBotConfigSchema.parse({});
    writeConfigFile(configFile, defaults);
    return defaults;
  }

  let raw: string;
  try {
    raw = readFileSync(configFile, "utf-8");
  } catch (err: unknown) {
    throw new JorchBotConfigNotFoundError(
      `Cannot read config file at ${configFile}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    throw new JorchBotConfigParseError(
      `Invalid JSON in ${configFile}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  try {
    return JorchBotConfigSchema.parse(parsed);
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      throw new JorchBotConfigValidationError(
        `Config validation failed in ${configFile}:\n${err.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}`,
        { cause: err },
      );
    }
    throw err;
  }
}
