import { beforeEach, describe, expect, it, vi } from "vitest";
import { TailscaleNotInstalledError, TailscaleNotAuthenticatedError } from "../../errors/index.js";

const mockFindTailscaleBinary = vi.fn<() => Promise<string | null>>();
const mockGetTailnetHostname = vi.fn<() => Promise<string>>();

vi.mock("../../infra/tailscale.js", () => ({
  findTailscaleBinary: (...args: unknown[]) => mockFindTailscaleBinary(...(args as [])),
  getTailnetHostname: (...args: unknown[]) => mockGetTailnetHostname(...(args as [])),
}));

vi.mock("../../process/exec.js", () => ({
  runExec: vi.fn(),
}));

// Must import AFTER vi.mock declarations
const { TailscaleServeAdapter } = await import("./tailscale-serve.js");

describe("TailscaleServeAdapter", () => {
  let adapter: InstanceType<typeof TailscaleServeAdapter>;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new TailscaleServeAdapter();
    mockGetTailnetHostname.mockResolvedValue("mydevice.ts.net");
  });

  describe("ensureAvailable", () => {
    it("throws TailscaleNotInstalledError when binary not found", async () => {
      mockFindTailscaleBinary.mockResolvedValue(null);

      await expect(adapter.ensureAvailable()).rejects.toThrow(TailscaleNotInstalledError);
    });

    it("throws TailscaleNotAuthenticatedError when not logged in", async () => {
      mockFindTailscaleBinary.mockResolvedValue("/usr/bin/tailscale");
      mockGetTailnetHostname.mockRejectedValue(new Error("not logged in"));

      await expect(adapter.ensureAvailable()).rejects.toThrow(TailscaleNotAuthenticatedError);
    });

    it("succeeds and caches hostname when Tailscale is available", async () => {
      mockFindTailscaleBinary.mockResolvedValue("/usr/bin/tailscale");
      mockGetTailnetHostname.mockResolvedValue("mydevice.ts.net");

      await adapter.ensureAvailable();
      const hostname = await adapter.getHostname();

      expect(hostname).toBe("mydevice.ts.net");
      expect(mockGetTailnetHostname).toHaveBeenCalledTimes(1);
    });
  });

  describe("start", () => {
    it("returns direct tailnet HTTP URL with port", async () => {
      mockFindTailscaleBinary.mockResolvedValue("/usr/bin/tailscale");
      await adapter.ensureAvailable();

      const result = await adapter.start(3000);

      expect(result.url).toBe("http://mydevice.ts.net:3000");
    });
  });

  describe("stop", () => {
    it("is a no-op (resolves without error)", async () => {
      await expect(adapter.stop(3000)).resolves.toBeUndefined();
    });
  });

  describe("isActive", () => {
    it("always returns true (direct tailnet access)", async () => {
      const result = await adapter.isActive(3000);

      expect(result).toBe(true);
    });
  });
});
