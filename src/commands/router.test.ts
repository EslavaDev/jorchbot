import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, getDb } from "../db/index.js";
import { messages } from "../db/schema.js";
import type { JorchfileExecutor } from "../jorchfile/executor.js";
import type { Jorchfile } from "../jorchfile/parser.js";
import type { BackgroundTask, BackgroundTaskManager } from "../jorchfile/task-manager.js";
import { SessionManager } from "../sessions/jorchbot/manager.js";
import { ShellRunner } from "../sessions/jorchbot/shell-runner.js";
import { TunnelPendingConfirmation } from "../tunnels/manager.js";
import type { TunnelManager } from "../tunnels/manager.js";
import { CommandRouter } from "./router.js";
import type { CommandRouterDeps } from "./router.js";

// --- Test helpers ---

const SENDER = "+521234567890";

function createMockRunner() {
  return {
    getSessionId: vi.fn(() => null as string | null),
    getStatus: vi.fn(() => "idle" as const),
    getContextPercent: vi.fn(() => 0),
    getContextLimit: vi.fn(() => 200_000),
    getTokenCounts: vi.fn(() => ({ input: 0, output: 0 })),
    start: vi.fn().mockResolvedValue({
      sessionId: "mock-session",
      textContent: "",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      durationMs: 0,
    }),
    resume: vi.fn().mockResolvedValue({
      sessionId: "mock-session",
      textContent: "",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      durationMs: 0,
    }),
    stop: vi.fn().mockResolvedValue(undefined),
    setEnv: vi.fn(),
    on: vi.fn(),
    emit: vi.fn(),
  };
}

function createTestDeps(overrides?: Partial<CommandRouterDeps>) {
  const sendReply = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  const sendButtons = vi
    .fn<(text: string, buttons: Array<{ id: string; title: string }>) => Promise<void>>()
    .mockResolvedValue(undefined);
  const sendList = vi
    .fn<
      (
        text: string,
        buttonText: string,
        options: Array<{ id: string; title: string; description?: string }>,
      ) => Promise<void>
    >()
    .mockResolvedValue(undefined);
  const sendReplyTo = vi
    .fn<(phone: string, text: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  const sendButtonsTo = vi
    .fn<
      (phone: string, text: string, buttons: Array<{ id: string; title: string }>) => Promise<void>
    >()
    .mockResolvedValue(undefined);

  const sessionManager = new SessionManager({
    sendReplyTo,
    sendButtonsTo,
    createRunner: () => createMockRunner() as never,
  });

  const shellRunner = new ShellRunner();

  return {
    sendReply,
    sendButtons,
    sendList,
    sendReplyTo,
    sendButtonsTo,
    sessionManager,
    shellRunner,
    deps: {
      sessionManager,
      shellRunner,
      sendReply,
      sendButtons,
      sendList,
      ...overrides,
    } satisfies CommandRouterDeps,
  };
}

function msg(text: string) {
  return { text, senderId: "+521234567890", channel: "kapso", messageId: "msg_1" };
}

describe("CommandRouter (Phase 2)", () => {
  let tempDir: string;
  const originalDbPath = process.env.JORCHBOT_DB_PATH;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jorchbot-router-test-"));
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

  describe("routing", () => {
    it("routes $ prefix to shell execution", async () => {
      const { deps, sendReply, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      await router.route(msg("$ echo hello"));

      expect(sendReply).toHaveBeenCalled();
      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("[frontend] $ echo hello");
      expect(reply).toContain("hello");
    });

    it("routes / prefix to command handlers", async () => {
      const { deps, sendList } = createTestDeps();
      const router = new CommandRouter(deps);

      await router.route(msg("/help"));

      expect(sendList).toHaveBeenCalledTimes(1);
      const [text, , options] = sendList.mock.calls[0];
      expect(text).toContain("JorchBot Commands");
      expect(options).toHaveLength(4);
    });

    it("routes free text to focused session", async () => {
      const { deps, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      const focused = sessionManager.getFocused(SENDER)!;
      const startSpy = vi.spyOn(focused.runner, "start").mockResolvedValue({
        sessionId: "s1",
        textContent: "",
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        durationMs: 0,
      });

      await router.route(msg("fix the bug"));

      expect(startSpy).toHaveBeenCalledTimes(1);
    });

    it("returns error when no focused session and free text sent", async () => {
      const { deps, sendReply } = createTestDeps();
      const router = new CommandRouter(deps);

      await router.route(msg("fix the bug"));

      expect(sendReply).toHaveBeenCalledTimes(1);
      expect(sendReply.mock.calls[0][0]).toContain("No active session");
    });

    it("returns error for empty $ command", async () => {
      const { deps, sendReply } = createTestDeps();
      const router = new CommandRouter(deps);

      await router.route(msg("$"));

      expect(sendReply).toHaveBeenCalledTimes(1);
      expect(sendReply.mock.calls[0][0]).toContain("Empty shell command");
    });
  });

  describe("/new", () => {
    it("creates a session and sends confirmation", async () => {
      const { deps, sendReply } = createTestDeps();
      const router = new CommandRouter(deps);

      await router.route(msg("/new frontend /tmp/frontend"));

      expect(sendReply).toHaveBeenCalledTimes(1);
      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("[frontend] Session created");
      expect(reply).toContain("/tmp/frontend");
    });

    it("sends error on missing arguments", async () => {
      const { deps, sendReply } = createTestDeps();
      const router = new CommandRouter(deps);

      await router.route(msg("/new"));

      expect(sendReply).toHaveBeenCalledTimes(1);
      expect(sendReply.mock.calls[0][0]).toContain("Usage: /new");
    });
  });

  describe("/switch", () => {
    it("switches focus and confirms", async () => {
      const { deps, sendReply, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      await sessionManager.create({ project: "backend", path: "/tmp/backend" }, SENDER);
      const router = new CommandRouter(deps);

      sendReply.mockClear();
      await router.route(msg("/switch backend"));

      expect(sendReply).toHaveBeenCalledTimes(1);
      expect(sendReply.mock.calls[0][0]).toContain("[backend] Session focused");
    });

    it("sends error for unknown project", async () => {
      const { deps, sendReply } = createTestDeps();
      const router = new CommandRouter(deps);

      await router.route(msg("/switch nonexistent"));

      expect(sendReply).toHaveBeenCalledTimes(1);
      expect(sendReply.mock.calls[0][0]).toContain("Failed to switch");
    });
  });

  describe("/list", () => {
    it("shows all sessions with focus indicator", async () => {
      const { deps, sendReply, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      await sessionManager.create({ project: "backend", path: "/tmp/backend" }, SENDER);
      const router = new CommandRouter(deps);

      sendReply.mockClear();
      await router.route(msg("/list"));

      expect(sendReply).toHaveBeenCalledTimes(1);
      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("● frontend (focused)");
      expect(reply).toContain("○ backend (background)");
    });

    it("shows empty message when no sessions", async () => {
      const { deps, sendReply } = createTestDeps();
      const router = new CommandRouter(deps);

      await router.route(msg("/list"));

      expect(sendReply).toHaveBeenCalledTimes(1);
      expect(sendReply.mock.calls[0][0]).toContain("No active sessions");
    });
  });

  describe("/stop", () => {
    it("stops a session and confirms", async () => {
      const { deps, sendReply, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      sendReply.mockClear();
      await router.route(msg("/stop frontend"));

      expect(sendReply).toHaveBeenCalledTimes(1);
      expect(sendReply.mock.calls[0][0]).toContain("[frontend] Session stopped");
    });
  });

  describe("/status", () => {
    it("shows session count and focused session", async () => {
      const { deps, sendReply, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      sendReply.mockClear();
      await router.route(msg("/status"));

      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("1 active");
      expect(reply).toContain("Focused: frontend");
    });

    it("shows no sessions message when empty", async () => {
      const { deps, sendReply } = createTestDeps();
      const router = new CommandRouter(deps);

      await router.route(msg("/status"));

      expect(sendReply.mock.calls[0][0]).toContain("No active sessions");
    });
  });

  describe("shell shortcuts", () => {
    it("/ls maps to ls -la", async () => {
      const { deps, sendReply, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp" }, SENDER);
      const router = new CommandRouter(deps);

      sendReply.mockClear();
      await router.route(msg("/ls"));

      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("[frontend] $ ls -la");
    });

    it("/git maps to git command", async () => {
      const { deps, sendReply, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp" }, SENDER);
      const router = new CommandRouter(deps);

      sendReply.mockClear();
      await router.route(msg("/git status"));

      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("[frontend] $ git status");
    });

    it("/pwd maps to pwd", async () => {
      const { deps, sendReply, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp" }, SENDER);
      const router = new CommandRouter(deps);

      sendReply.mockClear();
      await router.route(msg("/pwd"));

      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("[frontend] $ pwd");
      expect(reply).toMatch(/\/.*tmp/);
    });
  });

  describe("dangerous commands", () => {
    it("sends approval buttons for dangerous $ commands", async () => {
      const { deps, sendButtons, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp" }, SENDER);
      const router = new CommandRouter(deps);

      sendButtons.mockClear();
      await router.route(msg("$ rm -rf node_modules"));

      expect(sendButtons).toHaveBeenCalledTimes(1);
      const [text, buttons] = sendButtons.mock.calls[0];
      expect(text).toContain("Dangerous command");
      expect(text).toContain("rm -rf");
      expect(buttons).toHaveLength(2);
      expect(buttons[0].title).toBe("Yes");
      expect(buttons[1].title).toBe("No");
    });

    it("executes safe commands immediately", async () => {
      const { deps, sendReply, sendButtons, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp" }, SENDER);
      const router = new CommandRouter(deps);

      sendReply.mockClear();
      sendButtons.mockClear();
      await router.route(msg("$ echo safe"));

      expect(sendButtons).not.toHaveBeenCalled();
      expect(sendReply).toHaveBeenCalled();
      expect(sendReply.mock.calls[0][0]).toContain("safe");
    });
  });

  describe("! claude commands", () => {
    it("!usage shows session token counts", async () => {
      const { deps, sendReply, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      const focused = sessionManager.getFocused(SENDER)!;
      vi.spyOn(focused.runner, "getTokenCounts").mockReturnValue({ input: 5000, output: 1000 });
      vi.spyOn(focused.runner, "getContextPercent").mockReturnValue(3);

      sendReply.mockClear();
      await router.route(msg("!usage"));

      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("Session Usage");
      expect(reply).toContain("Context: 3%");
      expect(reply).toContain("5,000");
      expect(reply).toContain("1,000");
    });

    it("!usage returns error when no session", async () => {
      const { deps, sendReply } = createTestDeps();
      const router = new CommandRouter(deps);

      await router.route(msg("!usage"));

      expect(sendReply).toHaveBeenCalledTimes(1);
      expect(sendReply.mock.calls[0][0]).toContain("No active session");
    });

    it("!context shows context window with progress bar", async () => {
      const { deps, sendReply, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      const focused = sessionManager.getFocused(SENDER)!;
      vi.spyOn(focused.runner, "getTokenCounts").mockReturnValue({ input: 50000, output: 10000 });
      vi.spyOn(focused.runner, "getContextPercent").mockReturnValue(30);
      vi.spyOn(focused.runner, "getContextLimit").mockReturnValue(200_000);

      sendReply.mockClear();
      await router.route(msg("!context"));

      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("[frontend] Context: 30%");
      expect(reply).toContain("60,000");
      expect(reply).toContain("200,000");
      expect(reply).toContain("██████");
      expect(reply).toContain("░░░░░░");
    });

    it("!context shows dynamic limit from runner", async () => {
      const { deps, sendReply, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      const focused = sessionManager.getFocused(SENDER)!;
      vi.spyOn(focused.runner, "getTokenCounts").mockReturnValue({ input: 50000, output: 10000 });
      vi.spyOn(focused.runner, "getContextPercent").mockReturnValue(60);
      vi.spyOn(focused.runner, "getContextLimit").mockReturnValue(100_000);

      sendReply.mockClear();
      await router.route(msg("!context"));

      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("100,000");
      expect(reply).not.toContain("200,000");
    });

    it("!compact compacts focused session", async () => {
      const { deps, sendReply, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      const focused = sessionManager.getFocused(SENDER)!;
      vi.spyOn(focused.runner, "getContextPercent").mockReturnValueOnce(80).mockReturnValueOnce(20);

      sendReply.mockClear();
      await router.route(msg("!compact"));

      expect(sendReply).toHaveBeenCalled();
      // First call: "Compacting context..."
      expect(sendReply.mock.calls[0][0]).toContain("Compacting context");
      // Second call: "Compacted: 80% → 20%"
      expect(sendReply.mock.calls[1][0]).toContain("Compacted");
    });

    it("!clear resets focused session", async () => {
      const { deps, sendReply, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      sendReply.mockClear();
      await router.route(msg("!clear"));

      expect(sendReply).toHaveBeenCalled();
      const reply = sendReply.mock.calls[sendReply.mock.calls.length - 1][0];
      expect(reply).toContain("[frontend] Session cleared");
    });

    it("!status forwards /status as prompt to Claude Code", async () => {
      const { deps, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      const focused = sessionManager.getFocused(SENDER)!;
      const startSpy = vi.spyOn(focused.runner, "start").mockResolvedValue({
        sessionId: "s1",
        textContent: "",
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        durationMs: 0,
      });

      await router.route(msg("!status"));

      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(startSpy.mock.calls[0][0].prompt).toBe("/status");
    });

    it("!commit forwards as /commit to Claude Code", async () => {
      const { deps, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      const focused = sessionManager.getFocused(SENDER)!;
      const startSpy = vi.spyOn(focused.runner, "start").mockResolvedValue({
        sessionId: "s1",
        textContent: "",
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        durationMs: 0,
      });

      await router.route(msg("!commit"));

      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(startSpy.mock.calls[0][0].prompt).toBe("/commit");
    });

    it("empty ! returns error", async () => {
      const { deps, sendReply } = createTestDeps();
      const router = new CommandRouter(deps);

      await router.route(msg("!"));

      expect(sendReply).toHaveBeenCalledTimes(1);
      expect(sendReply.mock.calls[0][0]).toContain("Empty Claude command");
    });

    it("/usage is unknown command (use !usage to forward to Claude)", async () => {
      const { deps, sendReply } = createTestDeps();
      const router = new CommandRouter(deps);

      await router.route(msg("/usage"));

      expect(sendReply).toHaveBeenCalledTimes(1);
      expect(sendReply.mock.calls[0][0]).toContain("Unknown command");
    });
  });

  describe("context guard block enforcement", () => {
    it("blocks free text when context is at block level", async () => {
      const { deps, sendReply, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      const focused = sessionManager.getFocused(SENDER)!;
      // 96% → block level (>= 95%)
      vi.spyOn(focused.runner, "getTokenCounts").mockReturnValue({
        input: 172_000,
        output: 20_000,
      });
      vi.spyOn(focused.runner, "getContextPercent").mockReturnValue(96);
      vi.spyOn(focused.runner, "getContextLimit").mockReturnValue(200_000);
      const startSpy = vi.spyOn(focused.runner, "start");

      sendReply.mockClear();
      await router.route(msg("fix the bug"));

      expect(startSpy).not.toHaveBeenCalled();
      expect(sendReply).toHaveBeenCalledWith(expect.stringContaining("limit reached"));
    });

    it("allows free text below block level", async () => {
      const { deps, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      const focused = sessionManager.getFocused(SENDER)!;
      // 92% → critical, not block
      vi.spyOn(focused.runner, "getTokenCounts").mockReturnValue({
        input: 164_000,
        output: 20_000,
      });
      vi.spyOn(focused.runner, "getContextPercent").mockReturnValue(92);
      vi.spyOn(focused.runner, "getContextLimit").mockReturnValue(200_000);
      const startSpy = vi.spyOn(focused.runner, "start").mockResolvedValue({
        sessionId: "s1",
        textContent: "",
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        durationMs: 0,
      });

      await router.route(msg("fix the bug"));

      expect(startSpy).toHaveBeenCalledTimes(1);
    });

    it("blocks ! commands when context is at block level", async () => {
      const { deps, sendReply, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      const focused = sessionManager.getFocused(SENDER)!;
      vi.spyOn(focused.runner, "getTokenCounts").mockReturnValue({
        input: 172_000,
        output: 20_000,
      });
      vi.spyOn(focused.runner, "getContextPercent").mockReturnValue(96);
      vi.spyOn(focused.runner, "getContextLimit").mockReturnValue(200_000);
      const startSpy = vi.spyOn(focused.runner, "start");

      sendReply.mockClear();
      await router.route(msg("!status"));

      expect(startSpy).not.toHaveBeenCalled();
      expect(sendReply).toHaveBeenCalledWith(expect.stringContaining("limit reached"));
    });
  });

  describe("unknown command", () => {
    it("sends error for unknown commands", async () => {
      const { deps, sendReply } = createTestDeps();
      const router = new CommandRouter(deps);

      await router.route(msg("/unknown"));

      expect(sendReply).toHaveBeenCalledTimes(1);
      expect(sendReply.mock.calls[0][0]).toContain("Unknown command");
    });
  });

  describe("free text with focused session", () => {
    it("calls runner.start for first message", async () => {
      const { deps, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      const focused = sessionManager.getFocused(SENDER)!;
      const startSpy = vi.spyOn(focused.runner, "start").mockResolvedValue({
        sessionId: "s1",
        textContent: "",
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        durationMs: 0,
      });

      await router.route(msg("hello claude"));

      expect(startSpy).toHaveBeenCalledTimes(1);
    });

    it("calls runner.resume when session exists", async () => {
      const { deps, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      const focused = sessionManager.getFocused(SENDER)!;
      vi.spyOn(focused.runner, "getSessionId").mockReturnValue("sess_abc");
      const resumeSpy = vi.spyOn(focused.runner, "resume").mockResolvedValue({
        sessionId: "sess_abc",
        textContent: "",
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        durationMs: 0,
      });

      await router.route(msg("continue work"));

      expect(resumeSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("message logging", () => {
    it("logs inbound messages to DB", async () => {
      const { deps, sessionManager } = createTestDeps();
      const session = await sessionManager.create(
        { project: "frontend", path: "/tmp/frontend" },
        SENDER,
      );
      const router = new CommandRouter(deps);

      await router.route(msg("$ echo hello"));

      const db = getDb();
      const logs = db.select().from(messages).where(eq(messages.sessionId, session.id)).all();

      const inbound = logs.filter((l) => l.direction === "inbound");
      expect(inbound.length).toBeGreaterThanOrEqual(1);
      expect(inbound[0].type).toBe("shell");
      expect(inbound[0].content).toContain("$ echo hello");
    });

    it("logs shell output to DB", async () => {
      const { deps, sessionManager } = createTestDeps();
      const session = await sessionManager.create({ project: "frontend", path: "/tmp" }, SENDER);
      const router = new CommandRouter(deps);

      await router.route(msg("$ echo test-output"));

      const db = getDb();
      const logs = db.select().from(messages).where(eq(messages.sessionId, session.id)).all();

      const outbound = logs.filter((l) => l.direction === "outbound" && l.type === "shell");
      expect(outbound.length).toBeGreaterThanOrEqual(1);
      expect(outbound[0].content).toContain("test-output");
    });

    it("/logs returns messages in order", async () => {
      const { deps, sendReply, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp" }, SENDER);
      const router = new CommandRouter(deps);

      // Generate some logged messages via shell commands
      await router.route(msg("$ echo first"));
      await router.route(msg("$ echo second"));

      sendReply.mockClear();
      await router.route(msg("/logs frontend"));

      expect(sendReply).toHaveBeenCalledTimes(1);
      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("[frontend] Last");
      expect(reply).toContain("→");
      expect(reply).toContain("←");
    });

    it("/logs respects count limit", async () => {
      const { deps, sendReply, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp" }, SENDER);
      const router = new CommandRouter(deps);

      // Generate several messages
      await router.route(msg("$ echo a"));
      await router.route(msg("$ echo b"));
      await router.route(msg("$ echo c"));

      sendReply.mockClear();
      await router.route(msg("/logs frontend 2"));

      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("Last 2 messages");
    });

    it("/logs returns empty for unknown project", async () => {
      const { deps, sendReply } = createTestDeps();
      const router = new CommandRouter(deps);

      await router.route(msg("/logs nonexistent"));

      expect(sendReply).toHaveBeenCalledTimes(1);
      expect(sendReply.mock.calls[0][0]).toContain("No messages logged");
    });
  });
});

// --- Phase 3 helpers ---

function createTestJorchfile(): Jorchfile {
  return {
    projects: [
      {
        name: "frontend",
        path: "/tmp/frontend",
        commands: { dev: "npm run dev", test: "npm run test", build: "npm run build" },
        background: ["dev", "build"],
        tunnels: [],
      },
      {
        name: "backend",
        path: "/tmp/backend",
        commands: { dev: "python manage.py runserver", test: "pytest" },
        background: ["dev"],
        port: 8000,
        tunnels: [{ mode: "serve", port: 8000 }],
      },
    ],
    settings: {},
  };
}

function createMockExecutor(jorchfile: Jorchfile) {
  const executor = {
    getJorchfile: vi.fn(() => jorchfile),
    hasCommand: vi.fn((cmd: string) => jorchfile.projects.some((p) => cmd in p.commands)),
    getProject: vi.fn((name: string) => jorchfile.projects.find((p) => p.name === name) ?? null),
    execute: vi.fn().mockResolvedValue(undefined),
    getRegisteredCommands: vi.fn(() => {
      const cmds = new Set<string>();
      for (const p of jorchfile.projects) {
        for (const c of Object.keys(p.commands)) {
          cmds.add(c);
        }
      }
      return [...cmds];
    }),
    stopTunnel: vi.fn().mockResolvedValue(undefined),
    stopAllTunnels: vi.fn().mockResolvedValue(undefined),
    updateJorchfile: vi.fn(),
  };
  return executor as typeof executor & JorchfileExecutor;
}

function createMockTaskManager() {
  const manager = {
    listAll: vi.fn<() => BackgroundTask[]>().mockReturnValue([]),
    listByProject: vi.fn<(project: string) => BackgroundTask[]>().mockReturnValue([]),
    hasTasksFor: vi.fn().mockReturnValue(false),
    start: vi.fn().mockResolvedValue({ pid: 12345 }),
    stop: vi.fn(),
    stopAll: vi.fn().mockReturnValue(0),
  };
  return manager as typeof manager & BackgroundTaskManager;
}

describe("CommandRouter (Phase 3)", () => {
  let tempDir: string;
  const originalDbPath = process.env.JORCHBOT_DB_PATH;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jorchbot-router-p3-"));
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

  describe("/projects", () => {
    it("lists Jorchfile projects with session status", async () => {
      const jorchfile = createTestJorchfile();
      const executor = createMockExecutor(jorchfile);
      const taskManager = createMockTaskManager();
      const { deps, sendReply, sessionManager } = createTestDeps({
        getJorchfileExecutor: () => executor as unknown as JorchfileExecutor,
        taskManager: taskManager as unknown as BackgroundTaskManager,
      });

      // Create a session for frontend to test "active" status
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      sendReply.mockClear();
      await router.route(msg("/projects"));

      expect(sendReply).toHaveBeenCalledTimes(1);
      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("frontend");
      expect(reply).toContain("backend");
      expect(reply).toContain("active");
      expect(reply).toContain("no session");
    });

    it("shows message when no Jorchfile loaded", async () => {
      const { deps, sendReply } = createTestDeps({
        getJorchfileExecutor: () => null,
      });
      const router = new CommandRouter(deps);

      await router.route(msg("/projects"));

      expect(sendReply).toHaveBeenCalledTimes(1);
      expect(sendReply.mock.calls[0][0]).toContain("No Jorchfile loaded");
    });
  });

  describe("/tasks", () => {
    it("shows background tasks with uptime", async () => {
      const taskManager = createMockTaskManager();
      taskManager.listAll.mockReturnValue([
        {
          pid: 12345,
          project: "frontend",
          commandName: "dev",
          shellCommand: "npm run dev",
          startedAt: new Date(),
          process: {} as never,
        },
      ]);

      const { deps, sendReply } = createTestDeps({
        taskManager: taskManager as unknown as BackgroundTaskManager,
      });
      const router = new CommandRouter(deps);

      await router.route(msg("/tasks"));

      expect(sendReply).toHaveBeenCalledTimes(1);
      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("PID 12345");
      expect(reply).toContain("frontend");
      expect(reply).toContain("dev");
    });

    it("shows empty message when no tasks running", async () => {
      const taskManager = createMockTaskManager();
      const { deps, sendReply } = createTestDeps({
        taskManager: taskManager as unknown as BackgroundTaskManager,
      });
      const router = new CommandRouter(deps);

      await router.route(msg("/tasks"));

      expect(sendReply).toHaveBeenCalledTimes(1);
      expect(sendReply.mock.calls[0][0]).toContain("No background tasks running");
    });
  });

  describe("/stop-cmd", () => {
    it("stops specific task and closes tunnel", async () => {
      const jorchfile = createTestJorchfile();
      const executor = createMockExecutor(jorchfile);
      const taskManager = createMockTaskManager();
      taskManager.listByProject.mockReturnValue([
        {
          pid: 99,
          project: "backend",
          commandName: "dev",
          shellCommand: "python manage.py runserver",
          port: 8000,
          startedAt: new Date(),
          process: {} as never,
        },
      ]);

      const { deps, sendReply } = createTestDeps({
        getJorchfileExecutor: () => executor as unknown as JorchfileExecutor,
        taskManager: taskManager as unknown as BackgroundTaskManager,
      });
      const router = new CommandRouter(deps);

      await router.route(msg("/stop-cmd backend dev"));

      expect(taskManager.stop).toHaveBeenCalledWith("backend", "dev");
      expect(executor.stopTunnel).toHaveBeenCalledWith("backend", 8000);
      expect(sendReply).toHaveBeenCalledWith(expect.stringContaining('Stopped "dev"'));
    });

    it("stops all tasks for project when no command specified", async () => {
      const jorchfile = createTestJorchfile();
      const executor = createMockExecutor(jorchfile);
      const taskManager = createMockTaskManager();
      taskManager.stopAll.mockReturnValue(2);

      const { deps, sendReply } = createTestDeps({
        getJorchfileExecutor: () => executor as unknown as JorchfileExecutor,
        taskManager: taskManager as unknown as BackgroundTaskManager,
      });
      const router = new CommandRouter(deps);

      await router.route(msg("/stop-cmd frontend"));

      expect(taskManager.stopAll).toHaveBeenCalledWith("frontend");
      expect(executor.stopAllTunnels).toHaveBeenCalledWith("frontend");
      expect(sendReply).toHaveBeenCalledWith(expect.stringContaining("Stopped 2 background task"));
    });
  });

  describe("/make", () => {
    it("lists Makefile targets when no target specified", async () => {
      const mockReadTargets = vi.fn().mockReturnValue(["build", "test", "clean"]);
      const { deps, sendReply, sessionManager } = createTestDeps({
        readMakefileTargets: mockReadTargets,
      });
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      sendReply.mockClear();
      await router.route(msg("/make"));

      expect(sendReply).toHaveBeenCalledTimes(1);
      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("Makefile targets");
      expect(reply).toContain("build");
      expect(reply).toContain("test");
      expect(reply).toContain("clean");
    });

    it("executes make target via shell", async () => {
      const { deps, sendReply, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp" }, SENDER);
      const router = new CommandRouter(deps);

      sendReply.mockClear();
      await router.route(msg("/make build"));

      expect(sendReply).toHaveBeenCalled();
      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("[frontend] $ make build");
    });
  });

  describe("/new from Jorchfile", () => {
    it("uses Jorchfile path when no explicit path provided", async () => {
      const jorchfile = createTestJorchfile();
      const executor = createMockExecutor(jorchfile);
      const { deps, sendReply } = createTestDeps({
        getJorchfileExecutor: () => executor as unknown as JorchfileExecutor,
      });
      const router = new CommandRouter(deps);

      await router.route(msg("/new frontend"));

      expect(sendReply).toHaveBeenCalledTimes(1);
      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("[frontend] Session created");
      expect(reply).toContain("(from Jorchfile)");
      expect(reply).toContain("/tmp/frontend");
    });

    it("shows error when project not in Jorchfile and no path", async () => {
      const jorchfile = createTestJorchfile();
      const executor = createMockExecutor(jorchfile);
      const { deps, sendReply } = createTestDeps({
        getJorchfileExecutor: () => executor as unknown as JorchfileExecutor,
      });
      const router = new CommandRouter(deps);

      await router.route(msg("/new unknown"));

      expect(sendReply).toHaveBeenCalledTimes(1);
      expect(sendReply.mock.calls[0][0]).toContain("not found in Jorchfile");
    });
  });

  describe("Jorchfile command priority", () => {
    it("dispatches Jorchfile command to executor", async () => {
      const jorchfile = createTestJorchfile();
      const executor = createMockExecutor(jorchfile);
      const { deps, sessionManager } = createTestDeps({
        getJorchfileExecutor: () => executor as unknown as JorchfileExecutor,
      });
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      await router.route(msg("/dev frontend"));

      expect(executor.execute).toHaveBeenCalledWith("dev", "frontend", false, SENDER);
    });

    it("parses trailing & for background flag", async () => {
      const jorchfile = createTestJorchfile();
      const executor = createMockExecutor(jorchfile);
      const { deps, sessionManager } = createTestDeps({
        getJorchfileExecutor: () => executor as unknown as JorchfileExecutor,
      });
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      await router.route(msg("/test frontend &"));

      expect(executor.execute).toHaveBeenCalledWith("test", "frontend", true, SENDER);
    });

    it("uses focused session when no project arg given", async () => {
      const jorchfile = createTestJorchfile();
      const executor = createMockExecutor(jorchfile);
      const { deps, sessionManager } = createTestDeps({
        getJorchfileExecutor: () => executor as unknown as JorchfileExecutor,
      });
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      await router.route(msg("/dev"));

      expect(executor.execute).toHaveBeenCalledWith("dev", undefined, false, SENDER);
    });

    it("unknown command falls through to shell shortcuts or unknown", async () => {
      const jorchfile = createTestJorchfile();
      const executor = createMockExecutor(jorchfile);
      const { deps, sendReply } = createTestDeps({
        getJorchfileExecutor: () => executor as unknown as JorchfileExecutor,
      });
      const router = new CommandRouter(deps);

      await router.route(msg("/nonexistent"));

      expect(executor.execute).not.toHaveBeenCalled();
      expect(sendReply).toHaveBeenCalledWith(expect.stringContaining("Unknown command"));
    });
  });
});

// --- Phase 4 helpers ---

function createMockTunnelManager() {
  return {
    start: vi.fn().mockResolvedValue({
      id: "tunnel-1",
      sessionId: "s1",
      project: "frontend",
      localPort: 3000,
      assignedPort: 3000,
      url: "https://mydevice.ts.net:3000",
      provider: "tailscale-serve",
      mode: "serve",
      status: "active",
      createdAt: new Date(),
    }),
    list: vi.fn().mockReturnValue([]),
    listByProject: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(undefined),
    findByProjectPort: vi.fn().mockReturnValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    stopByProjectPort: vi.fn().mockResolvedValue(undefined),
    stopByProject: vi.fn().mockResolvedValue(undefined),
    stopBySession: vi.fn().mockResolvedValue(undefined),
    stopAll: vi.fn().mockResolvedValue(undefined),
    confirmFunnel: vi.fn().mockResolvedValue(undefined),
    cancelFunnel: vi.fn(),
    health: vi.fn().mockResolvedValue({ tunnels: [], allHealthy: true }),
    restore: vi.fn().mockResolvedValue(0),
  };
}

describe("CommandRouter (Phase 4 — Tunnels)", () => {
  let tempDir: string;
  const originalDbPath = process.env.JORCHBOT_DB_PATH;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jorchbot-router-p4-"));
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

  describe("/tunnel", () => {
    it("starts serve tunnel for project with port", async () => {
      const tunnelManager = createMockTunnelManager();
      const { deps, sendReply, sessionManager } = createTestDeps({
        tunnelManager: tunnelManager as unknown as TunnelManager,
      });
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      sendReply.mockClear();
      await router.route(msg("/tunnel frontend 3000"));

      expect(tunnelManager.start).toHaveBeenCalledWith(
        expect.objectContaining({
          project: "frontend",
          localPort: 3000,
          mode: "serve",
        }),
      );
    });

    it("starts funnel tunnel with --public flag", async () => {
      const tunnelManager = createMockTunnelManager();
      tunnelManager.start.mockRejectedValue(new TunnelPendingConfirmation("pending-1"));
      const { deps, sessionManager } = createTestDeps({
        tunnelManager: tunnelManager as unknown as TunnelManager,
      });
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      await router.route(msg("/tunnel frontend 3000 --public"));

      expect(tunnelManager.start).toHaveBeenCalledWith(
        expect.objectContaining({
          project: "frontend",
          localPort: 3000,
          mode: "funnel",
        }),
      );
    });

    it("shows error when no session exists", async () => {
      const tunnelManager = createMockTunnelManager();
      const { deps, sendReply } = createTestDeps({
        tunnelManager: tunnelManager as unknown as TunnelManager,
      });
      const router = new CommandRouter(deps);

      await router.route(msg("/tunnel frontend 3000"));

      expect(sendReply).toHaveBeenCalledWith(
        expect.stringContaining('No active session for "frontend"'),
      );
      expect(tunnelManager.start).not.toHaveBeenCalled();
    });

    it("shows error when no port found", async () => {
      const tunnelManager = createMockTunnelManager();
      const { deps, sendReply, sessionManager } = createTestDeps({
        tunnelManager: tunnelManager as unknown as TunnelManager,
      });
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      sendReply.mockClear();
      await router.route(msg("/tunnel frontend"));

      expect(sendReply).toHaveBeenCalledWith(expect.stringContaining("No port found"));
    });
  });

  describe("/tunnels", () => {
    it("shows active tunnels grouped by mode", async () => {
      const tunnelManager = createMockTunnelManager();
      tunnelManager.list.mockReturnValue([
        {
          id: "t1",
          project: "frontend",
          localPort: 3000,
          url: "https://mydevice.ts.net:3000",
          mode: "serve",
          status: "active",
        },
        {
          id: "t2",
          project: "api",
          localPort: 8000,
          url: "https://mydevice.ts.net:8443/api",
          mode: "funnel",
          status: "active",
        },
      ]);
      const { deps, sendReply } = createTestDeps({
        tunnelManager: tunnelManager as unknown as TunnelManager,
      });
      const router = new CommandRouter(deps);

      await router.route(msg("/tunnels"));

      expect(sendReply).toHaveBeenCalledTimes(1);
      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("PRIVATE (tailnet only)");
      expect(reply).toContain("frontend");
      expect(reply).toContain("PUBLIC (internet)");
      expect(reply).toContain("api");
    });

    it("shows empty message when no tunnels", async () => {
      const tunnelManager = createMockTunnelManager();
      const { deps, sendReply } = createTestDeps({
        tunnelManager: tunnelManager as unknown as TunnelManager,
      });
      const router = new CommandRouter(deps);

      await router.route(msg("/tunnels"));

      expect(sendReply).toHaveBeenCalledWith("No active tunnels.");
    });
  });

  describe("/tunnel-stop", () => {
    it("stops all tunnels for project when no port", async () => {
      const tunnelManager = createMockTunnelManager();
      const { deps, sendReply } = createTestDeps({
        tunnelManager: tunnelManager as unknown as TunnelManager,
      });
      const router = new CommandRouter(deps);

      await router.route(msg("/tunnel-stop frontend"));

      expect(tunnelManager.stopByProject).toHaveBeenCalledWith("frontend");
      expect(sendReply).toHaveBeenCalledWith("[frontend] All tunnels stopped.");
    });

    it("stops specific tunnel when port specified", async () => {
      const tunnelManager = createMockTunnelManager();
      const { deps, sendReply } = createTestDeps({
        tunnelManager: tunnelManager as unknown as TunnelManager,
      });
      const router = new CommandRouter(deps);

      await router.route(msg("/tunnel-stop frontend 3000"));

      expect(tunnelManager.stopByProjectPort).toHaveBeenCalledWith("frontend", 3000);
      expect(sendReply).toHaveBeenCalledWith("[frontend] Tunnel on port 3000 stopped.");
    });
  });

  describe("/status with tunnels", () => {
    it("includes tunnel count in status", async () => {
      const tunnelManager = createMockTunnelManager();
      tunnelManager.list.mockReturnValue([
        { id: "t1", project: "frontend", mode: "serve", status: "active" },
      ]);
      const { deps, sendReply, sessionManager } = createTestDeps({
        tunnelManager: tunnelManager as unknown as TunnelManager,
      });
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      sendReply.mockClear();
      await router.route(msg("/status"));

      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("Tunnels: 1 active");
    });
  });

  describe("/help", () => {
    it("sends interactive list when sendList available", async () => {
      const { deps, sendList } = createTestDeps();
      const router = new CommandRouter(deps);

      await router.route(msg("/help"));

      expect(sendList).toHaveBeenCalledTimes(1);
      const [text, buttonText, options] = sendList.mock.calls[0];
      expect(text).toContain("JorchBot Commands");
      expect(buttonText).toBe("Commands");
      expect(options).toHaveLength(4);
      expect(options[0].title).toBe("Global");
      expect(options[1].title).toBe("Jorchfile");
      expect(options[2].title).toBe("Shell");
      expect(options[3].title).toBe("Claude");
    });

    it("/help --full sends full text", async () => {
      const { deps, sendReply, sendList } = createTestDeps();
      const router = new CommandRouter(deps);

      await router.route(msg("/help --full"));

      expect(sendList).not.toHaveBeenCalled();
      expect(sendReply).toHaveBeenCalledTimes(1);
      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("/tunnel");
      expect(reply).toContain("/tunnel-stop");
      expect(reply).toContain("/tunnels");
      expect(reply).toContain("--public");
      expect(reply).toContain("/mode");
      expect(reply).toContain("/output");
    });

    it("falls back to full text when sendList not available", async () => {
      const { deps, sendReply } = createTestDeps({ sendList: undefined });
      const router = new CommandRouter(deps);

      await router.route(msg("/help"));

      expect(sendReply).toHaveBeenCalledTimes(1);
      expect(sendReply.mock.calls[0][0]).toContain("/new");
    });

    it("sendHelpCategory returns global commands", async () => {
      const { deps, sendReply } = createTestDeps();
      const router = new CommandRouter(deps);

      await router.sendHelpCategory("global");

      expect(sendReply).toHaveBeenCalledTimes(1);
      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("Global Commands");
      expect(reply).toContain("/new");
      expect(reply).toContain("/tunnel");
      expect(reply).toContain("/mode");
      expect(reply).toContain("/output");
    });

    it("sendHelpCategory returns shell commands", async () => {
      const { deps, sendReply } = createTestDeps();
      const router = new CommandRouter(deps);

      await router.sendHelpCategory("shell");

      expect(sendReply).toHaveBeenCalledTimes(1);
      expect(sendReply.mock.calls[0][0]).toContain("Shell Commands");
    });

    it("sendHelpCategory returns error for unknown category", async () => {
      const { deps, sendReply } = createTestDeps();
      const router = new CommandRouter(deps);

      await router.sendHelpCategory("unknown");

      expect(sendReply).toHaveBeenCalledTimes(1);
      expect(sendReply.mock.calls[0][0]).toContain("Unknown help category");
    });
  });

  describe("/new with Jorchfile approve/output defaults (Phase 5)", () => {
    it("creates session with Jorchfile approve and output defaults", async () => {
      const jorchfile: Jorchfile = {
        projects: [
          {
            name: "auto-silent",
            path: "/tmp/auto-silent",
            commands: {},
            background: [],
            tunnels: [],
            approve: "auto",
            output: "silent",
          },
        ],
        settings: {},
      };
      const executor = createMockExecutor(jorchfile);
      const { deps, sendReply, sessionManager } = createTestDeps({
        getJorchfileExecutor: () => executor as unknown as JorchfileExecutor,
      });
      const router = new CommandRouter(deps);

      await router.route(msg("/new auto-silent"));

      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("auto+silent");

      const record = sessionManager.getSessionRecordByProject("auto-silent");
      expect(record.mode).toBe("auto");
      expect(record.outputMode).toBe("silent");
    });

    it("defaults to confirm+verbose when Jorchfile has no approve/output", async () => {
      const jorchfile = createTestJorchfile();
      const executor = createMockExecutor(jorchfile);
      const { deps, sessionManager } = createTestDeps({
        getJorchfileExecutor: () => executor as unknown as JorchfileExecutor,
      });
      const router = new CommandRouter(deps);

      await router.route(msg("/new frontend"));

      const record = sessionManager.getSessionRecordByProject("frontend");
      expect(record.mode).toBe("confirm");
      expect(record.outputMode).toBe("verbose");
    });
  });

  describe("/mode (Phase 5 — approval only)", () => {
    it("shows current approval mode with no args", async () => {
      const { deps, sendReply, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      sendReply.mockClear();
      await router.route(msg("/mode"));

      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("[frontend]");
      expect(reply).toContain("Approval mode: *confirm*");
    });

    it("changes approval mode to auto", async () => {
      const { deps, sendReply, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      sendReply.mockClear();
      await router.route(msg("/mode auto"));

      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("auto");

      const record = sessionManager.getSessionRecordByProject("frontend");
      expect(record.mode).toBe("auto");
    });

    it("changes approval mode to plan", async () => {
      const { deps, sendReply, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      sendReply.mockClear();
      await router.route(msg("/mode plan"));

      const record = sessionManager.getSessionRecordByProject("frontend");
      expect(record.mode).toBe("plan");
    });

    it("rejects output modes via /mode (use /output instead)", async () => {
      const { deps, sendReply, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      sendReply.mockClear();
      await router.route(msg("/mode silent"));

      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain('Unknown mode "silent"');
      expect(reply).toContain("Valid: confirm, plan, auto");
    });

    it("shows error for invalid mode", async () => {
      const { deps, sendReply, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      sendReply.mockClear();
      await router.route(msg("/mode invalid"));

      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain('Unknown mode "invalid"');
    });

    it("targets specific project with /mode auto backend", async () => {
      const { deps, sendReply, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      await sessionManager.create({ project: "backend", path: "/tmp/backend" }, SENDER);
      const router = new CommandRouter(deps);

      sendReply.mockClear();
      await router.route(msg("/mode auto backend"));

      const record = sessionManager.getSessionRecordByProject("backend");
      expect(record.mode).toBe("auto");

      const frontendRecord = sessionManager.getSessionRecordByProject("frontend");
      expect(frontendRecord.mode).toBe("confirm");
    });

    it("shows error when no focused session", async () => {
      const { deps, sendReply } = createTestDeps();
      const router = new CommandRouter(deps);

      sendReply.mockClear();
      await router.route(msg("/mode"));

      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("No focused session");
    });
  });

  describe("/output (Phase 5 — output modes)", () => {
    it("shows current output mode with no args", async () => {
      const { deps, sendReply, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      sendReply.mockClear();
      await router.route(msg("/output"));

      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("[frontend]");
      expect(reply).toContain("Output mode: *verbose*");
    });

    it("changes output mode to silent", async () => {
      const { deps, sendReply, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      sendReply.mockClear();
      await router.route(msg("/output silent"));

      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("silent");

      const record = sessionManager.getSessionRecordByProject("frontend");
      expect(record.outputMode).toBe("silent");
    });

    it("changes output mode to summary", async () => {
      const { deps, sendReply, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      sendReply.mockClear();
      await router.route(msg("/output summary"));

      const record = sessionManager.getSessionRecordByProject("frontend");
      expect(record.outputMode).toBe("summary");
    });

    it("rejects approval modes via /output (use /mode instead)", async () => {
      const { deps, sendReply, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      const router = new CommandRouter(deps);

      sendReply.mockClear();
      await router.route(msg("/output auto"));

      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain('Unknown output mode "auto"');
      expect(reply).toContain("Valid: verbose, summary, silent");
    });

    it("targets specific project with /output silent backend", async () => {
      const { deps, sendReply, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" }, SENDER);
      await sessionManager.create({ project: "backend", path: "/tmp/backend" }, SENDER);
      const router = new CommandRouter(deps);

      sendReply.mockClear();
      await router.route(msg("/output silent backend"));

      const record = sessionManager.getSessionRecordByProject("backend");
      expect(record.outputMode).toBe("silent");

      const frontendRecord = sessionManager.getSessionRecordByProject("frontend");
      expect(frontendRecord.outputMode).toBe("verbose");
    });

    it("shows error when no focused session", async () => {
      const { deps, sendReply } = createTestDeps();
      const router = new CommandRouter(deps);

      sendReply.mockClear();
      await router.route(msg("/output"));

      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("No focused session");
    });
  });
});
