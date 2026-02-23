import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
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
        >${t("tunnels.funnel")}</span
      >
    `;
  }
  return html`
    <span class="pill" style="font-size: 11px">${t("tunnels.serve")}</span>
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
        ${t("tunnels.localPort")} <span class="mono">${tunnel.localPort}</span>
        ${tunnel.assignedPort !== tunnel.localPort ? html` → ${t("tunnels.publicPort")} <span class="mono">${tunnel.assignedPort}</span>` : nothing}
      </div>
      ${
        tunnel.url
          ? html`<div style="font-size: 12px; margin-bottom: 8px; overflow-wrap: anywhere;">
              URL: <a href="${tunnel.url}" target="_blank" rel="noreferrer" class="mono" style="word-break: break-all;">${tunnel.url}</a>
            </div>`
          : nothing
      }
      <div class="row" style="gap: 6px;">
        <button class="btn btn--sm btn--danger" @click=${() => props.onStop(tunnel.id)}>${t("common.stop")}</button>
      </div>
    </div>
  `;
}

function renderProxyRoute(route: ProxyRouteView, props: TunnelsProps) {
  return html`
    <div class="row" style="align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--border, #333); flex-wrap: wrap;">
      <span class="mono" style="font-size: 12px; min-width: 80px; word-break: break-all;">${route.path}</span>
      <span style="font-size: 12px;">→</span>
      <span class="mono" style="font-size: 12px; flex: 1; min-width: 0; word-break: break-all;">${route.target}</span>
      <span class="muted" style="font-size: 11px;">${route.project}</span>
      <button class="btn btn--sm btn--danger" @click=${() => props.onRemoveRoute(route.path)}>${t("common.remove")}</button>
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
          ${props.loading ? t("common.loading") : t("common.refresh")}
        </button>
      </div>
      ${props.error ? html`<div class="callout danger" style="margin-bottom: 12px;">${props.error}</div>` : nothing}

      <h3 style="margin-bottom: 12px;">${t("tunnels.tailscaleTunnels")}</h3>
      ${
        tunnels.length === 0 && !props.loading
          ? html`
              <div class="muted" style="padding: 12px 0">${t("tunnels.noTunnels")}</div>
            `
          : nothing
      }
      ${tunnels.map((t) => renderTunnelCard(t, props))}

      <h3 style="margin: 24px 0 12px;">${t("tunnels.funnelProxy")}</h3>
      ${
        proxyStatus
          ? html`
              <div class="row" style="gap: 8px; margin-bottom: 12px; align-items: center;">
                <span class="statusDot ${proxyStatus.running ? "ok" : "muted"}"></span>
                <span>${proxyStatus.running ? t("common.running") : t("common.stopped")}</span>
                ${proxyStatus.running ? html`<span class="muted" style="font-size: 12px;">${t("tunnels.port")} <span class="mono">${proxyStatus.port}</span></span>` : nothing}
                <span class="muted" style="font-size: 12px;">${proxyStatus.routeCount} ${proxyStatus.routeCount !== 1 ? t("common.routes") : t("common.route")}</span>
              </div>
            `
          : nothing
      }
      ${
        routes.length === 0
          ? html`
              <div class="muted" style="padding: 12px 0">${t("tunnels.noRoutes")}</div>
            `
          : routes.map((r) => renderProxyRoute(r, props))
      }
    </section>
  `;
}
