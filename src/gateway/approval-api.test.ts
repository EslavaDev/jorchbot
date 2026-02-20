import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb } from "../db/index.js";
import { SessionManager } from "../sessions/jorchbot/manager.js";
import { createApprovalRouter } from "./approval-api.js";

function createMockRunner() {
  return {
    getSessionId: vi.fn(() => null as string | null),
    getStatus: vi.fn(() => "idle" as const),
    getContextPercent: vi.fn(() => 0),
    start: vi.fn().mockResolvedValue({
      sessionId: "mock-session",
      textContent: "",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      durationMs: 0,
    }),
    resume: vi.fn().mockResolvedValue({
      sessionId: "mock-session",
      textContent: "",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      durationMs: 0,
    }),
    stop: vi.fn().mockResolvedValue(undefined),
    setEnv: vi.fn(),
    on: vi.fn(),
    emit: vi.fn(),
  };
}

async function fetchJson(
  server: http.Server,
  method: string,
  urlPath: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}${urlPath}`;

  const resp = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = (await resp.json()) as Record<string, unknown>;
  return { status: resp.status, body: data };
}

const PHONE = "+521234567890";

describe("Approval API", () => {
  type SendReplyToFn = (phone: string, text: string) => Promise<void>;
  type SendButtonsToFn = (
    phone: string,
    text: string,
    buttons: Array<{ id: string; title: string }>,
  ) => Promise<void>;

  let tempDir: string;
  let server: http.Server;
  let sessionManager: SessionManager;
  let sendReplyTo: ReturnType<typeof vi.fn<SendReplyToFn>>;
  let sendButtonsTo: ReturnType<typeof vi.fn<SendButtonsToFn>>;
  const originalDbPath = process.env.JORCHBOT_DB_PATH;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jorchbot-approval-api-test-"));
    process.env.JORCHBOT_DB_PATH = path.join(tempDir, "test.db");

    sendReplyTo = vi.fn<SendReplyToFn>().mockResolvedValue(undefined);
    sendButtonsTo = vi.fn<SendButtonsToFn>().mockResolvedValue(undefined);

    sessionManager = new SessionManager({
      sendReplyTo,
      sendButtonsTo,
      createRunner: () => createMockRunner() as never,
    });

    const app = express();
    app.use(express.json());
    app.use(createApprovalRouter({ sessionManager, sendReplyTo }));

    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    closeDb();
    if (originalDbPath === undefined) {
      delete process.env.JORCHBOT_DB_PATH;
    } else {
      process.env.JORCHBOT_DB_PATH = originalDbPath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("POST /api/tool-approval", () => {
    it("creates pending approval and returns ID", async () => {
      const session = await sessionManager.create(
        { project: "frontend", path: "/tmp/frontend" },
        PHONE,
      );

      const res = await fetchJson(server, "POST", "/api/tool-approval", {
        sessionId: session.id,
        toolName: "Edit",
        toolInput: { file_path: "src/main.ts" },
      });

      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      expect(typeof res.body.id).toBe("string");
    });

    it("returns 400 for missing fields", async () => {
      const res = await fetchJson(server, "POST", "/api/tool-approval", {
        sessionId: "x",
      });

      expect(res.status).toBe(400);
    });

    it("returns 404 for unknown session", async () => {
      const res = await fetchJson(server, "POST", "/api/tool-approval", {
        sessionId: "nonexistent",
        toolName: "Bash",
        toolInput: { command: "ls" },
      });

      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/tool-approval/:id", () => {
    it("returns pending status for new approval", async () => {
      const session = await sessionManager.create(
        { project: "frontend", path: "/tmp/frontend" },
        PHONE,
      );

      const createRes = await fetchJson(server, "POST", "/api/tool-approval", {
        sessionId: session.id,
        toolName: "Bash",
        toolInput: { command: "npm test" },
      });

      const approvalId = createRes.body.id as string;
      const pollRes = await fetchJson(server, "GET", `/api/tool-approval/${approvalId}`);

      expect(pollRes.status).toBe(200);
      expect(pollRes.body.status).toBe("pending");
    });

    it("returns approved after resolution", async () => {
      const session = await sessionManager.create(
        { project: "frontend", path: "/tmp/frontend" },
        PHONE,
      );

      const createRes = await fetchJson(server, "POST", "/api/tool-approval", {
        sessionId: session.id,
        toolName: "Bash",
        toolInput: { command: "npm test" },
      });

      const approvalId = createRes.body.id as string;
      await sessionManager.resolveApproval(approvalId, true);

      const pollRes = await fetchJson(server, "GET", `/api/tool-approval/${approvalId}`);

      expect(pollRes.status).toBe(200);
      expect(pollRes.body.status).toBe("approved");
    });

    it("returns denied after rejection", async () => {
      const session = await sessionManager.create(
        { project: "frontend", path: "/tmp/frontend" },
        PHONE,
      );

      const createRes = await fetchJson(server, "POST", "/api/tool-approval", {
        sessionId: session.id,
        toolName: "Edit",
        toolInput: { file_path: "src/main.ts" },
      });

      const approvalId = createRes.body.id as string;
      await sessionManager.resolveApproval(approvalId, false);

      const pollRes = await fetchJson(server, "GET", `/api/tool-approval/${approvalId}`);

      expect(pollRes.status).toBe(200);
      expect(pollRes.body.status).toBe("denied");
    });

    it("returns 404 for unknown approval", async () => {
      const res = await fetchJson(server, "GET", "/api/tool-approval/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/tool-result", () => {
    it("sends result notification", async () => {
      const session = await sessionManager.create(
        { project: "frontend", path: "/tmp/frontend" },
        PHONE,
      );

      sendReplyTo.mockClear();
      const res = await fetchJson(server, "POST", "/api/tool-result", {
        sessionId: session.id,
        toolName: "Edit",
        summary: "Edited src/main.ts",
        success: true,
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(sendReplyTo).toHaveBeenCalledTimes(1);
      expect(sendReplyTo.mock.calls[0][0]).toBe(PHONE);
    });

    it("returns 400 for missing fields", async () => {
      const res = await fetchJson(server, "POST", "/api/tool-result", {});
      expect(res.status).toBe(400);
    });
  });
});
