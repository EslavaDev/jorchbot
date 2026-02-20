import { randomUUID } from "node:crypto";
import type { ApprovalButtonPayload } from "../../../extensions/kapso/src/types.js";

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
}

interface PendingApproval {
  id: string;
  toolUseId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  createdAt: Date;
}

export type ApprovalStatus = "pending" | "approved" | "denied";

export class ApprovalManager {
  private pending = new Map<string, PendingApproval>();
  private resolved = new Map<string, ApprovalStatus>();
  private deps: ApprovalManagerDeps;

  constructor(deps: ApprovalManagerDeps) {
    this.deps = deps;
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
    const buttonPayloadApprove: ApprovalButtonPayload = {
      sessionId: this.deps.sessionId,
      approvalId,
      action: "approve",
    };
    const buttonPayloadReject: ApprovalButtonPayload = {
      sessionId: this.deps.sessionId,
      approvalId,
      action: "reject",
    };

    await this.deps.sendButtons(message, [
      { id: JSON.stringify(buttonPayloadApprove), title: "Yes" },
      { id: JSON.stringify(buttonPayloadReject), title: "No" },
    ]);

    return approvalId;
  }

  /**
   * Resolve a pending approval. Returns true if the approval was found and resolved.
   */
  async resolveApproval(approvalId: string, approved: boolean): Promise<boolean> {
    const pending = this.pending.get(approvalId);
    if (!pending) {
      return false;
    }

    if (this.deps.updateApproval) {
      this.deps.updateApproval(approvalId, approved ? "approved" : "rejected", new Date());
    }

    this.pending.delete(approvalId);
    this.resolved.set(approvalId, approved ? "approved" : "denied");

    return true;
  }

  /**
   * Get the current status of an approval. Used by the hook polling endpoint.
   * Returns null if the approval ID is not known.
   */
  getApprovalStatus(approvalId: string): ApprovalStatus | null {
    if (this.pending.has(approvalId)) {
      return "pending";
    }
    return this.resolved.get(approvalId) ?? null;
  }

  hasPending(): boolean {
    return this.pending.size > 0;
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
        const path =
          typeof toolInput.notebook_path === "string" ? toolInput.notebook_path : "unknown";
        return this.truncateForWhatsApp(`NotebookEdit: ${path}`);
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
}
