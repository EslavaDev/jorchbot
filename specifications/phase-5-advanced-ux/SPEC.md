# Phase 5 — Advanced UX

> **Status**: Pending
> **Dependency**: Phase 4 (completed)
> **Deliverable**: Approval modes (confirm/plan/auto), output filtering (verbose/summary/silent), `/mode` command, Yes+feedback approvals, smart chunking with document attachments, output buffering, approval timeouts with reminders
> **When finished**: `/mode auto` makes Claude execute without asking, `/mode plan` makes Claude plan first, `/mode silent` suppresses intermediate output, "Yes + feedback" lets you approve with instructions, long output (>12K chars) is sent as a document attachment, streaming output is batched every 3 seconds, and unanswered approvals get reminders

---

## 1. WHY — Why this phase

Phase 2 delivered multi-session workspaces and Phase 3+4 added Jorchfile commands and tunnels. But every tool call still requires manual approval via WhatsApp buttons, every text event floods the chat, and there's no way to say "just do it" or "plan first before touching anything."

Real remote development from WhatsApp requires **control over autonomy and verbosity**:

- When you're in a meeting, you want Claude to work autonomously and silently — `auto + silent`
- When exploring unfamiliar code, you want Claude to plan first — `plan + verbose`
- When reviewing a large test run, you don't want 50 messages — you want a single document attachment
- When approving a tool call, sometimes you want to say "yes, but use Zod instead of regex"
- When you forget to respond, you want a reminder — not a silently timed-out approval

This phase makes JorchBot **comfortable** to use from WhatsApp by giving the user control over how much autonomy Claude has, how much output they receive, and how they interact with approvals.

**What is built**:

1. **Approval modes** — `confirm` (default, current), `plan` (read-only until plan approved), `auto` (skip approvals)
2. **Output modes** — `verbose` (default, current), `summary` (start+end only), `silent` (approvals+result only)
3. **`/mode` command** — change modes in real-time without restarting sessions
4. **Jorchfile defaults** — `approve`/`output` fields per project are read on session creation
5. **Yes + feedback** — approve a tool call AND send instructions Claude will see
6. **Smart chunking** — numbered chunks, 3-chunk limit, document attachments for long output
7. **Output buffering** — batch streaming events every 3 seconds instead of per-event
8. **Approval timeout** — reminders after configurable time, auto-deny at hook timeout

**What is NOT built** (later phases / out of scope):

- Batch approvals for multiple tool calls (impossible: hooks are sequential, each tool blocks)
- Kapso lists for approval selection (tools fire one-at-a-time, no batch to select from)
- `/resume` command (unnecessary: user sends new message → Claude retries naturally)
- `/replay`, `/history` commands (deferred, low priority)
- Voice message approvals (Kapso doesn't support)
- WhatsApp reactions as shortcuts (Kapso doesn't support)

---

## 2. WHAT — What is delivered

### 2.1 Approval Modes (`src/sessions/jorchbot/approval-modes.ts`)

Each session has an approval mode that controls how much autonomy Claude Code has.

| Mode      | Hook behavior                            | Claude experience                                                       |
| --------- | ---------------------------------------- | ----------------------------------------------------------------------- |
| `confirm` | Hook requests gateway approval, polls    | Every write tool needs user approval via WhatsApp buttons (current)     |
| `plan`    | Hook denies write tools with plan reason | Claude sees denial reason, plans instead. User approves plan to execute |
| `auto`    | Hook auto-approves, returns immediately  | All tools auto-approved. No WhatsApp buttons sent. Maximum autonomy     |

**Key design decision**: All three modes work through the **existing hook system**. The PreToolUse hook calls the gateway, and the gateway decides based on the session's mode. No `--permission-mode` flag changes, no process restarts. The hook always fires (even with `--dangerously-skip-permissions`).

**Plan mode flow**:

```
1. User: /mode plan
2. Claude tries Edit tool → PreToolUse hook fires
3. Hook POSTs /api/tool-approval → gateway checks mode = "plan"
4. Gateway detects write tool (Edit/Write/Bash/NotebookEdit) → auto-denies
5. Hook returns: { permissionDecision: "deny", permissionDecisionReason: "..." }
6. Claude sees: "Plan mode active. Create a detailed plan before modifying files.
   The user will review your plan and switch to confirm mode for execution."
7. Claude generates plan as text output → sent to WhatsApp
8. User reads plan, does: /mode confirm
9. User: "execute the plan you just described"
10. Claude tries Edit → hook fires → normal approval flow (buttons)
```

**Auto mode flow**:

```
1. User: /mode auto
2. Claude tries Edit tool → PreToolUse hook fires
3. Hook POSTs /api/tool-approval → gateway checks mode = "auto"
4. Gateway auto-resolves as "approved" immediately (no buttons sent)
5. Hook polls → gets "approved" → returns { permissionDecision: "allow" }
6. Claude executes without user interaction
```

### 2.2 Output Modes (`src/sessions/jorchbot/output-filter.ts`)

Output modes control what the SessionManager sends to WhatsApp vs. what goes only to the DB log.

| Mode      | Sent to WhatsApp                             | Logged only (DB)   |
| --------- | -------------------------------------------- | ------------------ |
| `verbose` | Everything (text, tool use, results, errors) | Nothing extra      |
| `summary` | Session start, final result, errors          | Intermediate steps |
| `silent`  | Approval requests, final result              | Everything else    |

**Critical rule**: Approval requests and errors are ALWAYS sent to WhatsApp regardless of output mode. The user must always see things that require their attention.

Output filtering happens **in the SessionManager**, not in Claude Code. Claude always produces full output. The SessionManager's `wireRunnerEvents()` method checks the output mode before calling `sendReplyTo()`.

### 2.3 `/mode` Command

Registered in the CommandRouter as a Tier 1 built-in command.

```
/mode                    → Show current modes for focused session
/mode confirm            → Change focused session to confirm mode
/mode plan               → Change focused session to plan mode
/mode auto               → Change focused session to auto mode
/mode verbose            → Change focused session to verbose output
/mode summary            → Change focused session to summary output
/mode silent             → Change focused session to silent output
/mode auto frontend      → Change specific session to auto mode
/mode silent backend     → Change specific session to silent output
```

The command auto-detects whether the argument is an approval mode or output mode (the enum values are disjoint).

### 2.4 Jorchfile Defaults

When `/new <project>` creates a session, the SessionManager reads the Jorchfile's `approve` and `output` fields for that project and uses them as the initial mode/outputMode instead of hardcoding `confirm`/`verbose`.

```makefile
PROJECT frontend
  path = ~/projects/my-app/frontend
  approve = auto          # ← session created with mode=auto
  output = silent         # ← session created with outputMode=silent
```

If the fields are absent, defaults remain `confirm` + `verbose`.

### 2.5 Yes + Feedback

A third approval button that lets the user approve AND send instructions to Claude.

**Current buttons**: `[Yes] [No]`
**New buttons**: `[Yes] [Yes + feedback] [No]`

When the user taps "Yes + feedback":

```
1. Gateway marks approval as "awaiting_feedback"
2. JorchBot sends: "[frontend] Write your feedback for Claude:"
3. User types: "use zod instead of regex"
4. Gateway resolves approval as "approved" with additionalContext
5. Hook returns: { permissionDecision: "allow", additionalContext: "User feedback: use zod..." }
6. Claude sees the context and applies it
```

The `additionalContext` field in the hook's `hookSpecificOutput` is confirmed to be injected into Claude's context. Claude can read it and act on it.

### 2.6 Smart Chunking

Extends the existing `text-chunking.ts` with numbered chunks, a 3-chunk maximum, and document attachment fallback.

**Level 1 — Smart Split** (output <= 12K chars):

- Existing chunker (code fence preservation, newline/space breaks)
- NEW: Numbered chunks: `[frontend] (1/3)`, `[frontend] (2/3)`
- NEW: Maximum 3 chunks

**Level 2 — Truncate + Document** (output > 12K chars):

- Send first chunk as message
- Send full output as document attachment via Kapso `sendDocument()`
- `[frontend] Output too long (45KB). Summary above, full output attached.`

**Level 3 — Output mode filtering** (summary/silent):

- Only send result + errors to WhatsApp
- Everything else logged to DB (accessible via `/logs`)

Documents are served via a temporary gateway endpoint: `GET /api/documents/:id` (auto-expire after 1 hour).

### 2.7 Output Buffering

Batches streaming events from ClaudeRunner into 3-second windows instead of sending each event individually to WhatsApp.

- Buffer accumulates text events from ClaudeRunner
- Every 3 seconds, if the buffer has content, flush it as one WhatsApp message
- When the ClaudeRunner emits `result` or `error`, flush immediately
- Respects the 4096-char WhatsApp limit per flush
- Approval requests bypass the buffer and send immediately

### 2.8 Approval Timeout with Reminders

When an approval sits pending, the gateway sends reminders.

| Time elapsed                  | Action                                            |
| ----------------------------- | ------------------------------------------------- |
| Configurable (default 10 min) | Re-send approval buttons with "[Reminder]" prefix |
| 5 min (hook timeout)          | Hook auto-denies. Claude retries or asks user     |

**Note**: The hook has a hard 5-minute timeout (denies automatically). The gateway reminder fires before this. If the user responds to the reminder, the approval resolves normally. If not, the hook denies and Claude either retries the action (triggering a new approval) or asks the user what to do.

The gateway-side reminder timer is **independent** of the hook's polling. It's a simple `setTimeout` tracked per pending approval.

---

## 3. HOW — Implementation details

### 3.1 Approval Mode Enforcement in Gateway

The approval flow changes happen in the gateway's approval API (`src/gateway/approval-api.ts`), not in the hook script.

**New types** (`src/sessions/jorchbot/approval-modes.ts`):

```typescript
import type { ApprovalMode, OutputMode } from "./types.js";

/** Tools considered "write" operations that plan mode blocks. */
const WRITE_TOOLS = new Set(["Edit", "Write", "Bash", "NotebookEdit", "MultiEdit"]);

/** Tools considered "read-only" that plan mode allows. */
const READ_ONLY_TOOLS = new Set(["Read", "Grep", "Glob", "WebSearch", "WebFetch", "Task"]);

/**
 * Determine if a tool call should be auto-handled based on session mode.
 * Returns null if normal approval flow should proceed (confirm mode).
 */
export function resolveApprovalByMode(
  mode: ApprovalMode,
  toolName: string,
): { decision: "allow" | "deny"; reason?: string } | null {
  switch (mode) {
    case "auto":
      return { decision: "allow" };

    case "plan": {
      if (WRITE_TOOLS.has(toolName)) {
        return {
          decision: "deny",
          reason:
            "Plan mode is active. Create a detailed plan describing what " +
            "changes you will make and why, then present it to the user. " +
            "The user will review your plan and switch to confirm mode " +
            "for execution. Do NOT attempt to modify files until the user " +
            "approves your plan.",
        };
      }
      // Read-only tools pass through in plan mode
      return { decision: "allow" };
    }

    case "confirm":
      // Normal approval flow — hook sends buttons
      return null;
  }
}
```

**Modified approval API** (`src/gateway/approval-api.ts`):

The `POST /api/tool-approval` endpoint checks the session mode before creating a pending approval:

```typescript
// POST /api/tool-approval
router.post("/api/tool-approval", (req, res) => {
  const { sessionId, toolName, toolInput } = req.body;
  // ... validation ...

  const session = findSession(sessionId);
  if (!session) { res.status(404)...; return; }

  // Check mode-based auto-resolution
  const modeResult = resolveApprovalByMode(session.mode, toolName);
  if (modeResult !== null) {
    // Auto mode: return immediate approval
    // Plan mode + write tool: return immediate denial with reason
    // Plan mode + read tool: return immediate approval
    res.json({
      id: `auto_${Date.now()}`,
      autoResolved: true,
      status: modeResult.decision === "allow" ? "approved" : "denied",
      reason: modeResult.reason,
    });
    return;
  }

  // Confirm mode: create pending approval with buttons (existing flow)
  session.approval.requestApproval({ toolUseId, toolName, toolInput })...
});
```

**Modified hook** (`src/hooks/jorchbot/tool-approval.ts`):

The hook must handle the `autoResolved` response from the gateway:

```typescript
interface ApprovalResponse {
  id: string;
  autoResolved?: boolean;
  status?: "approved" | "denied";
  reason?: string;
}

// After requesting approval:
const data = (await resp.json()) as ApprovalResponse;

if (data.autoResolved) {
  // Mode-based auto-resolution — no polling needed
  if (data.status === "approved") {
    writeOutput({ permissionDecision: "allow" });
  } else {
    writeOutput({
      permissionDecision: "deny",
      permissionDecisionReason: data.reason ?? "Denied by mode policy",
    });
  }
  process.exit(0);
}

// Not auto-resolved → poll for user decision (existing flow)
approvalId = data.id;
// ... polling loop ...
```

### 3.2 Output Filter Implementation

**New file** (`src/sessions/jorchbot/output-filter.ts`):

```typescript
import type { OutputMode } from "./types.js";

/**
 * Event types emitted by ClaudeRunner that the SessionManager processes.
 */
type RunnerEventType = "text" | "toolUse" | "result" | "error";

/**
 * Determine if a runner event should be sent to WhatsApp based on output mode.
 *
 * Events that are NOT sent to WhatsApp are still logged to the DB.
 * Approval requests bypass this filter entirely (handled separately).
 */
export function shouldSendToChat(eventType: RunnerEventType, mode: OutputMode): boolean {
  switch (mode) {
    case "verbose":
      return true;

    case "summary":
      // Only result and error
      return eventType === "result" || eventType === "error";

    case "silent":
      // Only result (errors are always sent, handled by caller)
      return eventType === "result" || eventType === "error";
  }
}
```

**Integration in SessionManager** (`wireRunnerEvents()`):

```typescript
// Before sending text to WhatsApp:
const session = this.getSessionRecord(sessionId);
if (!shouldSendToChat("text", session.outputMode)) {
  // Log only, don't send to WhatsApp
  this.logMessage(sessionId, "outbound", "text", text);
  return;
}
// ... existing send logic ...
```

### 3.3 `/mode` Command in CommandRouter

**Registration** in `src/commands/router.ts`:

```typescript
case "mode":
  await this.handleMode(args, ownerPhone);
  return { type: "command", handled: true };
```

**Handler**:

```typescript
private async handleMode(args: string[], ownerPhone: string): Promise<void> {
  const APPROVAL_MODES = new Set(["confirm", "plan", "auto"]);
  const OUTPUT_MODES = new Set(["verbose", "summary", "silent"]);

  // /mode (no args) → show current modes
  if (args.length === 0) {
    const project = this.sessionManager.getFocusedProject(ownerPhone);
    if (!project) {
      await this.sendReply(ownerPhone, "No focused session. Use /new to create one.");
      return;
    }
    const record = this.sessionManager.getSessionRecord(project);
    await this.sendReply(ownerPhone,
      `[${project}] Current modes:\n` +
      `  Approval: ${record.mode}\n` +
      `  Output: ${record.outputMode}`
    );
    return;
  }

  const [modeValue, targetProject] = args;
  const project = targetProject ?? this.sessionManager.getFocusedProject(ownerPhone);

  if (!project) {
    await this.sendReply(ownerPhone, "No focused session. Specify project: /mode auto frontend");
    return;
  }

  if (APPROVAL_MODES.has(modeValue)) {
    await this.sessionManager.setMode(project, modeValue as ApprovalMode);
    await this.sendReply(ownerPhone, this.formatModeChange(project, "approval", modeValue));
    return;
  }

  if (OUTPUT_MODES.has(modeValue)) {
    await this.sessionManager.setOutputMode(project, modeValue as OutputMode);
    await this.sendReply(ownerPhone, this.formatModeChange(project, "output", modeValue));
    return;
  }

  await this.sendReply(ownerPhone,
    `Unknown mode "${modeValue}". Valid: confirm, plan, auto, verbose, summary, silent`
  );
}
```

### 3.4 SessionManager Mode Updates

**New methods on SessionManager**:

```typescript
/**
 * Update the approval mode for a session.
 * Takes effect immediately — the next tool call will use the new mode.
 * @throws {SessionNotFoundError} If session doesn't exist
 */
setMode(project: string, mode: ApprovalMode): void {
  const session = this.active.get(project);
  if (!session) throw new SessionNotFoundError(`Session "${project}" not found`);

  const db = getDb();
  db.update(sessions)
    .set({ mode, updatedAt: new Date() })
    .where(eq(sessions.id, session.id))
    .run();
}

/**
 * Update the output mode for a session.
 * Takes effect immediately — the next event will use the new filter.
 * @throws {SessionNotFoundError} If session doesn't exist
 */
setOutputMode(project: string, outputMode: OutputMode): void {
  const session = this.active.get(project);
  if (!session) throw new SessionNotFoundError(`Session "${project}" not found`);

  const db = getDb();
  db.update(sessions)
    .set({ outputMode, updatedAt: new Date() })
    .where(eq(sessions.id, session.id))
    .run();
}

/**
 * Get the current session record from DB (includes mode and outputMode).
 * @throws {SessionNotFoundError} If session doesn't exist
 */
getSessionRecord(project: string): SessionRecord {
  const session = this.active.get(project);
  if (!session) throw new SessionNotFoundError(`Session "${project}" not found`);

  const db = getDb();
  const row = db.select().from(sessions).where(eq(sessions.id, session.id)).get();
  if (!row) throw new SessionNotFoundError(`Session "${project}" not found in DB`);

  return row as SessionRecord;
}
```

### 3.5 Jorchfile Defaults on Session Creation

When the SessionManager creates a session, it accepts optional initial modes:

```typescript
export const CreateSessionInputSchema = z.object({
  project: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/),
  path: z.string().min(1),
  systemPrompt: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  initialMode: z.enum(["confirm", "plan", "auto"]).optional(),
  initialOutputMode: z.enum(["verbose", "summary", "silent"]).optional(),
});
```

The CommandRouter's `/new` handler reads the Jorchfile and passes `initialMode`/`initialOutputMode`:

```typescript
// In CommandRouter handleNew():
const jorchfile = loadJorchfile();
const project = jorchfile.projects.get(projectName);

await this.sessionManager.create(
  {
    project: projectName,
    path: project.path,
    systemPrompt: project.instructions,
    initialMode: project.approve, // from Jorchfile
    initialOutputMode: project.output, // from Jorchfile
  },
  ownerPhone,
);
```

In `SessionManager.create()`:

```typescript
db.insert(sessions)
  .values({
    // ...
    mode: validated.initialMode ?? "confirm",
    outputMode: validated.initialOutputMode ?? "verbose",
    // ...
  })
  .run();
```

### 3.6 Yes + Feedback Flow

#### 3.6.1 ApprovalManager Changes

The `ApprovalManager` sends 3 buttons instead of 2, and supports an `"awaiting_feedback"` state:

```typescript
export type ApprovalStatus =
  | "pending"
  | "approved"
  | "denied"
  | "awaiting_feedback";

interface ResolvedApproval {
  status: "approved" | "denied";
  additionalContext?: string;
}

export class ApprovalManager {
  private pending = new Map<string, PendingApproval>();
  private resolved = new Map<string, ResolvedApproval>();
  private awaitingFeedback = new Map<string, string>(); // approvalId → approvalId (for lookup)

  async requestApproval(request: { ... }): Promise<string> {
    // ... same as before, but with 3 buttons ...

    const feedbackPayload: ApprovalButtonPayload = {
      sessionId: this.deps.sessionId,
      approvalId,
      action: "feedback",
    };

    await this.deps.sendButtons(message, [
      { id: JSON.stringify(buttonPayloadApprove), title: "Yes" },
      { id: JSON.stringify(feedbackPayload), title: "Yes + feedback" },
      { id: JSON.stringify(buttonPayloadReject), title: "No" },
    ]);

    return approvalId;
  }

  /**
   * Mark approval as awaiting feedback.
   * The next free-text message from the user will be captured as feedback.
   */
  setAwaitingFeedback(approvalId: string): boolean {
    if (!this.pending.has(approvalId)) return false;
    this.awaitingFeedback.set(approvalId, approvalId);
    return true;
  }

  /**
   * Check if any approval is awaiting feedback.
   */
  getAwaitingFeedbackId(): string | null {
    const [first] = this.awaitingFeedback.keys();
    return first ?? null;
  }

  /**
   * Resolve an approval with optional feedback text.
   */
  async resolveApproval(
    approvalId: string,
    approved: boolean,
    feedback?: string,
  ): Promise<boolean> {
    const pending = this.pending.get(approvalId);
    if (!pending) return false;

    this.pending.delete(approvalId);
    this.awaitingFeedback.delete(approvalId);

    this.resolved.set(approvalId, {
      status: approved ? "approved" : "denied",
      additionalContext: feedback,
    });

    if (this.deps.updateApproval) {
      this.deps.updateApproval(approvalId, approved ? "approved" : "rejected", new Date());
    }

    return true;
  }

  /**
   * Get the current status of an approval (for hook polling).
   */
  getApprovalStatus(approvalId: string): {
    status: ApprovalStatus;
    additionalContext?: string;
  } | null {
    if (this.awaitingFeedback.has(approvalId)) {
      return { status: "awaiting_feedback" };
    }
    if (this.pending.has(approvalId)) {
      return { status: "pending" };
    }
    const resolved = this.resolved.get(approvalId);
    if (resolved) {
      return {
        status: resolved.status,
        additionalContext: resolved.additionalContext,
      };
    }
    return null;
  }
}
```

#### 3.6.2 Approval API Changes

The polling endpoint returns `additionalContext` when available:

```typescript
// GET /api/tool-approval/:id
router.get("/api/tool-approval/:id", (req, res) => {
  // ... find approval across sessions ...
  const result = session.approval.getApprovalStatus(approvalId);
  if (result !== null) {
    res.json({
      status: result.status,
      additionalContext: result.additionalContext,
    });
    return;
  }
  res.status(404)...;
});
```

#### 3.6.3 Hook Changes for Feedback

The hook handles `awaiting_feedback` as "keep polling" and reads `additionalContext`:

```typescript
// In polling loop:
const data = (await resp.json()) as PollResponse;

if (data.status === "approved") {
  const output = {
    hookSpecificOutput: {
      permissionDecision: "allow",
      additionalContext: data.additionalContext
        ? `User feedback: ${data.additionalContext}`
        : "Approved by user via WhatsApp",
    },
  };
  writeOutput(output);
  process.exit(0);
}

if (data.status === "awaiting_feedback") {
  // User tapped "Yes + feedback" — keep polling until they send text
  await sleep(POLL_INTERVAL_MS);
  continue;
}
```

#### 3.6.4 Webhook Handler for Feedback Button

When the Kapso webhook receives the "Yes + feedback" button click:

```typescript
// In webhook handler (gateway/jorchbot-start.ts or similar):
if (payload.action === "feedback") {
  const { sessionId, approvalId } = payload;
  const session = sessionManager.findBySessionId(sessionId);
  if (!session) return;

  session.approval.setAwaitingFeedback(approvalId);
  await sendReplyTo(session.ownerPhone, `[${session.project}] Write your feedback for Claude:`);
}
```

#### 3.6.5 Capturing Feedback Text

When the user sends a free-text message and an approval is awaiting feedback:

```typescript
// In message routing (before sending to ClaudeRunner):
const focusedProject = focusModel.getFocused(ownerPhone);
if (!focusedProject) return;

const session = active.get(focusedProject);
const feedbackApprovalId = session.approval.getAwaitingFeedbackId();

if (feedbackApprovalId) {
  // This message is feedback for the pending approval, not a Claude prompt
  await session.approval.resolveApproval(feedbackApprovalId, true, messageText);
  await sendReplyTo(
    ownerPhone,
    `[${focusedProject}] Approved with feedback.\n` + `Claude received: "${messageText}"`,
  );
  return; // Don't forward to ClaudeRunner
}

// Normal flow: send to ClaudeRunner
```

#### 3.6.6 Feedback Timeout

If the user taps "Yes + feedback" but doesn't send text within 5 minutes:

- A `setTimeout` in the SessionManager clears the `awaitingFeedback` state
- The approval reverts to `pending` (buttons are re-sent)
- User sees: `[frontend] Feedback timeout. Approval still pending.` followed by the original buttons

### 3.7 Smart Chunking

#### 3.7.1 Enhanced Chunker (`src/sessions/jorchbot/session-chunker.ts`)

A new session-aware chunker that wraps the existing `chunkTextForOutbound()`:

```typescript
import { chunkTextForOutbound } from "../../plugin-sdk/text-chunking.js";

const WHATSAPP_TEXT_LIMIT = 4096;
const MAX_CHUNKS = 3;
const DOCUMENT_THRESHOLD = 12_000; // chars

interface SessionChunkResult {
  /** Chunks to send as WhatsApp text messages. */
  chunks: string[];
  /** If set, full content should be sent as document attachment. */
  document?: {
    content: string;
    filename: string;
  };
}

/**
 * Chunk a message for WhatsApp with session prefix and document fallback.
 *
 * - Adds numbered prefix when multiple chunks: "[project] (1/3) ..."
 * - Limits to MAX_CHUNKS messages
 * - Falls back to document attachment for output > DOCUMENT_THRESHOLD
 */
export function chunkForSession(
  content: string,
  project: string,
  options?: { maxChunks?: number; documentThreshold?: number },
): SessionChunkResult {
  const maxChunks = options?.maxChunks ?? MAX_CHUNKS;
  const docThreshold = options?.documentThreshold ?? DOCUMENT_THRESHOLD;

  // Short message — single chunk, no numbering
  if (content.length <= WHATSAPP_TEXT_LIMIT - project.length - 10) {
    return { chunks: [`[${project}] ${content}`] };
  }

  // Long message — check if document is needed
  const needsDocument = content.length > docThreshold;

  // Chunk the content (without prefix, to maximize content per chunk)
  const rawChunks = chunkTextForOutbound(content, WHATSAPP_TEXT_LIMIT - 30);
  const totalChunks = Math.min(rawChunks.length, maxChunks);

  const chunks: string[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const prefix = totalChunks > 1 ? `[${project}] (${i + 1}/${totalChunks})` : `[${project}]`;
    chunks.push(`${prefix} ${rawChunks[i]}`);
  }

  if (needsDocument) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return {
      chunks: [
        ...chunks,
        `[${project}] Output too long (${Math.round(content.length / 1024)}KB). ` +
          `Summary above, full output attached as document.`,
      ],
      document: {
        content,
        filename: `${project}-output-${timestamp}.txt`,
      },
    };
  }

  return { chunks };
}
```

#### 3.7.2 Document Serving Endpoint

**New file** (`src/gateway/document-api.ts`):

```typescript
import { randomUUID } from "node:crypto";
import { Router } from "express";

const DOCUMENT_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const MAX_DOCUMENTS = 100;

interface StoredDocument {
  content: string;
  filename: string;
  createdAt: number;
}

export function createDocumentRouter(): {
  router: Router;
  storeDocument: (content: string, filename: string) => string;
} {
  const store = new Map<string, StoredDocument>();

  // Periodic cleanup of expired documents
  setInterval(
    () => {
      const now = Date.now();
      for (const [id, doc] of store) {
        if (now - doc.createdAt > DOCUMENT_EXPIRY_MS) {
          store.delete(id);
        }
      }
    },
    5 * 60 * 1000,
  ); // Every 5 minutes

  const router = Router();

  router.get("/api/documents/:id", (req, res) => {
    const doc = store.get(req.params.id);
    if (!doc) {
      res.status(404).json({ error: "Document not found or expired" });
      return;
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${doc.filename}"`);
    res.send(doc.content);
  });

  function storeDocument(content: string, filename: string): string {
    // Evict oldest if at capacity
    if (store.size >= MAX_DOCUMENTS) {
      const [oldestId] = store.keys();
      store.delete(oldestId);
    }

    const id = randomUUID();
    store.set(id, { content, filename, createdAt: Date.now() });
    return id;
  }

  return { router, storeDocument };
}
```

**Integration**: The `storeDocument()` function returns an ID, and the gateway constructs the URL:

```typescript
const docUrl = `http://localhost:${gatewayPort}/api/documents/${docId}`;
await kapsoClient.sendDocument({
  to: phone,
  documentUrl: docUrl,
  filename: result.document.filename,
  caption: `[${project}] Full output`,
});
```

> **Note**: Kapso may require a publicly accessible URL for `sendDocument`. If the gateway is only on localhost, the document URL won't work from Kapso's servers. In that case, the document content should be sent as a follow-up text message (chunked) or the feature requires Tailscale Serve to make the gateway reachable. This is documented as a limitation and should be tested during implementation.

### 3.8 Output Buffering (`src/sessions/jorchbot/output-buffer.ts`)

```typescript
const DEFAULT_FLUSH_INTERVAL_MS = 3000;
const WHATSAPP_TEXT_LIMIT = 4096;

type FlushCallback = (text: string) => void;

/**
 * Buffers text events and flushes them in batches.
 *
 * - Accumulates text for up to `flushIntervalMs`
 * - Flushes when buffer exceeds WhatsApp limit
 * - Flushes immediately on `forceFlush()` (used for result/error events)
 * - Respects WhatsApp 4096 char limit per flush
 */
export class OutputBuffer {
  private buffer = "";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private onFlush: FlushCallback;
  private flushIntervalMs: number;

  constructor(onFlush: FlushCallback, flushIntervalMs?: number) {
    this.onFlush = onFlush;
    this.flushIntervalMs = flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  }

  /**
   * Append text to the buffer. Starts a flush timer if not already running.
   */
  append(text: string): void {
    this.buffer += text;

    // Flush immediately if buffer exceeds WhatsApp limit
    if (this.buffer.length >= WHATSAPP_TEXT_LIMIT) {
      this.flush();
      return;
    }

    // Start timer if not running
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.flushIntervalMs);
    }
  }

  /**
   * Flush the buffer immediately. Called on result/error events.
   */
  forceFlush(): void {
    this.flush();
  }

  /**
   * Dispose the buffer and flush any remaining content.
   */
  dispose(): void {
    this.flush();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.buffer.length === 0) return;

    const text = this.buffer;
    this.buffer = "";
    this.onFlush(text);
  }
}
```

**Integration in SessionManager**:

Each session gets an `OutputBuffer` instance created in `wireRunnerEvents()`:

```typescript
const buffer = new OutputBuffer((text) => {
  if (shouldSendToChat("text", sessionRecord.outputMode)) {
    void this.sendReplyTo(ownerPhone, `[${project}] ${text}`);
  }
  this.logMessage(sessionId, "outbound", "text", text);
});

runner.on("text", (text: string) => {
  buffer.append(text);
});

runner.on("result", (result) => {
  buffer.forceFlush(); // Flush any buffered text first
  // ... handle result event ...
});

runner.on("error", (err) => {
  buffer.forceFlush();
  // ... handle error event ...
});
```

### 3.9 Approval Timeout Reminders

**New file** (`src/sessions/jorchbot/approval-timer.ts`):

```typescript
interface ApprovalTimerDeps {
  reminderDelayMs: number;
  onReminder: (approvalId: string) => void;
}

/**
 * Manages per-approval reminder timers.
 *
 * When an approval is created, a timer is started. If the approval isn't
 * resolved before the timer fires, the reminder callback is called.
 */
export class ApprovalTimer {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private deps: ApprovalTimerDeps;

  constructor(deps: ApprovalTimerDeps) {
    this.deps = deps;
  }

  /**
   * Start a reminder timer for an approval.
   */
  start(approvalId: string): void {
    this.clear(approvalId);
    const timer = setTimeout(() => {
      this.timers.delete(approvalId);
      this.deps.onReminder(approvalId);
    }, this.deps.reminderDelayMs);
    this.timers.set(approvalId, timer);
  }

  /**
   * Clear the timer for an approval (called when resolved).
   */
  clear(approvalId: string): void {
    const timer = this.timers.get(approvalId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(approvalId);
    }
  }

  /**
   * Clear all timers (called on shutdown).
   */
  dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}
```

**Integration in ApprovalManager**:

The `ApprovalManager` creates an `ApprovalTimer` that re-sends the approval buttons on reminder:

```typescript
// In ApprovalManager constructor:
this.reminderTimer = new ApprovalTimer({
  reminderDelayMs: deps.reminderDelayMs ?? 10 * 60 * 1000, // 10 minutes
  onReminder: (approvalId) => {
    const pending = this.pending.get(approvalId);
    if (!pending) return;

    // Re-send buttons with reminder prefix
    const message = `[Reminder] ${this.formatToolMessage(pending.toolName, pending.toolInput)}`;
    void this.deps.sendButtons(message, [
      { id: JSON.stringify({ ...approvePayload }), title: "Yes" },
      { id: JSON.stringify({ ...feedbackPayload }), title: "Yes + feedback" },
      { id: JSON.stringify({ ...rejectPayload }), title: "No" },
    ]);
  },
});

// In requestApproval():
this.reminderTimer.start(approvalId);

// In resolveApproval():
this.reminderTimer.clear(approvalId);
```

---

## 4. Error Definitions

New error classes in `src/errors/index.ts`:

```typescript
/** Thrown when an invalid mode value is provided to /mode command. */
export class InvalidModeError extends JorchBotError {
  constructor(mode: string) {
    super(
      `Invalid mode "${mode}". Valid approval modes: confirm, plan, auto. ` +
        `Valid output modes: verbose, summary, silent.`,
    );
  }
}

/** Thrown when trying to set mode on a session that's not active. */
export class SessionModeUpdateError extends JorchBotError {
  constructor(project: string, cause?: unknown) {
    super(`Failed to update mode for session "${project}"`, { cause });
  }
}

/** Thrown when document storage fails. */
export class DocumentStoreError extends JorchBotError {
  constructor(filename: string, cause?: unknown) {
    super(`Failed to store document "${filename}"`, { cause });
  }
}

/** Thrown when document retrieval fails (expired or not found). */
export class DocumentNotFoundError extends JorchBotError {
  constructor(documentId: string) {
    super(`Document "${documentId}" not found or expired`);
  }
}
```

---

## 5. Shared Types

**New file** (`src/sessions/jorchbot/types.ts`):

```typescript
/** Controls how much autonomy Claude Code has during tool execution. */
export type ApprovalMode = "confirm" | "plan" | "auto";

/** Controls how much output the user sees in WhatsApp. */
export type OutputMode = "verbose" | "summary" | "silent";
```

These types are used across approval-modes.ts, output-filter.ts, the SessionManager, and the CommandRouter. They mirror the Zod enums already in the DB schema but are extracted here as a single source of truth for static typing.

---

## 6. Configuration

The existing `src/config/jorchbot-config.ts` already has the relevant config fields:

```typescript
// Already exists in approvals section:
approvals: {
  timeoutMinutes: 10,        // Used for reminder timer
  pauseTimeoutMinutes: 60,   // Not used in this phase (hook has 5min hard timeout)
  skipPermissions: true,      // Controls --dangerously-skip-permissions
}
```

The `timeoutMinutes` field (default 10) is reused for the approval reminder timer. No new config fields are needed.

---

## 7. Design Decisions

### 7.1 Why hook-based mode enforcement (not `--permission-mode`)?

`--dangerously-skip-permissions` overrides `--permission-mode`. Since all sessions use `--dangerously-skip-permissions` (required for headless mode without interactive prompts), we cannot rely on `--permission-mode plan`. Hooks fire BEFORE the permission system and can override it, making them the reliable enforcement mechanism.

### 7.2 Why auto-resolve in the gateway (not the hook)?

The hook could check an environment variable for the mode and auto-approve locally. But this requires restarting the ClaudeRunner process when the mode changes (env vars are set at spawn time). By resolving in the gateway, mode changes take effect immediately on the next tool call with zero process restarts.

### 7.3 Why 3-button approval (not 2)?

The current 2-button flow (`[Yes] [No]`) leaves no way for the user to say "yes, but..." — a common pattern in code review. The "Yes + feedback" button replicates Claude Code CLI's ability to type text instead of pressing Tab, which is one of the most powerful interaction patterns.

### 7.4 Why output filtering in SessionManager (not ClaudeRunner)?

ClaudeRunner is a thin subprocess wrapper. It should emit ALL events and let the consumer decide. The SessionManager is the right place for output filtering because it has access to the session's mode (from DB) and the send callbacks (to WhatsApp). This keeps ClaudeRunner simple and reusable.

### 7.5 Why a document endpoint (not inline chunking)?

WhatsApp has a hard 4096-char limit. Sending 50+ chunks of a large test output is worse than sending 3 chunks + 1 document. The document attachment provides the complete output without flooding the chat.

### 7.6 Why 3-second output buffering?

Without buffering, each text event from ClaudeRunner triggers a separate WhatsApp message. During `npm install` or test runs, this can mean 100+ messages in seconds. A 3-second buffer collapses these into batched messages, dramatically reducing chat noise while maintaining near-real-time feedback.

---

## 8. Testing Strategy

### 8.1 Unit Tests

**`src/sessions/jorchbot/approval-modes.test.ts`**:

```typescript
import { describe, expect, it } from "vitest";
import { resolveApprovalByMode } from "./approval-modes.js";

describe("resolveApprovalByMode", () => {
  describe("auto mode", () => {
    it("allows all tools", () => {
      const result = resolveApprovalByMode("auto", "Edit");
      expect(result).toStrictEqual({ decision: "allow" });
    });

    it("allows Bash", () => {
      const result = resolveApprovalByMode("auto", "Bash");
      expect(result).toStrictEqual({ decision: "allow" });
    });

    it("allows Read", () => {
      const result = resolveApprovalByMode("auto", "Read");
      expect(result).toStrictEqual({ decision: "allow" });
    });
  });

  describe("plan mode", () => {
    it("denies write tools with plan reason", () => {
      const result = resolveApprovalByMode("plan", "Edit");
      expect(result).not.toBeNull();
      expect(result!.decision).toBe("deny");
      expect(result!.reason).toContain("Plan mode");
    });

    it("denies Bash", () => {
      const result = resolveApprovalByMode("plan", "Bash");
      expect(result!.decision).toBe("deny");
    });

    it("allows Read", () => {
      const result = resolveApprovalByMode("plan", "Read");
      expect(result).toStrictEqual({ decision: "allow" });
    });

    it("allows Grep", () => {
      const result = resolveApprovalByMode("plan", "Grep");
      expect(result).toStrictEqual({ decision: "allow" });
    });
  });

  describe("confirm mode", () => {
    it("returns null for all tools (normal approval flow)", () => {
      expect(resolveApprovalByMode("confirm", "Edit")).toBeNull();
      expect(resolveApprovalByMode("confirm", "Read")).toBeNull();
      expect(resolveApprovalByMode("confirm", "Bash")).toBeNull();
    });
  });
});
```

**`src/sessions/jorchbot/output-filter.test.ts`**:

```typescript
import { describe, expect, it } from "vitest";
import { shouldSendToChat } from "./output-filter.js";

describe("shouldSendToChat", () => {
  describe("verbose mode", () => {
    it("sends text events", () => {
      expect(shouldSendToChat("text", "verbose")).toBe(true);
    });
    it("sends result events", () => {
      expect(shouldSendToChat("result", "verbose")).toBe(true);
    });
    it("sends error events", () => {
      expect(shouldSendToChat("error", "verbose")).toBe(true);
    });
    it("sends toolUse events", () => {
      expect(shouldSendToChat("toolUse", "verbose")).toBe(true);
    });
  });

  describe("summary mode", () => {
    it("does not send text events", () => {
      expect(shouldSendToChat("text", "summary")).toBe(false);
    });
    it("does not send toolUse events", () => {
      expect(shouldSendToChat("toolUse", "summary")).toBe(false);
    });
    it("sends result events", () => {
      expect(shouldSendToChat("result", "summary")).toBe(true);
    });
    it("sends error events", () => {
      expect(shouldSendToChat("error", "summary")).toBe(true);
    });
  });

  describe("silent mode", () => {
    it("does not send text events", () => {
      expect(shouldSendToChat("text", "silent")).toBe(false);
    });
    it("does not send toolUse events", () => {
      expect(shouldSendToChat("toolUse", "silent")).toBe(false);
    });
    it("sends result events", () => {
      expect(shouldSendToChat("result", "silent")).toBe(true);
    });
    it("sends error events", () => {
      expect(shouldSendToChat("error", "silent")).toBe(true);
    });
  });
});
```

**`src/sessions/jorchbot/session-chunker.test.ts`**:

```typescript
import { describe, expect, it } from "vitest";
import { chunkForSession } from "./session-chunker.js";

describe("chunkForSession", () => {
  it("returns single chunk for short messages", () => {
    const result = chunkForSession("Hello world", "frontend");
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]).toBe("[frontend] Hello world");
    expect(result.document).toBeUndefined();
  });

  it("numbers chunks for multi-chunk messages", () => {
    const longText = "a".repeat(5000);
    const result = chunkForSession(longText, "frontend");
    expect(result.chunks.length).toBeGreaterThan(1);
    expect(result.chunks[0]).toContain("[frontend] (1/");
  });

  it("limits to 3 chunks maximum", () => {
    const longText = "a".repeat(15000);
    const result = chunkForSession(longText, "frontend", { maxChunks: 3 });
    // chunks = 3 content chunks + 1 "too long" message = 4 max
    expect(result.chunks.length).toBeLessThanOrEqual(4);
  });

  it("creates document for output exceeding threshold", () => {
    const longText = "a".repeat(15000);
    const result = chunkForSession(longText, "frontend", { documentThreshold: 12000 });
    expect(result.document).toBeDefined();
    expect(result.document!.filename).toContain("frontend-output-");
    expect(result.document!.content).toBe(longText);
  });

  it("does not create document for output under threshold", () => {
    const text = "a".repeat(8000);
    const result = chunkForSession(text, "frontend", { documentThreshold: 12000 });
    expect(result.document).toBeUndefined();
  });
});
```

**`src/sessions/jorchbot/output-buffer.test.ts`**:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutputBuffer } from "./output-buffer.js";

describe("OutputBuffer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes after interval", () => {
    const onFlush = vi.fn();
    const buffer = new OutputBuffer(onFlush, 3000);

    buffer.append("hello ");
    buffer.append("world");

    expect(onFlush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(3000);

    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush).toHaveBeenCalledWith("hello world");
  });

  it("flushes immediately on forceFlush", () => {
    const onFlush = vi.fn();
    const buffer = new OutputBuffer(onFlush, 3000);

    buffer.append("hello");
    buffer.forceFlush();

    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush).toHaveBeenCalledWith("hello");
  });

  it("does not flush empty buffer", () => {
    const onFlush = vi.fn();
    const buffer = new OutputBuffer(onFlush, 3000);

    buffer.forceFlush();

    expect(onFlush).not.toHaveBeenCalled();
  });

  it("flushes immediately when buffer exceeds WhatsApp limit", () => {
    const onFlush = vi.fn();
    const buffer = new OutputBuffer(onFlush, 3000);

    buffer.append("a".repeat(5000));

    expect(onFlush).toHaveBeenCalledOnce();
  });

  it("dispose flushes remaining content", () => {
    const onFlush = vi.fn();
    const buffer = new OutputBuffer(onFlush, 3000);

    buffer.append("remaining");
    buffer.dispose();

    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush).toHaveBeenCalledWith("remaining");
  });
});
```

**`src/sessions/jorchbot/approval-timer.test.ts`**:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalTimer } from "./approval-timer.js";

describe("ApprovalTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires reminder after delay", () => {
    const onReminder = vi.fn();
    const timer = new ApprovalTimer({ reminderDelayMs: 10000, onReminder });

    timer.start("approval-1");

    expect(onReminder).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10000);
    expect(onReminder).toHaveBeenCalledOnce();
    expect(onReminder).toHaveBeenCalledWith("approval-1");
  });

  it("does not fire if cleared before delay", () => {
    const onReminder = vi.fn();
    const timer = new ApprovalTimer({ reminderDelayMs: 10000, onReminder });

    timer.start("approval-1");
    timer.clear("approval-1");
    vi.advanceTimersByTime(10000);

    expect(onReminder).not.toHaveBeenCalled();
  });

  it("dispose clears all timers", () => {
    const onReminder = vi.fn();
    const timer = new ApprovalTimer({ reminderDelayMs: 10000, onReminder });

    timer.start("a1");
    timer.start("a2");
    timer.dispose();
    vi.advanceTimersByTime(10000);

    expect(onReminder).not.toHaveBeenCalled();
  });
});
```

### 8.2 Integration Tests

Integration tests should verify the full flow through the approval API:

- **Auto mode**: POST tool-approval with auto mode session → response has `autoResolved: true, status: "approved"`
- **Plan mode + write tool**: POST tool-approval with plan mode + Edit → response has `autoResolved: true, status: "denied"` with reason
- **Plan mode + read tool**: POST tool-approval with plan mode + Read → response has `autoResolved: true, status: "approved"`
- **Confirm mode**: POST tool-approval with confirm mode → response has `id` and no `autoResolved`
- **Yes + feedback**: POST tool-approval → set awaiting_feedback → send text → poll → approved with context
- **Reminder**: Create approval → advance timer → verify buttons re-sent

### 8.3 Test Isolation

All tests use `JORCHBOT_DB_PATH` and `JORCHBOT_CONFIG_DIR` env vars for isolation (existing pattern from `test/test-env.ts`). No real filesystem or network calls.

---

## 9. File Map

| File                                        | Status     | Description                                                                                     |
| ------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------- |
| `src/sessions/jorchbot/types.ts`            | **NEW**    | Shared types: `ApprovalMode`, `OutputMode`                                                      |
| `src/sessions/jorchbot/approval-modes.ts`   | **NEW**    | `resolveApprovalByMode()` — mode enforcement logic                                              |
| `src/sessions/jorchbot/output-filter.ts`    | **NEW**    | `shouldSendToChat()` — output mode filtering                                                    |
| `src/sessions/jorchbot/session-chunker.ts`  | **NEW**    | `chunkForSession()` — numbered chunks + document fallback                                       |
| `src/sessions/jorchbot/output-buffer.ts`    | **NEW**    | `OutputBuffer` class — 3-second batching                                                        |
| `src/sessions/jorchbot/approval-timer.ts`   | **NEW**    | `ApprovalTimer` class — reminder timers                                                         |
| `src/gateway/document-api.ts`               | **NEW**    | Document storage + serving endpoint                                                             |
| `src/sessions/jorchbot/approval-manager.ts` | **MODIFY** | Add 3rd button, awaiting_feedback state, additionalContext                                      |
| `src/sessions/jorchbot/manager.ts`          | **MODIFY** | Add `setMode()`, `setOutputMode()`, output filtering, buffering, Jorchfile defaults             |
| `src/gateway/approval-api.ts`               | **MODIFY** | Add mode-based auto-resolution, additionalContext in poll response                              |
| `src/hooks/jorchbot/tool-approval.ts`       | **MODIFY** | Handle `autoResolved` response, `awaiting_feedback` status, `additionalContext`                 |
| `src/commands/router.ts`                    | **MODIFY** | Add `/mode` command handler                                                                     |
| `src/gateway/jorchbot-start.ts`             | **MODIFY** | Mount document router, pass `sendDocumentTo` callback                                           |
| `src/errors/index.ts`                       | **MODIFY** | Add `InvalidModeError`, `SessionModeUpdateError`, `DocumentStoreError`, `DocumentNotFoundError` |

---

## 10. Limitations

1. **Batch approvals are impossible**: Claude Code hooks are sequential — each tool blocks until its hook returns. No way to group multiple tools into one approval UI.
2. **Document URL accessibility**: Kapso `sendDocument` requires a URL reachable from Kapso's servers. If the gateway is only on localhost, document attachments won't work unless Tailscale Serve exposes the gateway. Implementation should detect this and fall back to chunked text.
3. **Plan mode is advisory**: The denial reason tells Claude to plan, but Claude Code may still attempt write tools in subsequent turns. The hook will keep denying them until the user switches to confirm/auto mode.
4. **Hook timeout is hardcoded at 5 minutes**: The hook script has `MAX_POLL_MS = 300_000`. The gateway reminder (default 10 min) fires after the hook already timed out. The reminder is useful when Claude retries (new hook invocation) after the first timeout.
5. **additionalContext visibility**: The `additionalContext` from "Yes + feedback" is injected into Claude's context by the hook system. It's visible to Claude but may not be as prominent as a direct user message. In practice, Claude Code handles this well.
6. **Feedback timeout**: If the user taps "Yes + feedback" but doesn't type anything, the feedback times out after 5 minutes and the approval reverts to pending (buttons re-sent). This matches the hook's overall timeout.

---

## 11. Definition of Done

- [ ] `resolveApprovalByMode()` correctly handles all 3 modes × tool types
- [ ] Auto mode: tool calls are approved without sending WhatsApp buttons
- [ ] Plan mode: write tools are denied with plan instructions, read tools are allowed
- [ ] Confirm mode: unchanged behavior (buttons sent, user approves)
- [ ] `shouldSendToChat()` correctly filters events by output mode
- [ ] In summary mode, only result + error events appear in WhatsApp
- [ ] In silent mode, only approval requests + result + error appear in WhatsApp
- [ ] `/mode` command changes modes in real-time without restarting session
- [ ] `/mode` with no args shows current modes
- [ ] `/mode <value> <project>` targets a specific session
- [ ] Jorchfile `approve`/`output` fields are read on session creation
- [ ] Sessions created from Jorchfile use Jorchfile defaults
- [ ] "Yes + feedback" button triggers awaiting_feedback state
- [ ] User's next text message is captured as feedback
- [ ] Claude receives feedback via `additionalContext` in hook output
- [ ] Feedback timeout after 5 minutes reverts to pending
- [ ] Output over 12K chars is sent as document attachment
- [ ] Chunks are numbered: `[project] (1/3)`
- [ ] Maximum 3 chunks per message
- [ ] OutputBuffer batches text events every 3 seconds
- [ ] Buffer flushes immediately on result/error events
- [ ] Approval reminders re-send buttons after configurable timeout
- [ ] All new error classes extend `JorchBotError`
- [ ] All unit tests pass
- [ ] `pnpm check` passes with 0 errors, 0 warnings
