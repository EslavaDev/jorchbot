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

interface ApprovalManagerDeps {
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

export class ApprovalManager {
  private pending = new Map<string, PendingApproval>();
  private deps: ApprovalManagerDeps;

  constructor(deps: ApprovalManagerDeps) {
    this.deps = deps;
  }

  async requestApproval(request: {
    toolUseId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
  }): Promise<void> {
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

    const actionSummary = this.summarizeInput(request.toolInput);
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

    await this.deps.sendButtons(
      `Claude wants to execute:\n> ${request.toolName}: ${actionSummary}`,
      [
        { id: JSON.stringify(buttonPayloadApprove), title: "Yes" },
        { id: JSON.stringify(buttonPayloadReject), title: "No" },
      ],
    );
  }

  async resolveApproval(approvalId: string, approved: boolean): Promise<boolean> {
    const pending = this.pending.get(approvalId);
    if (!pending) {
      return false;
    }

    if (this.deps.updateApproval) {
      this.deps.updateApproval(approvalId, approved ? "approved" : "rejected", new Date());
    }

    this.pending.delete(approvalId);

    return true;
  }

  hasPending(): boolean {
    return this.pending.size > 0;
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
