import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateHookConfig, writeHookConfig } from "./hook-config-generator.js";

describe("hook-config-generator", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jorchbot-hooks-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("generateHookConfig", () => {
    it("generates PreToolUse, PostToolUse, PostToolUseFailure hooks", () => {
      const config = generateHookConfig({
        gatewayPort: 18789,
        hookScriptDir: "/path/to/hooks",
        sessionId: "sess_123",
      });

      const hooks = config.hooks as Record<string, unknown[]>;
      expect(hooks.PreToolUse).toHaveLength(1);
      expect(hooks.PostToolUse).toHaveLength(1);
      expect(hooks.PostToolUseFailure).toHaveLength(1);
    });

    it("uses default matcher for write/modify tools", () => {
      const config = generateHookConfig({
        gatewayPort: 18789,
        hookScriptDir: "/path/to/hooks",
        sessionId: "sess_123",
      });

      const hooks = config.hooks as Record<string, Array<{ matcher: string }>>;
      expect(hooks.PreToolUse[0].matcher).toBe("Bash|Write|Edit|NotebookEdit");
    });

    it("uses custom matcher when provided", () => {
      const config = generateHookConfig({
        gatewayPort: 18789,
        hookScriptDir: "/path/to/hooks",
        sessionId: "sess_123",
        matcher: "Bash|Edit",
      });

      const hooks = config.hooks as Record<string, Array<{ matcher: string }>>;
      expect(hooks.PreToolUse[0].matcher).toBe("Bash|Edit");
    });

    it("includes env vars inline in hook command strings", () => {
      const config = generateHookConfig({
        gatewayPort: 3000,
        hookScriptDir: "/path/to/hooks",
        sessionId: "sess_abc",
      });

      const hooks = config.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>;
      const command = hooks.PreToolUse[0].hooks[0].command;
      expect(command).toContain("JORCHBOT_GATEWAY_PORT=3000");
      expect(command).toContain("JORCHBOT_SESSION_ID=sess_abc");
      expect(command).toContain("node /path/to/hooks/tool-approval.js");
    });

    it("sets 10-minute timeout for PreToolUse", () => {
      const config = generateHookConfig({
        gatewayPort: 18789,
        hookScriptDir: "/path/to/hooks",
        sessionId: "sess_123",
      });

      const hooks = config.hooks as Record<string, Array<{ hooks: Array<{ timeout?: number }> }>>;
      expect(hooks.PreToolUse[0].hooks[0].timeout).toBe(600);
    });

    it("PostToolUse hooks are async", () => {
      const config = generateHookConfig({
        gatewayPort: 18789,
        hookScriptDir: "/path/to/hooks",
        sessionId: "sess_123",
      });

      const hooks = config.hooks as Record<string, Array<{ hooks: Array<{ async?: boolean }> }>>;
      expect(hooks.PostToolUse[0].hooks[0].async).toBe(true);
      expect(hooks.PostToolUseFailure[0].hooks[0].async).toBe(true);
    });
  });

  describe("writeHookConfig", () => {
    it("creates .claude directory and settings file", () => {
      const config = generateHookConfig({
        gatewayPort: 18789,
        hookScriptDir: "/path/to/hooks",
        sessionId: "sess_123",
      });

      writeHookConfig(tempDir, config);

      const settingsPath = path.join(tempDir, ".claude", "settings.local.json");
      expect(fs.existsSync(settingsPath)).toBe(true);

      const content = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      expect(content.hooks).toBeDefined();
    });

    it("merges with existing settings", () => {
      const claudeDir = path.join(tempDir, ".claude");
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(
        path.join(claudeDir, "settings.local.json"),
        JSON.stringify({ existing: true }),
      );

      const config = generateHookConfig({
        gatewayPort: 18789,
        hookScriptDir: "/path/to/hooks",
        sessionId: "sess_123",
      });

      writeHookConfig(tempDir, config);

      const content = JSON.parse(
        fs.readFileSync(path.join(claudeDir, "settings.local.json"), "utf-8"),
      );
      expect(content.existing).toBe(true);
      expect(content.hooks).toBeDefined();
    });
  });
});
