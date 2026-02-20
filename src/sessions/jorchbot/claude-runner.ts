import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import {
  ClaudeRunnerSpawnError,
  ClaudeRunnerTimeoutError,
  ClaudeRunnerProcessError,
} from "../../errors/index.js";
import { DEFAULT_CONTEXT_LIMIT } from "./context-guard.js";

interface ClaudeStreamEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  message?: {
    role: string;
    content: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
  };
  content?: Array<{
    type: string;
    tool_use_id?: string;
    content?: string;
  }>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  result?: string;
  cost_usd?: number;
  duration_ms?: number;
}

export interface ToolUseRequest {
  toolUseId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

export interface ClaudeRunnerResult {
  sessionId: string;
  textContent: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
}

interface ClaudeRunnerEvents {
  text: [text: string];
  toolUse: [request: ToolUseRequest];
  result: [result: ClaudeRunnerResult];
  error: [error: Error];
}

export type ClaudeRunnerStatus = "idle" | "running" | "stopped" | "error";

const CLAUDE_BINARY = "claude";
const DEFAULT_TIMEOUT_MS = 300_000;
const KILL_TIMEOUT_MS = 5_000;

export class ClaudeRunner extends EventEmitter<ClaudeRunnerEvents> {
  private process: ChildProcess | null = null;
  private readline: ReadlineInterface | null = null;
  private sessionId: string | null = null;
  private status: ClaudeRunnerStatus = "idle";
  private skipPermissions = true;
  private accumulatedText = "";
  private lastInputTokens = 0;
  private lastOutputTokens = 0;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private contextLimit: number;
  private extraEnv: Record<string, string> = {};

  constructor(options?: { contextLimit?: number }) {
    super();
    this.contextLimit = options?.contextLimit ?? DEFAULT_CONTEXT_LIMIT;
  }

  /**
   * Set extra environment variables for the spawned Claude Code process.
   * Used by SessionManager to inject JORCHBOT_SESSION_ID, JORCHBOT_GATEWAY_PORT.
   * Hook scripts inherit these from the parent process — no need to bake them
   * into the hook command strings.
   */
  setEnv(env: Record<string, string>): void {
    this.extraEnv = { ...this.extraEnv, ...env };
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  getStatus(): ClaudeRunnerStatus {
    return this.status;
  }

  getTokenCounts(): { input: number; output: number } {
    return { input: this.lastInputTokens, output: this.lastOutputTokens };
  }

  getContextPercent(): number {
    const total = this.lastInputTokens + this.lastOutputTokens;
    if (total === 0) {
      return 0;
    }
    return Math.min(100, Math.round((total / this.contextLimit) * 100));
  }

  getContextLimit(): number {
    return this.contextLimit;
  }

  async start(options: {
    prompt: string;
    cwd: string;
    systemPrompt?: string;
    allowedTools?: string[];
    timeoutMs?: number;
    skipPermissions?: boolean;
  }): Promise<ClaudeRunnerResult> {
    this.skipPermissions = options.skipPermissions !== false;
    const args = ["-p", options.prompt, "--output-format", "stream-json"];

    // Claude Code hangs in headless mode without this flag (piped stdin blocks).
    // Tool-level approval via WhatsApp buttons requires a different mechanism (Phase 2+).
    if (this.skipPermissions) {
      args.push("--dangerously-skip-permissions");
    }

    if (options.systemPrompt) {
      args.push("--append-system-prompt", options.systemPrompt);
    }

    if (options.allowedTools?.length) {
      args.push("--allowedTools", options.allowedTools.join(","));
    }

    return this.run(args, options.cwd, options.timeoutMs, options.skipPermissions !== false);
  }

  async resume(options: {
    prompt: string;
    cwd: string;
    timeoutMs?: number;
  }): Promise<ClaudeRunnerResult> {
    if (!this.sessionId) {
      throw new ClaudeRunnerProcessError("No session to resume. Call start() first.");
    }

    const args = [
      "-p",
      options.prompt,
      "--resume",
      this.sessionId,
      "--output-format",
      "stream-json",
    ];

    if (this.skipPermissions) {
      args.push("--dangerously-skip-permissions");
    }

    return this.run(args, options.cwd, options.timeoutMs, this.skipPermissions);
  }

  async stop(): Promise<void> {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }

    if (!this.process) {
      this.status = "stopped";
      return;
    }

    const proc = this.process;
    this.process = null;
    this.status = "stopped";

    proc.kill("SIGTERM");

    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        proc.kill("SIGKILL");
        resolve();
      }, KILL_TIMEOUT_MS);

      proc.once("exit", () => {
        clearTimeout(killTimer);
        resolve();
      });
    });

    this.readline?.close();
    this.readline = null;
  }

  private async run(
    args: string[],
    cwd: string,
    timeoutMs?: number,
    skipPermissions = true,
  ): Promise<ClaudeRunnerResult> {
    this.accumulatedText = "";
    this.status = "running";

    return new Promise<ClaudeRunnerResult>((resolve, reject) => {
      try {
        const nodeOptions = process.env.NODE_OPTIONS ?? "";
        // stdin: "ignore" when permissions are skipped (no need to write to stdin).
        // stdin: "pipe" when we need to send approval responses (Phase 2+).
        const stdinMode = skipPermissions ? "ignore" : ("pipe" as const);
        this.process = spawn(CLAUDE_BINARY, args, {
          cwd,
          stdio: [stdinMode, "pipe", "pipe"],
          env: {
            ...process.env,
            ...this.extraEnv,
            NODE_OPTIONS: nodeOptions ? `${nodeOptions} --no-warnings` : "--no-warnings",
            // Hook scripts check this to avoid firing for non-JorchBot Claude instances.
            // JORCHBOT_SESSION_ID and JORCHBOT_GATEWAY_PORT are set via setEnv() by SessionManager.
            JORCHBOT_ACTIVE: "1",
          },
        });
      } catch (err: unknown) {
        this.status = "error";
        reject(
          new ClaudeRunnerSpawnError(
            `Failed to spawn claude: ${err instanceof Error ? err.message : String(err)}`,
            { cause: err },
          ),
        );
        return;
      }

      console.log("[claude-runner] spawned PID:", this.process.pid, "args:", args.join(" "));

      const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
      this.timeoutHandle = setTimeout(() => {
        this.stop().catch(() => {});
        reject(new ClaudeRunnerTimeoutError(`Claude Code timed out after ${timeout}ms`));
      }, timeout);

      this.readline = createInterface({ input: this.process.stdout! });

      this.readline.on("line", (line) => {
        if (!line.trim()) {
          return;
        }

        console.log("[claude-runner] raw line:", line.slice(0, 200));

        let event: ClaudeStreamEvent;
        try {
          event = JSON.parse(line) as ClaudeStreamEvent;
        } catch {
          console.log("[claude-runner] JSON parse failed for line");
          return;
        }

        console.log("[claude-runner] event type:", event.type, event.subtype ?? "");
        this.handleStreamEvent(event);
      });

      let stderr = "";
      this.process.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        console.log("[claude-runner] stderr:", text.slice(0, 300));
      });

      this.process.once("exit", (code, signal) => {
        if (this.timeoutHandle) {
          clearTimeout(this.timeoutHandle);
          this.timeoutHandle = null;
        }

        this.readline?.close();
        this.readline = null;
        this.process = null;

        if (code === 0 || signal === "SIGTERM") {
          this.status = "idle";
          resolve({
            sessionId: this.sessionId ?? "",
            textContent: this.accumulatedText,
            inputTokens: this.lastInputTokens,
            outputTokens: this.lastOutputTokens,
            costUsd: 0,
            durationMs: 0,
          });
        } else {
          this.status = "error";
          reject(
            new ClaudeRunnerProcessError(
              `Claude Code exited with code ${code}${stderr ? `: ${stderr.slice(0, 500)}` : ""}`,
            ),
          );
        }
      });

      this.process.once("error", (err) => {
        if (this.timeoutHandle) {
          clearTimeout(this.timeoutHandle);
          this.timeoutHandle = null;
        }
        this.status = "error";
        reject(
          new ClaudeRunnerSpawnError(`Failed to spawn claude: ${err.message}`, { cause: err }),
        );
      });
    });
  }

  private handleStreamEvent(event: ClaudeStreamEvent): void {
    switch (event.type) {
      case "system": {
        if (event.subtype === "init" && event.session_id) {
          this.sessionId = event.session_id;
        }
        break;
      }

      case "assistant": {
        const content = event.message?.content;
        if (!content) {
          break;
        }

        for (const block of content) {
          console.log("[claude-runner] block type:", block.type);
          if (block.type === "text" && block.text) {
            console.log("[claude-runner] emitting text:", block.text.slice(0, 100));
            this.accumulatedText += block.text;
            this.emit("text", block.text);
          }

          if (block.type === "tool_use" && block.id && block.name) {
            // With --dangerously-skip-permissions, tools execute automatically.
            // The toolUse event is informational (for logging/UI), not for approval.
            this.emit("toolUse", {
              toolUseId: block.id,
              toolName: block.name,
              toolInput: block.input ?? {},
            });
          }
        }
        break;
      }

      case "result": {
        // Slash commands (e.g. /usage, /plan) return text in event.result
        // instead of as assistant text blocks. Capture it so it's not lost.
        if (event.result && !this.accumulatedText) {
          this.accumulatedText = event.result;
          this.emit("text", event.result);
        }

        if (event.usage) {
          const newInputTokens =
            event.usage.input_tokens +
            (event.usage.cache_creation_input_tokens ?? 0) +
            (event.usage.cache_read_input_tokens ?? 0);
          const newOutputTokens = event.usage.output_tokens;

          // Context window only grows — never report a decrease across resumes.
          // Each `claude --resume` invocation reports per-run usage, which can be
          // smaller than the previous run if fewer agentic-loop iterations occurred.
          const newTotal = newInputTokens + newOutputTokens;
          const currentTotal = this.lastInputTokens + this.lastOutputTokens;

          if (newTotal >= currentTotal) {
            this.lastInputTokens = newInputTokens;
            this.lastOutputTokens = newOutputTokens;
          }
        }

        this.emit("result", {
          sessionId: event.session_id ?? this.sessionId ?? "",
          textContent: this.accumulatedText,
          inputTokens: this.lastInputTokens,
          outputTokens: this.lastOutputTokens,
          costUsd: event.cost_usd ?? 0,
          durationMs: event.duration_ms ?? 0,
        });
        break;
      }
    }
  }
}
