import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../db/index.js";
import {
  blockDevice,
  isDeviceBlocked,
  listBlockedDevices,
  unblockDevice,
} from "./device-blacklist.js";

describe("device-blacklist", () => {
  let tempDir: string;
  let originalDbPath: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jorchbot-blacklist-"));
    originalDbPath = process.env.JORCHBOT_DB_PATH;
    process.env.JORCHBOT_DB_PATH = path.join(tempDir, "test.db");
  });

  afterEach(() => {
    closeDb();
    if (originalDbPath === undefined) {
      delete process.env.JORCHBOT_DB_PATH;
    } else {
      process.env.JORCHBOT_DB_PATH = originalDbPath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("blockDevice inserts a device into the blacklist", () => {
    const db = getDb();
    blockDevice(db, "device-abc", "spam");

    const blocked = listBlockedDevices(db);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].deviceId).toBe("device-abc");
    expect(blocked[0].reason).toBe("spam");
    expect(blocked[0].blockedAt).toBeInstanceOf(Date);
  });

  it("blockDevice without reason stores null", () => {
    const db = getDb();
    blockDevice(db, "device-no-reason");

    const blocked = listBlockedDevices(db);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].reason).toBeNull();
  });

  it("blockDevice upserts if device already blocked", () => {
    const db = getDb();
    blockDevice(db, "device-dup", "first reason");
    blockDevice(db, "device-dup", "updated reason");

    const blocked = listBlockedDevices(db);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].reason).toBe("updated reason");
  });

  it("unblockDevice removes a device from the blacklist", () => {
    const db = getDb();
    blockDevice(db, "device-to-unblock", "test");

    expect(isDeviceBlocked(db, "device-to-unblock")).toBe(true);

    unblockDevice(db, "device-to-unblock");

    expect(isDeviceBlocked(db, "device-to-unblock")).toBe(false);
    expect(listBlockedDevices(db)).toHaveLength(0);
  });

  it("unblockDevice is a no-op if device is not blocked", () => {
    const db = getDb();
    // Should not throw
    unblockDevice(db, "nonexistent-device");
    expect(listBlockedDevices(db)).toHaveLength(0);
  });

  it("isDeviceBlocked returns true for blocked devices", () => {
    const db = getDb();
    blockDevice(db, "blocked-device");

    expect(isDeviceBlocked(db, "blocked-device")).toBe(true);
  });

  it("isDeviceBlocked returns false for non-blocked devices", () => {
    const db = getDb();

    expect(isDeviceBlocked(db, "free-device")).toBe(false);
  });

  it("listBlockedDevices returns all blocked devices", () => {
    const db = getDb();
    blockDevice(db, "device-1", "reason-a");
    blockDevice(db, "device-2", "reason-b");
    blockDevice(db, "device-3");

    const blocked = listBlockedDevices(db);
    expect(blocked).toHaveLength(3);

    const ids = blocked.map((d) => d.deviceId).toSorted();
    expect(ids).toEqual(["device-1", "device-2", "device-3"]);
  });

  it("listBlockedDevices returns empty array when none blocked", () => {
    const db = getDb();
    expect(listBlockedDevices(db)).toHaveLength(0);
  });
});
