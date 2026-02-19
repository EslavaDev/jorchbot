import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  ClaudeRunnerSpawnError,
  ClaudeRunnerProcessError,
  ClaudeRunnerTimeoutError,
} from "../../errors/index.js";
import { ClaudeRunner } from "./claude-runner.js";

function createMockProcess() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = { writable: true, write: vi.fn() };
  const proc = Object.assign(new EventEmitter(), {
    stdout,
    stderr,
    stdin,
    pid: 12345,
    kill: vi.fn(),
  });
  return proc;
}

function feedLine(proc: ReturnType<typeof createMockProcess>, data: unknown) {
  proc.stdout.write(JSON.stringify(data) + "\n");
}

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";
const mockSpawn = vi.mocked(spawn);

describe("ClaudeRunner", () => {
  let runner: ClaudeRunner;

  beforeEach(() => {
    runner = new ClaudeRunner();
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await runner.stop();
  });

  describe("start()", () => {
    it("spawns claude with --dangerously-skip-permissions by default", () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as never);

      const promise = runner.start({ prompt: "hello", cwd: "/tmp" });

      expect(mockSpawn).toHaveBeenCalledWith(
        "claude",
        ["-p", "hello", "--output-format", "stream-json", "--dangerously-skip-permissions"],
        expect.objectContaining({ cwd: "/tmp" }),
      );

      // Resolve by exiting cleanly
      proc.emit("exit", 0, null);
      return promise;
    });

    it("omits --dangerously-skip-permissions when skipPermissions is false", () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as never);

      const promise = runner.start({ prompt: "hello", cwd: "/tmp", skipPermissions: false });

      expect(mockSpawn).toHaveBeenCalledWith(
        "claude",
        ["-p", "hello", "--output-format", "stream-json"],
        expect.objectContaining({ cwd: "/tmp" }),
      );

      proc.emit("exit", 0, null);
      return promise;
    });

    it("uses stdin 'ignore' when skipPermissions is true (default)", () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as never);

      const promise = runner.start({ prompt: "hello", cwd: "/tmp" });

      expect(mockSpawn).toHaveBeenCalledWith(
        "claude",
        expect.any(Array),
        expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] }),
      );

      proc.emit("exit", 0, null);
      return promise;
    });

    it("uses stdin 'pipe' when skipPermissions is false", () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as never);

      const promise = runner.start({ prompt: "hello", cwd: "/tmp", skipPermissions: false });

      expect(mockSpawn).toHaveBeenCalledWith(
        "claude",
        expect.any(Array),
        expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
      );

      proc.emit("exit", 0, null);
      return promise;
    });

    it("includes --append-system-prompt when systemPrompt is provided", () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as never);

      const promise = runner.start({
        prompt: "hello",
        cwd: "/tmp",
        systemPrompt: "You are in PLAN mode.",
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        "claude",
        expect.arrayContaining(["--append-system-prompt", "You are in PLAN mode."]),
        expect.any(Object),
      );

      proc.emit("exit", 0, null);
      return promise;
    });

    it("parses session_id from init event", async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as never);

      const promise = runner.start({ prompt: "test", cwd: "/tmp" });

      feedLine(proc, { type: "system", subtype: "init", session_id: "sess_abc123" });

      // Allow readline to process the line
      await vi.advanceTimersByTimeAsync(0);

      proc.emit("exit", 0, null);
      await promise;

      expect(runner.getSessionId()).toBe("sess_abc123");
    });

    it("emits text events from assistant messages", async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as never);

      const textEvents: string[] = [];
      runner.on("text", (text) => textEvents.push(text));

      const promise = runner.start({ prompt: "test", cwd: "/tmp" });

      feedLine(proc, {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "Hello world" }] },
      });

      await vi.advanceTimersByTimeAsync(0);

      proc.emit("exit", 0, null);
      await promise;

      expect(textEvents).toEqual(["Hello world"]);
    });

    it("emits toolUse events (informational, not blocking)", async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as never);

      const toolEvents: unknown[] = [];
      runner.on("toolUse", (req) => toolEvents.push(req));

      const promise = runner.start({ prompt: "test", cwd: "/tmp" });

      feedLine(proc, {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_xyz",
              name: "Bash",
              input: { command: "npm test" },
            },
          ],
        },
      });

      await vi.advanceTimersByTimeAsync(0);

      // With --dangerously-skip-permissions, status stays "running" (no approval wait)
      expect(runner.getStatus()).toBe("running");
      expect(toolEvents).toHaveLength(1);

      proc.emit("exit", 0, null);
      return promise;
    });

    it("calculates context percent from result usage", async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as never);

      const promise = runner.start({ prompt: "test", cwd: "/tmp" });

      feedLine(proc, {
        type: "result",
        subtype: "success",
        session_id: "sess_123",
        usage: { input_tokens: 100_000, output_tokens: 50_000 },
        cost_usd: 0.05,
        duration_ms: 3000,
      });

      await vi.advanceTimersByTimeAsync(0);

      proc.emit("exit", 0, null);
      await promise;

      expect(runner.getContextPercent()).toBe(75);
    });

    it("rejects with ClaudeRunnerSpawnError on spawn error event", async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as never);

      const promise = runner.start({ prompt: "test", cwd: "/tmp" });

      proc.emit("error", new Error("spawn ENOENT"));

      await expect(promise).rejects.toThrow(ClaudeRunnerSpawnError);
    });

    it("rejects with ClaudeRunnerTimeoutError after timeout", async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as never);

      const promise = runner.start({ prompt: "test", cwd: "/tmp", timeoutMs: 1000 });

      // Attach catch handler before advancing timers to prevent unhandled rejection
      const rejection = promise.catch((err: unknown) => err);

      // Simulate process exiting after kill from stop()
      proc.kill.mockImplementation(() => {
        queueMicrotask(() => proc.emit("exit", null, "SIGTERM"));
      });

      await vi.advanceTimersByTimeAsync(1001);

      const err = await rejection;
      expect(err).toBeInstanceOf(ClaudeRunnerTimeoutError);
    });

    it("rejects with ClaudeRunnerProcessError on non-zero exit", async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as never);

      const promise = runner.start({ prompt: "test", cwd: "/tmp" });

      proc.emit("exit", 1, null);

      await expect(promise).rejects.toThrow(ClaudeRunnerProcessError);
    });
  });

  describe("resume()", () => {
    it("throws ClaudeRunnerProcessError if no session to resume", async () => {
      await expect(runner.resume({ prompt: "test", cwd: "/tmp" })).rejects.toThrow(
        ClaudeRunnerProcessError,
      );
    });

    it("passes --resume flag with session ID", async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as never);

      // First start to get session ID
      const startPromise = runner.start({ prompt: "init", cwd: "/tmp" });

      feedLine(proc, { type: "system", subtype: "init", session_id: "sess_abc" });
      await vi.advanceTimersByTimeAsync(0);

      proc.emit("exit", 0, null);
      await startPromise;

      // Now resume
      const proc2 = createMockProcess();
      mockSpawn.mockReturnValue(proc2 as never);

      const resumePromise = runner.resume({ prompt: "continue", cwd: "/tmp" });

      expect(mockSpawn).toHaveBeenLastCalledWith(
        "claude",
        ["-p", "continue", "--resume", "sess_abc", "--output-format", "stream-json"],
        expect.objectContaining({ cwd: "/tmp" }),
      );

      proc2.emit("exit", 0, null);
      return resumePromise;
    });
  });

  describe("getContextPercent()", () => {
    it("returns 0 when no tokens used", () => {
      expect(runner.getContextPercent()).toBe(0);
    });

    it("never decreases across resumes (context only grows)", async () => {
      const proc1 = createMockProcess();
      mockSpawn.mockReturnValue(proc1 as never);

      const startPromise = runner.start({ prompt: "init", cwd: "/tmp" });

      feedLine(proc1, { type: "system", subtype: "init", session_id: "sess_ctx" });
      // First run: 34K total tokens (e.g. multi-tool agentic loop)
      feedLine(proc1, {
        type: "result",
        session_id: "sess_ctx",
        usage: { input_tokens: 30_000, output_tokens: 4_000 },
      });
      await vi.advanceTimersByTimeAsync(0);

      proc1.emit("exit", 0, null);
      const result1 = await startPromise;

      expect(result1.inputTokens).toBe(30_000);
      expect(result1.outputTokens).toBe(4_000);
      expect(runner.getContextPercent()).toBe(17); // 34K/200K

      // Second run via resume: reports fewer tokens (e.g. single-turn reply)
      const proc2 = createMockProcess();
      mockSpawn.mockReturnValue(proc2 as never);

      const resumePromise = runner.resume({ prompt: "continue", cwd: "/tmp" });

      feedLine(proc2, {
        type: "result",
        session_id: "sess_ctx",
        usage: { input_tokens: 29_000, output_tokens: 4_000 },
      });
      await vi.advanceTimersByTimeAsync(0);

      proc2.emit("exit", 0, null);
      const result2 = await resumePromise;

      // Context % must NOT decrease — should keep the peak (34K, not 33K)
      expect(result2.inputTokens).toBe(30_000);
      expect(result2.outputTokens).toBe(4_000);
      expect(runner.getContextPercent()).toBe(17); // Still 34K/200K, not 33K
    });
  });

  describe("stop()", () => {
    it("sets status to stopped", async () => {
      await runner.stop();
      expect(runner.getStatus()).toBe("stopped");
    });
  });
});
