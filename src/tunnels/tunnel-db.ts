import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { tunnels } from "../db/schema.js";
import { JorchBotDbQueryError } from "../errors/index.js";
import type { TunnelInfo } from "./types.js";

export interface TunnelRecord {
  id: string;
  sessionId: string;
  project: string;
  localPort: number;
  assignedPort: number | null;
  url: string | null;
  provider: "tailscale-serve" | "tailscale-funnel";
  mode: "serve" | "funnel";
  status: string;
  funnelPath: string | null;
  createdAt: Date;
}

export class TunnelDb {
  /**
   * Insert a new tunnel record.
   * @throws {JorchBotDbQueryError}
   */
  insert(info: TunnelInfo, funnelPath?: string): void {
    try {
      const db = getDb();
      db.insert(tunnels)
        .values({
          id: info.id,
          sessionId: info.sessionId,
          project: info.project,
          localPort: info.localPort,
          assignedPort: info.assignedPort,
          url: info.url,
          provider: info.provider,
          mode: info.mode,
          status: info.status as "active" | "stopped" | "error",
          funnelPath: funnelPath ?? null,
          createdAt: info.createdAt,
        })
        .run();
    } catch (err: unknown) {
      throw new JorchBotDbQueryError(`Failed to insert tunnel ${info.id}`, { cause: err });
    }
  }

  /**
   * Update tunnel status.
   * @throws {JorchBotDbQueryError}
   */
  updateStatus(tunnelId: string, status: "active" | "stopped" | "error"): void {
    try {
      const db = getDb();
      db.update(tunnels).set({ status }).where(eq(tunnels.id, tunnelId)).run();
    } catch (err: unknown) {
      throw new JorchBotDbQueryError(`Failed to update tunnel ${tunnelId}`, { cause: err });
    }
  }

  /**
   * List all tunnels with "active" status.
   * Used during restore() to find tunnels that should still be alive.
   */
  listActive(): TunnelRecord[] {
    try {
      const db = getDb();
      const rows = db.select().from(tunnels).where(eq(tunnels.status, "active")).all();
      return rows.map((r) => this.toRecord(r));
    } catch (err: unknown) {
      throw new JorchBotDbQueryError("Failed to list active tunnels", {
        cause: err,
      });
    }
  }

  /** Get a tunnel by ID */
  getById(tunnelId: string): TunnelRecord | undefined {
    try {
      const db = getDb();
      const row = db.select().from(tunnels).where(eq(tunnels.id, tunnelId)).get();
      return row ? this.toRecord(row) : undefined;
    } catch (err: unknown) {
      throw new JorchBotDbQueryError(`Failed to get tunnel ${tunnelId}`, { cause: err });
    }
  }

  private toRecord(row: typeof tunnels.$inferSelect): TunnelRecord {
    return {
      id: row.id,
      sessionId: row.sessionId,
      project: row.project,
      localPort: row.localPort,
      assignedPort: row.assignedPort,
      url: row.url,
      provider: row.provider,
      mode: row.mode,
      status: row.status,
      funnelPath: row.funnelPath ?? null,
      createdAt: row.createdAt,
    };
  }
}
