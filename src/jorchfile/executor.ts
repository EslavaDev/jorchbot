import { JorchfileProjectNotFoundError, JorchfileCommandNotFoundError } from "../errors/index.js";
import type { SessionManager } from "../sessions/jorchbot/manager.js";
import type { ShellRunner } from "../sessions/jorchbot/shell-runner.js";
import { TunnelPendingConfirmation } from "../tunnels/manager.js";
import type { TunnelManager } from "../tunnels/manager.js";
import type { Jorchfile, JorchProject } from "./parser.js";
import type { PortManager } from "./port-manager.js";
import type { BackgroundTaskManager } from "./task-manager.js";

/** Default commands that run in background (used when project has no explicit `background` field) */
const DEFAULT_BACKGROUND_COMMANDS = ["dev", "build"];

export interface JorchfileExecutorDeps {
  jorchfile: Jorchfile;
  sessionManager: SessionManager;
  shellRunner: ShellRunner;
  taskManager: BackgroundTaskManager;
  portManager: PortManager;
  tunnelManager: TunnelManager;
  sendReply: (text: string) => Promise<void>;
  sendButtons: (text: string, buttons: Array<{ id: string; title: string }>) => Promise<void>;
}

export class JorchfileExecutor {
  private deps: JorchfileExecutorDeps;
  private jorchfile: Jorchfile;

  constructor(deps: JorchfileExecutorDeps) {
    this.deps = deps;
    this.jorchfile = deps.jorchfile;
  }

  /** Update the Jorchfile reference (for hot-reload) */
  updateJorchfile(jorchfile: Jorchfile): void {
    this.jorchfile = jorchfile;
  }

  /** Get the current Jorchfile (public getter for read access) */
  getJorchfile(): Jorchfile {
    return this.jorchfile;
  }

  /** Get the list of registered command names across all projects */
  getRegisteredCommands(): string[] {
    const cmds = new Set<string>();
    for (const project of this.jorchfile.projects) {
      for (const cmd of Object.keys(project.commands)) {
        cmds.add(cmd);
      }
    }
    return [...cmds];
  }

  /** Check if a command name exists in any project */
  hasCommand(commandName: string): boolean {
    return this.jorchfile.projects.some((p) => commandName in p.commands);
  }

  /** Get a project by name, or null */
  getProject(name: string): JorchProject | null {
    return this.jorchfile.projects.find((p) => p.name === name) ?? null;
  }

  /** Stop a tunnel for a project+port (delegates to TunnelManager) */
  async stopTunnel(project: string, port: number): Promise<void> {
    await this.deps.tunnelManager.stopByProjectPort(project, port);
  }

  /** Stop all tunnels for a project (delegates to TunnelManager) */
  async stopAllTunnels(project: string): Promise<void> {
    await this.deps.tunnelManager.stopByProject(project);
  }

  /**
   * Execute a Jorchfile command.
   *
   * @param commandName - The command to execute (e.g., "dev", "test")
   * @param projectName - The project to run it in (optional — uses focused)
   * @param forceBackground - Force background execution (trailing &)
   *
   * @throws {JorchfileProjectNotFoundError} If project not in Jorchfile
   * @throws {JorchfileCommandNotFoundError} If command not defined for project
   */
  async execute(
    commandName: string,
    projectName: string | undefined,
    forceBackground: boolean,
    ownerPhone?: string,
  ): Promise<void> {
    // Resolve project
    const resolvedProjectName = projectName ?? this.getProjectFromFocused(ownerPhone);
    if (!resolvedProjectName) {
      await this.deps.sendReply(
        "No project specified and no focused session. Usage: /<command> <project>",
      );
      return;
    }

    const project = this.getProject(resolvedProjectName);
    if (!project) {
      throw new JorchfileProjectNotFoundError(
        `Project "${resolvedProjectName}" not found in Jorchfile`,
      );
    }

    const shellCommand = project.commands[commandName];
    if (!shellCommand) {
      throw new JorchfileCommandNotFoundError(
        `Command "${commandName}" not defined for project "${resolvedProjectName}"`,
      );
    }

    // Auto-create session if none exists (requires ownerPhone)
    if (ownerPhone) {
      await this.ensureSession(project, ownerPhone);
    }

    const bgSet = new Set(project.background ?? DEFAULT_BACKGROUND_COMMANDS);
    const isBackground = forceBackground || bgSet.has(commandName);

    if (isBackground) {
      await this.executeBackground(project, commandName, shellCommand);
    } else {
      await this.executeForeground(project, commandName, shellCommand);
    }
  }

  private async executeForeground(
    project: JorchProject,
    _commandName: string,
    shellCommand: string,
  ): Promise<void> {
    await this.deps.sendReply(`[${project.name}] $ ${shellCommand}`);

    try {
      const result = await this.deps.shellRunner.execute(shellCommand, project.path);
      const output = result.stdout || result.stderr || "(no output)";
      const exitInfo = result.exitCode !== 0 ? `\nExit code: ${result.exitCode}` : "";
      const truncInfo = result.truncated ? "\n(output truncated)" : "";
      await this.deps.sendReply(`[${project.name}] ${output}${exitInfo}${truncInfo}`);
    } catch (err: unknown) {
      await this.deps.sendReply(
        `[${project.name}] Error running "${_commandName}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async executeBackground(
    project: JorchProject,
    commandName: string,
    shellCommand: string,
  ): Promise<void> {
    // Check for duplicate: same command already running for this project
    const existingTasks = this.deps.taskManager.listByProject(project.name);
    const duplicate = existingTasks.find((t) => t.commandName === commandName);
    if (duplicate) {
      await this.deps.sendButtons(
        `[${project.name}] "${commandName}" is already running (PID ${duplicate.pid}). What do you want to do?`,
        [
          {
            id: JSON.stringify({
              type: "task_restart",
              project: project.name,
              command: commandName,
            }),
            title: "Stop & restart",
          },
          {
            id: JSON.stringify({
              type: "task_duplicate",
              project: project.name,
              command: commandName,
            }),
            title: "Run another",
          },
        ],
      );
      return;
    }

    // Port management for dev commands
    let assignedPort: number | undefined;
    let envOverrides: Record<string, string> = {};

    if (project.port !== undefined) {
      assignedPort = await this.deps.portManager.findAvailablePort(project.port);
      envOverrides = { PORT: String(assignedPort) };

      if (assignedPort !== project.port) {
        await this.deps.sendReply(
          `[${project.name}] Port ${project.port} occupied. Using ${assignedPort} instead.`,
        );
      }
    }

    // Start background task
    const task = await this.deps.taskManager.start({
      project: project.name,
      commandName,
      shellCommand,
      cwd: project.path,
      port: assignedPort,
      env: envOverrides,
    });

    await this.deps.sendReply(
      `[${project.name}] "${commandName}" started (bg, PID ${task.pid}${assignedPort ? `, port ${assignedPort}` : ""})`,
    );

    // Start tunnels if configured
    if (project.tunnels.length > 0) {
      const session = this.deps.sessionManager.getByProject(project.name);
      if (session) {
        for (const entry of project.tunnels) {
          try {
            await this.deps.tunnelManager.start({
              project: project.name,
              sessionId: session.id,
              localPort: entry.port,
              mode: entry.mode,
              funnelPath: entry.path,
              autoConfirm: true,
            });
          } catch (err: unknown) {
            // TunnelPendingConfirmation is expected for funnel mode — buttons already sent
            if (err instanceof TunnelPendingConfirmation) {
              continue;
            }
            await this.deps.sendReply(
              `[${project.name}] Failed to start tunnel on port ${entry.port}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
    }
  }

  private async ensureSession(project: JorchProject, ownerPhone: string): Promise<void> {
    const existing = this.deps.sessionManager.getByProject(project.name);
    if (existing) {
      return;
    }

    try {
      await this.deps.sessionManager.create(
        {
          project: project.name,
          path: project.path,
          systemPrompt: project.instructions,
        },
        ownerPhone,
      );

      await this.deps.sendReply(
        `[${project.name}] Session auto-created from Jorchfile\nPath: ${project.path}`,
      );
    } catch (err: unknown) {
      await this.deps.sendReply(
        `[${project.name}] Failed to auto-create session: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private getProjectFromFocused(ownerPhone?: string): string | null {
    if (!ownerPhone) {
      return null;
    }
    const focused = this.deps.sessionManager.getFocused(ownerPhone);
    return focused?.project ?? null;
  }
}
