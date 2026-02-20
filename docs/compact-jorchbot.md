# JorchBot Session Compaction

> **Status**: Planned (not yet implemented)
> **Target phase**: Phase 2 enhancement
> **Related**: `src/agents/compaction.ts` (OpenClaw), `docs/future_agent_runner.md`
> **Prerequisites**: `src/sessions/jorchbot/context-guard.ts` (already implemented)

---

## 1. Problem

JorchBot's current `/compact` and `!compact` are broken — they kill the Claude Code process and start fresh with a generic prompt, **losing all conversation context**. The new session has no idea what was done before.

OpenClaw has a mature compaction system in `src/agents/compaction.ts`, but it requires API keys (uses `generateSummary()` via Anthropic API directly). JorchBot uses the user's Claude **subscription** (no API key), so we can't call the API directly.

### How OpenClaw's compaction works

| Aspect             | OpenClaw                                   | JorchBot (proposed)                            |
| ------------------ | ------------------------------------------ | ---------------------------------------------- |
| **Who summarizes** | LLM via API directly                       | LLM via Claude Code CLI                        |
| **Billing**        | API key (pay per token)                    | Subscription (flat rate)                       |
| **Function**       | `generateSummary(messages, model, apiKey)` | `tempRunner.start({ prompt: "summarize..." })` |
| **Input**          | `AgentMessage[]` (internal format)         | Transcript formatted from DB                   |
| **Output**         | String summary                             | `result.textContent` summary                   |

The concept is the same: **ask an LLM to summarize the conversation**. Only the invocation mechanism differs.

### OpenClaw algorithms we can reuse later

From `src/agents/compaction.ts`:

- `estimateMessagesTokens()` — Token estimation
- `splitMessagesByTokenShare()` — Proportional chunking
- `chunkMessagesByMaxTokens()` — Fixed-size chunking
- `computeAdaptiveChunkRatio()` — Adaptive sizing (reduces chunks when messages are large)
- `pruneHistoryForContextShare()` — Drop oldest messages to fit budget
- `summarizeWithFallback()` — Full → partial → metadata fallback strategy
- `summarizeInStages()` — Split history into N parts, summarize each, merge

These can be adopted when we integrate with JSONL transcripts (Phase 2J+).

---

## 2. Context Guard (already implemented)

The context guard system is a prerequisite for smart compaction. It lives in `src/sessions/jorchbot/context-guard.ts` and is already wired into the router and session manager.

### Thresholds

| Level        | Percent | Behavior                                                                         |
| ------------ | ------- | -------------------------------------------------------------------------------- |
| **ok**       | < 70%   | Normal operation, no messages                                                    |
| **warn**     | 70-89%  | Append "Context at X%" after each result                                         |
| **critical** | 90-94%  | Append "Context at X%. Use /compact to free space."                              |
| **block**    | >= 95%  | Reject new prompts with "Use /compact to free space before sending new prompts." |

Thresholds are configurable via `SessionManagerDeps.contextGuard`:

```typescript
contextGuard?: ContextGuardThresholds & { contextLimit?: number };
// ContextGuardThresholds = { warnPercent?, criticalPercent?, blockPercent? }
```

### Where it's used

- **`SessionManager.wireRunnerEvents()`** — After each `result` event, evaluates guard and sends warning messages to the user.
- **`SessionManager.checkContextGuard(project)`** — Public method used by `CommandRouter` to gate prompt delivery.
- **`CommandRouter.handlePrompt()`** — Blocks free text at block level.
- **`CommandRouter.forwardToClaudeCode()`** — Blocks `!` commands at block level.
- **`CommandRouter.handleClaudeContext()`** — Shows guard-level warnings in `!context` output.
- **`SessionManager.answerQuestion()`** — Blocks question answers at block level.

### Configurable context limit

`ClaudeRunner` now accepts a configurable context limit via constructor:

```typescript
const runner = new ClaudeRunner({ contextLimit: 200_000 }); // default
runner.getContextLimit(); // → 200_000
runner.getContextPercent(); // Uses this.contextLimit for calculation
```

`SessionManager.createRunner()` automatically passes `contextGuardLimit` to the runner.

### Compaction integration (planned)

When compaction is implemented, it should:

1. Be **auto-suggested** at `critical` level (90%+) — the guard already does this via messages.
2. Be **required** at `block` level (95%+) — the user literally cannot send prompts until they compact.
3. After compaction, the new runner's context resets to ~17% (system prompt overhead), bringing the guard back to `ok` level.

---

## 3. Solution

Use our DB message logs as the source of truth, spawn a **separate Claude Code process** to generate the summary (uses subscription, not API), then start a new session with the summary injected as system prompt.

### Architecture

```
User sends !compact
  → Pull messages from DB (messages table)
  → Format as readable transcript
  → Spawn temporary ClaudeRunner to summarize transcript (uses subscription)
  → Capture summary text
  → Stop old session runner
  → Start new session runner with summary as --append-system-prompt
  → Report: "Compacted: 75% → 18%"
```

---

## 4. Files to Create

### `src/sessions/jorchbot/session-compaction.ts`

Core compaction module:

#### `buildTranscript(sessionId, maxMessages?)`

- Pulls messages from DB for the session (ordered by `createdAt ASC`)
- Formats into readable transcript:
  ```
  [inbound/text] fix the login bug
  [outbound/text] I'll edit src/auth/login.ts...
  [system/approval] Tool: Edit
  [outbound/shell] $ git status...
  ```
- Caps at `maxMessages` (default: 200) to avoid enormous transcripts
- Returns the formatted string

#### `compactSession(session, cwd, createRunner)`

Orchestrates the full compaction flow:

1. Get previous context % from runner
2. Build transcript from DB
3. If transcript is empty → return early ("nothing to compact")
4. Spawn a **temporary** ClaudeRunner for summarization
5. Call `tempRunner.start()` with summarization prompt + transcript
6. Capture summary from `result.textContent`
7. Stop temp runner
8. Stop old session runner
9. Start session runner fresh with summary as `systemPrompt`
10. Return `CompactionResult`

#### `CompactionResult` interface

```typescript
interface CompactionResult {
  ok: boolean;
  summary: string;
  previousContextPercent: number;
  newContextPercent: number;
  messagesCompacted: number;
  durationMs: number;
  error?: string;
}
```

#### Summarization prompt

Adapted from OpenClaw's `MERGE_SUMMARIES_INSTRUCTIONS`:

```
You are summarizing a development conversation for context continuity.
Preserve: files modified, key decisions, current state, errors encountered,
TODOs, and next steps. Be concise but complete.

Conversation transcript:
{transcript}

Provide a structured summary.
```

### `src/sessions/jorchbot/session-compaction.test.ts`

Tests:

- `buildTranscript` formats messages correctly
- `buildTranscript` respects maxMessages limit
- `buildTranscript` returns empty string for no messages
- `compactSession` calls temp runner with summarization prompt
- `compactSession` starts new session with summary as systemPrompt
- `compactSession` returns correct metrics
- `compactSession` handles temp runner failure gracefully

---

## 5. Already Implemented (prerequisites)

These changes are already in place and support the compaction feature:

- **`src/sessions/jorchbot/context-guard.ts`** — Pure functions for context guard evaluation (see section 2).
- **`src/sessions/jorchbot/claude-runner.ts`** — `ClaudeRunner` now accepts `{ contextLimit?: number }` in constructor, has `getContextLimit()` getter, imports `DEFAULT_CONTEXT_LIMIT` from context-guard.
- **`src/sessions/jorchbot/manager.ts`** — `SessionManagerDeps` already has `createRunner?: () => ClaudeRunner` and `contextGuard?: ContextGuardThresholds & { contextLimit?: number }`. The `checkContextGuard(project)` method is already public. The default `createRunner` factory passes the configured `contextGuardLimit` to ClaudeRunner.
- **`src/commands/router.ts`** — Already has `!context` (with progress bar and guard warnings), `!usage` (local token counts), and block-level gating on `handlePrompt()` and `forwardToClaudeCode()`.

---

## 6. Files to Modify

### `src/commands/router.ts`

Update `handleCompact()` and `handleClaudeCompact()` to call the new `compactSession()` instead of the current stop-and-restart approach. The `createRunner` factory is available via `this.deps.sessionManager` (no need to add it to `CommandRouterDeps`).

### `src/gateway/jorchbot-start.ts`

No changes needed — `createRunner` is already wired through `SessionManagerDeps`.

---

## 7. Design Decisions

1. **Separate temp runner for summarization** — NOT resuming the existing session. If context is at 90%, asking it to summarize adds MORE tokens before freeing any. A fresh runner only has the system prompt overhead (~17%) + the transcript.

2. **DB messages as source of truth** — NOT Claude Code's internal session state. We can always access DB logs even if the Claude Code process crashed. Compaction works regardless of runner state.

3. **`--append-system-prompt` for summary injection** — The summary is injected as part of the system prompt in the new session, so it's always available to Claude but doesn't count as conversation history. This is how `ClaudeRunner.start()` already works with the `systemPrompt` option.

4. **Runner-agnostic design** — `compactSession()` takes a `createRunner` factory, not a specific ClaudeRunner. Compatible with the future AgentRunner interface (`docs/future_agent_runner.md`).

5. **No OpenClaw dependency** — Uses only JorchBot's own DB and ClaudeRunner. OpenClaw's compaction algorithms (token estimation, chunking) can be adopted later when we integrate with JSONL transcripts (Phase 2J+).

---

## 8. Future: Integration with OpenClaw Compaction

Once sessions are registered as OpenClaw agents (Phase 2J) and writing JSONL transcripts:

1. Write JorchBot DB messages → OpenClaw JSONL format (`~/.jorchbot/agents/{project}/sessions/{key}.jsonl`)
2. Call OpenClaw's `compactEmbeddedPiSession()` on that file
3. Extract summary from compaction result
4. Resume Claude Code with summary injected as system prompt

This unlocks:

- OpenClaw's battle-tested token estimation (`estimateTokens()`)
- Multi-stage summarization (`summarizeInStages()`)
- Compaction diagnostics (message counts, token deltas, top contributors)
- Compatibility with OpenClaw's memory system and Control UI transcripts

---

## 9. Verification

```bash
pnpm check                                                          # 0 errors, 0 warnings
pnpm test:fast -- src/sessions/jorchbot/session-compaction.test.ts   # All pass
pnpm test:fast -- src/commands/router.test.ts                        # All pass
pnpm build                                                           # Success
```

Manual test:

1. `pnpm dev` → start gateway
2. `/new tt` → create session
3. Send several messages to build up context
4. `!compact` → should show "Compacted: X% → Y%" with real summary
5. Send follow-up message → Claude should have context from summary
