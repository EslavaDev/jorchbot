import type { SessionManager, ActiveSession } from "../sessions/jorchbot/manager.js";
import type { ShellRunner } from "../sessions/jorchbot/shell-runner.js";

export interface IncomingMessage {
  text: string;
  senderId: string;
  channel: string;
  messageId: string;
}

type RouteResult =
  | { type: "command"; command: string; args: string[] }
  | { type: "claude_command"; command: string; args: string[] }
  | { type: "shell"; command: string }
  | { type: "prompt"; text: string }
  | { type: "error"; message: string };

export interface CommandRouterDeps {
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

    // Log inbound message
    const focused = this.deps.sessionManager.getFocused();
    if (focused) {
      const type =
        parsed.type === "shell"
          ? "shell"
          : parsed.type === "command" || parsed.type === "claude_command"
            ? "command"
            : "text";
      this.deps.sessionManager.logMessage(focused.id, "inbound", type, message.text);
    }

    switch (parsed.type) {
      case "command": {
        await this.handleCommand(parsed.command, parsed.args);
        break;
      }

      case "claude_command": {
        await this.handleClaudeCommand(parsed.command, parsed.args);
        break;
      }

      case "shell": {
        await this.handleShell(parsed.command);
        break;
      }

      case "prompt": {
        await this.handlePrompt(parsed.text);
        break;
      }

      case "error": {
        await this.deps.sendReply(parsed.message);
        break;
      }
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

    // ! prefix → Claude Code command
    if (trimmed.startsWith("!")) {
      const parts = trimmed.slice(1).split(/\s+/);
      const command = parts[0]?.toLowerCase() ?? "";
      const args = parts.slice(1);
      if (!command) {
        return { type: "error", message: "Empty Claude command. Usage: !<command>" };
      }
      return { type: "claude_command", command, args };
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
    const logs = this.deps.sessionManager.getSessionLogs(project, count);

    if (logs.length === 0) {
      await this.deps.sendReply(`[${project}] No messages logged.`);
      return;
    }

    await this.deps.sendReply(`[${project}] Last ${logs.length} messages:\n\n${logs.join("\n")}`);
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

    await this.deps.sendReply(`[${project}] Compacting context...`);

    try {
      const previousContext = session.runner.getContextPercent();
      await session.runner.stop();

      await session.runner.start({
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

    const check = this.deps.shellRunner.checkDangerous(command);
    if (check.isDangerous) {
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

      const reply = `[${session.project}] $ ${command}\n${output}${exitInfo}${truncInfo}`;
      this.deps.sessionManager.logMessage(session.id, "outbound", "shell", reply);
      await this.deps.sendReply(reply);
    } catch (err: unknown) {
      const errMsg = `[${session.project}] Shell error: ${err instanceof Error ? err.message : String(err)}`;
      this.deps.sessionManager.logMessage(session.id, "outbound", "error", errMsg);
      await this.deps.sendReply(errMsg);
    }
  }

  private async handleClaudeCommand(command: string, args: string[]): Promise<void> {
    switch (command) {
      case "usage":
        await this.handleClaudeUsage();
        break;
      case "context":
        await this.handleClaudeContext();
        break;
      case "compact":
        await this.handleClaudeCompact();
        break;
      case "clear":
        await this.handleClaudeClear();
        break;
      default:
        // Forward other ! commands as prompts to Claude Code
        await this.forwardToClaudeCode(command, args);
    }
  }

  private async handleClaudeCompact(): Promise<void> {
    const focused = this.deps.sessionManager.getFocused();
    if (!focused) {
      await this.deps.sendReply("No active session. Use /new <project> <path> first.");
      return;
    }

    await this.handleCompact([focused.project]);
  }

  private async handleClaudeClear(): Promise<void> {
    const focused = this.deps.sessionManager.getFocused();
    if (!focused) {
      await this.deps.sendReply("No active session. Use /new <project> <path> first.");
      return;
    }

    try {
      await focused.runner.stop();

      // Reset session ID so next prompt starts fresh
      await this.deps.sessionManager.destroy(focused.project);
      const session = await this.deps.sessionManager.create({
        project: focused.project,
        path: focused.path,
      });

      await this.deps.sendReply(
        `[${focused.project}] Session cleared. New session: ${session.id.slice(0, 8)}`,
      );
    } catch (err: unknown) {
      await this.deps.sendReply(
        `[${focused.project}] Clear failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async handleClaudeUsage(): Promise<void> {
    const focused = this.deps.sessionManager.getFocused();
    if (!focused) {
      await this.deps.sendReply("No active session. Use /new <project> <path> first.");
      return;
    }

    const tokens = focused.runner.getTokenCounts();
    const contextPercent = focused.runner.getContextPercent();
    const status = focused.runner.getStatus();
    const sessionId = focused.runner.getSessionId();

    const lines = [
      `*[${focused.project}] Session Usage*`,
      "",
      `Status: ${status}`,
      `Context: ${contextPercent}%`,
      `Input tokens: ${tokens.input.toLocaleString()}`,
      `Output tokens: ${tokens.output.toLocaleString()}`,
      `Total tokens: ${(tokens.input + tokens.output).toLocaleString()}`,
      `Session ID: ${sessionId ? sessionId.slice(0, 8) : "none"}`,
    ];

    await this.deps.sendReply(lines.join("\n"));
  }

  private async handleClaudeContext(): Promise<void> {
    const focused = this.deps.sessionManager.getFocused();
    if (!focused) {
      await this.deps.sendReply("No active session. Use /new <project> <path> first.");
      return;
    }

    const contextPercent = focused.runner.getContextPercent();
    const tokens = focused.runner.getTokenCounts();
    const total = tokens.input + tokens.output;
    const limit = focused.runner.getContextLimit();

    const bar = this.renderContextBar(contextPercent);
    const guard = this.deps.sessionManager.checkContextGuard(focused.project);
    const warning =
      guard?.level === "block"
        ? "\nContext limit reached. Use !compact to free space."
        : guard?.level === "critical"
          ? "\nUse !compact to free space."
          : guard?.level === "warn"
            ? "\nConsider !compact soon."
            : "";

    await this.deps.sendReply(
      `[${focused.project}] Context: ${contextPercent}%\n${bar}\n${total.toLocaleString()} / ${limit.toLocaleString()} tokens (input: ${tokens.input.toLocaleString()} + output: ${tokens.output.toLocaleString()})${warning}`,
    );
  }

  private renderContextBar(percent: number): string {
    const filled = Math.round(percent / 5);
    const empty = 20 - filled;
    return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
  }

  private async forwardToClaudeCode(command: string, args: string[]): Promise<void> {
    const focused = this.deps.sessionManager.getFocused();
    if (!focused) {
      await this.deps.sendReply("No active session. Use /new <project> <path> first.");
      return;
    }

    const guard = this.deps.sessionManager.checkContextGuard(focused.project);
    if (guard?.shouldBlock) {
      await this.deps.sendReply(guard.message!);
      return;
    }

    const slashCommand = `/${command}${args.length > 0 ? ` ${args.join(" ")}` : ""}`;

    try {
      const runner = focused.runner;
      if (runner.getSessionId()) {
        await runner.resume({ prompt: slashCommand, cwd: focused.path });
      } else {
        await runner.start({ prompt: slashCommand, cwd: focused.path });
      }
    } catch (err: unknown) {
      await this.deps.sendReply(
        `[${focused.project}] Error: ${err instanceof Error ? err.message : String(err)}`,
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
      "*Claude Code:*",
      "!usage — Session token counts and context %",
      "!context — Context window usage",
      "!compact — Compact focused session",
      "!clear — Reset focused session",
      "!<command> — Send as prompt to Claude Code",
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

    const guard = this.deps.sessionManager.checkContextGuard(focused.project);
    if (guard?.shouldBlock) {
      await this.deps.sendReply(guard.message!);
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
