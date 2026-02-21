import { describe, it, expect, vi, beforeEach } from "vitest";
import { JorchfileProjectNotFoundError, JorchfileCommandNotFoundError } from "../errors/index.js";
import type { JorchfileExecutorDeps } from "./executor.js";
import { JorchfileExecutor } from "./executor.js";
import type { Jorchfile } from "./parser.js";

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
      {
        name: "kiwi-auth",
        path: "/tmp/kiwi",
        commands: { start: "make start-bg" },
        background: ["start"],
        tunnels: [
          { mode: "serve", port: 3000 },
          { mode: "serve", port: 5173 },
          { mode: "funnel", port: 8080, path: "/gateway" },
        ],
      },
    ],
    settings: {},
  };
}

function createMockDeps(jorchfile: Jorchfile) {
  const sessionManager = {
    getByProject: vi.fn().mockReturnValue({ id: "sess-1", project: "frontend" }),
    getFocused: vi.fn().mockReturnValue({ project: "frontend" }),
    create: vi.fn().mockResolvedValue({ id: "sess-1", project: "frontend" }),
  };
  const shellRunner = {
    execute: vi.fn().mockResolvedValue({
      stdout: "test output",
      stderr: "",
      exitCode: 0,
      truncated: false,
    }),
  };
  const taskManager = {
    start: vi.fn().mockResolvedValue({ pid: 12345 }),
    listByProject: vi.fn().mockReturnValue([]),
  };
  const portManager = {
    findAvailablePort: vi.fn().mockImplementation((port: number) => Promise.resolve(port)),
  };
  const tunnelManager = {
    start: vi.fn().mockResolvedValue(undefined),
    stopByProjectPort: vi.fn().mockResolvedValue(undefined),
    stopByProject: vi.fn().mockResolvedValue(undefined),
  };
  const sendReply = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  const sendButtons = vi
    .fn<(text: string, buttons: Array<{ id: string; title: string }>) => Promise<void>>()
    .mockResolvedValue(undefined);

  return {
    sessionManager,
    shellRunner,
    taskManager,
    portManager,
    tunnelManager,
    sendReply,
    sendButtons,
    // The full deps object for the executor constructor
    asDeps(): JorchfileExecutorDeps {
      return {
        jorchfile,
        sessionManager: sessionManager as unknown as JorchfileExecutorDeps["sessionManager"],
        shellRunner: shellRunner as unknown as JorchfileExecutorDeps["shellRunner"],
        taskManager: taskManager as unknown as JorchfileExecutorDeps["taskManager"],
        portManager: portManager as unknown as JorchfileExecutorDeps["portManager"],
        tunnelManager: tunnelManager as unknown as JorchfileExecutorDeps["tunnelManager"],
        sendReply,
        sendButtons,
      };
    },
  };
}

describe("JorchfileExecutor", () => {
  let jorchfile: Jorchfile;
  let mocks: ReturnType<typeof createMockDeps>;
  let executor: JorchfileExecutor;

  beforeEach(() => {
    jorchfile = createTestJorchfile();
    mocks = createMockDeps(jorchfile);
    executor = new JorchfileExecutor(mocks.asDeps());
  });

  it("hasCommand() returns true for existing commands", () => {
    expect(executor.hasCommand("dev")).toBe(true);
    expect(executor.hasCommand("test")).toBe(true);
    expect(executor.hasCommand("build")).toBe(true);
  });

  it("hasCommand() returns false for unknown commands", () => {
    expect(executor.hasCommand("deploy")).toBe(false);
    expect(executor.hasCommand("lint")).toBe(false);
  });

  it("getProject() returns project by name", () => {
    const project = executor.getProject("frontend");

    expect(project).not.toBeNull();
    expect(project!.name).toBe("frontend");
    expect(project!.path).toBe("/tmp/frontend");
  });

  it("execute() calls ShellRunner for foreground commands", async () => {
    await executor.execute("test", "frontend", false);

    expect(mocks.shellRunner.execute).toHaveBeenCalledWith("npm run test", "/tmp/frontend");
    expect(mocks.sendReply).toHaveBeenCalledWith(expect.stringContaining("npm run test"));
  });

  it("execute() calls TaskManager for commands in project's background list", async () => {
    await executor.execute("dev", "frontend", false);

    expect(mocks.taskManager.start).toHaveBeenCalledWith(
      expect.objectContaining({
        project: "frontend",
        commandName: "dev",
        shellCommand: "npm run dev",
      }),
    );
  });

  it("execute() auto-creates session if none exists", async () => {
    mocks.sessionManager.getByProject.mockReturnValue(null);

    await executor.execute("test", "frontend", false, "+521234567890");

    expect(mocks.sessionManager.create).toHaveBeenCalledWith(
      expect.objectContaining({
        project: "frontend",
        path: "/tmp/frontend",
      }),
      "+521234567890",
    );
    expect(mocks.sendReply).toHaveBeenCalledWith(
      expect.stringContaining("Session auto-created from Jorchfile"),
    );
  });

  it("execute() throws JorchfileProjectNotFoundError for unknown project", async () => {
    await expect(executor.execute("dev", "nonexistent", false)).rejects.toThrow(
      JorchfileProjectNotFoundError,
    );
  });

  it("execute() throws JorchfileCommandNotFoundError for missing command", async () => {
    await expect(executor.execute("deploy", "frontend", false)).rejects.toThrow(
      JorchfileCommandNotFoundError,
    );
  });

  it("execute() sends duplicate-task buttons when same command already running", async () => {
    mocks.taskManager.listByProject.mockReturnValue([
      { pid: 99999, commandName: "dev", project: "frontend" },
    ]);

    await executor.execute("dev", "frontend", false);

    expect(mocks.sendButtons).toHaveBeenCalledWith(
      expect.stringContaining("already running"),
      expect.arrayContaining([
        expect.objectContaining({ title: "Stop & restart" }),
        expect.objectContaining({ title: "Run another" }),
      ]),
    );
    // Should NOT start a new task
    expect(mocks.taskManager.start).not.toHaveBeenCalled();
  });

  it("execute() starts multiple tunnels for multi-entry project", async () => {
    await executor.execute("start", "kiwi-auth", false);

    expect(mocks.tunnelManager.start).toHaveBeenCalledTimes(3);
    expect(mocks.tunnelManager.start).toHaveBeenCalledWith(
      expect.objectContaining({
        project: "kiwi-auth",
        localPort: 3000,
        mode: "serve",
        autoConfirm: true,
      }),
    );
    expect(mocks.tunnelManager.start).toHaveBeenCalledWith(
      expect.objectContaining({
        project: "kiwi-auth",
        localPort: 5173,
        mode: "serve",
        autoConfirm: true,
      }),
    );
    expect(mocks.tunnelManager.start).toHaveBeenCalledWith(
      expect.objectContaining({
        project: "kiwi-auth",
        localPort: 8080,
        mode: "funnel",
        funnelPath: "/gateway",
        autoConfirm: true,
      }),
    );
  });

  it("execute() continues starting tunnels after TunnelPendingConfirmation", async () => {
    const { TunnelPendingConfirmation } = await import("../tunnels/manager.js");

    // First two tunnels succeed, third (funnel) throws PendingConfirmation
    mocks.tunnelManager.start
      .mockResolvedValueOnce(undefined) // serve:3000
      .mockResolvedValueOnce(undefined) // serve:5173
      .mockImplementationOnce(() => {
        throw new TunnelPendingConfirmation("tunnel-id");
      }); // funnel:8080

    await executor.execute("start", "kiwi-auth", false);

    // All 3 tunnels attempted
    expect(mocks.tunnelManager.start).toHaveBeenCalledTimes(3);
    // No error reply sent (PendingConfirmation is expected)
    expect(mocks.sendReply).not.toHaveBeenCalledWith(expect.stringContaining("Failed to start"));
  });
});
