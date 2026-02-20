import { tmpdir } from "node:os";
import { describe, it, expect, afterEach, vi } from "vitest";
import { BackgroundTaskNotFoundError } from "../errors/index.js";
import { BackgroundTaskManager, formatUptime } from "./task-manager.js";

describe("BackgroundTaskManager", () => {
  const sendReply = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  let manager: BackgroundTaskManager;

  afterEach(() => {
    // Kill all spawned processes
    for (const task of manager.listAll()) {
      try {
        task.process.kill("SIGTERM");
      } catch {
        // already dead
      }
    }
    sendReply.mockClear();
  });

  function createManager(): BackgroundTaskManager {
    manager = new BackgroundTaskManager({ sendReply });
    return manager;
  }

  it("starts a task and assigns PID", async () => {
    const mgr = createManager();
    const task = await mgr.start({
      project: "frontend",
      commandName: "dev",
      shellCommand: "sleep 60",
      cwd: tmpdir(),
    });

    expect(task.pid).toBeGreaterThan(0);
    expect(task.project).toBe("frontend");
    expect(task.commandName).toBe("dev");
  });

  it("lists all tasks across projects", async () => {
    const mgr = createManager();
    await mgr.start({
      project: "frontend",
      commandName: "dev",
      shellCommand: "sleep 60",
      cwd: tmpdir(),
    });
    await mgr.start({
      project: "backend",
      commandName: "dev",
      shellCommand: "sleep 60",
      cwd: tmpdir(),
    });

    const all = mgr.listAll();

    expect(all).toHaveLength(2);
  });

  it("stops a specific task by project+commandName", async () => {
    const mgr = createManager();
    const task = await mgr.start({
      project: "frontend",
      commandName: "dev",
      shellCommand: "sleep 60",
      cwd: tmpdir(),
    });

    mgr.stop("frontend", "dev");

    // Wait for process to exit
    await new Promise<void>((resolve) => {
      task.process.on("exit", () => resolve());
    });

    expect(mgr.listByProject("frontend")).toHaveLength(0);
  });

  it("stops all tasks for a project", async () => {
    const mgr = createManager();
    const t1 = await mgr.start({
      project: "frontend",
      commandName: "dev",
      shellCommand: "sleep 60",
      cwd: tmpdir(),
    });
    const t2 = await mgr.start({
      project: "frontend",
      commandName: "build",
      shellCommand: "sleep 60",
      cwd: tmpdir(),
    });

    const killed = mgr.stopAll("frontend");

    expect(killed).toBe(2);

    // Wait for processes to exit
    await Promise.all([
      new Promise<void>((resolve) => {
        t1.process.on("exit", () => resolve());
      }),
      new Promise<void>((resolve) => {
        t2.process.on("exit", () => resolve());
      }),
    ]);
  });

  it("throws BackgroundTaskNotFoundError for unknown task", () => {
    const mgr = createManager();

    expect(() => mgr.stop("nonexistent", "dev")).toThrow(BackgroundTaskNotFoundError);
  });

  it("formatUptime returns human-readable string", () => {
    const now = new Date();

    // 30 seconds ago
    expect(formatUptime(new Date(now.getTime() - 30_000))).toBe("30s");

    // 5 minutes 10 seconds ago
    expect(formatUptime(new Date(now.getTime() - 310_000))).toBe("5m 10s");

    // 2 hours 15 minutes ago
    expect(formatUptime(new Date(now.getTime() - 8_100_000))).toBe("2h 15m");
  });
});
