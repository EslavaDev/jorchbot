import { loadConfig, saveConfig } from "../config/jorchbot-config-loader.js";
import { TailscaleServeAdapter } from "../tunnels/adapters/tailscale-serve.js";

export type FunnelConfirmation = {
  action: "on" | "off";
  code: string;
  expiresAt: number;
};

export interface GuiCommandDeps {
  sendReply: (text: string) => Promise<void>;
  getPort: () => number;
  getPendingConfirmation: () => FunnelConfirmation | null;
  setPendingConfirmation: (c: FunnelConfirmation | null) => void;
  /** Called after gui.funnel toggle is confirmed to apply the change (start/stop Funnel). */
  onFunnelToggle?: (enabled: boolean) => Promise<void>;
}

export async function handleGuiCommand(args: string, deps: GuiCommandDeps): Promise<void> {
  const parts = args.trim().split(/\s+/);

  if (parts.length === 0 || parts[0] === "") {
    // /gui — send URL
    const adapter = new TailscaleServeAdapter();
    let hostname: string;
    try {
      hostname = await adapter.getHostname();
    } catch {
      await deps.sendReply("Tailscale is not available. Cannot resolve GUI URL.");
      return;
    }

    const port = deps.getPort();
    const config = loadConfig();

    const url = config.gui.funnel ? `https://${hostname}:${port}` : `http://${hostname}:${port}`;
    const mode = config.gui.funnel ? "public (Funnel + device auth)" : "tailnet only";

    await deps.sendReply(
      `JorchBot GUI:\n${url}\n\nMode: ${mode}\nAccessible from ${config.gui.funnel ? "any browser (with device auth)" : "devices in your tailnet"}.`,
    );
    return;
  }

  if (parts[0] === "funnel" && (parts[1] === "on" || parts[1] === "off")) {
    const action = parts[1];
    const code = String(Math.floor(1000 + Math.random() * 9000));
    const expiresAt = Date.now() + 60_000;

    deps.setPendingConfirmation({ action, code, expiresAt });

    const description =
      action === "on"
        ? "expose the GUI to the internet via Funnel (with device auth)"
        : "restrict the GUI to tailnet only";

    await deps.sendReply(
      `You are about to ${description}.\n\nTo confirm, reply with the code: ${code}\n(expires in 60 seconds)`,
    );
    return;
  }

  await deps.sendReply("Usage: /gui or /gui funnel on|off");
}

/**
 * Called when a message arrives that might be a funnel confirmation code.
 * Returns true if the message was consumed as a confirmation code.
 */
export async function handleFunnelConfirmation(
  text: string,
  deps: GuiCommandDeps,
): Promise<boolean> {
  const pending = deps.getPendingConfirmation();
  if (!pending) {
    return false;
  }

  // Check expiration
  if (Date.now() > pending.expiresAt) {
    deps.setPendingConfirmation(null);
    await deps.sendReply("Funnel toggle expired. Use /gui funnel on|off to try again.");
    return true;
  }

  if (text.trim() !== pending.code) {
    return false;
  }

  // Code matches — execute the toggle
  deps.setPendingConfirmation(null);
  const config = loadConfig();
  config.gui.funnel = pending.action === "on";
  saveConfig(config);

  // Apply the Funnel toggle (start or stop Tailscale Funnel for the gateway)
  if (deps.onFunnelToggle) {
    try {
      await deps.onFunnelToggle(pending.action === "on");
    } catch (err: unknown) {
      await deps.sendReply(
        `Config saved but Funnel toggle failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return true;
    }
  }

  if (pending.action === "on") {
    await deps.sendReply(
      "GUI is now public via Funnel.\nDevice auth activated. New browsers will need pairing.",
    );
  } else {
    await deps.sendReply("GUI restricted to tailnet.\nOnly devices in your tailnet can access it.");
  }

  return true;
}
