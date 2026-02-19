import { exec } from "node:child_process";
import { ShellRunnerTimeoutError } from "../../errors/index.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_LENGTH = 4096; // WhatsApp message limit

/**
 * Patterns that indicate dangerous commands.
 * Each pattern is tested against the full command string.
 */
const DANGEROUS_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
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

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated: boolean;
}

export interface DangerousCommandCheck {
  isDangerous: boolean;
  reason?: string;
}

/**
 * Executes shell commands directly in a workspace directory.
 *
 * This is JorchBot-specific (Layer 2). Does NOT use Claude Code and
 * does NOT consume tokens. Commands prefixed with $ in WhatsApp are
 * routed here.
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
    if (text.length <= MAX_OUTPUT_LENGTH) {
      return text;
    }
    return text.slice(0, MAX_OUTPUT_LENGTH - 20) + "\n... (truncated)";
  }
}
