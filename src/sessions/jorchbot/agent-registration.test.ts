import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAgentDir, registerAgent, unregisterAgent } from "./agent-registration.js";

describe("agent-registration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jorchbot-agent-test-"));
    vi.stubEnv("JORCHBOT_STATE_DIR", tmpDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("getAgentDir resolves correct path", () => {
    const dir = getAgentDir("my-project");
    expect(dir).toBe(path.join(tmpDir, "agents", "my-project", "agent"));
  });

  it("registerAgent creates agent directory and sessions directory", () => {
    registerAgent({ project: "test-proj", projectPath: "/workspace/test-proj" });

    const agentDir = path.join(tmpDir, "agents", "test-proj", "agent");
    const sessionsDir = path.join(tmpDir, "agents", "test-proj", "sessions");

    expect(fs.existsSync(agentDir)).toBe(true);
    expect(fs.existsSync(sessionsDir)).toBe(true);
  });

  it("registerAgent writes IDENTITY.md with project info", () => {
    registerAgent({
      project: "test-proj",
      projectPath: "/workspace/test-proj",
      runnerType: "claude",
    });

    const identityPath = path.join(tmpDir, "agents", "test-proj", "agent", "IDENTITY.md");
    const content = fs.readFileSync(identityPath, "utf-8");

    expect(content).toContain("# test-proj");
    expect(content).toContain("- name: test-proj");
    expect(content).toContain("- path: /workspace/test-proj");
    expect(content).toContain("- runner: claude");
    expect(content).toContain("- created:");
  });

  it("registerAgent adds entry to jorchbot.json agents.list", () => {
    registerAgent({ project: "test-proj", projectPath: "/workspace/test-proj" });

    const configPath = path.join(tmpDir, "jorchbot.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

    expect(config.agents.list).toHaveLength(1);
    expect(config.agents.list[0].id).toBe("test-proj");
    expect(config.agents.list[0].name).toBe("test-proj");
    expect(config.agents.list[0].workspace).toBe("/workspace/test-proj");
    expect(config.agents.list[0].agentDir).toBe(getAgentDir("test-proj"));
  });

  it("registerAgent is idempotent — does not duplicate entries", () => {
    registerAgent({ project: "test-proj", projectPath: "/workspace/test-proj" });
    registerAgent({ project: "test-proj", projectPath: "/workspace/test-proj-v2" });

    const configPath = path.join(tmpDir, "jorchbot.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

    expect(config.agents.list).toHaveLength(1);
    expect(config.agents.list[0].workspace).toBe("/workspace/test-proj-v2");
  });

  it("unregisterAgent removes entry from jorchbot.json", () => {
    registerAgent({ project: "proj-a", projectPath: "/workspace/a" });
    registerAgent({ project: "proj-b", projectPath: "/workspace/b" });

    unregisterAgent("proj-a");

    const configPath = path.join(tmpDir, "jorchbot.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

    expect(config.agents.list).toHaveLength(1);
    expect(config.agents.list[0].id).toBe("proj-b");
  });

  it("unregisterAgent is safe when config has no agents section", () => {
    // No config file exists — should not throw
    expect(() => unregisterAgent("nonexistent")).not.toThrow();
  });

  it("registerAgent preserves other config keys", () => {
    const configPath = path.join(tmpDir, "jorchbot.json");
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ port: 18789, custom: "value" }), "utf-8");

    registerAgent({ project: "test-proj", projectPath: "/workspace/test-proj" });

    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(config.port).toBe(18789);
    expect(config.custom).toBe("value");
    expect(config.agents.list).toHaveLength(1);
  });
});
