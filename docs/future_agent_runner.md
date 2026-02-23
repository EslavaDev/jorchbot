# Future: Abstract Agent Runner Interface

> **Status**: Scheduled → [Phase 10 — AgentRunner Abstraction](./phase-10-agent-runner.md)
> **Target phase**: Phase 10 (AgentRunner Abstraction)
> **Related**: Phase 2 (ClaudeRunner), Phase 3 (Jorchfile/Skills), Phase 8 (Security), research.md section 17

---

## 1. Problem

Today JorchBot has `ClaudeRunner` — a subprocess wrapper for Claude Code CLI. It's tightly coupled to Claude Code's specifics:

- `claude -p --output-format stream-json`
- `--resume <session_id>` for multi-turn
- `--dangerously-skip-permissions` for headless operation
- PreToolUse/PostToolUse hooks for tool approval
- Uses the host's Claude subscription (no API key)

Tomorrow we want to support Gemini CLI, Codex CLI, and other LLM development tools. Each has its own CLI interface, auth model, and output format. We need an abstraction layer.

## 2. Vision: AgentRunner Interface

A common interface that all LLM CLI runners implement:

```typescript
// src/sessions/jorchbot/agent-runner.ts

export interface AgentRunnerEvents {
  text: [text: string];
  toolUse: [request: { toolName: string; toolInput: Record<string, unknown> }];
  result: [result: RunnerResult];
  error: [error: Error];
}

export interface RunnerResult {
  sessionId: string;
  textContent: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
}

export interface StartOptions {
  prompt: string;
  cwd: string;
  systemPrompt?: string;
  allowedTools?: string[];
}

export interface ResumeOptions {
  prompt: string;
  cwd?: string;
}

export interface AgentRunner extends EventEmitter<AgentRunnerEvents> {
  /** Unique runner type identifier (e.g., "claude", "gemini", "codex") */
  readonly type: string;

  /** Start a new session */
  start(options: StartOptions): Promise<RunnerResult>;

  /** Resume an existing session */
  resume(options: ResumeOptions): Promise<RunnerResult>;

  /** Stop the runner */
  stop(): Promise<void>;

  /** Get the current session ID (null if not started) */
  getSessionId(): string | null;

  /** Get runner status */
  getStatus(): "idle" | "running" | "stopped" | "error";

  /** Get context window usage as percentage (0-100) */
  getContextPercent(): number;

  /**
   * Whether this runner supports tool approval.
   * If true, the runner emits `toolApproval` events and expects
   * `resolveToolApproval()` calls in response.
   */
  readonly supportsToolApproval: boolean;

  /**
   * Resolve a pending tool approval.
   * Called by ApprovalManager after the user taps [Approve] or [Reject].
   * Each runner implementation translates this into its native mechanism.
   */
  resolveToolApproval?(
    approvalId: string,
    decision: { approved: boolean; reason?: string },
  ): Promise<void>;
}
```

## 3. Tool Approval Abstraction

### 3.1 The Problem

Each LLM CLI tool has a **different mechanism** for tool-level approval:

| Runner          | Mechanism        | How it works                                                                                                      |
| --------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Claude Code** | PreToolUse hooks | Hook script runs before each tool. Script calls gateway HTTP API, polls for decision, exits with allow/deny JSON. |
| **Gemini CLI**  | TBD              | May use stdin pipe, callback API, or its own hook system                                                          |
| **Codex CLI**   | TBD              | May use stdin pipe, callback API, or its own hook system                                                          |

But the **user-facing flow is always the same**: WhatsApp button → user taps Approve/Reject → runner gets the decision.

### 3.2 Two Separate Concerns

```
RUNNER-SPECIFIC (varies per implementation):
  How does the runner intercept tool calls?
  How does the runner receive approve/deny decisions?

JORCHBOT-SPECIFIC (same for all runners):
  Send WhatsApp buttons with tool info
  Wait for user to tap
  Route decision back to the correct session
```

### 3.3 Abstract Events

The `AgentRunner` interface uses events to decouple these concerns:

```typescript
export interface AgentRunnerEvents {
  // --- Existing events ---
  text: [text: string];
  toolUse: [request: { toolName: string; toolInput: Record<string, unknown> }];
  result: [result: RunnerResult];
  error: [error: Error];

  // --- Approval events (new) ---

  /** Emitted when a tool needs approval before execution */
  toolApproval: [request: ToolApprovalRequest];

  /** Emitted after a tool completes (success or failure) */
  toolResult: [result: ToolResultNotification];
}

export interface ToolApprovalRequest {
  /** Unique ID for this approval (used to resolve it later) */
  approvalId: string;
  /** Which session this belongs to */
  sessionId: string;
  /** Tool name (e.g., "Bash", "Edit", "Write") */
  toolName: string;
  /** Tool input (e.g., { command: "rm -rf node_modules" }) */
  toolInput: Record<string, unknown>;
}

export interface ToolResultNotification {
  toolName: string;
  toolInput: Record<string, unknown>;
  success: boolean;
  summary: string;
}
```

### 3.4 Flow Per Runner

**Claude Code (Phase 2):**

```
ClaudeRunner subprocess runs
  → Claude Code invokes PreToolUse hook script
    → Hook script POSTs to gateway HTTP API: /api/tool-approval
      → Gateway creates pending approval, sends WhatsApp buttons
      → Hook script polls GET /api/tool-approval/:id
        → User taps [Approve] on WhatsApp
          → Gateway resolves approval
            → Hook script receives "approved", exits with allow JSON
              → Claude Code proceeds with the tool
```

The `toolApproval` event is emitted by the gateway's HTTP handler (not by ClaudeRunner directly)
because the hook script communicates via HTTP, not via the subprocess stream.

**Future runner (stdin-based):**

```
FutureRunner subprocess runs
  → Runner outputs "tool_approval_needed" to stdout
    → FutureRunner parses it, emits `toolApproval` event
      → SessionManager/ApprovalManager sends WhatsApp buttons
        → User taps [Approve]
          → SessionManager calls runner.resolveToolApproval(id, { approved: true })
            → FutureRunner writes "approved" to subprocess stdin
              → Runner proceeds with the tool
```

### 3.5 What This Means for Phase 2

In Phase 2, the hook-based approval (Sub-phase 2H) is **Claude Code specific**. The HTTP API
endpoints (`/api/tool-approval`) and hook scripts (`src/hooks/tool-approval.ts`) are
ClaudeRunner implementation details.

When we abstract to `AgentRunner` in Phase 8, the approval flow moves:

- Hook scripts stay in ClaudeRunner's implementation
- The `toolApproval` event + `resolveToolApproval()` method become the universal interface
- New runners implement their own interception mechanism internally
- ApprovalManager only talks to the abstract interface, not to HTTP endpoints

### 3.6 Runners Without Tool Approval

Some runners may not support tool approval (e.g., a runner in full-auto mode, or a simple
script executor). The `supportsToolApproval` flag on the interface handles this:

```typescript
if (runner.supportsToolApproval) {
  runner.on("toolApproval", (request) => {
    // Send WhatsApp buttons, wait for response
  });
} else {
  // Runner auto-approves everything, just log tool use
}
```

## 4. Implementations

### 4.1 ClaudeRunner (Phase 1-2, exists today)

- **Auth**: Host's Claude subscription (no API key needed)
- **CLI**: `claude -p --output-format stream-json`
- **Resume**: `--resume <session_id>`
- **Headless**: `--dangerously-skip-permissions`
- **Context tracking**: Calculated from `usage.input_tokens` in result events
- **Tool approval mechanism**: PreToolUse hooks
  - Hook scripts live in `src/hooks/tool-approval.ts` (compiled to `dist/hooks/`)
  - Configured via `.claude/settings.local.json` in each workspace
  - Hook script → HTTP POST to gateway `/api/tool-approval` → poll until resolved
  - Read-only tools (`Read`, `Glob`, `Grep`) pass without approval
  - Write tools (`Bash`, `Edit`, `Write`, `NotebookEdit`) require approval
  - `resolveToolApproval()` updates the pending approval status in gateway API
- **Tool result notification**: PostToolUse / PostToolUseFailure hooks
  - Same hook script detects success vs failure via `tool_error` field
  - Fire-and-forget POST to `/api/tool-result`

### 4.2 GeminiRunner (future)

- **Auth**: `GEMINI_API_KEY` or Google Cloud auth
- **CLI**: `gemini-code` (or whatever Google ships)
- **Resume**: TBD (depends on Gemini CLI interface)
- **Tool approval mechanism**: TBD — options:
  - If Gemini CLI supports hooks similar to Claude Code → same pattern
  - If stdin-based → parse stdout for approval requests, write decisions to stdin
  - If API callback → register webhook with runner process
- **Tool result notification**: TBD

### 4.3 CodexRunner (future)

- **Auth**: OpenAI API key or subscription
- **CLI**: `codex` CLI
- **Resume**: TBD
- **Tool approval mechanism**: TBD — Codex currently uses `--full-auto` flag or
  interactive approval via stdin. JorchBot would need to:
  - Parse approval prompts from Codex stdout
  - Pipe approve/deny decisions via stdin
  - This maps to the `resolveToolApproval()` method writing to subprocess stdin
- **Tool result notification**: Parse from Codex stdout stream

## 4. What OpenClaw Already Has (reuse where possible)

### 4.1 Session Transcripts (JSONL)

OpenClaw stores conversation transcripts in JSONL at:

```
~/.jorchbot/agents/{agentId}/sessions/{sessionKey}.jsonl
```

When we register each JorchBot session as an OpenClaw agent (Sub-phase 2J), we should write
ClaudeRunner's conversation output to this JSONL format. This gives us:

- Transcripts visible in Control UI
- Compatible with OpenClaw's `sessions.compact` RPC
- Compatible with OpenClaw's memory system (indexing transcripts)

### 4.2 Skills

OpenClaw has a Skills system where `SKILL.md` files provide natural-language guidance injected
into the agent's prompt. The Jorchfile's `instructions` field maps directly to this:

```
Jorchfile:
  PROJECT frontend
    instructions = Expert in React/Next.js. Use App Router.

→ Generates:
  ~/.jorchbot/agents/frontend/skills/jorchfile/SKILL.md
```

This integration belongs in Phase 3 (Jorchfile Engine).

### 4.3 Identity (IDENTITY.md)

Each OpenClaw agent has an `IDENTITY.md` that describes who the agent is. For JorchBot:

```markdown
# frontend

Project: frontend
Path: ~/projects/my-app/frontend
Runner: claude (ClaudeRunner)
Created: 2026-02-19
```

This is written during agent registration (Sub-phase 2J).

### 4.4 Write Locking & Queue Management

OpenClaw has `acquireSessionWriteLock` to prevent concurrent modifications to the same session.
This becomes relevant when we have the abstract `AgentRunner` interface and potentially multiple
runners that need coordination. For now, SessionManager handles this implicitly (one runner per
session, sequential message processing).

## 5. What We Do NOT Reuse

### 5.1 Pi Agent RPC

OpenClaw's Pi Agent communicates via WebSocket RPC to LLM APIs using API keys. This is
fundamentally different from JorchBot's model (CLI subprocess using host subscription).

The `AgentRunner` interface replaces Pi Agent RPC for JorchBot's use case.

### 5.2 Auth Profiles

OpenClaw manages API keys per agent (`auth-profiles.json`). JorchBot's ClaudeRunner uses the
host's Claude subscription. Future runners (Gemini, Codex) may need API keys, which would use
a different auth model (env vars or JorchBot config, not OpenClaw's auth profiles).

## 6. Migration Path

### Phase 2 (current)

- `ClaudeRunner` is concrete, not abstracted
- `SessionManager` manages ClaudeRunner instances directly
- This is fine — premature abstraction would add complexity without value

### Phase 2J (agent registration) — IMPLEMENTED

- `src/sessions/jorchbot/agent-registration.ts` bridges Layer 2 (SessionManager) with Layer 1 (OpenClaw agents)
- `registerAgent()` creates `~/.jorchbot/agents/{project}/agent/` + `sessions/` dirs, writes IDENTITY.md, adds to `jorchbot.json` agents.list
- `unregisterAgent()` removes config entry but preserves directories (transcripts/history)
- Atomic writes via temp file + rename to prevent corruption
- Wired into SessionManager: `create()` calls `registerAgent`, `destroy()` calls `unregisterAgent` (both best-effort)
- OpenClaw's Zod schemas (`AgentConfigSchema`) use `Type.Object` (TypeBox), but JorchBot's agent-registration uses plain JSON since it only needs to write `id/name/workspace/agentDir` entries — no need to import OpenClaw's TypeBox schemas

### Phase 3 (Jorchfile)

- `instructions` field generates Skills (SKILL.md)
- Skills injected via `--append-system-prompt` in ClaudeRunner

### Phase 8 (Multi-LLM)

- Extract `AgentRunner` interface from ClaudeRunner
- ClaudeRunner implements AgentRunner
- Add GeminiRunner, CodexRunner implementations
- SessionManager accepts `AgentRunner` instead of `ClaudeRunner`
- Config per session: `runner: "claude" | "gemini" | "codex"`
- Reuse OpenClaw's write locking for concurrent runner coordination

## 7. SessionManager Evolution

```
Phase 2 (now):
  SessionManager → ClaudeRunner (direct)

Phase 8 (future):
  SessionManager → AgentRunner (interface)
                     ├── ClaudeRunner
                     ├── GeminiRunner
                     └── CodexRunner
```

The `createRunner` factory pattern already in SessionManager's deps makes this transition easy:

```typescript
// Phase 2 (now)
createRunner: () => new ClaudeRunner();

// Phase 8 (future)
createRunner: (type: string) => {
  switch (type) {
    case "claude":
      return new ClaudeRunner();
    case "gemini":
      return new GeminiRunner();
    case "codex":
      return new CodexRunner();
  }
};
```
