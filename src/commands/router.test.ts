import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, getDb } from "../db/index.js";
import { messages } from "../db/schema.js";
import { SessionManager } from "../sessions/jorchbot/manager.js";
import { ShellRunner } from "../sessions/jorchbot/shell-runner.js";
import { CommandRouter } from "./router.js";
import type { CommandRouterDeps } from "./router.js";

// --- Test helpers ---

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
    on: vi.fn(),
    emit: vi.fn(),
  };
}

function createTestDeps(overrides?: Partial<CommandRouterDeps>) {
  const sendReply = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  const sendButtons = vi
    .fn<(text: string, buttons: Array<{ id: string; title: string }>) => Promise<void>>()
    .mockResolvedValue(undefined);

  const sessionManager = new SessionManager({
    sendReply,
    sendButtons,
    createRunner: () => createMockRunner() as never,
  });

  const shellRunner = new ShellRunner();

  return {
    sendReply,
    sendButtons,
    sessionManager,
    shellRunner,
    deps: {
      sessionManager,
      shellRunner,
      sendReply,
      sendButtons,
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
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" });
      const router = new CommandRouter(deps);

      await router.route(msg("$ echo hello"));

      expect(sendReply).toHaveBeenCalled();
      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("[frontend] $ echo hello");
      expect(reply).toContain("hello");
    });

    it("routes / prefix to command handlers", async () => {
      const { deps, sendReply } = createTestDeps();
      const router = new CommandRouter(deps);

      await router.route(msg("/help"));

      expect(sendReply).toHaveBeenCalledTimes(1);
      expect(sendReply.mock.calls[0][0]).toContain("/new");
    });

    it("routes free text to focused session", async () => {
      const { deps, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" });
      const router = new CommandRouter(deps);

      const focused = sessionManager.getFocused()!;
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
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" });
      await sessionManager.create({ project: "backend", path: "/tmp/backend" });
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
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" });
      await sessionManager.create({ project: "backend", path: "/tmp/backend" });
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
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" });
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
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" });
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
      await sessionManager.create({ project: "frontend", path: "/tmp" });
      const router = new CommandRouter(deps);

      sendReply.mockClear();
      await router.route(msg("/ls"));

      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("[frontend] $ ls -la");
    });

    it("/git maps to git command", async () => {
      const { deps, sendReply, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp" });
      const router = new CommandRouter(deps);

      sendReply.mockClear();
      await router.route(msg("/git status"));

      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("[frontend] $ git status");
    });

    it("/pwd maps to pwd", async () => {
      const { deps, sendReply, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp" });
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
      await sessionManager.create({ project: "frontend", path: "/tmp" });
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
      await sessionManager.create({ project: "frontend", path: "/tmp" });
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
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" });
      const router = new CommandRouter(deps);

      const focused = sessionManager.getFocused()!;
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
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" });
      const router = new CommandRouter(deps);

      const focused = sessionManager.getFocused()!;
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
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" });
      const router = new CommandRouter(deps);

      const focused = sessionManager.getFocused()!;
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
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" });
      const router = new CommandRouter(deps);

      const focused = sessionManager.getFocused()!;
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
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" });
      const router = new CommandRouter(deps);

      sendReply.mockClear();
      await router.route(msg("!clear"));

      expect(sendReply).toHaveBeenCalled();
      const reply = sendReply.mock.calls[sendReply.mock.calls.length - 1][0];
      expect(reply).toContain("[frontend] Session cleared");
    });

    it("!status forwards /status as prompt to Claude Code", async () => {
      const { deps, sessionManager } = createTestDeps();
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" });
      const router = new CommandRouter(deps);

      const focused = sessionManager.getFocused()!;
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
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" });
      const router = new CommandRouter(deps);

      const focused = sessionManager.getFocused()!;
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
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" });
      const router = new CommandRouter(deps);

      const focused = sessionManager.getFocused()!;
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
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" });
      const router = new CommandRouter(deps);

      const focused = sessionManager.getFocused()!;
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
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" });
      const router = new CommandRouter(deps);

      const focused = sessionManager.getFocused()!;
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
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" });
      const router = new CommandRouter(deps);

      const focused = sessionManager.getFocused()!;
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
      await sessionManager.create({ project: "frontend", path: "/tmp/frontend" });
      const router = new CommandRouter(deps);

      const focused = sessionManager.getFocused()!;
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
      const session = await sessionManager.create({ project: "frontend", path: "/tmp/frontend" });
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
      const session = await sessionManager.create({ project: "frontend", path: "/tmp" });
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
      await sessionManager.create({ project: "frontend", path: "/tmp" });
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
      await sessionManager.create({ project: "frontend", path: "/tmp" });
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
