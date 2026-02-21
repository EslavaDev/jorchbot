import { beforeEach, describe, expect, it, vi } from "vitest";
import { FunnelNotEnabledError, TunnelStartError } from "../../errors/index.js";

const mockGetTailscaleBinary = vi.fn<() => Promise<string>>();
const mockRunExec = vi.fn<() => Promise<{ stdout: string; stderr: string }>>();

vi.mock("../../infra/tailscale.js", () => ({
  getTailscaleBinary: (...args: unknown[]) => mockGetTailscaleBinary(...(args as [])),
}));

vi.mock("../../process/exec.js", () => ({
  runExec: (...args: unknown[]) => mockRunExec(...(args as [])),
}));

const { TailscaleFunnelAdapter } = await import("./tailscale-funnel.js");

describe("TailscaleFunnelAdapter", () => {
  let adapter: InstanceType<typeof TailscaleFunnelAdapter>;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new TailscaleFunnelAdapter();
    mockGetTailscaleBinary.mockResolvedValue("tailscale");
  });

  describe("start", () => {
    it("uses --https flag for public port and localhost: for local port", async () => {
      mockRunExec.mockResolvedValue({ stdout: "", stderr: "" });

      await adapter.start(8443, 9999);

      expect(mockRunExec).toHaveBeenCalledWith(
        "tailscale",
        ["funnel", "--bg", "--yes", "--https=8443", "localhost:9999"],
        { timeoutMs: 15_000 },
      );
    });

    it("throws FunnelNotEnabledError when Funnel not enabled", async () => {
      mockRunExec.mockRejectedValue(new Error("Funnel is not enabled"));

      await expect(adapter.start(8443, 9999)).rejects.toThrow(FunnelNotEnabledError);
    });

    it("throws TunnelStartError on other command failures", async () => {
      mockRunExec.mockRejectedValue(new Error("generic error"));

      await expect(adapter.start(8443, 9999)).rejects.toThrow(TunnelStartError);
    });
  });

  describe("stop", () => {
    it("uses --https flag to target specific public port", async () => {
      mockRunExec.mockResolvedValue({ stdout: "", stderr: "" });

      await adapter.stop(8443);

      expect(mockRunExec).toHaveBeenCalledWith("tailscale", ["funnel", "--https=8443", "off"], {
        timeoutMs: 15_000,
      });
    });

    it("does not throw on failure (best-effort)", async () => {
      mockRunExec.mockRejectedValue(new Error("stop failed"));

      await expect(adapter.stop(8443)).resolves.toBeUndefined();
    });
  });

  describe("isActive", () => {
    it("returns true when :port appears in status (matching hostname:port key)", async () => {
      mockRunExec.mockResolvedValue({
        stdout: JSON.stringify({
          Web: { "mydevice.ts.net:8443": { Handlers: {} } },
          AllowFunnel: { "mydevice.ts.net:8443": true },
        }),
        stderr: "",
      });

      const result = await adapter.isActive(8443);

      expect(result).toBe(true);
    });

    it("returns false when port is not in status output", async () => {
      mockRunExec.mockResolvedValue({
        stdout: JSON.stringify({
          Web: { "mydevice.ts.net:443": { Handlers: {} } },
        }),
        stderr: "",
      });

      const result = await adapter.isActive(8443);

      expect(result).toBe(false);
    });

    it("returns false on command failure", async () => {
      mockRunExec.mockRejectedValue(new Error("status failed"));

      const result = await adapter.isActive(8443);

      expect(result).toBe(false);
    });
  });
});
