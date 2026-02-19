# Phase 2 — Multi-Session Workspaces: Implementation Tasks

> **Spec**: [SPEC.md](./SPEC.md)
> **Status**: Pending
> **Total tasks**: 48

Tasks are split into sequential sub-phases. Each sub-phase must be completed before the next begins.

---

## Sub-phase 2A: Error Classes (3 tasks)

Add all Phase 2 error classes upfront so other modules can import them immediately.

- [ ] **2A.1** Add session error classes to `src/errors/index.ts`:
  - `SessionCreateError`, `SessionNotFoundError`, `SessionLimitError`, `SessionAlreadyExistsError`, `SessionDestroyError`
  - All extend `JorchBotError`
- [ ] **2A.2** Add shell error classes to `src/errors/index.ts`:
  - `ShellRunnerExecError`, `ShellRunnerTimeoutError`, `ShellRunnerDangerousCommandError`
  - All extend `JorchBotError`
- [ ] **2A.3** Verify: `pnpm build` and `pnpm test:fast` still pass

**Acceptance**: All 8 new error classes are exported from `src/errors/index.ts`. Build + existing tests pass.

---

## Sub-phase 2B: Config Consolidation (7 tasks)

Merge the Layer 2 config (`~/.jorchbot/config.json`) into the Layer 1 file (`~/.jorchbot/jorchbot.json`) under a `jorchbot` namespace key. Add the new `sessions` schema.

- [ ] **2B.1** Add `json5` as a dependency if not already present (`pnpm add json5`)
- [ ] **2B.2** Update `src/config/jorchbot-config.ts`:
  - Remove `GatewaySchema` from `JorchBotConfigSchema` (Layer 1 owns gateway config)
  - Add `SessionsSchema` with `maxConcurrent` (default: 5) and `shellTimeout` (default: 30000)
  - Export `SessionsSchema` for use in SessionManager
- [ ] **2B.3** Update `src/config/jorchbot-config-loader.ts`:
  - Change `loadConfig()` to read from `resolveConfigPath()` (the `jorchbot.json` path)
  - Parse as JSON5 instead of JSON
  - Extract the `jorchbot` key from the parsed object
  - Validate only the `jorchbot` section with Zod
  - Add fallback: if `jorchbot` key is missing but old `config.json` exists, read from `config.json` (migration)
- [ ] **2B.4** Update `saveConfig()` in the loader:
  - Read existing `jorchbot.json`, update only the `jorchbot` key
  - Write back as JSON (not JSON5 — JSON is valid JSON5, keeps it machine-writable)
  - Preserve all other keys (Layer 1 sections) untouched
- [ ] **2B.5** Update `src/config/jorchbot-config.test.ts`:
  - Test loading from `jorchbot` key in JSON5 file
  - Test defaults when `jorchbot` key is missing
  - Test migration from old `config.json`
  - Test new `sessions` schema defaults and validation
  - Test that `saveConfig` preserves Layer 1 keys
- [ ] **2B.6** Update `src/gateway/jorchbot-start.ts` to use the updated `loadConfig()`
- [ ] **2B.7** Verify: `pnpm build` + `pnpm test:fast` pass, `pnpm check` clean

**Acceptance**: Config loads from `jorchbot.json` under `jorchbot` key. Old `config.json` is auto-migrated. `sessions.maxConcurrent` and `sessions.shellTimeout` have correct defaults. No `config.json` is created for new installations.

---

## Sub-phase 2C: FocusModel (4 tasks)

Implement the FocusModel — the simplest module, foundational for routing.

- [ ] **2C.1** Replace placeholder in `src/sessions/jorchbot/focus-model.ts` with full implementation:
  - `getFocused(): string | null`
  - `setFocused(project: string): void`
  - `clearFocus(): void`
  - `isFocused(project: string): boolean`
  - In-memory only (DB mirroring is SessionManager's job)
- [ ] **2C.2** Write `src/sessions/jorchbot/focus-model.test.ts`:
  - starts with no focus
  - sets and gets focus
  - clears focus
  - `isFocused` returns correct value
  - switching focus replaces the previous
  - 5 tests total
- [ ] **2C.3** Run: `pnpm test:fast -- src/sessions/jorchbot/focus-model.test.ts` — all 5 pass
- [ ] **2C.4** Verify: `pnpm check` clean

**Acceptance**: FocusModel is fully implemented and tested. 5/5 tests pass.

---

## Sub-phase 2D: ShellRunner (6 tasks)

Implement direct shell execution, independent of SessionManager.

- [ ] **2D.1** Replace placeholder in `src/sessions/jorchbot/shell-runner.ts` with full implementation:
  - `checkDangerous(command: string): DangerousCommandCheck`
  - `execute(command: string, cwd: string, timeoutMs?: number): Promise<ShellResult>`
  - Private `truncate(text: string): string` for WhatsApp 4096 char limit
  - All dangerous patterns from SPEC section 2.3
- [ ] **2D.2** Export `ShellResult` and `DangerousCommandCheck` interfaces from `shell-runner.ts`
- [ ] **2D.3** Write `src/sessions/jorchbot/shell-runner.test.ts`:
  - `checkDangerous()`: detect `rm -rf`, `sudo`, `git push --force`, `DROP TABLE`, etc.
  - `checkDangerous()`: allow safe commands (`ls -la`, `git status`, `npm test`, `cat`)
  - `execute()`: executes command and returns output
  - `execute()`: captures stderr
  - `execute()`: returns non-zero exit code without throwing
  - `execute()`: truncates output exceeding 4096 chars
  - `execute()`: throws `ShellRunnerTimeoutError` on timeout
  - `execute()`: uses provided cwd
  - 10 tests total
- [ ] **2D.4** Run: `pnpm test:fast -- src/sessions/jorchbot/shell-runner.test.ts` — all 10 pass
- [ ] **2D.5** Verify: `pnpm check` clean
- [ ] **2D.6** Verify: no `any` in shell-runner.ts

**Acceptance**: ShellRunner is fully implemented and tested. 10/10 tests pass. Dangerous commands detected. Timeout works.

---

## Sub-phase 2E: SessionManager (10 tasks)

The core orchestrator — manages sessions, ClaudeRunner lifecycle, focus, approvals.

- [ ] **2E.1** Replace placeholder in `src/sessions/jorchbot/manager.ts` with the constructor:
  - Accept dependencies: `maxSessions`, `sendReply`, `sendButtons`
  - Initialize `FocusModel` instance
  - Initialize `Map<string, ActiveSession>` for in-memory state
- [ ] **2E.2** Implement `create(input: CreateSessionInput)`:
  - Validate input with `CreateSessionInputSchema`
  - Check session limit and duplicate names
  - Insert DB record with `focused: true` if first session
  - Create `ClaudeRunner` + `ApprovalManager` instances
  - Wire runner events via `wireRunnerEvents()`
  - Set focus if first session
  - Rollback DB on failure
- [ ] **2E.3** Implement `destroy(project: string)`:
  - Stop ClaudeRunner
  - Update DB status to "stopped"
  - Unregister agent from config
  - Remove from active map
  - Auto-focus next session if focused was destroyed
  - Clear focus if last session destroyed
- [ ] **2E.4** Implement `switchFocus(project: string)`:
  - Validate session exists
  - Update focus in FocusModel
  - Update focus flags in DB (unfocus all, focus target)
- [ ] **2E.5** Implement `list()`, `listActive()`, `getFocused()`, `getByProject()`:
  - DB queries for list operations
  - In-memory lookup for getFocused/getByProject
- [ ] **2E.6** Implement `resolveApproval(approvalId, approved)`:
  - Iterate active sessions, delegate to correct ApprovalManager
  - Return false if approval ID not found
- [ ] **2E.7** Implement `restore()`:
  - Query active sessions from DB
  - Recreate ClaudeRunner + ApprovalManager for each
  - Restore focus from DB `focused` flag
  - Return count of restored sessions
- [ ] **2E.8** Implement private helpers:
  - `registerAgent(project, path)` — write to `jorchbot.json` agents section
  - `unregisterAgent(project)` — remove from `jorchbot.json`
  - `wireRunnerEvents(runner, sessionId, project)` — text, toolUse, result, error events
  - `logMessage(sessionId, direction, type, content)` — insert into messages table
  - `getSessionRecord(id)` — DB lookup by ID
  - `updateFocusInDb(project, focused)` — update focused flags
- [ ] **2E.9** Write `src/sessions/jorchbot/manager.test.ts`:
  - `create()`: creates session with DB record and runner (3 tests)
  - `create()`: auto-focus, limit, duplicate, validation, rollback (4 tests)
  - `destroy()`: stop runner, update DB, auto-focus next, clear focus, not found (4 tests)
  - `switchFocus()`: changes focus, updates DB, not found (3 tests)
  - `restore()`: restores active, skips stopped (2 tests)
  - `resolveApproval()`: routes to correct session, returns false for unknown (2 tests)
  - 15+ tests total
- [ ] **2E.10** Run: `pnpm test:fast -- src/sessions/jorchbot/manager.test.ts` — all pass

**Acceptance**: SessionManager is fully implemented. create/destroy/switch/list/restore/approve all work. 15+ tests pass. ClaudeRunner and ApprovalManager are mocked in tests.

---

## Sub-phase 2F: CommandRouter Extensions (8 tasks)

Extend the Phase 1 CommandRouter with multi-session commands, shell routing, and shell shortcuts.

- [ ] **2F.1** Update command parsing in `src/commands/router.ts`:
  - `$` prefix → shell command
  - `/` prefix → built-in command
  - Free text → prompt to focused session
  - Return structured `RouteResult` type
- [ ] **2F.2** Add session command handlers:
  - `handleNew(args)` — parse project + path, call `sessionManager.create()`
  - `handleSwitch(args)` — call `sessionManager.switchFocus()`
  - `handleList()` — format session list with focus indicator, context %, mode
  - `handleStop(args)` — call `sessionManager.destroy()`
  - `handleLogs(args)` — query messages DB, format for WhatsApp
  - `handleCompact(args)` — stop runner, restart with summary prompt
- [ ] **2F.3** Add shell shortcuts:
  - `/ls [path]` → `ls -la [path]`
  - `/cat <file>` → `cat <file>`
  - `/grep <pattern> [path]` → `grep -rn <pattern> [path]`
  - `/pwd` → `pwd`
  - `/git <args>` → `git <args>`
  - `/tree [depth]` → `tree -L [depth]`
- [ ] **2F.4** Implement `handleShell(command)`:
  - Check dangerous via `ShellRunner.checkDangerous()`
  - Send approval buttons if dangerous
  - Execute via `ShellRunner.execute()` if safe
  - Format output with project prefix, exit code, truncation info
- [ ] **2F.5** Implement `handlePrompt(text)`:
  - Route to focused session's ClaudeRunner
  - Use `runner.resume()` if session has ID, else `runner.start()`
- [ ] **2F.6** Update `handleHelp()` with all Phase 2 commands
- [ ] **2F.7** Write/extend `src/commands/router.test.ts`:
  - Routing tests: `$` prefix, `/` prefix, free text, no session error
  - `/new`: creates session, missing args error
  - `/switch`: switches focus, unknown project error
  - `/list`: shows sessions, empty message
  - Shell shortcuts: `/ls`, `/git`, `/pwd` map correctly
  - Dangerous commands: approval buttons, safe execution
  - 15+ tests total
- [ ] **2F.8** Run: `pnpm test:fast -- src/commands/router.test.ts` — all pass

**Acceptance**: CommandRouter handles all Phase 2 commands. Shell routing works. Dangerous commands show approval buttons. 15+ tests pass.

---

## Sub-phase 2G: Message Logging (4 tasks)

Implement per-session message logging and the `/logs` query.

- [ ] **2G.1** Implement `logMessage()` in SessionManager:
  - Insert into `messages` table with `sessionId`, `direction`, `type`, `content`, `createdAt`
  - Called from `wireRunnerEvents()` for all runner output
  - Called from CommandRouter for inbound commands and shell results
- [ ] **2G.2** Implement `getSessionLogs(project, limit)` helper:
  - Find session by project name
  - Query messages ordered by `createdAt DESC`, limited
  - Reverse for oldest-first display
  - Format: `→ [type] content` (inbound) / `← [type] content` (outbound)
- [ ] **2G.3** Wire `handleLogs()` in CommandRouter to use `getSessionLogs()`
- [ ] **2G.4** Write tests for message logging:
  - Messages are persisted to DB
  - `/logs` returns correct messages in order
  - `/logs` respects count limit
  - `/logs` returns empty for unknown project
  - 5 tests total

**Acceptance**: All messages (text, commands, errors, shell, approvals) are logged per-session. `/logs` returns formatted history.

---

## Sub-phase 2H: Multi-Session Approval Routing (3 tasks)

Extend the approval system for multiple sessions.

- [ ] **2H.1** Update `ApprovalManager` in `src/sessions/jorchbot/approval-manager.ts`:
  - Include `sessionId` in approval button payload
  - Prefix background session buttons with project name: `[Yes backend] [No backend]`
- [ ] **2H.2** Wire approval resolution in CommandRouter/gateway:
  - Parse incoming button responses for `sessionId` + `approvalId`
  - Route to `SessionManager.resolveApproval()`
  - Handle shell approval (`shell_approve`/`shell_reject` types)
  - Do NOT change focused session when resolving background approvals
- [ ] **2H.3** Write tests:
  - Background approval buttons include project name
  - Resolving background approval doesn't change focus
  - Shell approval executes command after approval
  - 3 tests total

**Acceptance**: Background session approvals work without switching focus. Shell dangerous commands can be approved/rejected.

---

## Sub-phase 2I: Gateway Integration (4 tasks)

Wire everything into the gateway startup.

- [ ] **2I.1** Update `src/gateway/jorchbot-start.ts`:
  - Load consolidated config via `loadConfig()`
  - Create `SessionManager` with `maxSessions` from config
  - Create `ShellRunner`
  - Create `CommandRouter` with dependencies
  - Call `sessionManager.restore()` to resume active sessions
- [ ] **2I.2** Wire incoming Kapso messages to `CommandRouter.route()`:
  - Messages from webhook → parse → route
  - Button responses → parse payload → resolve approval
- [ ] **2I.3** Register shutdown handler:
  - On `SIGTERM`/`SIGINT`, call `sessionManager.destroy()` for each active session
  - Graceful ClaudeRunner shutdown (not `kill -9`)
- [ ] **2I.4** Verify: `pnpm build` + `pnpm check` clean

**Acceptance**: Gateway starts with SessionManager, ShellRunner, CommandRouter all wired. Sessions restore on restart. Graceful shutdown stops all runners.

---

## Sub-phase 2J: Agent Config Registration (3 tasks)

Implement the registerAgent/unregisterAgent methods that write to `jorchbot.json`.

- [ ] **2J.1** Implement `registerAgent(project, path)` in SessionManager:
  - Read `jorchbot.json` via OpenClaw config IO utilities
  - Add entry under `agents` section for this project
  - Write back atomically (use temp file + rename)
- [ ] **2J.2** Implement `unregisterAgent(project)` in SessionManager:
  - Read `jorchbot.json`, remove the agent entry
  - Write back atomically
- [ ] **2J.3** Write tests for agent registration:
  - `registerAgent` adds entry to config file
  - `unregisterAgent` removes entry
  - Concurrent writes don't corrupt file
  - 3 tests total

**Acceptance**: Sessions appear in `jorchbot.json` agents section. Stopping a session removes it. File writes are atomic.

---

## Sub-phase 2K: Final Verification (3 tasks)

Full integration verification.

- [ ] **2K.1** Run full test suite: `pnpm test:fast` — all tests pass (existing + ~56 new)
- [ ] **2K.2** Run full checks: `pnpm check` — format, types, lint all clean
- [ ] **2K.3** Manual verification checklist (can be deferred to e2e):
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
              ├──→ 2B (Config) ──→ 2C (FocusModel) ──→ 2E (SessionManager) ──→ 2F (CommandRouter) ──→ 2G (Logging) ──→ 2H (Approvals) ──→ 2I (Gateway) ──→ 2J (Agent Config) ──→ 2K (Final)
              │                                                                          ↑
              └──→ 2D (ShellRunner) ─────────────────────────────────────────────────────┘
```

- **2A** is a prerequisite for everything
- **2B** (config) must be done before any module reads config
- **2C** (FocusModel) and **2D** (ShellRunner) are independent of each other
- **2E** (SessionManager) depends on 2C (uses FocusModel)
- **2F** (CommandRouter) depends on 2D + 2E (uses both ShellRunner and SessionManager)
- **2G–2J** are sequential refinements
- **2K** is always last
