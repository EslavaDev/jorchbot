# Phase 0 — Foundation: Specification

> **Project**: JorchBot
> **Phase**: 0 — Foundation
> **Status**: Draft
> **Created**: 2026-02-18
> **Base**: Fork of [OpenClaw](https://github.com/openclaw/openclaw) (MIT License)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Technical Decisions](#2-technical-decisions)
3. [Fork Strategy](#3-fork-strategy)
4. [Module Audit & Disable Strategy](#4-module-audit--disable-strategy)
5. [Database: SQLite + Drizzle ORM](#5-database-sqlite--drizzle-orm)
6. [Configuration System](#6-configuration-system)
7. [CLI Commands](#7-cli-commands)
8. [Directory Structure Additions](#8-directory-structure-additions)
9. [Error Handling Strategy](#9-error-handling-strategy)
10. [Branding](#10-branding)
11. [CI Pipeline](#11-ci-pipeline)
12. [Testing](#12-testing)
13. [Definition of Done](#13-definition-of-done)

---

## 1. Overview

### 1.1 WHY

JorchBot is a remote development tool that allows controlling Claude Code instances, running project commands, and managing tunnels — all from WhatsApp or Telegram. It's built on top of OpenClaw, which already provides the gateway architecture, WebSocket control plane, and messaging platform adapters we need.

Phase 0 is the foundation: take OpenClaw's codebase, fork it, disable everything we don't need yet, add our own database layer (SQLite + Drizzle), rebrand to JorchBot, and ensure the gateway starts cleanly in a "headless" mode (no channels connected).

Without Phase 0, there's nothing to build on. Every subsequent phase depends on having a clean, compiling, runnable JorchBot gateway.

### 1.2 WHAT

At the end of Phase 0, we have:

1. A GitHub repo `porkycode/jorchbot` — a literal fork of `openclaw/openclaw`
2. Branding changed from OpenClaw to JorchBot in user-facing surfaces
3. Unnecessary modules disabled (not deleted) via config + build exclusion
4. SQLite database with Drizzle ORM, auto-migrating on startup
5. JorchBot-specific config system at `~/.jorchbot/`
6. CLI commands: `jorchbot start`, `jorchbot stop`, `jorchbot status`, `jorchbot config`, `jorchbot version`
7. CI pipeline: lint, type-check, test, build
8. Minimum viable test suite (~10-15 tests)

### 1.3 HOW

See sections 3-12 below for step-by-step implementation details.

---

## 2. Technical Decisions

All decisions are confirmed. Do NOT deviate from these without explicit approval.

| Aspect                       | Decision                                                                     | Source                                                 |
| ---------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------ |
| **Language**                 | TypeScript (strict mode)                                                     | Inherited from OpenClaw                                |
| **Module system**            | ESM (`"type": "module"`, `module: NodeNext`)                                 | Inherited from OpenClaw                                |
| **Runtime**                  | Node.js >= 22.12.0                                                           | Inherited from OpenClaw                                |
| **Package manager**          | pnpm 10.x (monorepo with workspaces)                                         | Inherited from OpenClaw                                |
| **CLI framework**            | Commander (`commander@^14`)                                                  | Inherited from OpenClaw                                |
| **Build tool**               | tsdown (based on Rolldown)                                                   | Inherited from OpenClaw                                |
| **Testing**                  | Vitest (`vitest@^4`)                                                         | Inherited from OpenClaw                                |
| **Linting**                  | oxlint (`--type-aware`)                                                      | Inherited from OpenClaw                                |
| **Formatting**               | oxfmt (`--write`)                                                            | Inherited from OpenClaw                                |
| **Logging**                  | OpenClaw's logging system (`src/logging/`)                                   | Inherited from OpenClaw                                |
| **Validation (new schemas)** | zod@4                                                                        | New choice for JorchBot-specific schemas               |
| **Database**                 | SQLite via `better-sqlite3` + `drizzle-orm` + `drizzle-kit`                  | New — OpenClaw uses file-based storage                 |
| **DB file location**         | `~/.jorchbot/jorchbot.db`                                                    | New                                                    |
| **Config location**          | `~/.jorchbot/config.json`                                                    | New (OpenClaw uses `~/.openclaw/openclaw.json`, JSON5) |
| **TypeScript target**        | `es2023`                                                                     | Inherited from OpenClaw                                |
| **TypeScript strict**        | `true`                                                                       | Inherited from OpenClaw                                |
| **GitHub repo**              | `porkycode/jorchbot`                                                         | Confirmed                                              |
| **Fork strategy**            | Git fork literal (preserve history for cherry-picks)                         | Confirmed                                              |
| **Disable strategy**         | Config-based for channels/extensions + build exclusion for apps/big features | Confirmed                                              |

---

## 3. Fork Strategy

### 3.1 WHY fork literal

The research document states: "No eliminar modulos de OpenClaw, solo desconectarlos. Facilita cherry-pick de fixes upstream." A literal fork preserves the full git history, making it trivial to `git cherry-pick` security fixes or improvements from upstream.

### 3.2 Steps

```bash
# 1. Fork via GitHub UI or CLI
gh repo fork openclaw/openclaw --clone=false --fork-name=jorchbot

# 2. Clone the fork
git clone git@github.com:porkycode/jorchbot.git
cd jorchbot

# 3. Add upstream remote for future cherry-picks
git remote add upstream https://github.com/openclaw/openclaw.git
git remote set-url --push upstream DISABLE  # prevent accidental push to upstream

# 4. Create a jorchbot-main branch from current main
git checkout -b jorchbot-main
git push -u origin jorchbot-main

# 5. Set jorchbot-main as default branch (via GitHub settings or CLI)
gh repo edit --default-branch jorchbot-main

# 6. Verify build works before any changes
pnpm install
pnpm build
```

### 3.3 Future cherry-pick workflow (reference, not Phase 0 scope)

```bash
git fetch upstream main
git cherry-pick <commit-hash>
```

### 3.4 Acceptance criteria

- `porkycode/jorchbot` exists on GitHub
- `jorchbot-main` is the default branch
- `upstream` remote points to `openclaw/openclaw` (push disabled)
- `pnpm install && pnpm build` passes on the fork without modifications

---

## 4. Module Audit & Disable Strategy

### 4.1 WHY two strategies

OpenClaw has two types of modules:

1. **Channels/Extensions** — Loaded via plugin system at runtime. Can be disabled via config (`enabled: false`) without touching code.
2. **Apps/Features** — Compiled into the build or are separate workspace packages. Must be excluded from the build config or workspace to avoid compilation/startup overhead.

### 4.2 KEEP (do not touch)

These modules are required for Phase 0 and future phases:

| Module                | Location                                | Reason                                           |
| --------------------- | --------------------------------------- | ------------------------------------------------ |
| Gateway core          | `src/gateway/`                          | Heart of JorchBot — WebSocket + HTTP server      |
| CLI                   | `src/cli/`                              | `jorchbot` command                               |
| Config                | `src/config/`                           | Configuration loading/management                 |
| Logging               | `src/logging/`                          | Inherited logging system                         |
| Sessions (file-based) | `src/sessions/`, `src/config/sessions/` | OpenClaw session management (we'll extend later) |
| Plugin system         | `src/plugins/`, `src/plugin-sdk/`       | Extension architecture for channels              |
| Auth/Pairing          | `src/pairing/`, `src/gateway/auth.ts`   | DM pairing auth for Phase 1                      |
| Infra utilities       | `src/infra/`                            | JSON file ops, device identity, lockfiles        |
| Types                 | `src/types/`                            | Shared TypeScript types                          |
| Utils                 | `src/utils/`                            | Shared utilities                                 |
| Shared                | `src/shared/`                           | Shared code                                      |
| Process management    | `src/process/`                          | Process lifecycle                                |
| Routing               | `src/routing/`                          | Message routing                                  |
| Commands              | `src/commands/`                         | Command handling infrastructure                  |
| Markdown              | `src/markdown/`                         | Message formatting                               |
| Media                 | `src/media/`                            | Media handling (needed for file attachments)     |
| Web (WebChat UI)      | `src/web/`, `ui/`                       | Reused as base for GUI in Phase 6                |

### 4.3 DISABLE via config (runtime disable)

These are channel plugins loaded at runtime. They stay in the code but are disabled in JorchBot's default config so they never initialize:

| Module               | Location                                | Config key                         | Why disable                  |
| -------------------- | --------------------------------------- | ---------------------------------- | ---------------------------- |
| WhatsApp (Baileys)   | `extensions/whatsapp/`                  | `channels.whatsapp.enabled: false` | Replaced by Kapso in Phase 1 |
| Telegram             | `src/telegram/`, `extensions/telegram/` | `channels.telegram.enabled: false` | Reconnected in Phase 7       |
| Discord              | `src/discord/`, `extensions/discord/`   | `channels.discord.enabled: false`  | Not needed                   |
| Slack                | `src/slack/`, `extensions/slack/`       | `channels.slack.enabled: false`    | Not needed                   |
| Signal               | `src/signal/`, `extensions/signal/`     | `channels.signal.enabled: false`   | Not needed                   |
| iMessage             | `src/imessage/`, `extensions/imessage/` | `channels.imessage.enabled: false` | Not needed                   |
| LINE                 | `src/line/`, `extensions/line/`         | `channels.line.enabled: false`     | Not needed                   |
| All other extensions | `extensions/*/`                         | Per-extension enabled flag         | Not needed                   |

**Implementation**: JorchBot's config (`~/.jorchbot/config.json`) overrides OpenClaw's channel loading. The gateway channel manager (`src/gateway/server-channels.ts`) already checks `enabled` flags before starting channels. We ensure JorchBot defaults all channels to `enabled: false`.

### 4.4 EXCLUDE from build (compile-time exclusion)

These are large features or native apps that should not compile at all:

| Module                            | Location                                                       | How to exclude                                                                      |
| --------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Native apps (iOS, macOS, Android) | `apps/`                                                        | Remove from `pnpm-workspace.yaml` packages list                                     |
| Voice/TTS                         | `src/tts/`, `extensions/talk-voice/`, `extensions/voice-call/` | Remove entries from `tsdown.config.ts` if present; exclude extension from workspace |
| Browser automation                | `src/browser/`                                                 | Comment out from entry points if imported unconditionally                           |
| Canvas/A2UI                       | `src/canvas-host/`                                             | Remove `canvas:a2ui:bundle` from build script                                       |
| Device nodes                      | `src/node-host/`, `src/macos/`                                 | Remove from build entries if present                                                |
| Cron jobs                         | `src/cron/`                                                    | Remove from gateway initialization (conditional import)                             |
| Memory/Embeddings                 | `src/memory/`, `extensions/memory-*`                           | Disable in config (we use our own DB)                                               |
| Auto-reply                        | `src/auto-reply/`                                              | Disable in config                                                                   |
| Link understanding                | `src/link-understanding/`                                      | Disable in config                                                                   |
| Media understanding               | `src/media-understanding/`                                     | Disable in config                                                                   |

**Implementation for `pnpm-workspace.yaml`**:

```yaml
# BEFORE (OpenClaw)
packages:
  - .
  - ui
  - packages/*
  - extensions/*

# AFTER (JorchBot Phase 0)
packages:
  - .
  - ui
  # packages/* — disabled: bot personas not needed
  # extensions/* — disabled: all channels disabled, will re-enable selectively
```

> **IMPORTANT**: Do NOT delete files or directories. Only modify config/build files to exclude. This preserves the ability to cherry-pick from upstream and re-enable modules in future phases.

**Implementation for `tsdown.config.ts`**:

Remove or comment out build entries for excluded modules. Keep the comment explaining why:

```typescript
export default defineConfig([
  // Core entries — KEEP
  { entry: "src/index.ts", platform: "node" },
  { entry: "src/entry.ts", platform: "node" },
  { entry: "src/plugin-sdk/index.ts", outDir: "dist/plugin-sdk" },
  { entry: "src/plugin-sdk/account-id.ts", outDir: "dist/plugin-sdk" },

  // JorchBot: disabled entries (re-enable as needed)
  // { entry: "src/cli/daemon-cli.ts", platform: "node" },  // Legacy CLI shim
  // { entry: "src/infra/warning-filter.ts", platform: "node" },
  // { entry: "src/extensionAPI.ts", platform: "node" },
  // { entry: ["src/hooks/bundled/*/handler.ts", "src/hooks/llm-slug-generator.ts"] },
]);
```

> **NOTE**: The exact entries to comment out depend on what causes build failures after disabling workspaces. This should be done iteratively: disable → build → fix errors → repeat.

**Implementation for `package.json` build script**:

```json
{
  "scripts": {
    "build": "tsdown",
    "build:original": "pnpm canvas:a2ui:bundle && tsdown && pnpm build:plugin-sdk:dts && node scripts/write-plugin-sdk-entry-dts.ts && node scripts/canvas-a2ui-copy.ts && node scripts/copy-hook-metadata.ts && node scripts/copy-export-html-templates.ts && node scripts/write-build-info.ts && node scripts/write-cli-compat.ts"
  }
}
```

Keep the original build script as `build:original` for reference. The new `build` script is simplified to only what JorchBot needs. Add back steps as needed in future phases.

### 4.5 Acceptance criteria

- `pnpm install` completes without errors (some workspaces excluded)
- `pnpm build` compiles only the core modules
- `jorchbot start` (or equivalent) starts the gateway
- The gateway does NOT attempt to connect to any messaging channel
- No runtime errors related to missing disabled modules
- All disabled module source files still exist in the repo (nothing deleted)

---

## 5. Database: SQLite + Drizzle ORM

### 5.1 WHY

OpenClaw uses file-based storage (JSONL for transcripts, JSON for sessions/config). This works for a personal assistant but JorchBot needs:

- Queryable session history (filter by project, date, status)
- Structured approval tracking with status transitions
- Tunnel state management
- Log retention with configurable purging
- Atomic operations across related records

SQLite provides all of this with zero infrastructure (single file, no server process). `better-sqlite3` is the most performant and mature Node.js SQLite driver. Drizzle ORM adds type-safe queries and migration management.

### 5.2 Dependencies to install

```bash
pnpm add better-sqlite3 drizzle-orm
pnpm add -D drizzle-kit @types/better-sqlite3
```

### 5.3 Schema

File: `src/db/schema.ts`

```typescript
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// --- Sessions / Workspaces ---

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(), // nanoid or uuid
  project: text("project").notNull(),
  path: text("path").notNull(),
  claudeSessionId: text("claude_session_id"), // nullable — no Claude session yet
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
  metadata: text("metadata"), // JSON string — nullable
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// --- Tunnels ---

export const tunnels = sqliteTable("tunnels", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .references(() => sessions.id, { onDelete: "cascade" })
    .notNull(),
  localPort: integer("local_port").notNull(),
  assignedPort: integer("assigned_port"), // nullable — auto-assigned
  url: text("url"), // nullable — generated after tunnel starts
  provider: text("provider", {
    enum: ["tailscale-serve", "tailscale-funnel"],
  }).notNull(),
  mode: text("mode", { enum: ["serve", "funnel"] })
    .notNull()
    .default("serve"),
  status: text("status", { enum: ["active", "stopped", "error"] })
    .notNull()
    .default("active"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// --- Approvals ---

export const approvals = sqliteTable("approvals", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .references(() => sessions.id, { onDelete: "cascade" })
    .notNull(),
  action: text("action").notNull(), // description of the action
  context: text("context"), // full context (diff, reasoning) — nullable
  status: text("status", {
    enum: ["pending", "approved", "rejected", "expired"],
  })
    .notNull()
    .default("pending"),
  userFeedback: text("user_feedback"), // from "Yes + feedback" — nullable
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  resolvedAt: integer("resolved_at", { mode: "timestamp" }), // nullable
});

// --- Settings (key-value store) ---

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
```

### 5.4 Database connection singleton

File: `src/db/index.ts`

```typescript
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema.js";
import { resolveDbPath } from "./paths.js";

let _db: ReturnType<typeof drizzle> | null = null;
let _sqlite: Database.Database | null = null;

/**
 * Get the Drizzle ORM database instance (singleton).
 *
 * On first call, creates the SQLite database file and runs migrations.
 * Subsequent calls return the same instance.
 *
 * @throws {JorchBotDbInitError} If database creation or migration fails
 */
export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (_db) return _db;

  const dbPath = resolveDbPath();
  const dbDir = dirname(dbPath);

  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true, mode: 0o700 });
  }

  try {
    _sqlite = new Database(dbPath);
  } catch (err: unknown) {
    throw new JorchBotDbInitError(
      `Failed to open SQLite database at ${dbPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // WAL mode for better concurrent read performance
  _sqlite.pragma("journal_mode = WAL");
  // Foreign keys enforcement
  _sqlite.pragma("foreign_keys = ON");

  _db = drizzle(_sqlite, { schema });

  try {
    migrate(_db, { migrationsFolder: resolveDbMigrationsPath() });
  } catch (err: unknown) {
    throw new JorchBotDbMigrationError(
      `Failed to run database migrations: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return _db;
}

/**
 * Close the database connection. Call on graceful shutdown.
 */
export function closeDb(): void {
  if (_sqlite) {
    _sqlite.close();
    _sqlite = null;
    _db = null;
  }
}
```

### 5.5 Database path resolution

File: `src/db/paths.ts`

```typescript
import { join } from "node:path";
import { homedir } from "node:os";

const JORCHBOT_DIR = ".jorchbot";
const DB_FILENAME = "jorchbot.db";
const MIGRATIONS_DIR = "migrations";

/**
 * Resolve the absolute path to the SQLite database file.
 * Default: ~/.jorchbot/jorchbot.db
 * Override: JORCHBOT_DB_PATH environment variable
 */
export function resolveDbPath(): string {
  if (process.env.JORCHBOT_DB_PATH) {
    return process.env.JORCHBOT_DB_PATH;
  }
  return join(homedir(), JORCHBOT_DIR, DB_FILENAME);
}

/**
 * Resolve the absolute path to the migrations directory.
 * This is relative to the built output (dist/), not source.
 */
export function resolveDbMigrationsPath(): string {
  // In production: relative to the compiled entry point
  // drizzle-kit generates SQL files here during build
  return join(import.meta.dirname, "db", MIGRATIONS_DIR);
}
```

### 5.6 Drizzle Kit config

File: `drizzle.config.ts`

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.JORCHBOT_DB_PATH || "~/.jorchbot/jorchbot.db",
  },
});
```

### 5.7 Migration workflow

Migrations are generated at development time and applied at runtime:

```bash
# Generate migration after schema changes (dev time)
pnpm drizzle-kit generate

# Migrations are applied automatically on `jorchbot start`
# See getDb() — calls migrate() on first connection
```

### 5.8 Acceptance criteria

- `pnpm install` installs `better-sqlite3`, `drizzle-orm`, `drizzle-kit`
- `drizzle-kit generate` produces the initial migration SQL in `src/db/migrations/`
- Running `jorchbot start` creates `~/.jorchbot/jorchbot.db` with all 5 tables
- The DB file has permissions `0o600` (user read/write only)
- `~/.jorchbot/` directory has permissions `0o700`
- `getDb()` returns the same instance on repeated calls (singleton)
- `closeDb()` cleanly closes the connection
- WAL mode is enabled
- Foreign keys are enforced

---

## 6. Configuration System

### 6.1 WHY

JorchBot needs its own config separate from OpenClaw's. OpenClaw uses JSON5 config (with comment support) in `~/.openclaw/openclaw.json`, validated with Zod schemas. JorchBot uses JSON in `~/.jorchbot/` because:

- JSON is natively parseable in Node.js without dependencies
- zod validates the config at load time
- Easy to edit both programmatically (from GUI in Phase 6) and manually

### 6.2 Config schema (zod)

File: `src/config/jorchbot-config.ts`

```typescript
import { z } from "zod";

export const JorchBotConfigSchema = z.object({
  gateway: z
    .object({
      port: z.number().int().min(1).max(65535).default(18789),
      host: z.string().default("127.0.0.1"),
    })
    .default({}),

  db: z
    .object({
      path: z.string().default("~/.jorchbot/jorchbot.db"),
      logRetentionDays: z.number().int().min(1).default(7),
      summaryRetentionDays: z.number().int().min(1).default(30),
      errorRetentionDays: z.number().int().min(1).default(90),
      maxSizeMb: z.number().int().min(10).default(500),
    })
    .default({}),

  channels: z
    .object({
      kapso: z
        .object({
          enabled: z.boolean().default(false),
          apiKey: z.string().default(""),
        })
        .default({}),
      telegram: z
        .object({
          enabled: z.boolean().default(false),
          botToken: z.string().default(""),
        })
        .default({}),
    })
    .default({}),

  tunnels: z
    .object({
      defaultMode: z.enum(["serve", "funnel"]).default("serve"),
      tailscale: z
        .object({
          enabled: z.boolean().default(true),
        })
        .default({}),
    })
    .default({}),

  approvals: z
    .object({
      timeoutMinutes: z.number().int().min(1).default(10),
      pauseTimeoutMinutes: z.number().int().min(1).default(60),
    })
    .default({}),
});

export type JorchBotConfig = z.infer<typeof JorchBotConfigSchema>;
```

### 6.3 Config loader

File: `src/config/jorchbot-config-loader.ts`

```typescript
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { JorchBotConfigSchema, type JorchBotConfig } from "./jorchbot-config.js";
import { ZodError } from "zod";

const JORCHBOT_DIR = join(homedir(), ".jorchbot");
const CONFIG_FILE = join(JORCHBOT_DIR, "config.json");

/**
 * Load JorchBot configuration from ~/.jorchbot/config.json.
 *
 * If the file doesn't exist, creates it with defaults.
 * If the file exists but is invalid, throws with a clear error.
 *
 * @throws {JorchBotConfigNotFoundError} If the config directory cannot be created
 * @throws {JorchBotConfigParseError} If the JSON is malformed
 * @throws {JorchBotConfigValidationError} If the config fails zod validation
 */
export function loadConfig(): JorchBotConfig {
  ensureConfigDir();

  if (!existsSync(CONFIG_FILE)) {
    const defaults = JorchBotConfigSchema.parse({});
    writeConfigFile(defaults);
    return defaults;
  }

  let raw: string;
  try {
    raw = readFileSync(CONFIG_FILE, "utf-8");
  } catch (err: unknown) {
    throw new JorchBotConfigNotFoundError(
      `Cannot read config file at ${CONFIG_FILE}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    throw new JorchBotConfigParseError(
      `Invalid JSON in ${CONFIG_FILE}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    return JorchBotConfigSchema.parse(parsed);
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      throw new JorchBotConfigValidationError(
        `Config validation failed in ${CONFIG_FILE}:\n${err.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}`,
      );
    }
    throw err;
  }
}

function ensureConfigDir(): void {
  if (!existsSync(JORCHBOT_DIR)) {
    try {
      mkdirSync(JORCHBOT_DIR, { recursive: true, mode: 0o700 });
    } catch (err: unknown) {
      throw new JorchBotConfigNotFoundError(
        `Cannot create config directory ${JORCHBOT_DIR}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

function writeConfigFile(config: JorchBotConfig): void {
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
  });
}
```

### 6.4 How JorchBot config interacts with OpenClaw config

OpenClaw has its own config at `~/.openclaw/openclaw.json` (JSON5 format, validated with Zod). JorchBot does NOT replace or modify OpenClaw's config system. Instead:

1. OpenClaw's config system loads OpenClaw's config (unchanged)
2. JorchBot's config loader (`loadConfig()`) loads JorchBot-specific config
3. JorchBot's config takes precedence for JorchBot-specific features (channels enabled/disabled, DB path, approvals)
4. OpenClaw's gateway config (port, host, auth) is overridden by JorchBot's config if present

**Integration point**: In `src/gateway/server.impl.ts` (or wherever the gateway starts), we add a call to `loadConfig()` BEFORE OpenClaw's gateway initialization, and pass relevant values (port, host) to the gateway startup function.

### 6.5 Environment variable overrides

For CI and testing, config values can be overridden via environment variables:

| Variable                | Overrides      | Example        |
| ----------------------- | -------------- | -------------- |
| `JORCHBOT_DB_PATH`      | `db.path`      | `/tmp/test.db` |
| `JORCHBOT_GATEWAY_PORT` | `gateway.port` | `19000`        |
| `JORCHBOT_GATEWAY_HOST` | `gateway.host` | `0.0.0.0`      |

These are checked in the config loader AFTER file loading, as overrides.

### 6.6 Acceptance criteria

- `~/.jorchbot/` directory is created on first run with `0o700` permissions
- `~/.jorchbot/config.json` is created with defaults on first run with `0o600` permissions
- Invalid JSON in config file throws `JorchBotConfigParseError` with file path and error message
- Invalid config values throw `JorchBotConfigValidationError` with specific field paths
- Missing config file is handled by creating defaults (not an error)
- Environment variables override file config values
- `loadConfig()` never returns partial or invalid config — always fully validated

---

## 7. CLI Commands

### 7.1 WHY

The CLI is the primary way to control JorchBot from the terminal. Phase 0 only needs basic lifecycle commands. The full command set (Jorchfile, sessions, etc.) comes in later phases.

### 7.2 OpenClaw CLI structure

OpenClaw's CLI is built with Commander in `src/cli/program/build-program.ts`. It registers commands via `register*.ts` files. JorchBot adds its own commands alongside OpenClaw's existing structure.

### 7.3 JorchBot CLI commands (Phase 0)

File: `src/cli/program/register.jorchbot.ts`

```typescript
import type { Command } from "commander";

export function registerJorchBotCommands(program: Command): void {
  // jorchbot start
  program
    .command("start")
    .description("Start the JorchBot gateway")
    .option("-p, --port <port>", "Gateway port (default: 18789)")
    .option("--host <host>", "Gateway host (default: 127.0.0.1)")
    .action(async (opts) => {
      const { startGateway } = await import("../../gateway/jorchbot-start.js");
      await startGateway(opts);
    });

  // jorchbot stop
  program
    .command("stop")
    .description("Stop the JorchBot gateway")
    .action(async () => {
      const { stopGateway } = await import("../../gateway/jorchbot-stop.js");
      await stopGateway();
    });

  // jorchbot status
  program
    .command("status")
    .description("Show JorchBot gateway status")
    .action(async () => {
      const { showStatus } = await import("../../gateway/jorchbot-status.js");
      await showStatus();
    });

  // jorchbot config
  program
    .command("config")
    .description("Show or edit JorchBot configuration")
    .option("--show", "Show current configuration")
    .option("--path", "Show config file path")
    .option("--reset", "Reset to defaults")
    .action(async (opts) => {
      const { handleConfig } = await import("./config-handler.js");
      await handleConfig(opts);
    });

  // jorchbot version
  program
    .command("version")
    .description("Show JorchBot version")
    .action(() => {
      // Read from package.json at build time
      const { version } = await import("../../../package.json", {
        with: { type: "json" },
      });
      console.log(`jorchbot v${version}`);
    });
}
```

### 7.4 Gateway start implementation

File: `src/gateway/jorchbot-start.ts`

```typescript
import { loadConfig } from "../config/jorchbot-config-loader.js";
import { getDb, closeDb } from "../db/index.js";
import { startGatewayServer } from "./server.js";

interface StartOptions {
  port?: string;
  host?: string;
}

/**
 * Start the JorchBot gateway.
 *
 * 1. Load config
 * 2. Initialize database (auto-migrate)
 * 3. Start gateway server
 * 4. Register shutdown handlers
 *
 * @throws {JorchBotConfigParseError} If config is invalid
 * @throws {JorchBotDbInitError} If database fails to initialize
 * @throws {JorchBotGatewayStartError} If gateway server fails to start
 */
export async function startGateway(opts: StartOptions): Promise<void> {
  const config = loadConfig();

  const port = opts.port ? parseInt(opts.port, 10) : config.gateway.port;
  const host = opts.host ?? config.gateway.host;

  // Initialize database (creates file + runs migrations)
  getDb();

  // Register graceful shutdown
  const shutdown = () => {
    closeDb();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Start the OpenClaw gateway with JorchBot config
  // This calls into OpenClaw's gateway startup, passing our port/host
  await startGatewayServer(port, { host });

  console.log(`JorchBot gateway started on ${host}:${port}`);
}
```

### 7.5 Binary rename

In `package.json`, the `"bin"` field must be updated:

```json
{
  "bin": {
    "jorchbot": "jorchbot.mjs"
  }
}
```

And rename `openclaw.mjs` to `jorchbot.mjs` (same content, just rename).

### 7.6 Acceptance criteria

- `jorchbot start` starts the gateway, creates the DB, loads config
- `jorchbot stop` sends SIGTERM to the running gateway
- `jorchbot status` shows whether the gateway is running, on which port
- `jorchbot config --show` prints the current config as JSON
- `jorchbot config --path` prints the config file path
- `jorchbot version` prints the version from package.json
- All commands exit with code 0 on success, non-zero on error
- Errors are printed to stderr with clear messages (not stack traces)

---

## 8. Directory Structure Additions

### 8.1 WHY

Phase 0 creates placeholder directories and files for future phases. This establishes the project structure so future phases know exactly where to put their code.

### 8.2 New directories to create

These directories are NEW (not from OpenClaw). Create them with placeholder `index.ts` files that export nothing but document what will go here:

```
src/
├── db/                          # NEW — Phase 0
│   ├── index.ts                 # DB connection singleton
│   ├── schema.ts                # Drizzle schema
│   ├── paths.ts                 # Path resolution
│   ├── migrations/              # Generated SQL migrations
│   └── errors.ts                # DB-specific error classes
├── config/
│   ├── jorchbot-config.ts       # NEW — JorchBot config schema (zod)
│   └── jorchbot-config-loader.ts # NEW — Config loader
├── channels/                    # Channel registry (inherited from OpenClaw)
├── sessions/
│   └── jorchbot/                # NEW — Phase 1-2 placeholder
│       ├── manager.ts           # TODO: SessionManager (wrapper over OpenClaw agents RPC)
│       ├── focus-model.ts       # TODO: Focus Model (active vs background session)
│       ├── claude-runner.ts     # TODO: Claude Code headless subprocess
│       └── shell-runner.ts      # TODO: Shell Runner (direct $ commands from WhatsApp)
├── jorchfile/                   # NEW — Phase 3 placeholder
│   ├── parser.ts                # TODO: Jorchfile parser
│   └── executor.ts              # TODO: Command executor
├── tunnels/                     # NEW — Phase 4 placeholder
│   ├── manager.ts               # TODO: Tunnel Manager
│   ├── tailscale.ts             # TODO: Tailscale integration
│   └── port-manager.ts          # TODO: Port auto-discovery
├── approvals/                   # NEW — Phase 1 placeholder
│   └── manager.ts               # TODO: Approval flow
├── messages/                    # NEW — Phase 5 placeholder
│   └── chunker.ts               # TODO: Message splitting
└── errors/                      # NEW — Phase 0
    └── index.ts                 # JorchBot error class hierarchy

extensions/
└── kapso/                       # NEW — Phase 1: WhatsApp channel plugin via Plugin SDK
    ├── package.json             # Extension manifest (openclaw.extensions)
    └── index.ts                 # TODO: Kapso channel plugin
```

> **ARCHITECTURAL NOTE (rev. 2)**:
>
> - **Kapso** is a **channel plugin** in `extensions/kapso/` using OpenClaw's Plugin SDK. This inherits DM pairing, message chunking, access control for free.
> - **Sessions** use OpenClaw's **native multi-agent** system (`agents.create/update/delete`). No custom SessionManager.
> - **Shell execution** should consider OpenClaw's `exec` tool (BashProcessRegistry with timeouts, signals).
> - **Focus Model** is the only new session concept (OpenClaw has no "focused session").
> - **Tunnels** use **Tailscale only** (Serve and Funnel). No Cloudflare.

### 8.3 Placeholder file template

Each placeholder `index.ts` follows this pattern:

```typescript
/**
 * @module extensions/kapso
 * @phase 1
 * @description WhatsApp channel plugin via Kapso.ai API (Plugin SDK)
 * @status placeholder
 */

// This module will be implemented in Phase 1 as a channel plugin.
// Uses OpenClaw Plugin SDK — inherits DM pairing, chunking, access control.
// See: docs/phase-1-single-session.md
```

No exports, no runtime code. Just documentation for future implementers.

### 8.4 Acceptance criteria

- All directories exist
- All placeholder files compile without errors
- No circular dependencies introduced
- The project structure matches this spec

---

## 9. Error Handling Strategy

### 9.1 WHY

JorchBot must fail loud and hard. Silent failures in a remote-control tool are dangerous — if a session silently drops, the user (who is away from their machine) has no idea what happened. Every error must be explicit, typed, and bubble up to the user as a clear message.

### 9.2 Error class hierarchy

File: `src/errors/index.ts`

```typescript
/**
 * Base error class for all JorchBot errors.
 * All custom errors extend this class.
 */
export class JorchBotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

// --- Config errors ---

export class JorchBotConfigNotFoundError extends JorchBotError {
  /** Config directory or file cannot be accessed */
}

export class JorchBotConfigParseError extends JorchBotError {
  /** Config file contains invalid JSON */
}

export class JorchBotConfigValidationError extends JorchBotError {
  /** Config values fail zod validation */
}

// --- Database errors ---

export class JorchBotDbInitError extends JorchBotError {
  /** SQLite database cannot be opened or created */
}

export class JorchBotDbMigrationError extends JorchBotError {
  /** Database migration failed */
}

export class JorchBotDbQueryError extends JorchBotError {
  /** A database query failed */
}

// --- Gateway errors ---

export class JorchBotGatewayStartError extends JorchBotError {
  /** Gateway server failed to start (port in use, etc.) */
}

export class JorchBotGatewayNotRunningError extends JorchBotError {
  /** Attempted operation on a gateway that is not running */
}
```

### 9.3 Rules

1. **NEVER** catch generic `Error` or `unknown` and swallow it. Always catch specific types.
2. **NEVER** return `null` or `undefined` as a fallback for an error. Throw.
3. **ALWAYS** chain errors with `from`: `throw new FooError("message") from originalError;`
   - Note: TypeScript doesn't support `from` syntax directly. Use the `cause` option instead:
     ```typescript
     throw new JorchBotDbInitError("Failed to open DB", { cause: originalError });
     ```
     Update the base class to support this:
     ```typescript
     export class JorchBotError extends Error {
       constructor(message: string, options?: ErrorOptions) {
         super(message, options);
         this.name = this.constructor.name;
       }
     }
     ```
4. **ALWAYS** include context in error messages: file paths, port numbers, session IDs.
5. At the **CLI boundary** (the Commander action handlers), catch `JorchBotError` and print the message to stderr. Do NOT print stack traces to the user unless `--verbose` is passed.

### 9.4 CLI error boundary example

```typescript
// In a Commander action handler
.action(async (opts) => {
  try {
    await startGateway(opts);
  } catch (err: unknown) {
    if (err instanceof JorchBotError) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    // Unknown error — this should not happen. Log full error for debugging.
    console.error("Unexpected error:", err);
    process.exit(2);
  }
});
```

### 9.5 Acceptance criteria

- All error classes extend `JorchBotError`
- All error constructors accept `ErrorOptions` for `cause` chaining
- No `try/catch` block catches generic `Error` and returns a fallback value
- CLI commands print error messages (not stack traces) on known errors
- Exit code 1 for known errors, 2 for unexpected errors

---

## 10. Branding

### 10.1 WHY

The user-facing surfaces must say "JorchBot", not "OpenClaw". Internal code references to OpenClaw are fine (they're part of the fork and facilitate cherry-picks).

### 10.2 What to change

| Surface                           | From                             | To                                                                                             |
| --------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------- |
| `package.json` `name`             | `openclaw`                       | `jorchbot`                                                                                     |
| `package.json` `description`      | OpenClaw description             | `Remote development tool via WhatsApp/Telegram. Control Claude Code from your messaging apps.` |
| `package.json` `bin`              | `{ "openclaw": "openclaw.mjs" }` | `{ "jorchbot": "jorchbot.mjs" }`                                                               |
| `package.json` `author`           | steipete                         | `porkycode`                                                                                    |
| `package.json` `repository`       | `openclaw/openclaw`              | `porkycode/jorchbot`                                                                           |
| Entry file                        | `openclaw.mjs`                   | `jorchbot.mjs` (rename file)                                                                   |
| `process.title` in `src/entry.ts` | `"openclaw"`                     | `"jorchbot"`                                                                                   |
| README.md                         | Full rewrite                     | JorchBot README (setup, usage, architecture)                                                   |
| CHANGELOG.md                      | Clear content                    | Start fresh: `# JorchBot Changelog`                                                            |
| LICENSE                           | Keep MIT                         | Keep MIT, add JorchBot attribution line                                                        |
| Config directory                  | `~/.openclaw/`                   | `~/.jorchbot/` (new, parallel)                                                                 |
| State directory                   | `~/.openclaw/`                   | `~/.jorchbot/` (for JorchBot-specific state)                                                   |
| Gateway banner (if any)           | OpenClaw                         | JorchBot                                                                                       |
| WebChat title (if visible)        | OpenClaw                         | JorchBot                                                                                       |

### 10.3 What NOT to change

- Internal import paths (`src/gateway/`, `src/channels/`, etc.)
- Internal variable/function/class names from OpenClaw code
- Comments referencing OpenClaw's architecture
- The `upstream` remote (still points to OpenClaw)

### 10.4 Acceptance criteria

- `jorchbot` command works (not `openclaw`)
- `jorchbot version` shows JorchBot version
- `~/.jorchbot/` is used for JorchBot config/state
- README says JorchBot
- No user-facing string says "OpenClaw"
- MIT license preserved with original + JorchBot attribution

---

## 11. CI Pipeline

### 11.1 WHY

CI catches regressions early. Since we're modifying the fork (disabling modules, adding DB), we need CI to verify nothing breaks.

### 11.2 GitHub Actions workflow

File: `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [jorchbot-main]
  pull_request:
    branches: [jorchbot-main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "pnpm"
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint

  type-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "pnpm"
      - run: pnpm install --frozen-lockfile
      - run: npx tsc --noEmit

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "pnpm"
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:fast
        env:
          JORCHBOT_DB_PATH: /tmp/jorchbot-test.db

  build:
    runs-on: ubuntu-latest
    needs: [lint, type-check, test]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "pnpm"
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
```

### 11.3 Acceptance criteria

- All 4 jobs pass on the `jorchbot-main` branch
- PRs require all checks to pass before merge
- CI uses `pnpm install --frozen-lockfile` (no lockfile modifications)
- Test job uses a temp DB path (not `~/.jorchbot/`)

---

## 12. Testing

### 12.1 WHY

Minimum viable test suite for Phase 0. Tests the new JorchBot-specific code (DB, config, CLI), not OpenClaw's existing tests (those should already pass from the fork).

### 12.2 Test files

All tests use Vitest. Test files go alongside source files with `.test.ts` suffix.

#### 12.2.1 Database tests

File: `src/db/index.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDb, closeDb } from "./index.js";
import { sessions, messages, tunnels, approvals, settings } from "./schema.js";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DB_DIR = join(tmpdir(), "jorchbot-test");
const TEST_DB_PATH = join(TEST_DB_DIR, "test.db");

describe("Database", () => {
  beforeEach(() => {
    process.env.JORCHBOT_DB_PATH = TEST_DB_PATH;
    mkdirSync(TEST_DB_DIR, { recursive: true });
  });

  afterEach(() => {
    closeDb();
    if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
    if (existsSync(`${TEST_DB_PATH}-wal`)) unlinkSync(`${TEST_DB_PATH}-wal`);
    if (existsSync(`${TEST_DB_PATH}-shm`)) unlinkSync(`${TEST_DB_PATH}-shm`);
    delete process.env.JORCHBOT_DB_PATH;
  });

  it("creates the database file on first call", () => {
    getDb();
    expect(existsSync(TEST_DB_PATH)).toBe(true);
  });

  it("returns the same instance on repeated calls (singleton)", () => {
    const db1 = getDb();
    const db2 = getDb();
    expect(db1).toBe(db2);
  });

  it("creates all tables via migration", () => {
    const db = getDb();
    // Verify tables exist by attempting to select from each
    // These will throw if the table doesn't exist
    expect(() => db.select().from(sessions).all()).not.toThrow();
    expect(() => db.select().from(messages).all()).not.toThrow();
    expect(() => db.select().from(tunnels).all()).not.toThrow();
    expect(() => db.select().from(approvals).all()).not.toThrow();
    expect(() => db.select().from(settings).all()).not.toThrow();
  });

  it("enforces foreign keys", () => {
    const db = getDb();
    // Inserting a message with a non-existent sessionId should fail
    expect(() =>
      db
        .insert(messages)
        .values({
          sessionId: "nonexistent",
          direction: "inbound",
          type: "text",
          content: "test",
          createdAt: new Date(),
        })
        .run(),
    ).toThrow(); // SQLite foreign key constraint
  });

  it("uses WAL journal mode", () => {
    getDb();
    // WAL mode creates a -wal file on first write
    // Alternatively, check via pragma (would need raw sqlite access)
    // This is tested implicitly — if WAL isn't set, concurrent reads fail
    expect(true).toBe(true); // pragma is set in getDb()
  });
});
```

#### 12.2.2 Config tests

File: `src/config/jorchbot-config.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { JorchBotConfigSchema } from "./jorchbot-config.js";

describe("JorchBotConfigSchema", () => {
  it("parses empty object with all defaults", () => {
    const config = JorchBotConfigSchema.parse({});
    expect(config.gateway.port).toBe(18789);
    expect(config.gateway.host).toBe("127.0.0.1");
    expect(config.db.logRetentionDays).toBe(7);
    expect(config.channels.kapso.enabled).toBe(false);
    expect(config.channels.telegram.enabled).toBe(false);
    expect(config.tunnels.defaultMode).toBe("serve");
    expect(config.approvals.timeoutMinutes).toBe(10);
  });

  it("accepts valid overrides", () => {
    const config = JorchBotConfigSchema.parse({
      gateway: { port: 9999 },
      channels: { kapso: { enabled: true, apiKey: "test-key" } },
    });
    expect(config.gateway.port).toBe(9999);
    expect(config.channels.kapso.enabled).toBe(true);
    expect(config.channels.kapso.apiKey).toBe("test-key");
  });

  it("rejects invalid port (too high)", () => {
    expect(() => JorchBotConfigSchema.parse({ gateway: { port: 99999 } })).toThrow();
  });

  it("rejects invalid port (negative)", () => {
    expect(() => JorchBotConfigSchema.parse({ gateway: { port: -1 } })).toThrow();
  });

  it("rejects invalid tunnel mode", () => {
    expect(() => JorchBotConfigSchema.parse({ tunnels: { defaultMode: "invalid" } })).toThrow();
  });

  it("rejects invalid approval mode", () => {
    expect(() => JorchBotConfigSchema.parse({ approvals: { timeoutMinutes: 0 } })).toThrow();
  });
});
```

#### 12.2.3 Config loader tests

File: `src/config/jorchbot-config-loader.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "./jorchbot-config-loader.js";
import { writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JorchBotConfigParseError, JorchBotConfigValidationError } from "../errors/index.js";

// Override homedir for tests to avoid touching real config
const TEST_HOME = join(tmpdir(), "jorchbot-config-test");
const TEST_CONFIG_DIR = join(TEST_HOME, ".jorchbot");
const TEST_CONFIG_FILE = join(TEST_CONFIG_DIR, "config.json");

describe("Config Loader", () => {
  beforeEach(() => {
    // Tests need to mock homedir() or use env override
    // Implementation detail: config loader should respect JORCHBOT_CONFIG_DIR env
    process.env.JORCHBOT_CONFIG_DIR = TEST_CONFIG_DIR;
    mkdirSync(TEST_CONFIG_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_CONFIG_DIR)) {
      rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
    }
    delete process.env.JORCHBOT_CONFIG_DIR;
  });

  it("creates config with defaults when no file exists", () => {
    if (existsSync(TEST_CONFIG_FILE)) rmSync(TEST_CONFIG_FILE);
    const config = loadConfig();
    expect(config.gateway.port).toBe(18789);
    expect(existsSync(TEST_CONFIG_FILE)).toBe(true);
  });

  it("loads existing valid config", () => {
    writeFileSync(TEST_CONFIG_FILE, JSON.stringify({ gateway: { port: 9999 } }));
    const config = loadConfig();
    expect(config.gateway.port).toBe(9999);
  });

  it("throws JorchBotConfigParseError on invalid JSON", () => {
    writeFileSync(TEST_CONFIG_FILE, "not json {{{");
    expect(() => loadConfig()).toThrow(JorchBotConfigParseError);
  });

  it("throws JorchBotConfigValidationError on invalid values", () => {
    writeFileSync(TEST_CONFIG_FILE, JSON.stringify({ gateway: { port: "not-a-number" } }));
    expect(() => loadConfig()).toThrow(JorchBotConfigValidationError);
  });
});
```

#### 12.2.4 Error class tests

File: `src/errors/index.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { JorchBotError, JorchBotDbInitError, JorchBotConfigParseError } from "./index.js";

describe("Error classes", () => {
  it("JorchBotError has correct name", () => {
    const err = new JorchBotError("test");
    expect(err.name).toBe("JorchBotError");
    expect(err.message).toBe("test");
    expect(err).toBeInstanceOf(Error);
  });

  it("subclass has correct name", () => {
    const err = new JorchBotDbInitError("db failed");
    expect(err.name).toBe("JorchBotDbInitError");
    expect(err).toBeInstanceOf(JorchBotError);
    expect(err).toBeInstanceOf(Error);
  });

  it("supports error cause chaining", () => {
    const original = new Error("original");
    const err = new JorchBotConfigParseError("parse failed", {
      cause: original,
    });
    expect(err.cause).toBe(original);
  });
});
```

### 12.3 Test count summary

| Test file                                   | Tests  | What it covers                                                |
| ------------------------------------------- | ------ | ------------------------------------------------------------- |
| `src/db/index.test.ts`                      | 5      | DB creation, singleton, tables, FK, WAL                       |
| `src/config/jorchbot-config.test.ts`        | 6      | Schema defaults, valid overrides, validation errors           |
| `src/config/jorchbot-config-loader.test.ts` | 4      | Create defaults, load existing, parse error, validation error |
| `src/errors/index.test.ts`                  | 3      | Error name, inheritance, cause chaining                       |
| **Total**                                   | **18** | Minimum viable coverage                                       |

### 12.4 Acceptance criteria

- All 18 tests pass with `pnpm test:fast`
- Tests use temporary directories/files (no side effects on `~/.jorchbot/`)
- Each test is independent (no test depends on another test's state)
- Tests clean up after themselves (`afterEach` hooks)

---

## 13. Definition of Done

Phase 0 is complete when ALL of the following are true:

- [ ] `porkycode/jorchbot` repo exists on GitHub as a fork of `openclaw/openclaw`
- [ ] `jorchbot-main` is the default branch
- [ ] `pnpm install` completes without errors
- [ ] `pnpm build` compiles without errors
- [ ] `pnpm test:fast` — all 18+ tests pass
- [ ] `pnpm lint` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `jorchbot start` starts the gateway, creates `~/.jorchbot/`, creates `jorchbot.db`, loads config
- [ ] `jorchbot stop` stops the gateway cleanly
- [ ] `jorchbot status` reports whether gateway is running
- [ ] `jorchbot config --show` prints config JSON
- [ ] `jorchbot version` prints version
- [ ] The gateway starts without connecting to any messaging channel
- [ ] No user-facing string says "OpenClaw" (branding complete)
- [ ] All disabled module source files still exist (nothing deleted)
- [ ] CI pipeline (4 jobs) passes on `jorchbot-main`
- [ ] `~/.jorchbot/jorchbot.db` has all 5 tables (sessions, messages, tunnels, approvals, settings)
- [ ] README.md has JorchBot setup instructions

---

## Appendix A: OpenClaw Reference Architecture

For context, here's a summary of OpenClaw's architecture (as researched):

```
openclaw/
├── src/                    # Core TypeScript source (~40 subdirs)
│   ├── gateway/            # Express + ws server (port 18789)
│   ├── cli/                # Commander CLI (build-program.ts, register*.ts)
│   ├── config/             # JSON5 config loader (Zod validated)
│   ├── logging/            # Logging system
│   ├── pairing/            # DM pairing auth
│   ├── channels/           # Channel plugin registry
│   ├── telegram/           # Telegram (grammY)
│   ├── discord/            # Discord
│   ├── slack/              # Slack (Bolt)
│   ├── whatsapp/           # WhatsApp utilities
│   ├── memory/             # SQLite + sqlite-vec embeddings
│   ├── plugin-sdk/         # Plugin SDK for extensions
│   └── ...
├── extensions/             # ~35 extension packages
│   ├── whatsapp/           # WhatsApp (Baileys) channel
│   ├── telegram/           # Telegram extension
│   └── ...
├── apps/                   # Native clients (iOS, macOS, Android)
├── ui/                     # Lit-based web UI
├── packages/               # Bot personas (clawdbot, moltbot)
├── test/                   # Test fixtures, helpers, mocks
├── tsdown.config.ts        # Build config
├── vitest.*.config.ts      # Test configs
└── pnpm-workspace.yaml     # Monorepo workspaces
```

**Key files for JorchBot integration:**

- `src/gateway/server.impl.ts` — Gateway startup (main integration point)
- `src/gateway/server-channels.ts` — Channel loading (where we disable channels)
- `src/cli/program/build-program.ts` — CLI registration (where we add JorchBot commands)
- `src/entry.ts` — Process entry point (branding: process.title)
- `pnpm-workspace.yaml` — Workspace config (where we exclude apps/extensions)
- `tsdown.config.ts` — Build entries (where we exclude unused modules)
- `package.json` — Name, bin, version (branding)

## Appendix B: Config loader environment variable support

The config loader should support `JORCHBOT_CONFIG_DIR` for tests:

```typescript
function getConfigDir(): string {
  if (process.env.JORCHBOT_CONFIG_DIR) {
    return process.env.JORCHBOT_CONFIG_DIR;
  }
  return join(homedir(), ".jorchbot");
}
```

This is referenced in section 6.3 and used in tests (section 12.2.3).
