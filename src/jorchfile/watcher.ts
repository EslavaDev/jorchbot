import { watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { loadJorchfile } from "./loader.js";
import type { Jorchfile, JorchProject } from "./parser.js";

export interface JorchfileChanges {
  added: string[];
  removed: string[];
  modified: string[];
}

interface JorchfileWatcherDeps {
  onReload: (jorchfile: Jorchfile | null, changes: JorchfileChanges) => void;
  onError: (error: Error) => void;
}

export class JorchfileWatcher {
  private deps: JorchfileWatcherDeps;
  private previousProjects = new Map<string, JorchProject>();
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private filePath: string | undefined;

  constructor(deps: JorchfileWatcherDeps) {
    this.deps = deps;
  }

  /** Start watching the Jorchfile for changes */
  start(initialJorchfile: Jorchfile | null, filePath?: string): void {
    this.filePath = filePath;

    // Store initial projects
    if (initialJorchfile) {
      for (const project of initialJorchfile.projects) {
        this.previousProjects.set(project.name, project);
      }
    }

    // Start fs.watch — do nothing if file doesn't exist (it may be created later)
    try {
      if (filePath) {
        this.watcher = watch(filePath, () => this.debouncedReload());
      }
    } catch {
      // File doesn't exist yet — that's OK
    }
  }

  /** Stop watching */
  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Compute changes between the current Jorchfile and a new one.
   * Exposed for testing.
   */
  computeChanges(newJorchfile: Jorchfile | null): JorchfileChanges {
    const newProjects = new Map<string, JorchProject>();
    if (newJorchfile) {
      for (const project of newJorchfile.projects) {
        newProjects.set(project.name, project);
      }
    }

    const added: string[] = [];
    const removed: string[] = [];
    const modified: string[] = [];

    // Check for added and modified
    for (const [name, newProject] of newProjects) {
      const prev = this.previousProjects.get(name);
      if (!prev) {
        added.push(name);
      } else if (isProjectModified(prev, newProject)) {
        modified.push(name);
      }
    }

    // Check for removed
    for (const name of this.previousProjects.keys()) {
      if (!newProjects.has(name)) {
        removed.push(name);
      }
    }

    // Update state for next comparison
    this.previousProjects = newProjects;

    return { added, removed, modified };
  }

  private debouncedReload(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      try {
        const newJorchfile = loadJorchfile(this.filePath);
        const changes = this.computeChanges(newJorchfile);
        this.deps.onReload(newJorchfile, changes);
      } catch (err: unknown) {
        this.deps.onError(err instanceof Error ? err : new Error(String(err)));
      }
    }, 300);
  }
}

/** Check if a project has been modified (path, commands, or instructions changed) */
function isProjectModified(prev: JorchProject, next: JorchProject): boolean {
  if (prev.path !== next.path) {
    return true;
  }
  if (prev.instructions !== next.instructions) {
    return true;
  }
  // Compare commands
  const prevKeys = Object.keys(prev.commands).toSorted();
  const nextKeys = Object.keys(next.commands).toSorted();
  if (prevKeys.length !== nextKeys.length) {
    return true;
  }
  for (let i = 0; i < prevKeys.length; i++) {
    const prevKey = prevKeys[i];
    const nextKey = nextKeys[i];
    if (prevKey !== nextKey) {
      return true;
    }
    if (prevKey && nextKey && prev.commands[prevKey] !== next.commands[nextKey]) {
      return true;
    }
  }
  return false;
}
