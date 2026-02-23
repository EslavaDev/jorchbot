import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { WorkspaceView, WorkspacesListResult } from "../types.ts";

export type WorkspacesProps = {
  loading: boolean;
  result: WorkspacesListResult | null;
  error: string | null;
  onRefresh: () => void;
  onFocus: (project: string) => void;
  onCompact: (project: string) => void;
  onStop: (project: string) => void;
  onRestart: (project: string) => void;
  onDelete: (project: string) => void;
  onCreate: (input: {
    project: string;
    path: string;
    initialMode?: string;
    initialOutputMode?: string;
  }) => void;
};

function contextColor(percent: number): string {
  if (percent >= 90) {
    return "var(--danger, #ef4444)";
  }
  if (percent >= 70) {
    return "var(--warn, #f59e0b)";
  }
  return "var(--ok, #22c55e)";
}

function statusDotClass(status: string): string {
  switch (status) {
    case "running":
      return "ok";
    case "stopped":
      return "muted";
    case "error":
      return "danger";
    case "paused":
      return "muted";
    default:
      return "";
  }
}

function renderWorkspaceCard(ws: WorkspaceView, props: WorkspacesProps) {
  const color = contextColor(ws.contextPercent);
  return html`
    <div class="card" style="margin-bottom: 12px; ${ws.focused ? "border-left: 3px solid var(--accent, #6366f1);" : ""}">
      <div class="row" style="align-items: center; gap: 8px; margin-bottom: 8px;">
        <span class="statusDot ${statusDotClass(ws.status)}"></span>
        <strong>${ws.name}</strong>
        ${
          ws.focused
            ? html`
                <span class="pill" style="font-size: 11px">${t("workspaces.focused")}</span>
              `
            : nothing
        }
        <span class="pill" style="font-size: 11px;">${ws.mode}</span>
        <span class="muted" style="font-size: 12px; margin-left: auto;">${ws.status}</span>
      </div>
      <div class="muted" style="font-size: 12px; margin-bottom: 8px;">${ws.path}</div>
      <div style="margin-bottom: 8px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <div style="flex: 1; height: 8px; background: var(--surface-2, #1e1e1e); border-radius: 4px; overflow: hidden;">
            <div style="width: ${ws.contextPercent}%; height: 100%; background: ${color}; border-radius: 4px; transition: width 0.3s ease;"></div>
          </div>
          <span class="mono" style="font-size: 12px; min-width: 36px;">${ws.contextPercent}%</span>
        </div>
      </div>
      ${
        ws.commands.length > 0
          ? html`
          <div style="margin-bottom: 8px; font-size: 12px;">
            <span class="muted">${t("common.commands")}:</span>
            ${ws.commands.map(
              (cmd) =>
                html`<span class="pill" style="font-size: 11px; margin-left: 4px;">${cmd.name}</span>`,
            )}
          </div>
        `
          : nothing
      }
      <div class="row" style="gap: 6px; flex-wrap: wrap;">
        ${
          ws.focused
            ? nothing
            : html`<button class="btn btn--sm" @click=${() => props.onFocus(ws.name)}>${t("common.focus")}</button>`
        }
        <button class="btn btn--sm" @click=${() => props.onCompact(ws.name)}>${t("common.compact")}</button>
        <button class="btn btn--sm" @click=${() => props.onStop(ws.name)}>${t("common.stop")}</button>
        <button class="btn btn--sm" @click=${() => props.onRestart(ws.name)}>${t("common.restart")}</button>
        ${
          !ws.enabled
            ? html`<button class="btn btn--sm btn--danger" @click=${() => props.onDelete(ws.name)}>${t("common.delete")}</button>`
            : nothing
        }
      </div>
    </div>
  `;
}

export function renderWorkspaces(props: WorkspacesProps) {
  const workspaces = props.result?.workspaces ?? [];
  return html`
    <section>
      <div class="row" style="margin-bottom: 16px; gap: 8px; align-items: center;">
        <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
          ${props.loading ? t("common.loading") : t("common.refresh")}
        </button>
      </div>
      ${props.error ? html`<div class="callout danger" style="margin-bottom: 12px;">${props.error}</div>` : nothing}
      ${
        workspaces.length === 0 && !props.loading
          ? html`
              <div class="muted" style="padding: 24px 0">
                ${t("workspaces.noWorkspaces")}
              </div>
            `
          : nothing
      }
      ${workspaces.map((ws) => renderWorkspaceCard(ws, props))}
    </section>
  `;
}
