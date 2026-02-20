import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Agent registration for JorchBot sessions.
 *
 * Bridges Layer 2 (SessionManager) with Layer 1 (OpenClaw agent ecosystem)
 * by creating agent directory structures, IDENTITY.md files, and registering
 * sessions in the config file's `agents.list` section.
 *
 * See docs/future_agent_runner.md for the full abstraction roadmap.
 */

export interface AgentRegistrationOptions {
  project: string;
  projectPath: string;
  runnerType?: string;
}

/**
 * Resolve the JorchBot state directory.
 * Uses JORCHBOT_STATE_DIR env or falls back to ~/.jorchbot.
 */
function resolveStateDir(): string {
  const override = process.env.JORCHBOT_STATE_DIR?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.join(os.homedir(), ".jorchbot");
}

/**
 * Get the agent directory path for a project.
 */
export function getAgentDir(project: string): string {
  return path.join(resolveStateDir(), "agents", project, "agent");
}

/**
 * Register a JorchBot session as an OpenClaw agent.
 *
 * Creates:
 * - Agent directory: ~/.jorchbot/agents/{project}/agent/
 * - Sessions directory: ~/.jorchbot/agents/{project}/sessions/
 * - IDENTITY.md with project info
 * - Entry in jorchbot.json agents.list
 */
export function registerAgent(options: AgentRegistrationOptions): void {
  const { project, projectPath, runnerType = "claude" } = options;
  const agentDir = getAgentDir(project);
  const sessionsDir = path.join(resolveStateDir(), "agents", project, "sessions");

  // Create directories
  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(sessionsDir, { recursive: true });

  // Write IDENTITY.md
  const identity = [
    `# ${project}`,
    "",
    `- name: ${project}`,
    `- path: ${projectPath}`,
    `- runner: ${runnerType}`,
    `- created: ${new Date().toISOString().split("T")[0]}`,
    "",
  ].join("\n");

  fs.writeFileSync(path.join(agentDir, "IDENTITY.md"), identity, "utf-8");

  // Register in config file
  addAgentToConfig(project, projectPath);
}

/**
 * Unregister a JorchBot session's agent entry.
 *
 * Removes the entry from jorchbot.json agents.list.
 * Does NOT delete the agent directory (preserves transcripts/history).
 */
export function unregisterAgent(project: string): void {
  removeAgentFromConfig(project);
}

interface AgentEntry {
  id: string;
  name: string;
  workspace: string;
  agentDir: string;
}

interface AgentsSection {
  list: AgentEntry[];
}

/**
 * Add an agent entry to the config file.
 * Uses atomic write (temp file + rename) to prevent corruption.
 */
function addAgentToConfig(project: string, projectPath: string): void {
  const configPath = resolveConfigPath();
  const config = readConfig(configPath);

  const agents = ensureAgentsSection(config);

  // Remove existing entry for this project (idempotent)
  agents.list = agents.list.filter((a) => a.id !== project);

  agents.list.push({
    id: project,
    name: project,
    workspace: projectPath,
    agentDir: getAgentDir(project),
  });

  writeConfigAtomic(configPath, config);
}

/**
 * Remove an agent entry from the config file.
 */
function removeAgentFromConfig(project: string): void {
  const configPath = resolveConfigPath();
  const config = readConfig(configPath);

  const raw = config.agents;
  if (!raw || typeof raw !== "object") {
    return;
  }
  const agents = raw as Record<string, unknown>;
  if (!Array.isArray(agents.list)) {
    return;
  }

  agents.list = (agents.list as AgentEntry[]).filter((a) => a.id !== project);

  writeConfigAtomic(configPath, config);
}

/** Ensure config has an `agents` section with a `list` array. */
function ensureAgentsSection(config: Record<string, unknown>): AgentsSection {
  if (!config.agents || typeof config.agents !== "object") {
    config.agents = { list: [] };
  }
  const agents = config.agents as Record<string, unknown>;
  if (!Array.isArray(agents.list)) {
    agents.list = [];
  }
  return config.agents as AgentsSection;
}

function resolveConfigPath(): string {
  const stateDir = resolveStateDir();
  return path.join(stateDir, "jorchbot.json");
}

function readConfig(configPath: string): Record<string, unknown> {
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeConfigAtomic(configPath: string, config: Record<string, unknown>): void {
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });

  const tmpPath = `${configPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), "utf-8");
  fs.renameSync(tmpPath, configPath);
}
