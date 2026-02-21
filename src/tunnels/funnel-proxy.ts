import http from "node:http";
import httpProxy from "http-proxy";
import { FunnelProxyStartError, FunnelProxyRouteConflictError } from "../errors/index.js";

export interface FunnelProxyRoute {
  /** URL path prefix (e.g., "/frontend") */
  path: string;
  /** Target URL (e.g., "http://localhost:3000") */
  target: string;
  /** Project name for identification */
  project: string;
}

interface RouteMatch {
  route: FunnelProxyRoute;
  /** Whether to strip the route prefix from the URL before forwarding */
  stripPrefix: boolean;
}

export class FunnelProxy {
  private port: number;
  private routes = new Map<string, FunnelProxyRoute>();
  private server: http.Server | null = null;
  private proxy: httpProxy | null = null;

  /**
   * Cache of recently served URL paths → route.
   * Enables deep Referer chain resolution: when `/src/main.jsx` is served
   * via the `/auth` route, and `react.js` arrives with Referer `/src/main.jsx`,
   * we can look up the cached mapping to resolve it to `/auth`.
   */
  private pathRouteCache = new Map<string, { route: FunnelProxyRoute; at: number }>();
  private static PATH_CACHE_MAX = 500;
  private static PATH_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(port: number) {
    this.port = port;
  }

  /** Get the port the proxy listens on */
  getPort(): number {
    return this.port;
  }

  /** Is the proxy server currently running? */
  isRunning(): boolean {
    return this.server !== null && this.server.listening;
  }

  /**
   * Start the reverse proxy server.
   *
   * @throws {FunnelProxyStartError}
   */
  async start(): Promise<void> {
    if (this.isRunning()) {
      return;
    }

    this.proxy = httpProxy.createProxyServer({
      ws: true,
      changeOrigin: true,
    });

    this.proxy.on("error", (_err, _req, res) => {
      if (res && "writeHead" in res && !res.headersSent) {
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end("Bad Gateway — upstream is not responding");
      }
    });

    this.server = http.createServer((req, res) => {
      const url = req.url ?? "/";
      const match = this.resolveRoute(url, req.headers);
      if (!match) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found — no tunnel route matches this path");
        return;
      }

      this.recordServedPath(url, match.route);

      if (match.stripPrefix) {
        req.url = url.slice(match.route.path.length) || "/";
      }
      this.proxy!.web(req, res, { target: match.route.target });
    });

    // WebSocket upgrade handling
    this.server.on("upgrade", (req, socket, head) => {
      const url = req.url ?? "/";
      const match = this.resolveRoute(url, req.headers);
      if (!match) {
        socket.destroy();
        return;
      }

      this.recordServedPath(url, match.route);

      if (match.stripPrefix) {
        req.url = url.slice(match.route.path.length) || "/";
      }
      this.proxy!.ws(req, socket, head, { target: match.route.target });
    });

    return new Promise<void>((resolve, reject) => {
      this.server!.listen(this.port, "127.0.0.1", () => {
        resolve();
      });
      this.server!.on("error", (err) => {
        reject(new FunnelProxyStartError(this.port, err));
      });
    });
  }

  /** Stop the reverse proxy server */
  async stop(): Promise<void> {
    this.pathRouteCache.clear();

    if (this.proxy) {
      this.proxy.close();
      this.proxy = null;
    }

    if (this.server) {
      return new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
        this.server = null;
      });
    }
  }

  /**
   * Add a route to the proxy.
   *
   * @throws {FunnelProxyRouteConflictError} If path already registered
   */
  addRoute(route: FunnelProxyRoute): void {
    const normalized = this.normalizePath(route.path);
    if (this.routes.has(normalized)) {
      throw new FunnelProxyRouteConflictError(normalized);
    }
    this.routes.set(normalized, { ...route, path: normalized });
  }

  /** Remove a route by path */
  removeRoute(path: string): void {
    const normalized = this.normalizePath(path);
    this.routes.delete(normalized);
  }

  /** List all registered routes */
  listRoutes(): FunnelProxyRoute[] {
    return [...this.routes.values()];
  }

  /** Check if a path is registered */
  hasRoute(path: string): boolean {
    return this.routes.has(this.normalizePath(path));
  }

  /**
   * Resolve which route to use for a request. Three-stage matching:
   *
   * 1. **Prefix match**: URL starts with a registered path (e.g., `/auth/page`).
   *    The prefix is stripped before forwarding.
   *
   * 2. **Referer catch-all**: URL doesn't match any route prefix (e.g., `/@vite/client`)
   *    but the `Referer` header points to a known route.
   *    The URL is forwarded as-is (no stripping) — handles SPA dev servers
   *    whose assets use root-relative paths.
   *
   * 3. **Deep Referer chain**: The Referer itself doesn't match any route prefix
   *    (e.g., Referer is `/src/main.jsx`) but was previously served via a known route.
   *    Resolved via path-route cache. Handles nested ES module imports in Chrome
   *    where the Referer points to the importing module, not the original page.
   */
  private resolveRoute(url: string, headers: http.IncomingHttpHeaders): RouteMatch | undefined {
    // 1. Direct prefix match (longest wins)
    const prefixMatch = this.matchByPrefix(url);
    if (prefixMatch) {
      return { route: prefixMatch, stripPrefix: true };
    }

    // 2+3. Referer-based catch-all (direct route match + deep chain via cache)
    const refererMatch = this.matchByReferer(headers);
    if (refererMatch) {
      return { route: refererMatch, stripPrefix: false };
    }

    return undefined;
  }

  private matchByPrefix(url: string): FunnelProxyRoute | undefined {
    let bestMatch: FunnelProxyRoute | undefined;
    let bestLength = 0;

    for (const route of this.routes.values()) {
      if (url.startsWith(route.path) && route.path.length > bestLength) {
        bestMatch = route;
        bestLength = route.path.length;
      }
    }

    return bestMatch;
  }

  /**
   * Match a request by its Referer header. Two-level resolution:
   *
   * 1. Direct: Referer path starts with a registered route (e.g., Referer `/auth/page`)
   * 2. Cache: Referer path was previously served via a known route (e.g., Referer
   *    `/src/main.jsx` which was earlier resolved to the `/auth` route). This handles
   *    deep ES module import chains where Chrome sets the Referer to the importing
   *    module rather than the original page.
   */
  private matchByReferer(headers: http.IncomingHttpHeaders): FunnelProxyRoute | undefined {
    const referer = headers.referer;
    if (!referer) {
      return undefined;
    }

    try {
      const refUrl = new URL(referer);
      const refPath = refUrl.pathname;

      // 1. Direct route match from referer path
      let bestMatch: FunnelProxyRoute | undefined;
      let bestLength = 0;

      for (const route of this.routes.values()) {
        if (refPath.startsWith(route.path) && route.path.length > bestLength) {
          bestMatch = route;
          bestLength = route.path.length;
        }
      }

      if (bestMatch) {
        return bestMatch;
      }

      // 2. Deep chain: look up referer's full URL in the path-route cache
      const refKey = refPath + refUrl.search;
      const cached = this.pathRouteCache.get(refKey);
      if (cached && Date.now() - cached.at < FunnelProxy.PATH_CACHE_TTL_MS) {
        return cached.route;
      }

      return undefined;
    } catch {
      return undefined;
    }
  }

  /** Record that a URL was served via a specific route (for deep Referer chain resolution) */
  private recordServedPath(url: string, route: FunnelProxyRoute): void {
    if (this.pathRouteCache.size >= FunnelProxy.PATH_CACHE_MAX) {
      // Evict expired entries first
      const now = Date.now();
      for (const [key, entry] of this.pathRouteCache) {
        if (now - entry.at > FunnelProxy.PATH_CACHE_TTL_MS) {
          this.pathRouteCache.delete(key);
        }
      }
      // If still full, drop oldest half
      if (this.pathRouteCache.size >= FunnelProxy.PATH_CACHE_MAX) {
        const keys = [...this.pathRouteCache.keys()];
        for (let i = 0; i < keys.length >> 1; i++) {
          this.pathRouteCache.delete(keys[i]);
        }
      }
    }
    this.pathRouteCache.set(url, { route, at: Date.now() });
  }

  private normalizePath(path: string): string {
    // Ensure path starts with / and doesn't end with /
    let p = path.startsWith("/") ? path : `/${path}`;
    if (p.length > 1 && p.endsWith("/")) {
      p = p.slice(0, -1);
    }
    return p;
  }
}
