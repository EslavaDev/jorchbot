import { z } from "zod";

const GatewaySchema = z.object({
  port: z.number().int().min(1).max(65535).default(18789),
  host: z.string().default("127.0.0.1"),
});

const DbSchema = z.object({
  path: z.string().default("~/.jorchbot/jorchbot.db"),
  logRetentionDays: z.number().int().min(1).default(7),
  summaryRetentionDays: z.number().int().min(1).default(30),
  errorRetentionDays: z.number().int().min(1).default(90),
  maxSizeMb: z.number().int().min(10).default(500),
});

const KapsoSchema = z.object({
  enabled: z.boolean().default(false),
  apiKey: z.string().default(""),
  phoneNumberId: z.string().default(""),
  webhookVerifyToken: z.string().default(""),
  webhookSecret: z.string().default(""),
  dmPolicy: z.enum(["pairing", "allowlist", "open", "disabled"]).default("pairing"),
  allowFrom: z.array(z.string()).default([]),
});

const TelegramSchema = z.object({
  enabled: z.boolean().default(false),
  botToken: z.string().default(""),
});

const ChannelsSchema = z.object({
  kapso: KapsoSchema.default(KapsoSchema.parse({})),
  telegram: TelegramSchema.default(TelegramSchema.parse({})),
});

const TailscaleSchema = z.object({
  enabled: z.boolean().default(true),
});

const TunnelsSchema = z.object({
  defaultMode: z.enum(["serve", "funnel"]).default("serve"),
  tailscale: TailscaleSchema.default(TailscaleSchema.parse({})),
});

const ApprovalsSchema = z.object({
  timeoutMinutes: z.number().int().min(1).default(10),
  pauseTimeoutMinutes: z.number().int().min(1).default(60),
  // Claude Code in headless mode (piped stdin) hangs without --dangerously-skip-permissions.
  // Tool-level approval via PreToolUse hooks replaces stdin-based flow (Phase 2).
  skipPermissions: z.boolean().default(true),
});

export const SessionsSchema = z.object({
  maxConcurrent: z.number().int().min(1).max(20).default(5),
  shellTimeout: z.number().int().min(1000).default(30_000),
});

/**
 * Full JorchBot config schema.
 *
 * In jorchbot.json, `gateway` lives at the top-level (Layer 1 / OpenClaw),
 * while the rest lives under the `jorchbot` key (Layer 2 / JorchBot-specific).
 * The loader assembles both into this single schema transparently.
 */
export const JorchBotConfigSchema = z.object({
  gateway: GatewaySchema.default(GatewaySchema.parse({})),
  db: DbSchema.default(DbSchema.parse({})),
  channels: ChannelsSchema.default(ChannelsSchema.parse({})),
  tunnels: TunnelsSchema.default(TunnelsSchema.parse({})),
  approvals: ApprovalsSchema.default(ApprovalsSchema.parse({})),
  sessions: SessionsSchema.default(SessionsSchema.parse({})),
});

export type JorchBotConfig = z.infer<typeof JorchBotConfigSchema>;
