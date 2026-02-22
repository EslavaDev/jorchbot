import { t } from "../i18n/index.ts";
import type { IconName } from "./icons.js";

export const TAB_GROUPS = [
  { label: "chat", tabs: ["chat"] },
  {
    label: "control",
    tabs: ["overview", "channels", "instances", "sessions", "usage", "cron"],
  },
  { label: "agent", tabs: ["agents", "skills", "nodes"] },
  { label: "settings", tabs: ["config", "debug", "logs"] },
] as const;

export type Tab =
  | "agents"
  | "overview"
  | "channels"
  | "instances"
  | "sessions"
  | "usage"
  | "cron"
  | "skills"
  | "nodes"
  | "chat"
  | "config"
  | "debug"
  | "logs"
  // JorchBot additions:
  | "workspaces"
  | "tunnels"
  | "jorchfile";

const TAB_PATHS: Record<Tab, string> = {
  agents: "/agents",
  overview: "/overview",
  channels: "/channels",
  instances: "/instances",
  sessions: "/sessions",
  usage: "/usage",
  cron: "/cron",
  skills: "/skills",
  nodes: "/nodes",
  chat: "/chat",
  config: "/config",
  debug: "/debug",
  logs: "/logs",
  // JorchBot additions:
  workspaces: "/workspaces",
  tunnels: "/tunnels",
  jorchfile: "/jorchfile",
};

/** Tabs hidden from the JorchBot sidebar (OpenClaw-specific, not relevant). */
const HIDDEN_TABS: ReadonlySet<Tab> = new Set([
  "chat",
  "instances",
  "usage",
  "cron",
  "agents",
  "skills",
]);

/** JorchBot-specific tab groups — replaces TAB_GROUPS in the sidebar. */
const JB_TAB_GROUPS: ReadonlyArray<{ label: string; tabs: Tab[] }> = [
  { label: "jorchbot", tabs: ["overview", "workspaces", "sessions"] },
  { label: "infrastructure", tabs: ["tunnels", "channels"] },
  { label: "configuration", tabs: ["jorchfile", "config"] },
  { label: "system", tabs: ["nodes", "debug", "logs"] },
];

/**
 * Visible tab groups for JorchBot.
 * Filters out hidden tabs and removes empty groups.
 */
export const VISIBLE_TAB_GROUPS = JB_TAB_GROUPS.map((group) => ({
  ...group,
  tabs: group.tabs.filter((tab) => !HIDDEN_TABS.has(tab)),
})).filter((group) => group.tabs.length > 0);

/** Title overrides for renamed/new JorchBot tabs. */
const JB_TAB_TITLES: Partial<Record<Tab, string>> = {
  nodes: "Devices",
  workspaces: "Workspaces",
  tunnels: "Tunnels",
  jorchfile: "Jorchfile",
};

const PATH_TO_TAB = new Map(Object.entries(TAB_PATHS).map(([tab, path]) => [path, tab as Tab]));

export function normalizeBasePath(basePath: string): string {
  if (!basePath) {
    return "";
  }
  let base = basePath.trim();
  if (!base.startsWith("/")) {
    base = `/${base}`;
  }
  if (base === "/") {
    return "";
  }
  if (base.endsWith("/")) {
    base = base.slice(0, -1);
  }
  return base;
}

export function normalizePath(path: string): string {
  if (!path) {
    return "/";
  }
  let normalized = path.trim();
  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export function pathForTab(tab: Tab, basePath = ""): string {
  const base = normalizeBasePath(basePath);
  const path = TAB_PATHS[tab];
  return base ? `${base}${path}` : path;
}

/** Check if a tab is hidden in JorchBot's sidebar. */
export function isHiddenTab(tab: Tab): boolean {
  return HIDDEN_TABS.has(tab);
}

export function tabFromPath(pathname: string, basePath = ""): Tab | null {
  const base = normalizeBasePath(basePath);
  let path = pathname || "/";
  if (base) {
    if (path === base) {
      path = "/";
    } else if (path.startsWith(`${base}/`)) {
      path = path.slice(base.length);
    }
  }
  let normalized = normalizePath(path).toLowerCase();
  if (normalized.endsWith("/index.html")) {
    normalized = "/";
  }
  if (normalized === "/") {
    return "overview";
  }
  return PATH_TO_TAB.get(normalized) ?? null;
}

export function inferBasePathFromPathname(pathname: string): string {
  let normalized = normalizePath(pathname);
  if (normalized.endsWith("/index.html")) {
    normalized = normalizePath(normalized.slice(0, -"/index.html".length));
  }
  if (normalized === "/") {
    return "";
  }
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) {
    return "";
  }
  for (let i = 0; i < segments.length; i++) {
    const candidate = `/${segments.slice(i).join("/")}`.toLowerCase();
    if (PATH_TO_TAB.has(candidate)) {
      const prefix = segments.slice(0, i);
      return prefix.length ? `/${prefix.join("/")}` : "";
    }
  }
  return `/${segments.join("/")}`;
}

export function iconForTab(tab: Tab): IconName {
  switch (tab) {
    case "agents":
      return "folder";
    case "chat":
      return "messageSquare";
    case "overview":
      return "barChart";
    case "channels":
      return "link";
    case "instances":
      return "radio";
    case "sessions":
      return "fileText";
    case "usage":
      return "barChart";
    case "cron":
      return "loader";
    case "skills":
      return "zap";
    case "nodes":
      return "monitor";
    case "config":
      return "settings";
    case "debug":
      return "bug";
    case "logs":
      return "scrollText";
    case "workspaces":
      return "folder";
    case "tunnels":
      return "link";
    case "jorchfile":
      return "fileText";
    default:
      return "folder";
  }
}

export function titleForTab(tab: Tab) {
  return JB_TAB_TITLES[tab] ?? t(`tabs.${tab}`);
}

export function subtitleForTab(tab: Tab) {
  return t(`subtitles.${tab}`);
}
