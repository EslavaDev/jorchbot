# Phase 2 — Multi-Session Workspaces

> **Status**: Pending
> **Dependency**: Phase 1 (completed)
> **Deliverable**: Multiple Claude Code sessions + direct shell + focus model
> **When finished**: You can run `/new frontend`, `/new backend`, switch between them, execute shell commands, and approve background session actions — all from a single WhatsApp thread

---

## 1. WHY — Why this phase

Phase 1 delivered the core loop: one WhatsApp thread talking to one Claude Code instance. But real development involves multiple projects simultaneously — a frontend, a backend, a mobile app. With only one session, you must stop one to work on another.

This phase converts the single-session model into a **multi-session workspace system** where:

- Each project gets its own Claude Code session (its own `ClaudeRunner` process)
- A **Focus Model** determines which session receives free-text messages
- Background sessions can still request approvals and report errors
- Direct shell commands (`$ git status`) execute without consuming Claude tokens
- All sessions persist across gateway restarts

**What is built**:

1. **SessionManager** — creates/destroys sessions, manages ClaudeRunner instances per session
2. **Focus Model** — routes messages to the focused session, buffers background output
3. **ShellRunner** — executes direct `$` commands in the workspace directory
4. **Shell shortcuts** — `/ls`, `/cat`, `/grep`, `/pwd`, `/git`, `/tree`
5. **Session commands** — `/new`, `/switch`, `/list`, `/stop`, `/logs`, `/compact`
6. **Multi-session approval routing** — approve background session actions without switching focus
7. **Message logging** — per-session message history in DB

**What is NOT built** (later phases):

- Jorchfile engine (Phase 3)
- Automatic tunnels (Phase 4)
- "Yes + feedback", plan/auto/silent modes, Kapso lists (Phase 5)
- `/replay`, `/history` commands (Phase 5)
- Telegram channel (Phase 7)

---

## 2. WHAT — What is delivered

### 2.1 SessionManager (`src/sessions/jorchbot/manager.ts`)

The SessionManager is the central orchestrator for multi-session. It uses a **hybrid architecture**:

- **Layer 1 (reuse)**: Registers each session as an OpenClaw agent in `~/.jorchbot/jorchbot.json` (under the `agents` key) so it appears in the Control UI. Creates agent directory structure (`~/.jorchbot/agents/{project}/`) with IDENTITY.md and transcript directories.
- **Layer 2 (new)**: Manages `ClaudeRunner` instances directly, since OpenClaw has no concept of Claude Code as a subprocess. Config for sessions (maxConcurrent, shellTimeout) lives under `jorchbot.sessions` in the same `jorchbot.json` file (see section 3.6)

> **Architecture Note (rev. 4 — 2026-02-19)**: The original research (section 17) recommended
> reusing OpenClaw's multi-agent RPC (`agents.create/update/delete`) directly. After analysis,
> this was deemed impractical because Pi Agent RPC operates via API keys → LLM APIs, while
> ClaudeRunner uses the host's Claude subscription as a subprocess. The runtime lifecycle is
> fundamentally different. Instead, SessionManager is custom Layer 2 code that **registers**
> sessions as OpenClaw agents (for Control UI visibility, transcripts, and identity) while
> managing ClaudeRunner processes directly. The `ClaudeRunner` interface is designed to be
> abstracted into a generic `AgentRunner` in Phase 8 (Multi-LLM) to support Gemini, Codex, etc.
> See `docs/future_agent_runner.md` for the full abstraction roadmap.

**Responsibilities**:

- Create sessions: spawn ClaudeRunner + write DB + register as OpenClaw agent
- Destroy sessions: stop ClaudeRunner + update DB + unregister agent
- List sessions: combine agent config with JorchBot DB state
- Restore sessions on gateway restart (re-read DB, reconnect to existing Claude Code sessions)
- Enforce max concurrent sessions limit (default: 5, configurable)
- Delegate focus management to FocusModel

### 2.2 Focus Model (`src/sessions/jorchbot/focus-model.ts`)

The Focus Model solves the single-threaded WhatsApp problem: multiple sessions must communicate through one chat thread.

**Rules**:

- Exactly ONE session is focused at any time
- Free-text messages go to the focused session's ClaudeRunner
- `$` commands execute in the focused session's workspace directory
- Background sessions only send messages to the chat for critical events
- The first session created is automatically focused
- `/switch <project>` changes focus

**Background notification rules**:

| Event in background | Sent to WP? | Format                                           |
| ------------------- | ----------- | ------------------------------------------------ |
| Approval needed     | YES         | `[backend] Needs approval: ... [Yes] [No]`       |
| Task completed      | YES         | `[backend] Completed. X files modified.`         |
| Error               | YES         | `[backend] Error: ...`                           |
| Context 70%         | YES         | `[backend] Context at 70%`                       |
| Context 90%         | YES         | `[backend] Context at 90%. Use /compact backend` |
| Normal output       | NO (logged) | Only visible via `/logs backend`                 |

### 2.3 ShellRunner (`src/sessions/jorchbot/shell-runner.ts`)

Direct shell execution from WhatsApp, bypassing Claude Code entirely (no token consumption).

**Trigger**: Messages prefixed with `$` (e.g., `$ git status`)

**Features**:

- Executes in the focused session's workspace directory
- Captures stdout + stderr
- Configurable timeout (default: 30s)
- Dangerous command detection with approval buttons
- Output chunked if > 4096 chars (WhatsApp limit)

**Dangerous commands** (trigger approval buttons):

- `rm -rf`, `rm -r` (recursive delete)
- `sudo`, `su` (privilege escalation)
- `shutdown`, `reboot` (system commands)
- `kill -9` (force kill)
- `chmod 777` (insecure permissions)
- `DROP TABLE`, `DELETE FROM` (SQL destructive)
- `git push --force`, `git reset --hard` (destructive git)

### 2.4 Shell Shortcuts

Convenience commands that map to shell executions:

| Shortcut                 | Executes                    | Notes                          |
| ------------------------ | --------------------------- | ------------------------------ |
| `/ls [path]`             | `ls -la [path]`             | Default: workspace root        |
| `/cat <file>`            | `cat <file>`                | Chunked if output > 4096 chars |
| `/grep <pattern> [path]` | `grep -rn <pattern> [path]` | Default path: workspace root   |
| `/pwd`                   | `pwd`                       | Shows workspace directory      |
| `/git <args>`            | `git <args>`                | Any git command                |
| `/tree [depth]`          | `tree -L [depth]`           | Default depth: 3               |

### 2.5 Session Commands

| Command                 | Action                                                  |
| ----------------------- | ------------------------------------------------------- |
| `/new <project> [path]` | Create workspace with Claude Code session               |
| `/switch <project>`     | Change focused session                                  |
| `/list`                 | List all sessions with status, context %, focus         |
| `/stop <project>`       | Stop session (kill ClaudeRunner, keep in DB as stopped) |
| `/logs <project> [n]`   | Show last N messages (default: 20)                      |
| `/compact <project>`    | Compact Claude Code context (re-start with summary)     |

### 2.6 Tool Approval via Claude Code Hooks

> **IMPORTANT (rev. 3 — 2026-02-19)**: The Phase 1 approach of writing "yes"/"no" to Claude Code's
> stdin does NOT work. Claude Code hangs in headless mode (piped stdin) before emitting any events.
> `--dangerously-skip-permissions` is required for headless operation.
>
> This section replaces the stdin-based approval flow with **Claude Code's `PreToolUse` hooks**,
> which provide real tool-level approval while working with `--dangerously-skip-permissions`.

#### 2.6.1 Architecture: PreToolUse Hook → WhatsApp Approval

Claude Code supports **hooks** — shell commands that execute before/after tool calls. A synchronous
`PreToolUse` hook **blocks Claude Code** until the hook process exits (up to 10 min configurable timeout).

**Flow**:

```
Claude Code (--dangerously-skip-permissions)
    │
    ▼ wants to use Edit on src/main.ts
PreToolUse hook fires
    │
    ▼ hook receives JSON on stdin:
    { "tool_name": "Edit", "tool_input": { "file_path": "src/main.ts", "old_string": "...", "new_string": "..." } }
    │
    ▼ hook script calls JorchBot gateway API:
    POST http://localhost:18789/api/tool-approval
    │
    ▼ gateway sends WhatsApp message via Kapso:
    "🔧 Edit: src/main.ts
     - const port = 3000;
     + const port = process.env.PORT ?? 3000;
     [Approve] [Reject] [Detail]"
    │
    ▼ hook blocks, polling gateway for approval decision
    │
    ▼ user taps [Approve] on WhatsApp
    │
    ▼ gateway stores decision
    │
    ▼ hook receives approval, exits with JSON:
    { "hookSpecificOutput": { "permissionDecision": "allow", "additionalContext": "Approved by user via WhatsApp" } }
    │
    ▼ Claude Code executes the Edit tool
```

#### 2.6.2 Hook Decisions (not just yes/no)

The `PreToolUse` hook can return rich decisions:

| Decision                   | Meaning                          | Use case                          |
| -------------------------- | -------------------------------- | --------------------------------- |
| `"allow"`                  | Execute the tool                 | User tapped Approve               |
| `"deny"` + reason          | Block tool, tell Claude why      | User tapped Reject                |
| `"allow"` + `updatedInput` | Execute with modified parameters | User approved but changed command |
| Exit code 2 + stderr       | Hard block with error message    | Security policy violation         |

The `additionalContext` field injects text into Claude's context after the decision. The `permissionDecisionReason` on deny tells Claude WHY the tool was blocked, so it can adjust.

#### 2.6.3 Hook Configuration

Generated at session creation time in `.claude/settings.local.json` of the workspace:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/jorchbot/dist/hooks/tool-approval.js",
            "timeout": 600,
            "statusMessage": "Waiting for WhatsApp approval..."
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash|Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/jorchbot/dist/hooks/tool-result.js",
            "async": true
          }
        ]
      }
    ],
    "PostToolUseFailure": [
      {
        "matcher": "Bash|Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/jorchbot/dist/hooks/tool-result.js",
            "async": true
          }
        ]
      }
    ]
  }
}
```

Read-only tools (`Read`, `Glob`, `Grep`, `WebSearch`) pass without approval. Only tools that modify state require approval.

> **Note**: `PostToolUseFailure` uses the same hook script as `PostToolUse`. The hook script receives `tool_error`
> in its stdin JSON, which it includes in the result summary sent to WhatsApp (e.g., "Bash failed: permission denied").

#### 2.6.4 Tool Approval Gateway Endpoints

New endpoints on the JorchBot gateway:

- `POST /api/tool-approval` — Hook calls this to request approval. Gateway sends WhatsApp buttons. Returns approval ID.
- `GET /api/tool-approval/:id` — Hook polls this for the decision. Returns `{ "status": "pending" | "approved" | "denied", "reason": "..." }`.
- `POST /api/tool-result` — PostToolUse hook calls this to report tool output. Gateway sends result summary to WhatsApp.

#### 2.6.5 WhatsApp UX for Tool Approval

The user sees the full context of what Claude wants to do:

```
🔧 Edit: src/auth/login.ts

- if (token) { return true; }
+ if (token && !isExpired(token)) { return true; }

[Approve ✅] [Reject ❌]
```

```
⚡ Bash: pnpm test -- src/auth/
> Run test suite for auth module

[Approve ✅] [Reject ❌]
```

For `PostToolUse`, the user gets result summaries (async, non-blocking):

```
✅ Edited src/auth/login.ts (1 change)
✅ Bash: 42 tests passed, 0 failed (3.2s)
```

#### 2.6.6 Multi-Session Approval Routing

With hooks, each session has its own hook configuration pointing to the same gateway. Multi-session routing:

- Every approval request carries `sessionId` in the gateway API call
- Background session messages include the project name: `[backend] 🔧 Edit: src/api/...`
- Responding to a background approval does NOT change the focused session
- ApprovalManager tracks pending approvals per session and resolves via the polling endpoint

#### 2.6.7 Timeout and Auto-Deny

If the user doesn't respond within the configured timeout (default: 10 minutes):

- The hook process is killed by Claude Code
- Claude receives a non-blocking error
- Claude can retry or ask the user what to do
- JorchBot sends a notification: "Tool approval timed out for [project]"

#### 2.6.8 Claude Code Hook Event Reference

Claude Code supports 14 hook event types. JorchBot uses a subset; the rest are documented here for future phases:

| Hook Event           | JorchBot Usage                                        | Phase   |
| -------------------- | ----------------------------------------------------- | ------- |
| `PreToolUse`         | **Tool approval** — blocks until WhatsApp approve     | Phase 2 |
| `PostToolUse`        | **Result reporting** — sends summary to chat          | Phase 2 |
| `PostToolUseFailure` | **Error reporting** — sends failure to chat           | Phase 2 |
| `Notification`       | Future: detect `idle_prompt` (Claude waiting)         | Phase 5 |
| `Stop`               | Future: detect questions via `last_assistant_message` | Phase 5 |
| `PreCompact`         | Future: notify user before auto-compaction            | Phase 5 |
| `SessionStart`       | Not needed (ClaudeRunner tracks lifecycle)            | —       |
| `SessionEnd`         | Not needed (ClaudeRunner tracks lifecycle)            | —       |
| `UserPromptSubmit`   | Not needed (JorchBot controls prompt injection)       | —       |
| `PermissionRequest`  | Does NOT fire in headless mode (`-p`)                 | —       |
| `SubagentStart`      | Not relevant (Claude's internal sub-agents)           | —       |
| `SubagentStop`       | Not relevant (Claude's internal sub-agents)           | —       |
| `TeammateIdle`       | Not relevant (multi-agent Claude feature)             | —       |
| `TaskCompleted`      | Not relevant (multi-agent Claude feature)             | —       |

**Key architectural note**: When Claude Code asks clarifying questions (assumptions, needs more context, etc.),
there is NO dedicated hook event. Questions flow as regular text output through `ClaudeRunner.on("text")`, which
the gateway forwards to WhatsApp naturally. The `Stop` hook (available in future phases) could optionally detect
questions by inspecting `last_assistant_message`, but this is not required for the core flow.

**Important**: `PermissionRequest` hooks do NOT fire when using `--dangerously-skip-permissions` (required for
headless mode). Only `PreToolUse` hooks provide tool-level access control in headless mode.

### 2.7 Message Logging

All messages (inbound, outbound, system) are logged per-session in the `messages` table:

- Direction: inbound (user → JorchBot), outbound (JorchBot → user), system (internal events)
- Type: text, approval, command, error, notification, shell
- `/logs <project>` queries the DB and formats for WhatsApp
- Cleanup job purges old logs based on retention config

---

## 3. HOW — How it is implemented

### 3.1 Component Architecture

```
WhatsApp User
     │
     ▼ (webhook POST)
┌──────────────────────┐
│   Kapso Channel      │  extensions/kapso/  (Phase 1)
│   Plugin (Plugin SDK)│
└──────────┬───────────┘
           │ (normalized message)
           ▼
┌──────────────────────┐
│   Command Router     │  src/commands/router.ts  (extended)
│   - /new, /switch    │
│   - /list, /stop     │
│   - /logs, /compact  │
│   - /ls, /cat, etc.  │
│   - $ prefix → shell │
│   - text → focused   │
└──────────┬───────────┘
           │
     ┌─────┼─────────────┐
     ▼     ▼             ▼
┌─────────┐ ┌──────────┐ ┌──────────────┐
│ Session │ │  Focus   │ │   Shell      │
│ Manager │ │  Model   │ │   Runner     │
│         │ │          │ │ (direct exec)│
└────┬────┘ └──────────┘ └──────────────┘
     │
     ├──────────────┬──────────────┐
     ▼              ▼              ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│ Claude   │  │ Claude   │  │ Claude   │
│ Runner   │  │ Runner   │  │ Runner   │
│ frontend │  │ backend  │  │ mobile   │
└──────────┘  └──────────┘  └──────────┘
```

### 3.2 SessionManager — Detail

#### 3.2.1 Hybrid architecture: Agent config + direct lifecycle

When a session is created, SessionManager:

1. **Writes an agent entry** to `~/.jorchbot/jorchbot.json` (the gateway's JSON5 config). This makes the session visible to OpenClaw's agent system (Control UI, `agents.list` RPC, tool policy inheritance).
2. **Creates a ClaudeRunner instance** and stores it in an in-memory `Map<string, ClaudeRunner>`.
3. **Inserts a row** in the JorchBot `sessions` table with focus state, context %, modes, and other metadata that OpenClaw doesn't track.

When a session is destroyed, SessionManager reverses the process: kills ClaudeRunner, removes the agent entry from config, and updates the DB row status to `"stopped"`.

#### 3.2.2 Types and schemas

```typescript
// src/sessions/jorchbot/manager.ts
import { z } from "zod";

// --- Zod schemas for runtime validation (data crossing trust boundaries) ---

/** Validated input for creating a new session */
export const CreateSessionInputSchema = z.object({
  project: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, {
      message: "Project name must be alphanumeric with hyphens/underscores only",
    }),
  path: z.string().min(1),
  systemPrompt: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
});

export type CreateSessionInput = z.infer<typeof CreateSessionInputSchema>;

// --- TypeScript interfaces for internal data shapes ---

/** In-memory representation of an active session */
interface ActiveSession {
  id: string;
  project: string;
  path: string;
  runner: ClaudeRunner;
  approval: ApprovalManager;
}

/** Session data as stored in DB (returned by list/get operations) */
interface SessionRecord {
  id: string;
  project: string;
  path: string;
  claudeSessionId: string | null;
  mode: "confirm" | "plan" | "auto";
  outputMode: "verbose" | "summary" | "silent";
  contextPercent: number;
  status: "active" | "stopped" | "error" | "paused";
  focused: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

#### 3.2.3 Implementation

```typescript
// src/sessions/jorchbot/manager.ts
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../../db/index.js";
import { sessions } from "../../db/schema.js";
import { ClaudeRunner } from "./claude-runner.js";
import { ApprovalManager } from "./approval-manager.js";
import { FocusModel } from "./focus-model.js";
import {
  SessionCreateError,
  SessionNotFoundError,
  SessionLimitError,
  SessionAlreadyExistsError,
  SessionDestroyError,
} from "../../errors/index.js";
import type { CreateSessionInput } from "./manager.js";

const DEFAULT_MAX_SESSIONS = 5;

export class SessionManager {
  private active = new Map<string, ActiveSession>();
  private focusModel: FocusModel;
  private maxSessions: number;
  private sendReply: (text: string) => Promise<void>;
  private sendButtons: (
    text: string,
    buttons: Array<{ id: string; title: string }>,
  ) => Promise<void>;

  constructor(deps: {
    maxSessions?: number;
    sendReply: (text: string) => Promise<void>;
    sendButtons: (text: string, buttons: Array<{ id: string; title: string }>) => Promise<void>;
  }) {
    this.maxSessions = deps.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.sendReply = deps.sendReply;
    this.sendButtons = deps.sendButtons;
    this.focusModel = new FocusModel();
  }

  /**
   * Create a new session for a project.
   *
   * 1. Validates input
   * 2. Checks session limit and duplicate project names
   * 3. Creates DB record
   * 4. Registers agent in gateway config (~/.jorchbot/jorchbot.json)
   * 5. Spawns ClaudeRunner
   * 6. Sets focus if this is the first session
   *
   * @throws {SessionLimitError} If max concurrent sessions reached
   * @throws {SessionAlreadyExistsError} If a session with this project name exists
   * @throws {SessionCreateError} If DB insert or agent registration fails
   */
  async create(input: CreateSessionInput): Promise<SessionRecord> {
    // Check limits
    const activeCount = this.active.size;
    if (activeCount >= this.maxSessions) {
      throw new SessionLimitError(
        `Cannot create session: limit of ${this.maxSessions} concurrent sessions reached`,
      );
    }

    // Check duplicate
    if (this.active.has(input.project)) {
      throw new SessionAlreadyExistsError(
        `Session "${input.project}" already exists. Use /switch ${input.project} instead.`,
      );
    }

    const id = randomUUID();
    const now = new Date();
    const isFirst = this.active.size === 0;

    try {
      // 1. Insert DB record
      const db = getDb();
      db.insert(sessions)
        .values({
          id,
          project: input.project,
          path: input.path,
          mode: "confirm",
          outputMode: "verbose",
          contextPercent: 0,
          status: "active",
          focused: isFirst,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      // 2. Register agent in gateway config
      await this.registerAgent(input.project, input.path);

      // 3. Create ClaudeRunner + ApprovalManager
      const runner = new ClaudeRunner();
      const approval = new ApprovalManager({
        claudeRunner: runner,
        sessionId: id,
        sendButtons: async (text, buttons) => {
          // Prefix with project name for multi-session context
          const prefix = isFirst ? "" : ` (background)`;
          await this.sendButtons(`[${input.project}]${prefix} ${text}`, buttons);
        },
      });

      // Wire runner events to message logging and notifications
      this.wireRunnerEvents(runner, id, input.project);

      // 4. Store in active sessions
      this.active.set(input.project, {
        id,
        project: input.project,
        path: input.path,
        runner,
        approval,
      });

      // 5. Set focus
      if (isFirst) {
        this.focusModel.setFocused(input.project);
      }

      return this.getSessionRecord(id);
    } catch (err: unknown) {
      // Rollback DB on failure
      const db = getDb();
      db.delete(sessions).where(eq(sessions.id, id)).run();
      throw new SessionCreateError(`Failed to create session "${input.project}"`, { cause: err });
    }
  }

  /**
   * Destroy a session by project name.
   *
   * @throws {SessionNotFoundError} If no session with this project exists
   * @throws {SessionDestroyError} If cleanup fails
   */
  async destroy(project: string): Promise<void> {
    const session = this.active.get(project);
    if (!session) {
      throw new SessionNotFoundError(
        `No active session named "${project}". Use /list to see sessions.`,
      );
    }

    try {
      // 1. Stop ClaudeRunner
      await session.runner.stop();

      // 2. Update DB status
      const db = getDb();
      db.update(sessions)
        .set({ status: "stopped", updatedAt: new Date() })
        .where(eq(sessions.id, session.id))
        .run();

      // 3. Unregister agent from gateway config
      await this.unregisterAgent(project);

      // 4. Remove from active map
      this.active.delete(project);

      // 5. If this was the focused session, focus the next one
      if (this.focusModel.getFocused() === project) {
        const next = this.active.keys().next().value;
        if (next) {
          await this.focusModel.setFocused(next);
          this.updateFocusInDb(next);
        } else {
          this.focusModel.clearFocus();
        }
      }
    } catch (err: unknown) {
      throw new SessionDestroyError(`Failed to destroy session "${project}"`, { cause: err });
    }
  }

  /**
   * Switch focus to a different session.
   *
   * @throws {SessionNotFoundError} If no session with this project exists
   */
  async switchFocus(project: string): Promise<void> {
    if (!this.active.has(project)) {
      throw new SessionNotFoundError(
        `No active session named "${project}". Use /list to see sessions.`,
      );
    }

    const previousFocused = this.focusModel.getFocused();
    if (previousFocused) {
      this.updateFocusInDb(previousFocused, false);
    }

    this.focusModel.setFocused(project);
    this.updateFocusInDb(project, true);
  }

  /** List all sessions from DB (includes stopped sessions). */
  list(): SessionRecord[] {
    const db = getDb();
    return db.select().from(sessions).all() as SessionRecord[];
  }

  /** List only active sessions. */
  listActive(): SessionRecord[] {
    const db = getDb();
    return db.select().from(sessions).where(eq(sessions.status, "active")).all() as SessionRecord[];
  }

  /** Get the currently focused session, or null. */
  getFocused(): ActiveSession | null {
    const focusedProject = this.focusModel.getFocused();
    if (!focusedProject) return null;
    return this.active.get(focusedProject) ?? null;
  }

  /** Get an active session by project name, or null. */
  getByProject(project: string): ActiveSession | null {
    return this.active.get(project) ?? null;
  }

  /** Resolve an approval by its ID, routing to the correct session. */
  async resolveApproval(approvalId: string, approved: boolean): Promise<boolean> {
    for (const session of this.active.values()) {
      const resolved = await session.approval.resolveApproval(approvalId, approved);
      if (resolved) return true;
    }
    return false;
  }

  /**
   * Restore sessions from DB on gateway restart.
   * Only restores sessions with status "active".
   * ClaudeRunners are recreated but not resumed (user must send a message to resume).
   */
  async restore(): Promise<number> {
    const db = getDb();
    const activeSessions = db.select().from(sessions).where(eq(sessions.status, "active")).all();

    let restored = 0;
    for (const record of activeSessions) {
      const runner = new ClaudeRunner();
      const approval = new ApprovalManager({
        claudeRunner: runner,
        sessionId: record.id,
        sendButtons: this.sendButtons,
      });

      this.wireRunnerEvents(runner, record.id, record.project);

      this.active.set(record.project, {
        id: record.id,
        project: record.project,
        path: record.path,
        runner,
        approval,
      });

      if (record.focused) {
        this.focusModel.setFocused(record.project);
      }

      restored++;
    }

    return restored;
  }

  // --- Private helpers ---

  private async registerAgent(project: string, workspacePath: string): Promise<void> {
    // TODO: Implementation reads ~/.jorchbot/jorchbot.json (JSON5),
    // adds an agent entry under agents.list[project] = { workspace: workspacePath },
    // and writes back atomically.
    // Uses OpenClaw's config IO utilities (src/config/io.ts) for safe writes.
  }

  private async unregisterAgent(project: string): Promise<void> {
    // TODO: Removes agents.list[project] from ~/.jorchbot/jorchbot.json
  }

  private wireRunnerEvents(runner: ClaudeRunner, sessionId: string, project: string): void {
    runner.on("text", (text) => {
      this.logMessage(sessionId, "outbound", "text", text);

      // Only send to WP if this is the focused session
      if (this.focusModel.getFocused() === project) {
        void this.sendReply(`[${project}] ${text}`);
      }
    });

    // NOTE: With --dangerously-skip-permissions + PreToolUse hooks (section 2.6),
    // tool approval is handled externally by the hook script → gateway HTTP API flow.
    // The "toolUse" event here is for informational logging only.
    // Actual approval buttons are sent by the gateway when the hook script calls
    // POST /api/tool-approval. See sub-phase 2H for implementation details.
    runner.on("toolUse", (request) => {
      this.logMessage(sessionId, "system", "approval", `Tool: ${request.toolName}`);
    });

    runner.on("result", (result) => {
      // Update context % in DB
      const db = getDb();
      const contextPercent = runner.getContextPercent();
      db.update(sessions)
        .set({
          claudeSessionId: result.sessionId,
          contextPercent,
          updatedAt: new Date(),
        })
        .where(eq(sessions.id, sessionId))
        .run();

      // Notify
      const isFocused = this.focusModel.getFocused() === project;
      const suffix = isFocused ? "" : " (background)";
      void this.sendReply(`[${project}]${suffix} Completed. Context: ${contextPercent}%`);

      // Context warnings
      if (contextPercent >= 90) {
        void this.sendReply(`[${project}] Context at ${contextPercent}%. Use /compact ${project}`);
      } else if (contextPercent >= 70) {
        void this.sendReply(`[${project}] Context at ${contextPercent}%`);
      }
    });

    runner.on("error", (err) => {
      this.logMessage(sessionId, "system", "error", err.message);
      void this.sendReply(`[${project}] Error: ${err.message}`);
    });
  }

  private logMessage(
    sessionId: string,
    direction: "inbound" | "outbound" | "system",
    type: "text" | "approval" | "command" | "error" | "notification" | "shell",
    content: string,
  ): void {
    const db = getDb();
    db.insert(/* messages table */)
      .values({
        sessionId,
        direction,
        type,
        content,
        createdAt: new Date(),
      })
      .run();
  }

  private getSessionRecord(id: string): SessionRecord {
    const db = getDb();
    const record = db.select().from(sessions).where(eq(sessions.id, id)).get();
    if (!record) {
      throw new SessionNotFoundError(`Session ${id} not found in DB`);
    }
    return record as SessionRecord;
  }

  private updateFocusInDb(project: string, focused = true): void {
    const session = this.active.get(project);
    if (!session) return;
    const db = getDb();
    if (!focused) {
      db.update(sessions)
        .set({ focused: false, updatedAt: new Date() })
        .where(eq(sessions.id, session.id))
        .run();
    } else {
      // First unfocus all, then focus the target
      db.update(sessions).set({ focused: false, updatedAt: new Date() }).run();
      db.update(sessions)
        .set({ focused: true, updatedAt: new Date() })
        .where(eq(sessions.id, session.id))
        .run();
    }
  }
}
```

### 3.3 FocusModel — Detail

The FocusModel is intentionally simple: a single string tracking which project is focused. The complexity lives in how SessionManager and CommandRouter use it.

```typescript
// src/sessions/jorchbot/focus-model.ts

/**
 * Focus Model — tracks which session is "focused" in single-threaded chat.
 *
 * 100% JorchBot-specific (Layer 2). OpenClaw has NO concept of a focused
 * session because each channel has its own independent conversation.
 *
 * WhatsApp is single-threaded: all sessions share one chat. The Focus Model
 * determines which session receives free-text messages and $ commands.
 *
 * State is kept in-memory (source of truth) and mirrored to DB (persistence).
 */
export class FocusModel {
  private focusedProject: string | null = null;

  /** Get the currently focused project name, or null if none. */
  getFocused(): string | null {
    return this.focusedProject;
  }

  /** Set the focused project. */
  setFocused(project: string): void {
    this.focusedProject = project;
  }

  /** Clear focus (no session focused). */
  clearFocus(): void {
    this.focusedProject = null;
  }

  /** Check if a specific project is focused. */
  isFocused(project: string): boolean {
    return this.focusedProject === project;
  }
}
```

### 3.4 ShellRunner — Detail

```typescript
// src/sessions/jorchbot/shell-runner.ts
import { exec } from "node:child_process";
import {
  ShellRunnerExecError,
  ShellRunnerTimeoutError,
  ShellRunnerDangerousCommandError,
} from "../../errors/index.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_LENGTH = 4096; // WhatsApp message limit

/**
 * Patterns that indicate dangerous commands.
 * Each pattern is tested against the full command string.
 */
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[^\s]*r|-[^\s]*f|--recursive|--force)/, reason: "recursive/force delete" },
  { pattern: /\bsudo\b/, reason: "privilege escalation" },
  { pattern: /\bsu\b/, reason: "privilege escalation" },
  { pattern: /\bshutdown\b/, reason: "system shutdown" },
  { pattern: /\breboot\b/, reason: "system reboot" },
  { pattern: /\bkill\s+-9\b/, reason: "force kill" },
  { pattern: /\bchmod\s+777\b/, reason: "insecure permissions" },
  { pattern: /\bDROP\s+TABLE\b/i, reason: "SQL destructive" },
  { pattern: /\bDELETE\s+FROM\b/i, reason: "SQL destructive" },
  { pattern: /\bgit\s+push\s+--force\b/, reason: "force push" },
  { pattern: /\bgit\s+reset\s+--hard\b/, reason: "destructive reset" },
];

interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated: boolean;
}

interface DangerousCommandCheck {
  isDangerous: boolean;
  reason?: string;
}

/**
 * Executes shell commands directly in a workspace directory.
 *
 * This is JorchBot-specific (Layer 2). Does NOT use Claude Code and
 * does NOT consume tokens. Commands prefixed with $ in WhatsApp are
 * routed here.
 *
 * @throws {ShellRunnerExecError} If command execution fails
 * @throws {ShellRunnerTimeoutError} If command exceeds timeout
 */
export class ShellRunner {
  /**
   * Check if a command is dangerous.
   * Does NOT throw — returns a result object.
   */
  checkDangerous(command: string): DangerousCommandCheck {
    for (const { pattern, reason } of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        return { isDangerous: true, reason };
      }
    }
    return { isDangerous: false };
  }

  /**
   * Execute a shell command in the given working directory.
   *
   * @throws {ShellRunnerExecError} If exec() fails
   * @throws {ShellRunnerTimeoutError} If timeout is exceeded
   */
  async execute(
    command: string,
    cwd: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<ShellResult> {
    return new Promise<ShellResult>((resolve, reject) => {
      exec(
        command,
        {
          cwd,
          timeout: timeoutMs,
          maxBuffer: 1024 * 1024, // 1MB
          env: { ...process.env },
        },
        (error, stdout, stderr) => {
          if (error) {
            if (error.killed) {
              reject(
                new ShellRunnerTimeoutError(`Command timed out after ${timeoutMs}ms: ${command}`, {
                  cause: error,
                }),
              );
              return;
            }

            // Non-zero exit code is not necessarily an error for shell commands
            // (e.g., grep returns 1 when no matches found)
            resolve({
              stdout: this.truncate(stdout),
              stderr: this.truncate(stderr),
              exitCode: error.code ?? 1,
              truncated: stdout.length > MAX_OUTPUT_LENGTH || stderr.length > MAX_OUTPUT_LENGTH,
            });
            return;
          }

          resolve({
            stdout: this.truncate(stdout),
            stderr: this.truncate(stderr),
            exitCode: 0,
            truncated: stdout.length > MAX_OUTPUT_LENGTH || stderr.length > MAX_OUTPUT_LENGTH,
          });
        },
      );
    });
  }

  private truncate(text: string): string {
    if (text.length <= MAX_OUTPUT_LENGTH) return text;
    return text.slice(0, MAX_OUTPUT_LENGTH - 20) + "\n... (truncated)";
  }
}
```

### 3.5 CommandRouter — Extended for Multi-Session

The Phase 1 CommandRouter is extended with new command handlers and input modes:

```typescript
// src/commands/router.ts (extended for Phase 2)

type RouteResult =
  | { type: "command"; command: string; args: string[] }
  | { type: "shell"; command: string }
  | { type: "prompt"; text: string }
  | { type: "error"; message: string };

interface CommandRouterDeps {
  sessionManager: SessionManager;
  shellRunner: ShellRunner;
  sendReply: (text: string) => Promise<void>;
  sendButtons: (text: string, buttons: Array<{ id: string; title: string }>) => Promise<void>;
}

export class CommandRouter {
  private deps: CommandRouterDeps;

  constructor(deps: CommandRouterDeps) {
    this.deps = deps;
  }

  async route(message: IncomingMessage): Promise<void> {
    const parsed = this.parse(message.text);

    switch (parsed.type) {
      case "command":
        await this.handleCommand(parsed.command, parsed.args);
        break;
      case "shell":
        await this.handleShell(parsed.command);
        break;
      case "prompt":
        await this.handlePrompt(parsed.text);
        break;
      case "error":
        await this.deps.sendReply(parsed.message);
        break;
    }
  }

  private parse(text: string): RouteResult {
    const trimmed = text.trim();

    // $ prefix → shell command
    if (trimmed.startsWith("$")) {
      const command = trimmed.slice(1).trim();
      if (!command) {
        return { type: "error", message: "Empty shell command. Usage: $ <command>" };
      }
      return { type: "shell", command };
    }

    // / prefix → built-in command
    if (trimmed.startsWith("/")) {
      const parts = trimmed.slice(1).split(/\s+/);
      const command = parts[0]?.toLowerCase() ?? "";
      const args = parts.slice(1);
      return { type: "command", command, args };
    }

    // Free text → prompt to focused session
    const focused = this.deps.sessionManager.getFocused();
    if (!focused) {
      return {
        type: "error",
        message: "No active session. Use /new <project> <path> to create one.",
      };
    }

    return { type: "prompt", text: trimmed };
  }

  private async handleCommand(command: string, args: string[]): Promise<void> {
    switch (command) {
      // Session commands
      case "new":
        await this.handleNew(args);
        break;
      case "switch":
        await this.handleSwitch(args);
        break;
      case "list":
        await this.handleList();
        break;
      case "stop":
        await this.handleStop(args);
        break;
      case "logs":
        await this.handleLogs(args);
        break;
      case "compact":
        await this.handleCompact(args);
        break;

      // Shell shortcuts
      case "ls":
        await this.handleShell(`ls -la ${args.join(" ")}`.trim());
        break;
      case "cat":
        await this.handleShell(`cat ${args.join(" ")}`.trim());
        break;
      case "grep":
        await this.handleShell(`grep -rn ${args.join(" ")}`.trim());
        break;
      case "pwd":
        await this.handleShell("pwd");
        break;
      case "git":
        await this.handleShell(`git ${args.join(" ")}`.trim());
        break;
      case "tree":
        await this.handleShell(`tree -L ${args[0] ?? "3"}`.trim());
        break;

      // Phase 1 commands
      case "help":
        await this.handleHelp();
        break;
      case "status":
        await this.handleStatus();
        break;

      default:
        await this.deps.sendReply(
          `Unknown command: /${command}\nUse /help to see available commands.`,
        );
    }
  }

  private async handleNew(args: string[]): Promise<void> {
    const [project, ...pathParts] = args;
    if (!project) {
      await this.deps.sendReply("Usage: /new <project> <path>");
      return;
    }

    const projectPath = pathParts.join(" ") || process.cwd();

    try {
      const session = await this.deps.sessionManager.create({
        project,
        path: projectPath,
      });

      await this.deps.sendReply(
        [
          `[${project}] Session created`,
          `Path: ${session.path}`,
          `Mode: ${session.mode}+${session.outputMode}`,
          `Context: ${session.contextPercent}%`,
        ].join("\n"),
      );
    } catch (err: unknown) {
      await this.deps.sendReply(
        `Failed to create session: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async handleSwitch(args: string[]): Promise<void> {
    const [project] = args;
    if (!project) {
      await this.deps.sendReply("Usage: /switch <project>");
      return;
    }

    try {
      await this.deps.sessionManager.switchFocus(project);
      const session = this.deps.sessionManager.getByProject(project);
      const contextPercent = session?.runner.getContextPercent() ?? 0;
      await this.deps.sendReply(`[${project}] Session focused\nContext: ${contextPercent}%`);
    } catch (err: unknown) {
      await this.deps.sendReply(
        `Failed to switch: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async handleList(): Promise<void> {
    const activeSessions = this.deps.sessionManager.listActive();

    if (activeSessions.length === 0) {
      await this.deps.sendReply("No active sessions. Use /new <project> <path> to create one.");
      return;
    }

    const lines = ["*Active sessions:*", ""];
    for (const session of activeSessions) {
      const icon = session.focused ? "●" : "○";
      const tag = session.focused ? "(focused)" : "(background)";
      lines.push(
        `${icon} ${session.project} ${tag} - Context: ${session.contextPercent}% - Mode: ${session.mode}+${session.outputMode}`,
      );
    }

    await this.deps.sendReply(lines.join("\n"));
  }

  private async handleStop(args: string[]): Promise<void> {
    const [project] = args;
    if (!project) {
      await this.deps.sendReply("Usage: /stop <project>");
      return;
    }

    try {
      await this.deps.sessionManager.destroy(project);
      await this.deps.sendReply(`[${project}] Session stopped.`);
    } catch (err: unknown) {
      await this.deps.sendReply(
        `Failed to stop: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async handleLogs(args: string[]): Promise<void> {
    const [project, countStr] = args;
    if (!project) {
      await this.deps.sendReply("Usage: /logs <project> [count]");
      return;
    }

    const count = countStr ? Number.parseInt(countStr, 10) : 20;
    // Query messages table for this session, ordered by createdAt DESC, limit count
    // Format and send as chunked messages
    // Implementation detail: see section 3.7
  }

  private async handleCompact(args: string[]): Promise<void> {
    const [project] = args;
    if (!project) {
      await this.deps.sendReply("Usage: /compact <project>");
      return;
    }

    const session = this.deps.sessionManager.getByProject(project);
    if (!session) {
      await this.deps.sendReply(`No active session named "${project}".`);
      return;
    }

    // Compact = stop current runner and start fresh with a summary prompt
    await this.deps.sendReply(`[${project}] Compacting context...`);

    try {
      const previousContext = session.runner.getContextPercent();
      await session.runner.stop();

      // Start a new runner with a compact prompt
      const result = await session.runner.start({
        prompt:
          "Continue from where you left off. Summarize what was done so far and ask what to do next.",
        cwd: session.path,
      });

      const newContext = session.runner.getContextPercent();
      await this.deps.sendReply(`[${project}] Compacted: ${previousContext}% → ${newContext}%`);
    } catch (err: unknown) {
      await this.deps.sendReply(
        `[${project}] Compact failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async handleShell(command: string): Promise<void> {
    const focused = this.deps.sessionManager.getFocused();
    if (!focused) {
      await this.deps.sendReply("No active session. Use /new <project> <path> first.");
      return;
    }

    // Check for dangerous commands
    const check = this.deps.shellRunner.checkDangerous(command);
    if (check.isDangerous) {
      // Send approval buttons (same pattern as ClaudeRunner approvals)
      await this.deps.sendButtons(
        `[${focused.project}] Dangerous command detected (${check.reason}):\n> ${command}`,
        [
          {
            id: JSON.stringify({ type: "shell_approve", command, project: focused.project }),
            title: "Yes",
          },
          {
            id: JSON.stringify({ type: "shell_reject", command, project: focused.project }),
            title: "No",
          },
        ],
      );
      return;
    }

    await this.executeShell(command, focused);
  }

  private async executeShell(command: string, session: ActiveSession): Promise<void> {
    try {
      const result = await this.deps.shellRunner.execute(command, session.path);
      const output = result.stdout || result.stderr || "(no output)";
      const exitInfo = result.exitCode !== 0 ? `\nExit code: ${result.exitCode}` : "";
      const truncInfo = result.truncated ? "\n(output truncated)" : "";

      await this.deps.sendReply(
        `[${session.project}] $ ${command}\n${output}${exitInfo}${truncInfo}`,
      );
    } catch (err: unknown) {
      await this.deps.sendReply(
        `[${session.project}] Shell error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async handleHelp(): Promise<void> {
    const help = [
      "*JorchBot Commands:*",
      "",
      "*Sessions:*",
      "/new <project> <path> — Create a new session",
      "/switch <project> — Switch focused session",
      "/list — List all sessions",
      "/stop <project> — Stop a session",
      "/logs <project> [n] — Last n messages (default: 20)",
      "/compact <project> — Compact context window",
      "",
      "*Shell:*",
      "$ <command> — Execute shell command",
      "/ls [path] — List files",
      "/cat <file> — Read file",
      "/grep <pattern> [path] — Search in files",
      "/pwd — Current directory",
      "/git <args> — Git commands",
      "/tree [depth] — Directory tree",
      "",
      "*Other:*",
      "/help — This help",
      "/status — Gateway status",
      "",
      "Free text → sent to focused Claude Code session",
    ].join("\n");

    await this.deps.sendReply(help);
  }

  private async handleStatus(): Promise<void> {
    // Extended for multi-session
    const activeSessions = this.deps.sessionManager.listActive();
    const focused = this.deps.sessionManager.getFocused();

    const lines = ["*JorchBot Status*", ""];

    if (activeSessions.length === 0) {
      lines.push("No active sessions.");
    } else {
      lines.push(`Sessions: ${activeSessions.length} active`);
      if (focused) {
        lines.push(`Focused: ${focused.project} (${focused.runner.getContextPercent()}%)`);
      }
    }

    await this.deps.sendReply(lines.join("\n"));
  }

  private async handlePrompt(text: string): Promise<void> {
    const focused = this.deps.sessionManager.getFocused();
    if (!focused) {
      await this.deps.sendReply("No active session. Use /new <project> <path> to create one.");
      return;
    }

    try {
      const runner = focused.runner;
      if (runner.getSessionId()) {
        await runner.resume({ prompt: text, cwd: focused.path });
      } else {
        await runner.start({ prompt: text, cwd: focused.path });
      }
    } catch (err: unknown) {
      await this.deps.sendReply(
        `[${focused.project}] Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
```

### 3.6 Config Consolidation + Session Schema

#### 3.6.1 Problem: two config files

Before Phase 2, JorchBot maintained **two separate config files**:

- `~/.jorchbot/jorchbot.json` — Layer 1 (OpenClaw) gateway config, JSON5, validated by TypeBox
- `~/.jorchbot/config.json` — Layer 2 (JorchBot) config, plain JSON, validated by Zod

This creates unnecessary maintenance burden. Phase 2 consolidates both into a **single file**: `~/.jorchbot/jorchbot.json`.

#### 3.6.2 Solution: `jorchbot` namespace key

JorchBot-specific settings live under a `jorchbot` top-level key in `~/.jorchbot/jorchbot.json`. This avoids collisions with OpenClaw's own keys (`gateway`, `agents`, `channels`, `models`, etc.):

```json5
// ~/.jorchbot/jorchbot.json (single config file)
{
  // Layer 1 (OpenClaw) sections — validated by TypeBox
  gateway: { port: 18789 },
  agents: {
    /* ... */
  },
  channels: {
    /* ... */
  },

  // Layer 2 (JorchBot) section — validated by Zod
  jorchbot: {
    db: {
      path: "~/.jorchbot/jorchbot.db",
      logRetentionDays: 7,
      summaryRetentionDays: 30,
      errorRetentionDays: 90,
      maxSizeMb: 500,
    },
    channels: {
      kapso: {
        enabled: false,
        apiKey: "",
        phoneNumberId: "",
        webhookVerifyToken: "",
        webhookSecret: "",
        dmPolicy: "pairing",
        allowFrom: [],
      },
      telegram: {
        enabled: false,
        botToken: "",
      },
    },
    tunnels: {
      defaultMode: "serve",
      tailscale: { enabled: true },
    },
    approvals: {
      timeoutMinutes: 10,
      pauseTimeoutMinutes: 60,
    },
    sessions: {
      maxConcurrent: 5,
      shellTimeout: 30000,
    },
  },
}
```

#### 3.6.3 Updated Zod schema

```typescript
// src/config/jorchbot-config.ts

// NEW: sessions schema for Phase 2
const SessionsSchema = z.object({
  maxConcurrent: z.number().int().min(1).max(20).default(5),
  shellTimeout: z.number().int().min(1000).default(30_000),
});

export const JorchBotConfigSchema = z.object({
  db: DbSchema.default(DbSchema.parse({})),
  channels: ChannelsSchema.default(ChannelsSchema.parse({})),
  tunnels: TunnelsSchema.default(TunnelsSchema.parse({})),
  approvals: ApprovalsSchema.default(ApprovalsSchema.parse({})),
  sessions: SessionsSchema.default(SessionsSchema.parse({})), // NEW
});
```

Note: `gateway` is removed from JorchBotConfigSchema — it's already managed by Layer 1's config. No duplication.

#### 3.6.4 Updated config loader

The loader changes from reading `~/.jorchbot/config.json` to reading the `jorchbot` key from `~/.jorchbot/jorchbot.json`:

```typescript
// src/config/jorchbot-config-loader.ts
import JSON5 from "json5";
import { resolveConfigPath } from "./paths.js";
import { JorchBotConfigSchema } from "./jorchbot-config.js";
import type { JorchBotConfig } from "./jorchbot-config.js";
import {
  JorchBotConfigNotFoundError,
  JorchBotConfigParseError,
  JorchBotConfigValidationError,
} from "../errors/index.js";

/**
 * Load JorchBot config from the `jorchbot` key in ~/.jorchbot/jorchbot.json.
 *
 * If the file exists but has no `jorchbot` key, returns defaults.
 * If the file doesn't exist, throws (Layer 1 should have created it).
 *
 * @throws {JorchBotConfigNotFoundError} If jorchbot.json doesn't exist
 * @throws {JorchBotConfigParseError} If JSON5 parsing fails
 * @throws {JorchBotConfigValidationError} If Zod validation fails
 */
export function loadConfig(): JorchBotConfig {
  const configPath = resolveConfigPath();

  let raw: string;
  try {
    raw = readFileSync(configPath, "utf-8");
  } catch (err: unknown) {
    throw new JorchBotConfigNotFoundError(`Config file not found: ${configPath}`, { cause: err });
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON5.parse(raw) as Record<string, unknown>;
  } catch (err: unknown) {
    throw new JorchBotConfigParseError(`Failed to parse config as JSON5: ${configPath}`, {
      cause: err,
    });
  }

  // Extract the jorchbot namespace, default to empty object
  const jorchbotRaw = (parsed.jorchbot ?? {}) as Record<string, unknown>;

  const result = JorchBotConfigSchema.safeParse(jorchbotRaw);
  if (!result.success) {
    throw new JorchBotConfigValidationError(
      `Invalid jorchbot config in ${configPath}: ${result.error.message}`,
      { cause: result.error },
    );
  }

  return result.data;
}
```

#### 3.6.5 Migration path

For users upgrading from Phase 1 (separate `config.json`):

1. On first load, if `jorchbot.json` has no `jorchbot` key but `config.json` exists, the loader reads from `config.json` as fallback
2. On first successful write, the `jorchbot` key is written to `jorchbot.json` and `config.json` is deleted
3. After migration, only `jorchbot.json` is used

This migration is transparent — no user action required.

### 3.7 Message Logging and /logs

```typescript
// Query for /logs <project> [n]
import { eq, desc } from "drizzle-orm";
import { messages, sessions } from "../../db/schema.js";

function getSessionLogs(project: string, limit: number): string[] {
  const db = getDb();

  // Find session ID by project name
  const session = db.select().from(sessions).where(eq(sessions.project, project)).get();

  if (!session) return [];

  const rows = db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, session.id))
    .orderBy(desc(messages.createdAt))
    .limit(limit)
    .all();

  // Reverse to show oldest first
  return rows.reverse().map((row) => {
    const dir = row.direction === "inbound" ? "→" : "←";
    return `${dir} [${row.type}] ${row.content}`;
  });
}
```

---

## 4. Errors

### 4.1 New error classes for Phase 2

Add to `src/errors/index.ts`:

```typescript
// --- Session errors ---

/** Failed to create a session (DB, config, or runner failure) */
export class SessionCreateError extends JorchBotError {}

/** Session not found by project name or ID */
export class SessionNotFoundError extends JorchBotError {}

/** Maximum concurrent sessions limit reached */
export class SessionLimitError extends JorchBotError {}

/** Session with this project name already exists */
export class SessionAlreadyExistsError extends JorchBotError {}

/** Failed to destroy a session cleanly */
export class SessionDestroyError extends JorchBotError {}

// --- Shell errors ---

/** Shell command execution failed */
export class ShellRunnerExecError extends JorchBotError {}

/** Shell command timed out */
export class ShellRunnerTimeoutError extends JorchBotError {}

/** Dangerous shell command detected (used internally, not thrown to user) */
export class ShellRunnerDangerousCommandError extends JorchBotError {}
```

### 4.2 Error map

| Error                       | When                                             | Action                          |
| --------------------------- | ------------------------------------------------ | ------------------------------- |
| `SessionCreateError`        | DB insert, config write, or runner spawn fails   | Send error to chat, rollback DB |
| `SessionNotFoundError`      | `/switch`, `/stop`, `/logs` with unknown project | Send error message with hint    |
| `SessionLimitError`         | `/new` when max sessions reached                 | Send limit message              |
| `SessionAlreadyExistsError` | `/new` with duplicate name                       | Suggest `/switch` instead       |
| `SessionDestroyError`       | `/stop` cleanup fails                            | Send error, force cleanup       |
| `ShellRunnerExecError`      | `exec()` fails                                   | Send error to chat              |
| `ShellRunnerTimeoutError`   | Command exceeds timeout                          | Send timeout message            |

---

## 5. Design Decisions

### 5.1 Why hybrid architecture (agent config + direct lifecycle)

The research doc recommends reusing OpenClaw's multi-agent system. However, the RPC methods (`agents.create`, `agents.list`) are designed for external WebSocket clients, not in-process calls. Since JorchBot runs inside the gateway:

- **Agent config registration**: Sessions are written to `~/.jorchbot/jorchbot.json` under `agents.list`. This makes them visible in OpenClaw's Control UI, inherits tool policies, and follows the established agent pattern. **This is the reuse part.**
- **Direct ClaudeRunner management**: OpenClaw has no concept of Claude Code as a subprocess. ClaudeRunner lifecycle (spawn, resume, stop) is managed directly by SessionManager. **This is the new part.**
- **JorchBot DB for extra state**: Focus model, context %, output modes — none of these exist in OpenClaw's agent system.

This approach reuses 70% of OpenClaw (agent config format, tool policies, Control UI visibility) while only building the 30% that's new (ClaudeRunner lifecycle, Focus Model).

### 5.2 Why FocusModel is separate from SessionManager

Single Responsibility: SessionManager handles CRUD and lifecycle. FocusModel handles routing logic. They communicate via method calls, not shared state. This makes each independently testable.

### 5.3 Why ShellRunner uses child_process.exec directly

OpenClaw has a sophisticated `BashProcessRegistry` with PTY support, background jobs, and security policies. However, ShellRunner's use case is simpler:

- One-shot commands (not interactive sessions)
- No PTY needed (WhatsApp can't render terminal UIs)
- No background job management (output goes straight to chat)
- Security handled by JorchBot's own dangerous command detection

Using `child_process.exec` directly keeps ShellRunner simple and decoupled from OpenClaw internals. If a future phase needs OpenClaw's exec tool features, ShellRunner can be extended.

### 5.4 Why /compact restarts instead of using sessions.compact RPC

OpenClaw's `sessions.compact` operates on OpenClaw's JSONL session transcripts, not on Claude Code's internal session state. Since ClaudeRunner manages its own session via `--resume`, the compact operation must:

1. Stop the current ClaudeRunner
2. Start a new one with a summary prompt (Claude Code reads its own session history)

This is semantically equivalent to what `sessions.compact` does, but operates at the Claude Code level.

### 5.5 Why consolidate config into one file

Before Phase 2, JorchBot maintained two config files:

- `~/.jorchbot/jorchbot.json` — Layer 1 (OpenClaw), JSON5, TypeBox validation
- `~/.jorchbot/config.json` — Layer 2 (JorchBot), plain JSON, Zod validation

Problems with two files:

- Users must edit two files to configure JorchBot
- Gateway and DB settings live in different places
- No single source of truth for "JorchBot configuration"
- Two different parsers (JSON vs JSON5) for the same directory

Solution: JorchBot-specific config moves under a `jorchbot` namespace key in `jorchbot.json`. Benefits:

- **One file** — users edit `jorchbot.json` for everything
- **No collisions** — `jorchbot` key won't clash with OpenClaw's top-level keys (`gateway`, `agents`, etc.)
- **JSON5 everywhere** — comments and trailing commas in config
- **Each layer validates its own section** — TypeBox for Layer 1, Zod for `jorchbot` key

### 5.6 Dangerous command detection: approval buttons

Chosen over blocking because:

- Consistent UX with ClaudeRunner approvals (same [Yes]/[No] pattern)
- User might legitimately want to run `rm -rf node_modules`
- Blocking would be frustrating for power users
- The approval pattern is already implemented and tested in Phase 1

---

## 6. Testing

### 6.1 Strategy

- **Unit tests**: Each module tested in isolation with mocks
- **Integration tests**: End-to-end multi-session flow with mocked ClaudeRunner and DB
- **No live tests**: No real Claude Code or Kapso API calls in CI
- **Test isolation**: `JORCHBOT_DB_PATH` and `JORCHBOT_CONFIG_DIR` env vars for temp dirs

### 6.2 Tests by module

#### SessionManager (`src/sessions/jorchbot/manager.test.ts`)

```typescript
describe("SessionManager", () => {
  describe("create()", () => {
    it("creates a session with DB record and runner", async () => {
      const manager = createTestManager();
      const session = await manager.create({ project: "frontend", path: "/tmp/frontend" });

      expect(session.project).toBe("frontend");
      expect(session.status).toBe("active");
      expect(session.focused).toBe(true); // First session is auto-focused
      expect(session.contextPercent).toBe(0);
    });

    it("auto-focuses the first session created", async () => {
      const manager = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" });

      const focused = manager.getFocused();
      expect(focused).not.toBeNull();
      expect(focused!.project).toBe("frontend");
    });

    it("does not change focus when creating subsequent sessions", async () => {
      const manager = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" });
      await manager.create({ project: "backend", path: "/tmp/backend" });

      expect(manager.getFocused()!.project).toBe("frontend");
    });

    it("throws SessionLimitError when max sessions reached", async () => {
      const manager = createTestManager({ maxSessions: 2 });
      await manager.create({ project: "a", path: "/tmp/a" });
      await manager.create({ project: "b", path: "/tmp/b" });

      await expect(manager.create({ project: "c", path: "/tmp/c" })).rejects.toThrow(
        SessionLimitError,
      );
    });

    it("throws SessionAlreadyExistsError for duplicate project names", async () => {
      const manager = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" });

      await expect(manager.create({ project: "frontend", path: "/tmp/other" })).rejects.toThrow(
        SessionAlreadyExistsError,
      );
    });

    it("validates project name format", async () => {
      const manager = createTestManager();

      await expect(manager.create({ project: "bad project!", path: "/tmp/x" })).rejects.toThrow(); // Zod validation
    });

    it("rolls back DB on runner creation failure", async () => {
      // Mock ClaudeRunner constructor to throw
      // Assert sessions table has no new rows
    });
  });

  describe("destroy()", () => {
    it("stops runner and updates DB status to stopped", async () => {
      const manager = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" });
      await manager.destroy("frontend");

      const sessions = manager.list();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].status).toBe("stopped");
    });

    it("auto-focuses next session when focused session is destroyed", async () => {
      const manager = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" });
      await manager.create({ project: "backend", path: "/tmp/backend" });
      await manager.destroy("frontend");

      expect(manager.getFocused()!.project).toBe("backend");
    });

    it("clears focus when last session is destroyed", async () => {
      const manager = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" });
      await manager.destroy("frontend");

      expect(manager.getFocused()).toBeNull();
    });

    it("throws SessionNotFoundError for unknown project", async () => {
      const manager = createTestManager();

      await expect(manager.destroy("nonexistent")).rejects.toThrow(SessionNotFoundError);
    });
  });

  describe("switchFocus()", () => {
    it("changes the focused session", async () => {
      const manager = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" });
      await manager.create({ project: "backend", path: "/tmp/backend" });

      await manager.switchFocus("backend");
      expect(manager.getFocused()!.project).toBe("backend");
    });

    it("updates focused flag in DB", async () => {
      const manager = createTestManager();
      await manager.create({ project: "frontend", path: "/tmp/frontend" });
      await manager.create({ project: "backend", path: "/tmp/backend" });

      await manager.switchFocus("backend");

      const records = manager.list().filter((s) => s.status === "active");
      const frontend = records.find((s) => s.project === "frontend");
      const backend = records.find((s) => s.project === "backend");
      expect(frontend!.focused).toBe(false);
      expect(backend!.focused).toBe(true);
    });

    it("throws SessionNotFoundError for unknown project", async () => {
      const manager = createTestManager();
      await expect(manager.switchFocus("nonexistent")).rejects.toThrow(SessionNotFoundError);
    });
  });

  describe("restore()", () => {
    it("restores active sessions from DB", async () => {
      // Create sessions, then create a new manager and call restore()
      // Assert runners are recreated and focus is restored
    });

    it("skips stopped sessions", async () => {
      // Create and stop a session, then restore
      // Assert stopped session is not in active map
    });
  });

  describe("resolveApproval()", () => {
    it("routes approval to the correct session", async () => {
      // Create two sessions, trigger approval on backend
      // Resolve with the approval ID
      // Assert backend's ClaudeRunner received the approval
    });

    it("returns false for unknown approval IDs", async () => {
      const manager = createTestManager();
      const result = await manager.resolveApproval("nonexistent", true);
      expect(result).toBe(false);
    });
  });
});
```

#### FocusModel (`src/sessions/jorchbot/focus-model.test.ts`)

```typescript
describe("FocusModel", () => {
  it("starts with no focus", () => {
    const model = new FocusModel();
    expect(model.getFocused()).toBeNull();
  });

  it("sets and gets focus", () => {
    const model = new FocusModel();
    model.setFocused("frontend");
    expect(model.getFocused()).toBe("frontend");
  });

  it("clears focus", () => {
    const model = new FocusModel();
    model.setFocused("frontend");
    model.clearFocus();
    expect(model.getFocused()).toBeNull();
  });

  it("isFocused returns correct value", () => {
    const model = new FocusModel();
    model.setFocused("frontend");
    expect(model.isFocused("frontend")).toBe(true);
    expect(model.isFocused("backend")).toBe(false);
  });

  it("switching focus replaces the previous", () => {
    const model = new FocusModel();
    model.setFocused("frontend");
    model.setFocused("backend");
    expect(model.getFocused()).toBe("backend");
    expect(model.isFocused("frontend")).toBe(false);
  });
});
```

#### ShellRunner (`src/sessions/jorchbot/shell-runner.test.ts`)

```typescript
describe("ShellRunner", () => {
  describe("checkDangerous()", () => {
    it("detects rm -rf as dangerous", () => {
      const runner = new ShellRunner();
      const check = runner.checkDangerous("rm -rf node_modules");
      expect(check.isDangerous).toBe(true);
      expect(check.reason).toBe("recursive/force delete");
    });

    it("detects sudo as dangerous", () => {
      const runner = new ShellRunner();
      const check = runner.checkDangerous("sudo apt install nginx");
      expect(check.isDangerous).toBe(true);
    });

    it("detects git push --force as dangerous", () => {
      const runner = new ShellRunner();
      const check = runner.checkDangerous("git push --force origin main");
      expect(check.isDangerous).toBe(true);
    });

    it("allows safe commands", () => {
      const runner = new ShellRunner();
      expect(runner.checkDangerous("ls -la").isDangerous).toBe(false);
      expect(runner.checkDangerous("git status").isDangerous).toBe(false);
      expect(runner.checkDangerous("npm test").isDangerous).toBe(false);
      expect(runner.checkDangerous("cat README.md").isDangerous).toBe(false);
    });
  });

  describe("execute()", () => {
    it("executes a command and returns output", async () => {
      const runner = new ShellRunner();
      const result = await runner.execute("echo hello", "/tmp");
      expect(result.stdout.trim()).toBe("hello");
      expect(result.exitCode).toBe(0);
    });

    it("captures stderr", async () => {
      const runner = new ShellRunner();
      const result = await runner.execute("echo error >&2", "/tmp");
      expect(result.stderr.trim()).toBe("error");
    });

    it("returns non-zero exit code without throwing", async () => {
      const runner = new ShellRunner();
      const result = await runner.execute("exit 42", "/tmp");
      expect(result.exitCode).toBe(42);
    });

    it("truncates output exceeding WhatsApp limit", async () => {
      const runner = new ShellRunner();
      // Generate output > 4096 chars
      const result = await runner.execute("python3 -c \"print('x' * 5000)\"", "/tmp");
      expect(result.truncated).toBe(true);
      expect(result.stdout.length).toBeLessThanOrEqual(4096);
    });

    it("throws ShellRunnerTimeoutError on timeout", async () => {
      const runner = new ShellRunner();
      await expect(runner.execute("sleep 10", "/tmp", 100)).rejects.toThrow(
        ShellRunnerTimeoutError,
      );
    });

    it("uses provided cwd", async () => {
      const runner = new ShellRunner();
      const result = await runner.execute("pwd", "/tmp");
      expect(result.stdout.trim()).toBe("/tmp");
    });
  });
});
```

#### CommandRouter (`src/commands/router.test.ts`)

```typescript
describe("CommandRouter (Phase 2)", () => {
  describe("routing", () => {
    it("routes $ prefix to shell execution", async () => {
      // $ git status → handleShell("git status")
    });

    it("routes / prefix to command handlers", async () => {
      // /new frontend /tmp → handleNew(["frontend", "/tmp"])
    });

    it("routes free text to focused session", async () => {
      // "fix the bug" → handlePrompt("fix the bug")
    });

    it("returns error when no focused session and free text sent", async () => {
      // No sessions → error message
    });
  });

  describe("/new", () => {
    it("creates a session and sends confirmation", async () => {});
    it("sends error on missing arguments", async () => {});
  });

  describe("/switch", () => {
    it("switches focus and confirms", async () => {});
    it("sends error for unknown project", async () => {});
  });

  describe("/list", () => {
    it("shows all sessions with focus indicator", async () => {});
    it("shows empty message when no sessions", async () => {});
  });

  describe("shell shortcuts", () => {
    it("/ls maps to ls -la", async () => {});
    it("/git maps to git command", async () => {});
    it("/pwd maps to pwd", async () => {});
  });

  describe("dangerous commands", () => {
    it("sends approval buttons for dangerous $ commands", async () => {});
    it("executes safe commands immediately", async () => {});
  });
});
```

### 6.3 Test count

| Module                             | Estimated tests |
| ---------------------------------- | --------------- |
| SessionManager                     | 15              |
| FocusModel                         | 5               |
| ShellRunner                        | 10              |
| CommandRouter (Phase 2 extensions) | 15              |
| Message logging                    | 5               |
| Config schema update               | 3               |
| Error classes                      | 3               |
| **Total**                          | **~56**         |

---

## 7. New/Modified Files

### 7.1 New files

| File                                         | Purpose                                                               | Est. LOC |
| -------------------------------------------- | --------------------------------------------------------------------- | -------- |
| `src/sessions/jorchbot/manager.ts`           | SessionManager (replaces placeholder)                                 | ~350     |
| `src/sessions/jorchbot/manager.test.ts`      | SessionManager tests                                                  | ~300     |
| `src/sessions/jorchbot/focus-model.ts`       | FocusModel (replaces placeholder)                                     | ~40      |
| `src/sessions/jorchbot/focus-model.test.ts`  | FocusModel tests                                                      | ~50      |
| `src/sessions/jorchbot/shell-runner.ts`      | ShellRunner (replaces placeholder)                                    | ~120     |
| `src/sessions/jorchbot/shell-runner.test.ts` | ShellRunner tests                                                     | ~120     |
| `src/hooks/tool-approval.ts`                 | PreToolUse hook script (calls gateway API)                            | ~80      |
| `src/hooks/tool-result.ts`                   | PostToolUse + PostToolUseFailure hook script (reports results/errors) | ~50      |
| `src/hooks/hook-config-generator.ts`         | Generates `.claude/settings.local.json` for hooks                     | ~60      |
| `src/hooks/tool-approval.test.ts`            | Hook script tests                                                     | ~80      |
| `src/gateway/approval-api.ts`                | Gateway HTTP endpoints for tool approval                              | ~100     |
| `src/gateway/approval-api.test.ts`           | Approval API tests                                                    | ~80      |

### 7.2 Modified files

| File                                        | Change                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| `src/errors/index.ts`                       | Add 7 new error classes (Session + Shell)                                    |
| `src/config/jorchbot-config.ts`             | Remove `gateway` schema (Layer 1 owns it), add `sessions` schema             |
| `src/config/jorchbot-config-loader.ts`      | Read from `jorchbot` key in `jorchbot.json` (JSON5), remove `config.json`    |
| `src/config/jorchbot-config.test.ts`        | Update tests for consolidated config + new sessions schema                   |
| `src/commands/router.ts`                    | Extend with multi-session commands, shell routing                            |
| `src/commands/router.test.ts`               | Extend with Phase 2 tests                                                    |
| `src/sessions/jorchbot/approval-manager.ts` | Rewrite: HTTP-based approval (gateway API) instead of stdin; per-session IDs |
| `src/gateway/jorchbot-start.ts`             | Wire SessionManager + ShellRunner + approval API + restore                   |

---

## 8. Acceptance Criteria (Definition of Done)

- [ ] Config consolidated: single `~/.jorchbot/jorchbot.json` file, `config.json` no longer needed
- [ ] JorchBot config lives under `jorchbot` key, validated by Zod
- [ ] Migration from old `config.json` is transparent (fallback read + delete)
- [ ] `/new frontend /path/to/frontend` creates a session with ClaudeRunner
- [ ] `/new backend /path/to/backend` creates a second session (first stays in background)
- [ ] `/switch frontend` changes the focused session
- [ ] Free text messages go to the focused session's ClaudeRunner
- [ ] `$ git status` executes in the focused session's workspace directory
- [ ] `$ rm -rf /` shows approval buttons, not executed directly
- [ ] `/ls src/` lists files in the focused session's workspace
- [ ] `/list` shows all sessions with focus indicator, context %, mode
- [ ] `/stop backend` stops the backend session's ClaudeRunner
- [ ] `/logs backend` shows message history for that session
- [ ] `/compact frontend` restarts ClaudeRunner with fresh context
- [ ] Background sessions send notifications for approvals, errors, completions
- [ ] Approving a background session action does NOT change focused session
- [ ] Sessions persist in DB and are restored on gateway restart
- [ ] `/help` shows all Phase 2 commands
- [ ] All unit tests pass (~56 tests)
- [ ] `pnpm check` passes (format + types + lint)
- [ ] No `any` in new JorchBot code

---

## 9. Limitations of this Phase

| Limitation                                                       | Phase that resolves it |
| ---------------------------------------------------------------- | ---------------------- |
| No Jorchfile (manual /new with path)                             | Phase 3                |
| No automatic tunnels                                             | Phase 4                |
| No "Yes + feedback" approvals (user can only allow/deny)         | Phase 5                |
| No plan/auto/silent modes                                        | Phase 5                |
| No Kapso lists (buttons only)                                    | Phase 5                |
| No /replay, /history commands                                    | Phase 5                |
| No Telegram                                                      | Phase 7                |
| No media support in shell output                                 | Later phase            |
| Agent registration is write-only (no config reload notification) | Phase 6                |

> **Note on tool approval**: Phase 1 uses a `REMOTE_SYSTEM_PROMPT` as an interim solution — it
> instructs Claude to describe its plan and wait for user confirmation before executing actions.
> This is conversational, not tool-level. Phase 2 replaces this with real tool-level approval via
> `PreToolUse` hooks (section 2.6), where each write/modify tool invocation is blocked until the
> user approves or rejects via WhatsApp buttons. The `--dangerously-skip-permissions` flag remains
> required for headless operation; the hooks provide the actual access control.

---

## 10. Implementation Notes

### 10.1 Recommended implementation order

1. **Errors** — add error classes to `src/errors/index.ts`
2. **Config consolidation** — merge Layer 2 config into `jorchbot.json` under `jorchbot` key, update loader to read JSON5, remove `config.json`, add `sessions` schema
3. **FocusModel** — simplest module, foundational for routing
4. **ShellRunner** — independent, no dependencies on SessionManager
5. **SessionManager** — the core orchestrator (depends on FocusModel)
6. **CommandRouter extensions** — wire everything together
7. **Message logging** — DB queries for /logs
8. **Tool approval hooks** — hook scripts, gateway API endpoints, hook config generator (see section 2.6)
9. **Gateway integration** — wire SessionManager into jorchbot-start.ts
10. **Agent config registration** — write/remove from jorchbot.json

### 10.2 Implementation risks

| Risk                                                               | Mitigation                                                             |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Agent config writes conflict with gateway config reload            | Use OpenClaw's config IO utilities with file locking                   |
| Multiple ClaudeRunner processes consume too much memory            | Enforce max sessions limit, monitor memory                             |
| Shell command injection via $ prefix                               | Only execute in workspace dir, never with shell expansion of user vars |
| Race conditions in focus switching during background notifications | FocusModel is synchronous, single-threaded Node.js                     |
| DB migration needed for sessions config schema change              | No migration needed — config schema is additive with defaults          |
| PreToolUse hook timeout kills Claude Code process                  | Configure generous timeout (10 min), auto-deny with notification       |
| Hook script crashes leave Claude Code blocked                      | Hook exit code 1 = non-blocking error; Claude retries or asks user     |
| Multiple sessions trigger concurrent approval requests             | Each approval gets unique ID; gateway tracks per-session pending list  |
