import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../db/index.js";
import { sessions } from "../db/schema.js";
import { TunnelDb } from "./tunnel-db.js";
import type { TunnelInfo } from "./types.js";

describe("TunnelDb", () => {
  let tempDir: string;
  let db: TunnelDb;
  const originalEnv = process.env.JORCHBOT_DB_PATH;

  function createSession(id: string): void {
    const drizzle = getDb();
    drizzle
      .insert(sessions)
      .values({
        id,
        project: "test-project",
        path: "/tmp/test",
        mode: "confirm",
        outputMode: "verbose",
        contextPercent: 0,
        status: "active",
        focused: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
  }

  function makeTunnelInfo(overrides?: Partial<TunnelInfo>): TunnelInfo {
    return {
      id: "tunnel-1",
      sessionId: "session-1",
      project: "frontend",
      localPort: 3000,
      assignedPort: 3000,
      url: "https://mydevice.ts.net:3000",
      provider: "tailscale-serve",
      mode: "serve",
      status: "active",
      createdAt: new Date(),
      ...overrides,
    };
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jorchbot-tunnel-db-"));
    process.env.JORCHBOT_DB_PATH = path.join(tempDir, "test.db");
    db = new TunnelDb();
    // Create a session for FK constraint
    createSession("session-1");
  });

  afterEach(() => {
    closeDb();
    if (originalEnv === undefined) {
      delete process.env.JORCHBOT_DB_PATH;
    } else {
      process.env.JORCHBOT_DB_PATH = originalEnv;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("insert() creates record with all fields", () => {
    const info = makeTunnelInfo();
    db.insert(info, "/frontend");

    const record = db.getById("tunnel-1");
    expect(record).toBeDefined();
    expect(record!.id).toBe("tunnel-1");
    expect(record!.sessionId).toBe("session-1");
    expect(record!.project).toBe("frontend");
    expect(record!.localPort).toBe(3000);
    expect(record!.assignedPort).toBe(3000);
    expect(record!.url).toBe("https://mydevice.ts.net:3000");
    expect(record!.provider).toBe("tailscale-serve");
    expect(record!.mode).toBe("serve");
    expect(record!.status).toBe("active");
    expect(record!.funnelPath).toBe("/frontend");
  });

  it("insert() stores null funnelPath when omitted", () => {
    const info = makeTunnelInfo();
    db.insert(info);

    const record = db.getById("tunnel-1");
    expect(record!.funnelPath).toBeNull();
  });

  it("updateStatus() changes status", () => {
    db.insert(makeTunnelInfo());

    db.updateStatus("tunnel-1", "stopped");

    const record = db.getById("tunnel-1");
    expect(record!.status).toBe("stopped");
  });

  it("listActive() returns only active tunnels", () => {
    db.insert(makeTunnelInfo({ id: "t-active", status: "active" }));
    db.insert(
      makeTunnelInfo({
        id: "t-stopped",
        localPort: 4000,
        status: "active",
      }),
    );
    // Mark one as stopped
    db.updateStatus("t-stopped", "stopped");

    const active = db.listActive();
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe("t-active");
  });

  it("getById() returns record or undefined", () => {
    db.insert(makeTunnelInfo());

    expect(db.getById("tunnel-1")).toBeDefined();
    expect(db.getById("nonexistent")).toBeUndefined();
  });

  it("cascade delete — when session is deleted, tunnels are deleted", () => {
    db.insert(makeTunnelInfo());
    expect(db.getById("tunnel-1")).toBeDefined();

    // Delete the session
    const drizzle = getDb();
    drizzle.delete(sessions).run();

    expect(db.getById("tunnel-1")).toBeUndefined();
  });
});
