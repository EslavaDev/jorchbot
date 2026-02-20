import fs from "node:fs";
import path from "node:path";

export interface HookConfigOptions {
  gatewayPort: number;
  hookScriptDir: string;
  sessionId: string;
  matcher?: string;
  timeout?: number;
}

/**
 * Generate Claude Code hook configuration for tool approval.
 *
 * Creates `.claude/settings.local.json` in the workspace with PreToolUse,
 * PostToolUse, and PostToolUseFailure hooks.
 */
export function generateHookConfig(options: HookConfigOptions): Record<string, unknown> {
  const matcher = options.matcher ?? "Bash|Write|Edit|NotebookEdit";
  const timeout = options.timeout ?? 600; // 10 minutes

  const approvalScript = path.join(options.hookScriptDir, "tool-approval.js");
  const resultScript = path.join(options.hookScriptDir, "tool-result.js");

  // Claude Code hooks don't support an `env` property — pass env vars inline in the command.
  const envPrefix = `JORCHBOT_ACTIVE=1 JORCHBOT_GATEWAY_PORT=${options.gatewayPort} JORCHBOT_SESSION_ID=${options.sessionId}`;

  return {
    hooks: {
      PreToolUse: [
        {
          matcher,
          hooks: [
            {
              type: "command",
              command: `${envPrefix} node ${approvalScript}`,
              timeout,
              statusMessage: "Waiting for WhatsApp approval...",
            },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher,
          hooks: [
            {
              type: "command",
              command: `${envPrefix} node ${resultScript}`,
              async: true,
            },
          ],
        },
      ],
      PostToolUseFailure: [
        {
          matcher,
          hooks: [
            {
              type: "command",
              command: `${envPrefix} node ${resultScript}`,
              async: true,
            },
          ],
        },
      ],
    },
  };
}

/**
 * Write hook configuration to the workspace's `.claude/settings.local.json`.
 * Creates the `.claude` directory if it doesn't exist.
 */
export function writeHookConfig(workspacePath: string, config: Record<string, unknown>): void {
  const claudeDir = path.join(workspacePath, ".claude");
  const settingsPath = path.join(claudeDir, "settings.local.json");

  fs.mkdirSync(claudeDir, { recursive: true });

  // Merge with existing settings if present
  let existing: Record<string, unknown> = {};
  try {
    const content = fs.readFileSync(settingsPath, "utf-8");
    existing = JSON.parse(content) as Record<string, unknown>;
  } catch {
    // No existing file — start fresh
  }

  const merged = { ...existing, ...config };
  fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2), "utf-8");
}
