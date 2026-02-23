import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { loadConfig, saveConfig } from "../config/jorchbot-config-loader.js";
import { type JorchBotConfig, JorchBotConfigSchema } from "../config/jorchbot-config.js";
import { getDb } from "../db/index.js";
import { SessionNotFoundError } from "../errors/index.js";
import type { JorchfileExecutor } from "../jorchfile/executor.js";
import {
  DEFAULT_JORCHFILE_PATH,
  loadJorchfile as loadJorchfileFromDisk,
} from "../jorchfile/loader.js";
import type { JorchProject, JorchSettings } from "../jorchfile/parser.js";
// Dynamic imports for pairing-store to avoid circular chunk dependency in tsdown bundler.
// Static import pulls in channels/plugins/ → creates circular __exportAll issue.
import {
  CreateSessionInputSchema,
  type SessionManager,
  type SessionRecord,
} from "../sessions/jorchbot/manager.js";
import type { ApprovalMode, OutputMode } from "../sessions/jorchbot/types.js";
import { TunnelPendingConfirmation, type TunnelManager } from "../tunnels/manager.js";
import { TunnelStartInputSchema, type TunnelInfo } from "../tunnels/types.js";
import { blockDevice, listBlockedDevices, unblockDevice } from "./device-blacklist.js";
import type { RpcHandler } from "./jorchbot-ws.js";
import type { LogBuffer } from "./log-buffer.js";

// --- Phase G: Workspace types ---

/** G.2 — Command definition attached to a workspace. */
export interface WorkspaceCommand {
  name: string;
  command: string;
  description?: string;
}

/** G.1 — Full view of a workspace as presented to the GUI. */
export interface WorkspaceView {
  id: string;
  name: string;
  path: string;
  systemPrompt?: string;
  allowedTools?: string[];
  mode: ApprovalMode;
  outputMode: OutputMode;
  enabled: boolean;
  focused: boolean;
  contextPercent: number;
  status: "running" | "stopped" | "error" | "paused";
  lastMessage?: string;
  lastMessageAt?: number;
  commands: WorkspaceCommand[];
}

export interface RpcHandlerDeps {
  sessionManager: SessionManager;
  tunnelManager: TunnelManager;
  getJorchfileExecutor: () => JorchfileExecutor | null;
  config: JorchBotConfig;
  getUptime: () => number;
  logBuffer: LogBuffer;
}

/** Resolve a project name from a session key (UUID). Returns null if not found. */
function resolveProjectFromKey(sessionManager: SessionManager, key: string | null): string | null {
  if (!key) {
    return null;
  }
  // key may be a session UUID — look up project name
  for (const session of sessionManager.listActive()) {
    if (session.id === key || session.project === key) {
      return session.project;
    }
  }
  return null;
}

/**
 * Build the map of RPC method handlers for the JorchBot WS server.
 * Phase C provides core handlers: health, status, config.get/set/apply/schema.
 * Later phases add session, tunnel, workspace, and jorchfile handlers.
 */
export function buildRpcHandlers(deps: RpcHandlerDeps): Record<string, RpcHandler> {
  return {
    // C.16 — health
    health: () => {
      return { ok: true, uptime: deps.getUptime() };
    },

    // C.17 — status / jb.status
    "jb.status": () => {
      return {
        uptime: deps.getUptime(),
        activeSessions: deps.sessionManager.listActive().length,
        activeTunnels: deps.tunnelManager.list().length,
        focusedProject: null, // Phase G will wire this to the real focus model
      };
    },

    // Alias for jb.status
    status: () => {
      return {
        uptime: deps.getUptime(),
        activeSessions: deps.sessionManager.listActive().length,
        activeTunnels: deps.tunnelManager.list().length,
        focusedProject: null,
      };
    },

    // C.18 — config.get (ConfigSnapshot format for UI form rendering)
    "config.get": async () => {
      const config = loadConfig();
      const raw = JSON.stringify(config, null, 2);
      const hash = createHash("sha256").update(raw).digest("hex").slice(0, 16);

      // Merge pairing store entries into allowFrom so the UI shows real paired phones
      const { readChannelAllowFromStore } = await import("../pairing/pairing-store.js");
      const configObj = JSON.parse(raw) as Record<string, unknown>;
      const channels = (configObj.channels ?? {}) as Record<string, Record<string, unknown>>;
      for (const channelId of Object.keys(channels)) {
        try {
          const phones = await readChannelAllowFromStore(channelId);
          if (phones.length > 0) {
            const existing = Array.isArray(channels[channelId].allowFrom)
              ? (channels[channelId].allowFrom as string[])
              : [];
            const merged = [...new Set([...existing, ...phones])];
            channels[channelId].allowFrom = merged;
          }
        } catch {
          // Channel may not have a pairing store — skip
        }
      }
      const enrichedRaw = JSON.stringify(configObj, null, 2);

      return {
        config: configObj,
        raw: enrichedRaw,
        hash,
        valid: true,
        issues: [],
      };
    },

    // C.19 — config.set (accepts raw JSON string from UI or config object)
    // Saves to disk AND updates in-memory config so changes take effect immediately
    // (e.g., disabling a channel stops the webhook guard right away).
    "config.set": (params) => {
      // UI sends { raw: string, baseHash: string }
      // Direct callers may send { config: object | string }
      const rawInput = params.raw ?? params.config;
      const configData =
        typeof rawInput === "string" ? (JSON.parse(rawInput) as Record<string, unknown>) : rawInput;
      const parsed = JorchBotConfigSchema.parse(configData);
      saveConfig(parsed);
      // Apply to in-memory config so webhook guards and channels.status reflect changes
      Object.assign(deps.config, parsed);
      return { ok: true };
    },

    // C.20 — config.apply (save + reload into memory)
    "config.apply": (params) => {
      // If UI sends raw config, save it first
      const rawInput = params.raw ?? params.config;
      if (rawInput) {
        const configData =
          typeof rawInput === "string"
            ? (JSON.parse(rawInput) as Record<string, unknown>)
            : rawInput;
        const parsed = JorchBotConfigSchema.parse(configData);
        saveConfig(parsed);
      }
      const freshConfig = loadConfig();
      // Update the in-memory reference. We mutate the object keys so that
      // all callsites holding a reference to `deps.config` see the new values.
      Object.assign(deps.config, freshConfig);
      return { ok: true, reloaded: true };
    },

    // C.21 — config.schema (returns JSON Schema so UI can render editable forms)
    "config.schema": () => {
      const schema = JorchBotConfigSchema.toJSONSchema({ target: "jsonSchema7" });
      return {
        schema,
        uiHints: {
          "channels.kapso.apiKey": { sensitive: true, label: "API Key" },
          "channels.kapso.webhookSecret": { sensitive: true, label: "Webhook Secret" },
          "channels.kapso.webhookVerifyToken": { sensitive: true, label: "Webhook Verify Token" },
          "channels.telegram.botToken": { sensitive: true, label: "Bot Token" },
        },
        version: "1.0.0",
        generatedAt: new Date().toISOString(),
      };
    },

    // --- Phase F: Adapt Existing Tabs ---

    // F.1 — sessions.list
    "sessions.list": () => {
      const active = deps.sessionManager.listActive();
      return {
        ts: Date.now(),
        path: "",
        count: active.length,
        defaults: { model: null, contextTokens: null },
        sessions: active.map((s) => ({
          key: s.id,
          kind: "direct" as const,
          label: s.project,
          updatedAt: s.updatedAt instanceof Date ? s.updatedAt.getTime() : null,
          sessionId: s.id,
          // JorchBot-specific fields for the adapted view
          mode: s.mode,
          outputMode: s.outputMode,
          contextPercent: s.contextPercent,
          focused: s.focused,
          status: s.status,
        })),
      };
    },

    // F.2 — sessions.patch
    "sessions.patch": (params) => {
      // The UI sends `key` (session id) or `project` name. Resolve project from either.
      const project = (params.project as string | undefined) ?? null;
      const key = (params.key as string | undefined) ?? null;
      const resolvedProject = project ?? resolveProjectFromKey(deps.sessionManager, key);
      if (!resolvedProject) {
        return { ok: false, error: "Session not found" };
      }
      if (params.mode) {
        deps.sessionManager.setMode(resolvedProject, params.mode as "confirm" | "plan" | "auto");
      }
      if (params.outputMode) {
        deps.sessionManager.setOutputMode(
          resolvedProject,
          params.outputMode as "verbose" | "summary" | "silent",
        );
      }
      return { ok: true };
    },

    // F.3 — sessions.delete
    "sessions.delete": async (params) => {
      const project = (params.project as string | undefined) ?? null;
      const key = (params.key as string | undefined) ?? null;
      const resolvedProject = project ?? resolveProjectFromKey(deps.sessionManager, key);
      if (!resolvedProject) {
        return { ok: false, error: "Session not found" };
      }
      await deps.sessionManager.destroy(resolvedProject);
      return { ok: true };
    },

    // F.4 — sessions.compact (placeholder — compact triggers context compaction)
    "sessions.compact": (params) => {
      const project = params.project as string;
      const guard = deps.sessionManager.checkContextGuard(project);
      return {
        ok: true,
        project,
        contextPercent: guard?.percent ?? null,
      };
    },

    // F.5 — sessions.usage
    "sessions.usage": (params) => {
      const project = params.project as string;
      const guard = deps.sessionManager.checkContextGuard(project);
      if (!guard) {
        return { project, contextPercent: null, level: null };
      }
      return {
        project,
        contextPercent: guard.percent,
        level: guard.level,
      };
    },

    // F.6 — channels.status (ChannelsStatusSnapshot format expected by UI)
    // Shows ALL configured channels (even disabled ones) with accurate running/connected state.
    "channels.status": () => {
      const { channels, gateway } = deps.config;

      const channelMeta: Array<{ id: string; label: string; detailLabel: string }> = [];
      const channelOrder: string[] = [];
      const channelsMap: Record<string, unknown> = {};
      const channelAccounts: Record<string, Array<Record<string, unknown>>> = {};
      const channelLabels: Record<string, string> = {};

      // Kapso — always show if API key is configured (even when disabled)
      const kapsoConfigured = Boolean(channels.kapso.apiKey);
      if (kapsoConfigured || channels.kapso.enabled) {
        const id = "kapso";
        const enabled = channels.kapso.enabled;
        channelMeta.push({ id, label: "Kapso", detailLabel: "WhatsApp via Kapso API" });
        channelOrder.push(id);
        channelLabels[id] = "Kapso";
        channelsMap[id] = {
          configured: kapsoConfigured,
          running: enabled,
          connected: enabled && kapsoConfigured,
          webhookUrl: `http://${gateway.host}:${gateway.port}/webhooks/kapso`,
        };
        channelAccounts[id] = [
          {
            accountId: "default",
            name: "Kapso",
            enabled,
            configured: kapsoConfigured,
            linked: kapsoConfigured,
            running: enabled,
            connected: enabled && kapsoConfigured,
          },
        ];
      }

      // Telegram — always show if bot token is configured (even when disabled)
      const telegramConfigured = Boolean(channels.telegram.botToken);
      if (telegramConfigured || channels.telegram.enabled) {
        const id = "telegram";
        const enabled = channels.telegram.enabled;
        channelMeta.push({ id, label: "Telegram", detailLabel: "Telegram Bot" });
        channelOrder.push(id);
        channelLabels[id] = "Telegram";
        channelsMap[id] = {
          configured: telegramConfigured,
          running: enabled,
          connected: enabled && telegramConfigured,
        };
        channelAccounts[id] = [
          {
            accountId: "default",
            name: "Telegram Bot",
            enabled,
            configured: telegramConfigured,
            linked: telegramConfigured,
            running: enabled,
            connected: enabled && telegramConfigured,
          },
        ];
      }

      return {
        ts: Date.now(),
        channelOrder,
        channelLabels,
        channelMeta,
        channels: channelsMap,
        channelAccounts,
        channelDefaultAccountId: Object.fromEntries(channelOrder.map((id) => [id, "default"])),
      };
    },

    // F.7-F.8 — logs.tail
    "logs.tail": (params) => {
      const limit = typeof params.limit === "number" ? params.limit : 100;
      const lines = deps.logBuffer.tail(limit);
      return { lines, cursor: deps.logBuffer.size, truncated: false };
    },

    // --- Phase G: Tab Workspaces ---

    // G.3 — jb.workspaces.list
    "jb.workspaces.list": () => {
      const active = deps.sessionManager.listActive();
      return {
        ts: Date.now(),
        workspaces: active.map((s) => buildWorkspaceView(s, deps)),
      };
    },

    // G.4 — jb.workspaces.get
    "jb.workspaces.get": (params) => {
      const id = params.id as string;
      const session = deps.sessionManager.getSessionRecordById(id);
      return { workspace: buildWorkspaceView(session, deps) };
    },

    // G.5 — jb.workspaces.create
    "jb.workspaces.create": async (params) => {
      const input = CreateSessionInputSchema.parse(params);
      // GUI-initiated creates use a synthetic "gui" phone
      const session = await deps.sessionManager.create(input, "gui");
      return { workspace: buildWorkspaceView(session, deps) };
    },

    // G.6 — jb.workspaces.update
    "jb.workspaces.update": (params) => {
      const project = params.project as string;
      const session = deps.sessionManager.getByProject(project);
      if (!session) {
        throw new SessionNotFoundError(`Workspace "${project}" not found`);
      }
      if (params.mode !== undefined) {
        deps.sessionManager.setMode(project, params.mode as ApprovalMode);
      }
      if (params.outputMode !== undefined) {
        deps.sessionManager.setOutputMode(project, params.outputMode as OutputMode);
      }
      return { ok: true };
    },

    // G.7 — jb.workspaces.delete
    "jb.workspaces.delete": async (params) => {
      const project = params.project as string;
      await deps.sessionManager.destroy(project);
      return { ok: true };
    },

    // G.8 — jb.workspaces.enable
    "jb.workspaces.enable": (params) => {
      const project = params.project as string;
      const enabled = params.enabled as boolean;
      const session = deps.sessionManager.getByProject(project);
      if (!session) {
        throw new SessionNotFoundError(`Workspace "${project}" not found`);
      }
      // Pause/resume is a status toggle — use setMode as a proxy for now
      // Full pause/resume would require ClaudeRunner subprocess management
      void enabled;
      return { ok: true };
    },

    // G.9 — jb.session.focus
    "jb.session.focus": async (params) => {
      const project = params.project as string;
      // Use synthetic "gui" phone for GUI-initiated focus
      await deps.sessionManager.switchFocus(project, "gui");
      return { ok: true };
    },

    // G.10 — jb.session.compact
    "jb.session.compact": (params) => {
      const project = params.project as string;
      const guard = deps.sessionManager.checkContextGuard(project);
      if (!guard) {
        throw new SessionNotFoundError(`Workspace "${project}" not found`);
      }
      return { ok: true, contextPercent: guard.percent };
    },

    // G.11 — jb.session.stop
    "jb.session.stop": async (params) => {
      const project = params.project as string;
      await deps.sessionManager.destroy(project);
      return { ok: true };
    },

    // G.12 — jb.session.restart
    "jb.session.restart": async (params) => {
      const project = params.project as string;
      const record = deps.sessionManager.getSessionRecordByProject(project);
      await deps.sessionManager.destroy(project);
      const session = await deps.sessionManager.create(
        {
          project: record.project,
          path: record.path,
          initialMode: record.mode,
          initialOutputMode: record.outputMode,
        },
        record.ownerPhone ?? "gui",
      );
      return { workspace: buildWorkspaceView(session, deps) };
    },

    // G.13 — jb.workspaces.commands.list
    "jb.workspaces.commands.list": (params) => {
      const project = params.project as string;
      return { commands: getProjectCommands(deps, project) };
    },

    // G.14 — jb.workspaces.commands.create
    "jb.workspaces.commands.create": (params) => {
      const project = params.project as string;
      const name = params.name as string;
      const command = params.command as string;
      const executor = deps.getJorchfileExecutor();
      if (!executor) {
        return { ok: false, error: "Jorchfile not loaded" };
      }
      const jorchProject = executor.getProject(project);
      if (!jorchProject) {
        return { ok: false, error: `Project "${project}" not in Jorchfile` };
      }
      jorchProject.commands[name] = command;
      return { ok: true };
    },

    // G.15 — jb.workspaces.commands.delete
    "jb.workspaces.commands.delete": (params) => {
      const project = params.project as string;
      const name = params.name as string;
      const executor = deps.getJorchfileExecutor();
      if (!executor) {
        return { ok: false, error: "Jorchfile not loaded" };
      }
      const jorchProject = executor.getProject(project);
      if (!jorchProject) {
        return { ok: false, error: `Project "${project}" not in Jorchfile` };
      }
      delete jorchProject.commands[name];
      return { ok: true };
    },

    // --- Phase H: Tab Tunnels + FunnelProxy Management ---

    // H.1 — jb.tunnels.list
    "jb.tunnels.list": () => {
      const tunnels = deps.tunnelManager.list();
      return {
        tunnels: tunnels.map((t) => buildTunnelView(t)),
      };
    },

    // H.2 — jb.tunnels.create
    "jb.tunnels.create": async (params) => {
      const input = TunnelStartInputSchema.parse(params);
      try {
        const tunnel = await deps.tunnelManager.start(input);
        return { tunnel: buildTunnelView(tunnel) };
      } catch (err) {
        if (err instanceof TunnelPendingConfirmation) {
          return { pending: true, tunnelId: err.tunnelId };
        }
        throw err;
      }
    },

    // H.3 — jb.tunnels.delete
    "jb.tunnels.delete": async (params) => {
      const tunnelId = params.tunnelId as string;
      await deps.tunnelManager.stop(tunnelId);
      return { ok: true };
    },

    // H.4 — jb.proxy.routes.list
    "jb.proxy.routes.list": () => {
      const funnelProxy = deps.tunnelManager.getFunnelProxy();
      return { routes: funnelProxy.listRoutes() };
    },

    // H.5 — jb.proxy.routes.add
    "jb.proxy.routes.add": (params) => {
      const path = params.path as string;
      const target = params.target as string;
      const project = (params.project as string | undefined) ?? "manual";
      const funnelProxy = deps.tunnelManager.getFunnelProxy();
      funnelProxy.addRoute({ path, target, project });
      return { ok: true };
    },

    // H.6 — jb.proxy.routes.remove
    "jb.proxy.routes.remove": (params) => {
      const path = params.path as string;
      const funnelProxy = deps.tunnelManager.getFunnelProxy();
      funnelProxy.removeRoute(path);
      return { ok: true };
    },

    // H.7 — jb.proxy.status
    "jb.proxy.status": () => {
      const funnelProxy = deps.tunnelManager.getFunnelProxy();
      return {
        running: funnelProxy.isRunning(),
        port: funnelProxy.getPort(),
        routeCount: funnelProxy.listRoutes().length,
      };
    },

    // --- Phase I: Tab Devices ---

    // I.4 — jb.devices.block
    "jb.devices.block": (params) => {
      const deviceId = params.deviceId as string;
      const reason = (params.reason as string | undefined) ?? undefined;
      blockDevice(getDb(), deviceId, reason);
      return { ok: true };
    },

    // I.5 — jb.devices.unblock
    "jb.devices.unblock": (params) => {
      const deviceId = params.deviceId as string;
      unblockDevice(getDb(), deviceId);
      return { ok: true };
    },

    // I.5b — jb.devices.blocked (list blocked devices)
    "jb.devices.blocked": () => {
      const blocked = listBlockedDevices(getDb());
      return {
        devices: blocked.map((d) => ({
          deviceId: d.deviceId,
          reason: d.reason,
          blockedAt: d.blockedAt instanceof Date ? d.blockedAt.getTime() : null,
        })),
      };
    },

    // --- Device pairing (OpenClaw device-auth + ALL channel DM pairings) ---

    // Merges two systems into a single view:
    // 1. OpenClaw device-auth (browsers with tokens, roles, scopes)
    // 2. Channel DM pairings (all enabled channels — kapso, telegram, etc.)
    "device.pair.list": async () => {
      const { listDevicePairing, summarizeDeviceTokens } =
        await import("../infra/device-pairing.js");
      const { readChannelAllowFromStore, listChannelPairingRequests } =
        await import("../pairing/pairing-store.js");

      // Resolve enabled channels from config
      const config = loadConfig();
      const channelEntries: { id: string; label: string }[] = [];
      if (config.channels.kapso.enabled) {
        channelEntries.push({ id: "kapso", label: "Kapso" });
      }
      if (config.channels.telegram.enabled) {
        channelEntries.push({ id: "telegram", label: "Telegram" });
      }

      // Fetch device-auth + all channel data in parallel
      const [deviceList, ...channelResults] = await Promise.all([
        listDevicePairing(),
        ...channelEntries.map(async (ch) => ({
          channel: ch,
          phones: await readChannelAllowFromStore(ch.id),
          pending: await listChannelPairingRequests(ch.id),
        })),
      ]);

      // Redact token secrets from OpenClaw paired devices
      const pairedDevices = deviceList.paired.map((device) => {
        const { tokens, approvedScopes: _approvedScopes, ...rest } = device;
        return { ...rest, tokens: summarizeDeviceTokens(tokens) };
      });

      // Merge channel-paired accounts (all channels, skip duplicates)
      const existingDeviceIds = new Set(pairedDevices.map((d) => d.deviceId));
      const channelDevices = channelResults.flatMap((result) =>
        result.phones
          .filter((phone) => !existingDeviceIds.has(phone))
          .map((phone) => {
            existingDeviceIds.add(phone);
            return {
              deviceId: phone,
              displayName: `${phone} (${result.channel.label})`,
              roles: ["user"],
              scopes: [] as string[],
              createdAtMs: 0,
              approvedAtMs: 0,
            };
          }),
      );

      // Merge channel pending requests — use code as requestId so approve works
      const existingRequestIds = new Set(deviceList.pending.map((p) => p.requestId));
      const channelPending = channelResults.flatMap((result) =>
        result.pending
          .filter((req) => !existingRequestIds.has(req.code))
          .map((req) => {
            existingRequestIds.add(req.code);
            return {
              requestId: req.code,
              deviceId: req.id,
              displayName: `${req.meta?.displayName ?? req.id} (${result.channel.label})`,
              ts: Date.parse(req.createdAt) || undefined,
            };
          }),
      );

      return {
        paired: [...pairedDevices, ...channelDevices],
        pending: [...deviceList.pending, ...channelPending],
      };
    },

    "device.pair.approve": async (params) => {
      const requestId = params.requestId as string;
      // Try OpenClaw device-auth first
      const { approveDevicePairing } = await import("../infra/device-pairing.js");
      const approved = await approveDevicePairing(requestId);
      if (approved) {
        return { ok: true, requestId, device: approved.device };
      }
      // Fallback: try all enabled channels' pairing codes
      const { approveChannelPairingCode } = await import("../pairing/pairing-store.js");
      const config = loadConfig();
      const channels: string[] = [];
      if (config.channels.kapso.enabled) {
        channels.push("kapso");
      }
      if (config.channels.telegram.enabled) {
        channels.push("telegram");
      }
      for (const channel of channels) {
        const result = await approveChannelPairingCode({ channel, code: requestId });
        if (result) {
          return { ok: true, requestId, id: result.id };
        }
      }
      return { ok: false, error: "Unknown request ID" };
    },

    "device.pair.reject": async (params) => {
      const requestId = params.requestId as string;
      const { rejectDevicePairing } = await import("../infra/device-pairing.js");
      const rejected = await rejectDevicePairing(requestId);
      return { ok: rejected !== null };
    },

    "device.token.rotate": async (params) => {
      const { rotateDeviceToken } = await import("../infra/device-pairing.js");
      const { deviceId, role, scopes } = params as {
        deviceId: string;
        role: string;
        scopes?: string[];
      };
      const entry = await rotateDeviceToken({ deviceId, role, scopes });
      if (!entry) {
        return { ok: false, error: "Unknown device or role" };
      }
      return {
        token: entry.token,
        role: entry.role,
        deviceId,
        scopes: entry.scopes,
      };
    },

    "device.token.revoke": async (params) => {
      const { revokeDeviceToken } = await import("../infra/device-pairing.js");
      const { deviceId, role } = params as { deviceId: string; role: string };
      const revoked = await revokeDeviceToken({ deviceId, role });
      if (!revoked) {
        return { ok: false, error: "Unknown device or role" };
      }
      return { ok: true };
    },

    // Remove a paired device — works for both device-auth and channel allow-from
    "device.pair.remove": async (params) => {
      const deviceId = (params.deviceId as string).trim();
      if (!deviceId) {
        return { ok: false, error: "deviceId required" };
      }

      // Try OpenClaw device-auth removal first
      const { removePairedDevice } = await import("../infra/device-pairing.js");
      const removed = await removePairedDevice(deviceId);
      if (removed) {
        return { ok: true, deviceId: removed.deviceId };
      }

      // Fallback: remove from all enabled channels' allow-from stores
      const { removeChannelAllowFromStoreEntry } = await import("../pairing/pairing-store.js");
      const config = loadConfig();
      const channels: string[] = [];
      if (config.channels.kapso.enabled) {
        channels.push("kapso");
      }
      if (config.channels.telegram.enabled) {
        channels.push("telegram");
      }
      for (const channel of channels) {
        const result = await removeChannelAllowFromStoreEntry({ channel, entry: deviceId });
        if (result.changed) {
          return { ok: true, deviceId };
        }
      }

      return { ok: false, error: "Device not found" };
    },

    // --- Phase J: Tab Jorchfile Editor ---

    // J.1 — jb.jorchfile.get
    "jb.jorchfile.get": () => {
      const executor = deps.getJorchfileExecutor();
      if (!executor) {
        return { jorchfile: null };
      }
      const jorchfile = executor.getJorchfile();
      return {
        jorchfile: {
          projects: jorchfile.projects.map((p: JorchProject) => ({
            name: p.name,
            path: p.path,
            commands: p.commands,
            instructions: p.instructions,
            approve: p.approve,
            output: p.output,
            port: p.port,
            tunnel: p.tunnels.length > 0 ? serializeTunnelEntries(p) : undefined,
          })),
          settings: jorchfile.settings,
        },
      };
    },

    // J.2 — jb.jorchfile.set
    // Writes to disk AND updates the in-memory executor so `jb.jorchfile.get`
    // immediately reflects the changes (without waiting for the file watcher).
    "jb.jorchfile.set": (params) => {
      const content = params.content as string;
      const jorchfilePath = (params.path as string | undefined) ?? DEFAULT_JORCHFILE_PATH;

      writeFileSync(jorchfilePath, content, { mode: 0o600 });

      // Re-read + parse from disk and update in-memory executor immediately
      const parsed = loadJorchfileFromDisk(jorchfilePath);
      if (parsed) {
        const executor = deps.getJorchfileExecutor();
        if (executor) {
          executor.updateJorchfile(parsed);
        }
      }

      return { ok: true };
    },

    // J.3 — jb.jorchfile.commands
    "jb.jorchfile.commands": (params) => {
      const project = params.project as string;
      const executor = deps.getJorchfileExecutor();
      if (!executor) {
        return { commands: [] };
      }
      const jorchProject = executor.getProject(project);
      if (!jorchProject) {
        return { commands: [] };
      }
      // Return both built-in (reserved field) commands and custom commands
      return {
        commands: Object.entries(jorchProject.commands).map(([name, command]) => ({
          name,
          command,
        })),
      };
    },

    // --- Exec approvals stubs ---
    // The OpenClaw UI loads exec approvals on the Nodes tab. JorchBot doesn't
    // use the OpenClaw exec-approvals file system, so return empty snapshots
    // to prevent "Unknown method" errors in the UI.
    "exec.approvals.get": () => {
      return { path: "", exists: false, hash: "", file: {} };
    },

    "exec.approvals.set": () => {
      return { path: "", exists: false, hash: "", file: {} };
    },
  };
}

/** Serialize tunnel entries to a human-readable string for display. */
function serializeTunnelEntries(project: JorchProject): string {
  return project.tunnels
    .map((t) => {
      if (t.path) {
        return `${t.mode}:${t.port}:${t.path}`;
      }
      return `${t.mode}:${t.port}`;
    })
    .join(", ");
}

// --- Phase J: Jorchfile types ---

/** J.1 — View of a Jorchfile project as presented to the GUI. */
export interface JorchfileProjectView {
  name: string;
  path: string;
  commands: Record<string, string>;
  instructions?: string;
  approve?: "confirm" | "plan" | "auto";
  output?: "verbose" | "summary" | "silent";
  port?: number;
  tunnel?: string;
}

/** J.1 — Full Jorchfile view for the GUI. */
export interface JorchfileView {
  projects: JorchfileProjectView[];
  settings: JorchSettings;
}

// --- Phase G: Helper functions ---

/** Get commands for a project from the JorchfileExecutor. */
function getProjectCommands(deps: RpcHandlerDeps, project: string): WorkspaceCommand[] {
  const executor = deps.getJorchfileExecutor();
  if (!executor) {
    return [];
  }
  const jorchProject = executor.getProject(project);
  if (!jorchProject) {
    return [];
  }
  return Object.entries(jorchProject.commands).map(([name, command]) => ({
    name,
    command,
  }));
}

// --- Phase H: Tunnel types + helpers ---

/** H — View of a tunnel as presented to the GUI. */
export interface TunnelView {
  id: string;
  project: string;
  localPort: number;
  assignedPort: number;
  url: string;
  provider: string;
  mode: string;
  status: string;
  createdAt: number;
}

/** Map a TunnelInfo to a TunnelView for the GUI. */
function buildTunnelView(tunnel: TunnelInfo): TunnelView {
  return {
    id: tunnel.id,
    project: tunnel.project,
    localPort: tunnel.localPort,
    assignedPort: tunnel.assignedPort,
    url: tunnel.url,
    provider: tunnel.provider,
    mode: tunnel.mode,
    status: tunnel.status,
    createdAt: tunnel.createdAt instanceof Date ? tunnel.createdAt.getTime() : 0,
  };
}

/** Map a SessionRecord to a WorkspaceView for the GUI. */
function buildWorkspaceView(record: SessionRecord, deps: RpcHandlerDeps): WorkspaceView {
  // Map DB status to workspace status
  const statusMap: Record<string, WorkspaceView["status"]> = {
    active: "running",
    stopped: "stopped",
    error: "error",
    paused: "paused",
  };
  return {
    id: record.id,
    name: record.project,
    path: record.path,
    mode: record.mode,
    outputMode: record.outputMode,
    enabled: record.status !== "paused",
    focused: record.focused,
    contextPercent: record.contextPercent,
    status: statusMap[record.status] ?? "stopped",
    commands: getProjectCommands(deps, record.project),
  };
}
