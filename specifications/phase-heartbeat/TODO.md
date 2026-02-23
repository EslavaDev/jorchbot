# Heartbeat Integration — TODO

> **Spec**: `specifications/phase-heartbeat/SPEC.md`
> **Dependencies**: Phase 2 (SessionManager), Phase 3 (Jorchfile), Phase 6 (GUI)
> **Language**: English

---

## Phase A: Foundation (Config + Types + Duration Parser)

- [ ] Add `HeartbeatSchema` and `ActiveHoursSchema` to `src/config/jorchbot-config.ts`
- [ ] Add heartbeat reserved fields (`heartbeat`, `heartbeat_hours`, `heartbeat_tz`, `heartbeat_prompt`) to Jorchfile parser `RESERVED_FIELDS` set
- [ ] Add heartbeat fields to `JorchProjectSchema` in `src/jorchfile/parser.ts`
- [ ] Create `src/infra/parse-duration.ts` with `parseDuration()` function
- [ ] Create `src/infra/parse-duration.test.ts` — all cases: minutes, hours, combined, zero, invalid, empty
- [ ] Add error classes to `src/errors/index.ts`: `HeartbeatRunnerError`, `HeartbeatPromptError`, `HeartbeatConfigError`
- [ ] Create `src/heartbeat/types.ts` with `HeartbeatProjectState`, `HeartbeatRunResult`, `ResolvedProjectHeartbeat`
- [ ] Run `pnpm check` — fix ALL errors

## Phase B: Active Hours (JorchBot-specific)

- [ ] Create `src/heartbeat/active-hours.ts` with `isWithinActiveHoursJb()` — standalone implementation without OpenClaw config dependency
- [ ] Create `src/heartbeat/active-hours.test.ts` — test cases: within window, outside window, wrap-around (22:00-08:00), 24:00 end, same start/end (disabled), no config (24/7), invalid timezone fallback
- [ ] Run `pnpm check` — fix ALL errors

## Phase C: Core Runner

- [ ] Create `src/heartbeat/heartbeat-runner.ts` with `JorchBotHeartbeatRunner` class
  - [ ] `start()` / `stop()` lifecycle
  - [ ] `syncProjects()` — sync with active sessions + Jorchfile config
  - [ ] `scheduleNext()` — timer management
  - [ ] `tick()` — run due heartbeats
  - [ ] `runForProject()` — single project execution
  - [ ] `sendHeartbeatPrompt()` — ClaudeRunner integration via `runner.resume()`
  - [ ] `resolveProjectConfig()` — merge Jorchfile + global config
  - [ ] HEARTBEAT.md reading + empty gating
  - [ ] HEARTBEAT_OK token stripping (import from Layer 1 `stripHeartbeatToken`)
  - [ ] Duplicate suppression (24h window)
  - [ ] Active hours check
  - [ ] Context guard check (skip if >95%)
  - [ ] Runner busy check (skip if not idle)
  - [ ] Exponential backoff on failures
  - [ ] `runNow()` — force immediate run
  - [ ] `getStatus()` — status for GUI/chat
  - [ ] `updateConfig()` — live config reload
  - [ ] WebSocket event emission
- [ ] Create `src/heartbeat/heartbeat-runner.test.ts`
  - [ ] Lifecycle tests (start, stop, double-start)
  - [ ] Happy path: alert delivered
  - [ ] HEARTBEAT_OK suppressed
  - [ ] Runner busy → skip
  - [ ] Context too high → skip
  - [ ] Outside active hours → skip
  - [ ] Empty HEARTBEAT.md → skip
  - [ ] Missing HEARTBEAT.md → still runs
  - [ ] Duplicate suppression (same text within 24h)
  - [ ] Duplicate allowed after 24h
  - [ ] Exponential backoff on failure
  - [ ] Per-project Jorchfile config override
  - [ ] Global config when no override
  - [ ] Disabled interval (0m) → skip
  - [ ] Session destroyed mid-run
- [ ] Run `pnpm check` — fix ALL errors

## Phase D: Gateway Wiring

- [ ] Wire `JorchBotHeartbeatRunner` in `src/gateway/jorchbot-start.ts`
  - [ ] Create runner after SessionManager
  - [ ] Start if `config.heartbeat.enabled`
  - [ ] Listen to SessionManager events (`sessionCreated`, `sessionDestroyed`)
  - [ ] Register shutdown handler
- [ ] Add heartbeat RPC handlers to `src/gateway/jorchbot-ws-handlers.ts`:
  - [ ] `jb.heartbeat.status` — return heartbeat status for all projects
  - [ ] `jb.heartbeat.runNow` — force immediate run for a project
  - [ ] `jb.heartbeat.toggle` — enable/disable heartbeat globally
- [ ] Run `pnpm check` — fix ALL errors

## Phase E: Chat Commands

- [ ] Add `/heartbeat` (alias `/hb`) command to `src/auto-reply/command-control.ts`
  - [ ] `status` — show heartbeat status for all projects
  - [ ] `now <project>` — force immediate heartbeat for a project
  - [ ] `off [project]` — disable heartbeat (globally or per-project)
  - [ ] `on [project]` — enable heartbeat (globally or per-project)
- [ ] Add tests for heartbeat chat commands in `src/auto-reply/command-control.test.ts`
- [ ] Run `pnpm check` — fix ALL errors

## Phase F: GUI Integration

- [ ] Create `ui/src/ui/views/jb-heartbeat.ts` — heartbeat view component
- [ ] Create `ui/src/ui/controllers/heartbeat.ts` — heartbeat state management
  - [ ] `loadHeartbeatStatus()` — fetch from `jb.heartbeat.status`
  - [ ] `toggleHeartbeat()` — call `jb.heartbeat.toggle`
  - [ ] `runHeartbeatNow()` — call `jb.heartbeat.runNow`
- [ ] Add HeartbeatState to app types in `ui/src/ui/types.ts`
- [ ] Wire heartbeat view into main app render (Overview tab or dedicated tab)
- [ ] Add i18n keys for heartbeat strings in `ui/src/i18n/locales/en.ts`
- [ ] Run `pnpm check` — fix ALL errors (do NOT try to build)

## Phase G: Final Polish

- [ ] Verify `stripHeartbeatToken` import from Layer 1 works at runtime (no circular deps)
- [ ] Ensure heartbeat state survives config reload (`config.set` → `updateConfig()`)
- [ ] Add `heartbeat` section to config schema hints in `jorchbot-ws-handlers.ts` (for GUI config editor)
- [ ] Run full test suite: `pnpm test:fast`
- [ ] Run `pnpm check` — ALL must pass (0 errors, 0 warnings)
