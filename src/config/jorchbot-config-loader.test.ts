import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JorchBotConfigParseError, JorchBotConfigValidationError } from "../errors/index.js";
import { loadConfig } from "./jorchbot-config-loader.js";

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

  it("creates config.json with defaults when file does not exist", () => {
    const config = loadConfig();

    expect(config.gateway.port).toBe(18789);
    expect(config.gateway.host).toBe("127.0.0.1");

    const configPath = path.join(tempDir, "config.json");
    expect(fs.existsSync(configPath)).toBe(true);

    const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(written.gateway.port).toBe(18789);
  });

  it("loads existing valid config file", () => {
    const configPath = path.join(tempDir, "config.json");
    fs.writeFileSync(configPath, JSON.stringify({ gateway: { port: 3000 } }), "utf-8");

    const config = loadConfig();
    expect(config.gateway.port).toBe(3000);
    // Defaults fill in missing fields
    expect(config.gateway.host).toBe("127.0.0.1");
    expect(config.db.logRetentionDays).toBe(7);
  });

  it("throws JorchBotConfigParseError on malformed JSON", () => {
    const configPath = path.join(tempDir, "config.json");
    fs.writeFileSync(configPath, "{ not valid json }", "utf-8");

    expect(() => loadConfig()).toThrow(JorchBotConfigParseError);
  });

  it("throws JorchBotConfigValidationError on invalid values", () => {
    const configPath = path.join(tempDir, "config.json");
    fs.writeFileSync(configPath, JSON.stringify({ gateway: { port: -1 } }), "utf-8");

    expect(() => loadConfig()).toThrow(JorchBotConfigValidationError);
  });
});
