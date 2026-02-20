import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateHookConfig, removeHookConfig, writeHookConfig } from "./hook-config-generator.js";

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
        hookScriptDir: "/path/to/hooks",
      });

      const hooks = config.hooks as Record<string, unknown[]>;
      expect(hooks.PreToolUse).toHaveLength(1);
      expect(hooks.PostToolUse).toHaveLength(1);
      expect(hooks.PostToolUseFailure).toHaveLength(1);
    });

    it("uses default matcher for write/modify tools", () => {
      const config = generateHookConfig({
        hookScriptDir: "/path/to/hooks",
      });

      const hooks = config.hooks as Record<string, Array<{ matcher: string }>>;
      expect(hooks.PreToolUse[0].matcher).toBe("Bash|Write|Edit|NotebookEdit");
    });

    it("uses custom matcher when provided", () => {
      const config = generateHookConfig({
        hookScriptDir: "/path/to/hooks",
        matcher: "Bash|Edit",
      });

      const hooks = config.hooks as Record<string, Array<{ matcher: string }>>;
      expect(hooks.PreToolUse[0].matcher).toBe("Bash|Edit");
    });

    it("uses plain node commands without inline env vars", () => {
      const config = generateHookConfig({
        hookScriptDir: "/path/to/hooks",
      });

      const hooks = config.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>;
      const preCommand = hooks.PreToolUse[0].hooks[0].command;
      const postCommand = hooks.PostToolUse[0].hooks[0].command;
      expect(preCommand).toBe("node /path/to/hooks/tool-approval.js");
      expect(postCommand).toBe("node /path/to/hooks/tool-result.js");
    });

    it("sets 5-minute timeout for PreToolUse", () => {
      const config = generateHookConfig({
        hookScriptDir: "/path/to/hooks",
      });

      const hooks = config.hooks as Record<string, Array<{ hooks: Array<{ timeout?: number }> }>>;
      expect(hooks.PreToolUse[0].hooks[0].timeout).toBe(300);
    });

    it("PostToolUse hooks are async", () => {
      const config = generateHookConfig({
        hookScriptDir: "/path/to/hooks",
      });

      const hooks = config.hooks as Record<string, Array<{ hooks: Array<{ async?: boolean }> }>>;
      expect(hooks.PostToolUse[0].hooks[0].async).toBe(true);
      expect(hooks.PostToolUseFailure[0].hooks[0].async).toBe(true);
    });
  });

  describe("writeHookConfig", () => {
    it("creates .claude directory and settings file", () => {
      const config = generateHookConfig({
        hookScriptDir: "/path/to/hooks",
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
        hookScriptDir: "/path/to/hooks",
      });

      writeHookConfig(tempDir, config);

      const content = JSON.parse(
        fs.readFileSync(path.join(claudeDir, "settings.local.json"), "utf-8"),
      );
      expect(content.existing).toBe(true);
      expect(content.hooks).toBeDefined();
    });
  });

  describe("removeHookConfig", () => {
    it("removes hooks key from settings file", () => {
      const config = generateHookConfig({ hookScriptDir: "/path/to/hooks" });
      writeHookConfig(tempDir, config);

      removeHookConfig(tempDir);

      const settingsPath = path.join(tempDir, ".claude", "settings.local.json");
      // File should be deleted since hooks was the only key
      expect(fs.existsSync(settingsPath)).toBe(false);
    });

    it("preserves other settings when removing hooks", () => {
      const claudeDir = path.join(tempDir, ".claude");
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(
        path.join(claudeDir, "settings.local.json"),
        JSON.stringify({ existing: true, hooks: { PreToolUse: [] } }),
      );

      removeHookConfig(tempDir);

      const settingsPath = path.join(claudeDir, "settings.local.json");
      expect(fs.existsSync(settingsPath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      expect(content.existing).toBe(true);
      expect(content.hooks).toBeUndefined();
    });

    it("removes empty .claude directory after deleting settings file", () => {
      const config = generateHookConfig({ hookScriptDir: "/path/to/hooks" });
      writeHookConfig(tempDir, config);

      removeHookConfig(tempDir);

      const claudeDir = path.join(tempDir, ".claude");
      expect(fs.existsSync(claudeDir)).toBe(false);
    });

    it("keeps .claude directory if it has other files", () => {
      const config = generateHookConfig({ hookScriptDir: "/path/to/hooks" });
      writeHookConfig(tempDir, config);

      // Add another file to .claude/
      fs.writeFileSync(path.join(tempDir, ".claude", "other.json"), "{}");

      removeHookConfig(tempDir);

      const claudeDir = path.join(tempDir, ".claude");
      expect(fs.existsSync(claudeDir)).toBe(true);
      expect(fs.existsSync(path.join(claudeDir, "settings.local.json"))).toBe(false);
      expect(fs.existsSync(path.join(claudeDir, "other.json"))).toBe(true);
    });

    it("does nothing when no settings file exists", () => {
      // Should not throw
      removeHookConfig(tempDir);

      expect(fs.existsSync(path.join(tempDir, ".claude"))).toBe(false);
    });
  });
});
