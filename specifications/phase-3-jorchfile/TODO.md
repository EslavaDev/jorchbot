# Phase 3 — Jorchfile Engine: Implementation Tasks

> **Spec**: [SPEC.md](./SPEC.md)
> **Status**: Pending
> **Total tasks**: 68 (~64 tests)

Tasks are split into sequential sub-phases. Each sub-phase must be completed before the next begins (unless noted as parallelizable).

---

## Sub-phase 3A: Error Classes Verification (2 tasks)

Phase 3 error classes already exist in `src/errors/index.ts`. Verify they are correct and exported.

- [x] **3A.1** Verify that all 7 Phase 3 error classes exist in `src/errors/index.ts`:
  - `JorchfileParseError`, `JorchfileValidationError`, `JorchfileProjectNotFoundError`, `JorchfileCommandNotFoundError`, `MakefileReadError`, `BackgroundTaskStartError`, `BackgroundTaskNotFoundError`
  - All extend `JorchBotError`
  - All have correct JSDoc comments
- [x] **3A.2** Verify: `pnpm check` passes clean (0 errors, 0 warnings)

**Acceptance**: All 7 error classes confirmed exported. Build + existing tests pass.

---

## Sub-phase 3B: Jorchfile Parser + Loader (13 tasks)

Implement the core parser and disk loader. These are pure functions with no external dependencies.

- [x] **3B.1** Replace placeholder in `src/jorchfile/parser.ts` with full implementation:
  - Export `JorchProjectSchema`, `JorchSettingsSchema`, `JorchfileSchema` (Zod schemas)
  - Export `JorchProject`, `JorchSettings`, `Jorchfile` types (inferred from Zod)
  - Export `parseJorchfile(content: string): Jorchfile` function
  - Export `RESERVED_FIELDS` set
- [x] **3B.2** Implement `parseJorchfile()`:
  - Parse `PROJECT <name>` blocks
  - Parse `SETTINGS` block
  - Parse `key = value` fields with `  ` or `\t` indentation
  - Skip blank lines and `#` comments
  - Throw `JorchfileParseError` on syntax errors with line number
- [x] **3B.3** Implement multi-line support:
  - Backslash continuation: lines ending with `\` continue on next line
  - Join continuations with space, trim whitespace
- [x] **3B.4** Implement `@file` references with **deferred resolution**:
  - `@./relative/path` resolved relative to project `path`
  - `@/absolute/path` used as-is
  - Read file contents with `readFileSync`
  - Throw `JorchfileParseError` if file does not exist
  - Works for **any field except `path`**: `dev = @./scripts/dev.sh` reads file as the shell command
  - `path` field is always literal (with ~ expansion) — no @file (avoids circular dependency)
  - Resolution is deferred: all fields stored as raw strings first, @file resolved after `path` is known. Field order within a PROJECT block does not matter.
- [x] **3B.5** Implement reserved field parsing:
  - `path` → expand `~` to `os.homedir()`
  - `port` → parse as integer, validate range 1-65535
  - `tunnel` → validate `"serve"` or `"funnel"` only
  - `funnel_path` → string (reserved for Phase 4)
  - `approve` → validate `"confirm"`, `"plan"`, or `"auto"`
  - `output` → validate `"verbose"`, `"summary"`, or `"silent"`
  - `instructions` → resolve `@file` or use raw value
  - `background` → parse comma-separated list of command names (e.g., `dev, build, start`)
  - Any other key → stored in `commands` record
- [x] **3B.6** Implement validation:
  - `path` is required per project → `JorchfileValidationError`
  - No duplicate project names → `JorchfileValidationError`
  - Project name matches `^[a-zA-Z0-9_-]+$` → `JorchfileValidationError`
  - Validate final object with `JorchfileSchema.parse()`
- [x] **3B.7** Implement SETTINGS → `JorchSettings` mapping:
  - `log_retention_days` → `logRetentionDays` (integer)
  - `summary_retention_days` → `summaryRetentionDays` (integer)
  - `error_retention_days` → `errorRetentionDays` (integer)
  - `db_max_size_mb` → `dbMaxSizeMb` (integer)
  - Parse with `parseIntStrict()`, throw `JorchfileParseError` on NaN
- [x] **3B.8** Create `src/jorchfile/loader.ts`:
  - Export `loadJorchfile(filePath?: string): Jorchfile | null`
  - Default path: `~/.jorchbot/Jorchfile`
  - Returns `null` if file does not exist (no Jorchfile is valid)
  - Throws `JorchfileParseError` if file exists but cannot be read/parsed
  - Export `DEFAULT_JORCHFILE_PATH`
  - **Warn** about non-existent project paths: `console.warn()` per project whose `path` doesn't exist (not fatal)
- [x] **3B.9** Write `src/jorchfile/parser.test.ts`:
  - Parses basic Jorchfile with one project (name, path, commands)
  - Parses multiple projects
  - Parses reserved fields (port, tunnel, approve, output)
  - Handles backslash continuation
  - Expands `~` in path
  - Parses SETTINGS block
  - Ignores comments and blank lines
  - Handles `@file` references in `instructions` field (mock file read or use temp file)
  - Handles `@file` references in **command values** (e.g., `dev = @./scripts/dev.sh`)
  - Parses `background` field as comma-separated list
  - Defaults `background` to `["dev", "build"]` when not specified
  - Throws `JorchfileValidationError` for missing path
  - Throws `JorchfileValidationError` for duplicate project names
  - Throws `JorchfileParseError` for invalid format (no block)
  - Throws `JorchfileParseError` for invalid tunnel value
  - ~15 tests total
- [x] **3B.10** Write `src/jorchfile/loader.test.ts`:
  - Returns `null` when Jorchfile does not exist
  - Loads and parses valid Jorchfile from temp directory
  - Throws `JorchfileParseError` for malformed file
  - Logs `console.warn` for projects with non-existent path (spy on console.warn)
  - ~4 tests total
- [x] **3B.11** Run: `pnpm test:fast -- src/jorchfile/parser.test.ts` — all pass
- [x] **3B.12** Run: `pnpm test:fast -- src/jorchfile/loader.test.ts` — all pass
- [x] **3B.13** Verify: `pnpm check` clean

**Acceptance**: Parser handles the full Jorchfile format including `background` field and `@file` references in any field. Loader loads from disk, warns about non-existent paths, or returns null. ~19 tests pass.

---

## Sub-phase 3C: Port Manager (5 tasks)

Independent utility — no dependencies on other Phase 3 modules.

- [x] **3C.1** Create `src/jorchfile/port-manager.ts`:
  - Export `PortManager` class
  - `findAvailablePort(desired: number): Promise<number>` — tries desired, then increments up to +100
  - `isPortFree(port: number): Promise<boolean>` — attempts `createServer().listen()` then closes
  - Throws `Error` if no free port found in range
- [x] **3C.2** Write `src/jorchfile/port-manager.test.ts`:
  - Returns desired port if free (use high ephemeral port)
  - Auto-increments if port is occupied (occupy a port with `createServer`, verify next port is returned)
  - `isPortFree` returns `true` for free port
  - `isPortFree` returns `false` for occupied port
  - ~4 tests total
- [x] **3C.3** Run: `pnpm test:fast -- src/jorchfile/port-manager.test.ts` — all pass
- [x] **3C.4** Ensure test cleanup: close all test servers in `afterEach`
- [x] **3C.5** Verify: `pnpm check` clean

**Acceptance**: PortManager finds free ports and auto-increments. 4/4 tests pass.

---

## Sub-phase 3D: Background Task Manager (7 tasks)

Independent module — manages child processes with `spawn()`.

- [x] **3D.1** Create `src/jorchfile/task-manager.ts`:
  - Export `BackgroundTask` interface (pid, project, commandName, shellCommand, port, startedAt, process)
  - Export `StartTaskInput` interface
  - Export `BackgroundTaskManager` class
  - Export `formatUptime(startedAt: Date): string` helper
- [x] **3D.2** Implement `BackgroundTaskManager.start(input)`:
  - Spawn with `sh -c <shellCommand>`, cwd, merged env
  - Throw `BackgroundTaskStartError` if spawn fails or no PID assigned
  - Collect stdout/stderr in limited buffer (1000 chunks max)
  - Auto-remove on process exit + send notification to chat (success/crash)
  - Store in `Map<string, BackgroundTask[]>` keyed by project name
- [x] **3D.3** Implement `stop(project, commandName)`:
  - Find task by project+commandName, send SIGTERM
  - Throw `BackgroundTaskNotFoundError` if not found
- [x] **3D.4** Implement `stopAll(project)`:
  - Kill all tasks for a project, return count
- [x] **3D.5** Implement `listAll()`, `listByProject(project)`, `hasTasksFor(project)`
- [x] **3D.6** Write `src/jorchfile/task-manager.test.ts`:
  - Starts a task and assigns PID (`sleep 60` as test command)
  - Lists all tasks across projects
  - Stops a specific task by project+commandName
  - Stops all tasks for a project
  - Throws `BackgroundTaskNotFoundError` for unknown task
  - `formatUptime` returns human-readable string
  - ~6 tests total, ensure all spawned processes are killed in afterEach
- [x] **3D.7** Verify: `pnpm check` clean

**Acceptance**: BackgroundTaskManager spawns, lists, stops background tasks. 6/6 tests pass.

---

## Sub-phase 3E: Makefile Reader (5 tasks)

Independent utility — reads Makefile target names.

- [x] **3E.1** Create `src/jorchfile/makefile-reader.ts`:
  - Export `readMakefileTargets(projectPath: string): string[]`
  - Parse target lines matching `^[a-zA-Z0-9_-]+\s*:`
  - Skip `.PHONY` and dot-prefixed special targets
  - Skip recipe lines (tab/space-indented)
  - Return empty array if no Makefile exists
  - Throw `MakefileReadError` if Makefile exists but can't be read
- [x] **3E.2** Write `src/jorchfile/makefile-reader.test.ts`:
  - Reads target names from a temp Makefile
  - Returns empty array when no Makefile exists
  - Skips `.PHONY` and other dot-targets
  - Throws `MakefileReadError` for unreadable file
  - ~4 tests total
- [x] **3E.3** Run: `pnpm test:fast -- src/jorchfile/makefile-reader.test.ts` — all pass
- [x] **3E.4** Create temp Makefile in tests using `mkdtempSync` for isolation
- [x] **3E.5** Verify: `pnpm check` clean

**Acceptance**: `readMakefileTargets()` returns target names. 4/4 tests pass.

---

## Sub-phase 3F: Basic Tunnel Manager (6 tasks)

Basic Tailscale serve/funnel integration. Mocked in tests.

- [x] **3F.1** Create `src/jorchfile/tunnel.ts`:
  - Export `TunnelStartInput`, `ActiveTunnel` interfaces
  - Export `TunnelManager` class with deps: `sendReply`, `sendButtons`
- [x] **3F.2** Implement `TunnelManager.start(input)`:
  - Check Tailscale availability with `tailscale version`
  - If not available, send warning and return (not fatal)
  - For `funnel` mode, send confirmation buttons first (public exposure)
  - For `serve` mode, run `tailscale serve --bg <port>` directly
  - Get tunnel URL from `tailscale status --json` (DNSName)
  - Store in `activeTunnels` map keyed by `"project:port"`
- [x] **3F.3** Implement `startServe(input)` (called after confirmation for funnel):
  - Execute `tailscale serve --bg <port>` or `tailscale funnel --bg <port>`
  - Parse DNS name, construct URL, store, send to chat
- [x] **3F.4** Implement `stop(project, port)`, `stopAll(project)`, `listAll()`:
  - Execute `tailscale serve off <port>` or `tailscale funnel off <port>`
  - Best-effort — don't throw if already stopped
- [x] **3F.5** Write `src/jorchfile/tunnel.test.ts`:
  - Mock `exec` calls to Tailscale
  - `start()` with serve mode sends tunnel URL
  - `start()` with funnel mode sends confirmation buttons
  - `stop()` closes tunnel (calls `tailscale serve off`)
  - Sends warning when Tailscale not installed
  - ~4 tests total
- [x] **3F.6** Verify: `pnpm check` clean

**Acceptance**: TunnelManager starts/stops Tailscale tunnels. Warning if not installed. 4/4 tests pass.

---

## Sub-phase 3G: Jorchfile Executor (9 tasks)

Ties parser + port manager + task manager + tunnel manager together. This is the core orchestrator.

- [x] **3G.1** Replace placeholder in `src/jorchfile/executor.ts` with full implementation:
  - Export `JorchfileExecutorDeps` interface
  - Export `JorchfileExecutor` class
  - Export `DEFAULT_BACKGROUND_COMMANDS` array (fallback: `["dev", "build"]`)
- [x] **3G.2** Implement public API:
  - `updateJorchfile(jorchfile)` — for hot-reload
  - `getJorchfile()` — public read access
  - `getRegisteredCommands()` — union of all commands across all projects
  - `hasCommand(commandName)` — check if any project has this command
  - `getProject(name)` — lookup by name
  - `stopTunnel(project, port)` — delegates to TunnelManager
  - `stopAllTunnels(project)` — delegates to TunnelManager
- [x] **3G.3** Implement `execute(commandName, projectName, forceBackground)`:
  - Resolve project: explicit arg > focused session > error
  - Lookup in Jorchfile → `JorchfileProjectNotFoundError` if missing
  - Lookup command in project → `JorchfileCommandNotFoundError` if missing
  - Auto-create session if none exists (`ensureSession`)
  - Determine foreground vs background using `project.background` (per-project configurable, defaults to `["dev", "build"]`) + `forceBackground` flag
- [x] **3G.4** Implement `executeForeground()`:
  - Send `[project] $ <command>` to chat
  - Execute via `ShellRunner.execute()`
  - Send output to chat (stdout/stderr, exit code, truncation)
- [x] **3G.5** Implement `executeBackground()`:
  - **Duplicate check**: if same command already running for this project, send buttons ("Stop & restart" vs "Run another") instead of starting immediately
  - Port management: if `port` defined, find available port via PortManager
  - Notify if port changed
  - Start task via BackgroundTaskManager
  - Start tunnel if `tunnel` configured and port assigned
- [x] **3G.6** Implement `ensureSession()`:
  - Check if session exists via `sessionManager.getByProject()`
  - If not, create via `sessionManager.create()` with Jorchfile path + instructions
  - Send auto-creation notification
- [x] **3G.7** Write `src/jorchfile/executor.test.ts`:
  - `hasCommand()` returns true for existing commands
  - `hasCommand()` returns false for unknown commands
  - `getProject()` returns project by name
  - `execute()` calls ShellRunner for foreground commands
  - `execute()` calls TaskManager for commands in project's `background` list
  - `execute()` auto-creates session if none exists
  - `execute()` throws `JorchfileProjectNotFoundError` for unknown project
  - `execute()` throws `JorchfileCommandNotFoundError` for missing command
  - `execute()` sends duplicate-task buttons when same command already running
  - ~9 tests total, mock SessionManager/ShellRunner/TaskManager/PortManager/TunnelManager
- [x] **3G.8** Run: `pnpm test:fast -- src/jorchfile/executor.test.ts` — all pass
- [x] **3G.9** Verify: `pnpm check` clean

**Acceptance**: Executor resolves projects, dispatches foreground/background, auto-creates sessions. 8/8 tests pass.

---

## Sub-phase 3H: Hot-Reload Watcher (6 tasks)

Watches Jorchfile for changes and computes diffs.

- [x] **3H.1** Create `src/jorchfile/watcher.ts`:
  - Export `JorchfileChanges` interface (added, removed, modified arrays of project names)
  - Export `JorchfileWatcher` class with deps: `onReload`, `onError`
- [x] **3H.2** Implement `start(initialJorchfile)`:
  - Store initial projects in `previousProjects` map
  - Start `fs.watch()` on Jorchfile path
  - Do nothing if file doesn't exist (file might be created later)
- [x] **3H.3** Implement `debouncedReload()`:
  - Debounce at 300ms to avoid rapid-fire reloads
  - On reload: parse new Jorchfile, compute changes, call `onReload`
  - If file was deleted: treat all projects as removed
- [x] **3H.4** Implement `computeChanges(newJorchfile)`:
  - Added: names in new but not in previous
  - Removed: names in previous but not in new
  - Modified: exists in both, but `path`, `commands`, or `instructions` changed
- [x] **3H.5** Write `src/jorchfile/watcher.test.ts`:
  - Computes added projects correctly
  - Computes removed projects correctly
  - Computes modified projects when path changes
  - Computes modified projects when commands change
  - Does not report unchanged projects
  - ~5 tests total (test `computeChanges` directly rather than file watching)
- [x] **3H.6** Verify: `pnpm check` clean

**Acceptance**: Watcher detects added/removed/modified projects correctly. 5/5 tests pass.

---

## Sub-phase 3I: CommandRouter Extensions (10 tasks)

Extend the existing router with Phase 3 commands and priority chain.

- [x] **3I.1** Update `CommandRouterDeps` in `src/commands/router.ts`:
  - Add `getJorchfileExecutor: () => JorchfileExecutor | null` (getter function — supports hot-reload updates)
  - Add `taskManager: BackgroundTaskManager`
  - Add imports for `JorchfileExecutor`, `BackgroundTaskManager`, `formatUptime`, `readMakefileTargets`
- [x] **3I.2** Restructure `handleCommand()` with priority chain:
  - **Tier 1**: Built-in commands (existing + new: `/projects`, `/tasks`, `/stop-cmd`, `/make`)
  - **Tier 2**: Jorchfile commands (dynamic — check `jorchfileExecutor.hasCommand()`)
  - **Tier 3**: Shell shortcuts (`/ls`, `/cat`, `/grep`, `/pwd`, `/git`, `/tree`)
  - **Tier 4**: Unknown command message
- [x] **3I.3** Implement `/projects` handler:
  - If no Jorchfile, show "No Jorchfile loaded" message
  - List all projects from `executor.getJorchfile()` with session status and tasks
- [x] **3I.4** Implement `/tasks` handler:
  - List all background tasks from `taskManager.listAll()`
  - Show PID, project, command, uptime, port
- [x] **3I.5** Implement `/stop-cmd <project> [cmd]` handler:
  - With command: stop specific task + associated tunnel via `executor.stopTunnel()`
  - Without command: stop all tasks for project + all tunnels via `executor.stopAllTunnels()`
  - Get task port BEFORE stopping (for tunnel cleanup)
- [x] **3I.6** Implement `/make [target]` handler:
  - No args: list targets via `readMakefileTargets()`
  - With target: execute `make <target>` via `executeShell()`
  - Requires focused session
- [x] **3I.7** Update `/new <project> [path]` handler:
  - Check Jorchfile first via `executor.getProject()`
  - Use Jorchfile path if no explicit path provided
  - Inject Jorchfile instructions as `systemPrompt`
  - Show "(from Jorchfile)" tag in response
  - If not in Jorchfile and no path provided, show clear error
- [x] **3I.8** Update `/help` to include Phase 3 commands
- [x] **3I.9** Update `src/commands/router.test.ts` with Phase 3 tests:
  - `/projects` lists Jorchfile projects
  - `/tasks` shows background tasks
  - `/stop-cmd` kills task and closes tunnel
  - `/make` lists targets and executes
  - `/new frontend` uses Jorchfile path
  - Jorchfile command takes priority over shell shortcut
  - Dynamic Jorchfile command dispatches to executor
  - Trailing `&` correctly parsed for background flag
  - `/dev frontend` without args uses focused session
  - Unknown Jorchfile command falls through to shell shortcuts
  - ~10 tests total
- [x] **3I.10** Verify: `pnpm check` clean

**Acceptance**: Router dispatches Phase 3 commands correctly. Priority chain works. 10/10 tests pass.

---

## Sub-phase 3J: Gateway Integration (7 tasks)

Wire everything together in `src/gateway/jorchbot-start.ts`.

- [x] **3J.1** Add imports for: `loadJorchfile`, `JorchfileExecutor`, `BackgroundTaskManager`, `PortManager`, `TunnelManager`, `JorchfileWatcher`
- [x] **3J.2** After config load, load Jorchfile:
  - Call `loadJorchfile()`, catch parse errors (log warning, continue without Jorchfile)
  - Apply SETTINGS overrides to config (in-memory only, not written back)
- [x] **3J.3** Create Phase 3 component instances:
  - `BackgroundTaskManager({ sendReply })`
  - `PortManager()`
  - `TunnelManager({ sendReply, sendButtons })`
  - `JorchfileExecutor` if Jorchfile exists (null if not)
  - Log: `[jorchbot] Jorchfile loaded: N project(s)` or skip silently
- [x] **3J.4** Set up `JorchfileWatcher`:
  - `onReload`: update executor, kill sessions for modified/removed projects (stopAll tasks, stopAll tunnels, destroy session), notify user
  - `onError`: log to console
  - Call `watcher.start(jorchfile)`
- [x] **3J.5** Update `CommandRouter` construction to pass new deps:
  - `getJorchfileExecutor: () => jorchfileExecutor` (getter function — enables hot-reload to update the executor without re-creating the router)
  - `taskManager`
- [x] **3J.6** Update shutdown handler:
  - Stop watcher
  - Kill all background tasks
  - Stop all tunnels (best-effort)
  - Then existing session cleanup
- [x] **3J.7** Update webhook `onButtonReply` to handle new button types:
  - Parse `tunnel_approve` type → call `tunnelManager.startServe()` with funnel mode
  - Parse `tunnel_reject` type → send cancellation message
  - Parse `task_restart` type → stop existing task, then re-execute the command
  - Parse `task_duplicate` type → execute the command without stopping the existing task

**Acceptance**: Gateway starts with Jorchfile loaded. Hot-reload works. Shutdown cleans up all background tasks and tunnels.

---

## Sub-phase 3K: Session Manager Integration (4 tasks)

Update SessionManager to interact with background tasks and tunnels on session destroy.

- [x] **3K.1** Add optional `onDestroy` callback to `SessionManagerDeps`:
  - `onSessionDestroy?: (project: string) => void`
  - Called after session is destroyed (before focus auto-switch)
- [x] **3K.2** Call `onDestroy` in `destroy()` method after stopping runner
- [x] **3K.3** In `jorchbot-start.ts`, wire `onSessionDestroy` to:
  - `taskManager.stopAll(project)` — kill all background tasks
  - `tunnelManager.stopAll(project)` — close all tunnels (best-effort)
- [x] **3K.4** Verify: existing `manager.test.ts` still passes, add 1 test for `onDestroy` callback

**Acceptance**: `/stop frontend` kills background tasks and closes tunnels. Existing tests pass + 1 new test.

---

## Sub-phase 3L: Final Verification (4 tasks)

- [x] **3L.1** Run full test suite: `pnpm test:fast` — all pass (803 files, 6727 tests)
- [x] **3L.2** Run `pnpm check` — 0 errors, 0 warnings
- [x] **3L.3** Manual smoke test with a real Jorchfile:
  - Create `~/.jorchbot/Jorchfile` with a test project
  - Verify `/projects` shows the project
  - Verify `/new <project>` uses Jorchfile config
  - Verify parse errors are reported clearly
- [x] **3L.4** Verify no `any` in new JorchBot code: `grep -r "any" src/jorchfile/ --include="*.ts" -l`

**Acceptance**: All checks pass. Manual smoke test confirms end-to-end functionality.

---

## Dependency Graph

```
3A (Errors)
 │
 ▼
3B (Parser + Loader) ───────────────────────────────┐
 │                                                   │
 ├──────────┬──────────┬──────────┐                  │
 ▼          ▼          ▼          ▼                  │
3C (Port)  3D (Tasks) 3E (Make)  3F (Tunnel)         │
 │          │                     │                  │
 └──────────┼─────────────────────┘                  │
            │                                        │
            ▼                                        │
          3G (Executor) ◄────────────────────────────┘
            │
            ▼
          3H (Watcher)
            │
            ▼
          3I (Router Extensions)
            │
            ▼
          3J (Gateway Integration)
            │
            ▼
          3K (Session Manager Integration)
            │
            ▼
          3L (Final Verification)
```

**Sub-phases 3C, 3D, 3E, 3F can be developed in parallel** after completing 3B.

---

## Summary

| Sub-phase | Module                      | Tasks  | Tests   |
| --------- | --------------------------- | ------ | ------- |
| 3A        | Error classes verification  | 2      | 0       |
| 3B        | Parser + Loader             | 13     | ~19     |
| 3C        | Port Manager                | 5      | ~4      |
| 3D        | Background Task Manager     | 7      | ~6      |
| 3E        | Makefile Reader             | 5      | ~4      |
| 3F        | Tunnel Manager              | 6      | ~4      |
| 3G        | Executor                    | 9      | ~9      |
| 3H        | Watcher                     | 6      | ~5      |
| 3I        | Router Extensions           | 10     | ~10     |
| 3J        | Gateway Integration         | 7      | 0       |
| 3K        | Session Manager Integration | 4      | ~1      |
| 3L        | Final Verification          | 4      | 0       |
| **Total** |                             | **68** | **~64** |
