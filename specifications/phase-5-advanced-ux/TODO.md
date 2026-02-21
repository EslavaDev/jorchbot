# Phase 5 — Advanced UX: Implementation Tasks

> **Reference**: `specifications/phase-5-advanced-ux/SPEC.md`
> **Estimated files**: 7 new, 7 modified
> **Dependencies**: Phase 4 (completed)

---

## Sub-phase 5A: Shared Types & Error Classes

Foundation types and errors used by all subsequent sub-phases.

- [x] **5A.1** Create `src/sessions/jorchbot/types.ts` with `ApprovalMode` and `OutputMode` type exports
- [x] **5A.2** Add error classes to `src/errors/index.ts`: `InvalidModeError`, `SessionModeUpdateError`, `DocumentStoreError`, `DocumentNotFoundError`
- [x] **5A.3** Update existing imports in `manager.ts` and `approval-manager.ts` to use shared types from `types.ts` instead of inline type literals
- [x] **5A.4** Run `pnpm check` — must pass clean

---

## Sub-phase 5B: Approval Modes (confirm/plan/auto)

Mode enforcement via hooks and gateway. Core feature of Phase 5.

- [x] **5B.1** Create `src/sessions/jorchbot/approval-modes.ts` with `resolveApprovalByMode()` function (SPEC section 3.1)
- [x] **5B.2** Create `src/sessions/jorchbot/approval-modes.test.ts` — test all 3 modes × write/read tools
- [x] **5B.3** Modify `src/gateway/approval-api.ts` — `POST /api/tool-approval` checks session mode before creating pending approval. If auto → auto-approve. If plan + write → auto-deny with reason. If plan + read → auto-approve. If confirm → existing flow.
- [x] **5B.4** Modify `src/hooks/jorchbot/tool-approval.ts` — handle `autoResolved` response from gateway (skip polling if already resolved)
- [x] **5B.5** Add `setMode()` method to `SessionManager` (updates DB + validates)
- [x] **5B.6** Write integration test: mock gateway endpoint, verify auto/plan/confirm flows through hook→gateway→resolution
- [x] **5B.7** Run `pnpm check` — must pass clean
- [x] **5B.8** Run `pnpm test:fast -- src/sessions/jorchbot/approval-modes.test.ts` — must pass

---

## Sub-phase 5C: Output Modes (verbose/summary/silent)

Output filtering in SessionManager.

- [x] **5C.1** Create `src/sessions/jorchbot/output-filter.ts` with `shouldSendToChat()` function (SPEC section 3.2)
- [x] **5C.2** Create `src/sessions/jorchbot/output-filter.test.ts` — test all 3 modes × all event types
- [x] **5C.3** Add `setOutputMode()` and `getSessionRecord()` methods to `SessionManager`
- [x] **5C.4** Modify `SessionManager.wireRunnerEvents()` — check `shouldSendToChat()` before calling `sendReplyTo()`. Always log to DB regardless.
- [x] **5C.5** Run `pnpm check` — must pass clean
- [x] **5C.6** Run `pnpm test:fast -- src/sessions/jorchbot/output-filter.test.ts` — must pass

---

## Sub-phase 5D: `/mode` Command

CommandRouter integration.

- [x] **5D.1** Add `case "mode"` to CommandRouter's Tier 1 switch in `src/commands/router.ts`
- [x] **5D.2** Implement `handleMode()` private method — auto-detect approval vs output mode, support optional project arg, show current modes with no args
- [x] **5D.3** Test `/mode` command: no args, valid approval mode, valid output mode, invalid mode, with project name, without focused session
- [x] **5D.4** Run `pnpm check` — must pass clean

---

## Sub-phase 5E: Jorchfile Defaults

Read `approve`/`output` from Jorchfile on session creation.

- [x] **5E.1** Extend `CreateSessionInputSchema` with optional `initialMode` and `initialOutputMode` fields
- [x] **5E.2** Modify `SessionManager.create()` — use `initialMode`/`initialOutputMode` instead of hardcoded `"confirm"`/`"verbose"`
- [x] **5E.3** Modify CommandRouter's `/new` handler — read `approve`/`output` from Jorchfile project and pass to `SessionManager.create()`
- [x] **5E.4** Test: create session from Jorchfile with `approve = auto, output = silent` → verify DB has correct values
- [x] **5E.5** Test: create session from Jorchfile without approve/output → verify defaults to confirm/verbose
- [x] **5E.6** Run `pnpm check` — must pass clean

---

## Sub-phase 5F: Yes + Feedback Flow

Third approval button and feedback capture.

- [x] **5F.1** Modify `ApprovalManager` — add `"awaiting_feedback"` status, `awaitingFeedback` map, `setAwaitingFeedback()`, `getAwaitingFeedbackId()` methods (SPEC section 3.6.1)
- [x] **5F.2** Modify `ApprovalManager.requestApproval()` — send 3 buttons: `[Yes] [Yes + feedback] [No]`
- [x] **5F.3** Modify `ApprovalManager.resolveApproval()` — accept optional `feedback` parameter, store in `additionalContext`
- [x] **5F.4** Modify `ApprovalManager.getApprovalStatus()` — return `additionalContext` when available, return `"awaiting_feedback"` status
- [x] **5F.5** Modify `src/gateway/approval-api.ts` `GET /api/tool-approval/:id` — return `additionalContext` in response
- [x] **5F.6** Modify `src/hooks/jorchbot/tool-approval.ts` — handle `"awaiting_feedback"` as "keep polling", pass `additionalContext` to `hookSpecificOutput`
- [x] **5F.7** Add webhook handler for "feedback" button action — calls `setAwaitingFeedback()` and sends "Write your feedback" message
- [x] **5F.8** Add feedback capture in message routing — detect `getAwaitingFeedbackId()` before forwarding to ClaudeRunner, resolve approval with feedback text
- [x] **5F.9** Add feedback timeout (5 min) — `setTimeout` that clears awaiting state and re-sends buttons
- [x] **5F.10** Write tests for ApprovalManager: 3 buttons sent, awaiting_feedback state, feedback capture, feedback timeout, additionalContext in resolved status
- [x] **5F.11** Run `pnpm check` — must pass clean

---

## Sub-phase 5G: Smart Chunking + Document Attachments

Enhanced message chunking with numbered chunks and document fallback.

- [x] **5G.1** Create `src/sessions/jorchbot/session-chunker.ts` with `chunkForSession()` function (SPEC section 3.7.1)
- [x] **5G.2** Create `src/sessions/jorchbot/session-chunker.test.ts` — test single chunk, multi chunk numbering, max chunks limit, document threshold, filename format
- [x] **5G.3** Create `src/gateway/document-api.ts` with `createDocumentRouter()` (SPEC section 3.7.2)
- [x] **5G.4** Test document API: store → retrieve → expiry → max capacity eviction
- [x] **5G.5** Mount document router in `src/gateway/jorchbot-start.ts`
- [x] **5G.6** Add `sendDocumentTo` callback to SessionManagerDeps (wraps `kapsoClient.sendDocument()`)
- [x] **5G.7** Modify `SessionManager` — use `chunkForSession()` for outbound messages, send document via `sendDocumentTo` when needed
- [x] **5G.8** Add fallback: if document URL is not reachable (localhost without Tailscale), send as additional text chunks with warning
- [x] **5G.9** Run `pnpm check` — must pass clean

---

## Sub-phase 5H: Output Buffering

Batch streaming events into 3-second windows.

- [x] **5H.1** Create `src/sessions/jorchbot/output-buffer.ts` with `OutputBuffer` class (SPEC section 3.8)
- [x] **5H.2** Create `src/sessions/jorchbot/output-buffer.test.ts` — test timer flush, force flush, empty buffer, overflow flush, dispose
- [x] **5H.3** Modify `SessionManager.wireRunnerEvents()` — create `OutputBuffer` per session, route text events through buffer
- [x] **5H.4** Ensure `result` and `error` events call `buffer.forceFlush()` before processing
- [x] **5H.5** Ensure session destroy calls `buffer.dispose()`
- [x] **5H.6** Run `pnpm check` — must pass clean
- [x] **5H.7** Run `pnpm test:fast -- src/sessions/jorchbot/output-buffer.test.ts` — must pass

---

## Sub-phase 5I: Approval Timeout with Reminders

Re-send approval buttons after configurable timeout.

- [x] **5I.1** Create `src/sessions/jorchbot/approval-timer.ts` with `ApprovalTimer` class (SPEC section 3.9)
- [x] **5I.2** Create `src/sessions/jorchbot/approval-timer.test.ts` — test reminder fires, clear prevents reminder, dispose clears all
- [x] **5I.3** Integrate `ApprovalTimer` in `ApprovalManager` — start timer on `requestApproval()`, clear on `resolveApproval()`
- [x] **5I.4** Reminder callback re-sends buttons with `[Reminder]` prefix
- [x] **5I.5** Read `approvals.timeoutMinutes` from config for reminder delay (default 10 min, already exists in config schema)
- [x] **5I.6** Run `pnpm check` — must pass clean
- [x] **5I.7** Run `pnpm test:fast -- src/sessions/jorchbot/approval-timer.test.ts` — must pass

---

## Sub-phase 5J: Final Verification

- [x] **5J.1** Run full test suite: `pnpm test:fast` — all Phase 5 tests pass (178 tests). 14 pre-existing failures in src/web/ and src/discord/ unrelated to Phase 5.
- [x] **5J.2** Run full check: `pnpm check` — 0 errors, 0 warnings
- [ ] **5J.3** Manual verification: start gateway, create session, test `/mode auto`, verify no buttons sent
- [ ] **5J.4** Manual verification: test `/mode plan`, verify write tools denied with plan reason
- [ ] **5J.5** Manual verification: test `/mode silent`, verify only results appear in WhatsApp
- [ ] **5J.6** Manual verification: test "Yes + feedback" button flow end-to-end
- [ ] **5J.7** Verify Jorchfile defaults: create project with `approve = auto` → session starts in auto mode
- [x] **5J.8** Review all modified files for code quality, no leftover TODOs, no swallowed errors

---

## Implementation Order

```
5A (types + errors) — foundation, no dependencies
  │
  ├─→ 5B (approval modes) — core feature
  │     │
  │     ├─→ 5D (/mode command) — uses setMode() from 5B
  │     │     │
  │     │     └─→ 5E (Jorchfile defaults) — uses /mode infrastructure
  │     │
  │     └─→ 5F (yes + feedback) — extends approval system from 5B
  │           │
  │           └─→ 5I (approval timer) — extends approval manager from 5F
  │
  ├─→ 5C (output modes) — independent of 5B
  │     │
  │     └─→ 5H (output buffer) — integrates with output filter from 5C
  │
  └─→ 5G (smart chunking) — independent
        │
        └─→ 5J (final verification) — after all sub-phases
```

**Parallel tracks**: 5B+5D+5E+5F+5I (approval), 5C+5H (output), and 5G (chunking) can be developed in parallel after 5A is complete.

---

## Risk Mitigation

1. **Document URL accessibility**: Test early whether Kapso can fetch from `localhost`. If not, implement the fallback (chunked text) in 5G.8 before spending time on the document endpoint.
2. **additionalContext visibility**: Verify with a real Claude Code instance that `additionalContext` in hook output is actually visible to Claude. Do this in 5F before building the full feedback flow.
3. **Hook timeout vs reminder timing**: The hook's 5-minute timeout means the gateway reminder at 10 minutes fires after the hook already denied. This is intentional — Claude retries, triggering a new approval. Document this clearly in the help text.
