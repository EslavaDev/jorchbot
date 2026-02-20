import { randomUUID } from "node:crypto";
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
import { detectQuestion } from "./question-detector.js";

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
});

export type CreateSessionInput = z.infer<typeof CreateSessionInputSchema>;

// --- Interfaces ---

export interface ActiveSession {
  id: string;
  project: string;
  path: string;
  runner: ClaudeRunner;
  approval: ApprovalManager;
}

export interface SessionRecord {
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

interface SessionManagerDeps {
  maxSessions?: number;
  gatewayPort?: number;
  hookScriptDir?: string;
  contextGuard?: ContextGuardThresholds & { contextLimit?: number };
  sendReply: (text: string) => Promise<void>;
  sendButtons: (text: string, buttons: Array<{ id: string; title: string }>) => Promise<void>;
  sendList?: (
    text: string,
    buttonText: string,
    options: Array<{ id: string; title: string; description?: string }>,
  ) => Promise<void>;
  createRunner?: () => ClaudeRunner;
}

const DEFAULT_MAX_SESSIONS = 5;

export class SessionManager {
  private active = new Map<string, ActiveSession>();
  private pendingQuestions = new Map<string, { sessionId: string }>();
  private focusModel: FocusModel;
  private maxSessions: number;
  private gatewayPort: number;
  private hookScriptDir: string | null;
  private contextGuardThresholds: ContextGuardThresholds;
  private contextGuardLimit: number | undefined;
  private sendReply: (text: string) => Promise<void>;
  private sendButtons: (
    text: string,
    buttons: Array<{ id: string; title: string }>,
  ) => Promise<void>;
  private sendList: (
    text: string,
    buttonText: string,
    options: Array<{ id: string; title: string; description?: string }>,
  ) => Promise<void>;
  private createRunner: () => ClaudeRunner;

  constructor(deps: SessionManagerDeps) {
    this.maxSessions = deps.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.gatewayPort = deps.gatewayPort ?? 18789;
    this.hookScriptDir = deps.hookScriptDir ?? null;
    this.contextGuardThresholds = {
      warnPercent: deps.contextGuard?.warnPercent,
      criticalPercent: deps.contextGuard?.criticalPercent,
      blockPercent: deps.contextGuard?.blockPercent,
    };
    this.contextGuardLimit = deps.contextGuard?.contextLimit;
    this.sendReply = deps.sendReply;
    this.sendButtons = deps.sendButtons;
    this.sendList = deps.sendList ?? (async () => {});
    this.createRunner =
      deps.createRunner ?? (() => new ClaudeRunner({ contextLimit: this.contextGuardLimit }));
    this.focusModel = new FocusModel();
  }

  /**
   * Create a new session for a project.
   *
   * @throws {SessionLimitError} If max concurrent sessions reached
   * @throws {SessionAlreadyExistsError} If a session with this project name exists
   * @throws {SessionCreateError} If DB insert or runner creation fails
   */
  async create(input: CreateSessionInput): Promise<SessionRecord> {
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
    const isFirst = this.active.size === 0;

    try {
      const db = getDb();
      db.insert(sessions)
        .values({
          id,
          project: validated.project,
          path: validated.path,
          mode: "confirm",
          outputMode: "verbose",
          contextPercent: 0,
          status: "active",
          focused: isFirst,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const runner = this.createRunner();
      const approval = new ApprovalManager({
        sessionId: id,
        sendButtons: async (text, buttons) => {
          const prefix = isFirst ? "" : " (background)";
          await this.sendButtons(`[${validated.project}]${prefix} ${text}`, buttons);
        },
      });

      this.wireRunnerEvents(runner, id, validated.project);

      this.active.set(validated.project, {
        id,
        project: validated.project,
        path: validated.path,
        runner,
        approval,
      });

      if (isFirst) {
        this.focusModel.setFocused(validated.project);
      }

      // Generate hook config for tool approval (if hook scripts are available)
      if (this.hookScriptDir) {
        try {
          const hookConfig = generateHookConfig({
            gatewayPort: this.gatewayPort,
            hookScriptDir: this.hookScriptDir,
            sessionId: id,
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

      this.active.delete(project);

      // Unregister from OpenClaw agent config (best-effort)
      try {
        unregisterAgent(project);
      } catch {
        // Best-effort — don't fail session destroy if agent unregister fails
      }

      if (this.focusModel.getFocused() === project) {
        const next = this.active.keys().next().value;
        if (next) {
          this.focusModel.setFocused(next);
          this.updateFocusInDb(next, true);
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
  async resolveApproval(approvalId: string, approved: boolean): Promise<boolean> {
    for (const session of this.active.values()) {
      const resolved = await session.approval.resolveApproval(approvalId, approved);
      if (resolved) {
        return true;
      }
    }
    return false;
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
      void this.sendReply(guard.message!);
      return;
    }

    this.pendingQuestions.delete(project);

    try {
      if (session.runner.getSessionId()) {
        await session.runner.resume({ prompt: answer, cwd: session.path });
      }
    } catch (err: unknown) {
      void this.sendReply(
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
      const runner = this.createRunner();
      const approval = new ApprovalManager({
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

  private wireRunnerEvents(runner: ClaudeRunner, sessionId: string, project: string): void {
    runner.on("text", (text) => {
      this.logMessage(sessionId, "outbound", "text", text);

      if (this.focusModel.getFocused() === project) {
        void this.sendReply(`[${project}] ${text}`);
      }
    });

    runner.on("toolUse", (request) => {
      this.logMessage(sessionId, "system", "approval", `Tool: ${request.toolName}`);
    });

    runner.on("result", (result) => {
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

      const isFocused = this.focusModel.getFocused() === project;

      // Detect questions and send interactive buttons/lists instead of "Completed"
      const question = detectQuestion(result.textContent);
      if (question.isQuestion && isFocused) {
        this.pendingQuestions.set(project, { sessionId });

        if (question.type === "yes-no") {
          void this.sendButtons(`[${project}] ${question.questionText}`, [
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
          void this.sendButtons(
            `[${project}] ${question.questionText}`,
            question.options.map((opt) => ({
              id: JSON.stringify({ type: "question_answer", project, answer: opt }),
              title: opt.slice(0, 20),
            })),
          );
        } else {
          void this.sendList(
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
      void this.sendReply(`[${project}]${suffix} Completed. Context: ${contextPercent}%`);

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
        void this.sendReply(guard.message);
      }
    });

    runner.on("error", (err) => {
      this.logMessage(sessionId, "system", "error", err.message);
      void this.sendReply(`[${project}] Error: ${err.message}`);
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
    const db = getDb();
    const record = db.select().from(sessions).where(eq(sessions.id, id)).get();
    if (!record) {
      throw new SessionNotFoundError(`Session ${id} not found in DB`);
    }
    return record as SessionRecord;
  }

  private updateFocusInDb(project: string, focused: boolean): void {
    const session = this.active.get(project);
    if (!session) {
      return;
    }
    const db = getDb();
    if (focused) {
      // First unfocus all, then focus the target
      db.update(sessions).set({ focused: false, updatedAt: new Date() }).run();
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
