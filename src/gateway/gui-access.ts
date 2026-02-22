import type { NextFunction, Request, Response } from "express";
import type { JorchBotConfig } from "../config/jorchbot-config.js";
import { isTailnetIp } from "./tailnet-ip.js";

/** Paths that always pass without any access check */
const BYPASS_PREFIXES = ["/webhooks/", "/health", "/__jorchbot/", "/api/"];

/**
 * Express middleware that enforces GUI access based on gui.funnel config.
 *
 * When gui.funnel = false: only tailnet IPs (100.64.0.0/10) + loopback pass.
 * When gui.funnel = true: all IPs pass (device auth happens at WebSocket level).
 */
export function createGuiAccessMiddleware(
  getConfig: () => JorchBotConfig,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Always allow bypass paths
    if (BYPASS_PREFIXES.some((p) => req.path.startsWith(p))) {
      next();
      return;
    }

    const config = getConfig();

    // gui.funnel = true → all IPs allowed (device auth at WS level)
    if (config.gui.funnel) {
      next();
      return;
    }

    // gui.funnel = false → tailnet IPs only
    const ip = req.ip ?? req.socket.remoteAddress ?? "";
    if (isTailnetIp(ip)) {
      next();
      return;
    }

    res.status(403).json({ error: "Access denied. GUI restricted to tailnet." });
  };
}
