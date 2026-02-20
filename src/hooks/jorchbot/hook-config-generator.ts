import fs from "node:fs";
import path from "node:path";

export interface HookConfigOptions {
  hookScriptDir: string;
  matcher?: string;
  timeout?: number;
}

/**
 * Generate Claude Code hook configuration for tool approval.
 *
 * Creates `.claude/settings.local.json` in the workspace with PreToolUse,
 * PostToolUse, and PostToolUseFailure hooks.
 *
 * The hook scripts rely on environment variables inherited from the parent
 * Claude Code process (set by ClaudeRunner):
 * - JORCHBOT_ACTIVE — present only in JorchBot-spawned instances
 * - JORCHBOT_SESSION_ID — routes approvals to the correct session
 * - JORCHBOT_GATEWAY_PORT — gateway endpoint
 *
 * Non-JorchBot Claude sessions won't have JORCHBOT_ACTIVE, so the hook
 * scripts exit immediately (no-op).
 */
export function generateHookConfig(options: HookConfigOptions): Record<string, unknown> {
  const matcher = options.matcher ?? "Bash|Write|Edit|NotebookEdit";
  const timeout = options.timeout ?? 300; // 5 minutes

  const approvalScript = path.join(options.hookScriptDir, "tool-approval.js");
  const resultScript = path.join(options.hookScriptDir, "tool-result.js");

  return {
    hooks: {
      PreToolUse: [
        {
          matcher,
          hooks: [
            {
              type: "command",
              command: `node ${approvalScript}`,
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
              command: `node ${resultScript}`,
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
              command: `node ${resultScript}`,
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

/**
 * Remove JorchBot hook configuration from the workspace's `.claude/settings.local.json`.
 *
 * Removes only the `hooks` key — preserves any other settings in the file.
 * If the file becomes empty (`{}`), it is deleted along with the `.claude` directory
 * (only if the directory is empty).
 */
export function removeHookConfig(workspacePath: string): void {
  const claudeDir = path.join(workspacePath, ".claude");
  const settingsPath = path.join(claudeDir, "settings.local.json");

  if (!fs.existsSync(settingsPath)) {
    return;
  }

  let existing: Record<string, unknown> = {};
  try {
    const content = fs.readFileSync(settingsPath, "utf-8");
    existing = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return;
  }

  delete existing.hooks;

  if (Object.keys(existing).length === 0) {
    // File is empty — remove it
    fs.unlinkSync(settingsPath);
    // Remove .claude dir if empty (best-effort)
    try {
      fs.rmdirSync(claudeDir);
    } catch {
      // Directory not empty — that's fine
    }
  } else {
    // Other settings remain — write back without hooks
    fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2), "utf-8");
  }
}
