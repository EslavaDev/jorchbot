import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import {
  ClaudeRunnerSpawnError,
  ClaudeRunnerTimeoutError,
  ClaudeRunnerProcessError,
} from "../../errors/index.js";

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

export type ClaudeRunnerStatus = "idle" | "running" | "waiting_approval" | "stopped" | "error";

const CLAUDE_BINARY = "claude";
const DEFAULT_TIMEOUT_MS = 300_000;
const KILL_TIMEOUT_MS = 5_000;
const MODEL_CONTEXT_LIMIT = 200_000;

export class ClaudeRunner extends EventEmitter<ClaudeRunnerEvents> {
  private process: ChildProcess | null = null;
  private readline: ReadlineInterface | null = null;
  private sessionId: string | null = null;
  private status: ClaudeRunnerStatus = "idle";
  private accumulatedText = "";
  private lastInputTokens = 0;
  private lastOutputTokens = 0;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  getSessionId(): string | null {
    return this.sessionId;
  }

  getStatus(): ClaudeRunnerStatus {
    return this.status;
  }

  getContextPercent(): number {
    const total = this.lastInputTokens + this.lastOutputTokens;
    if (total === 0) {
      return 0;
    }
    return Math.min(100, Math.round((total / MODEL_CONTEXT_LIMIT) * 100));
  }

  async start(options: {
    prompt: string;
    cwd: string;
    systemPrompt?: string;
    allowedTools?: string[];
    timeoutMs?: number;
  }): Promise<ClaudeRunnerResult> {
    const args = [
      "-p",
      options.prompt,
      "--output-format",
      "stream-json",
      "--dangerously-skip-permissions",
    ];

    if (options.systemPrompt) {
      args.push("--append-system-prompt", options.systemPrompt);
    }

    if (options.allowedTools?.length) {
      args.push("--allowedTools", options.allowedTools.join(","));
    }

    return this.run(args, options.cwd, options.timeoutMs);
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

    return this.run(args, options.cwd, options.timeoutMs);
  }

  respondToApproval(approved: boolean): void {
    if (!this.process?.stdin?.writable) {
      throw new ClaudeRunnerProcessError(
        "Cannot respond to approval: no active process or stdin not writable",
      );
    }

    if (this.status !== "waiting_approval") {
      throw new ClaudeRunnerProcessError(
        `Cannot respond to approval: runner status is "${this.status}", expected "waiting_approval"`,
      );
    }

    const response = approved ? "yes\n" : "no\n";
    this.process.stdin.write(response);
    this.status = "running";
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

  private async run(args: string[], cwd: string, timeoutMs?: number): Promise<ClaudeRunnerResult> {
    this.accumulatedText = "";
    this.status = "running";

    return new Promise<ClaudeRunnerResult>((resolve, reject) => {
      try {
        const nodeOptions = process.env.NODE_OPTIONS ?? "";
        this.process = spawn(CLAUDE_BINARY, args, {
          cwd,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            NODE_OPTIONS: nodeOptions ? `${nodeOptions} --no-warnings` : "--no-warnings",
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
            this.status = "waiting_approval";
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
        if (event.usage) {
          this.lastInputTokens =
            event.usage.input_tokens +
            (event.usage.cache_creation_input_tokens ?? 0) +
            (event.usage.cache_read_input_tokens ?? 0);
          this.lastOutputTokens = event.usage.output_tokens;
        }

        this.emit("result", {
          sessionId: event.session_id ?? this.sessionId ?? "",
          textContent: this.accumulatedText,
          inputTokens:
            (event.usage?.input_tokens ?? 0) +
            (event.usage?.cache_creation_input_tokens ?? 0) +
            (event.usage?.cache_read_input_tokens ?? 0),
          outputTokens: event.usage?.output_tokens ?? 0,
          costUsd: event.cost_usd ?? 0,
          durationMs: event.duration_ms ?? 0,
        });
        break;
      }
    }
  }
}
