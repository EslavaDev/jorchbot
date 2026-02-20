import * as childProcess from "node:child_process";
import * as util from "node:util";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TunnelManager } from "./tunnel.js";

// Mock exec
vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof childProcess>();
  return {
    ...original,
    exec: vi.fn(),
  };
});

vi.mock("node:util", async (importOriginal) => {
  const original = await importOriginal<typeof util>();
  return {
    ...original,
    promisify: vi.fn((fn: unknown) => fn),
  };
});

describe("TunnelManager", () => {
  const sendReply = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  const sendButtons = vi
    .fn<(text: string, buttons: Array<{ id: string; title: string }>) => Promise<void>>()
    .mockResolvedValue(undefined);
  let manager: TunnelManager;
  const mockExec = childProcess.exec as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new TunnelManager({ sendReply, sendButtons });
  });

  it("start() with serve mode sends tunnel URL", async () => {
    // tailscale version → available
    mockExec
      .mockResolvedValueOnce({ stdout: "1.60.0", stderr: "" })
      // tailscale serve --bg
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
      // tailscale status --json
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ Self: { DNSName: "mydevice.ts.net." } }),
        stderr: "",
      });

    await manager.start({ project: "frontend", port: 3000, mode: "serve" });

    expect(sendReply).toHaveBeenCalledWith(expect.stringContaining("https://mydevice.ts.net"));
  });

  it("start() with funnel mode sends confirmation buttons", async () => {
    // tailscale version → available
    mockExec.mockResolvedValueOnce({ stdout: "1.60.0", stderr: "" });

    await manager.start({ project: "frontend", port: 3000, mode: "funnel" });

    expect(sendButtons).toHaveBeenCalledWith(
      expect.stringContaining("public internet"),
      expect.arrayContaining([
        expect.objectContaining({ title: "Yes, expose" }),
        expect.objectContaining({ title: "Cancel" }),
      ]),
    );
  });

  it("stop() closes tunnel (calls tailscale serve off)", async () => {
    // Setup: first start a serve tunnel
    mockExec
      .mockResolvedValueOnce({ stdout: "1.60.0", stderr: "" })
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ Self: { DNSName: "mydevice.ts.net." } }),
        stderr: "",
      });

    await manager.start({ project: "frontend", port: 3000, mode: "serve" });
    mockExec.mockClear();

    // Stop the tunnel
    mockExec.mockResolvedValueOnce({ stdout: "", stderr: "" });
    await manager.stop("frontend", 3000);

    expect(mockExec).toHaveBeenCalledWith("tailscale serve off 3000");
    expect(manager.listAll()).toHaveLength(0);
  });

  it("sends warning when Tailscale not installed", async () => {
    mockExec.mockRejectedValueOnce(new Error("command not found"));

    await manager.start({ project: "frontend", port: 3000, mode: "serve" });

    expect(sendReply).toHaveBeenCalledWith(expect.stringContaining("Tailscale not installed"));
  });
});
