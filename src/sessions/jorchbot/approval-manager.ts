import { randomUUID } from "node:crypto";
import type { ApprovalButtonPayload } from "../../../extensions/kapso/src/types.js";
import { ApprovalTimer } from "./approval-timer.js";

interface ApprovalRecord {
  id: string;
  sessionId: string;
  action: string;
  context: string;
  status: string;
  createdAt: Date;
}

export interface ApprovalManagerDeps {
  sessionId: string;
  sendButtons: (text: string, buttons: Array<{ id: string; title: string }>) => Promise<void>;
  insertApproval?: (record: ApprovalRecord) => void;
  updateApproval?: (id: string, status: string, resolvedAt: Date) => void;
  /** Reminder delay in ms. Defaults to 10 minutes. Set to 0 to disable reminders. */
  reminderDelayMs?: number;
}

interface PendingApproval {
  id: string;
  toolUseId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  createdAt: Date;
}

interface ResolvedApproval {
  status: "approved" | "denied";
  additionalContext?: string;
}

export type ApprovalStatus = "pending" | "approved" | "denied" | "awaiting_feedback";

const FEEDBACK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const DEFAULT_REMINDER_DELAY_MS = 10 * 60 * 1000; // 10 minutes

export class ApprovalManager {
  private pending = new Map<string, PendingApproval>();
  private resolved = new Map<string, ResolvedApproval>();
  private awaitingFeedback = new Map<string, string>(); // approvalId → approvalId
  private feedbackTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private reminderTimer: ApprovalTimer;
  private deps: ApprovalManagerDeps;

  constructor(deps: ApprovalManagerDeps) {
    this.deps = deps;
    const reminderDelayMs = deps.reminderDelayMs ?? DEFAULT_REMINDER_DELAY_MS;
    this.reminderTimer = new ApprovalTimer({
      reminderDelayMs,
      onReminder: (approvalId) => {
        const pending = this.pending.get(approvalId);
        if (!pending) {
          return;
        }
        const message = `[Reminder] ${this.formatToolMessage(pending.toolName, pending.toolInput)}`;
        void this.sendApprovalButtons(approvalId, message);
      },
    });
  }

  /**
   * Request approval from the user. Sends WhatsApp buttons and stores pending state.
   * Returns the approval ID for polling.
   */
  async requestApproval(request: {
    toolUseId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
  }): Promise<string> {
    const approvalId = randomUUID();
    const now = new Date();

    if (this.deps.insertApproval) {
      this.deps.insertApproval({
        id: approvalId,
        sessionId: this.deps.sessionId,
        action: `${request.toolName}: ${this.summarizeInput(request.toolInput)}`,
        context: JSON.stringify(request.toolInput),
        status: "pending",
        createdAt: now,
      });
    }

    this.pending.set(approvalId, {
      id: approvalId,
      toolUseId: request.toolUseId,
      toolName: request.toolName,
      toolInput: request.toolInput,
      createdAt: now,
    });

    const message = this.formatToolMessage(request.toolName, request.toolInput);
    await this.sendApprovalButtons(approvalId, message);

    this.reminderTimer.start(approvalId);

    return approvalId;
  }

  /**
   * Mark approval as awaiting feedback.
   * The next free-text message from the user will be captured as feedback.
   * Starts a 5-minute timeout that reverts to pending with re-sent buttons.
   */
  setAwaitingFeedback(approvalId: string): boolean {
    if (!this.pending.has(approvalId)) {
      return false;
    }
    this.awaitingFeedback.set(approvalId, approvalId);

    // Start feedback timeout
    const timer = setTimeout(() => {
      this.clearFeedbackTimeout(approvalId);
      this.awaitingFeedback.delete(approvalId);

      const pending = this.pending.get(approvalId);
      if (!pending) {
        return;
      }

      const message = `[Feedback timeout] Approval still pending.\n${this.formatToolMessage(pending.toolName, pending.toolInput)}`;
      void this.sendApprovalButtons(approvalId, message);
    }, FEEDBACK_TIMEOUT_MS);

    this.feedbackTimeouts.set(approvalId, timer);
    return true;
  }

  /**
   * Check if any approval is awaiting feedback.
   */
  getAwaitingFeedbackId(): string | null {
    const [first] = this.awaitingFeedback.keys();
    return first ?? null;
  }

  /**
   * Resolve a pending approval with optional feedback text.
   * Returns true if the approval was found and resolved.
   */
  async resolveApproval(
    approvalId: string,
    approved: boolean,
    feedback?: string,
  ): Promise<boolean> {
    const pending = this.pending.get(approvalId);
    if (!pending) {
      return false;
    }

    this.pending.delete(approvalId);
    this.awaitingFeedback.delete(approvalId);
    this.clearFeedbackTimeout(approvalId);
    this.reminderTimer.clear(approvalId);

    this.resolved.set(approvalId, {
      status: approved ? "approved" : "denied",
      additionalContext: feedback,
    });

    if (this.deps.updateApproval) {
      this.deps.updateApproval(approvalId, approved ? "approved" : "rejected", new Date());
    }

    return true;
  }

  /**
   * Get the current status of an approval. Used by the hook polling endpoint.
   * Returns null if the approval ID is not known.
   */
  getApprovalStatus(approvalId: string): {
    status: ApprovalStatus;
    additionalContext?: string;
  } | null {
    if (this.awaitingFeedback.has(approvalId)) {
      return { status: "awaiting_feedback" };
    }
    if (this.pending.has(approvalId)) {
      return { status: "pending" };
    }
    const resolved = this.resolved.get(approvalId);
    if (resolved) {
      return {
        status: resolved.status,
        additionalContext: resolved.additionalContext,
      };
    }
    return null;
  }

  hasPending(): boolean {
    return this.pending.size > 0;
  }

  /** Clear all timers. Call on session destroy. */
  dispose(): void {
    for (const timer of this.feedbackTimeouts.values()) {
      clearTimeout(timer);
    }
    this.feedbackTimeouts.clear();
    this.reminderTimer.dispose();
  }

  // --- Private helpers ---

  /** Send 3 approval buttons: Yes, Yes + feedback, No. */
  private async sendApprovalButtons(approvalId: string, message: string): Promise<void> {
    const buttonPayloadApprove: ApprovalButtonPayload = {
      sessionId: this.deps.sessionId,
      approvalId,
      action: "approve",
    };
    const feedbackPayload: ApprovalButtonPayload = {
      sessionId: this.deps.sessionId,
      approvalId,
      action: "feedback",
    };
    const buttonPayloadReject: ApprovalButtonPayload = {
      sessionId: this.deps.sessionId,
      approvalId,
      action: "reject",
    };

    await this.deps.sendButtons(message, [
      { id: JSON.stringify(buttonPayloadApprove), title: "Yes" },
      { id: JSON.stringify(feedbackPayload), title: "Yes + feedback" },
      { id: JSON.stringify(buttonPayloadReject), title: "No" },
    ]);
  }

  /** Format a tool approval message for WhatsApp. */
  private formatToolMessage(toolName: string, toolInput: Record<string, unknown>): string {
    switch (toolName) {
      case "Edit": {
        const filePath = typeof toolInput.file_path === "string" ? toolInput.file_path : "unknown";
        const oldStr = typeof toolInput.old_string === "string" ? toolInput.old_string : "";
        const newStr = typeof toolInput.new_string === "string" ? toolInput.new_string : "";
        const diff = this.formatDiff(oldStr, newStr);
        return this.truncateForWhatsApp(`Edit: ${filePath}\n\n${diff}`);
      }
      case "Write": {
        const filePath = typeof toolInput.file_path === "string" ? toolInput.file_path : "unknown";
        const content = typeof toolInput.content === "string" ? toolInput.content : "";
        const preview = content.length > 200 ? `${content.slice(0, 200)}...` : content;
        return this.truncateForWhatsApp(`Write: ${filePath}\n\n${preview}`);
      }
      case "Bash": {
        const command = typeof toolInput.command === "string" ? toolInput.command : "";
        const desc =
          typeof toolInput.description === "string" ? `\n> ${toolInput.description}` : "";
        return this.truncateForWhatsApp(`Bash: ${command}${desc}`);
      }
      case "NotebookEdit": {
        const p = typeof toolInput.notebook_path === "string" ? toolInput.notebook_path : "unknown";
        return this.truncateForWhatsApp(`NotebookEdit: ${p}`);
      }
      default: {
        const summary = this.summarizeInput(toolInput);
        return this.truncateForWhatsApp(`${toolName}: ${summary}`);
      }
    }
  }

  private formatDiff(oldStr: string, newStr: string): string {
    const oldLines = oldStr.split("\n").map((l) => `- ${l}`);
    const newLines = newStr.split("\n").map((l) => `+ ${l}`);
    return [...oldLines, ...newLines].join("\n");
  }

  private truncateForWhatsApp(text: string): string {
    const MAX_LEN = 3800; // Leave room for buttons metadata
    if (text.length <= MAX_LEN) {
      return text;
    }
    return `${text.slice(0, MAX_LEN)}...(truncated)`;
  }

  private summarizeInput(input: Record<string, unknown>): string {
    if (typeof input.command === "string") {
      const cmd = input.command;
      return cmd.length > 100 ? `${cmd.slice(0, 100)}...` : cmd;
    }

    if (typeof input.file_path === "string") {
      return input.file_path;
    }

    return JSON.stringify(input).slice(0, 100);
  }

  private clearFeedbackTimeout(approvalId: string): void {
    const timer = this.feedbackTimeouts.get(approvalId);
    if (timer) {
      clearTimeout(timer);
      this.feedbackTimeouts.delete(approvalId);
    }
  }
}
