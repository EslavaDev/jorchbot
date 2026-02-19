import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "./index.js";

describe("JorchBot database", () => {
  let tempDir: string;
  let dbPath: string;
  const originalEnv = process.env.JORCHBOT_DB_PATH;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jorchbot-db-test-"));
    dbPath = path.join(tempDir, "test.db");
    process.env.JORCHBOT_DB_PATH = dbPath;
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

  it("creates the database file on first call", () => {
    expect(fs.existsSync(dbPath)).toBe(false);
    getDb();
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it("returns the same instance on subsequent calls (singleton)", () => {
    const db1 = getDb();
    const db2 = getDb();
    expect(db1).toBe(db2);
  });

  it("creates all 5 tables after migration", () => {
    const db = getDb();
    const raw = (
      db as unknown as {
        session: { client: { prepare: (sql: string) => { all: () => { name: string }[] } } };
      }
    ).session.client;
    const result = raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name",
      )
      .all();

    const tableNames = result.map((r) => r.name);
    expect(tableNames).toContain("sessions");
    expect(tableNames).toContain("messages");
    expect(tableNames).toContain("tunnels");
    expect(tableNames).toContain("approvals");
    expect(tableNames).toContain("settings");
    expect(tableNames).toHaveLength(5);
  });

  it("enforces foreign key constraints", () => {
    const db = getDb();
    const raw = (
      db as unknown as {
        session: { client: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } };
      }
    ).session.client;

    // Inserting a message with a non-existent session_id should fail
    expect(() => {
      raw
        .prepare(
          "INSERT INTO messages (session_id, direction, type, content, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run("nonexistent-session", "inbound", "text", "hello", Date.now());
    }).toThrow();
  });

  it("returns a fresh instance after closeDb + getDb", () => {
    const db1 = getDb();
    closeDb();
    const db2 = getDb();
    expect(db1).not.toBe(db2);
  });
});
