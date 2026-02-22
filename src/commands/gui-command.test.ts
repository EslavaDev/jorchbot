import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FunnelConfirmation, GuiCommandDeps } from "./gui-command.js";
import { handleFunnelConfirmation, handleGuiCommand } from "./gui-command.js";

// Mock loadConfig/saveConfig to avoid filesystem access
vi.mock("../config/jorchbot-config-loader.js", () => ({
  loadConfig: vi.fn(() => ({
    gateway: { port: 18789, host: "127.0.0.1" },
    gui: { funnel: false },
  })),
  saveConfig: vi.fn(),
}));

// Mock TailscaleServeAdapter
vi.mock("../tunnels/adapters/tailscale-serve.js", () => ({
  TailscaleServeAdapter: class {
    async getHostname() {
      return "mydevice.taild1234.ts.net";
    }
  },
}));

function createDeps(overrides?: Partial<GuiCommandDeps>): {
  deps: GuiCommandDeps;
  sendReply: ReturnType<typeof vi.fn>;
  pendingRef: { value: FunnelConfirmation | null };
} {
  const sendReply = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  const pendingRef = { value: null as FunnelConfirmation | null };

  const deps: GuiCommandDeps = {
    sendReply,
    getPort: () => 18789,
    getPendingConfirmation: () => pendingRef.value,
    setPendingConfirmation: (c) => {
      pendingRef.value = c;
    },
    ...overrides,
  };

  return { deps, sendReply, pendingRef };
}

describe("handleGuiCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("/gui calls sendReply with URL containing hostname and port", async () => {
    const { deps, sendReply } = createDeps();

    await handleGuiCommand("", deps);

    expect(sendReply).toHaveBeenCalledTimes(1);
    const message = sendReply.mock.calls[0][0] as string;
    expect(message).toContain("mydevice.taild1234.ts.net");
    expect(message).toContain("18789");
    expect(message).toContain("JorchBot GUI:");
    expect(message).toContain("tailnet only");
  });

  it("/gui funnel on sets pending confirmation with 4-digit code", async () => {
    const { deps, sendReply, pendingRef } = createDeps();

    await handleGuiCommand("funnel on", deps);

    expect(sendReply).toHaveBeenCalledTimes(1);
    const message = sendReply.mock.calls[0][0] as string;
    expect(message).toContain("To confirm, reply with the code:");
    expect(message).toContain("expires in 60 seconds");

    expect(pendingRef.value).not.toBeNull();
    expect(pendingRef.value!.action).toBe("on");
    expect(pendingRef.value!.code).toMatch(/^\d{4}$/);
    expect(pendingRef.value!.expiresAt).toBeGreaterThan(Date.now());
  });

  it("/gui funnel off sets pending confirmation with action off", async () => {
    const { deps, sendReply, pendingRef } = createDeps();

    await handleGuiCommand("funnel off", deps);

    expect(sendReply).toHaveBeenCalledTimes(1);
    const message = sendReply.mock.calls[0][0] as string;
    expect(message).toContain("restrict the GUI to tailnet only");

    expect(pendingRef.value).not.toBeNull();
    expect(pendingRef.value!.action).toBe("off");
    expect(pendingRef.value!.code).toMatch(/^\d{4}$/);
  });

  it("/gui invalid sends usage message", async () => {
    const { deps, sendReply } = createDeps();

    await handleGuiCommand("invalid", deps);

    expect(sendReply).toHaveBeenCalledTimes(1);
    const message = sendReply.mock.calls[0][0] as string;
    expect(message).toContain("Usage: /gui or /gui funnel on|off");
  });

  it("/gui funnel without on|off sends usage message", async () => {
    const { deps, sendReply } = createDeps();

    await handleGuiCommand("funnel", deps);

    expect(sendReply).toHaveBeenCalledTimes(1);
    const message = sendReply.mock.calls[0][0] as string;
    expect(message).toContain("Usage: /gui or /gui funnel on|off");
  });
});

describe("handleFunnelConfirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when no pending confirmation", async () => {
    const { deps } = createDeps();

    const consumed = await handleFunnelConfirmation("1234", deps);

    expect(consumed).toBe(false);
  });

  it("correct code within 60s confirms and calls saveConfig", async () => {
    const { saveConfig } = await import("../config/jorchbot-config-loader.js");
    const { deps, sendReply, pendingRef } = createDeps();
    pendingRef.value = { action: "on", code: "1234", expiresAt: Date.now() + 60_000 };

    const consumed = await handleFunnelConfirmation("1234", deps);

    expect(consumed).toBe(true);
    expect(pendingRef.value).toBeNull();
    expect(saveConfig).toHaveBeenCalledTimes(1);
    expect(sendReply).toHaveBeenCalledTimes(1);
    expect(sendReply.mock.calls[0][0]).toContain("public via Funnel");
  });

  it("correct code for off action sends tailnet restricted message", async () => {
    const { deps, sendReply, pendingRef } = createDeps();
    pendingRef.value = { action: "off", code: "5678", expiresAt: Date.now() + 60_000 };

    const consumed = await handleFunnelConfirmation("5678", deps);

    expect(consumed).toBe(true);
    expect(sendReply.mock.calls[0][0]).toContain("restricted to tailnet");
  });

  it("wrong code returns false (not consumed)", async () => {
    const { deps, pendingRef } = createDeps();
    pendingRef.value = { action: "on", code: "1234", expiresAt: Date.now() + 60_000 };

    const consumed = await handleFunnelConfirmation("5678", deps);

    expect(consumed).toBe(false);
    expect(pendingRef.value).not.toBeNull(); // Still pending
  });

  it("expired code returns true and sends expired reply", async () => {
    const { deps, sendReply, pendingRef } = createDeps();
    pendingRef.value = { action: "on", code: "1234", expiresAt: Date.now() - 1000 };

    const consumed = await handleFunnelConfirmation("1234", deps);

    expect(consumed).toBe(true);
    expect(pendingRef.value).toBeNull();
    expect(sendReply).toHaveBeenCalledTimes(1);
    expect(sendReply.mock.calls[0][0]).toContain("expired");
  });

  it("calls onFunnelToggle callback when code matches", async () => {
    const onFunnelToggle = vi.fn().mockResolvedValue(undefined);
    const { deps, pendingRef } = createDeps({ onFunnelToggle });
    pendingRef.value = { action: "on", code: "9999", expiresAt: Date.now() + 60_000 };

    await handleFunnelConfirmation("9999", deps);

    expect(onFunnelToggle).toHaveBeenCalledWith(true);
  });

  it("reports error when onFunnelToggle throws", async () => {
    const onFunnelToggle = vi.fn().mockRejectedValue(new Error("Funnel not enabled"));
    const { deps, sendReply, pendingRef } = createDeps({ onFunnelToggle });
    pendingRef.value = { action: "on", code: "4321", expiresAt: Date.now() + 60_000 };

    const consumed = await handleFunnelConfirmation("4321", deps);

    expect(consumed).toBe(true);
    expect(sendReply).toHaveBeenCalledTimes(1);
    expect(sendReply.mock.calls[0][0]).toContain("Funnel toggle failed");
    expect(sendReply.mock.calls[0][0]).toContain("Funnel not enabled");
  });
});
