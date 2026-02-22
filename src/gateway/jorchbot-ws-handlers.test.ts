import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb } from "../db/index.js";
import { buildRpcHandlers, type RpcHandlerDeps } from "./jorchbot-ws-handlers.js";
import type { RpcHandler, WsClient } from "./jorchbot-ws.js";
import { LogBuffer } from "./log-buffer.js";

// Standalone mock fns — avoids oxlint unbound-method when asserting calls
const smMocks = {
  listActive: vi.fn(() => [] as unknown[]),
  setMode: vi.fn(),
  setOutputMode: vi.fn(),
  destroy: vi.fn(),
  checkContextGuard: vi.fn(() => null as unknown),
  getByProject: vi.fn(() => null as unknown),
  getSessionRecordById: vi.fn(() => null as unknown),
  getSessionRecordByProject: vi.fn(() => null as unknown),
  create: vi.fn(),
  switchFocus: vi.fn(),
};

const tmMocks = {
  list: vi.fn(() => [] as unknown[]),
  start: vi.fn(),
  stop: vi.fn(),
  getFunnelProxy: vi.fn(),
};

const fpMocks = {
  listRoutes: vi.fn(() => [] as unknown[]),
  addRoute: vi.fn(),
  removeRoute: vi.fn(),
  isRunning: vi.fn(() => false),
  getPort: vi.fn(() => 9999),
};

// Minimal mock implementations
function createMockDeps(): RpcHandlerDeps {
  // Reset all session manager mocks
  for (const fn of Object.values(smMocks)) {
    fn.mockReset();
  }
  smMocks.listActive.mockReturnValue([]);
  smMocks.checkContextGuard.mockReturnValue(null);
  smMocks.getByProject.mockReturnValue(null);
  smMocks.getSessionRecordById.mockReturnValue(null);
  smMocks.getSessionRecordByProject.mockReturnValue(null);

  // Reset tunnel manager mocks
  for (const fn of Object.values(tmMocks)) {
    fn.mockReset();
  }
  tmMocks.list.mockReturnValue([]);
  tmMocks.getFunnelProxy.mockReturnValue(fpMocks);

  // Reset funnel proxy mocks
  for (const fn of Object.values(fpMocks)) {
    fn.mockReset();
  }
  fpMocks.listRoutes.mockReturnValue([]);
  fpMocks.isRunning.mockReturnValue(false);
  fpMocks.getPort.mockReturnValue(9999);

  return {
    sessionManager: smMocks as unknown as RpcHandlerDeps["sessionManager"],
    tunnelManager: tmMocks as unknown as RpcHandlerDeps["tunnelManager"],
    getJorchfileExecutor: () => null,
    config: {
      gateway: { port: 18789, host: "127.0.0.1" },
      db: {
        path: "~/.jorchbot/jorchbot.db",
        logRetentionDays: 7,
        summaryRetentionDays: 30,
        errorRetentionDays: 90,
        maxSizeMb: 500,
      },
      channels: {
        kapso: {
          enabled: false,
          apiKey: "",
          phoneNumberId: "",
          webhookVerifyToken: "",
          webhookSecret: "",
          dmPolicy: "pairing" as const,
          allowFrom: [],
        },
        telegram: { enabled: false, botToken: "" },
      },
      tunnels: {
        defaultMode: "serve" as const,
        tailscale: { enabled: true },
        funnelProxy: { port: 9999, tailscalePort: 8443 as const },
        health: { intervalMs: 30_000, failureThreshold: 3, maxRestartAttempts: 3 },
      },
      approvals: { timeoutMinutes: 10, pauseTimeoutMinutes: 60, skipPermissions: true },
      sessions: {
        maxConcurrent: 5,
        shellTimeout: 30_000,
        contextGuard: {
          warnPercent: 70,
          criticalPercent: 90,
          blockPercent: 95,
          contextLimit: 200_000,
        },
      },
      gui: { funnel: false },
    },
    getUptime: () => 42,
    logBuffer: new LogBuffer(100),
  };
}

const dummyClient: WsClient = {
  ws: {} as WsClient["ws"],
  id: "test-client",
  authenticated: true,
  connectedAt: Date.now(),
};

describe("JorchBot RPC Handlers", () => {
  let handlers: Record<string, RpcHandler>;
  let deps: RpcHandlerDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    handlers = buildRpcHandlers(deps);
  });

  it("health returns ok and uptime", async () => {
    const result = (await handlers.health({}, dummyClient)) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(result.uptime).toBe(42);
  });

  it("jb.status returns session/tunnel counts", async () => {
    const result = (await handlers["jb.status"]({}, dummyClient)) as Record<string, unknown>;
    expect(result.uptime).toBe(42);
    expect(result.activeSessions).toBe(0);
    expect(result.activeTunnels).toBe(0);
  });

  it("config.get returns serialized config", async () => {
    const result = (await handlers["config.get"]({}, dummyClient)) as { config: string };
    expect(typeof result.config).toBe("string");
    const parsed = JSON.parse(result.config) as Record<string, unknown>;
    expect(parsed).toHaveProperty("gateway");
  });

  it("config.set validates input with Zod schema", () => {
    // Invalid config should throw synchronously (ZodError)
    expect(() =>
      handlers["config.set"]({ config: '{"gateway": {"port": "not-a-number"}}' }, dummyClient),
    ).toThrow();
  });

  it("config.apply reloads config in-memory", async () => {
    const result = (await handlers["config.apply"]({}, dummyClient)) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(result.reloaded).toBe(true);
  });

  it("config.schema returns sections array", async () => {
    const result = (await handlers["config.schema"]({}, dummyClient)) as {
      sections: Array<{ key: string }>;
    };
    expect(Array.isArray(result.sections)).toBe(true);
    expect(result.sections.length).toBeGreaterThan(0);
    const keys = result.sections.map((s) => s.key);
    expect(keys).toContain("gateway");
    expect(keys).toContain("gui");
  });

  it("status is an alias that returns the same shape as jb.status", async () => {
    const result = (await handlers.status({}, dummyClient)) as Record<string, unknown>;
    expect(result.uptime).toBe(42);
    expect(result).toHaveProperty("activeSessions");
    expect(result).toHaveProperty("activeTunnels");
  });

  // --- Phase F: Adapt Existing Tabs ---

  it("sessions.list returns correct shape with count and sessions array", async () => {
    const mockSession = {
      id: "sess-1",
      project: "my-project",
      path: "/home/user/project",
      mode: "confirm",
      outputMode: "verbose",
      contextPercent: 42,
      focused: true,
      status: "active",
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-02"),
    };
    smMocks.listActive.mockReturnValue([mockSession]);

    const result = (await handlers["sessions.list"]({}, dummyClient)) as {
      ts: number;
      count: number;
      sessions: Array<{ key: string; label: string; kind: string }>;
    };

    expect(result.count).toBe(1);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].key).toBe("sess-1");
    expect(result.sessions[0].label).toBe("my-project");
    expect(result.sessions[0].kind).toBe("direct");
  });

  it("channels.status returns both Kapso and Telegram channels", async () => {
    const result = (await handlers["channels.status"]({}, dummyClient)) as {
      channels: Array<{ id: string; name: string; enabled: boolean; status: string }>;
    };

    expect(result.channels).toHaveLength(2);
    expect(result.channels[0].id).toBe("kapso");
    expect(result.channels[0].name).toBe("WhatsApp (Kapso)");
    expect(result.channels[0].enabled).toBe(false);
    expect(result.channels[0].status).toBe("disabled");
    expect(result.channels[1].id).toBe("telegram");
    expect(result.channels[1].name).toBe("Telegram");
  });

  it("logs.tail returns lines from log buffer", async () => {
    deps.logBuffer.push("[jorchbot] gateway ready");
    deps.logBuffer.push("[jorchbot] session started");

    const result = (await handlers["logs.tail"]({}, dummyClient)) as {
      lines: string[];
      cursor: number;
      truncated: boolean;
    };

    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toBe("[jorchbot] gateway ready");
    expect(result.lines[1]).toBe("[jorchbot] session started");
    expect(result.truncated).toBe(false);
  });

  it("logs.tail respects limit parameter", async () => {
    for (let i = 0; i < 10; i++) {
      deps.logBuffer.push(`line ${i}`);
    }

    const result = (await handlers["logs.tail"]({ limit: 3 }, dummyClient)) as {
      lines: string[];
    };

    expect(result.lines).toHaveLength(3);
    expect(result.lines[0]).toBe("line 7");
    expect(result.lines[2]).toBe("line 9");
  });

  it("sessions.usage returns null when project not found", async () => {
    const result = (await handlers["sessions.usage"]({ project: "nonexistent" }, dummyClient)) as {
      contextPercent: number | null;
    };

    expect(result.contextPercent).toBeNull();
  });

  it("sessions.usage returns context info when project found", async () => {
    smMocks.checkContextGuard.mockReturnValue({
      percent: 75,
      level: "warn",
      totalTokens: 150_000,
      contextLimit: 200_000,
      shouldWarn: true,
      shouldBlock: false,
      message: null,
    });

    const result = (await handlers["sessions.usage"]({ project: "my-project" }, dummyClient)) as {
      contextPercent: number;
      level: string;
    };

    expect(result.contextPercent).toBe(75);
    expect(result.level).toBe("warn");
  });

  // --- Phase G: Tab Workspaces ---

  function makeMockSessionRecord(overrides?: Record<string, unknown>) {
    return {
      id: "ws-1",
      project: "my-workspace",
      path: "/home/user/project",
      ownerPhone: "+1234567890",
      claudeSessionId: null,
      mode: "confirm",
      outputMode: "verbose",
      contextPercent: 55,
      status: "active",
      focused: true,
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-02"),
      ...overrides,
    };
  }

  describe("jb.workspaces.list", () => {
    it("returns correct WorkspaceView shape from active sessions", async () => {
      const mockRecord = makeMockSessionRecord();
      smMocks.listActive.mockReturnValue([mockRecord]);

      const result = (await handlers["jb.workspaces.list"]({}, dummyClient)) as {
        ts: number;
        workspaces: Array<Record<string, unknown>>;
      };

      expect(typeof result.ts).toBe("number");
      expect(result.workspaces).toHaveLength(1);
      const ws = result.workspaces[0];
      expect(ws.id).toBe("ws-1");
      expect(ws.name).toBe("my-workspace");
      expect(ws.path).toBe("/home/user/project");
      expect(ws.mode).toBe("confirm");
      expect(ws.outputMode).toBe("verbose");
      expect(ws.contextPercent).toBe(55);
      expect(ws.status).toBe("running"); // "active" maps to "running"
      expect(ws.focused).toBe(true);
      expect(ws.enabled).toBe(true);
      expect(ws.commands).toEqual([]);
    });

    it("maps paused status to stopped and enabled=false", async () => {
      const mockRecord = makeMockSessionRecord({ status: "paused" });
      smMocks.listActive.mockReturnValue([mockRecord]);

      const result = (await handlers["jb.workspaces.list"]({}, dummyClient)) as {
        workspaces: Array<{ status: string; enabled: boolean }>;
      };

      expect(result.workspaces).toHaveLength(1);
      expect(result.workspaces[0].status).toBe("paused");
      expect(result.workspaces[0].enabled).toBe(false);
    });

    it("returns empty array when no sessions", async () => {
      const result = (await handlers["jb.workspaces.list"]({}, dummyClient)) as {
        workspaces: unknown[];
      };
      expect(result.workspaces).toHaveLength(0);
    });
  });

  describe("jb.workspaces.get", () => {
    it("returns workspace for a valid id", async () => {
      const mockRecord = makeMockSessionRecord();
      smMocks.getSessionRecordById.mockReturnValue(mockRecord);

      const result = (await handlers["jb.workspaces.get"]({ id: "ws-1" }, dummyClient)) as {
        workspace: { id: string; name: string };
      };

      expect(result.workspace.id).toBe("ws-1");
      expect(result.workspace.name).toBe("my-workspace");
    });
  });

  describe("jb.workspaces.create", () => {
    it("creates a workspace with valid input and returns WorkspaceView", async () => {
      const mockRecord = makeMockSessionRecord();
      smMocks.create.mockResolvedValue(mockRecord);

      const result = (await handlers["jb.workspaces.create"](
        { project: "new-ws", path: "/tmp/project" },
        dummyClient,
      )) as {
        workspace: { id: string; name: string };
      };

      expect(result.workspace.id).toBe("ws-1");
      expect(smMocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ project: "new-ws", path: "/tmp/project" }),
        "gui",
      );
    });

    it("throws on invalid input (Zod validation)", async () => {
      await expect(
        handlers["jb.workspaces.create"]({ project: "", path: "" }, dummyClient),
      ).rejects.toThrow();
    });
  });

  describe("jb.workspaces.update", () => {
    it("updates mode and outputMode for existing workspace", async () => {
      smMocks.getByProject.mockReturnValue({});

      const result = (await handlers["jb.workspaces.update"](
        { project: "my-workspace", mode: "auto", outputMode: "silent" },
        dummyClient,
      )) as { ok: boolean };

      expect(result.ok).toBe(true);
      expect(smMocks.setMode).toHaveBeenCalledWith("my-workspace", "auto");
      expect(smMocks.setOutputMode).toHaveBeenCalledWith("my-workspace", "silent");
    });

    it("throws SessionNotFoundError for nonexistent workspace", () => {
      expect(() =>
        handlers["jb.workspaces.update"]({ project: "nonexistent" }, dummyClient),
      ).toThrow(/not found/i);
    });
  });

  describe("jb.workspaces.delete", () => {
    it("calls destroy and returns ok", async () => {
      const result = (await handlers["jb.workspaces.delete"](
        { project: "my-workspace" },
        dummyClient,
      )) as { ok: boolean };

      expect(result.ok).toBe(true);
      expect(smMocks.destroy).toHaveBeenCalledWith("my-workspace");
    });
  });

  describe("jb.session.focus", () => {
    it("calls switchFocus with gui phone", async () => {
      const result = (await handlers["jb.session.focus"](
        { project: "my-workspace" },
        dummyClient,
      )) as { ok: boolean };

      expect(result.ok).toBe(true);
      expect(smMocks.switchFocus).toHaveBeenCalledWith("my-workspace", "gui");
    });
  });

  describe("jb.session.compact", () => {
    it("returns contextPercent when project has guard info", async () => {
      smMocks.checkContextGuard.mockReturnValue({ percent: 80, level: "warn" });

      const result = (await handlers["jb.session.compact"](
        { project: "my-workspace" },
        dummyClient,
      )) as { ok: boolean; contextPercent: number };

      expect(result.ok).toBe(true);
      expect(result.contextPercent).toBe(80);
    });

    it("throws SessionNotFoundError when no guard info", () => {
      expect(() => handlers["jb.session.compact"]({ project: "nonexistent" }, dummyClient)).toThrow(
        /not found/i,
      );
    });
  });

  describe("jb.session.stop", () => {
    it("calls destroy and returns ok", async () => {
      const result = (await handlers["jb.session.stop"](
        { project: "my-workspace" },
        dummyClient,
      )) as { ok: boolean };

      expect(result.ok).toBe(true);
      expect(smMocks.destroy).toHaveBeenCalledWith("my-workspace");
    });
  });

  describe("jb.session.restart", () => {
    it("destroys then recreates the session preserving config", async () => {
      const originalRecord = makeMockSessionRecord();
      const recreatedRecord = makeMockSessionRecord({ id: "ws-2" });
      smMocks.getSessionRecordByProject.mockReturnValue(originalRecord);
      smMocks.create.mockResolvedValue(recreatedRecord);

      const result = (await handlers["jb.session.restart"](
        { project: "my-workspace" },
        dummyClient,
      )) as {
        workspace: { id: string; name: string };
      };

      expect(smMocks.destroy).toHaveBeenCalledWith("my-workspace");
      expect(smMocks.create).toHaveBeenCalledWith(
        {
          project: "my-workspace",
          path: "/home/user/project",
          initialMode: "confirm",
          initialOutputMode: "verbose",
        },
        "+1234567890",
      );
      expect(result.workspace.id).toBe("ws-2");
    });

    it("uses gui phone when ownerPhone is null", async () => {
      const record = makeMockSessionRecord({ ownerPhone: null });
      smMocks.getSessionRecordByProject.mockReturnValue(record);
      smMocks.create.mockResolvedValue(record);

      await handlers["jb.session.restart"]({ project: "my-workspace" }, dummyClient);

      expect(smMocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ project: "my-workspace" }),
        "gui",
      );
    });
  });

  describe("jb.workspaces.commands", () => {
    it("list returns empty when no executor", async () => {
      const result = (await handlers["jb.workspaces.commands.list"](
        { project: "my-workspace" },
        dummyClient,
      )) as { commands: unknown[] };

      expect(result.commands).toHaveLength(0);
    });

    it("list returns commands from jorchfile project", async () => {
      const mockProject = { commands: { build: "npm run build", test: "npm test" } };
      const mockExecutor = { getProject: vi.fn(() => mockProject) };
      deps.getJorchfileExecutor = () =>
        mockExecutor as unknown as ReturnType<typeof deps.getJorchfileExecutor>;

      const result = (await handlers["jb.workspaces.commands.list"](
        { project: "my-workspace" },
        dummyClient,
      )) as { commands: Array<{ name: string; command: string }> };

      expect(result.commands).toHaveLength(2);
      expect(result.commands[0].name).toBe("build");
      expect(result.commands[0].command).toBe("npm run build");
      expect(result.commands[1].name).toBe("test");
      expect(result.commands[1].command).toBe("npm test");
    });

    it("create adds a command to the project", async () => {
      const mockProject = { commands: {} as Record<string, string> };
      const mockExecutor = { getProject: vi.fn(() => mockProject) };
      deps.getJorchfileExecutor = () =>
        mockExecutor as unknown as ReturnType<typeof deps.getJorchfileExecutor>;

      const result = (await handlers["jb.workspaces.commands.create"](
        { project: "my-workspace", name: "deploy", command: "npm run deploy" },
        dummyClient,
      )) as { ok: boolean };

      expect(result.ok).toBe(true);
      expect(mockProject.commands.deploy).toBe("npm run deploy");
    });

    it("create returns error when executor not loaded", async () => {
      const result = (await handlers["jb.workspaces.commands.create"](
        { project: "my-workspace", name: "deploy", command: "npm run deploy" },
        dummyClient,
      )) as { ok: boolean; error: string };

      expect(result.ok).toBe(false);
      expect(result.error).toBe("Jorchfile not loaded");
    });

    it("delete removes a command from the project", async () => {
      const mockProject = { commands: { deploy: "npm run deploy" } as Record<string, string> };
      const mockExecutor = { getProject: vi.fn(() => mockProject) };
      deps.getJorchfileExecutor = () =>
        mockExecutor as unknown as ReturnType<typeof deps.getJorchfileExecutor>;

      const result = (await handlers["jb.workspaces.commands.delete"](
        { project: "my-workspace", name: "deploy" },
        dummyClient,
      )) as { ok: boolean };

      expect(result.ok).toBe(true);
      expect(mockProject.commands.deploy).toBeUndefined();
    });
  });

  // --- Phase H: Tab Tunnels + FunnelProxy Management ---

  describe("jb.tunnels.list", () => {
    it("returns array of tunnels", async () => {
      tmMocks.list.mockReturnValue([
        {
          id: "t-1",
          sessionId: "s-1",
          project: "frontend",
          localPort: 3000,
          assignedPort: 3000,
          url: "http://my-machine.ts.net:3000",
          provider: "tailscale-serve",
          mode: "serve",
          status: "active",
          createdAt: new Date("2026-02-21"),
        },
      ]);

      const result = (await handlers["jb.tunnels.list"]({}, dummyClient)) as {
        tunnels: Array<{ id: string; project: string; mode: string }>;
      };

      expect(result.tunnels).toHaveLength(1);
      expect(result.tunnels[0].id).toBe("t-1");
      expect(result.tunnels[0].project).toBe("frontend");
      expect(result.tunnels[0].mode).toBe("serve");
    });

    it("returns empty array when no tunnels", async () => {
      const result = (await handlers["jb.tunnels.list"]({}, dummyClient)) as {
        tunnels: unknown[];
      };
      expect(result.tunnels).toHaveLength(0);
    });
  });

  describe("jb.tunnels.create", () => {
    it("validates input and creates tunnel", async () => {
      const mockTunnel = {
        id: "t-2",
        sessionId: "s-1",
        project: "api",
        localPort: 4000,
        assignedPort: 4000,
        url: "http://my-machine.ts.net:4000",
        provider: "tailscale-serve",
        mode: "serve",
        status: "active",
        createdAt: new Date("2026-02-21"),
      };
      tmMocks.start.mockResolvedValue(mockTunnel);

      const result = (await handlers["jb.tunnels.create"](
        { project: "api", sessionId: "s-1", localPort: 4000, mode: "serve" },
        dummyClient,
      )) as { tunnel: { id: string; project: string } };

      expect(result.tunnel.id).toBe("t-2");
      expect(result.tunnel.project).toBe("api");
    });

    it("throws on invalid input (Zod validation)", async () => {
      await expect(
        handlers["jb.tunnels.create"]({ project: "", sessionId: "", localPort: -1 }, dummyClient),
      ).rejects.toThrow();
    });
  });

  describe("jb.tunnels.delete", () => {
    it("calls stop and returns ok", async () => {
      const result = (await handlers["jb.tunnels.delete"]({ tunnelId: "t-1" }, dummyClient)) as {
        ok: boolean;
      };

      expect(result.ok).toBe(true);
      expect(tmMocks.stop).toHaveBeenCalledWith("t-1");
    });
  });

  describe("jb.proxy.routes.list", () => {
    it("returns routes from funnel proxy", async () => {
      fpMocks.listRoutes.mockReturnValue([
        { path: "/proxy/frontend", target: "http://localhost:3000", project: "frontend" },
      ]);

      const result = (await handlers["jb.proxy.routes.list"]({}, dummyClient)) as {
        routes: Array<{ path: string; target: string }>;
      };

      expect(result.routes).toHaveLength(1);
      expect(result.routes[0].path).toBe("/proxy/frontend");
    });
  });

  describe("jb.proxy.routes.add", () => {
    it("calls addRoute on funnel proxy", async () => {
      const result = (await handlers["jb.proxy.routes.add"](
        { path: "/api", target: "http://localhost:4000" },
        dummyClient,
      )) as { ok: boolean };

      expect(result.ok).toBe(true);
      expect(fpMocks.addRoute).toHaveBeenCalledWith({
        path: "/api",
        target: "http://localhost:4000",
        project: "manual",
      });
    });
  });

  describe("jb.proxy.routes.remove", () => {
    it("calls removeRoute on funnel proxy", async () => {
      const result = (await handlers["jb.proxy.routes.remove"](
        { path: "/proxy/frontend" },
        dummyClient,
      )) as { ok: boolean };

      expect(result.ok).toBe(true);
      expect(fpMocks.removeRoute).toHaveBeenCalledWith("/proxy/frontend");
    });
  });

  describe("jb.proxy.status", () => {
    it("returns proxy running state", async () => {
      fpMocks.isRunning.mockReturnValue(true);
      fpMocks.getPort.mockReturnValue(9999);
      fpMocks.listRoutes.mockReturnValue([
        { path: "/proxy/a", target: "http://localhost:3000", project: "a" },
        { path: "/proxy/b", target: "http://localhost:4000", project: "b" },
      ]);

      const result = (await handlers["jb.proxy.status"]({}, dummyClient)) as {
        running: boolean;
        port: number;
        routeCount: number;
      };

      expect(result.running).toBe(true);
      expect(result.port).toBe(9999);
      expect(result.routeCount).toBe(2);
    });
  });

  // --- Phase I: Tab Devices (device blacklist handlers) ---

  describe("jb.devices.block / unblock / blocked (with real DB)", () => {
    let tempDir: string;
    let originalDbPath: string | undefined;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jorchbot-handlers-devices-"));
      originalDbPath = process.env.JORCHBOT_DB_PATH;
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

    it("jb.devices.block persists device to DB", async () => {
      const result = (await handlers["jb.devices.block"](
        { deviceId: "dev-123", reason: "abusive" },
        dummyClient,
      )) as { ok: boolean };

      expect(result.ok).toBe(true);

      // Verify via blocked list handler
      const listResult = (await handlers["jb.devices.blocked"]({}, dummyClient)) as {
        devices: Array<{ deviceId: string; reason: string | null; blockedAt: number | null }>;
      };
      expect(listResult.devices).toHaveLength(1);
      expect(listResult.devices[0].deviceId).toBe("dev-123");
      expect(listResult.devices[0].reason).toBe("abusive");
      expect(typeof listResult.devices[0].blockedAt).toBe("number");
    });

    it("jb.devices.unblock removes device from DB", async () => {
      // Block first
      await handlers["jb.devices.block"]({ deviceId: "dev-456" }, dummyClient);

      // Verify blocked
      let listResult = (await handlers["jb.devices.blocked"]({}, dummyClient)) as {
        devices: Array<{ deviceId: string }>;
      };
      expect(listResult.devices).toHaveLength(1);

      // Unblock
      const result = (await handlers["jb.devices.unblock"](
        { deviceId: "dev-456" },
        dummyClient,
      )) as { ok: boolean };
      expect(result.ok).toBe(true);

      // Verify unblocked
      listResult = (await handlers["jb.devices.blocked"]({}, dummyClient)) as {
        devices: Array<{ deviceId: string }>;
      };
      expect(listResult.devices).toHaveLength(0);
    });

    it("jb.devices.blocked returns empty array when no devices blocked", async () => {
      const result = (await handlers["jb.devices.blocked"]({}, dummyClient)) as {
        devices: unknown[];
      };
      expect(result.devices).toHaveLength(0);
    });

    it("jb.devices.block without reason stores null", async () => {
      await handlers["jb.devices.block"]({ deviceId: "dev-no-reason" }, dummyClient);

      const listResult = (await handlers["jb.devices.blocked"]({}, dummyClient)) as {
        devices: Array<{ deviceId: string; reason: string | null }>;
      };
      expect(listResult.devices).toHaveLength(1);
      expect(listResult.devices[0].reason).toBeNull();
    });
  });

  // --- Phase J: Tab Jorchfile Editor ---

  describe("jb.jorchfile.get", () => {
    it("returns null jorchfile when executor is not available", async () => {
      const result = (await handlers["jb.jorchfile.get"]({}, dummyClient)) as {
        jorchfile: null;
      };
      expect(result.jorchfile).toBeNull();
    });

    it("returns jorchfile with projects and settings from executor", async () => {
      const mockJorchfile = {
        projects: [
          {
            name: "frontend",
            path: "/home/user/frontend",
            commands: { build: "npm run build", dev: "npm run dev" },
            instructions: "React SPA",
            approve: "auto",
            output: "verbose",
            port: 3000,
            tunnels: [{ mode: "serve", port: 3000, path: undefined }],
            background: false,
          },
          {
            name: "backend",
            path: "/home/user/backend",
            commands: {},
            tunnels: [],
            background: false,
          },
        ],
        settings: {
          logRetentionDays: 7,
          dbMaxSizeMb: 500,
        },
      };
      const mockExecutor = {
        getJorchfile: vi.fn(() => mockJorchfile),
        getProject: vi.fn(),
      };
      deps.getJorchfileExecutor = () =>
        mockExecutor as unknown as ReturnType<typeof deps.getJorchfileExecutor>;

      const result = (await handlers["jb.jorchfile.get"]({}, dummyClient)) as {
        jorchfile: {
          projects: Array<{
            name: string;
            path: string;
            commands: Record<string, string>;
            tunnel?: string;
          }>;
          settings: { logRetentionDays?: number; dbMaxSizeMb?: number };
        };
      };

      expect(result.jorchfile).not.toBeNull();
      expect(result.jorchfile.projects).toHaveLength(2);

      const fe = result.jorchfile.projects[0];
      expect(fe.name).toBe("frontend");
      expect(fe.path).toBe("/home/user/frontend");
      expect(fe.commands).toEqual({ build: "npm run build", dev: "npm run dev" });
      expect(fe.tunnel).toBe("serve:3000");

      const be = result.jorchfile.projects[1];
      expect(be.name).toBe("backend");
      expect(be.tunnel).toBeUndefined();

      expect(result.jorchfile.settings.logRetentionDays).toBe(7);
      expect(result.jorchfile.settings.dbMaxSizeMb).toBe(500);
    });
  });

  describe("jb.jorchfile.set", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jorchbot-handlers-jorchfile-"));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("writes content to the specified path", async () => {
      const filePath = path.join(tempDir, "Jorchfile");
      const content = "PROJECT frontend\n  path = /home/user/frontend\n";

      const result = (await handlers["jb.jorchfile.set"](
        { content, path: filePath },
        dummyClient,
      )) as { ok: boolean };

      expect(result.ok).toBe(true);
      const written = fs.readFileSync(filePath, "utf-8");
      expect(written).toBe(content);
    });
  });

  describe("jb.jorchfile.commands", () => {
    it("returns empty array when executor is not available", async () => {
      const result = (await handlers["jb.jorchfile.commands"](
        { project: "frontend" },
        dummyClient,
      )) as { commands: unknown[] };

      expect(result.commands).toHaveLength(0);
    });

    it("returns empty array when project is not found", async () => {
      const mockExecutor = {
        getJorchfile: vi.fn(),
        getProject: vi.fn(() => null),
      };
      deps.getJorchfileExecutor = () =>
        mockExecutor as unknown as ReturnType<typeof deps.getJorchfileExecutor>;

      const result = (await handlers["jb.jorchfile.commands"](
        { project: "nonexistent" },
        dummyClient,
      )) as { commands: unknown[] };

      expect(result.commands).toHaveLength(0);
    });

    it("returns commands from the specified project", async () => {
      const mockProject = {
        commands: { build: "npm run build", test: "npm test", lint: "npm run lint" },
      };
      const mockExecutor = {
        getJorchfile: vi.fn(),
        getProject: vi.fn(() => mockProject),
      };
      deps.getJorchfileExecutor = () =>
        mockExecutor as unknown as ReturnType<typeof deps.getJorchfileExecutor>;

      const result = (await handlers["jb.jorchfile.commands"](
        { project: "frontend" },
        dummyClient,
      )) as { commands: Array<{ name: string; command: string }> };

      expect(result.commands).toHaveLength(3);
      expect(result.commands[0].name).toBe("build");
      expect(result.commands[0].command).toBe("npm run build");
      expect(result.commands[1].name).toBe("test");
      expect(result.commands[1].command).toBe("npm test");
      expect(result.commands[2].name).toBe("lint");
      expect(result.commands[2].command).toBe("npm run lint");
    });
  });
});
