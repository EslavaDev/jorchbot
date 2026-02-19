import type { ChannelPlugin } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID, formatPairingApproveHint, normalizeE164 } from "openclaw/plugin-sdk";
import { KapsoClient } from "./client.js";
import { getKapsoRuntime } from "./runtime.js";
import type { ResolvedKapsoAccount } from "./types.js";

const clients = new Map<string, KapsoClient>();

function getClient(account: ResolvedKapsoAccount): KapsoClient {
  const key = account.accountId;
  let client = clients.get(key);
  if (!client) {
    client = new KapsoClient({
      apiKey: account.apiKey,
      phoneNumberId: account.phoneNumberId,
    });
    clients.set(key, client);
  }
  return client;
}

export const kapsoPlugin: ChannelPlugin<ResolvedKapsoAccount> = {
  id: "kapso",
  meta: {
    id: "kapso",
    label: "Kapso (WhatsApp)",
    selectionLabel: "Kapso WhatsApp",
    docsPath: "channels/kapso",
    blurb: "WhatsApp via Kapso.ai official Meta API",
    order: 1,
    quickstartAllowFrom: true,
    forceAccountBinding: true,
  },

  capabilities: {
    chatTypes: ["direct"],
    polls: false,
    reactions: false,
    media: false,
  },

  pairing: {
    idLabel: "whatsappSenderId",
    normalizeAllowEntry: (raw) => normalizeE164(String(raw)),
  },

  config: {
    listAccountIds: (cfg) => {
      const accounts = (cfg as Record<string, unknown>).channels as
        | Record<string, unknown>
        | undefined;
      const kapso = accounts?.kapso as Record<string, unknown> | undefined;
      const accts = kapso?.accounts as Record<string, unknown> | undefined;
      if (!accts) {
        return [DEFAULT_ACCOUNT_ID];
      }
      return Object.keys(accts);
    },

    resolveAccount: (cfg, accountId) => {
      const id = accountId || DEFAULT_ACCOUNT_ID;
      const channels = (cfg as Record<string, unknown>).channels as
        | Record<string, unknown>
        | undefined;
      const kapsoConfig = channels?.kapso as Record<string, unknown> | undefined;
      const accounts = kapsoConfig?.accounts as Record<string, unknown> | undefined;
      const accountConfig = (accounts?.[id] ?? kapsoConfig ?? {}) as Record<string, unknown>;

      return {
        accountId: id,
        name: (accountConfig.name as string) ?? id,
        enabled: accountConfig.enabled !== false,
        apiKey: (accountConfig.apiKey as string) ?? "",
        phoneNumberId: (accountConfig.phoneNumberId as string) ?? "",
        webhookVerifyToken: (accountConfig.webhookVerifyToken as string) ?? "",
        webhookSecret: (accountConfig.webhookSecret as string) ?? "",
        dmPolicy: (accountConfig.dmPolicy as ResolvedKapsoAccount["dmPolicy"]) ?? "pairing",
        allowFrom: (accountConfig.allowFrom as string[]) ?? [],
      };
    },

    defaultAccountId: () => DEFAULT_ACCOUNT_ID,

    isEnabled: (account, _cfg) => account.enabled && Boolean(account.apiKey),

    isConfigured: async (account, _cfg) =>
      Boolean(account.apiKey) && Boolean(account.phoneNumberId),

    describeAccount: (account, _cfg) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.apiKey),
      linked: Boolean(account.apiKey),
      dmPolicy: account.dmPolicy,
      allowFrom: account.allowFrom,
    }),
  },

  security: {
    resolveDmPolicy: ({ account }) => ({
      policy: account.dmPolicy ?? "pairing",
      allowFrom: account.allowFrom ?? [],
      policyPath: "channels.kapso.dmPolicy",
      allowFromPath: "channels.kapso.",
      approveHint: formatPairingApproveHint("kapso"),
      normalizeEntry: (raw) => normalizeE164(String(raw)),
    }),
  },

  outbound: {
    deliveryMode: "direct",
    textChunkLimit: 4096,
    chunker: (text, limit) => getKapsoRuntime().channel.text.chunkText(text, limit),
    chunkerMode: "text",

    resolveTarget: ({ to }) => ({
      ok: true,
      to: to ?? "",
    }),

    sendText: async ({ to, text, accountId }) => {
      const cfg = getKapsoRuntime().config.loadConfig();
      const account = kapsoPlugin.config.resolveAccount(cfg, accountId);
      const client = getClient(account);
      const result = await client.sendText({ to, body: text });
      return { channel: "kapso" as const, messageId: result.messageId };
    },

    sendMedia: async ({ to, text, mediaUrl, accountId }) => {
      const cfg = getKapsoRuntime().config.loadConfig();
      const account = kapsoPlugin.config.resolveAccount(cfg, accountId);
      const client = getClient(account);

      if (!mediaUrl) {
        const result = await client.sendText({ to, body: text ?? "" });
        return { channel: "kapso" as const, messageId: result.messageId };
      }

      const result = await client.sendDocument({
        to,
        documentUrl: mediaUrl,
        filename: "output.txt",
        caption: text,
      });
      return { channel: "kapso" as const, messageId: result.messageId };
    },
  },

  gateway: {
    startAccount: async (ctx) => {
      ctx.log?.info(`[kapso/${ctx.accountId}] starting Kapso webhook listener`);
      ctx.setStatus({ accountId: ctx.accountId, running: true, connected: true });
    },

    stopAccount: async (ctx) => {
      ctx.log?.info(`[kapso/${ctx.accountId}] stopping Kapso webhook listener`);
      clients.delete(ctx.accountId);
      ctx.setStatus({ accountId: ctx.accountId, running: false, connected: false });
    },
  },

  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      connected: false,
      reconnectAttempts: 0,
      lastConnectedAt: null,
      lastDisconnect: null,
      lastMessageAt: null,
      lastEventAt: null,
      lastError: null,
    },
    buildAccountSnapshot: async ({ account, runtime }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.apiKey),
      linked: Boolean(account.apiKey),
      running: runtime?.running ?? false,
      connected: runtime?.connected ?? false,
      reconnectAttempts: runtime?.reconnectAttempts ?? 0,
      lastConnectedAt: runtime?.lastConnectedAt ?? null,
      lastDisconnect: runtime?.lastDisconnect ?? null,
      lastMessageAt: runtime?.lastMessageAt ?? null,
      lastEventAt: runtime?.lastEventAt ?? null,
      lastError: runtime?.lastError ?? null,
      dmPolicy: account.dmPolicy,
      allowFrom: account.allowFrom,
    }),
  },
};
