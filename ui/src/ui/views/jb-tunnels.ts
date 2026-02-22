import { html, nothing } from "lit";
import type {
  TunnelView,
  TunnelsListResult,
  ProxyRoutesListResult,
  ProxyStatusResult,
  ProxyRouteView,
} from "../types.ts";

export type TunnelsProps = {
  loading: boolean;
  tunnelsResult: TunnelsListResult | null;
  proxyRoutesResult: ProxyRoutesListResult | null;
  proxyStatusResult: ProxyStatusResult | null;
  error: string | null;
  onRefresh: () => void;
  onStop: (tunnelId: string) => void;
  onAddRoute: (path: string, target: string) => void;
  onRemoveRoute: (path: string) => void;
};

function modeBadge(mode: string) {
  if (mode === "funnel") {
    return html`
      <span class="pill" style="font-size: 11px; background: var(--warn, #f59e0b); color: #000"
        >Funnel</span
      >
    `;
  }
  return html`
    <span class="pill" style="font-size: 11px">Serve</span>
  `;
}

function statusDotClass(status: string): string {
  switch (status) {
    case "active":
      return "ok";
    case "stopped":
      return "muted";
    case "error":
      return "danger";
    case "starting":
      return "warn";
    default:
      return "";
  }
}

function renderTunnelCard(tunnel: TunnelView, props: TunnelsProps) {
  return html`
    <div class="card" style="margin-bottom: 12px;">
      <div class="row" style="align-items: center; gap: 8px; margin-bottom: 8px;">
        <span class="statusDot ${statusDotClass(tunnel.status)}"></span>
        <strong>${tunnel.project}</strong>
        ${modeBadge(tunnel.mode)}
        <span class="muted" style="font-size: 12px; margin-left: auto;">${tunnel.status}</span>
      </div>
      <div class="muted" style="font-size: 12px; margin-bottom: 4px;">
        Local port: <span class="mono">${tunnel.localPort}</span>
        ${tunnel.assignedPort !== tunnel.localPort ? html` → Public port: <span class="mono">${tunnel.assignedPort}</span>` : nothing}
      </div>
      ${
        tunnel.url
          ? html`<div style="font-size: 12px; margin-bottom: 8px;">
              URL: <a href="${tunnel.url}" target="_blank" rel="noreferrer" class="mono">${tunnel.url}</a>
            </div>`
          : nothing
      }
      <div class="row" style="gap: 6px;">
        <button class="btn btn--sm btn--danger" @click=${() => props.onStop(tunnel.id)}>Stop</button>
      </div>
    </div>
  `;
}

function renderProxyRoute(route: ProxyRouteView, props: TunnelsProps) {
  return html`
    <div class="row" style="align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--border, #333);">
      <span class="mono" style="font-size: 12px; min-width: 120px;">${route.path}</span>
      <span style="font-size: 12px;">→</span>
      <span class="mono" style="font-size: 12px; flex: 1;">${route.target}</span>
      <span class="muted" style="font-size: 11px;">${route.project}</span>
      <button class="btn btn--sm btn--danger" @click=${() => props.onRemoveRoute(route.path)}>Remove</button>
    </div>
  `;
}

export function renderTunnels(props: TunnelsProps) {
  const tunnels = props.tunnelsResult?.tunnels ?? [];
  const routes = props.proxyRoutesResult?.routes ?? [];
  const proxyStatus = props.proxyStatusResult;

  return html`
    <section>
      <div class="row" style="margin-bottom: 16px; gap: 8px; align-items: center;">
        <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
          ${props.loading ? "Loading\u2026" : "Refresh"}
        </button>
      </div>
      ${props.error ? html`<div class="callout danger" style="margin-bottom: 12px;">${props.error}</div>` : nothing}

      <h3 style="margin-bottom: 12px;">Tailscale Tunnels</h3>
      ${
        tunnels.length === 0 && !props.loading
          ? html`
              <div class="muted" style="padding: 12px 0">No active tunnels.</div>
            `
          : nothing
      }
      ${tunnels.map((t) => renderTunnelCard(t, props))}

      <h3 style="margin: 24px 0 12px;">Funnel Proxy</h3>
      ${
        proxyStatus
          ? html`
              <div class="row" style="gap: 8px; margin-bottom: 12px; align-items: center;">
                <span class="statusDot ${proxyStatus.running ? "ok" : "muted"}"></span>
                <span>${proxyStatus.running ? "Running" : "Stopped"}</span>
                ${proxyStatus.running ? html`<span class="muted" style="font-size: 12px;">Port: <span class="mono">${proxyStatus.port}</span></span>` : nothing}
                <span class="muted" style="font-size: 12px;">${proxyStatus.routeCount} route${proxyStatus.routeCount !== 1 ? "s" : ""}</span>
              </div>
            `
          : nothing
      }
      ${
        routes.length === 0
          ? html`
              <div class="muted" style="padding: 12px 0">No proxy routes configured.</div>
            `
          : routes.map((r) => renderProxyRoute(r, props))
      }
    </section>
  `;
}
