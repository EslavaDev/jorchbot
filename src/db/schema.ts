import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// --- Sessions / Workspaces ---

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  project: text("project").notNull(),
  path: text("path").notNull(),
  ownerPhone: text("owner_phone"),
  claudeSessionId: text("claude_session_id"),
  mode: text("mode", { enum: ["confirm", "plan", "auto"] })
    .notNull()
    .default("confirm"),
  outputMode: text("output_mode", { enum: ["verbose", "summary", "silent"] })
    .notNull()
    .default("verbose"),
  contextPercent: integer("context_percent").notNull().default(0),
  status: text("status", { enum: ["active", "stopped", "error", "paused"] })
    .notNull()
    .default("active"),
  focused: integer("focused", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// --- Messages / Logs ---

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id")
    .references(() => sessions.id, { onDelete: "cascade" })
    .notNull(),
  direction: text("direction", { enum: ["inbound", "outbound", "system"] }).notNull(),
  type: text("type", {
    enum: ["text", "approval", "command", "error", "notification", "shell"],
  }).notNull(),
  content: text("content").notNull(),
  metadata: text("metadata"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// --- Tunnels ---

export const tunnels = sqliteTable("tunnels", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .references(() => sessions.id, { onDelete: "cascade" })
    .notNull(),
  project: text("project").notNull(),
  localPort: integer("local_port").notNull(),
  assignedPort: integer("assigned_port"),
  url: text("url"),
  provider: text("provider", {
    enum: ["tailscale-serve", "tailscale-funnel"],
  }).notNull(),
  mode: text("mode", { enum: ["serve", "funnel"] })
    .notNull()
    .default("serve"),
  status: text("status", { enum: ["active", "stopped", "error"] })
    .notNull()
    .default("active"),
  funnelPath: text("funnel_path"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// --- Approvals ---

export const approvals = sqliteTable("approvals", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .references(() => sessions.id, { onDelete: "cascade" })
    .notNull(),
  action: text("action").notNull(),
  context: text("context"),
  status: text("status", {
    enum: ["pending", "approved", "rejected", "expired"],
  })
    .notNull()
    .default("pending"),
  userFeedback: text("user_feedback"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  resolvedAt: integer("resolved_at", { mode: "timestamp" }),
});

// --- Settings (key-value store) ---

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// --- Device Blacklist (Phase 6I) ---

export const deviceBlacklist = sqliteTable("device_blacklist", {
  deviceId: text("device_id").primaryKey(),
  reason: text("reason"),
  blockedAt: integer("blocked_at", { mode: "timestamp" }).notNull(),
});
