import http from "node:http";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JorchBotConfigSchema } from "../config/jorchbot-config.js";
import { createGuiAccessMiddleware } from "./gui-access.js";

function buildApp(guiFunnel: boolean) {
  const config = JorchBotConfigSchema.parse({ gui: { funnel: guiFunnel } });
  const app = express();
  app.set("trust proxy", true);
  app.use(createGuiAccessMiddleware(() => config));
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.get("/webhooks/kapso", (_req, res) => res.json({ ok: true }));
  app.get("/__jorchbot/control-ui-config.json", (_req, res) =>
    res.json({ assistantName: "JorchBot" }),
  );
  app.get("/api/documents/123", (_req, res) => res.json({ ok: true }));
  app.get("/overview", (_req, res) => res.json({ tab: "overview" }));
  return app;
}

async function startServer(app: express.Express): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
  });
}

async function fetchStatus(port: number, urlPath: string): Promise<number> {
  const resp = await fetch(`http://127.0.0.1:${port}${urlPath}`);
  return resp.status;
}

describe("GUI access middleware", () => {
  let server: http.Server;
  let port: number;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  describe("gui.funnel = false (tailnet only)", () => {
    beforeEach(async () => {
      const result = await startServer(buildApp(false));
      server = result.server;
      port = result.port;
    });

    it("/health always passes", async () => {
      const status = await fetchStatus(port, "/health");
      expect(status).toBe(200);
    });

    it("/webhooks/kapso always passes", async () => {
      const status = await fetchStatus(port, "/webhooks/kapso");
      expect(status).toBe(200);
    });

    it("/__jorchbot/control-ui-config.json always passes", async () => {
      const status = await fetchStatus(port, "/__jorchbot/control-ui-config.json");
      expect(status).toBe(200);
    });

    it("/api/documents/123 always passes", async () => {
      const status = await fetchStatus(port, "/api/documents/123");
      expect(status).toBe(200);
    });

    it("/overview with loopback IP (127.0.0.1) passes", async () => {
      // supertest uses 127.0.0.1 which is allowed as loopback
      const status = await fetchStatus(port, "/overview");
      expect(status).toBe(200);
    });
  });

  describe("gui.funnel = true (all IPs allowed)", () => {
    beforeEach(async () => {
      const result = await startServer(buildApp(true));
      server = result.server;
      port = result.port;
    });

    it("/overview passes with any IP when funnel is true", async () => {
      const status = await fetchStatus(port, "/overview");
      expect(status).toBe(200);
    });

    it("/webhooks/kapso still passes when funnel is true", async () => {
      const status = await fetchStatus(port, "/webhooks/kapso");
      expect(status).toBe(200);
    });
  });

  describe("D.8 — non-tailnet IP rejection (unit test)", () => {
    it("returns 403 for non-tailnet IP when gui.funnel=false", () => {
      const config = JorchBotConfigSchema.parse({ gui: { funnel: false } });
      const middleware = createGuiAccessMiddleware(() => config);

      const req = {
        path: "/overview",
        ip: "8.8.8.8",
        socket: { remoteAddress: "8.8.8.8" },
      } as unknown as express.Request;

      const statusCode = { value: 0 };
      const jsonBody = { value: null as unknown };
      const res = {
        status: (code: number) => {
          statusCode.value = code;
          return {
            json: (body: unknown) => {
              jsonBody.value = body;
            },
          };
        },
      } as unknown as express.Response;

      const next = vi.fn();
      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(statusCode.value).toBe(403);
      expect(jsonBody.value).toEqual({ error: "Access denied. GUI restricted to tailnet." });
    });

    it("passes for tailnet IP 100.100.50.25 when gui.funnel=false", () => {
      const config = JorchBotConfigSchema.parse({ gui: { funnel: false } });
      const middleware = createGuiAccessMiddleware(() => config);

      const req = {
        path: "/overview",
        ip: "100.100.50.25",
        socket: { remoteAddress: "100.100.50.25" },
      } as unknown as express.Request;

      const res = {} as express.Response;
      const next = vi.fn();
      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});
