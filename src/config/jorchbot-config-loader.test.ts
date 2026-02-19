import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JorchBotConfigParseError, JorchBotConfigValidationError } from "../errors/index.js";
import { loadConfig, saveConfig } from "./jorchbot-config-loader.js";
import { JorchBotConfigSchema } from "./jorchbot-config.js";

describe("loadConfig", () => {
  let tempDir: string;
  const originalEnv = process.env.JORCHBOT_CONFIG_DIR;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jorchbot-config-test-"));
    process.env.JORCHBOT_CONFIG_DIR = tempDir;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.JORCHBOT_CONFIG_DIR;
    } else {
      process.env.JORCHBOT_CONFIG_DIR = originalEnv;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates jorchbot.json with defaults when nothing exists", () => {
    const config = loadConfig();

    expect(config.gateway.port).toBe(18789);
    expect(config.gateway.host).toBe("127.0.0.1");
    expect(config.sessions.maxConcurrent).toBe(5);

    const configPath = path.join(tempDir, "jorchbot.json");
    expect(fs.existsSync(configPath)).toBe(true);

    const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(written.gateway.port).toBe(18789);
    expect(written.jorchbot.sessions.maxConcurrent).toBe(5);
    // gateway should NOT be duplicated inside jorchbot key
    expect(written.jorchbot.gateway).toBeUndefined();
  });

  it("loads gateway from top-level and rest from jorchbot key", () => {
    const configPath = path.join(tempDir, "jorchbot.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        gateway: { port: 9999, host: "0.0.0.0" },
        jorchbot: {
          sessions: { maxConcurrent: 8, shellTimeout: 45_000 },
        },
      }),
    );

    const config = loadConfig();
    expect(config.gateway.port).toBe(9999);
    expect(config.gateway.host).toBe("0.0.0.0");
    expect(config.sessions.maxConcurrent).toBe(8);
    expect(config.sessions.shellTimeout).toBe(45_000);
    // Defaults for other fields
    expect(config.db.logRetentionDays).toBe(7);
  });

  it("returns defaults when jorchbot key is missing from jorchbot.json", () => {
    const configPath = path.join(tempDir, "jorchbot.json");
    fs.writeFileSync(configPath, JSON.stringify({ gateway: { port: 9999 } }));

    const config = loadConfig();
    expect(config.gateway.port).toBe(9999);
    expect(config.sessions.maxConcurrent).toBe(5);
    expect(config.db.logRetentionDays).toBe(7);
  });

  it("migrates from legacy config.json to jorchbot.json", () => {
    const legacyPath = path.join(tempDir, "config.json");
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({
        gateway: { port: 3000 },
        db: { logRetentionDays: 14 },
        channels: { kapso: { enabled: true, apiKey: "sk-legacy" } },
      }),
    );

    const config = loadConfig();
    expect(config.gateway.port).toBe(3000);
    expect(config.db.logRetentionDays).toBe(14);
    expect(config.channels.kapso.enabled).toBe(true);
    expect(config.channels.kapso.apiKey).toBe("sk-legacy");

    // Legacy file should be deleted
    expect(fs.existsSync(legacyPath)).toBe(false);

    // jorchbot.json should exist with proper structure
    const configPath = path.join(tempDir, "jorchbot.json");
    expect(fs.existsSync(configPath)).toBe(true);
    const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(written.gateway.port).toBe(3000);
    expect(written.jorchbot.db.logRetentionDays).toBe(14);
  });

  it("migrates from config.json when jorchbot.json has no jorchbot key", () => {
    const configPath = path.join(tempDir, "jorchbot.json");
    fs.writeFileSync(configPath, JSON.stringify({ agents: { someAgent: {} } }));

    const legacyPath = path.join(tempDir, "config.json");
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({ gateway: { port: 7777 }, db: { logRetentionDays: 21 } }),
    );

    const config = loadConfig();
    expect(config.gateway.port).toBe(7777);
    expect(config.db.logRetentionDays).toBe(21);

    // Legacy deleted
    expect(fs.existsSync(legacyPath)).toBe(false);

    // Other top-level keys preserved
    const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(written.agents.someAgent).toEqual({});
    expect(written.gateway.port).toBe(7777);
    expect(written.jorchbot.db.logRetentionDays).toBe(21);
  });

  it("throws JorchBotConfigParseError on malformed JSON5", () => {
    const configPath = path.join(tempDir, "jorchbot.json");
    fs.writeFileSync(configPath, "{ not valid at all !!!", "utf-8");

    expect(() => loadConfig()).toThrow(JorchBotConfigParseError);
  });

  it("throws JorchBotConfigValidationError on invalid values", () => {
    const configPath = path.join(tempDir, "jorchbot.json");
    fs.writeFileSync(configPath, JSON.stringify({ gateway: { port: -1 }, jorchbot: {} }));

    expect(() => loadConfig()).toThrow(JorchBotConfigValidationError);
  });
});

describe("saveConfig", () => {
  let tempDir: string;
  const originalEnv = process.env.JORCHBOT_CONFIG_DIR;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jorchbot-config-save-test-"));
    process.env.JORCHBOT_CONFIG_DIR = tempDir;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.JORCHBOT_CONFIG_DIR;
    } else {
      process.env.JORCHBOT_CONFIG_DIR = originalEnv;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("preserves other top-level keys when saving", () => {
    const configPath = path.join(tempDir, "jorchbot.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agents: { someAgent: {} },
        gateway: { port: 18789 },
      }),
    );

    const config = JorchBotConfigSchema.parse({ sessions: { maxConcurrent: 10 } });
    saveConfig(config);

    const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(written.agents.someAgent).toEqual({});
    expect(written.gateway.port).toBe(18789);
    expect(written.jorchbot.sessions.maxConcurrent).toBe(10);
    // gateway should not be duplicated inside jorchbot
    expect(written.jorchbot.gateway).toBeUndefined();
  });

  it("writes gateway at top-level and rest under jorchbot key", () => {
    const config = JorchBotConfigSchema.parse({
      gateway: { port: 5555 },
      sessions: { maxConcurrent: 3 },
    });
    saveConfig(config);

    const configPath = path.join(tempDir, "jorchbot.json");
    const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(written.gateway.port).toBe(5555);
    expect(written.jorchbot.sessions.maxConcurrent).toBe(3);
    expect(written.jorchbot.gateway).toBeUndefined();
  });
});
