import type { JorchBotWsServer } from "./jorchbot-ws.js";

/**
 * Typed broadcast helpers for JorchBot WS events.
 * These provide a thin typed layer over wsServer.broadcast().
 */

export function broadcastSessionState(
  ws: JorchBotWsServer,
  project: string,
  state: { contextPercent: number; mode: string; status: string; focused: boolean },
): void {
  ws.broadcast("jb.session.state", { project, ...state });
}

export function broadcastSessionOutput(ws: JorchBotWsServer, project: string, text: string): void {
  ws.broadcast("jb.session.output", { project, text });
}

export function broadcastTunnelEvent(
  ws: JorchBotWsServer,
  event: { type: string; [key: string]: unknown },
): void {
  ws.broadcast("jb.tunnel.state", event);
}
