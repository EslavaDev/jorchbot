import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { BackgroundTaskStartError, BackgroundTaskNotFoundError } from "../errors/index.js";

export interface BackgroundTask {
  pid: number;
  project: string;
  commandName: string;
  shellCommand: string;
  port?: number;
  startedAt: Date;
  process: ChildProcess;
}

export interface StartTaskInput {
  project: string;
  commandName: string;
  shellCommand: string;
  cwd: string;
  port?: number;
  env?: Record<string, string>;
}

interface BackgroundTaskManagerDeps {
  sendReply: (text: string) => Promise<void>;
}

export class BackgroundTaskManager {
  /** Map: project name -> list of background tasks */
  private tasks = new Map<string, BackgroundTask[]>();
  private deps: BackgroundTaskManagerDeps;

  constructor(deps: BackgroundTaskManagerDeps) {
    this.deps = deps;
  }

  /**
   * Start a background task.
   *
   * @throws {BackgroundTaskStartError} If spawn fails
   */
  async start(input: StartTaskInput): Promise<BackgroundTask> {
    const env = { ...process.env, ...input.env };

    let child: ChildProcess;
    try {
      child = spawn("sh", ["-c", input.shellCommand], {
        cwd: input.cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      });
    } catch (err: unknown) {
      throw new BackgroundTaskStartError(
        `Failed to start "${input.commandName}" for ${input.project}`,
        { cause: err },
      );
    }

    if (!child.pid) {
      throw new BackgroundTaskStartError(
        `No PID assigned for "${input.commandName}" in ${input.project}`,
      );
    }

    const task: BackgroundTask = {
      pid: child.pid,
      project: input.project,
      commandName: input.commandName,
      shellCommand: input.shellCommand,
      port: input.port,
      startedAt: new Date(),
      process: child,
    };

    // Collect output for logging (limited buffer)
    const outputChunks: string[] = [];
    child.stdout?.on("data", (data: Buffer) => {
      if (outputChunks.length < 1000) {
        outputChunks.push(data.toString());
      }
    });
    child.stderr?.on("data", (data: Buffer) => {
      if (outputChunks.length < 1000) {
        outputChunks.push(data.toString());
      }
    });

    // Auto-remove on exit + notify
    child.on("exit", (code) => {
      this.removeTask(input.project, task.pid);
      const status = code === 0 ? "finished" : `crashed (exit ${code})`;
      const uptime = formatUptime(task.startedAt);
      void this.deps.sendReply(
        `[${input.project}] Background task "${input.commandName}" ${status} (${uptime})`,
      );
    });

    // Store
    const existing = this.tasks.get(input.project) ?? [];
    existing.push(task);
    this.tasks.set(input.project, existing);

    return task;
  }

  /**
   * Kill a specific background task.
   *
   * @throws {BackgroundTaskNotFoundError} If task not found
   */
  stop(project: string, commandName: string): void {
    const tasks = this.tasks.get(project);
    if (!tasks) {
      throw new BackgroundTaskNotFoundError(`No background tasks for project "${project}"`);
    }

    const task = tasks.find((t) => t.commandName === commandName);
    if (!task) {
      throw new BackgroundTaskNotFoundError(
        `No background task "${commandName}" for project "${project}"`,
      );
    }

    task.process.kill("SIGTERM");
    // The "exit" handler will remove it from the map
  }

  /** Kill ALL background tasks for a project */
  stopAll(project: string): number {
    const tasks = this.tasks.get(project);
    if (!tasks || tasks.length === 0) {
      return 0;
    }

    let killed = 0;
    for (const task of tasks) {
      task.process.kill("SIGTERM");
      killed++;
    }
    return killed;
  }

  /** List all background tasks across all projects */
  listAll(): BackgroundTask[] {
    const all: BackgroundTask[] = [];
    for (const tasks of this.tasks.values()) {
      all.push(...tasks);
    }
    return all;
  }

  /** List tasks for a specific project */
  listByProject(project: string): BackgroundTask[] {
    return this.tasks.get(project) ?? [];
  }

  /** Check if a project has any background tasks */
  hasTasksFor(project: string): boolean {
    const tasks = this.tasks.get(project);
    return tasks !== undefined && tasks.length > 0;
  }

  private removeTask(project: string, pid: number): void {
    const tasks = this.tasks.get(project);
    if (!tasks) {
      return;
    }
    const filtered = tasks.filter((t) => t.pid !== pid);
    if (filtered.length === 0) {
      this.tasks.delete(project);
    } else {
      this.tasks.set(project, filtered);
    }
  }
}

export function formatUptime(startedAt: Date): string {
  const ms = Date.now() - startedAt.getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
