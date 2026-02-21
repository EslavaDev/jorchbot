import { z } from "zod";

// --- Tunnel modes ---

export const TunnelMode = z.enum(["serve", "funnel"]);
export type TunnelMode = z.infer<typeof TunnelMode>;

export const TunnelStatus = z.enum(["starting", "active", "stopped", "error"]);
export type TunnelStatus = z.infer<typeof TunnelStatus>;

export const TunnelProvider = z.enum(["tailscale-serve", "tailscale-funnel"]);
export type TunnelProvider = z.infer<typeof TunnelProvider>;

// --- Tunnel start input (validated at boundary) ---

export const TunnelStartInputSchema = z.object({
  /** Project name (from Jorchfile or manual) */
  project: z.string().min(1),
  /** Session ID that owns this tunnel */
  sessionId: z.string().min(1),
  /** Local port to expose */
  localPort: z.number().int().min(1).max(65535),
  /** Tunnel mode: serve (private) or funnel (public) */
  mode: TunnelMode.default("serve"),
  /** Custom path for Funnel reverse proxy (default: /<project>) */
  funnelPath: z.string().optional(),
  /** Skip funnel confirmation (auto-accept). Used by Jorchfile executor. */
  autoConfirm: z.boolean().optional(),
});

export type TunnelStartInput = z.infer<typeof TunnelStartInputSchema>;

// --- Active tunnel info (internal, no runtime validation needed) ---

export interface TunnelInfo {
  /** UUID */
  id: string;
  /** Owning session ID */
  sessionId: string;
  /** Project name */
  project: string;
  /** Local port being tunneled */
  localPort: number;
  /** Port assigned by Tailscale (same as localPort for Serve, public funnel port for Funnel) */
  assignedPort: number;
  /** Full URL to access the tunnel */
  url: string;
  /** Provider identifier */
  provider: TunnelProvider;
  /** Tunnel mode */
  mode: TunnelMode;
  /** Current status */
  status: TunnelStatus;
  /** When the tunnel was created */
  createdAt: Date;
}

// --- Events emitted by TunnelManager ---

export type TunnelEvent =
  | { type: "tunnel:started"; tunnel: TunnelInfo }
  | { type: "tunnel:stopped"; tunnelId: string; project: string }
  | { type: "tunnel:error"; tunnelId: string; project: string; error: string }
  | { type: "tunnel:health_restored"; tunnelId: string; project: string }
  | {
      type: "tunnel:restart_failed";
      tunnelId: string;
      project: string;
      attempts: number;
    };

// --- Health report ---

export interface TunnelHealthEntry {
  tunnelId: string;
  project: string;
  url: string;
  healthy: boolean;
  lastCheckAt: Date;
  consecutiveFailures: number;
}

export interface TunnelHealthReport {
  tunnels: TunnelHealthEntry[];
  allHealthy: boolean;
}

// --- Callbacks for channel-agnostic notification ---

export interface TunnelManagerCallbacks {
  /** Notify the user about tunnel events (started, stopped, error, health) */
  onNotify: (event: TunnelEvent) => void;
  /** Ask user confirmation for Funnel (public exposure) */
  onConfirmFunnel: (tunnelId: string, project: string, port: number) => void;
}
