import { beforeEach, describe, expect, it, vi } from "vitest";
import { TunnelManager, TunnelPendingConfirmation } from "./manager.js";
import type { TunnelManagerDeps } from "./manager.js";

function createMockDeps() {
  return {
    serveAdapter: {
      ensureAvailable: vi.fn().mockResolvedValue(undefined),
      getHostname: vi.fn().mockResolvedValue("mydevice.ts.net"),
      start: vi.fn().mockResolvedValue({ url: "http://mydevice.ts.net:3000" }),
      stop: vi.fn().mockResolvedValue(undefined),
      isActive: vi.fn().mockResolvedValue(true),
    },
    funnelAdapter: {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      isActive: vi.fn().mockResolvedValue(true),
    },
    funnelProxy: {
      getPort: vi.fn().mockReturnValue(9999),
      isRunning: vi.fn().mockReturnValue(false),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      addRoute: vi.fn(),
      removeRoute: vi.fn(),
      listRoutes: vi.fn().mockReturnValue([]),
      hasRoute: vi.fn().mockReturnValue(false),
    },
    funnelPublicPort: 8443,
    healthMonitor: {
      start: vi.fn(),
      stop: vi.fn(),
      checkAll: vi.fn().mockResolvedValue({ tunnels: [], allHealthy: true }),
    },
    db: {
      insert: vi.fn(),
      updateStatus: vi.fn(),
      listActive: vi.fn().mockReturnValue([]),
      getById: vi.fn().mockReturnValue(undefined),
    },
    callbacks: {
      onNotify: vi.fn(),
      onConfirmFunnel: vi.fn(),
    },
  };
}

describe("TunnelManager", () => {
  let manager: TunnelManager;
  let mocks: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    mocks = createMockDeps();
    manager = new TunnelManager(mocks as unknown as TunnelManagerDeps);
  });

  it("start() with serve mode creates tunnel with direct tailnet URL", async () => {
    const result = await manager.start({
      project: "frontend",
      sessionId: "session-1",
      localPort: 3000,
      mode: "serve",
    });

    expect(result.project).toBe("frontend");
    expect(result.mode).toBe("serve");
    expect(result.url).toBe("http://mydevice.ts.net:3000");
    expect(result.status).toBe("active");
    expect(mocks.serveAdapter.start).toHaveBeenCalledWith(3000);
    expect(mocks.db.insert).toHaveBeenCalledTimes(1);
    expect(mocks.callbacks.onNotify).toHaveBeenCalledWith(
      expect.objectContaining({ type: "tunnel:started" }),
    );
  });

  it("start() with funnel mode throws TunnelPendingConfirmation by default", async () => {
    try {
      await manager.start({
        project: "frontend",
        sessionId: "session-1",
        localPort: 3000,
        mode: "funnel",
      });
      expect.unreachable("should throw");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(TunnelPendingConfirmation);
      expect(mocks.callbacks.onConfirmFunnel).toHaveBeenCalledTimes(1);
    }
  });

  it("start() with funnel mode + autoConfirm skips confirmation", async () => {
    const result = await manager.start({
      project: "frontend",
      sessionId: "session-1",
      localPort: 3000,
      mode: "funnel",
      autoConfirm: true,
    });

    expect(result.mode).toBe("funnel");
    expect(result.url).toBe("https://mydevice.ts.net:8443/frontend");
    expect(mocks.callbacks.onConfirmFunnel).not.toHaveBeenCalled();
    expect(mocks.funnelProxy.start).toHaveBeenCalled();
    // Adapter receives public port + local proxy port
    expect(mocks.funnelAdapter.start).toHaveBeenCalledWith(8443, 9999);
  });

  it("confirmFunnel() creates funnel tunnel with proxy route", async () => {
    // Start funnel (pending)
    let pendingId: string | undefined;
    try {
      await manager.start({
        project: "frontend",
        sessionId: "session-1",
        localPort: 3000,
        mode: "funnel",
      });
    } catch (err: unknown) {
      if (err instanceof TunnelPendingConfirmation) {
        pendingId = err.tunnelId;
      }
    }

    expect(pendingId).toBeDefined();

    // Confirm
    const result = await manager.confirmFunnel(pendingId!);

    expect(result.mode).toBe("funnel");
    expect(result.url).toBe("https://mydevice.ts.net:8443/frontend");
    expect(mocks.funnelProxy.start).toHaveBeenCalled();
    expect(mocks.funnelAdapter.start).toHaveBeenCalledWith(8443, 9999);
    expect(mocks.funnelProxy.addRoute).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/frontend" }),
    );
  });

  it("cancelFunnel() discards pending", async () => {
    let pendingId: string | undefined;
    try {
      await manager.start({
        project: "frontend",
        sessionId: "session-1",
        localPort: 3000,
        mode: "funnel",
      });
    } catch (err: unknown) {
      if (err instanceof TunnelPendingConfirmation) {
        pendingId = err.tunnelId;
      }
    }

    expect(pendingId).toBeDefined();
    manager.cancelFunnel(pendingId!);

    // Confirming now should throw not found
    await expect(manager.confirmFunnel(pendingId!)).rejects.toThrow("Tunnel not found");
  });

  it("stop() removes tunnel from memory and DB", async () => {
    const result = await manager.start({
      project: "frontend",
      sessionId: "s1",
      localPort: 3000,
      mode: "serve",
    });

    expect(manager.list()).toHaveLength(1);

    await manager.stop(result.id);

    expect(manager.list()).toHaveLength(0);
    expect(mocks.serveAdapter.stop).toHaveBeenCalledWith(3000);
    expect(mocks.db.updateStatus).toHaveBeenCalledWith(result.id, "stopped");
  });

  it("stop() funnel tunnel uses public port for adapter", async () => {
    const result = await manager.start({
      project: "api",
      sessionId: "s1",
      localPort: 5000,
      mode: "funnel",
      autoConfirm: true,
    });

    mocks.db.getById.mockReturnValue({ funnelPath: "/api" });
    await manager.stop(result.id);

    expect(mocks.funnelProxy.removeRoute).toHaveBeenCalledWith("/api");
    // When last funnel is removed, stop proxy and adapter with public port
    expect(mocks.funnelProxy.stop).toHaveBeenCalled();
    expect(mocks.funnelAdapter.stop).toHaveBeenCalledWith(8443);
  });

  it("stopByProject() removes all tunnels for project", async () => {
    await manager.start({
      project: "frontend",
      sessionId: "s1",
      localPort: 3000,
      mode: "serve",
    });

    mocks.serveAdapter.start.mockResolvedValue({
      url: "http://mydevice.ts.net:6006",
    });

    await manager.start({
      project: "frontend",
      sessionId: "s1",
      localPort: 6006,
      mode: "serve",
    });

    expect(manager.list()).toHaveLength(2);

    await manager.stopByProject("frontend");

    expect(manager.list()).toHaveLength(0);
    expect(mocks.serveAdapter.stop).toHaveBeenCalledTimes(2);
  });

  it("stopAll() clears everything", async () => {
    await manager.start({
      project: "frontend",
      sessionId: "s1",
      localPort: 3000,
      mode: "serve",
    });

    expect(manager.list()).toHaveLength(1);

    await manager.stopAll();

    expect(manager.list()).toHaveLength(0);
    expect(mocks.funnelProxy.stop).toHaveBeenCalled();
  });

  it("restore() reconnects serve tunnels (always alive)", async () => {
    mocks.db.listActive.mockReturnValue([
      {
        id: "tunnel-1",
        sessionId: "s1",
        project: "frontend",
        localPort: 3000,
        assignedPort: 3000,
        url: "http://mydevice.ts.net:3000",
        provider: "tailscale-serve",
        mode: "serve",
        status: "active",
        funnelPath: null,
        createdAt: new Date(),
      },
    ]);

    const restored = await manager.restore();

    expect(restored).toBe(1);
    expect(manager.list()).toHaveLength(1);
    expect(mocks.healthMonitor.start).toHaveBeenCalled();
  });

  it("restore() marks dead funnel tunnels as stopped", async () => {
    mocks.db.listActive.mockReturnValue([
      {
        id: "tunnel-dead",
        sessionId: "s1",
        project: "backend",
        localPort: 8000,
        assignedPort: 8443,
        url: "https://mydevice.ts.net:8443/backend",
        provider: "tailscale-funnel",
        mode: "funnel",
        status: "active",
        funnelPath: "/backend",
        createdAt: new Date(),
      },
    ]);
    mocks.funnelAdapter.isActive.mockResolvedValue(false);

    const restored = await manager.restore();

    expect(restored).toBe(0);
    expect(mocks.db.updateStatus).toHaveBeenCalledWith("tunnel-dead", "stopped");
    // isActive should be called with public port, not local port
    expect(mocks.funnelAdapter.isActive).toHaveBeenCalledWith(8443);
  });

  it("multiple tunnels per project (different ports)", async () => {
    await manager.start({
      project: "frontend",
      sessionId: "s1",
      localPort: 3000,
      mode: "serve",
    });

    mocks.serveAdapter.start.mockResolvedValue({
      url: "http://mydevice.ts.net:6006",
    });

    await manager.start({
      project: "frontend",
      sessionId: "s1",
      localPort: 6006,
      mode: "serve",
    });

    const projectTunnels = manager.listByProject("frontend");
    expect(projectTunnels).toHaveLength(2);
    expect(projectTunnels.map((t) => t.localPort)).toContain(3000);
    expect(projectTunnels.map((t) => t.localPort)).toContain(6006);
  });
});
