import type { OutputMode } from "./types.js";

/**
 * Event types emitted by ClaudeRunner that the SessionManager processes.
 */
export type RunnerEventType = "text" | "toolUse" | "result" | "error";

/**
 * Determine if a runner event should be sent to WhatsApp based on output mode.
 *
 * Events that are NOT sent to WhatsApp are still logged to the DB.
 * Approval requests bypass this filter entirely (handled separately).
 */
export function shouldSendToChat(eventType: RunnerEventType, mode: OutputMode): boolean {
  switch (mode) {
    case "verbose":
      return true;

    case "summary":
      // Only result and error
      return eventType === "result" || eventType === "error";

    case "silent":
      // Only result and error (approvals bypass this filter)
      return eventType === "result" || eventType === "error";
  }
}
