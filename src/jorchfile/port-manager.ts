import { createServer } from "node:net";

const MAX_PORT_SEARCH = 100;

export class PortManager {
  /**
   * Find an available port starting from the desired port.
   * If the desired port is in use, increments until finding a free one.
   *
   * @param desired - The preferred port number
   * @returns The first available port (may equal desired)
   * @throws {Error} If no free port found within MAX_PORT_SEARCH range
   */
  async findAvailablePort(desired: number): Promise<number> {
    for (let port = desired; port < desired + MAX_PORT_SEARCH; port++) {
      const free = await this.isPortFree(port);
      if (free) {
        return port;
      }
    }
    throw new Error(`No free port found in range ${desired}-${desired + MAX_PORT_SEARCH - 1}`);
  }

  /**
   * Check if a port is available by attempting to listen on it.
   */
  async isPortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close(() => resolve(true));
      });
      server.listen(port, "127.0.0.1");
    });
  }
}
