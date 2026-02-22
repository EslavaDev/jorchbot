import type { JorchfileExecutor } from "../jorchfile/executor.js";
import type { readMakefileTargets as ReadMakefileTargetsFn } from "../jorchfile/makefile-reader.js";
import type { BackgroundTaskManager } from "../jorchfile/task-manager.js";
import { formatUptime } from "../jorchfile/task-manager.js";
import type { SessionManager, ActiveSession } from "../sessions/jorchbot/manager.js";
import type { ShellRunner } from "../sessions/jorchbot/shell-runner.js";
import type { ApprovalMode, OutputMode } from "../sessions/jorchbot/types.js";
import { TunnelPendingConfirmation } from "../tunnels/manager.js";
import type { TunnelManager } from "../tunnels/manager.js";
import type { GuiCommandDeps } from "./gui-command.js";
import { handleGuiCommand } from "./gui-command.js";

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
  sendList?: (
    text: string,
    buttonText: string,
    options: Array<{ id: string; title: string; description?: string }>,
  ) => Promise<void>;
  /** Getter function for hot-reload: returns null if no Jorchfile loaded */
  getJorchfileExecutor?: () => JorchfileExecutor | null;
  taskManager?: BackgroundTaskManager;
  tunnelManager?: TunnelManager;
  readMakefileTargets?: typeof ReadMakefileTargetsFn;
  guiCommandDeps?: GuiCommandDeps;
}

export class CommandRouter {
  private deps: CommandRouterDeps;
  /** Current sender phone — set per route() call, used by handlers for session lookups. */
  private currentSenderId: string = "";

  constructor(deps: CommandRouterDeps) {
    this.deps = deps;
  }

  async route(message: IncomingMessage): Promise<void> {
    this.currentSenderId = message.senderId;
    const parsed = this.parse(message.text);

    // Log inbound message
    const focused = this.deps.sessionManager.getFocused(this.currentSenderId);
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
    const focused = this.deps.sessionManager.getFocused(this.currentSenderId);
    if (!focused) {
      return {
        type: "error",
        message: "No active session. Use /new <project> <path> to create one.",
      };
    }

    return { type: "prompt", text: trimmed };
  }

  private async handleCommand(command: string, args: string[]): Promise<void> {
    // --- Tier 1: Built-in commands ---
    switch (command) {
      // Session commands
      case "new":
        await this.handleNew(args);
        return;
      case "switch":
        await this.handleSwitch(args);
        return;
      case "list":
        await this.handleList();
        return;
      case "stop":
        await this.handleStop(args);
        return;
      case "logs":
        await this.handleLogs(args);
        return;
      case "compact":
        await this.handleCompact(args);
        return;

      // Phase 4: Tunnel commands
      case "tunnel":
        await this.handleTunnel(args);
        return;
      case "tunnel-stop":
        await this.handleTunnelStop(args);
        return;
      case "tunnels":
        await this.handleTunnels();
        return;

      // Phase 3: Jorchfile commands
      case "projects":
        await this.handleProjects();
        return;
      case "tasks":
        await this.handleTasks();
        return;
      case "stop-cmd":
        await this.handleStopCmd(args);
        return;
      case "make":
        await this.handleMake(args);
        return;

      // Phase 5: Mode commands
      case "mode":
        await this.handleMode(args);
        return;
      case "output":
        await this.handleOutput(args);
        return;

      // Phase 6: GUI command
      case "gui":
        await this.handleGui(args);
        return;

      // General
      case "help":
        await this.handleHelp(args);
        return;
      case "status":
        await this.handleStatus();
        return;
    }

    // --- Tier 2: Jorchfile dynamic commands ---
    const executor = this.deps.getJorchfileExecutor?.();
    if (executor?.hasCommand(command)) {
      // Parse trailing & for background
      let forceBackground = false;
      let projectName: string | undefined = args[0];
      const lastArg = args.at(-1);
      if (lastArg === "&") {
        forceBackground = true;
        projectName = args.length > 1 ? args[0] : undefined;
      } else if (projectName?.endsWith("&")) {
        forceBackground = true;
        projectName = projectName.slice(0, -1) || undefined;
      }

      await executor.execute(command, projectName, forceBackground, this.currentSenderId);
      return;
    }

    // --- Tier 3: Shell shortcuts ---
    switch (command) {
      case "ls":
        await this.handleShell(`ls -la ${args.join(" ")}`.trim());
        return;
      case "cat":
        await this.handleShell(`cat ${args.join(" ")}`.trim());
        return;
      case "grep":
        await this.handleShell(`grep -rn ${args.join(" ")}`.trim());
        return;
      case "pwd":
        await this.handleShell("pwd");
        return;
      case "git":
        await this.handleShell(`git ${args.join(" ")}`.trim());
        return;
      case "tree":
        await this.handleShell(`tree -L ${args[0] ?? "3"}`.trim());
        return;
    }

    // --- Tier 4: Unknown command ---
    await this.deps.sendReply(`Unknown command: /${command}\nUse /help to see available commands.`);
  }

  private async handleNew(args: string[]): Promise<void> {
    const [project, ...pathParts] = args;
    if (!project) {
      await this.deps.sendReply("Usage: /new <project> [path]");
      return;
    }

    // Check Jorchfile first
    const executor = this.deps.getJorchfileExecutor?.();
    const jorchProject = executor?.getProject(project);
    const explicitPath = pathParts.join(" ").trim();

    let projectPath: string;
    let systemPrompt: string | undefined;
    let fromJorchfile = false;

    if (jorchProject && !explicitPath) {
      projectPath = jorchProject.path;
      systemPrompt = jorchProject.instructions;
      fromJorchfile = true;
    } else if (explicitPath) {
      projectPath = explicitPath;
    } else {
      await this.deps.sendReply(
        `Project "${project}" not found in Jorchfile and no path provided.\nUsage: /new <project> <path>`,
      );
      return;
    }

    try {
      const session = await this.deps.sessionManager.create(
        {
          project,
          path: projectPath,
          systemPrompt,
          initialMode: jorchProject?.approve,
          initialOutputMode: jorchProject?.output,
        },
        this.currentSenderId,
      );

      const tag = fromJorchfile ? " (from Jorchfile)" : "";
      await this.deps.sendReply(
        [
          `[${project}] Session created${tag}`,
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
      await this.deps.sessionManager.switchFocus(project, this.currentSenderId);
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
    const activeSessions = this.deps.sessionManager.listActive(this.currentSenderId);

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

    // Check ownership
    const session = this.deps.sessionManager.getByProject(project);
    if (session && session.ownerPhone !== this.currentSenderId) {
      await this.deps.sendReply(`Session "${project}" belongs to another user.`);
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
    const focused = this.deps.sessionManager.getFocused(this.currentSenderId);
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
    const focused = this.deps.sessionManager.getFocused(this.currentSenderId);
    if (!focused) {
      await this.deps.sendReply("No active session. Use /new <project> <path> first.");
      return;
    }

    await this.handleCompact([focused.project]);
  }

  private async handleClaudeClear(): Promise<void> {
    const focused = this.deps.sessionManager.getFocused(this.currentSenderId);
    if (!focused) {
      await this.deps.sendReply("No active session. Use /new <project> <path> first.");
      return;
    }

    try {
      await focused.runner.stop();

      // Reset session ID so next prompt starts fresh
      await this.deps.sessionManager.destroy(focused.project);
      const session = await this.deps.sessionManager.create(
        { project: focused.project, path: focused.path },
        this.currentSenderId,
      );

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
    const focused = this.deps.sessionManager.getFocused(this.currentSenderId);
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
    const focused = this.deps.sessionManager.getFocused(this.currentSenderId);
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
    const focused = this.deps.sessionManager.getFocused(this.currentSenderId);
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

  private async handleProjects(): Promise<void> {
    const executor = this.deps.getJorchfileExecutor?.();
    if (!executor) {
      await this.deps.sendReply("No Jorchfile loaded.");
      return;
    }

    const jorchfile = executor.getJorchfile();
    if (jorchfile.projects.length === 0) {
      await this.deps.sendReply("Jorchfile loaded but has no projects.");
      return;
    }

    const lines = ["*Jorchfile projects:*", ""];
    for (const project of jorchfile.projects) {
      const session = this.deps.sessionManager.getByProject(project.name);
      const cmds = Object.keys(project.commands).join(", ") || "(none)";

      let sessionStatus: string;
      if (session) {
        const focused = this.deps.sessionManager.getFocused(this.currentSenderId);
        const isFocused = focused?.project === project.name;
        const contextPercent = session.runner.getContextPercent();
        const icon = isFocused ? "●" : "○";
        const tag = isFocused ? "focused" : "background";
        sessionStatus = `${icon} active (${tag}, ${contextPercent}%)`;
      } else {
        sessionStatus = "no session";
      }

      const taskList = this.deps.taskManager?.listByProject(project.name) ?? [];
      const tasksInfo =
        taskList.length > 0
          ? taskList
              .map((t) => `${t.commandName} (PID ${t.pid}${t.port ? `, port ${t.port}` : ""})`)
              .join(", ")
          : "-";

      lines.push(`*${project.name}* (${project.path})`);
      lines.push(`  Commands: ${cmds}`);
      lines.push(`  Session: ${sessionStatus}`);
      lines.push(`  Tasks: ${tasksInfo}`);
      lines.push("");
    }

    await this.deps.sendReply(lines.join("\n"));
  }

  private async handleTasks(): Promise<void> {
    const taskManager = this.deps.taskManager;
    if (!taskManager) {
      await this.deps.sendReply("Background task manager not available.");
      return;
    }

    const tasks = taskManager.listAll();
    if (tasks.length === 0) {
      await this.deps.sendReply("No background tasks running.");
      return;
    }

    const lines = ["*Background tasks:*", ""];
    for (const task of tasks) {
      const uptime = formatUptime(task.startedAt);
      const portInfo = task.port ? ` port ${task.port}` : "";
      lines.push(`PID ${task.pid} | ${task.project} | ${task.commandName} | ${uptime}${portInfo}`);
    }

    await this.deps.sendReply(lines.join("\n"));
  }

  private async handleStopCmd(args: string[]): Promise<void> {
    const [project, commandName] = args;
    if (!project) {
      await this.deps.sendReply("Usage: /stop-cmd <project> [command]");
      return;
    }

    const taskManager = this.deps.taskManager;
    const executor = this.deps.getJorchfileExecutor?.();
    if (!taskManager) {
      await this.deps.sendReply("Background task manager not available.");
      return;
    }

    if (commandName) {
      // Get task port BEFORE stopping (for tunnel cleanup)
      const tasks = taskManager.listByProject(project);
      const task = tasks.find((t) => t.commandName === commandName);
      const port = task?.port;

      try {
        taskManager.stop(project, commandName);
        if (port && executor) {
          await executor.stopTunnel(project, port);
        }
        await this.deps.sendReply(`[${project}] Stopped "${commandName}".`);
      } catch (err: unknown) {
        await this.deps.sendReply(
          `[${project}] ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      const killed = taskManager.stopAll(project);
      if (executor) {
        await executor.stopAllTunnels(project);
      }
      await this.deps.sendReply(
        `[${project}] Stopped ${killed} background task${killed !== 1 ? "s" : ""}.`,
      );
    }
  }

  private async handleMake(args: string[]): Promise<void> {
    const focused = this.deps.sessionManager.getFocused(this.currentSenderId);
    if (!focused) {
      await this.deps.sendReply("No active session. Use /new <project> <path> first.");
      return;
    }

    const target = args[0];
    const readTargets = this.deps.readMakefileTargets;

    if (!target) {
      // List targets
      if (!readTargets) {
        await this.deps.sendReply("Makefile reader not available.");
        return;
      }
      try {
        const targets = readTargets(focused.path);
        if (targets.length === 0) {
          await this.deps.sendReply(`[${focused.project}] No Makefile found.`);
        } else {
          await this.deps.sendReply(
            `[${focused.project}] Makefile targets:\n${targets.join(", ")}`,
          );
        }
      } catch (err: unknown) {
        await this.deps.sendReply(
          `[${focused.project}] ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return;
    }

    // Execute target
    await this.executeShell(`make ${target}`, focused);
  }

  private async handleTunnel(args: string[]): Promise<void> {
    const [project, ...rest] = args;
    if (!project) {
      await this.deps.sendReply("Usage: /tunnel <project> [port] [--public]");
      return;
    }

    if (!this.deps.tunnelManager) {
      await this.deps.sendReply("Tunnel manager not available.");
      return;
    }

    const isPublic = rest.includes("--public");
    const portArg = rest.find((a) => !a.startsWith("--"));
    const port = portArg ? Number.parseInt(portArg, 10) : undefined;

    // Resolve session
    const session = this.deps.sessionManager.getByProject(project);
    if (!session) {
      await this.deps.sendReply(`No active session for "${project}". Use /new ${project} first.`);
      return;
    }

    // Port: explicit arg > running task port > error
    const resolvedPort = port ?? this.resolveProjectPort(project);
    if (!resolvedPort) {
      await this.deps.sendReply(
        `No port found for "${project}". Specify a port: /tunnel ${project} 3000`,
      );
      return;
    }

    const mode = isPublic ? "funnel" : "serve";

    try {
      await this.deps.tunnelManager.start({
        project,
        sessionId: session.id,
        localPort: resolvedPort,
        mode,
      });
      // For serve mode, tunnel:started notification is sent by TunnelManager callbacks.
      // For funnel mode, TunnelPendingConfirmation is thrown and caught below.
    } catch (err: unknown) {
      if (err instanceof TunnelPendingConfirmation) {
        // Confirmation buttons are sent by the TunnelManager callback.
        return;
      }
      await this.deps.sendReply(
        `Failed to start tunnel: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async handleTunnelStop(args: string[]): Promise<void> {
    const [project, portArg] = args;
    if (!project) {
      await this.deps.sendReply("Usage: /tunnel-stop <project> [port]");
      return;
    }

    if (!this.deps.tunnelManager) {
      await this.deps.sendReply("Tunnel manager not available.");
      return;
    }

    if (portArg) {
      const port = Number.parseInt(portArg, 10);
      await this.deps.tunnelManager.stopByProjectPort(project, port);
      await this.deps.sendReply(`[${project}] Tunnel on port ${port} stopped.`);
    } else {
      await this.deps.tunnelManager.stopByProject(project);
      await this.deps.sendReply(`[${project}] All tunnels stopped.`);
    }
  }

  private async handleTunnels(): Promise<void> {
    if (!this.deps.tunnelManager) {
      await this.deps.sendReply("Tunnel manager not available.");
      return;
    }

    const allTunnels = this.deps.tunnelManager.list();
    if (allTunnels.length === 0) {
      await this.deps.sendReply("No active tunnels.");
      return;
    }

    const serveTunnels = allTunnels.filter((t) => t.mode === "serve");
    const funnelTunnels = allTunnels.filter((t) => t.mode === "funnel");

    const lines: string[] = ["*Active tunnels:*", ""];

    if (serveTunnels.length > 0) {
      lines.push("*PRIVATE (tailnet only):*");
      for (const t of serveTunnels) {
        lines.push(`  ${t.project} → ${t.url} (Serve, port ${t.localPort})`);
      }
      lines.push("");
    }

    if (funnelTunnels.length > 0) {
      lines.push("*PUBLIC (internet):*");
      for (const t of funnelTunnels) {
        lines.push(`  ${t.project} → ${t.url} (Funnel, port ${t.localPort})`);
      }
    }

    await this.deps.sendReply(lines.join("\n"));
  }

  private resolveProjectPort(project: string): number | undefined {
    const tasks = this.deps.taskManager?.listByProject(project) ?? [];
    const task = tasks.find((t) => t.port !== undefined);
    return task?.port;
  }

  private async handleHelp(args: string[]): Promise<void> {
    // /help --full → full text (legacy behavior)
    if (args.includes("--full")) {
      await this.deps.sendReply(this.buildFullHelp());
      return;
    }

    // Interactive list if sendList is available
    if (this.deps.sendList) {
      await this.deps.sendList("*JorchBot Commands* — Pick a category:", "Commands", [
        {
          id: JSON.stringify({ type: "help_category", category: "global" }),
          title: "Global",
          description: "Sessions, tunnels, modes, status",
        },
        {
          id: JSON.stringify({ type: "help_category", category: "jorchfile" }),
          title: "Jorchfile",
          description: "Projects, tasks, commands",
        },
        {
          id: JSON.stringify({ type: "help_category", category: "shell" }),
          title: "Shell",
          description: "Shell shortcuts and commands",
        },
        {
          id: JSON.stringify({ type: "help_category", category: "claude" }),
          title: "Claude",
          description: "Claude Code session commands",
        },
      ]);
      return;
    }

    // Fallback: full text if sendList not available
    await this.deps.sendReply(this.buildFullHelp());
  }

  /** Send help text for a specific category. Called from onButtonReply for list_reply. */
  async sendHelpCategory(category: string): Promise<void> {
    const text = this.getHelpCategoryText(category);
    if (text) {
      await this.deps.sendReply(text);
    } else {
      await this.deps.sendReply(`Unknown help category: "${category}". Use /help to see options.`);
    }
  }

  private getHelpCategoryText(category: string): string | null {
    switch (category) {
      case "global":
        return [
          "*Global Commands:*",
          "",
          "/new <project> [path] — Create session (from Jorchfile or path)",
          "/switch <project> — Switch focused session",
          "/list — List all sessions",
          "/stop <project> — Stop a session",
          "/logs <project> [n] — Last n messages (default: 20)",
          "/compact <project> — Compact context window",
          "/mode [value] [project] — Approval mode (confirm/plan/auto)",
          "/output [value] [project] — Output mode (verbose/summary/silent)",
          "/tunnel <project> [port] — Start private tunnel (Serve)",
          "/tunnel <project> [port] --public — Start public tunnel (Funnel)",
          "/tunnel-stop <project> [port] — Stop tunnel(s)",
          "/tunnels — List all active tunnels",
          "/gui — Show GUI URL",
          "/gui funnel on|off — Toggle public GUI access",
          "/help — Command list",
          "/help --full — Full command reference",
          "/status — Gateway status",
        ].join("\n");
      case "jorchfile":
        return [
          "*Jorchfile Commands:*",
          "",
          "/projects — List all Jorchfile projects",
          "/tasks — List background tasks",
          "/stop-cmd <project> [cmd] — Stop background task(s)",
          "/make [target] — List or run Makefile targets",
          "/<command> [project] — Run Jorchfile command",
        ].join("\n");
      case "shell":
        return [
          "*Shell Commands:*",
          "",
          "$ <command> — Execute shell command",
          "/ls [path] — List files",
          "/cat <file> — Read file",
          "/grep <pattern> [path] — Search in files",
          "/pwd — Current directory",
          "/git <args> — Git commands",
          "/tree [depth] — Directory tree",
        ].join("\n");
      case "claude":
        return [
          "*Claude Code Commands:*",
          "",
          "!usage — Session token counts and context %",
          "!context — Context window usage",
          "!compact — Compact focused session",
          "!clear — Reset focused session",
          "!<command> — Send as prompt to Claude Code",
          "",
          "Free text → sent to focused Claude Code session",
        ].join("\n");
      default:
        return null;
    }
  }

  private buildFullHelp(): string {
    return [
      "*JorchBot Commands:*",
      "",
      "*Sessions:*",
      "/new <project> [path] — Create session (from Jorchfile or path)",
      "/switch <project> — Switch focused session",
      "/list — List all sessions",
      "/stop <project> — Stop a session",
      "/logs <project> [n] — Last n messages (default: 20)",
      "/compact <project> — Compact context window",
      "/mode [value] [project] — Approval mode (confirm/plan/auto)",
      "/output [value] [project] — Output mode (verbose/summary/silent)",
      "",
      "*Jorchfile:*",
      "/projects — List all Jorchfile projects",
      "/tasks — List background tasks",
      "/stop-cmd <project> [cmd] — Stop background task(s)",
      "/make [target] — List or run Makefile targets",
      "/<command> [project] — Run Jorchfile command",
      "",
      "*Tunnels:*",
      "/tunnel <project> [port] — Start private tunnel (Serve)",
      "/tunnel <project> [port] --public — Start public tunnel (Funnel)",
      "/tunnel-stop <project> [port] — Stop tunnel(s)",
      "/tunnels — List all active tunnels",
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
      "*GUI:*",
      "/gui — Show GUI URL",
      "/gui funnel on|off — Toggle public GUI access",
      "",
      "*Other:*",
      "/help — Command list",
      "/help --full — Full command reference",
      "/status — Gateway status",
      "",
      "Free text → sent to focused Claude Code session",
    ].join("\n");
  }

  private async handleStatus(): Promise<void> {
    const activeSessions = this.deps.sessionManager.listActive(this.currentSenderId);
    const focused = this.deps.sessionManager.getFocused(this.currentSenderId);

    const lines = ["*JorchBot Status*", ""];

    if (activeSessions.length === 0) {
      lines.push("No active sessions.");
    } else {
      lines.push(`Sessions: ${activeSessions.length} active`);
      if (focused) {
        lines.push(`Focused: ${focused.project} (${focused.runner.getContextPercent()}%)`);
      }
    }

    const tunnelCount = this.deps.tunnelManager?.list().length ?? 0;
    if (tunnelCount > 0) {
      lines.push(`Tunnels: ${tunnelCount} active`);
    }

    await this.deps.sendReply(lines.join("\n"));
  }

  private async handleMode(args: string[]): Promise<void> {
    const APPROVAL_MODES = new Set<string>(["confirm", "plan", "auto"]);

    // /mode (no args) → show current approval mode
    if (args.length === 0) {
      const project = this.deps.sessionManager.getFocusedProject(this.currentSenderId);
      if (!project) {
        await this.deps.sendReply("No focused session. Use /new to create one.");
        return;
      }
      try {
        const record = this.deps.sessionManager.getSessionRecordByProject(project);
        await this.deps.sendReply(`[${project}] Approval mode: *${record.mode}*`);
      } catch (err: unknown) {
        await this.deps.sendReply(
          `Failed to get mode: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return;
    }

    const [modeValue, targetProject] = args;
    const project =
      targetProject ?? this.deps.sessionManager.getFocusedProject(this.currentSenderId);

    if (!project) {
      await this.deps.sendReply("No focused session. Specify project: /mode auto frontend");
      return;
    }

    if (APPROVAL_MODES.has(modeValue)) {
      try {
        this.deps.sessionManager.setMode(project, modeValue as ApprovalMode);
        await this.deps.sendReply(`[${project}] Approval mode changed to *${modeValue}*`);
      } catch (err: unknown) {
        await this.deps.sendReply(
          `Failed to set mode: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return;
    }

    await this.deps.sendReply(`Unknown mode "${modeValue}". Valid: confirm, plan, auto`);
  }

  private async handleOutput(args: string[]): Promise<void> {
    const OUTPUT_MODES = new Set<string>(["verbose", "summary", "silent"]);

    // /output (no args) → show current output mode
    if (args.length === 0) {
      const project = this.deps.sessionManager.getFocusedProject(this.currentSenderId);
      if (!project) {
        await this.deps.sendReply("No focused session. Use /new to create one.");
        return;
      }
      try {
        const record = this.deps.sessionManager.getSessionRecordByProject(project);
        await this.deps.sendReply(`[${project}] Output mode: *${record.outputMode}*`);
      } catch (err: unknown) {
        await this.deps.sendReply(
          `Failed to get output mode: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return;
    }

    const [modeValue, targetProject] = args;
    const project =
      targetProject ?? this.deps.sessionManager.getFocusedProject(this.currentSenderId);

    if (!project) {
      await this.deps.sendReply("No focused session. Specify project: /output silent frontend");
      return;
    }

    if (OUTPUT_MODES.has(modeValue)) {
      try {
        this.deps.sessionManager.setOutputMode(project, modeValue as OutputMode);
        await this.deps.sendReply(`[${project}] Output mode changed to *${modeValue}*`);
      } catch (err: unknown) {
        await this.deps.sendReply(
          `Failed to set output mode: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return;
    }

    await this.deps.sendReply(
      `Unknown output mode "${modeValue}". Valid: verbose, summary, silent`,
    );
  }

  private async handleGui(args: string[]): Promise<void> {
    const guiDeps = this.deps.guiCommandDeps;
    if (!guiDeps) {
      await this.deps.sendReply("GUI command not available.");
      return;
    }
    await handleGuiCommand(args.join(" "), guiDeps);
  }

  private async handlePrompt(text: string): Promise<void> {
    const focused = this.deps.sessionManager.getFocused(this.currentSenderId);
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
