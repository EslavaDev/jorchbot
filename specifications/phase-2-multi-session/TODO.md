# Phase 2 — Multi-Session Workspaces: Implementation Tasks

> **Spec**: [SPEC.md](./SPEC.md)
> **Status**: Pending
> **Total tasks**: 57

Tasks are split into sequential sub-phases. Each sub-phase must be completed before the next begins.

---

## Sub-phase 2A: Error Classes (3 tasks)

Add all Phase 2 error classes upfront so other modules can import them immediately.

- [x] **2A.1** Add session error classes to `src/errors/index.ts`:
  - `SessionCreateError`, `SessionNotFoundError`, `SessionLimitError`, `SessionAlreadyExistsError`, `SessionDestroyError`
  - All extend `JorchBotError`
- [x] **2A.2** Add shell error classes to `src/errors/index.ts`:
  - `ShellRunnerExecError`, `ShellRunnerTimeoutError`, `ShellRunnerDangerousCommandError`
  - All extend `JorchBotError`
- [x] **2A.3** Verify: `pnpm build` and `pnpm test:fast` still pass

**Acceptance**: All 8 new error classes are exported from `src/errors/index.ts`. Build + existing tests pass.

---

## Sub-phase 2B: Config Consolidation (7 tasks)

Merge the Layer 2 config (`~/.jorchbot/config.json`) into the Layer 1 file (`~/.jorchbot/jorchbot.json`) under a `jorchbot` namespace key. Add the new `sessions` schema.

- [x] **2B.1** Add `json5` as a dependency if not already present (`pnpm add json5`)
- [x] **2B.2** Update `src/config/jorchbot-config.ts`:
  - Keep `GatewaySchema` in `JorchBotConfigSchema` (loadConfig assembles it from top-level)
  - Add `SessionsSchema` with `maxConcurrent` (default: 5) and `shellTimeout` (default: 30000)
  - Export `SessionsSchema` for use in SessionManager
- [x] **2B.3** Update `src/config/jorchbot-config-loader.ts`:
  - Change `loadConfig()` to read from `jorchbot.json` (JSON5)
  - Assembles config: `gateway` from top-level + rest from `jorchbot` key
  - Add fallback: if `jorchbot` key is missing but old `config.json` exists, read from `config.json` (migration)
- [x] **2B.4** Update `saveConfig()` in the loader:
  - Writes `gateway` to top-level, rest to `jorchbot` key
  - Write back as JSON (not JSON5 — JSON is valid JSON5, keeps it machine-writable)
  - Preserve all other keys (agents, etc.) untouched
- [x] **2B.5** Update `src/config/jorchbot-config.test.ts` and `jorchbot-config-loader.test.ts`:
  - Test loading from `jorchbot` key in JSON5 file
  - Test defaults when `jorchbot` key is missing
  - Test migration from old `config.json`
  - Test new `sessions` schema defaults and validation
  - Test that `saveConfig` preserves Layer 1 keys
- [x] **2B.6** Update `src/gateway/jorchbot-start.ts` to use the updated `loadConfig()`
- [x] **2B.7** Verify: `pnpm build` + `pnpm test:fast` pass, `pnpm check` clean

**Acceptance**: Config loads from `jorchbot.json` under `jorchbot` key. Old `config.json` is auto-migrated. `sessions.maxConcurrent` and `sessions.shellTimeout` have correct defaults. No `config.json` is created for new installations.

---

## Sub-phase 2C: FocusModel (4 tasks)

Implement the FocusModel — the simplest module, foundational for routing.

- [x] **2C.1** Replace placeholder in `src/sessions/jorchbot/focus-model.ts` with full implementation:
  - `getFocused(): string | null`
  - `setFocused(project: string): void`
  - `clearFocus(): void`
  - `isFocused(project: string): boolean`
  - In-memory only (DB mirroring is SessionManager's job)
- [x] **2C.2** Write `src/sessions/jorchbot/focus-model.test.ts`:
  - starts with no focus
  - sets and gets focus
  - clears focus
  - `isFocused` returns correct value
  - switching focus replaces the previous
  - 5 tests total
- [x] **2C.3** Run: `pnpm test:fast -- src/sessions/jorchbot/focus-model.test.ts` — all 5 pass
- [x] **2C.4** Verify: `pnpm check` clean

**Acceptance**: FocusModel is fully implemented and tested. 5/5 tests pass.

---

## Sub-phase 2D: ShellRunner (6 tasks)

Implement direct shell execution, independent of SessionManager.

- [x] **2D.1** Replace placeholder in `src/sessions/jorchbot/shell-runner.ts` with full implementation:
  - `checkDangerous(command: string): DangerousCommandCheck`
  - `execute(command: string, cwd: string, timeoutMs?: number): Promise<ShellResult>`
  - Private `truncate(text: string): string` for WhatsApp 4096 char limit
  - All dangerous patterns from SPEC section 2.3
- [x] **2D.2** Export `ShellResult` and `DangerousCommandCheck` interfaces from `shell-runner.ts`
- [x] **2D.3** Write `src/sessions/jorchbot/shell-runner.test.ts`:
  - `checkDangerous()`: detect `rm -rf`, `sudo`, `git push --force`, `DROP TABLE`, etc.
  - `checkDangerous()`: allow safe commands (`ls -la`, `git status`, `npm test`, `cat`)
  - `execute()`: executes command and returns output
  - `execute()`: captures stderr
  - `execute()`: returns non-zero exit code without throwing
  - `execute()`: truncates output exceeding 4096 chars
  - `execute()`: throws `ShellRunnerTimeoutError` on timeout
  - `execute()`: uses provided cwd
  - 13 tests total
- [x] **2D.4** Run: `pnpm test:fast -- src/sessions/jorchbot/shell-runner.test.ts` — all 13 pass
- [x] **2D.5** Verify: `pnpm check` clean
- [x] **2D.6** Verify: no `any` in shell-runner.ts

**Acceptance**: ShellRunner is fully implemented and tested. 10/10 tests pass. Dangerous commands detected. Timeout works.

---

## Sub-phase 2E: SessionManager (10 tasks)

The core orchestrator — manages sessions, ClaudeRunner lifecycle, focus, approvals.

- [x] **2E.1** Replace placeholder in `src/sessions/jorchbot/manager.ts` with the constructor:
  - Accept dependencies: `maxSessions`, `sendReply`, `sendButtons`
  - Initialize `FocusModel` instance
  - Initialize `Map<string, ActiveSession>` for in-memory state
- [x] **2E.2** Implement `create(input: CreateSessionInput)`:
  - Validate input with `CreateSessionInputSchema`
  - Check session limit and duplicate names
  - Insert DB record with `focused: true` if first session
  - Create `ClaudeRunner` + `ApprovalManager` instances
  - Wire runner events via `wireRunnerEvents()`
  - Set focus if first session
  - Rollback DB on failure
- [x] **2E.3** Implement `destroy(project: string)`:
  - Stop ClaudeRunner
  - Update DB status to "stopped"
  - Remove from active map
  - Auto-focus next session if focused was destroyed
  - Clear focus if last session destroyed
- [x] **2E.4** Implement `switchFocus(project: string)`:
  - Validate session exists
  - Update focus in FocusModel
  - Update focus flags in DB (unfocus all, focus target)
- [x] **2E.5** Implement `list()`, `listActive()`, `getFocused()`, `getByProject()`:
  - DB queries for list operations
  - In-memory lookup for getFocused/getByProject
- [x] **2E.6** Implement `resolveApproval(approvalId, approved)`:
  - Iterate active sessions, delegate to correct ApprovalManager
  - Return false if approval ID not found
- [x] **2E.7** Implement `restore()`:
  - Query active sessions from DB
  - Recreate ClaudeRunner + ApprovalManager for each
  - Restore focus from DB `focused` flag
  - Return count of restored sessions
- [x] **2E.8** Implement private helpers:
  - `wireRunnerEvents(runner, sessionId, project)` — text, toolUse, result, error events
  - `logMessage(sessionId, direction, type, content)` — insert into messages table
  - `getSessionRecord(id)` — DB lookup by ID
  - `updateFocusInDb(project, focused)` — update focused flags
  - Note: `registerAgent`/`unregisterAgent` deferred to Sub-phase 2J
- [x] **2E.9** Write `src/sessions/jorchbot/manager.test.ts`:
  - `create()`: creates session with DB record and runner (3 tests)
  - `create()`: auto-focus, limit, duplicate, validation (4 tests)
  - `destroy()`: stop runner, update DB, auto-focus next, clear focus, not found (4 tests)
  - `switchFocus()`: changes focus, updates DB, not found (3 tests)
  - `restore()`: restores active, skips stopped (2 tests)
  - `resolveApproval()`: returns false for unknown (1 test)
  - `list()` / `getByProject()`: returns all/active/by-name (2 tests)
  - 19 tests total
- [x] **2E.10** Run: `pnpm test:fast -- src/sessions/jorchbot/manager.test.ts` — all 19 pass

**Acceptance**: SessionManager is fully implemented. create/destroy/switch/list/restore/approve all work. 15+ tests pass. ClaudeRunner and ApprovalManager are mocked in tests.

---

## Sub-phase 2F: CommandRouter Extensions (8 tasks)

Extend the Phase 1 CommandRouter with multi-session commands, shell routing, and shell shortcuts.

- [x] **2F.1** Update command parsing in `src/commands/router.ts`:
  - `$` prefix → shell command
  - `/` prefix → built-in command
  - Free text → prompt to focused session
  - Return structured `RouteResult` type
- [x] **2F.2** Add session command handlers:
  - `handleNew(args)` — parse project + path, call `sessionManager.create()`
  - `handleSwitch(args)` — call `sessionManager.switchFocus()`
  - `handleList()` — format session list with focus indicator, context %, mode
  - `handleStop(args)` — call `sessionManager.destroy()`
  - `handleLogs(args)` — query messages DB, format for WhatsApp
  - `handleCompact(args)` — stop runner, restart with summary prompt
- [x] **2F.3** Add shell shortcuts:
  - `/ls [path]` → `ls -la [path]`
  - `/cat <file>` → `cat <file>`
  - `/grep <pattern> [path]` → `grep -rn <pattern> [path]`
  - `/pwd` → `pwd`
  - `/git <args>` → `git <args>`
  - `/tree [depth]` → `tree -L [depth]`
- [x] **2F.4** Implement `handleShell(command)`:
  - Check dangerous via `ShellRunner.checkDangerous()`
  - Send approval buttons if dangerous
  - Execute via `ShellRunner.execute()` if safe
  - Format output with project prefix, exit code, truncation info
- [x] **2F.5** Implement `handlePrompt(text)`:
  - Route to focused session's ClaudeRunner
  - Use `runner.resume()` if session has ID, else `runner.start()`
- [x] **2F.6** Update `handleHelp()` with all Phase 2 commands
- [x] **2F.7** Write/extend `src/commands/router.test.ts`:
  - Routing tests: `$` prefix, `/` prefix, free text, no session error
  - `/new`: creates session, missing args error
  - `/switch`: switches focus, unknown project error
  - `/list`: shows sessions, empty message
  - Shell shortcuts: `/ls`, `/git`, `/pwd` map correctly
  - Dangerous commands: approval buttons, safe execution
  - 20 tests total
- [x] **2F.8** Run: `pnpm test:fast -- src/commands/router.test.ts` — all 20 pass

**Acceptance**: CommandRouter handles all Phase 2 commands. Shell routing works. Dangerous commands show approval buttons. 20 tests pass.

---

## Sub-phase 2G: Message Logging (4 tasks)

Implement per-session message logging and the `/logs` query.

- [x] **2G.1** Implement `logMessage()` in SessionManager:
  - Insert into `messages` table with `sessionId`, `direction`, `type`, `content`, `createdAt`
  - Called from `wireRunnerEvents()` for all runner output
  - Called from CommandRouter for inbound commands and shell results
  - Made public so CommandRouter can call it
- [x] **2G.2** Implement `getSessionLogs(project, limit)` helper:
  - Find session by project name
  - Query messages ordered by `createdAt DESC`, limited
  - Reverse for oldest-first display using `toReversed()`
  - Format: `→ [type] content` (inbound) / `← [type] content` (outbound)
- [x] **2G.3** Wire `handleLogs()` in CommandRouter to use `getSessionLogs()`
  - Also added inbound logging in `route()` and outbound shell logging in `executeShell()`
- [x] **2G.4** Write tests for message logging:
  - Messages are persisted to DB (inbound shell command)
  - Shell output logged to DB (outbound shell)
  - `/logs` returns correct messages in order
  - `/logs` respects count limit
  - `/logs` returns empty for unknown project
  - 5 tests total

**Acceptance**: All messages (text, commands, errors, shell, approvals) are logged per-session. `/logs` returns formatted history.

---

## Sub-phase 2H: Tool Approval via Claude Code Hooks (12 tasks)

> **IMPORTANT (rev. 3 — 2026-02-19)**: The stdin-based approval flow (writing "yes"/"no" to Claude
> Code's stdin) does NOT work. Claude Code hangs in headless mode with piped stdin.
> `--dangerously-skip-permissions` is required for headless operation. Tool-level approval is
> implemented via Claude Code's `PreToolUse` hooks instead. See SPEC section 2.6.

Implement the hook-based tool approval system that replaces the old stdin-based approach.

### Hook scripts

- [x] **2H.1** Create `src/hooks/jorchbot/tool-approval.ts` — PreToolUse hook script:
  - Read tool invocation JSON from stdin (`tool_name`, `tool_input`)
  - POST to `http://localhost:{port}/api/tool-approval` with `{ sessionId, toolName, toolInput }`
  - Poll `GET /api/tool-approval/:id` until status is `"approved"` or `"denied"` (500ms interval)
  - On approval: exit with JSON `{ "hookSpecificOutput": { "permissionDecision": "allow" } }`
  - On denial: exit with JSON `{ "hookSpecificOutput": { "permissionDecision": "deny", "permissionDecisionReason": "..." } }`
  - On timeout (no response from gateway): exit with code 1 (non-blocking error)
  - Read gateway port from `JORCHBOT_GATEWAY_PORT` env var (default: 18789)
- [x] **2H.2** Create `src/hooks/jorchbot/tool-result.ts` — PostToolUse + PostToolUseFailure hook script:
  - Read tool result JSON from stdin (`tool_name`, `tool_input`, `tool_output` or `tool_error`)
  - POST to `http://localhost:{port}/api/tool-result` with `{ sessionId, toolName, summary, success }`
  - Fire-and-forget (async hook, non-blocking)
  - Format a brief result summary (e.g., "Edited src/main.ts" or "Bash: output lines")
  - For `PostToolUseFailure`: include error in summary (e.g., "Bash failed: permission denied")
  - Same script handles both events — detects failure via presence of `tool_error` field

### Gateway approval API

- [x] **2H.3** Create `src/gateway/approval-api.ts` — Express router with 3 endpoints:
  - `POST /api/tool-approval` — Receives approval request from hook script. Routes to session's ApprovalManager. Returns `{ id: "approval_xxx" }`.
  - `GET /api/tool-approval/:id` — Hook polls this. Searches all sessions. Returns `{ status: "pending" | "approved" | "denied" }`.
  - `POST /api/tool-result` — Receives tool result from PostToolUse hook. Sends result summary via sendReply. Logs to messages.
- [x] **2H.4** Rewrite `src/sessions/jorchbot/approval-manager.ts`:
  - Added `resolved` Map for tracking post-resolution status (pending → approved/denied)
  - `requestApproval()` now returns approvalId string
  - Added `getApprovalStatus(approvalId)` — returns "pending" | "approved" | "denied" | null (used by poll endpoint)
  - Added `formatToolMessage()` — per-tool WhatsApp formatting (Edit=diff, Bash=command, Write=preview)
  - Added `truncateForWhatsApp()` — 3800 char limit
  - Exported `ApprovalManagerDeps` and `ApprovalStatus` types

### Hook configuration

- [x] **2H.5** Create `src/hooks/jorchbot/hook-config-generator.ts`:
  - `generateHookConfig(options)` — returns `.claude/settings.local.json` content
  - `writeHookConfig(workspacePath, config)` — writes/merges to `.claude/settings.local.json`
  - Default matcher: `"Bash|Write|Edit|NotebookEdit"` (write/modify tools only)
  - PostToolUseFailure uses same script as PostToolUse
  - Env vars: `JORCHBOT_GATEWAY_PORT`, `JORCHBOT_SESSION_ID`
  - 10-minute timeout for PreToolUse, async PostToolUse hooks
- [x] **2H.6** Wire hook config generation in SessionManager `create()`:
  - Added `gatewayPort` and `hookScriptDir` to SessionManagerDeps
  - After session creation, generates hook config in workspace `.claude/settings.local.json`
  - Best-effort — won't fail session creation on hook config errors

### WhatsApp UX

- [x] **2H.7** Format tool approval messages for WhatsApp:
  - `Edit` → show diff (- old_string / + new_string), file path
  - `Bash` → show command + optional description
  - `Write` → show file path + content preview (first 200 chars)
  - `NotebookEdit` → show notebook path
  - Truncated at 3800 chars (room for button metadata)
  - Buttons: Yes / No (via ApprovalButtonPayload)
- [x] **2H.8** Wire incoming Kapso button responses to `ApprovalManager.resolveApproval()`:
  - Already wired in jorchbot-start.ts via `onButtonReply` → `sessionManager.resolveApproval()`
  - Button payload carries `approvalId` + `sessionId` + `action`

### Shell dangerous command approvals

- [x] **2H.9** Wire shell dangerous command approval (same UX as tool approval):
  - Already implemented in CommandRouter.handleShell() (Sub-phase 2F)
  - `ShellRunner.checkDangerous()` → send approval buttons with shell_approve/shell_reject payloads

### Tests

- [x] **2H.10** Write `src/hooks/jorchbot/hook-config-generator.test.ts`:
  - generateHookConfig: all 3 hook types generated
  - Default matcher for write/modify tools
  - Custom matcher support
  - Env vars include port and session ID
  - 10-minute timeout on PreToolUse
  - PostToolUse hooks are async
  - writeHookConfig: creates .claude directory
  - writeHookConfig: merges with existing settings
  - 8 tests
- [x] **2H.11** Write `src/gateway/approval-api.test.ts`:
  - POST creates pending approval, returns ID
  - POST returns 400 for missing fields
  - POST returns 404 for unknown session
  - GET returns pending status
  - GET returns approved after resolution
  - GET returns denied after rejection
  - GET returns 404 for unknown approval
  - POST tool-result sends notification
  - POST tool-result returns 400 for missing fields
  - 9 tests
- [x] **2H.11b** Updated `src/sessions/jorchbot/approval-manager.test.ts`:
  - Added getApprovalStatus tests (pending, approved, denied, unknown)
  - Added formatToolMessage tests (Edit diff, Bash command, Write preview)
  - requestApproval now returns approval ID
  - 14 tests total (was 7)
- [x] **2H.12** Run: `pnpm test:fast` — all 6582 tests pass, `pnpm check` clean (0 errors, 0 warnings)

**Acceptance**: Tool approval via hook scripts implemented. Gateway API handles create/poll/result. ApprovalManager tracks status for polling. Hook config generator wired into session creation. WhatsApp formatting for Edit/Bash/Write tools. 31 new tests across 3 test files.

---

## Sub-phase 2I: Gateway Integration (4 tasks)

Wire everything into the gateway startup.

- [x] **2I.1** Update `src/gateway/jorchbot-start.ts`:
  - Load consolidated config via `loadConfig()`
  - Create `SessionManager` with `maxSessions`, `gatewayPort`, `hookScriptDir` from config
  - Create `ShellRunner`
  - Create `CommandRouter` with dependencies
  - Call `sessionManager.restore()` to resume active sessions
  - Mount approval API router for hook endpoints
- [x] **2I.2** Wire incoming Kapso messages to `CommandRouter.route()`:
  - Messages from webhook → parse → route
  - Button responses → parse payload → `sessionManager.resolveApproval()`
- [x] **2I.3** Register shutdown handler:
  - On `SIGTERM`/`SIGINT`, stop all active sessions gracefully
  - Close DB connection
- [x] **2I.4** Verify: `pnpm build` clean (287 files), `pnpm check` clean (0 errors, 0 warnings)

**Acceptance**: Gateway starts with SessionManager, ShellRunner, CommandRouter, approval API all wired. Sessions restore on restart. Graceful shutdown stops all runners.

---

## Sub-phase 2J: Agent Registration + OpenClaw Integration (7 tasks)

Register each JorchBot session as an OpenClaw agent. This bridges Layer 2 (SessionManager) with
Layer 1 (OpenClaw agent ecosystem) so sessions appear in Control UI and gain access to transcripts
and identity. See `docs/future_agent_runner.md` for the full abstraction roadmap.

- [x] **2J.1** Implement `registerAgent(project, path)` in `src/sessions/jorchbot/agent-registration.ts`:
  - Read `jorchbot.json` directly (plain JSON, not OpenClaw TypeBox schemas)
  - Add entry under `agents.list` section for this project
  - Write back atomically (temp file + rename)
- [x] **2J.2** Implement `unregisterAgent(project)` in `agent-registration.ts`:
  - Read `jorchbot.json`, remove the agent entry
  - Write back atomically, preserves agent directories
- [x] **2J.3** Create agent directory structure on registration:
  - Create `~/.jorchbot/agents/{project}/agent/` directory
  - Create `~/.jorchbot/agents/{project}/sessions/` for transcripts
  - Write `IDENTITY.md` with project name, path, runner type, created date
- [x] **2J.4** Wire `registerAgent` into SessionManager `create()`:
  - Call `registerAgent` after successful DB insert and runner creation (best-effort)
  - Call `unregisterAgent` in `destroy()` after stopping runner (best-effort)
- [x] **2J.5** Write tests for agent registration:
  - `getAgentDir` resolves correct path
  - `registerAgent` creates directories
  - `registerAgent` writes IDENTITY.md with project info
  - `registerAgent` adds entry to jorchbot.json agents.list
  - `registerAgent` is idempotent (no duplicates)
  - `unregisterAgent` removes entry
  - `unregisterAgent` is safe when config has no agents section
  - `registerAgent` preserves other config keys
  - 8 tests total
- [x] **2J.6** Verify: `pnpm check` clean (0 errors, 0 warnings)
- [x] **2J.7** Document findings in `docs/future_agent_runner.md` — Phase 2J section updated with implementation details

**Acceptance**: Sessions appear in `jorchbot.json` agents section with directory structure. IDENTITY.md is written per project. Stopping a session removes the agent entry. File writes are atomic. Skills integration deferred to Phase 3, runner abstraction deferred to Phase 8. 8 tests pass.

---

## Sub-phase 2K: Final Verification (3 tasks)

Full integration verification.

- [x] **2K.1** Run full test suite: `pnpm test:fast` — 6590 tests pass across 793 files
- [x] **2K.2** Run full checks: `pnpm check` — format, types, lint all clean (0 errors, 0 warnings)
- [ ] **2K.3** Manual verification checklist (deferred to e2e):
  - Create two sessions with `/new`
  - Switch between them with `/switch`
  - Send free text to focused session
  - Run shell command with `$ ls`
  - Run dangerous command and approve
  - Check `/list` output
  - Stop a session with `/stop`
  - Check `/logs` output

**Acceptance**: All acceptance criteria from SPEC section 8 are met. No `any` types. All tests pass. `pnpm check` clean.

---

## Dependency Graph

```
2A (Errors) ──┐
              ├──→ 2B (Config) ──→ 2C (FocusModel) ──→ 2E (SessionManager) ──→ 2F (CommandRouter) ──→ 2G (Logging) ──┐
              │                                                                          ↑                            │
              └──→ 2D (ShellRunner) ─────────────────────────────────────────────────────┘                            │
                                                                                                                      ▼
                                                                                              2H (Hooks/Approvals) ──→ 2I (Gateway) ──→ 2J (Agent Config) ──→ 2K (Final)
```

- **2A** is a prerequisite for everything
- **2B** (config) must be done before any module reads config
- **2C** (FocusModel) and **2D** (ShellRunner) are independent of each other
- **2E** (SessionManager) depends on 2C (uses FocusModel)
- **2F** (CommandRouter) depends on 2D + 2E (uses both ShellRunner and SessionManager)
- **2G** (Logging) follows CommandRouter
- **2H** (Hooks/Approvals) depends on 2G (hook scripts use gateway API which needs logging)
- **2I–2J** are sequential refinements after hooks are ready
- **2K** is always last
