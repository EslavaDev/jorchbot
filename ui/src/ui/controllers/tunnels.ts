import type { GatewayBrowserClient } from "../gateway.ts";
import type { TunnelsListResult, ProxyRoutesListResult, ProxyStatusResult } from "../types.ts";

export type TunnelsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  tunnelsLoading: boolean;
  tunnelsResult: TunnelsListResult | null;
  tunnelsError: string | null;
  proxyRoutesResult: ProxyRoutesListResult | null;
  proxyStatusResult: ProxyStatusResult | null;
};

export async function loadTunnels(state: TunnelsState): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.tunnelsLoading) {
    return;
  }
  state.tunnelsLoading = true;
  state.tunnelsError = null;
  try {
    const [tunnelsRes, routesRes, statusRes] = await Promise.all([
      state.client.request<TunnelsListResult | undefined>("jb.tunnels.list", {}),
      state.client.request<ProxyRoutesListResult | undefined>("jb.proxy.routes.list", {}),
      state.client.request<ProxyStatusResult | undefined>("jb.proxy.status", {}),
    ]);
    if (tunnelsRes) {
      state.tunnelsResult = tunnelsRes;
    }
    if (routesRes) {
      state.proxyRoutesResult = routesRes;
    }
    if (statusRes) {
      state.proxyStatusResult = statusRes;
    }
  } catch (err) {
    state.tunnelsError = String(err);
  } finally {
    state.tunnelsLoading = false;
  }
}

export async function createTunnel(
  state: TunnelsState,
  input: {
    project: string;
    sessionId: string;
    localPort: number;
    mode?: string;
    funnelPath?: string;
  },
): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    await state.client.request("jb.tunnels.create", input);
    await loadTunnels(state);
  } catch (err) {
    state.tunnelsError = String(err);
  }
}

export async function stopTunnel(state: TunnelsState, tunnelId: string): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    await state.client.request("jb.tunnels.delete", { tunnelId });
    await loadTunnels(state);
  } catch (err) {
    state.tunnelsError = String(err);
  }
}

export async function addProxyRoute(
  state: TunnelsState,
  path: string,
  target: string,
): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    await state.client.request("jb.proxy.routes.add", { path, target });
    await loadTunnels(state);
  } catch (err) {
    state.tunnelsError = String(err);
  }
}

export async function removeProxyRoute(state: TunnelsState, path: string): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    await state.client.request("jb.proxy.routes.remove", { path });
    await loadTunnels(state);
  } catch (err) {
    state.tunnelsError = String(err);
  }
}
