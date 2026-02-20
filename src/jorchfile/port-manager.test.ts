import { createServer } from "node:net";
import type { Server } from "node:net";
import { describe, it, expect, afterEach } from "vitest";
import { PortManager } from "./port-manager.js";

describe("PortManager", () => {
  const pm = new PortManager();
  const servers: Server[] = [];

  afterEach(() => {
    for (const server of servers) {
      server.close();
    }
    servers.length = 0;
  });

  /** Occupy a port and track the server for cleanup */
  function occupyPort(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.once("listening", () => {
        servers.push(server);
        resolve();
      });
      server.listen(port, "127.0.0.1");
    });
  }

  it("returns desired port if free", async () => {
    // Use a high ephemeral port unlikely to be in use
    const port = await pm.findAvailablePort(59100);

    expect(port).toBe(59100);
  });

  it("auto-increments if port is occupied", async () => {
    await occupyPort(59200);

    const port = await pm.findAvailablePort(59200);

    expect(port).toBe(59201);
  });

  it("isPortFree returns true for free port", async () => {
    const free = await pm.isPortFree(59300);

    expect(free).toBe(true);
  });

  it("isPortFree returns false for occupied port", async () => {
    await occupyPort(59400);

    const free = await pm.isPortFree(59400);

    expect(free).toBe(false);
  });
});
