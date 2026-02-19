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

  it("resolveApproval(id, true) updates DB to approved", async () => {
    await manager.requestApproval({
      toolUseId: "toolu_1",
      toolName: "Bash",
      toolInput: { command: "ls" },
    });

    const approvalId = JSON.parse(sendButtons.mock.calls[0][1][0].id).approvalId;

    const result = await manager.resolveApproval(approvalId, true);

    expect(result).toBe(true);
    expect(updateApproval).toHaveBeenCalledTimes(1);
    expect(updateApproval.mock.calls[0][1]).toBe("approved");
  });

  it("resolveApproval(id, false) updates DB to rejected", async () => {
    await manager.requestApproval({
      toolUseId: "toolu_1",
      toolName: "Edit",
      toolInput: { file_path: "/src/index.ts" },
    });

    const approvalId = JSON.parse(sendButtons.mock.calls[0][1][0].id).approvalId;

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

  it("summarizeInput shows command for Bash tool", async () => {
    await manager.requestApproval({
      toolUseId: "toolu_1",
      toolName: "Bash",
      toolInput: { command: "npm test" },
    });

    const text = sendButtons.mock.calls[0][0];
    expect(text).toContain("npm test");
  });
});
