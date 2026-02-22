import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../db/index.js";
import { messages, sessions } from "../../db/schema.js";
import {
  SessionAlreadyExistsError,
  SessionCreateError,
  SessionDestroyError,
  SessionLimitError,
  SessionNotFoundError,
} from "../../errors/index.js";
import { generateHookConfig, writeHookConfig } from "../../hooks/jorchbot/hook-config-generator.js";
import { registerAgent, unregisterAgent } from "./agent-registration.js";
import { ApprovalManager } from "./approval-manager.js";
import { ClaudeRunner } from "./claude-runner.js";
import {
  type ContextGuardResult,
  type ContextGuardThresholds,
  evaluateContextGuard,
  resolveContextInfo,
} from "./context-guard.js";
import { FocusModel } from "./focus-model.js";
import { OutputBuffer } from "./output-buffer.js";
import { shouldSendToChat } from "./output-filter.js";
import { detectQuestion } from "./question-detector.js";
import { chunkForSession } from "./session-chunker.js";
import type { ApprovalMode, OutputMode } from "./types.js";

// --- Zod schema for runtime validation (data crossing trust boundaries) ---

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
  initialMode: z.enum(["confirm", "plan", "auto"]).optional(),
  initialOutputMode: z.enum(["verbose", "summary", "silent"]).optional(),
});

export type CreateSessionInput = z.infer<typeof CreateSessionInputSchema>;

// --- Interfaces ---

export interface ActiveSession {
  id: string;
  project: string;
  path: string;
  ownerPhone: string;
  runner: ClaudeRunner;
  approval: ApprovalManager;
}

export interface SessionRecord {
  id: string;
  project: string;
  path: string;
  ownerPhone: string | null;
  claudeSessionId: string | null;
  mode: ApprovalMode;
  outputMode: OutputMode;
  contextPercent: number;
  status: "active" | "stopped" | "error" | "paused";
  focused: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface SessionManagerDeps {
  maxSessions?: number;
  gatewayPort?: number;
  hookScriptDir?: string;
  contextGuard?: ContextGuardThresholds & { contextLimit?: number };
  /** Targeted send: delivers text to a specific phone. */
  sendReplyTo: (phone: string, text: string) => Promise<void>;
  /** Targeted send: delivers buttons to a specific phone. */
  sendButtonsTo: (
    phone: string,
    text: string,
    buttons: Array<{ id: string; title: string }>,
  ) => Promise<void>;
  /** Targeted send: delivers a list to a specific phone. */
  sendListTo?: (
    phone: string,
    text: string,
    buttonText: string,
    options: Array<{ id: string; title: string; description?: string }>,
  ) => Promise<void>;
  /** Targeted send: delivers a document attachment to a specific phone. */
  sendDocumentTo?: (phone: string, content: string, filename: string) => Promise<void>;
  /** Approval reminder delay in ms. Defaults to 10 minutes. */
  approvalReminderDelayMs?: number;
  createRunner?: () => ClaudeRunner;
  /** Called after a session is destroyed (before focus auto-switch). Used to clean up background tasks/tunnels. */
  onSessionDestroy?: (project: string) => void;
}

const DEFAULT_MAX_SESSIONS = 5;

export class SessionManager extends EventEmitter {
  private active = new Map<string, ActiveSession>();
  private pendingQuestions = new Map<string, { sessionId: string }>();
  private outputBuffers = new Map<string, OutputBuffer>();
  private focusModel: FocusModel;
  private maxSessions: number;
  private gatewayPort: number;
  private hookScriptDir: string | null;
  private contextGuardThresholds: ContextGuardThresholds;
  private contextGuardLimit: number | undefined;
  private sendReplyTo: (phone: string, text: string) => Promise<void>;
  private sendButtonsTo: (
    phone: string,
    text: string,
    buttons: Array<{ id: string; title: string }>,
  ) => Promise<void>;
  private sendListTo: (
    phone: string,
    text: string,
    buttonText: string,
    options: Array<{ id: string; title: string; description?: string }>,
  ) => Promise<void>;
  private sendDocumentTo:
    | ((phone: string, content: string, filename: string) => Promise<void>)
    | undefined;
  private approvalReminderDelayMs: number | undefined;
  private createRunner: () => ClaudeRunner;
  private onSessionDestroy: ((project: string) => void) | undefined;

  constructor(deps: SessionManagerDeps) {
    super();
    this.maxSessions = deps.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.gatewayPort = deps.gatewayPort ?? 18789;
    this.hookScriptDir = deps.hookScriptDir ?? null;
    this.contextGuardThresholds = {
      warnPercent: deps.contextGuard?.warnPercent,
      criticalPercent: deps.contextGuard?.criticalPercent,
      blockPercent: deps.contextGuard?.blockPercent,
    };
    this.contextGuardLimit = deps.contextGuard?.contextLimit;
    this.sendReplyTo = deps.sendReplyTo;
    this.sendButtonsTo = deps.sendButtonsTo;
    this.sendListTo = deps.sendListTo ?? (async () => {});
    this.sendDocumentTo = deps.sendDocumentTo;
    this.approvalReminderDelayMs = deps.approvalReminderDelayMs;
    this.createRunner =
      deps.createRunner ?? (() => new ClaudeRunner({ contextLimit: this.contextGuardLimit }));
    this.onSessionDestroy = deps.onSessionDestroy;
    this.focusModel = new FocusModel();
  }

  /**
   * Create a new session for a project.
   *
   * @throws {SessionLimitError} If max concurrent sessions reached
   * @throws {SessionAlreadyExistsError} If a session with this project name exists
   * @throws {SessionCreateError} If DB insert or runner creation fails
   */
  async create(input: CreateSessionInput, ownerPhone: string): Promise<SessionRecord> {
    const validated = CreateSessionInputSchema.parse(input);

    if (this.active.size >= this.maxSessions) {
      throw new SessionLimitError(
        `Cannot create session: limit of ${this.maxSessions} concurrent sessions reached`,
      );
    }

    if (this.active.has(validated.project)) {
      throw new SessionAlreadyExistsError(
        `Session "${validated.project}" already exists. Use /switch ${validated.project} instead.`,
      );
    }

    const id = randomUUID();
    const now = new Date();
    const isFirstForOwner = ![...this.active.values()].some((s) => s.ownerPhone === ownerPhone);

    try {
      const db = getDb();
      db.insert(sessions)
        .values({
          id,
          project: validated.project,
          path: validated.path,
          ownerPhone,
          mode: validated.initialMode ?? "confirm",
          outputMode: validated.initialOutputMode ?? "verbose",
          contextPercent: 0,
          status: "active",
          focused: isFirstForOwner,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const runner = this.createRunner();
      runner.setEnv({
        JORCHBOT_SESSION_ID: id,
        JORCHBOT_GATEWAY_PORT: String(this.gatewayPort),
      });
      const approval = new ApprovalManager({
        sessionId: id,
        sendButtons: async (text, buttons) => {
          const prefix = isFirstForOwner ? "" : " (background)";
          await this.sendButtonsTo(ownerPhone, `[${validated.project}]${prefix} ${text}`, buttons);
        },
        reminderDelayMs: this.approvalReminderDelayMs,
      });

      this.wireRunnerEvents(runner, id, validated.project, ownerPhone);

      this.active.set(validated.project, {
        id,
        project: validated.project,
        path: validated.path,
        ownerPhone,
        runner,
        approval,
      });

      if (isFirstForOwner) {
        this.focusModel.setFocused(ownerPhone, validated.project);
      }

      // Generate hook config for tool approval (if hook scripts are available).
      // Env vars (JORCHBOT_SESSION_ID, JORCHBOT_GATEWAY_PORT) are set via runner.setEnv()
      // above and inherited by hook scripts through the spawned process env.
      if (this.hookScriptDir) {
        try {
          const hookConfig = generateHookConfig({
            hookScriptDir: this.hookScriptDir,
          });
          writeHookConfig(validated.path, hookConfig);
        } catch {
          // Best-effort — don't fail session creation if hook config fails
        }
      }

      // Register as OpenClaw agent (best-effort)
      try {
        registerAgent({ project: validated.project, projectPath: validated.path });
      } catch {
        // Best-effort — don't fail session creation if agent registration fails
      }

      return this.getSessionRecord(id);
    } catch (err: unknown) {
      // Rollback DB on failure
      try {
        const db = getDb();
        db.delete(sessions).where(eq(sessions.id, id)).run();
      } catch {
        // Best-effort rollback
      }

      if (err instanceof SessionLimitError || err instanceof SessionAlreadyExistsError) {
        throw err;
      }

      throw new SessionCreateError(`Failed to create session "${validated.project}"`, {
        cause: err,
      });
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
      await session.runner.stop();

      const db = getDb();
      db.update(sessions)
        .set({ status: "stopped", updatedAt: new Date() })
        .where(eq(sessions.id, session.id))
        .run();

      // Dispose output buffer for this session
      const sessionBuffer = this.outputBuffers.get(session.id);
      if (sessionBuffer) {
        sessionBuffer.dispose();
        this.outputBuffers.delete(session.id);
      }

      // Dispose approval manager timers
      session.approval.dispose();

      this.active.delete(project);

      // Notify Phase 3 cleanup (background tasks, tunnels)
      this.onSessionDestroy?.(project);

      // Unregister from OpenClaw agent config (best-effort)
      try {
        unregisterAgent(project);
      } catch {
        // Best-effort — don't fail session destroy if agent unregister fails
      }

      // Auto-switch focus to another session of the same owner
      const ownerPhone = session.ownerPhone;
      if (this.focusModel.getFocused(ownerPhone) === project) {
        const nextOwned = [...this.active.values()].find((s) => s.ownerPhone === ownerPhone);
        if (nextOwned) {
          this.focusModel.setFocused(ownerPhone, nextOwned.project);
          this.updateFocusInDb(nextOwned.project, true, ownerPhone);
        } else {
          this.focusModel.clearFocus(ownerPhone);
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
  async switchFocus(project: string, ownerPhone: string): Promise<void> {
    const session = this.active.get(project);
    if (!session) {
      throw new SessionNotFoundError(
        `No active session named "${project}". Use /list to see sessions.`,
      );
    }

    if (session.ownerPhone !== ownerPhone) {
      throw new SessionNotFoundError(
        `Session "${project}" belongs to another user. Use /list to see your sessions.`,
      );
    }

    const previousFocused = this.focusModel.getFocused(ownerPhone);
    if (previousFocused) {
      this.updateFocusInDb(previousFocused, false, ownerPhone);
    }

    this.focusModel.setFocused(ownerPhone, project);
    this.updateFocusInDb(project, true, ownerPhone);
  }

  /** List all sessions from DB (includes stopped sessions). */
  list(): SessionRecord[] {
    const db = getDb();
    return db.select().from(sessions).all() as SessionRecord[];
  }

  /** List only active sessions. Optionally filter by ownerPhone. */
  listActive(ownerPhone?: string): SessionRecord[] {
    const db = getDb();
    const rows = db
      .select()
      .from(sessions)
      .where(eq(sessions.status, "active"))
      .all() as SessionRecord[];

    if (ownerPhone) {
      return rows.filter((r) => r.ownerPhone === ownerPhone || r.ownerPhone === null);
    }
    return rows;
  }

  /** Get the currently focused session for a phone, or null. */
  getFocused(ownerPhone: string): ActiveSession | null {
    const focusedProject = this.focusModel.getFocused(ownerPhone);
    if (!focusedProject) {
      return null;
    }
    return this.active.get(focusedProject) ?? null;
  }

  /** Get an active session by project name, or null. */
  getByProject(project: string): ActiveSession | null {
    return this.active.get(project) ?? null;
  }

  /** List all active sessions with full details (runner, approval). */
  listActiveWithDetails(): ActiveSession[] {
    return [...this.active.values()];
  }

  /** Resolve an approval by its ID, routing to the correct session. */
  async resolveApproval(
    approvalId: string,
    approved: boolean,
    feedback?: string,
  ): Promise<boolean> {
    for (const session of this.active.values()) {
      const resolved = await session.approval.resolveApproval(approvalId, approved, feedback);
      if (resolved) {
        return true;
      }
    }
    return false;
  }

  /**
   * Mark an approval as awaiting feedback text from the user.
   * Returns the project name if the approval was found, null otherwise.
   */
  setAwaitingFeedback(approvalId: string): string | null {
    for (const session of this.active.values()) {
      if (session.approval.setAwaitingFeedback(approvalId)) {
        return session.project;
      }
    }
    return null;
  }

  /**
   * Check if a focused session has an approval awaiting feedback text.
   * Returns the approval ID if found, null otherwise.
   */
  getAwaitingFeedbackId(project: string): string | null {
    const session = this.active.get(project);
    if (!session) {
      return null;
    }
    return session.approval.getAwaitingFeedbackId();
  }

  /** Answer a pending question by resuming the session with the chosen answer. */
  async answerQuestion(project: string, answer: string): Promise<void> {
    const session = this.active.get(project);
    if (!session) {
      return;
    }

    // Block if context guard says so
    const guard = this.checkContextGuard(project);
    if (guard?.shouldBlock) {
      void this.sendReplyTo(session.ownerPhone, guard.message!);
      return;
    }

    this.pendingQuestions.delete(project);

    try {
      if (session.runner.getSessionId()) {
        await session.runner.resume({ prompt: answer, cwd: session.path });
      }
    } catch (err: unknown) {
      void this.sendReplyTo(
        session.ownerPhone,
        `[${project}] Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Check context guard for a project. Returns null if project not found. */
  checkContextGuard(project: string): ContextGuardResult | null {
    const session = this.active.get(project);
    if (!session) {
      return null;
    }

    const tokens = session.runner.getTokenCounts();
    const info = resolveContextInfo({
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      contextLimit: session.runner.getContextLimit(),
    });
    return evaluateContextGuard({
      info,
      thresholds: this.contextGuardThresholds,
      project,
    });
  }

  /**
   * Get formatted message logs for a session.
   * Returns oldest-first lines: `→ [type] content` (inbound) / `← [type] content` (outbound).
   */
  getSessionLogs(project: string, limit = 20): string[] {
    const session = this.active.get(project);
    if (!session) {
      return [];
    }

    const db = getDb();
    const rows = db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, session.id))
      .orderBy(desc(messages.createdAt))
      .limit(limit)
      .all();

    return rows.toReversed().map((row) => {
      const dir = row.direction === "inbound" ? "→" : "←";
      return `${dir} [${row.type}] ${row.content}`;
    });
  }

  /**
   * Restore sessions from DB on gateway restart.
   * Only restores sessions with status "active".
   */
  async restore(): Promise<number> {
    const db = getDb();
    const activeSessions = db.select().from(sessions).where(eq(sessions.status, "active")).all();

    let restored = 0;
    for (const record of activeSessions) {
      const ownerPhone = record.ownerPhone ?? "";
      const runner = this.createRunner();
      runner.setEnv({
        JORCHBOT_SESSION_ID: record.id,
        JORCHBOT_GATEWAY_PORT: String(this.gatewayPort),
      });
      const approval = new ApprovalManager({
        sessionId: record.id,
        sendButtons: (text, buttons) => this.sendButtonsTo(ownerPhone, text, buttons),
        reminderDelayMs: this.approvalReminderDelayMs,
      });

      this.wireRunnerEvents(runner, record.id, record.project, ownerPhone);

      this.active.set(record.project, {
        id: record.id,
        project: record.project,
        path: record.path,
        ownerPhone,
        runner,
        approval,
      });

      if (record.focused && ownerPhone) {
        this.focusModel.setFocused(ownerPhone, record.project);
      }

      restored++;
    }

    return restored;
  }

  /**
   * Get the current session record from DB by session UUID.
   * @throws {SessionNotFoundError} If session not found
   */
  getSessionRecordById(id: string): SessionRecord {
    const db = getDb();
    const record = db.select().from(sessions).where(eq(sessions.id, id)).get();
    if (!record) {
      throw new SessionNotFoundError(`Session ${id} not found in DB`);
    }
    return record as SessionRecord;
  }

  /**
   * Get the current session record from DB by project name.
   * @throws {SessionNotFoundError} If session not found
   */
  getSessionRecordByProject(project: string): SessionRecord {
    const session = this.active.get(project);
    if (!session) {
      throw new SessionNotFoundError(`Session "${project}" not found`);
    }
    return this.getSessionRecordById(session.id);
  }

  /**
   * Update the approval mode for a session.
   * Takes effect immediately — the next tool call will use the new mode.
   * @throws {SessionNotFoundError} If session doesn't exist
   */
  setMode(project: string, mode: ApprovalMode): void {
    const session = this.active.get(project);
    if (!session) {
      throw new SessionNotFoundError(`Session "${project}" not found`);
    }

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
    if (!session) {
      throw new SessionNotFoundError(`Session "${project}" not found`);
    }

    const db = getDb();
    db.update(sessions)
      .set({ outputMode, updatedAt: new Date() })
      .where(eq(sessions.id, session.id))
      .run();
  }

  /** Get the focused project name for a phone, or null. */
  getFocusedProject(ownerPhone: string): string | null {
    return this.focusModel.getFocused(ownerPhone);
  }

  // --- Private helpers ---

  private wireRunnerEvents(
    runner: ClaudeRunner,
    sessionId: string,
    project: string,
    ownerPhone: string,
  ): void {
    // Create per-session output buffer. Flush callback sends accumulated text.
    const buffer = new OutputBuffer((text) => {
      this.logMessage(sessionId, "outbound", "text", text);
      const record = this.getSessionRecord(sessionId);
      if (
        shouldSendToChat("text", record.outputMode) &&
        this.focusModel.getFocused(ownerPhone) === project
      ) {
        void this.sendChunkedMessage(ownerPhone, text, project);
      }
    });
    this.outputBuffers.set(sessionId, buffer);

    runner.on("text", (text) => {
      buffer.append(text);
      // Emit output for WS broadcast (Phase 6C)
      this.emit("output", project, text);
    });

    runner.on("toolUse", (request) => {
      this.logMessage(sessionId, "system", "approval", `Tool: ${request.toolName}`);
    });

    runner.on("result", (result) => {
      buffer.forceFlush();
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

      const isFocused = this.focusModel.getFocused(ownerPhone) === project;

      // Emit state change for WS broadcast (Phase 6C)
      this.emit("stateChange", project, {
        contextPercent,
        mode: "confirm",
        status: "active",
        focused: isFocused,
      });

      // Detect questions and send interactive buttons/lists instead of "Completed"
      const question = detectQuestion(result.textContent);
      if (question.isQuestion && isFocused) {
        this.pendingQuestions.set(project, { sessionId });

        if (question.type === "yes-no") {
          void this.sendButtonsTo(ownerPhone, `[${project}] ${question.questionText}`, [
            {
              id: JSON.stringify({ type: "question_answer", project, answer: "Sí" }),
              title: "Sí",
            },
            {
              id: JSON.stringify({ type: "question_answer", project, answer: "No" }),
              title: "No",
            },
          ]);
        } else if (question.options.length <= 3) {
          void this.sendButtonsTo(
            ownerPhone,
            `[${project}] ${question.questionText}`,
            question.options.map((opt) => ({
              id: JSON.stringify({ type: "question_answer", project, answer: opt }),
              title: opt.slice(0, 20),
            })),
          );
        } else {
          void this.sendListTo(
            ownerPhone,
            `[${project}] ${question.questionText}`,
            "Options",
            question.options.map((opt) => ({
              id: JSON.stringify({ type: "question_answer", project, answer: opt }),
              title: opt.slice(0, 24),
            })),
          );
        }

        return;
      }

      const suffix = isFocused ? "" : " (background)";
      void this.sendReplyTo(
        ownerPhone,
        `[${project}]${suffix} Completed. Context: ${contextPercent}%`,
      );

      const tokens = runner.getTokenCounts();
      const guardInfo = resolveContextInfo({
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        contextLimit: runner.getContextLimit(),
      });
      const guard = evaluateContextGuard({
        info: guardInfo,
        thresholds: this.contextGuardThresholds,
        project,
      });
      if (guard.message) {
        void this.sendReplyTo(ownerPhone, guard.message);
      }
    });

    runner.on("error", (err) => {
      buffer.forceFlush();
      this.logMessage(sessionId, "system", "error", err.message);
      void this.sendReplyTo(ownerPhone, `[${project}] Error: ${err.message}`);
    });
  }

  /** Log a message to the messages table. Best-effort — won't throw. */
  logMessage(
    sessionId: string,
    direction: "inbound" | "outbound" | "system",
    type: "text" | "approval" | "command" | "error" | "notification" | "shell",
    content: string,
  ): void {
    try {
      const db = getDb();
      db.insert(messages)
        .values({
          sessionId,
          direction,
          type,
          content,
          createdAt: new Date(),
        })
        .run();
    } catch {
      // Best-effort logging — don't crash on log failure
    }
  }

  private getSessionRecord(id: string): SessionRecord {
    return this.getSessionRecordById(id);
  }

  /** Send a message using smart chunking with optional document attachment. */
  private async sendChunkedMessage(phone: string, content: string, project: string): Promise<void> {
    const result = chunkForSession(content, project);

    for (const chunk of result.chunks) {
      await this.sendReplyTo(phone, chunk);
    }

    if (result.document && this.sendDocumentTo) {
      await this.sendDocumentTo(phone, result.document.content, result.document.filename);
    }
  }

  private updateFocusInDb(project: string, focused: boolean, ownerPhone: string): void {
    const session = this.active.get(project);
    if (!session) {
      return;
    }
    const db = getDb();
    if (focused) {
      // Unfocus all sessions of the same owner, then focus the target
      const ownedIds = [...this.active.values()]
        .filter((s) => s.ownerPhone === ownerPhone)
        .map((s) => s.id);
      for (const ownedId of ownedIds) {
        db.update(sessions)
          .set({ focused: false, updatedAt: new Date() })
          .where(eq(sessions.id, ownedId))
          .run();
      }
      db.update(sessions)
        .set({ focused: true, updatedAt: new Date() })
        .where(eq(sessions.id, session.id))
        .run();
    } else {
      db.update(sessions)
        .set({ focused: false, updatedAt: new Date() })
        .where(eq(sessions.id, session.id))
        .run();
    }
  }
}
