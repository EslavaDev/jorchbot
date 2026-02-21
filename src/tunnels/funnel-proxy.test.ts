import http from "node:http";
import net from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FunnelProxyRouteConflictError } from "../errors/index.js";
import { FunnelProxy } from "./funnel-proxy.js";

/** Get a random available port */
function getRandomPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close();
        reject(new Error("Could not get address"));
        return;
      }
      const { port } = addr;
      srv.close(() => resolve(port));
    });
  });
}

/** Create a simple HTTP server that echoes back */
function createEchoServer(
  port: number,
): Promise<{ server: http.Server; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ url: req.url, method: req.method }));
    });
    server.listen(port, "127.0.0.1", () => {
      resolve({
        server,
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}

/** Simple HTTP request helper with optional headers */
function httpGet(
  url: string,
  headers?: Record<string, string>,
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const req = http.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        headers,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on("end", () => {
          resolve({ statusCode: res.statusCode ?? 0, body });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("FunnelProxy", () => {
  let proxyPort: number;
  let proxy: FunnelProxy;

  beforeEach(async () => {
    proxyPort = await getRandomPort();
    proxy = new FunnelProxy(proxyPort);
  });

  afterEach(async () => {
    await proxy.stop();
  });

  describe("lifecycle", () => {
    it("start() + stop() lifecycle works", async () => {
      expect(proxy.isRunning()).toBe(false);

      await proxy.start();
      expect(proxy.isRunning()).toBe(true);

      await proxy.stop();
      expect(proxy.isRunning()).toBe(false);
    });

    it("start() is idempotent when already running", async () => {
      await proxy.start();
      await proxy.start(); // should not throw
      expect(proxy.isRunning()).toBe(true);
    });

    it("stop() is safe when not running", async () => {
      await proxy.stop(); // should not throw
    });

    it("getPort() returns configured port", () => {
      expect(proxy.getPort()).toBe(proxyPort);
    });
  });

  describe("route management", () => {
    it("addRoute() registers route, removeRoute() removes it", () => {
      proxy.addRoute({
        path: "/frontend",
        target: "http://localhost:3000",
        project: "frontend",
      });

      expect(proxy.hasRoute("/frontend")).toBe(true);
      expect(proxy.listRoutes()).toHaveLength(1);

      proxy.removeRoute("/frontend");
      expect(proxy.hasRoute("/frontend")).toBe(false);
      expect(proxy.listRoutes()).toHaveLength(0);
    });

    it("duplicate addRoute() throws FunnelProxyRouteConflictError", () => {
      proxy.addRoute({
        path: "/frontend",
        target: "http://localhost:3000",
        project: "frontend",
      });

      expect(() =>
        proxy.addRoute({
          path: "/frontend",
          target: "http://localhost:4000",
          project: "other",
        }),
      ).toThrow(FunnelProxyRouteConflictError);
    });

    it("normalizes paths (strips trailing slash, adds leading slash)", () => {
      proxy.addRoute({
        path: "frontend/",
        target: "http://localhost:3000",
        project: "frontend",
      });

      expect(proxy.hasRoute("/frontend")).toBe(true);
      expect(proxy.hasRoute("/frontend/")).toBe(true);
    });
  });

  describe("HTTP routing", () => {
    it("routes HTTP request to correct target", async () => {
      const targetPort = await getRandomPort();
      const echo = await createEchoServer(targetPort);

      try {
        proxy.addRoute({
          path: "/frontend",
          target: `http://127.0.0.1:${targetPort}`,
          project: "frontend",
        });
        await proxy.start();

        const res = await httpGet(`http://127.0.0.1:${proxyPort}/frontend/index.html`);
        expect(res.statusCode).toBe(200);

        const body = JSON.parse(res.body) as { url: string };
        expect(body.url).toBe("/index.html");
      } finally {
        await echo.close();
      }
    });

    it("strips path prefix before proxying", async () => {
      const targetPort = await getRandomPort();
      const echo = await createEchoServer(targetPort);

      try {
        proxy.addRoute({
          path: "/api",
          target: `http://127.0.0.1:${targetPort}`,
          project: "api",
        });
        await proxy.start();

        const res = await httpGet(`http://127.0.0.1:${proxyPort}/api/v1/users`);
        expect(res.statusCode).toBe(200);

        const body = JSON.parse(res.body) as { url: string };
        expect(body.url).toBe("/v1/users");
      } finally {
        await echo.close();
      }
    });

    it("returns 404 for unmatched paths without Referer", async () => {
      await proxy.start();

      const res = await httpGet(`http://127.0.0.1:${proxyPort}/unknown`);
      expect(res.statusCode).toBe(404);
      expect(res.body).toContain("Not Found");
    });

    it("routes unmatched path via Referer header (SPA asset catch-all)", async () => {
      const targetPort = await getRandomPort();
      const echo = await createEchoServer(targetPort);

      try {
        proxy.addRoute({
          path: "/auth",
          target: `http://127.0.0.1:${targetPort}`,
          project: "auth",
        });
        await proxy.start();

        // Simulate Vite requesting /@vite/client with Referer from /auth page
        const res = await httpGet(`http://127.0.0.1:${proxyPort}/@vite/client`, {
          referer: `http://127.0.0.1:${proxyPort}/auth`,
        });
        expect(res.statusCode).toBe(200);

        // URL should NOT be stripped (forwarded as-is)
        const body = JSON.parse(res.body) as { url: string };
        expect(body.url).toBe("/@vite/client");
      } finally {
        await echo.close();
      }
    });

    it("deep Referer chain resolves via path-route cache (Chrome ES module imports)", async () => {
      const targetPort = await getRandomPort();
      const echo = await createEchoServer(targetPort);

      try {
        proxy.addRoute({
          path: "/auth",
          target: `http://127.0.0.1:${targetPort}`,
          project: "auth",
        });
        await proxy.start();

        // Step 1: Browser loads /auth → prefix match (populates cache for "/auth")
        const page = await httpGet(`http://127.0.0.1:${proxyPort}/auth`);
        expect(page.statusCode).toBe(200);

        // Step 2: HTML loads /src/main.jsx with Referer /auth → direct referer match
        //         (populates cache for "/src/main.jsx")
        const mainJsx = await httpGet(`http://127.0.0.1:${proxyPort}/src/main.jsx`, {
          referer: `http://127.0.0.1:${proxyPort}/auth`,
        });
        expect(mainJsx.statusCode).toBe(200);

        // Step 3: main.jsx imports react.js with Referer /src/main.jsx
        //         Referer "/src/main.jsx" does NOT start with "/auth" — needs cache lookup
        const react = await httpGet(
          `http://127.0.0.1:${proxyPort}/node_modules/.vite/deps/react.js?v=5cd256f0`,
          {
            referer: `http://127.0.0.1:${proxyPort}/src/main.jsx`,
          },
        );
        expect(react.statusCode).toBe(200);

        const body = JSON.parse(react.body) as { url: string };
        expect(body.url).toBe("/node_modules/.vite/deps/react.js?v=5cd256f0");
      } finally {
        await echo.close();
      }
    });

    it("Referer catch-all picks correct route among multiple", async () => {
      const targetA = await getRandomPort();
      const targetB = await getRandomPort();
      const echoA = await createEchoServer(targetA);
      const echoB = await createEchoServer(targetB);

      try {
        proxy.addRoute({
          path: "/auth",
          target: `http://127.0.0.1:${targetA}`,
          project: "auth",
        });
        proxy.addRoute({
          path: "/admin",
          target: `http://127.0.0.1:${targetB}`,
          project: "admin",
        });
        await proxy.start();

        // Request from /admin page — should route to admin target
        const res = await httpGet(`http://127.0.0.1:${proxyPort}/src/main.jsx`, {
          referer: `http://127.0.0.1:${proxyPort}/admin/dashboard`,
        });
        expect(res.statusCode).toBe(200);

        const body = JSON.parse(res.body) as { url: string };
        expect(body.url).toBe("/src/main.jsx");
      } finally {
        await echoA.close();
        await echoB.close();
      }
    });
  });

  describe("WebSocket upgrade", () => {
    it("destroys socket for unmatched upgrade requests", async () => {
      await proxy.start();

      // Send an upgrade request to an unmatched path — should destroy socket
      const destroyed = await new Promise<boolean>((resolve) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: proxyPort,
            path: "/unknown",
            headers: {
              Connection: "Upgrade",
              Upgrade: "websocket",
            },
          },
          () => {
            resolve(false);
          },
        );
        req.on("upgrade", () => {
          resolve(false);
        });
        req.on("error", () => {
          // Socket was destroyed — this is expected
          resolve(true);
        });
        req.end();
      });

      expect(destroyed).toBe(true);
    });
  });
});
