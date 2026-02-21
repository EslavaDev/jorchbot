import type { ApprovalMode } from "./types.js";

/** Tools considered "write" operations that plan mode blocks. */
const WRITE_TOOLS = new Set(["Edit", "Write", "Bash", "NotebookEdit", "MultiEdit"]);

/** Tools considered "read-only" that plan mode allows. */
const READ_ONLY_TOOLS = new Set(["Read", "Grep", "Glob", "WebSearch", "WebFetch", "Task"]);

/**
 * Determine if a tool call should be auto-handled based on session mode.
 * Returns null if normal approval flow should proceed (confirm mode).
 */
export function resolveApprovalByMode(
  mode: ApprovalMode,
  toolName: string,
): { decision: "allow" | "deny"; reason?: string } | null {
  switch (mode) {
    case "auto":
      return { decision: "allow" };

    case "plan": {
      if (WRITE_TOOLS.has(toolName)) {
        return {
          decision: "deny",
          reason:
            "Plan mode is active. Create a detailed plan describing what " +
            "changes you will make and why, then present it to the user. " +
            "The user will review your plan and switch to confirm mode " +
            "for execution. Do NOT attempt to modify files until the user " +
            "approves your plan.",
        };
      }
      // Read-only tools pass through in plan mode
      return { decision: "allow" };
    }

    case "confirm":
      // Normal approval flow — hook sends buttons
      return null;
  }
}

export { READ_ONLY_TOOLS, WRITE_TOOLS };
