import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "../db/schema.js";
import { deviceBlacklist } from "../db/schema.js";

type Db = BetterSQLite3Database<typeof schema>;

/** Block a device by adding it to the blacklist. */
export function blockDevice(db: Db, deviceId: string, reason?: string): void {
  db.insert(deviceBlacklist)
    .values({ deviceId, reason: reason ?? null, blockedAt: new Date() })
    .onConflictDoUpdate({
      target: deviceBlacklist.deviceId,
      set: { reason: reason ?? null, blockedAt: new Date() },
    })
    .run();
}

/** Unblock a device by removing it from the blacklist. */
export function unblockDevice(db: Db, deviceId: string): void {
  db.delete(deviceBlacklist).where(eq(deviceBlacklist.deviceId, deviceId)).run();
}

/** Check if a device is currently blocked. */
export function isDeviceBlocked(db: Db, deviceId: string): boolean {
  const row = db
    .select({ deviceId: deviceBlacklist.deviceId })
    .from(deviceBlacklist)
    .where(eq(deviceBlacklist.deviceId, deviceId))
    .get();
  return row !== undefined;
}

/** List all blocked devices. */
export function listBlockedDevices(
  db: Db,
): Array<{ deviceId: string; reason: string | null; blockedAt: Date | null }> {
  return db.select().from(deviceBlacklist).all();
}
