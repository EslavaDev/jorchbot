import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HealthMonitor } from "./health.js";
import type { HealthMonitorDeps } from "./health.js";
import type { TunnelInfo } from "./types.js";

function createMockDeps() {
  return {
    isServeActive: vi.fn<(port: number) => Promise<boolean>>().mockResolvedValue(true),
    isFunnelProxyRunning: vi.fn<() => boolean>().mockReturnValue(true),
    updateDbStatus: vi.fn(),
    onNotify: vi.fn(),
  } satisfies HealthMonitorDeps;
}

function makeTunnel(overrides: Partial<TunnelInfo> = {}): TunnelInfo {
  return {
    id: "tunnel-1",
    sessionId: "session-1",
    project: "frontend",
    localPort: 3000,
    assignedPort: 3000,
    url: "https://mydevice.ts.net:3000",
    provider: "tailscale-serve",
    mode: "serve",
    status: "active",
    createdAt: new Date(),
    ...overrides,
  };
}

describe("HealthMonitor", () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    vi.useFakeTimers();
    deps = createMockDeps();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("healthy tunnels have 0 consecutive failures", async () => {
    const monitor = new HealthMonitor(
      { intervalMs: 5000, failureThreshold: 3, maxRestartAttempts: 3 },
      deps,
    );

    const tunnels = [makeTunnel()];
    const report = await monitor.checkAll(tunnels);

    expect(report.tunnels).toHaveLength(1);
    expect(report.tunnels[0].healthy).toBe(true);
    expect(report.tunnels[0].consecutiveFailures).toBe(0);
    expect(report.allHealthy).toBe(true);
  });

  it("checkAll skips non-active tunnels", async () => {
    const monitor = new HealthMonitor(
      { intervalMs: 5000, failureThreshold: 3, maxRestartAttempts: 3 },
      deps,
    );

    const tunnels = [makeTunnel({ status: "stopped" })];
    const report = await monitor.checkAll(tunnels);

    expect(report.tunnels).toHaveLength(0);
    expect(report.allHealthy).toBe(true);
    expect(deps.isServeActive).not.toHaveBeenCalled();
  });

  it("checkAll uses isFunnelProxyRunning for funnel mode", async () => {
    const monitor = new HealthMonitor(
      { intervalMs: 5000, failureThreshold: 3, maxRestartAttempts: 3 },
      deps,
    );

    const tunnels = [makeTunnel({ mode: "funnel", provider: "tailscale-funnel" })];
    const report = await monitor.checkAll(tunnels);

    expect(report.tunnels).toHaveLength(1);
    expect(report.tunnels[0].healthy).toBe(true);
    expect(deps.isFunnelProxyRunning).toHaveBeenCalledTimes(1);
    expect(deps.isServeActive).not.toHaveBeenCalled();
  });

  it("3 consecutive failures trigger handleFailure", async () => {
    deps.isServeActive.mockResolvedValue(false);

    const monitor = new HealthMonitor(
      { intervalMs: 5000, failureThreshold: 3, maxRestartAttempts: 3 },
      deps,
    );

    const tunnel = makeTunnel();
    const provider = { list: () => [tunnel] };
    monitor.start(provider);

    // Tick 3 intervals to accumulate 3 failures
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);

    // After 3 failures, handleFailure is called which schedules a restart via setTimeout
    // The restart attempt will use isServeActive, which we can track
    // After threshold, a setTimeout is scheduled for backoff restart (1000ms)
    await vi.advanceTimersByTimeAsync(1000);

    // isServeActive throws/returns false, so tunnel:error event should be emitted
    expect(deps.onNotify).toHaveBeenCalled();
  });

  it("after max retries, tunnel marked as error", async () => {
    deps.isServeActive.mockResolvedValue(false);

    const monitor = new HealthMonitor(
      { intervalMs: 5000, failureThreshold: 3, maxRestartAttempts: 3 },
      deps,
    );

    const tunnel = makeTunnel();
    const provider = { list: () => [tunnel] };
    monitor.start(provider);

    // Accumulate 3 failures to trigger first restart attempt
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);

    // Advance past first backoff (1000ms) - attempt 1 fails
    await vi.advanceTimersByTimeAsync(1000);

    // 3 more failures to trigger second restart attempt
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);

    // Advance past second backoff (5000ms) - attempt 2 fails
    await vi.advanceTimersByTimeAsync(5000);

    // 3 more failures to trigger third restart attempt
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);

    // Advance past third backoff (30000ms) - attempt 3 fails
    await vi.advanceTimersByTimeAsync(30_000);

    // After 3 failed restart attempts, next failure cycle should mark as error
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);

    // Should have called updateDbStatus with "error"
    expect(deps.updateDbStatus).toHaveBeenCalledWith("tunnel-1", "error");
    expect(deps.onNotify).toHaveBeenCalledWith(
      expect.objectContaining({ type: "tunnel:restart_failed", tunnelId: "tunnel-1" }),
    );
  });

  it("stop() clears interval and counters", async () => {
    deps.isServeActive.mockResolvedValue(false);

    const monitor = new HealthMonitor(
      { intervalMs: 5000, failureThreshold: 3, maxRestartAttempts: 3 },
      deps,
    );

    const tunnel = makeTunnel();
    const provider = { list: () => [tunnel] };
    monitor.start(provider);

    // Accumulate some failures
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);

    monitor.stop();

    // After stop, no more checks should run
    deps.isServeActive.mockClear();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(deps.isServeActive).not.toHaveBeenCalled();
  });

  it("recovery emits tunnel:health_restored event", async () => {
    // Start unhealthy
    deps.isServeActive.mockResolvedValue(false);

    const monitor = new HealthMonitor(
      { intervalMs: 5000, failureThreshold: 3, maxRestartAttempts: 3 },
      deps,
    );

    const tunnel = makeTunnel();
    const provider = { list: () => [tunnel] };
    monitor.start(provider);

    // Accumulate 2 failures (below threshold, so no restart yet)
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);

    // Now the tunnel recovers
    deps.isServeActive.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(5000);

    // Should emit health_restored because there were previous failures
    expect(deps.onNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "tunnel:health_restored",
        tunnelId: "tunnel-1",
        project: "frontend",
      }),
    );
  });

  it("successful restart resets failure counters", async () => {
    deps.isServeActive.mockResolvedValue(false);

    const monitor = new HealthMonitor(
      { intervalMs: 5000, failureThreshold: 3, maxRestartAttempts: 3 },
      deps,
    );

    const tunnel = makeTunnel();
    const provider = { list: () => [tunnel] };
    monitor.start(provider);

    // Accumulate 3 failures to trigger restart
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);

    // Make the restart succeed
    deps.isServeActive.mockResolvedValue(true);

    // Advance past backoff (1000ms for first attempt)
    await vi.advanceTimersByTimeAsync(1000);

    // Should emit health_restored from the restart
    expect(deps.onNotify).toHaveBeenCalledWith(
      expect.objectContaining({ type: "tunnel:health_restored", tunnelId: "tunnel-1" }),
    );
    expect(deps.updateDbStatus).toHaveBeenCalledWith("tunnel-1", "active");

    // Next check should show the tunnel as healthy with 0 failures
    const report = await monitor.checkAll([tunnel]);
    expect(report.tunnels).toHaveLength(1);
    expect(report.tunnels[0].consecutiveFailures).toBe(0);
  });
});
