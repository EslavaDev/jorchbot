import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalManager } from "./approval-manager.js";

type SendButtonsFn = (text: string, buttons: Array<{ id: string; title: string }>) => Promise<void>;
type InsertApprovalFn = (record: {
  id: string;
  sessionId: string;
  action: string;
  context: string;
  status: string;
  createdAt: Date;
}) => void;
type UpdateApprovalFn = (id: string, status: string, resolvedAt: Date) => void;

describe("ApprovalManager", () => {
  let manager: ApprovalManager;
  let sendButtons: ReturnType<typeof vi.fn<SendButtonsFn>>;
  let insertApproval: ReturnType<typeof vi.fn<InsertApprovalFn>>;
  let updateApproval: ReturnType<typeof vi.fn<UpdateApprovalFn>>;

  beforeEach(() => {
    vi.useFakeTimers();
    sendButtons = vi.fn<SendButtonsFn>().mockResolvedValue(undefined);
    insertApproval = vi.fn<InsertApprovalFn>();
    updateApproval = vi.fn<UpdateApprovalFn>();

    manager = new ApprovalManager({
      sessionId: "sess_123",
      sendButtons,
      insertApproval,
      updateApproval,
    });
  });

  afterEach(() => {
    manager.dispose();
    vi.useRealTimers();
  });

  it("requestApproval inserts DB record with status pending", async () => {
    await manager.requestApproval({
      toolUseId: "toolu_1",
      toolName: "Bash",
      toolInput: { command: "npm test" },
    });

    expect(insertApproval).toHaveBeenCalledTimes(1);
    const record = insertApproval.mock.calls[0][0];
    expect(record.status).toBe("pending");
    expect(record.sessionId).toBe("sess_123");
    expect(record.action).toContain("Bash");
    expect(record.action).toContain("npm test");
  });

  it("requestApproval sends 3 buttons: Yes, Yes + feedback, No", async () => {
    await manager.requestApproval({
      toolUseId: "toolu_1",
      toolName: "Bash",
      toolInput: { command: "npm test" },
    });

    expect(sendButtons).toHaveBeenCalledTimes(1);
    const [text, buttons] = sendButtons.mock.calls[0];
    expect(text).toContain("Bash");
    expect(text).toContain("npm test");
    expect(buttons).toHaveLength(3);
    expect(buttons[0].title).toBe("Yes");
    expect(buttons[1].title).toBe("Yes + feedback");
    expect(buttons[2].title).toBe("No");
  });

  it("requestApproval button payloads contain correct actions", async () => {
    await manager.requestApproval({
      toolUseId: "toolu_1",
      toolName: "Bash",
      toolInput: { command: "ls" },
    });

    const buttons = sendButtons.mock.calls[0][1];
    const approvePayload = JSON.parse(buttons[0].id) as Record<string, unknown>;
    const feedbackPayload = JSON.parse(buttons[1].id) as Record<string, unknown>;
    const rejectPayload = JSON.parse(buttons[2].id) as Record<string, unknown>;

    expect(approvePayload.action).toBe("approve");
    expect(approvePayload.sessionId).toBe("sess_123");
    expect(feedbackPayload.action).toBe("feedback");
    expect(feedbackPayload.sessionId).toBe("sess_123");
    expect(rejectPayload.action).toBe("reject");
    expect(rejectPayload.sessionId).toBe("sess_123");
  });

  it("requestApproval returns the approval ID", async () => {
    const approvalId = await manager.requestApproval({
      toolUseId: "toolu_1",
      toolName: "Bash",
      toolInput: { command: "ls" },
    });

    expect(typeof approvalId).toBe("string");
    expect(approvalId.length).toBeGreaterThan(0);
  });

  it("resolveApproval(id, true) updates DB to approved", async () => {
    const approvalId = await manager.requestApproval({
      toolUseId: "toolu_1",
      toolName: "Bash",
      toolInput: { command: "ls" },
    });

    const result = await manager.resolveApproval(approvalId, true);

    expect(result).toBe(true);
    expect(updateApproval).toHaveBeenCalledTimes(1);
    expect(updateApproval.mock.calls[0][1]).toBe("approved");
  });

  it("resolveApproval(id, false) updates DB to rejected", async () => {
    const approvalId = await manager.requestApproval({
      toolUseId: "toolu_1",
      toolName: "Edit",
      toolInput: { file_path: "/src/index.ts" },
    });

    const result = await manager.resolveApproval(approvalId, false);

    expect(result).toBe(true);
    expect(updateApproval).toHaveBeenCalledTimes(1);
    expect(updateApproval.mock.calls[0][1]).toBe("rejected");
  });

  it("resolveApproval returns false for nonexistent ID", async () => {
    const result = await manager.resolveApproval("nonexistent-id", true);
    expect(result).toBe(false);
  });

  it("hasPending returns true after requestApproval", async () => {
    expect(manager.hasPending()).toBe(false);

    await manager.requestApproval({
      toolUseId: "toolu_1",
      toolName: "Bash",
      toolInput: { command: "ls" },
    });

    expect(manager.hasPending()).toBe(true);
  });

  describe("getApprovalStatus", () => {
    it("returns pending for unresolved approval", async () => {
      const approvalId = await manager.requestApproval({
        toolUseId: "toolu_1",
        toolName: "Bash",
        toolInput: { command: "ls" },
      });

      const result = manager.getApprovalStatus(approvalId);
      expect(result).toStrictEqual({ status: "pending" });
    });

    it("returns approved after approval", async () => {
      const approvalId = await manager.requestApproval({
        toolUseId: "toolu_1",
        toolName: "Bash",
        toolInput: { command: "ls" },
      });

      await manager.resolveApproval(approvalId, true);

      const result = manager.getApprovalStatus(approvalId);
      expect(result).toStrictEqual({ status: "approved", additionalContext: undefined });
    });

    it("returns denied after rejection", async () => {
      const approvalId = await manager.requestApproval({
        toolUseId: "toolu_1",
        toolName: "Edit",
        toolInput: { file_path: "src/main.ts" },
      });

      await manager.resolveApproval(approvalId, false);

      const result = manager.getApprovalStatus(approvalId);
      expect(result).toStrictEqual({ status: "denied", additionalContext: undefined });
    });

    it("returns null for unknown ID", () => {
      expect(manager.getApprovalStatus("unknown")).toBeNull();
    });

    it("returns additionalContext when resolved with feedback", async () => {
      const approvalId = await manager.requestApproval({
        toolUseId: "toolu_1",
        toolName: "Bash",
        toolInput: { command: "ls" },
      });

      await manager.resolveApproval(approvalId, true, "Use Zod instead of regex");

      const result = manager.getApprovalStatus(approvalId);
      expect(result).toStrictEqual({
        status: "approved",
        additionalContext: "Use Zod instead of regex",
      });
    });

    it("returns awaiting_feedback when feedback is pending", async () => {
      const approvalId = await manager.requestApproval({
        toolUseId: "toolu_1",
        toolName: "Edit",
        toolInput: { file_path: "src/main.ts" },
      });

      manager.setAwaitingFeedback(approvalId);

      const result = manager.getApprovalStatus(approvalId);
      expect(result).toStrictEqual({ status: "awaiting_feedback" });
    });
  });

  describe("feedback flow", () => {
    it("setAwaitingFeedback returns true for pending approval", async () => {
      const approvalId = await manager.requestApproval({
        toolUseId: "toolu_1",
        toolName: "Bash",
        toolInput: { command: "ls" },
      });

      expect(manager.setAwaitingFeedback(approvalId)).toBe(true);
    });

    it("setAwaitingFeedback returns false for unknown approval", () => {
      expect(manager.setAwaitingFeedback("unknown")).toBe(false);
    });

    it("getAwaitingFeedbackId returns null when no approval is awaiting", () => {
      expect(manager.getAwaitingFeedbackId()).toBeNull();
    });

    it("getAwaitingFeedbackId returns the approval ID when awaiting", async () => {
      const approvalId = await manager.requestApproval({
        toolUseId: "toolu_1",
        toolName: "Bash",
        toolInput: { command: "ls" },
      });

      manager.setAwaitingFeedback(approvalId);

      expect(manager.getAwaitingFeedbackId()).toBe(approvalId);
    });

    it("resolveApproval clears awaiting feedback state", async () => {
      const approvalId = await manager.requestApproval({
        toolUseId: "toolu_1",
        toolName: "Bash",
        toolInput: { command: "ls" },
      });

      manager.setAwaitingFeedback(approvalId);
      expect(manager.getAwaitingFeedbackId()).toBe(approvalId);

      await manager.resolveApproval(approvalId, true, "some feedback");

      expect(manager.getAwaitingFeedbackId()).toBeNull();
    });

    it("feedback timeout re-sends buttons after 5 minutes", async () => {
      const approvalId = await manager.requestApproval({
        toolUseId: "toolu_1",
        toolName: "Bash",
        toolInput: { command: "npm test" },
      });

      // Initial requestApproval sends buttons once
      expect(sendButtons).toHaveBeenCalledTimes(1);

      manager.setAwaitingFeedback(approvalId);

      // Advance time by 5 minutes
      vi.advanceTimersByTime(5 * 60 * 1000);

      // Buttons should be re-sent with timeout message
      expect(sendButtons).toHaveBeenCalledTimes(2);
      const [text, buttons] = sendButtons.mock.calls[1];
      expect(text).toContain("[Feedback timeout]");
      expect(text).toContain("Approval still pending");
      expect(buttons).toHaveLength(3);

      // Awaiting feedback state should be cleared
      expect(manager.getAwaitingFeedbackId()).toBeNull();
      // But the approval is still pending (not resolved)
      const status = manager.getApprovalStatus(approvalId);
      expect(status).toStrictEqual({ status: "pending" });
    });

    it("resolveApproval cancels feedback timeout", async () => {
      const approvalId = await manager.requestApproval({
        toolUseId: "toolu_1",
        toolName: "Bash",
        toolInput: { command: "ls" },
      });

      manager.setAwaitingFeedback(approvalId);
      await manager.resolveApproval(approvalId, true, "my feedback");

      // Advance time — timeout should NOT fire
      vi.advanceTimersByTime(5 * 60 * 1000);

      // Only the initial requestApproval call, no re-send
      expect(sendButtons).toHaveBeenCalledTimes(1);
    });

    it("dispose clears all feedback timeouts", async () => {
      const id1 = await manager.requestApproval({
        toolUseId: "toolu_1",
        toolName: "Bash",
        toolInput: { command: "ls" },
      });
      const id2 = await manager.requestApproval({
        toolUseId: "toolu_2",
        toolName: "Edit",
        toolInput: { file_path: "src/main.ts" },
      });

      manager.setAwaitingFeedback(id1);
      manager.setAwaitingFeedback(id2);
      manager.dispose();

      // Advance time — timeouts should NOT fire
      vi.advanceTimersByTime(5 * 60 * 1000);

      // Only the 2 initial requestApproval calls, no re-sends
      expect(sendButtons).toHaveBeenCalledTimes(2);
    });
  });

  describe("tool message formatting", () => {
    it("formats Edit tool with diff", async () => {
      await manager.requestApproval({
        toolUseId: "toolu_1",
        toolName: "Edit",
        toolInput: {
          file_path: "src/main.ts",
          old_string: "const port = 3000;",
          new_string: "const port = process.env.PORT ?? 3000;",
        },
      });

      const text = sendButtons.mock.calls[0][0];
      expect(text).toContain("Edit: src/main.ts");
      expect(text).toContain("- const port = 3000;");
      expect(text).toContain("+ const port = process.env.PORT ?? 3000;");
    });

    it("formats Bash tool with command", async () => {
      await manager.requestApproval({
        toolUseId: "toolu_1",
        toolName: "Bash",
        toolInput: { command: "pnpm test", description: "Run test suite" },
      });

      const text = sendButtons.mock.calls[0][0];
      expect(text).toContain("Bash: pnpm test");
      expect(text).toContain("Run test suite");
    });

    it("formats Write tool with file path", async () => {
      await manager.requestApproval({
        toolUseId: "toolu_1",
        toolName: "Write",
        toolInput: { file_path: "new-file.ts", content: "export const x = 1;" },
      });

      const text = sendButtons.mock.calls[0][0];
      expect(text).toContain("Write: new-file.ts");
      expect(text).toContain("export const x = 1;");
    });
  });
});
