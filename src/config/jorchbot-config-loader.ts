import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import JSON5 from "json5";
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

/** Path to the consolidated config: jorchbot.json (single file). */
function resolveConfigPath(): string {
  return join(resolveConfigDir(), "jorchbot.json");
}

/** Path to the legacy Layer 2 config: config.json (Phase 1). */
function resolveLegacyConfigPath(): string {
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

/**
 * Save JorchBot configuration to ~/.jorchbot/jorchbot.json.
 *
 * `gateway` is written at the top-level (Layer 1 convention).
 * Everything else is written under the `jorchbot` key (Layer 2).
 * Other top-level keys (agents, channels plugin configs, etc.) are preserved.
 *
 * @throws {JorchBotConfigNotFoundError} If the config directory cannot be created
 */
export function saveConfig(config: JorchBotConfig): void {
  const configDir = resolveConfigDir();
  ensureConfigDir(configDir);
  const configPath = resolveConfigPath();

  let existing: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf-8");
      existing = JSON5.parse(raw);
    } catch {
      // If existing file can't be parsed, start fresh
    }
  }

  // gateway → top-level, rest → jorchbot key
  const { gateway, ...jorchbotSection } = config;
  existing.gateway = gateway;
  existing.jorchbot = jorchbotSection;

  writeFileSync(configPath, JSON.stringify(existing, null, 2) + "\n", {
    mode: 0o600,
  });
}

/**
 * Load JorchBot configuration from ~/.jorchbot/jorchbot.json.
 *
 * Assembles the config from two locations in the file:
 * - `gateway` from the top-level (Layer 1)
 * - everything else from the `jorchbot` key (Layer 2)
 *
 * Migration: if jorchbot.json doesn't exist but legacy config.json does,
 * migrates it into jorchbot.json and deletes config.json.
 *
 * Respects `JORCHBOT_CONFIG_DIR` env var to override the config directory.
 *
 * @throws {JorchBotConfigNotFoundError} If the config directory cannot be created
 * @throws {JorchBotConfigParseError} If JSON5 parsing fails
 * @throws {JorchBotConfigValidationError} If Zod validation fails
 */
export function loadConfig(): JorchBotConfig {
  const configDir = resolveConfigDir();
  const configPath = resolveConfigPath();
  const legacyPath = resolveLegacyConfigPath();

  ensureConfigDir(configDir);

  // Case 1: jorchbot.json exists
  if (existsSync(configPath)) {
    const fullParsed = readAndParseJson5(configPath);

    // Check if jorchbot key exists, or fall back to legacy migration
    const jorchbotRaw = fullParsed.jorchbot as Record<string, unknown> | undefined;
    if (jorchbotRaw !== undefined) {
      // Assemble: gateway from top-level + rest from jorchbot key
      const assembled = {
        gateway: fullParsed.gateway ?? {},
        ...jorchbotRaw,
      };
      return validateConfig(assembled, configPath);
    }

    // No jorchbot key — check for legacy config.json
    if (existsSync(legacyPath)) {
      const legacyConfig = loadLegacyConfig(legacyPath);
      // Migrate into jorchbot.json
      const { gateway, ...jorchbotSection } = legacyConfig;
      fullParsed.gateway = gateway;
      fullParsed.jorchbot = jorchbotSection;
      writeFileSync(configPath, JSON.stringify(fullParsed, null, 2) + "\n", { mode: 0o600 });
      try {
        unlinkSync(legacyPath);
      } catch {
        // Best-effort delete
      }
      return legacyConfig;
    }

    // No jorchbot key and no legacy — assemble from top-level gateway + defaults
    const assembled = { gateway: fullParsed.gateway ?? {} };
    return validateConfig(assembled, configPath);
  }

  // Case 2: No jorchbot.json — check for legacy config.json
  if (existsSync(legacyPath)) {
    const legacyConfig = loadLegacyConfig(legacyPath);
    // Write as consolidated jorchbot.json
    const { gateway, ...jorchbotSection } = legacyConfig;
    const consolidated: Record<string, unknown> = { gateway, jorchbot: jorchbotSection };
    writeFileSync(configPath, JSON.stringify(consolidated, null, 2) + "\n", { mode: 0o600 });
    try {
      unlinkSync(legacyPath);
    } catch {
      // Best-effort delete
    }
    return legacyConfig;
  }

  // Case 3: Nothing exists — create with defaults
  const defaults = JorchBotConfigSchema.parse({});
  const { gateway, ...jorchbotSection } = defaults;
  const consolidated: Record<string, unknown> = { gateway, jorchbot: jorchbotSection };
  writeFileSync(configPath, JSON.stringify(consolidated, null, 2) + "\n", { mode: 0o600 });
  return defaults;
}

function readAndParseJson5(filePath: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err: unknown) {
    throw new JorchBotConfigNotFoundError(
      `Cannot read config file at ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  try {
    return JSON5.parse(raw);
  } catch (err: unknown) {
    throw new JorchBotConfigParseError(
      `Failed to parse config as JSON5: ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

function loadLegacyConfig(legacyPath: string): JorchBotConfig {
  let raw: string;
  try {
    raw = readFileSync(legacyPath, "utf-8");
  } catch (err: unknown) {
    throw new JorchBotConfigNotFoundError(
      `Cannot read legacy config at ${legacyPath}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    throw new JorchBotConfigParseError(
      `Invalid JSON in legacy config ${legacyPath}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  return validateConfig(parsed as Record<string, unknown>, legacyPath);
}

function validateConfig(data: Record<string, unknown>, filePath: string): JorchBotConfig {
  try {
    return JorchBotConfigSchema.parse(data);
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      throw new JorchBotConfigValidationError(
        `Config validation failed in ${filePath}:\n${err.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}`,
        { cause: err },
      );
    }
    throw err;
  }
}
