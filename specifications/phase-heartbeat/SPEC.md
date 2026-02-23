# Heartbeat System Integration — SPEC

> **Phase**: Heartbeat (post Phase 6)
> **Status**: Draft
> **Dependencies**: Phase 2 (SessionManager + ClaudeRunner), Phase 3 (Jorchfile), Phase 6 (GUI)
> **Last updated**: 2026-02-22

---

## 1. WHY

JorchBot manages Claude Code sessions as subprocesses via `ClaudeRunner`. Currently, there is no way for JorchBot to **periodically check on active sessions**, surface alerts, or run health checks. Users must manually ask "how's the project going?" or rely on real-time output.

OpenClaw (Layer 1) has a sophisticated heartbeat system (`src/infra/heartbeat-runner.ts`, ~1200 LOC) designed for **LLM API calls** — it calls `getReplyFromConfig()` to send a prompt to the model and processes the response. This does **not** work with JorchBot because:

1. **JorchBot uses ClaudeRunner** (Claude Code as subprocess), not direct LLM API calls
2. **JorchBot has multiple sessions** mapped to Jorchfile projects, not OpenClaw's agent system
3. **JorchBot delivers via Kapso/Telegram**, not OpenClaw's multi-channel outbound system
4. **JorchBot's context window** is tracked per-session (0-100%), not per-agent

However, OpenClaw's heartbeat infrastructure has **excellent reusable components**:

- Scheduling with coalescing (`heartbeat-wake.ts`)
- Active hours / quiet hours (`heartbeat-active-hours.ts`)
- Event types and emission (`heartbeat-events.ts`)
- Token stripping (`auto-reply/heartbeat.ts`)
- Visibility/delivery settings (`heartbeat-visibility.ts`)
- HEARTBEAT.md content gating
- Duplicate suppression (24h dedup)
- Reason classification (`heartbeat-reason.ts`)

This spec defines a **JorchBotHeartbeatRunner** that reuses Layer 1's scheduling, active hours, events, and token stripping, while replacing the LLM invocation with ClaudeRunner prompt injection and the delivery with Kapso/Telegram channel delivery.

---

## 2. WHAT

### 2.1 Goals

1. **Per-project heartbeat**: Each Jorchfile project can have its own heartbeat config (interval, prompt, active hours, HEARTBEAT.md)
2. **Global heartbeat config**: `~/.jorchbot/config.json` gets a `heartbeat` section for global defaults
3. **ClaudeRunner integration**: Heartbeat sends a prompt to the active ClaudeRunner session via `runner.resume()`, not via LLM API calls
4. **Per-project HEARTBEAT.md**: Each project workspace can have a `HEARTBEAT.md` file that customizes the heartbeat prompt
5. **Channel delivery**: Heartbeat alerts delivered via the configured channel (Kapso or Telegram) to the session owner
6. **HEARTBEAT_OK suppression**: Strip the `HEARTBEAT_OK` token from responses; suppress empty/OK responses
7. **Active hours**: Respect quiet hours configuration (timezone-aware)
8. **GUI visibility**: WebSocket events for heartbeat status (indicator in dashboard)
9. **Duplicate suppression**: Don't re-send the same alert within 24 hours
10. **Context-aware skipping**: Skip heartbeat if session is in `block` context guard level (>95%)

### 2.2 Non-Goals

- Cron jobs system (separate feature)
- Multi-agent heartbeats (JorchBot has sessions, not agents)
- Model override for heartbeat (ClaudeRunner uses Claude Code which picks its own model)
- Reasoning delivery (ClaudeRunner doesn't expose thinking blocks)
- Exec event / wake system (OpenClaw-specific triggers)
- Transcript pruning (ClaudeRunner manages its own context)

### 2.3 User Experience

#### Via Jorchfile

```
PROJECT myapp
  path = ~/projects/myapp
  heartbeat = 30m
  heartbeat_hours = 09:00-22:00
  heartbeat_tz = America/New_York
```

#### Via Config (`~/.jorchbot/config.json`)

```json
{
  "heartbeat": {
    "enabled": true,
    "every": "30m",
    "prompt": "Read HEARTBEAT.md if it exists. Follow it strictly. If nothing needs attention, reply HEARTBEAT_OK.",
    "ackMaxChars": 300,
    "activeHours": {
      "start": "09:00",
      "end": "22:00",
      "timezone": "America/New_York"
    }
  }
}
```

#### Via HEARTBEAT.md (per-project)

Create `HEARTBEAT.md` in the project workspace directory:

```md
# Heartbeat checklist

- Check if the dev server is running without errors
- Verify no failing tests in the last run
- Report any pending git conflicts
- If everything is fine, reply HEARTBEAT_OK
```

#### Via Chat

```
User: /heartbeat status
Bot:  Heartbeat status:
      myapp — next in 12m (every 30m, active hours 09:00-22:00 EST)
      api   — paused (outside active hours, resumes 09:00 EST)
      docs  — disabled (no heartbeat config)

User: /heartbeat now myapp
Bot:  [myapp] Running heartbeat now...
Bot:  [myapp] HEARTBEAT_OK — nothing needs attention.

User: /heartbeat off myapp
Bot:  [myapp] Heartbeat disabled.
```

---

## 3. HOW

### 3.1 Architecture Overview

```
                  ┌─────────────────────────┐
                  │  JorchBotHeartbeatRunner │
                  │  (orchestrator)          │
                  └──────┬──────────────────┘
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
        ┌──────────┐ ┌────────┐ ┌──────────┐
        │ Scheduler│ │ Active │ │ Delivery │
        │ (reuse   │ │ Hours  │ │ (Kapso/  │
        │  L1 wake)│ │(reuse) │ │ Telegram)│
        └──────────┘ └────────┘ └──────────┘
              │
              ▼
        ┌──────────────────┐
        │ Per-Project State │
        │ ┌──────────────┐ │
        │ │ intervalMs   │ │
        │ │ lastRunMs    │ │
        │ │ nextDueMs    │ │
        │ │ lastText     │ │
        │ │ lastSentAt   │ │
        │ └──────────────┘ │
        └────────┬─────────┘
                 │
                 ▼
        ┌──────────────────┐
        │ ClaudeRunner     │
        │ .resume({prompt})│
        └────────┬─────────┘
                 │
                 ▼
        ┌──────────────────┐
        │ stripHeartbeatToken │
        │ (reuse L1)       │
        └────────┬─────────┘
                 │
                 ▼
        ┌──────────────────┐
        │ Deliver / Skip   │
        └──────────────────┘
```

### 3.2 Reuse Matrix

| Component                              | Source (Layer 1)                      | Reuse Strategy                                            |
| -------------------------------------- | ------------------------------------- | --------------------------------------------------------- |
| `stripHeartbeatToken()`                | `src/auto-reply/heartbeat.ts`         | **Direct import** — stateless function, no deps           |
| `isHeartbeatContentEffectivelyEmpty()` | `src/auto-reply/heartbeat.ts`         | **Direct import** — reads file, returns boolean           |
| `isWithinActiveHours()`                | `src/infra/heartbeat-active-hours.ts` | **Direct import** — timezone-aware, stateless             |
| `HeartbeatEventPayload`                | `src/infra/heartbeat-events.ts`       | **Import type** — reuse event shape                       |
| `emitHeartbeatEvent()`                 | `src/infra/heartbeat-events.ts`       | **Direct import** — event emitter                         |
| Reason classification                  | `src/infra/heartbeat-reason.ts`       | **Direct import** — enum + classifier                     |
| Visibility resolution                  | `src/infra/heartbeat-visibility.ts`   | **Skip** — JorchBot uses simpler channel model            |
| Wake/coalescing                        | `src/infra/heartbeat-wake.ts`         | **Skip** — JorchBot uses simpler per-project timer        |
| HeartbeatRunner                        | `src/infra/heartbeat-runner.ts`       | **Skip** — completely replaced by JorchBotHeartbeatRunner |
| Delivery targets                       | `src/infra/outbound/targets.ts`       | **Skip** — JorchBot uses SessionManager's sendReplyTo     |

### 3.3 Config Schema

Add `heartbeat` section to `JorchBotConfigSchema`:

```typescript
// src/config/jorchbot-config.ts

const ActiveHoursSchema = z.object({
  /** Start of active window, HH:MM format (24h), inclusive. */
  start: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:MM format"),
  /** End of active window, HH:MM format (24h), exclusive. "24:00" = end of day. */
  end: z.string().regex(/^\d{2}:\d{2}$|^24:00$/, "Must be HH:MM or 24:00"),
  /** Timezone: IANA string (e.g. "America/New_York"), "local" for host TZ, or omit for host TZ. */
  timezone: z.string().optional(),
});

const HeartbeatSchema = z.object({
  /** Master switch. When false, no heartbeats run for any project. */
  enabled: z.boolean().default(false),
  /** Default heartbeat interval as duration string. "0m" disables. Default: "30m". */
  every: z.string().default("30m"),
  /** Prompt sent to ClaudeRunner on each heartbeat tick. */
  prompt: z
    .string()
    .default(
      "Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. " +
        "Do not infer or repeat old tasks from prior chats. " +
        "If nothing needs attention, reply HEARTBEAT_OK.",
    ),
  /** Max chars after HEARTBEAT_OK before the reply is considered an alert. Default: 300. */
  ackMaxChars: z.number().int().min(0).default(300),
  /** Restrict heartbeats to a time window. Omit for 24/7. */
  activeHours: ActiveHoursSchema.optional(),
  /** Suppress HEARTBEAT_OK ack messages (default: true = don't deliver OKs). */
  suppressOk: z.boolean().default(true),
  /** Skip heartbeat if session context is at or above this percent. Default: 95. */
  skipAboveContextPercent: z.number().int().min(1).max(100).default(95),
});

export const JorchBotConfigSchema = z.object({
  // ... existing fields ...
  heartbeat: HeartbeatSchema.default(HeartbeatSchema.parse({})),
});
```

### 3.4 Jorchfile Schema Extension

Add heartbeat fields to `JorchProjectSchema`:

```typescript
// src/jorchfile/parser.ts

/** Reserved fields that are NOT treated as custom commands */
const RESERVED_FIELDS = new Set([
  "path",
  "port",
  "tunnel",
  "funnel_path",
  "approve",
  "output",
  "instructions",
  "background",
  // New heartbeat fields:
  "heartbeat",
  "heartbeat_hours",
  "heartbeat_tz",
  "heartbeat_prompt",
]);

export const JorchProjectSchema = z.object({
  // ... existing fields ...
  /** Heartbeat interval override for this project. "0m" disables. Omit = use global. */
  heartbeat: z.string().optional(),
  /** Active hours override, "HH:MM-HH:MM" format. Omit = use global. */
  heartbeatHours: z
    .string()
    .regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/)
    .optional(),
  /** Timezone override for active hours. Omit = use global. */
  heartbeatTz: z.string().optional(),
  /** Custom heartbeat prompt for this project. Omit = use global. */
  heartbeatPrompt: z.string().optional(),
});
```

### 3.5 Duration Parsing

Reuse or adapt OpenClaw's duration parser. JorchBot needs a minimal `parseDuration(str) → ms`:

```typescript
// src/infra/parse-duration.ts

import { JorchBotError } from "../errors/index.js";

export class InvalidDurationError extends JorchBotError {
  constructor(input: string) {
    super(`Invalid duration string: "${input}". Expected format: "30m", "1h", "2h30m", "0m".`);
  }
}

const DURATION_REGEX = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/;

/**
 * Parse a human-friendly duration string into milliseconds.
 * Supports: "30m", "1h", "2h30m", "0m", "90s".
 * @throws {InvalidDurationError} If the format is invalid
 */
export function parseDuration(input: string): number {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === "0" || trimmed === "0m" || trimmed === "0s" || trimmed === "0h") {
    return 0;
  }
  const match = DURATION_REGEX.exec(trimmed);
  if (!match) {
    throw new InvalidDurationError(input);
  }
  const hours = match[1] ? Number.parseInt(match[1], 10) : 0;
  const minutes = match[2] ? Number.parseInt(match[2], 10) : 0;
  const seconds = match[3] ? Number.parseInt(match[3], 10) : 0;
  const ms = (hours * 3600 + minutes * 60 + seconds) * 1000;
  if (ms === 0) {
    throw new InvalidDurationError(input);
  }
  return ms;
}
```

### 3.6 Per-Project Heartbeat State

```typescript
// src/heartbeat/types.ts

export type HeartbeatProjectState = {
  /** Jorchfile project name */
  project: string;
  /** Resolved interval in ms (0 = disabled) */
  intervalMs: number;
  /** Timestamp of last heartbeat run (ms) */
  lastRunMs: number | undefined;
  /** When next heartbeat is due (ms) */
  nextDueMs: number;
  /** Last heartbeat response text (for dedup) */
  lastResponseText: string | undefined;
  /** When last response was delivered (ms) */
  lastSentAtMs: number | undefined;
  /** Consecutive failures count */
  consecutiveFailures: number;
};

export type HeartbeatRunResult = {
  project: string;
  status: "sent" | "ok" | "skipped" | "failed";
  durationMs: number;
  reason?: string;
  preview?: string;
};

/** Resolved heartbeat config for a single project */
export type ResolvedProjectHeartbeat = {
  project: string;
  intervalMs: number;
  prompt: string;
  ackMaxChars: number;
  activeHours?: {
    start: string;
    end: string;
    timezone?: string;
  };
  heartbeatMdPath: string;
  skipAboveContextPercent: number;
};
```

### 3.7 JorchBotHeartbeatRunner

This is the core new component. It replaces OpenClaw's `startHeartbeatRunner()`.

```typescript
// src/heartbeat/heartbeat-runner.ts

import { readFileSync } from "node:fs";
import path from "node:path";
import { stripHeartbeatToken } from "../auto-reply/heartbeat.js";
import { isWithinActiveHours } from "../infra/heartbeat-active-hours.js";
import type { JorchBotConfig } from "../config/jorchbot-config.js";
import type { SessionManager, ActiveSession } from "../sessions/jorchbot/manager.js";
import type { JorchfileExecutor } from "../jorchfile/executor.js";
import { parseDuration } from "../infra/parse-duration.js";
import { JorchBotError } from "../errors/index.js";
import type {
  HeartbeatProjectState,
  HeartbeatRunResult,
  ResolvedProjectHeartbeat,
} from "./types.js";

// --- Error classes ---

export class HeartbeatRunnerError extends JorchBotError {
  constructor(project: string, message: string, cause?: unknown) {
    super(`[heartbeat:${project}] ${message}`, {
      cause: cause instanceof Error ? cause : undefined,
    });
  }
}

export class HeartbeatPromptError extends HeartbeatRunnerError {
  constructor(project: string, cause?: unknown) {
    super(project, "Failed to send heartbeat prompt to ClaudeRunner", cause);
  }
}

// --- Deps interface ---

export interface HeartbeatRunnerDeps {
  config: JorchBotConfig;
  sessionManager: SessionManager;
  getJorchfileExecutor: () => JorchfileExecutor | null;
  sendReplyTo: (phone: string, text: string) => Promise<void>;
  emitWsEvent?: (event: string, payload: unknown) => void;
  nowMs?: () => number;
}

// --- Constants ---

const DEFAULT_PROMPT =
  "Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. " +
  "Do not infer or repeat old tasks from prior chats. " +
  "If nothing needs attention, reply HEARTBEAT_OK.";

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CONSECUTIVE_FAILURES = 5;
const FAILURE_BACKOFF_FACTOR = 2;
const MIN_INTERVAL_MS = 60_000; // 1 minute minimum

// --- Main class ---

export class JorchBotHeartbeatRunner {
  private readonly deps: HeartbeatRunnerDeps;
  private readonly states = new Map<string, HeartbeatProjectState>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private stopped = false;

  constructor(deps: HeartbeatRunnerDeps) {
    this.deps = deps;
  }

  /** Start the heartbeat scheduler. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    this.syncProjects();
    this.scheduleNext();
  }

  /** Stop all heartbeats. */
  stop(): void {
    this.stopped = true;
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.states.clear();
  }

  /** Update config (e.g., after config.set from GUI). */
  updateConfig(config: JorchBotConfig): void {
    this.deps.config = config;
    this.syncProjects();
    this.scheduleNext();
  }

  /** Force an immediate heartbeat run for a specific project. */
  async runNow(project: string): Promise<HeartbeatRunResult> {
    const resolved = this.resolveProjectConfig(project);
    if (!resolved) {
      return { project, status: "skipped", durationMs: 0, reason: "not-configured" };
    }
    return this.runForProject(resolved);
  }

  /** Get status of all tracked projects. */
  getStatus(): Array<{
    project: string;
    enabled: boolean;
    intervalMs: number;
    nextDueMs: number | null;
    lastRunMs: number | null;
    consecutiveFailures: number;
  }> {
    const now = this.now();
    const results: Array<{
      project: string;
      enabled: boolean;
      intervalMs: number;
      nextDueMs: number | null;
      lastRunMs: number | null;
      consecutiveFailures: number;
    }> = [];

    for (const [project, state] of this.states) {
      results.push({
        project,
        enabled: state.intervalMs > 0,
        intervalMs: state.intervalMs,
        nextDueMs: state.intervalMs > 0 ? state.nextDueMs - now : null,
        lastRunMs: state.lastRunMs ?? null,
        consecutiveFailures: state.consecutiveFailures,
      });
    }

    return results;
  }

  // --- Internal scheduling ---

  private syncProjects(): void {
    const config = this.deps.config;
    if (!config.heartbeat.enabled) {
      this.states.clear();
      return;
    }

    const executor = this.deps.getJorchfileExecutor();
    const jorchfile = executor?.getJorchfile();
    const activeSessions = this.deps.sessionManager.listActive();
    const now = this.now();

    // Build set of active project names
    const activeProjects = new Set(activeSessions.map((s) => s.project));

    // Remove states for projects no longer active
    for (const project of this.states.keys()) {
      if (!activeProjects.has(project)) {
        this.states.delete(project);
      }
    }

    // Add/update states for active projects
    for (const session of activeSessions) {
      const jfProject = jorchfile?.projects.find((p) => p.name === session.project);
      const intervalStr = jfProject?.heartbeat ?? config.heartbeat.every;
      let intervalMs: number;
      try {
        intervalMs = parseDuration(intervalStr);
      } catch {
        intervalMs = 0; // Invalid duration = disabled
      }

      // Enforce minimum
      if (intervalMs > 0 && intervalMs < MIN_INTERVAL_MS) {
        intervalMs = MIN_INTERVAL_MS;
      }

      const existing = this.states.get(session.project);
      if (existing) {
        // Update interval if changed, preserve timing state
        existing.intervalMs = intervalMs;
      } else {
        // New project — schedule first run after one interval
        this.states.set(session.project, {
          project: session.project,
          intervalMs,
          lastRunMs: undefined,
          nextDueMs: now + intervalMs,
          lastResponseText: undefined,
          lastSentAtMs: undefined,
          consecutiveFailures: 0,
        });
      }
    }
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const now = this.now();
    let soonest = Infinity;

    for (const state of this.states.values()) {
      if (state.intervalMs <= 0) continue;
      if (state.nextDueMs < soonest) {
        soonest = state.nextDueMs;
      }
    }

    if (soonest === Infinity) return; // Nothing to schedule

    const delayMs = Math.max(0, soonest - now);
    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    this.syncProjects(); // Refresh project list

    const now = this.now();
    const dueProjects: string[] = [];

    for (const [project, state] of this.states) {
      if (state.intervalMs <= 0) continue;
      if (state.nextDueMs <= now) {
        dueProjects.push(project);
      }
    }

    // Run due projects sequentially (avoid flooding ClaudeRunner)
    for (const project of dueProjects) {
      if (this.stopped) break;
      const resolved = this.resolveProjectConfig(project);
      if (!resolved) {
        const state = this.states.get(project);
        if (state) {
          state.nextDueMs = now + state.intervalMs;
        }
        continue;
      }
      await this.runForProject(resolved);
    }

    this.scheduleNext();
  }

  // --- Heartbeat execution ---

  private async runForProject(resolved: ResolvedProjectHeartbeat): Promise<HeartbeatRunResult> {
    const { project } = resolved;
    const state = this.states.get(project);
    const now = this.now();

    if (!state) {
      return { project, status: "skipped", durationMs: 0, reason: "no-state" };
    }

    // 1. Check active hours
    if (resolved.activeHours) {
      const withinHours = isWithinActiveHours(
        // Build a minimal config object that isWithinActiveHours expects
        { agents: { defaults: { userTimezone: resolved.activeHours.timezone } } } as never,
        {
          activeHours: {
            start: resolved.activeHours.start,
            end: resolved.activeHours.end,
            timezone: resolved.activeHours.timezone,
          },
        },
      );
      if (!withinHours) {
        state.nextDueMs = now + state.intervalMs;
        this.emitEvent({ project, status: "skipped", reason: "outside-active-hours" });
        return { project, status: "skipped", durationMs: 0, reason: "outside-active-hours" };
      }
    }

    // 2. Check session exists and is active
    const session = this.deps.sessionManager.getByProject(project);
    if (!session) {
      state.nextDueMs = now + state.intervalMs;
      return { project, status: "skipped", durationMs: 0, reason: "no-active-session" };
    }

    // 3. Check context guard
    const contextPercent = session.runner.getContextPercent();
    if (contextPercent >= resolved.skipAboveContextPercent) {
      state.nextDueMs = now + state.intervalMs;
      this.emitEvent({ project, status: "skipped", reason: "context-too-high" });
      return { project, status: "skipped", durationMs: 0, reason: `context-at-${contextPercent}%` };
    }

    // 4. Check runner status
    if (session.runner.getStatus() !== "idle") {
      state.nextDueMs = now + state.intervalMs;
      return { project, status: "skipped", durationMs: 0, reason: "runner-busy" };
    }

    // 5. Check HEARTBEAT.md content
    const heartbeatMdContent = this.readHeartbeatMd(resolved.heartbeatMdPath);
    if (heartbeatMdContent !== null && isEffectivelyEmpty(heartbeatMdContent)) {
      state.nextDueMs = now + state.intervalMs;
      this.emitEvent({ project, status: "skipped", reason: "empty-heartbeat-md" });
      return { project, status: "skipped", durationMs: 0, reason: "empty-heartbeat-md" };
    }

    // 6. Send heartbeat prompt
    const startMs = now;
    let responseText: string;
    try {
      responseText = await this.sendHeartbeatPrompt(session, resolved.prompt);
    } catch (err) {
      state.consecutiveFailures++;
      const backoffMs = Math.min(
        state.intervalMs * FAILURE_BACKOFF_FACTOR ** state.consecutiveFailures,
        state.intervalMs * 8, // Cap at 8x interval
      );
      state.nextDueMs = now + backoffMs;
      state.lastRunMs = now;
      this.emitEvent({ project, status: "failed", reason: String(err) });
      return { project, status: "failed", durationMs: this.now() - startMs, reason: String(err) };
    }

    const durationMs = this.now() - startMs;
    state.lastRunMs = now;
    state.consecutiveFailures = 0;
    state.nextDueMs = now + state.intervalMs;

    // 7. Process response — strip HEARTBEAT_OK token
    const { shouldSkip, text, didStrip } = stripHeartbeatToken(responseText, {
      mode: "heartbeat",
      maxAckChars: resolved.ackMaxChars,
    });

    // 8. Check for duplicate
    if (!shouldSkip && text.length > 0) {
      if (
        state.lastResponseText === text &&
        state.lastSentAtMs !== undefined &&
        now - state.lastSentAtMs < DEDUP_WINDOW_MS
      ) {
        this.emitEvent({ project, status: "skipped", reason: "duplicate" });
        return { project, status: "skipped", durationMs, reason: "duplicate" };
      }
    }

    // 9. Deliver or suppress
    if (shouldSkip || text.trim().length === 0) {
      // HEARTBEAT_OK — nothing to deliver
      this.emitEvent({ project, status: "ok" });
      return { project, status: "ok", durationMs };
    }

    // Alert content — deliver
    try {
      const formatted = `[${project}] ${text}`;
      await this.deps.sendReplyTo(session.ownerPhone, formatted);
      state.lastResponseText = text;
      state.lastSentAtMs = now;
      this.emitEvent({ project, status: "sent", preview: text.slice(0, 100) });
      return { project, status: "sent", durationMs, preview: text.slice(0, 100) };
    } catch (err) {
      this.emitEvent({ project, status: "failed", reason: `delivery: ${String(err)}` });
      return { project, status: "failed", durationMs, reason: `delivery: ${String(err)}` };
    }
  }

  // --- Helpers ---

  private resolveProjectConfig(project: string): ResolvedProjectHeartbeat | null {
    const config = this.deps.config;
    if (!config.heartbeat.enabled) return null;

    const executor = this.deps.getJorchfileExecutor();
    const jorchfile = executor?.getJorchfile();
    const jfProject = jorchfile?.projects.find((p) => p.name === project);

    const session = this.deps.sessionManager.getByProject(project);
    if (!session) return null;

    // Resolve interval: per-project override > global
    const intervalStr = jfProject?.heartbeat ?? config.heartbeat.every;
    let intervalMs: number;
    try {
      intervalMs = parseDuration(intervalStr);
    } catch {
      return null; // Invalid = disabled
    }
    if (intervalMs === 0) return null;

    // Resolve active hours: per-project override > global
    let activeHours = config.heartbeat.activeHours;
    if (jfProject?.heartbeatHours) {
      const [start, end] = jfProject.heartbeatHours.split("-");
      activeHours = {
        start: start ?? "00:00",
        end: end ?? "24:00",
        timezone: jfProject.heartbeatTz ?? activeHours?.timezone,
      };
    }

    // Resolve prompt: per-project override > global
    const prompt = jfProject?.heartbeatPrompt ?? config.heartbeat.prompt ?? DEFAULT_PROMPT;

    // HEARTBEAT.md path: <project-path>/HEARTBEAT.md
    const heartbeatMdPath = path.join(session.path, "HEARTBEAT.md");

    return {
      project,
      intervalMs,
      prompt,
      ackMaxChars: config.heartbeat.ackMaxChars,
      activeHours,
      heartbeatMdPath,
      skipAboveContextPercent: config.heartbeat.skipAboveContextPercent,
    };
  }

  private async sendHeartbeatPrompt(session: ActiveSession, prompt: string): Promise<string> {
    const runner = session.runner;
    if (runner.getStatus() !== "idle") {
      throw new HeartbeatRunnerError(session.project, "Runner is not idle");
    }

    return new Promise<string>((resolve, reject) => {
      let responseText = "";
      const timeout = setTimeout(
        () => {
          reject(
            new HeartbeatPromptError(session.project, new Error("Heartbeat prompt timed out (5m)")),
          );
        },
        5 * 60 * 1000,
      );

      const onText = (text: string) => {
        responseText += text;
      };

      const onResult = () => {
        clearTimeout(timeout);
        runner.off("text", onText);
        runner.off("result", onResult);
        runner.off("error", onError);
        resolve(responseText);
      };

      const onError = (err: Error) => {
        clearTimeout(timeout);
        runner.off("text", onText);
        runner.off("result", onResult);
        runner.off("error", onError);
        reject(new HeartbeatPromptError(session.project, err));
      };

      runner.on("text", onText);
      runner.on("result", onResult);
      runner.on("error", onError);

      runner.resume({ prompt, cwd: session.path }).catch((err: unknown) => {
        clearTimeout(timeout);
        runner.off("text", onText);
        runner.off("result", onResult);
        runner.off("error", onError);
        reject(new HeartbeatPromptError(session.project, err));
      });
    });
  }

  private readHeartbeatMd(filePath: string): string | null {
    try {
      return readFileSync(filePath, "utf-8");
    } catch {
      return null; // File doesn't exist — still run heartbeat
    }
  }

  private emitEvent(event: {
    project: string;
    status: string;
    reason?: string;
    preview?: string;
  }): void {
    this.deps.emitWsEvent?.("heartbeat", {
      ts: this.now(),
      ...event,
    });
  }

  private now(): number {
    return this.deps.nowMs?.() ?? Date.now();
  }
}

// --- Standalone helper (to avoid importing from Layer 1's heavier module) ---

/**
 * Check if HEARTBEAT.md content is effectively empty (only comments, headers, blank lines).
 * Mirrors Layer 1's isHeartbeatContentEffectivelyEmpty().
 */
function isEffectivelyEmpty(content: string): boolean {
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("//")) continue;
    if (trimmed === "---") continue;
    // Has real content
    return false;
  }
  return true;
}
```

### 3.8 Integration with SessionManager

The heartbeat runner needs to know when sessions start/stop. Wire it via the existing event emitter.

```typescript
// In src/gateway/jorchbot-start.ts (startup wiring)

import { JorchBotHeartbeatRunner } from "../heartbeat/heartbeat-runner.js";

// After SessionManager is created:
const heartbeatRunner = new JorchBotHeartbeatRunner({
  config,
  sessionManager,
  getJorchfileExecutor: () => jorchfileExecutor,
  sendReplyTo: async (phone, text) => {
    // Use whatever channel is active (Kapso, Telegram, etc.)
    await sendReplyToPhone(phone, text);
  },
  emitWsEvent: (event, payload) => {
    wsServer?.broadcast(event, payload);
  },
});

// Start heartbeat if enabled
if (config.heartbeat.enabled) {
  heartbeatRunner.start();
}

// Listen for session lifecycle
sessionManager.on("sessionCreated", () => heartbeatRunner.updateConfig(config));
sessionManager.on("sessionDestroyed", () => heartbeatRunner.updateConfig(config));

// On config change, update heartbeat
// (in the config.set handler, after Object.assign)
heartbeatRunner.updateConfig(config);

// On shutdown
shutdownHandlers.push(() => heartbeatRunner.stop());
```

### 3.9 WebSocket RPC Methods

Add heartbeat RPC handlers to `jorchbot-ws-handlers.ts`:

```typescript
// In src/gateway/jorchbot-ws-handlers.ts

"jb.heartbeat.status": () => {
  const runner = deps.getHeartbeatRunner();
  if (!runner) {
    return { enabled: false, projects: [] };
  }
  return {
    enabled: deps.config.heartbeat.enabled,
    projects: runner.getStatus(),
  };
},

"jb.heartbeat.runNow": async (params) => {
  const project = params.project as string;
  if (!project) {
    throw new Error("Missing required param: project");
  }
  const runner = deps.getHeartbeatRunner();
  if (!runner) {
    throw new Error("Heartbeat runner is not active");
  }
  return runner.runNow(project);
},

"jb.heartbeat.toggle": (params) => {
  const enabled = params.enabled as boolean;
  const runner = deps.getHeartbeatRunner();

  // Update config
  deps.config.heartbeat.enabled = enabled;
  // Persist
  saveConfig(deps.config);

  if (enabled && runner) {
    runner.start();
  } else if (!enabled && runner) {
    runner.stop();
  }

  return { ok: true, enabled };
},
```

### 3.10 GUI — Heartbeat Tab (Phase 6 extension)

Add a "Heartbeat" section to the Overview or a dedicated tab in the GUI dashboard.

```typescript
// ui/src/ui/views/jb-heartbeat.ts

import { html, nothing } from "lit";

export type HeartbeatProjectStatus = {
  project: string;
  enabled: boolean;
  intervalMs: number;
  nextDueMs: number | null; // ms until next run (null = disabled)
  lastRunMs: number | null; // timestamp of last run
  consecutiveFailures: number;
};

export type HeartbeatProps = {
  enabled: boolean;
  loading: boolean;
  projects: HeartbeatProjectStatus[];
  error: string | null;
  onToggle: (enabled: boolean) => void;
  onRefresh: () => void;
  onRunNow: (project: string) => void;
};

function formatDuration(ms: number): string {
  if (ms <= 0) return "now";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function formatInterval(ms: number): string {
  if (ms <= 0) return "disabled";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `every ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `every ${hours}h`;
}

function renderProjectRow(project: HeartbeatProjectStatus, props: HeartbeatProps) {
  const nextIn =
    project.nextDueMs !== null && project.nextDueMs > 0
      ? formatDuration(project.nextDueMs)
      : project.nextDueMs === 0
        ? "due now"
        : "—";

  return html`
    <div
      class="row"
      style="gap: 12px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border, #333);"
    >
      <div style="flex: 1; min-width: 0;">
        <strong>${project.project}</strong>
        <span class="muted" style="font-size: 12px; margin-left: 8px;">
          ${project.enabled ? formatInterval(project.intervalMs) : "disabled"}
        </span>
      </div>
      <div style="min-width: 80px; text-align: center;">
        ${project.enabled
          ? html`<span class="pill" style="font-size: 11px;">next: ${nextIn}</span>`
          : html`<span class="muted" style="font-size: 11px;">off</span>`}
      </div>
      <div style="min-width: 40px; text-align: center;">
        ${project.consecutiveFailures > 0
          ? html`<span
              class="pill"
              style="font-size: 11px; background: var(--danger, #ef4444); color: #fff;"
              >${project.consecutiveFailures} fail</span
            >`
          : nothing}
      </div>
      <button
        class="btn btn--sm"
        ?disabled=${!project.enabled}
        @click=${() => props.onRunNow(project.project)}
      >
        Run Now
      </button>
    </div>
  `;
}

export function renderHeartbeat(props: HeartbeatProps) {
  return html`
    <section>
      <div class="row" style="margin-bottom: 16px; gap: 12px; align-items: center;">
        <h3 style="margin: 0;">Heartbeat</h3>
        <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
          <input
            type="checkbox"
            .checked=${props.enabled}
            @change=${(e: Event) => props.onToggle((e.target as HTMLInputElement).checked)}
          />
          <span class="muted" style="font-size: 13px;"
            >${props.enabled ? "Enabled" : "Disabled"}</span
          >
        </label>
        <button
          class="btn btn--sm"
          ?disabled=${props.loading}
          @click=${props.onRefresh}
          style="margin-left: auto;"
        >
          ${props.loading ? "Loading\u2026" : "Refresh"}
        </button>
      </div>

      ${props.error
        ? html`<div class="callout danger" style="margin-bottom: 12px;">${props.error}</div>`
        : nothing}
      ${!props.enabled
        ? html`<div class="muted" style="padding: 16px 0;">
            Heartbeat is disabled globally. Enable it to monitor active sessions.
          </div>`
        : props.projects.length === 0
          ? html`<div class="muted" style="padding: 16px 0;">
              No active sessions with heartbeat configured.
            </div>`
          : props.projects.map((p) => renderProjectRow(p, props))}
    </section>
  `;
}
```

### 3.11 Chat Command Handler

Add `/heartbeat` command support in the command control module:

```typescript
// Integration point: src/auto-reply/command-control.ts

// Add to command map:
case "heartbeat":
case "hb": {
  const subcommand = args[0]; // status | now | off | on
  const project = args[1];

  switch (subcommand) {
    case "status":
    case undefined:
      return handleHeartbeatStatus(deps);
    case "now":
      return handleHeartbeatRunNow(deps, project);
    case "off":
      return handleHeartbeatDisable(deps, project);
    case "on":
      return handleHeartbeatEnable(deps, project);
    default:
      return `Unknown heartbeat command: ${subcommand}. Use: status, now, off, on`;
  }
}
```

### 3.12 Error Classes

```typescript
// Add to src/errors/index.ts

// --- Heartbeat errors ---

/** Heartbeat runner encountered an error during execution */
export class HeartbeatRunnerError extends JorchBotError {
  constructor(project: string, message: string, cause?: unknown) {
    super(`[heartbeat:${project}] ${message}`, {
      cause: cause instanceof Error ? cause : undefined,
    });
  }
}

/** Failed to send heartbeat prompt to ClaudeRunner */
export class HeartbeatPromptError extends HeartbeatRunnerError {
  constructor(project: string, cause?: unknown) {
    super(project, "Failed to send heartbeat prompt to ClaudeRunner", cause);
  }
}

/** Invalid heartbeat configuration */
export class HeartbeatConfigError extends JorchBotError {
  constructor(message: string) {
    super(`Heartbeat config error: ${message}`);
  }
}
```

### 3.13 Test Strategy

#### Unit Tests

**`src/heartbeat/heartbeat-runner.test.ts`** — Core runner logic:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { JorchBotHeartbeatRunner } from "./heartbeat-runner.js";

describe("JorchBotHeartbeatRunner", () => {
  let runner: JorchBotHeartbeatRunner;
  let mockSessionManager: MockSessionManager;
  let mockSendReply: ReturnType<typeof vi.fn>;
  let nowMs: number;

  beforeEach(() => {
    nowMs = 1_700_000_000_000;
    mockSessionManager = createMockSessionManager();
    mockSendReply = vi.fn().mockResolvedValue(undefined);

    runner = new JorchBotHeartbeatRunner({
      config: createTestConfig({ heartbeat: { enabled: true, every: "30m" } }),
      sessionManager: mockSessionManager,
      getJorchfileExecutor: () => null,
      sendReplyTo: mockSendReply,
      nowMs: () => nowMs,
    });
  });

  describe("start/stop lifecycle", () => {
    it("should schedule heartbeat timer on start", () => {
      /* ... */
    });
    it("should clear timer on stop", () => {
      /* ... */
    });
    it("should not start when config.heartbeat.enabled is false", () => {
      /* ... */
    });
  });

  describe("runForProject", () => {
    it("should send prompt to ClaudeRunner and deliver alert", async () => {
      // Setup: mock runner that responds with alert text
      mockSessionManager.addSession("myapp", {
        status: "idle",
        contextPercent: 30,
        respondWith: "Build failed: 3 test failures in auth module",
      });

      const result = await runner.runNow("myapp");

      expect(result.status).toBe("sent");
      expect(mockSendReply).toHaveBeenCalledTimes(1);
      expect(mockSendReply.mock.calls[0][1]).toContain("[myapp]");
      expect(mockSendReply.mock.calls[0][1]).toContain("Build failed");
    });

    it("should suppress HEARTBEAT_OK responses", async () => {
      mockSessionManager.addSession("myapp", {
        status: "idle",
        contextPercent: 30,
        respondWith: "HEARTBEAT_OK",
      });

      const result = await runner.runNow("myapp");

      expect(result.status).toBe("ok");
      expect(mockSendReply).not.toHaveBeenCalled();
    });

    it("should skip when runner is busy", async () => {
      mockSessionManager.addSession("myapp", {
        status: "running",
        contextPercent: 30,
      });

      const result = await runner.runNow("myapp");

      expect(result.status).toBe("skipped");
      expect(result.reason).toBe("runner-busy");
    });

    it("should skip when context is above threshold", async () => {
      mockSessionManager.addSession("myapp", {
        status: "idle",
        contextPercent: 96,
      });

      const result = await runner.runNow("myapp");

      expect(result.status).toBe("skipped");
      expect(result.reason).toContain("context-at-96%");
    });

    it("should skip when outside active hours", async () => {
      // Configure active hours 09:00-17:00, current time is 23:00
      // ... mock isWithinActiveHours to return false
    });

    it("should deduplicate identical alerts within 24h", async () => {
      mockSessionManager.addSession("myapp", {
        status: "idle",
        contextPercent: 30,
        respondWith: "Same alert text",
      });

      await runner.runNow("myapp");
      expect(mockSendReply).toHaveBeenCalledTimes(1);

      const result = await runner.runNow("myapp");
      expect(result.status).toBe("skipped");
      expect(result.reason).toBe("duplicate");
      expect(mockSendReply).toHaveBeenCalledTimes(1); // No second delivery
    });

    it("should apply exponential backoff on failures", async () => {
      mockSessionManager.addSession("myapp", {
        status: "idle",
        contextPercent: 30,
        throwOnResume: new Error("Runner crashed"),
      });

      await runner.runNow("myapp");
      const status = runner.getStatus();
      const myapp = status.find((s) => s.project === "myapp");
      expect(myapp?.consecutiveFailures).toBe(1);
    });
  });

  describe("HEARTBEAT.md gating", () => {
    it("should skip when HEARTBEAT.md is effectively empty", async () => {
      /* ... */
    });
    it("should run when HEARTBEAT.md has real content", async () => {
      /* ... */
    });
    it("should run when HEARTBEAT.md does not exist", async () => {
      /* ... */
    });
  });

  describe("config resolution", () => {
    it("should use Jorchfile per-project heartbeat over global", () => {
      /* ... */
    });
    it("should use global config when no Jorchfile override", () => {
      /* ... */
    });
    it("should disable heartbeat when interval is 0m", () => {
      /* ... */
    });
  });
});
```

**`src/infra/parse-duration.test.ts`** — Duration parser:

```typescript
describe("parseDuration", () => {
  it("should parse minutes", () => {
    expect(parseDuration("30m")).toBe(30 * 60 * 1000);
  });

  it("should parse hours", () => {
    expect(parseDuration("2h")).toBe(2 * 60 * 60 * 1000);
  });

  it("should parse combined", () => {
    expect(parseDuration("1h30m")).toBe(90 * 60 * 1000);
  });

  it("should return 0 for '0m'", () => {
    expect(parseDuration("0m")).toBe(0);
  });

  it("should throw for invalid format", () => {
    expect(() => parseDuration("abc")).toThrow(InvalidDurationError);
  });

  it("should throw for empty string", () => {
    expect(() => parseDuration("")).toThrow(InvalidDurationError);
  });
});
```

### 3.14 File Structure

```
src/
  heartbeat/
    heartbeat-runner.ts        # JorchBotHeartbeatRunner class (~300 LOC)
    heartbeat-runner.test.ts   # Unit tests
    types.ts                   # HeartbeatProjectState, HeartbeatRunResult, etc.
  infra/
    parse-duration.ts          # parseDuration() utility
    parse-duration.test.ts     # Unit tests
  errors/
    index.ts                   # + HeartbeatRunnerError, HeartbeatPromptError, HeartbeatConfigError
  config/
    jorchbot-config.ts         # + HeartbeatSchema
  jorchfile/
    parser.ts                  # + heartbeat, heartbeat_hours, heartbeat_tz, heartbeat_prompt fields
  gateway/
    jorchbot-ws-handlers.ts    # + jb.heartbeat.status, jb.heartbeat.runNow, jb.heartbeat.toggle
    jorchbot-start.ts          # + heartbeat runner wiring
  auto-reply/
    command-control.ts         # + /heartbeat chat command
ui/
  src/ui/
    views/jb-heartbeat.ts     # Heartbeat GUI view
    controllers/heartbeat.ts   # Heartbeat state management for GUI
```

### 3.15 Layer 1 Import Compatibility

The following Layer 1 functions are imported directly. They are stateless utilities with no side effects:

| Import                  | From                                  | Why it works                                                         |
| ----------------------- | ------------------------------------- | -------------------------------------------------------------------- |
| `stripHeartbeatToken()` | `src/auto-reply/heartbeat.ts`         | Pure function, takes string → returns `{shouldSkip, text, didStrip}` |
| `isWithinActiveHours()` | `src/infra/heartbeat-active-hours.ts` | Pure function, takes config + heartbeat → returns boolean            |

**Risk**: These functions expect OpenClaw's config shape (`OpenClawConfig`). We need to either:

- **(A)** Pass a minimal compatible object (casting with `as never`)
- **(B)** Extract the timezone-resolution logic into a standalone function

**Recommended**: Option (B) — extract `resolveTimezone(tzConfig: string | undefined, fallback?: string): string` as a shared utility and rewrite `isWithinActiveHours` as a thin JorchBot-specific wrapper. This avoids coupling to OpenClaw's config types.

```typescript
// src/heartbeat/active-hours.ts

/**
 * Check if current time is within the active hours window.
 * Standalone implementation that doesn't depend on OpenClaw config types.
 */
export function isWithinActiveHoursJb(params: {
  start: string; // "HH:MM"
  end: string; // "HH:MM" or "24:00"
  timezone?: string; // IANA TZ string or undefined (uses host TZ)
  nowMs?: number;
}): boolean {
  // Reimplement timezone-aware check (extract from Layer 1)
  // ~40 lines of code
}
```

### 3.16 Interaction with `isWithinActiveHours` (Layer 1)

Looking at `src/infra/heartbeat-active-hours.ts`, the function signature is:

```typescript
function isWithinActiveHours(
  cfg: OpenClawConfig,
  heartbeat?: { activeHours?: { start?: string; end?: string; timezone?: string } },
  nowMs?: number,
): boolean;
```

It reads `cfg.agents.defaults.userTimezone` for the `"user"` timezone fallback. Since JorchBot doesn't have `agents.defaults.userTimezone`, we'll implement our own version that takes timezone directly.

---

## 4. EDGE CASES & FAILURE MODES

### 4.1 Runner Busy During Heartbeat

If ClaudeRunner is `running` when heartbeat fires, skip and retry on next interval. Do NOT queue — heartbeats are best-effort.

### 4.2 Session Created Mid-Heartbeat

New sessions get their first heartbeat after one full interval from creation time, not immediately.

### 4.3 Session Destroyed Mid-Heartbeat

If a session is destroyed while a heartbeat prompt is in-flight, the result listener will fire with an error (runner stopped). The error handler catches this and records a failure.

### 4.4 Config Changed While Running

`updateConfig()` calls `syncProjects()` which adjusts intervals. Running heartbeats are not interrupted — changes take effect on the next tick.

### 4.5 All Sessions Stopped

When no active sessions remain, `syncProjects()` clears all states and the timer is not rescheduled. The runner sits idle until a new session starts.

### 4.6 HEARTBEAT.md Deleted During Run

Not a problem — it was already read before the prompt was sent. Next tick will check again.

### 4.7 High Context (>95%)

Heartbeats are skipped to avoid pushing sessions into context overflow. The `skipAboveContextPercent` threshold is configurable (default: 95).

### 4.8 Rapid Config Toggles

Each `updateConfig()` call clears and reschedules the timer. No duplicate timers can accumulate.

---

## 5. SECURITY CONSIDERATIONS

1. **HEARTBEAT.md content**: Becomes part of the prompt context. Do NOT put secrets in it.
2. **Heartbeat responses**: May contain sensitive project information. Delivered only to the session owner's phone.
3. **Rate limiting**: Minimum interval is 1 minute to prevent runaway heartbeats.
4. **Max consecutive failures**: After 5 failures, backoff caps at 8x interval (prevents infinite retries at high frequency).

---

## 6. MIGRATION & BACKWARDS COMPATIBILITY

- Heartbeat is **disabled by default** (`enabled: false`). Zero impact on existing installations.
- No database schema changes required (heartbeat state is in-memory).
- No changes to existing OpenClaw Layer 1 code.
- The `heartbeat` config section is new and optional in `jorchbot-config.ts`.
- Jorchfile `heartbeat` field is new and optional — existing Jorchfiles continue to work.

---

## 7. REFERENCES

- OpenClaw heartbeat runner: `src/infra/heartbeat-runner.ts` (~1200 LOC)
- OpenClaw heartbeat docs: `docs/gateway/heartbeat.md`
- OpenClaw token stripping: `src/auto-reply/heartbeat.ts`
- OpenClaw active hours: `src/infra/heartbeat-active-hours.ts`
- ClaudeRunner: `src/sessions/jorchbot/claude-runner.ts`
- SessionManager: `src/sessions/jorchbot/manager.ts`
- Jorchfile parser: `src/jorchfile/parser.ts`
- JorchBot config: `src/config/jorchbot-config.ts`
- Error hierarchy: `src/errors/index.ts`
