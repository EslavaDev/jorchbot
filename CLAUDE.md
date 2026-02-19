# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

JorchBot is a fork of [OpenClaw](https://github.com/openclaw/openclaw) (MIT). It's a remote development tool that controls Claude Code instances from WhatsApp/Telegram. The fork preserves OpenClaw's full history for upstream cherry-picks.

**Two-layer architecture:**

- **Layer 1 (OpenClaw)**: Gateway, WebSocket control plane, multi-agent system, Plugin SDK, DM pairing, memory system, tool policies, auto-compaction
- **Layer 2 (JorchBot-specific)**: ClaudeRunner (Claude Code as subprocess), Kapso WhatsApp channel plugin, Focus Model, ShellRunner, Jorchfile, context % tracking

## Commands

```bash
pnpm install          # Install dependencies
pnpm build            # Build (tsdown → dist/)
pnpm test:fast        # Run unit tests (vitest, ~740 files)
pnpm test:e2e         # Run e2e tests
pnpm lint             # Lint (oxlint --type-aware)
pnpm format           # Format (oxfmt --write)
pnpm check            # Format check + type check + lint (all at once)
npx tsc --noEmit      # Full type check
pnpm dev              # Start in dev mode

# Run a single test file
pnpm test:fast -- src/config/jorchbot-config.test.ts

# Run tests matching a pattern
pnpm test:fast -- -t "pattern name"

# DB migrations after schema changes
pnpm drizzle-kit generate
```

## Tech Stack

- **Runtime**: Node.js >= 22.12.0
- **Language**: TypeScript (ESM, strict mode, target es2023, module NodeNext)
- **Package manager**: pnpm 10.x (monorepo: root + ui workspace; packages/_ and extensions/_ disabled)
- **Build**: tsdown (Rolldown-based)
- **Test**: Vitest 4.x with V8 coverage. Tests colocated as `*.test.ts` next to source.
- **Lint**: Oxlint (no ESLint). Config: `.oxlintrc.json`
- **Format**: Oxfmt
- **CLI**: Commander 14.x
- **Validation**: Zod 4.x (JorchBot schemas), TypeBox (OpenClaw schemas)
- **Database**: SQLite via better-sqlite3 + Drizzle ORM. Schema: `src/db/schema.ts`, migrations: `src/db/migrations/`
- **Config**: JSON at `~/.jorchbot/config.json` (JorchBot), JSON5 at `~/.openclaw/openclaw.json` (OpenClaw)

## Architecture

### Entry Points

- `jorchbot.mjs` → `src/entry.ts`: CLI bootstrap (sets process.title, imports `src/cli/run-main.js`)
- `src/index.ts`: Public API exports + Commander program

### CLI Registration

Commands are **lazily registered** for performance. Pattern in `src/cli/program/`:

- `command-registry.ts`: Core commands array (`CoreCliEntry[]`). JorchBot commands registered as `jb` subcommand.
- `register.subclis.ts`: Sub-CLI groups (gateway, agents, pairing, plugins, etc.) — async imports, placeholder→real on first use
- `register.jorchbot.ts`: JorchBot-specific commands (start, stop, status, config, version)

### Gateway (`src/gateway/`)

Express + WebSocket server on port 18789. Core files:

- `server.ts` / `server-shared.ts`: Server lifecycle
- `server-channels.ts`: Channel plugin loading (checks `enabled` flags)
- `auth.ts` / `device-auth.ts`: Authentication
- `server-tailscale.ts`: Tailscale integration
- `control-ui.ts`: Web dashboard

### JorchBot-Specific Code

- `src/config/jorchbot-config.ts`: Zod schema for `~/.jorchbot/config.json`
- `src/config/jorchbot-config-loader.ts`: Config loader with env var overrides
- `src/db/`: SQLite + Drizzle ORM (5 tables: sessions, messages, tunnels, approvals, settings)
- `src/errors/index.ts`: Error class hierarchy (`JorchBotError` base)
- `src/gateway/jorchbot-start.ts`: Gateway start (config → DB → shutdown handlers)
- `src/sessions/jorchbot/`: ClaudeRunner, SessionManager, ShellRunner (placeholders, Phase 1-2)
- `src/tunnels/`: Tailscale-only tunnel management (placeholders, Phase 4)
- `src/channels/kapso/`: Placeholder — real implementation goes in `extensions/kapso/` as Plugin SDK channel

### OpenClaw Systems (Layer 1, reuse)

- `src/channels/plugins/`: Channel plugin registry and lifecycle
- `src/plugin-sdk/`: Plugin SDK for extensions
- `src/pairing/`: DM pairing auth (6-digit code)
- `src/sessions/`: Session management (keys, labels, policies)
- `src/memory/`: Per-agent SQLite + sqlite-vec embeddings
- `src/agents/`: Multi-agent system (profiles, tools, auth)

### Test Setup

- `test/setup.ts`: Main setup (stub channel adapters, plugin registry, beforeEach/afterEach)
- `test/test-env.ts`: Environment isolation (temp HOME, env vars)
- Tests use `JORCHBOT_DB_PATH` and `JORCHBOT_CONFIG_DIR` env vars for isolation
- Vitest config: `vitest.config.ts` (excludes `*.live.test.ts`, `*.e2e.test.ts`)

## Conventions

- **Import extensions**: Always use `.js` suffix in imports (ESM requirement)
- **Type imports**: Use `import type { X }` for type-only imports
- **No `any`**: `typescript/no-explicit-any` is an error in oxlint
- **File size**: Keep under ~700 LOC, extract helpers when larger
- **Anti-redundancy**: Search for existing utilities before creating new ones. Key locations:
  - Time formatting: `src/infra/format-time`
  - Terminal output: `src/terminal/table.ts`, `src/terminal/theme.ts`
  - CLI progress: `src/cli/progress.ts`
- **Error handling**: All JorchBot errors extend `JorchBotError`. Chain with `{ cause: err }`. Never swallow errors.
- **Disabled modules**: OpenClaw modules are disabled via config/build exclusion, NOT deleted. Preserves upstream cherry-pick ability.

## Fork Management

```bash
# Sync with upstream
git fetch upstream main
git cherry-pick <commit-hash>
```

The `upstream` remote points to `openclaw/openclaw` with push disabled. Default branch is `jorchbot-main`.

## Project Phases

See `docs/phases-index.md` for the full roadmap. Specifications live in `specifications/<phase-name>/SPEC.md` and `TODO.md`. Current: Phase 0 (Foundation) — nearly complete.
