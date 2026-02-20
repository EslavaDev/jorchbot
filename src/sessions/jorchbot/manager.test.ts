import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb } from "../../db/index.js";
import {
  SessionAlreadyExistsError,
  SessionLimitError,
  SessionNotFoundError,
} from "../../errors/index.js";
import type { ClaudeRunner, ClaudeRunnerStatus } from "./claude-runner.js";
import { SessionManager } from "./manager.js";

// --- Mock ClaudeRunner ---

const PHONE_A = "+1111111";
const PHONE_B = "+2222222";

interface ClaudeRunnerEvents {
  text: [text: string];
  toolUse: [request: { toolUseId: string; toolName: string; toolInput: Record<string, unknown> }];
  result: [
    result: {
      sessionId: string;
      textContent: string;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      durationMs: number;
    },
  ];
  error: [error: Error];
}

class MockClaudeRunner extends EventEmitter<ClaudeRunnerEvents> {
  private sessionId: string | null = null;
  private status: ClaudeRunnerStatus = "idle";
  contextPercent = 0;
  inputTokens = 0;
  outputTokens = 0;
  private _contextLimit = 200_000;

  getSessionId(): string | null {
    return this.sessionId;
  }

  getStatus(): ClaudeRunnerStatus {
    return this.status;
  }

  getContextPercent(): number {
    return this.contextPercent;
  }

  getContextLimit(): number {
    return this._contextLimit;
  }

  getTokenCounts(): { input: number; output: number } {
    return { input: this.inputTokens, output: this.outputTokens };
  }

  setContextState(percent: number, inputTokens: number, outputTokens: number): void {
    this.contextPercent = percent;
    this.inputTokens = inputTokens;
    this.outputTokens = outputTokens;
  }

  setEnv(_env: Record<string, string>): void {
    // no-op in tests
  }

  async start(): Promise<{
    sessionId: string;
    textContent: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    durationMs: number;
  }> {
    this.sessionId = "mock-session-id";
    this.status = "running";
    return {
      sessionId: "mock-session-id",
      textContent: "",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      durationMs: 0,
    };
  }

  async resume(): Promise<{
    sessionId: string;
    textContent: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    durationMs: number;
  }> {
    return {
      sessionId: this.sessionId ?? "",
      textContent: "",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      durationMs: 0,
    };
  }

  async stop(): Promise<void> {
    this.status = "stopped";
  }
}

// --- Test helpers ---

function createTestManager(opts?: { maxSessions?: number }) {
  const sendReplyTo = vi
    .fn<(phone: string, text: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  const sendButtonsTo = vi
    .fn<
      (phone: string, text: string, buttons: Array<{ id: string; title: string }>) => Promise<void>
    >()
    .mockResolvedValue(undefined);
  const sendListTo = vi
    .fn<
      (
        phone: string,
        text: string,
        buttonText: string,
        options: Array<{ id: string; title: string; description?: string }>,
      ) => Promise<void>
    >()
    .mockResolvedValue(undefined);

  let lastRunner: MockClaudeRunner | null = null;

  const manager = new SessionManager({
    maxSessions: opts?.maxSessions,
    sendReplyTo,
    sendButtonsTo,
    sendListTo,
    createRunner: () => {
      lastRunner = new MockClaudeRunner();
      return lastRunner as unknown as ClaudeRunner;
    },
  });

  return { manager, sendReplyTo, sendButtonsTo, sendListTo, getLastRunner: () => lastRunner };
}

describe("SessionManager", () => {
  let tempDir: string;
  const originalDbPath = process.env.JORCHBOT_DB_PATH;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jorchbot-manager-test-"));
    process.env.JORCHBOT_DB_PATH = path.join(tempDir, "test.db");
  });

  afterEach(() => {
    closeDb();
    if (originalDbPath === undefined) {
      delete process.env.JORCHBOT_DB_PATH;
    } else {
      process.env.JORCHBOT_DB_PATH = originalDbPath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("create()", () => {
    it("creates a session with DB record and runner", async () => {
      const { manager } = createTestManager();
      const session = await manager.create({ project: "frontend", path: "/tmp/frontend" }, PHONE_A);

      expect(session.project).toBe("frontend");
      expect(session.status).toBe("active");
      expect(session.ownerPhone).toBe(PHONE_A);
      expect(session.contextPercent).toBe(0);
    });

    it("auto-focuses the first session created for an owner", async () => {
      const { manager } = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" }, PHONE_A);

      const focused = manager.getFocused(PHONE_A);
      expect(focused).not.toBeNull();
      expect(focused!.project).toBe("frontend");

      // DB should also reflect focused state
      const records = manager.listActive(PHONE_A);
      expect(records[0].focused).toBe(true);
    });

    it("does not change focus when creating subsequent sessions for same owner", async () => {
      const { manager } = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" }, PHONE_A);
      await manager.create({ project: "backend", path: "/tmp/backend" }, PHONE_A);

      expect(manager.getFocused(PHONE_A)!.project).toBe("frontend");
    });

    it("throws SessionLimitError when max sessions reached", async () => {
      const { manager } = createTestManager({ maxSessions: 2 });
      await manager.create({ project: "a", path: "/tmp/a" }, PHONE_A);
      await manager.create({ project: "b", path: "/tmp/b" }, PHONE_A);

      await expect(manager.create({ project: "c", path: "/tmp/c" }, PHONE_A)).rejects.toThrow(
        SessionLimitError,
      );
    });

    it("throws SessionAlreadyExistsError for duplicate project names", async () => {
      const { manager } = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" }, PHONE_A);

      await expect(
        manager.create({ project: "frontend", path: "/tmp/other" }, PHONE_A),
      ).rejects.toThrow(SessionAlreadyExistsError);
    });

    it("validates project name format", async () => {
      const { manager } = createTestManager();

      await expect(
        manager.create({ project: "bad project!", path: "/tmp/x" }, PHONE_A),
      ).rejects.toThrow();
    });

    it("accepts valid project names with hyphens and underscores", async () => {
      const { manager } = createTestManager();
      const session = await manager.create(
        { project: "my-project_v2", path: "/tmp/proj" },
        PHONE_A,
      );
      expect(session.project).toBe("my-project_v2");
    });
  });

  describe("destroy()", () => {
    it("stops runner and updates DB status to stopped", async () => {
      const { manager } = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" }, PHONE_A);
      await manager.destroy("frontend");

      const allSessions = manager.list();
      expect(allSessions).toHaveLength(1);
      expect(allSessions[0].status).toBe("stopped");
    });

    it("auto-focuses next session of same owner when focused session is destroyed", async () => {
      const { manager } = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" }, PHONE_A);
      await manager.create({ project: "backend", path: "/tmp/backend" }, PHONE_A);
      await manager.destroy("frontend");

      expect(manager.getFocused(PHONE_A)!.project).toBe("backend");
    });

    it("clears focus when last session of owner is destroyed", async () => {
      const { manager } = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" }, PHONE_A);
      await manager.destroy("frontend");

      expect(manager.getFocused(PHONE_A)).toBeNull();
    });

    it("throws SessionNotFoundError for unknown project", async () => {
      const { manager } = createTestManager();

      await expect(manager.destroy("nonexistent")).rejects.toThrow(SessionNotFoundError);
    });
  });

  describe("switchFocus()", () => {
    it("changes the focused session for a phone", async () => {
      const { manager } = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" }, PHONE_A);
      await manager.create({ project: "backend", path: "/tmp/backend" }, PHONE_A);

      await manager.switchFocus("backend", PHONE_A);
      expect(manager.getFocused(PHONE_A)!.project).toBe("backend");
    });

    it("updates focused flag in DB", async () => {
      const { manager } = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" }, PHONE_A);
      await manager.create({ project: "backend", path: "/tmp/backend" }, PHONE_A);

      await manager.switchFocus("backend", PHONE_A);

      const records = manager.listActive(PHONE_A);
      const frontend = records.find((s) => s.project === "frontend");
      const backend = records.find((s) => s.project === "backend");
      expect(frontend!.focused).toBe(false);
      expect(backend!.focused).toBe(true);
    });

    it("throws SessionNotFoundError for unknown project", async () => {
      const { manager } = createTestManager();
      await expect(manager.switchFocus("nonexistent", PHONE_A)).rejects.toThrow(
        SessionNotFoundError,
      );
    });

    it("throws SessionNotFoundError when switching to another owner's session", async () => {
      const { manager } = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" }, PHONE_A);

      await expect(manager.switchFocus("frontend", PHONE_B)).rejects.toThrow(SessionNotFoundError);
    });
  });

  describe("list()", () => {
    it("returns all sessions including stopped", async () => {
      const { manager } = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" }, PHONE_A);
      await manager.create({ project: "backend", path: "/tmp/backend" }, PHONE_A);
      await manager.destroy("backend");

      const all = manager.list();
      expect(all).toHaveLength(2);

      const active = manager.listActive(PHONE_A);
      expect(active).toHaveLength(1);
      expect(active[0].project).toBe("frontend");
    });
  });

  describe("owner isolation", () => {
    it("each owner has independent focus", async () => {
      const { manager } = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" }, PHONE_A);
      await manager.create({ project: "backend", path: "/tmp/backend" }, PHONE_B);

      expect(manager.getFocused(PHONE_A)!.project).toBe("frontend");
      expect(manager.getFocused(PHONE_B)!.project).toBe("backend");
    });

    it("listActive filters by ownerPhone", async () => {
      const { manager } = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" }, PHONE_A);
      await manager.create({ project: "backend", path: "/tmp/backend" }, PHONE_B);

      const phoneASessions = manager.listActive(PHONE_A);
      expect(phoneASessions).toHaveLength(1);
      expect(phoneASessions[0].project).toBe("frontend");

      const phoneBSessions = manager.listActive(PHONE_B);
      expect(phoneBSessions).toHaveLength(1);
      expect(phoneBSessions[0].project).toBe("backend");
    });

    it("listActive without filter returns all", async () => {
      const { manager } = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" }, PHONE_A);
      await manager.create({ project: "backend", path: "/tmp/backend" }, PHONE_B);

      const all = manager.listActive();
      expect(all).toHaveLength(2);
    });

    it("destroying one owner's session does not affect other's focus", async () => {
      const { manager } = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" }, PHONE_A);
      await manager.create({ project: "backend", path: "/tmp/backend" }, PHONE_B);
      await manager.destroy("frontend");

      expect(manager.getFocused(PHONE_A)).toBeNull();
      expect(manager.getFocused(PHONE_B)!.project).toBe("backend");
    });

    it("async events go to ownerPhone not other phones", async () => {
      const { manager, sendReplyTo, getLastRunner } = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" }, PHONE_A);
      const runner = getLastRunner()!;

      runner.emit("result", {
        sessionId: "s1",
        textContent: "Done.",
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0,
        durationMs: 0,
      });

      await new Promise((r) => setTimeout(r, 10));

      // All sends should target PHONE_A
      for (const call of sendReplyTo.mock.calls) {
        expect(call[0]).toBe(PHONE_A);
      }
    });
  });

  describe("getByProject()", () => {
    it("returns the active session or null", async () => {
      const { manager } = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" }, PHONE_A);

      expect(manager.getByProject("frontend")).not.toBeNull();
      expect(manager.getByProject("nonexistent")).toBeNull();
    });
  });

  describe("restore()", () => {
    it("restores active sessions from DB", async () => {
      const { manager: manager1 } = createTestManager();
      await manager1.create({ project: "frontend", path: "/tmp/frontend" }, PHONE_A);
      await manager1.create({ project: "backend", path: "/tmp/backend" }, PHONE_A);

      // Create a new manager (simulating restart) using the same DB
      const { manager: manager2 } = createTestManager();
      const restored = await manager2.restore();

      expect(restored).toBe(2);
      expect(manager2.getByProject("frontend")).not.toBeNull();
      expect(manager2.getByProject("backend")).not.toBeNull();
      // Focus should be restored from DB
      expect(manager2.getFocused(PHONE_A)!.project).toBe("frontend");
    });

    it("skips stopped sessions", async () => {
      const { manager: manager1 } = createTestManager();
      await manager1.create({ project: "frontend", path: "/tmp/frontend" }, PHONE_A);
      await manager1.create({ project: "backend", path: "/tmp/backend" }, PHONE_A);
      await manager1.destroy("backend");

      const { manager: manager2 } = createTestManager();
      const restored = await manager2.restore();

      expect(restored).toBe(1);
      expect(manager2.getByProject("frontend")).not.toBeNull();
      expect(manager2.getByProject("backend")).toBeNull();
    });
  });

  describe("resolveApproval()", () => {
    it("returns false for unknown approval IDs", async () => {
      const { manager } = createTestManager();
      const result = await manager.resolveApproval("nonexistent", true);
      expect(result).toBe(false);
    });
  });

  describe("question detection on result", () => {
    it("sends yes/no buttons when result is a yes/no question", async () => {
      const { manager, sendButtonsTo, sendReplyTo, getLastRunner } = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" }, PHONE_A);
      const runner = getLastRunner()!;

      runner.emit("result", {
        sessionId: "s1",
        textContent: "Do you want to continue?",
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0,
        durationMs: 0,
      });

      await new Promise((r) => setTimeout(r, 10));

      expect(sendButtonsTo).toHaveBeenCalledWith(
        PHONE_A,
        "[frontend] Do you want to continue?",
        expect.arrayContaining([
          expect.objectContaining({ title: "Sí" }),
          expect.objectContaining({ title: "No" }),
        ]),
      );
      // "Completed" message should NOT be sent
      const textCalls = sendReplyTo.mock.calls.map((c) => c[1]);
      expect(textCalls.some((c) => c.includes("Completed"))).toBe(false);
    });

    it("sends buttons for multi-option (<=3) questions", async () => {
      const { manager, sendButtonsTo, getLastRunner } = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" }, PHONE_A);
      const runner = getLastRunner()!;

      runner.emit("result", {
        sessionId: "s1",
        textContent: "Which approach?\n1. Refactor\n2. Rewrite\n3. Skip",
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0,
        durationMs: 0,
      });

      await new Promise((r) => setTimeout(r, 10));

      expect(sendButtonsTo).toHaveBeenCalledWith(
        PHONE_A,
        "[frontend] Which approach?",
        expect.arrayContaining([
          expect.objectContaining({ title: "Refactor" }),
          expect.objectContaining({ title: "Rewrite" }),
          expect.objectContaining({ title: "Skip" }),
        ]),
      );
    });

    it("sends list for multi-option (>3) questions", async () => {
      const { manager, sendListTo, getLastRunner } = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" }, PHONE_A);
      const runner = getLastRunner()!;

      runner.emit("result", {
        sessionId: "s1",
        textContent: "Pick one:\n- Alpha\n- Beta\n- Gamma\n- Delta\nWhich one?",
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0,
        durationMs: 0,
      });

      await new Promise((r) => setTimeout(r, 10));

      expect(sendListTo).toHaveBeenCalledWith(
        PHONE_A,
        "[frontend] Which one?",
        "Options",
        expect.arrayContaining([
          expect.objectContaining({ title: "Alpha" }),
          expect.objectContaining({ title: "Beta" }),
          expect.objectContaining({ title: "Gamma" }),
          expect.objectContaining({ title: "Delta" }),
        ]),
      );
    });

    it("sends normal Completed message for non-questions", async () => {
      const { manager, sendReplyTo, sendButtonsTo, getLastRunner } = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" }, PHONE_A);
      const runner = getLastRunner()!;

      runner.emit("result", {
        sessionId: "s1",
        textContent: "I fixed the bug.",
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0,
        durationMs: 0,
      });

      await new Promise((r) => setTimeout(r, 10));

      const textCalls = sendReplyTo.mock.calls.map((c) => c[1]);
      expect(textCalls.some((c) => c.includes("Completed"))).toBe(true);
      // sendButtonsTo should not have been called for question detection
      expect(sendButtonsTo).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining("frontend"),
        expect.arrayContaining([expect.objectContaining({ title: "Sí" })]),
      );
    });
  });

  describe("answerQuestion()", () => {
    it("resumes runner with the answer", async () => {
      const { manager, getLastRunner } = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" }, PHONE_A);
      const runner = getLastRunner()!;

      await runner.start();
      const resumeSpy = vi.spyOn(runner, "resume");

      await manager.answerQuestion("frontend", "Sí");

      expect(resumeSpy).toHaveBeenCalledWith({ prompt: "Sí", cwd: "/tmp/frontend" });
    });

    it("does nothing for unknown project", async () => {
      const { manager } = createTestManager();
      await manager.answerQuestion("nonexistent", "Sí");
    });

    it("blocks when context is at block level", async () => {
      const { manager, sendReplyTo, getLastRunner } = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" }, PHONE_A);
      const runner = getLastRunner()!;

      await runner.start();
      runner.setContextState(96, 172_000, 20_000);
      const resumeSpy = vi.spyOn(runner, "resume");

      await manager.answerQuestion("frontend", "Sí");

      expect(resumeSpy).not.toHaveBeenCalled();
      const textCalls = sendReplyTo.mock.calls.map((c) => c[1]);
      expect(textCalls.some((c) => c.includes("limit reached"))).toBe(true);
    });

    it("allows when context is at critical but not block", async () => {
      const { manager, getLastRunner } = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" }, PHONE_A);
      const runner = getLastRunner()!;

      await runner.start();
      runner.setContextState(92, 164_000, 20_000);
      const resumeSpy = vi.spyOn(runner, "resume");

      await manager.answerQuestion("frontend", "Sí");

      expect(resumeSpy).toHaveBeenCalledWith({ prompt: "Sí", cwd: "/tmp/frontend" });
    });
  });

  describe("context guard integration", () => {
    it("sends warn message at 75% context", async () => {
      const { manager, sendReplyTo, getLastRunner } = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" }, PHONE_A);
      const runner = getLastRunner()!;

      runner.setContextState(75, 130_000, 20_000);
      runner.emit("result", {
        sessionId: "s1",
        textContent: "Done.",
        inputTokens: 130_000,
        outputTokens: 20_000,
        costUsd: 0,
        durationMs: 0,
      });

      await new Promise((r) => setTimeout(r, 10));

      const calls = sendReplyTo.mock.calls.map((c) => c[1]);
      expect(calls.some((c) => c.includes("Context at 75%"))).toBe(true);
    });

    it("sends critical message with /compact at 92%", async () => {
      const { manager, sendReplyTo, getLastRunner } = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" }, PHONE_A);
      const runner = getLastRunner()!;

      runner.setContextState(92, 164_000, 20_000);
      runner.emit("result", {
        sessionId: "s1",
        textContent: "Done.",
        inputTokens: 164_000,
        outputTokens: 20_000,
        costUsd: 0,
        durationMs: 0,
      });

      await new Promise((r) => setTimeout(r, 10));

      const calls = sendReplyTo.mock.calls.map((c) => c[1]);
      expect(calls.some((c) => c.includes("92%") && c.includes("/compact"))).toBe(true);
    });

    it("sends block message at 96%", async () => {
      const { manager, sendReplyTo, getLastRunner } = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" }, PHONE_A);
      const runner = getLastRunner()!;

      runner.setContextState(96, 172_000, 20_000);
      runner.emit("result", {
        sessionId: "s1",
        textContent: "Done.",
        inputTokens: 172_000,
        outputTokens: 20_000,
        costUsd: 0,
        durationMs: 0,
      });

      await new Promise((r) => setTimeout(r, 10));

      const calls = sendReplyTo.mock.calls.map((c) => c[1]);
      expect(calls.some((c) => c.includes("96%") && c.includes("limit reached"))).toBe(true);
    });

    it("sends no extra message below 70%", async () => {
      const { manager, sendReplyTo, getLastRunner } = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" }, PHONE_A);
      const runner = getLastRunner()!;

      runner.setContextState(50, 80_000, 20_000);
      runner.emit("result", {
        sessionId: "s1",
        textContent: "Done.",
        inputTokens: 80_000,
        outputTokens: 20_000,
        costUsd: 0,
        durationMs: 0,
      });

      await new Promise((r) => setTimeout(r, 10));

      const calls = sendReplyTo.mock.calls.map((c) => c[1]);
      expect(calls.filter((c) => c.includes("Context at")).length).toBe(0);
    });

    it("checkContextGuard returns null for unknown project", () => {
      const { manager } = createTestManager();
      expect(manager.checkContextGuard("nonexistent")).toBeNull();
    });

    it("checkContextGuard returns guard result for known project", async () => {
      const { manager, getLastRunner } = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" }, PHONE_A);
      const runner = getLastRunner()!;

      runner.setContextState(80, 140_000, 20_000);

      const guard = manager.checkContextGuard("frontend");
      expect(guard).not.toBeNull();
      expect(guard!.level).toBe("warn");
      expect(guard!.shouldWarn).toBe(true);
      expect(guard!.shouldBlock).toBe(false);
    });

    it("respects custom thresholds from config", async () => {
      const sendReplyTo = vi
        .fn<(phone: string, text: string) => Promise<void>>()
        .mockResolvedValue(undefined);
      const sendButtonsTo = vi
        .fn<
          (
            phone: string,
            text: string,
            buttons: Array<{ id: string; title: string }>,
          ) => Promise<void>
        >()
        .mockResolvedValue(undefined);

      let lastRunner: MockClaudeRunner | null = null;
      const manager = new SessionManager({
        sendReplyTo,
        sendButtonsTo,
        contextGuard: { warnPercent: 50, criticalPercent: 70, blockPercent: 85 },
        createRunner: () => {
          lastRunner = new MockClaudeRunner();
          return lastRunner as unknown as ClaudeRunner;
        },
      });

      await manager.create({ project: "frontend", path: "/tmp/frontend" }, PHONE_A);

      // 60% is between custom warn (50) and custom critical (70)
      lastRunner!.setContextState(60, 100_000, 20_000);
      const guard = manager.checkContextGuard("frontend");
      expect(guard!.level).toBe("warn");

      // 75% is between custom critical (70) and custom block (85)
      lastRunner!.setContextState(75, 130_000, 20_000);
      const guard2 = manager.checkContextGuard("frontend");
      expect(guard2!.level).toBe("critical");

      // 90% is above custom block (85)
      lastRunner!.setContextState(90, 160_000, 20_000);
      const guard3 = manager.checkContextGuard("frontend");
      expect(guard3!.level).toBe("block");
    });
  });

  describe("onSessionDestroy callback", () => {
    it("calls onSessionDestroy when a session is destroyed", async () => {
      const onSessionDestroy = vi.fn();
      const sendReplyTo = vi
        .fn<(phone: string, text: string) => Promise<void>>()
        .mockResolvedValue(undefined);
      const sendButtonsTo = vi
        .fn<
          (
            phone: string,
            text: string,
            buttons: Array<{ id: string; title: string }>,
          ) => Promise<void>
        >()
        .mockResolvedValue(undefined);

      const manager = new SessionManager({
        sendReplyTo,
        sendButtonsTo,
        onSessionDestroy,
        createRunner: () => new MockClaudeRunner() as unknown as ClaudeRunner,
      });

      await manager.create({ project: "frontend", path: "/tmp/frontend" }, PHONE_A);
      await manager.destroy("frontend");

      expect(onSessionDestroy).toHaveBeenCalledTimes(1);
      expect(onSessionDestroy).toHaveBeenCalledWith("frontend");
    });
  });
});
