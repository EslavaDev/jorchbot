import { describe, expect, it, vi, beforeEach } from "vitest";
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

  it("requestApproval calls sendButtons with correct format", async () => {
    await manager.requestApproval({
      toolUseId: "toolu_1",
      toolName: "Bash",
      toolInput: { command: "npm test" },
    });

    expect(sendButtons).toHaveBeenCalledTimes(1);
    const [text, buttons] = sendButtons.mock.calls[0];
    expect(text).toContain("Bash");
    expect(text).toContain("npm test");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].title).toBe("Yes");
    expect(buttons[1].title).toBe("No");
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
    it("returns 'pending' for unresolved approval", async () => {
      const approvalId = await manager.requestApproval({
        toolUseId: "toolu_1",
        toolName: "Bash",
        toolInput: { command: "ls" },
      });

      expect(manager.getApprovalStatus(approvalId)).toBe("pending");
    });

    it("returns 'approved' after approval", async () => {
      const approvalId = await manager.requestApproval({
        toolUseId: "toolu_1",
        toolName: "Bash",
        toolInput: { command: "ls" },
      });

      await manager.resolveApproval(approvalId, true);

      expect(manager.getApprovalStatus(approvalId)).toBe("approved");
    });

    it("returns 'denied' after rejection", async () => {
      const approvalId = await manager.requestApproval({
        toolUseId: "toolu_1",
        toolName: "Edit",
        toolInput: { file_path: "src/main.ts" },
      });

      await manager.resolveApproval(approvalId, false);

      expect(manager.getApprovalStatus(approvalId)).toBe("denied");
    });

    it("returns null for unknown ID", () => {
      expect(manager.getApprovalStatus("unknown")).toBeNull();
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
