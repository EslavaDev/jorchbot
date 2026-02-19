# Phase 0 — Foundation: Implementation Tasks

> **Spec**: [SPEC.md](./SPEC.md)
> **Status**: Pending
> **Total tasks**: 69

Tasks are split into sequential sub-phases. Each sub-phase must be completed before the next begins.

---

## Sub-phase 0A: Fork & Verify Build (6 tasks)

The fork must exist and compile before we touch anything.

- [x] **0A.1** Fork `openclaw/openclaw` to `EslavaDev/jorchbot` via `gh repo fork`
- [x] **0A.2** Clone the fork locally, add `upstream` remote with push disabled
  ```bash
  git remote add upstream https://github.com/openclaw/openclaw.git
  git remote set-url --push upstream DISABLE
  ```
- [x] **0A.3** Create `jorchbot-main` branch from `main`, push it, set as default branch
- [x] **0A.4** Run `pnpm install` — verify it completes without errors (997 packages, 35 workspaces)
- [x] **0A.5** Run `pnpm build` — verify it compiles without errors (282 files, 7335 kB)
- [x] **0A.6** Run `pnpm test:fast` — verify existing OpenClaw tests pass (727 files, 6037 tests passed)

**Acceptance**: The fork exists, builds, and tests pass identically to upstream.

---

## Sub-phase 0B: Branding (8 tasks)

Change user-facing surfaces from OpenClaw to JorchBot. No functional changes.

- [x] **0B.1** Update `package.json`: `name` → `jorchbot`, `description`, `author` → `EslavaDev`, `repository` → `EslavaDev/jorchbot`
- [x] **0B.2** Update `package.json` `bin` field: `{ "jorchbot": "jorchbot.mjs" }` + `files` + `cli-entry` export
- [x] **0B.3** Rename `openclaw.mjs` → `jorchbot.mjs` + updated all functional source references (gateway-lock, update-runner, shared, doctor-completion, run-node.mjs, CI)
- [x] **0B.4** Update `process.title` in `src/entry.ts` from `"openclaw"` to `"jorchbot"`
- [x] **0B.5** Update `src/entry.ts` user-facing error messages `[openclaw]` → `[jorchbot]`
- [x] **0B.6** Clear `CHANGELOG.md` — replaced with JorchBot changelog
- [x] **0B.7** Update `LICENSE` — kept MIT, added JorchBot/EslavaDev copyright line
- [x] **0B.8** Rewrite `README.md` with JorchBot branding, description, and basic setup instructions

**Acceptance**: `pnpm build` still passes. Running `./jorchbot.mjs --help` or `pnpm dev` shows JorchBot name. No user-facing string says "OpenClaw".

---

## Sub-phase 0C: Disable Modules (7 tasks)

Disable unnecessary modules via config and build exclusion. Do NOT delete any files.

- [x] **0C.1** Edit `pnpm-workspace.yaml`: comment out `packages/*` and `extensions/*` entries (keep `.` and `ui`)
  - Add comments explaining why each is disabled and which phase re-enables it
- [x] **0C.2** Run `pnpm install` — fix any dependency resolution errors caused by workspace changes
  - May need to add missing deps directly to root `package.json` if core code imported them from workspace packages
- [x] **0C.3** Edit `tsdown.config.ts`: comment out build entries for disabled modules (daemon-cli, warning-filter, extensionAPI, hooks)
  - Keep core entries: `src/index.ts`, `src/entry.ts`, `src/plugin-sdk/index.ts`, `src/plugin-sdk/account-id.ts`
- [x] **0C.4** Simplify `package.json` `build` script: remove steps for canvas-a2ui, hook metadata, export-html-templates, cli-compat
  - Keep original as `build:original` for reference
- [x] **0C.5** Fix compilation errors iteratively: `pnpm build` → read error → fix import/config → repeat
  - Fixed branding in: cli-name.ts, banner.ts, tagline.ts, help.ts, register.subclis.ts, command-registry.ts, register.agent.ts
  - Fixed test expectations in: nodes-camera.test.ts, run-node.test.ts, update-runner.test.ts, register.subclis.e2e.test.ts, run-main.exit.test.ts
- [x] **0C.6** Verify gateway starts without attempting to connect to any messaging channel
  - Gateway starts cleanly, no channel connection attempts
- [x] **0C.7** Run `pnpm build` and `pnpm test:fast` — verify both pass after all disabling
  - Build: 281 files, 7345 kB ✓
  - Tests: 736 files, 6124 tests passed ✓

**Acceptance**: Build passes. Gateway starts cleanly. No channel connection attempts. All disabled source files still exist in the repo.

---

## Sub-phase 0D: Error Handling Foundation (2 tasks)

Create the error class hierarchy before any new modules use it.

- [x] **0D.1** Create `src/errors/index.ts` with the full error class hierarchy as specified in SPEC section 9.2:
  - `JorchBotError` (base)
  - `JorchBotConfigNotFoundError`, `JorchBotConfigParseError`, `JorchBotConfigValidationError`
  - `JorchBotDbInitError`, `JorchBotDbMigrationError`, `JorchBotDbQueryError`
  - `JorchBotGatewayStartError`, `JorchBotGatewayNotRunningError`
  - All support `ErrorOptions` for `cause` chaining
- [x] **0D.2** Create `src/errors/index.test.ts` with 3 tests (name, inheritance, cause chaining)

**Acceptance**: `pnpm test:fast` passes including the 3 new error tests.

---

## Sub-phase 0E: Configuration System (4 tasks)

JorchBot-specific config at `~/.jorchbot/config.json`.

- [x] **0E.1** Install zod: `pnpm add zod` (v4.3.6)
- [x] **0E.2** Create `src/config/jorchbot-config.ts` — zod schema with all defaults (adapted for zod v4 nested default materialization)
- [x] **0E.3** Create `src/config/jorchbot-config-loader.ts` — loader with `JORCHBOT_CONFIG_DIR` env var support, error handling with cause chaining
- [x] **0E.4** Create tests:
  - `src/config/jorchbot-config.test.ts` — 6 tests (defaults, overrides, 4 validation errors) ✓
  - `src/config/jorchbot-config-loader.test.ts` — 4 tests (create defaults, load existing, parse error, validation error) ✓

**Acceptance**: All 10 config tests pass. `loadConfig()` creates `~/.jorchbot/config.json` with correct defaults and permissions.

---

## Sub-phase 0F: Database (4 tasks)

SQLite + Drizzle ORM setup.

- [x] **0F.1** Install dependencies: better-sqlite3@^12.6.2, drizzle-orm@^0.45.1, drizzle-kit, @types/better-sqlite3 + added to onlyBuiltDependencies
- [x] **0F.2** Create database files:
  - `src/db/schema.ts` — 5 tables (sessions, messages, tunnels, approvals, settings)
  - `src/db/paths.ts` — path resolution with `JORCHBOT_DB_PATH` env var support
  - `src/db/index.ts` — connection singleton with WAL, FK enforcement, auto-migrate
  - `drizzle.config.ts` — Drizzle Kit config at project root
- [x] **0F.3** Generate initial migration: `src/db/migrations/0000_little_arclight.sql` — 5 tables with FKs and defaults
- [x] **0F.4** Create `src/db/index.test.ts` — 5 tests all passing ✓

**Acceptance**: All 5 DB tests pass. `getDb()` creates the DB file with all tables. Migration file is committed.

---

## Sub-phase 0G: CLI Commands (5 tasks)

JorchBot CLI commands via Commander.

- [x] **0G.1** Create `src/cli/program/register.jorchbot.ts` — registered as `jb` subcommand with: start, stop, status, config, version
- [x] **0G.2** Integrate into `src/cli/program/command-registry.ts` — added as CoreCliEntry (lazy-loaded)
- [x] **0G.3** Create `src/gateway/jorchbot-start.ts`:
  - Load config → init DB → register shutdown handlers → hold process
  - CLI error boundary: catch `JorchBotError` → print to stderr → exit 1
- [x] **0G.4** Create `src/gateway/jorchbot-stop.ts` and `src/gateway/jorchbot-status.ts`:
  - `stop`: stub — reports no running gateway (full PID detection in later phases)
  - `status`: shows config info (port, host, db path)
- [x] **0G.5** Manual verification:
  - `jorchbot jb start` → gateway ready, DB created (5 tables), config loaded ✓
  - `jorchbot jb status` → shows port/host/db ✓
  - `jorchbot jb stop` → reports no gateway ✓
  - `jorchbot jb config --show` → prints full JSON ✓
  - `jorchbot jb config --path` → prints path ✓
  - `jorchbot jb version` → prints v0.0.1 ✓

**Acceptance**: All 5 CLI commands work from terminal. `jorchbot start` creates `~/.jorchbot/`, `jorchbot.db`, and `config.json`.

---

## Sub-phase 0H: Directory Structure Placeholders (2 tasks)

Create the skeleton for future phases.

- [x] **0H.1** Create 12 placeholder files across 6 directories (channels, sessions, jorchfile, tunnels, approvals, messages)
- [x] **0H.2** Verify `pnpm build` still passes ✓

**Acceptance**: All placeholder files exist. Build passes.

---

## Sub-phase 0I: CI Pipeline (2 tasks)

GitHub Actions for automated checks.

- [x] **0I.1** Updated existing `.github/workflows/ci.yml` to trigger on `jorchbot-main` branch (already has lint, type-check, test, build jobs)
- [ ] **0I.2** Push to `jorchbot-main`, verify CI passes (deferred to 0J)

**Acceptance**: CI badge is green on `jorchbot-main`. PRs require all checks.

---

## Sub-phase 0J: Final Verification (2 tasks)

End-to-end validation of the complete Phase 0.

- [x] **0J.1** Run the full Definition of Done checklist from SPEC section 13:
  - [x] `pnpm install` — no errors ✓
  - [x] `pnpm build` — no errors (285 files, 7360 kB) ✓
  - [x] `pnpm test:fast` — 740 files, 6142 tests passed ✓
  - [x] `pnpm lint` — 0 warnings, 0 errors ✓
  - [x] `npx tsc --noEmit` — passes (2 pre-existing e2e test errors only) ✓
  - [x] `jorchbot start` — gateway starts, DB + config created ✓
  - [x] `jorchbot stop` — reports no running gateway ✓
  - [x] `jorchbot status` — shows port/host/db correctly ✓
  - [x] `jorchbot config --show` — prints valid JSON ✓
  - [x] `jorchbot version` — prints v0.0.1 ✓
  - [x] No channel connections attempted ✓
  - [x] No user-facing "OpenClaw" strings in active code ✓
  - [x] All disabled source files still present (packages/_, extensions/_) ✓
  - [ ] CI green (pending push)
  - [x] 5 tables in DB (sessions, messages, tunnels, approvals, settings) ✓
  - [x] README has JorchBot instructions ✓
- [ ] **0J.2** Create a git tag `v0.0.1-phase0` on the passing commit

**Acceptance**: Every checkbox in 0J.1 is checked. Tag exists.

---

## Sub-phase 0K: DeepWiki Architectural Corrections (8 tasks)

Corrections based on DeepWiki analysis of OpenClaw's real architecture. These ensure Phase 0 artifacts accurately reflect what OpenClaw provides natively vs what JorchBot must build new.

### Code changes (already applied)

- [x] **0K.1** Remove Cloudflare from `src/db/schema.ts` — tunnels provider enum now `["tailscale-serve", "tailscale-funnel"]` only
- [x] **0K.2** Remove Cloudflare from `src/config/jorchbot-config.ts` — removed `CloudflareSchema` and `cloudflare` key from `TunnelsSchema`
- [x] **0K.3** Remove Cloudflare assertion from `src/config/jorchbot-config.test.ts`
- [x] **0K.4** Delete `src/tunnels/cloudflare.ts` placeholder — no longer needed

### SPEC.md corrections (already applied)

- [x] **0K.5** Fix SPEC.md section 6.1 + 6.4: OpenClaw uses JSON5 (`~/.openclaw/openclaw.json`), not YAML
- [x] **0K.6** Fix SPEC.md section 5.3: Remove `"cloudflare"` from tunnels provider enum in schema example
- [x] **0K.7** Fix SPEC.md section 8.2: Remove `cloudflare.ts` from directory structure placeholder listing
- [x] **0K.8** Fix SPEC.md Appendix A + section 2: Config references updated to JSON5

### Phase doc updates (already applied)

- [x] **0K.9** Update `docs/phase-1-single-session.md`: Add nota arquitectural — Kapso debe implementarse como canal plugin (`extensions/kapso/`) usando el Plugin SDK de OpenClaw, no como adapter aislado
- [x] **0K.10** Update `docs/phase-2-multi-session.md`: Add nota arquitectural — OpenClaw ya tiene sistema multi-agente nativo (`agents.list/create/update/delete` RPC). SessionManager debe usar Capa 1 (OpenClaw agents) + Capa 2 (ClaudeRunner como child process). Focus Model es JorchBot-specific.
- [x] **0K.11** Update `docs/phase-4-tunnels.md`: Eliminar seccion 4.5 Cloudflare, eliminar Cloudflare de entregables y definicion de terminado. Solo Tailscale Serve/Funnel.
- [x] **0K.12** Update `docs/phases-index.md`: Add nota de revision arquitectural post-DeepWiki

### Placeholder notes (already applied)

- [x] **0K.13** Update placeholder files with architectural notes from DeepWiki analysis:
  - `src/channels/kapso/index.ts` — plugin pattern note
  - `src/sessions/jorchbot/manager.ts` — use OpenClaw agents RPC note
  - `src/sessions/jorchbot/claude-runner.ts` — ClaudeRunner is JorchBot-specific note
  - `src/sessions/jorchbot/shell-runner.ts` — OpenClaw exec tool context note
  - `src/tunnels/manager.ts` — Tailscale-only note
  - `src/tunnels/tailscale.ts` — Serve/Funnel modes note

**Acceptance**: All corrections applied. SPEC, phase docs, and placeholders reflect DeepWiki findings. Build and tests pass.

---

## Sub-phase 0L: Full Phase Docs Alignment Audit (11 tasks)

Deep audit and rewrite of ALL phase docs (0-6) + SPEC to fully align with DeepWiki analysis (research.md section 17). Goes beyond 0K's initial corrections with complete rewrites of architectural sections, entregables, tasks, and definitions of done.

### Phase 0 doc + SPEC (already applied)

- [x] **0L.1** Fix `docs/phase-0-foundation.md`: Kapso path `src/channels/kapso/` → `extensions/kapso/`, session refs `src/sessions/manager.ts` → `focus-model.ts` + `claude-runner.ts`, remove residual `cloudflare.ts` from structure, add comprehensive architectural note block (rev. 2)
- [x] **0L.2** Fix `docs/phase-0-foundation.md`: Add notes to "Notas Tecnicas" section — two-SQLite coexistence, JSON vs JSON5, extend-not-rebuild strategy
- [x] **0L.3** Fix `specifications/phase-0-foundation/SPEC.md`: Update directory structure — Kapso paths, session placeholders, add `extensions/kapso/` section, add 5-principle architectural note block, update placeholder template to reference Plugin SDK pattern

### Phase 1 deep rewrite (already applied)

- [x] **0L.4** Rewrite `docs/phase-1-single-session.md` Nota Arquitectural: explicit Plugin SDK inheritance list (DM pairing, chunking, access control, message normalization)
- [x] **0L.5** Rewrite `docs/phase-1-single-session.md` task 1.1: `KapsoChannelPlugin` class in `extensions/kapso/`, follows `extensions/whatsapp/` pattern, Plugin SDK hooks. Remove ngrok mention (solo Tailscale Funnel). Add entregable 7 (DM pairing). Update DoD with plugin + DM pairing checks.

### Phase 2 deep rewrite (already applied)

- [x] **0L.6** Rewrite `docs/phase-2-multi-session.md` task 2.1: SessionManager como wrapper sobre `agents.create/delete/list/update` RPC. Add command → RPC mapping table.
- [x] **0L.7** Rewrite `docs/phase-2-multi-session.md` task 2.3: ShellRunner references OpenClaw's `exec` tool (BashProcessRegistry). Rewrite Notas tecnicas (sessions = OpenClaw agents, auto-compaction exists, write locking exists).

### Phase 3, 5, 6 new architectural notes (already applied)

- [x] **0L.8** Add `docs/phase-3-jorchfile.md`: New section "Nota sobre Skills de OpenClaw (rev. 2)" documenting overlap between Jorchfile `instructions` field and OpenClaw Skills system. Decision: `--append-system-prompt` first, evaluate migration later.
- [x] **0L.9** Add `docs/phase-5-advanced-ux.md`: New "Nota Arquitectural (rev. 2)" — existing OpenClaw systems (auto-compaction via `sessions.compact`, tool approval via `exec.ask` modes, message chunking via `textLimit`). Clarifies what's new vs inherited.
- [x] **0L.10** Rewrite `docs/phase-6-gui.md`: Fix port 18789 → 18791 for Control UI (basePort + 2). Add architectural note "Extender Control UI existente". Rewrite task 6.1 stack (Lit web components from `ui/`). Update Tailscale Serve section and DoD.

### Verification (already applied)

- [x] **0L.11** Grep sweep: Confirm zero remaining `src/channels/kapso` or `cloudflare` references in any phase doc or SPEC. All phase docs (0-9) aligned with research.md section 17.

**Acceptance**: All phase docs and SPEC accurately reflect DeepWiki analysis. No stale architectural references remain. Each phase doc has appropriate rev. 2 notes where applicable.

---

## Sub-phase 0M: Missing Placeholders & Structure Alignment (3 tasks)

Final alignment pass: create placeholder files and directories that the SPEC promises but were never created, and fix SPEC/doc directory listings to match all actual files.

- [x] **0M.1** Create `extensions/kapso/` directory with `package.json`, `openclaw.plugin.json`, and `index.ts` placeholder — follows `extensions/whatsapp/` pattern (Plugin SDK)
- [x] **0M.2** Create `src/sessions/jorchbot/focus-model.ts` placeholder — Focus Model concept (Phase 2, JorchBot-specific)
- [x] **0M.3** Update SPEC section 8.2 and Phase 0 doc section 0.4: list ALL 4 session placeholder files (`manager.ts`, `focus-model.ts`, `claude-runner.ts`, `shell-runner.ts`) instead of only 2

**Acceptance**: All placeholder files promised in SPEC exist. Directory structure listings match actual files. Build passes.

---

## Task Dependency Graph

```
0A (Fork & Verify)
 │
 ▼
0B (Branding)
 │
 ▼
0C (Disable Modules)
 │
 ├───────────┐
 ▼           ▼
0D (Errors)  0H (Placeholders)
 │
 ▼
0E (Config)
 │
 ▼
0F (Database)
 │
 ▼
0G (CLI)
 │
 ▼
0I (CI)
 │
 ▼
0J (Final Verification)
 │
 ▼
0K (DeepWiki Corrections)
 │
 ▼
0L (Full Phase Docs Alignment)
 │
 ▼
0M (Missing Placeholders)
```

**0D and 0H can run in parallel** after 0C is complete. Everything else is sequential.

---

## Summary

| Sub-phase | Tasks  | Depends on | Description                                |
| --------- | ------ | ---------- | ------------------------------------------ |
| **0A**    | 6      | —          | Fork, clone, verify baseline build         |
| **0B**    | 8      | 0A         | Rename/rebrand to JorchBot                 |
| **0C**    | 7      | 0B         | Disable unused modules                     |
| **0D**    | 2      | 0C         | Error class hierarchy                      |
| **0E**    | 4      | 0D         | Config system (zod + loader)               |
| **0F**    | 4      | 0E         | SQLite + Drizzle ORM                       |
| **0G**    | 5      | 0F         | CLI commands                               |
| **0H**    | 2      | 0C         | Directory placeholders (parallel with 0D)  |
| **0I**    | 2      | 0G         | CI pipeline                                |
| **0J**    | 2      | 0I + 0H    | Final verification + tag                   |
| **0K**    | 13     | 0J         | DeepWiki architectural corrections         |
| **0L**    | 11     | 0K         | Full phase docs alignment audit            |
| **0M**    | 3      | 0L         | Missing placeholders & structure alignment |
| **Total** | **69** |            |                                            |
