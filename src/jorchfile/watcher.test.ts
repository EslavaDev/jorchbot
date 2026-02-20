import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Jorchfile } from "./parser.js";
import { JorchfileWatcher } from "./watcher.js";

function makeJorchfile(
  projects: Array<{
    name: string;
    path: string;
    commands?: Record<string, string>;
    instructions?: string;
  }>,
): Jorchfile {
  return {
    projects: projects.map((p) => ({
      name: p.name,
      path: p.path,
      commands: p.commands ?? {},
      background: ["dev", "build"],
      instructions: p.instructions,
    })),
    settings: {},
  };
}

describe("JorchfileWatcher.computeChanges", () => {
  const onReload = vi.fn();
  const onError = vi.fn();
  let watcher: JorchfileWatcher;

  beforeEach(() => {
    vi.clearAllMocks();
    watcher = new JorchfileWatcher({ onReload, onError });
  });

  it("computes added projects correctly", () => {
    const initial = makeJorchfile([{ name: "frontend", path: "/a" }]);
    watcher.start(initial);

    const updated = makeJorchfile([
      { name: "frontend", path: "/a" },
      { name: "backend", path: "/b" },
    ]);
    const changes = watcher.computeChanges(updated);

    expect(changes.added).toEqual(["backend"]);
    expect(changes.removed).toEqual([]);
    expect(changes.modified).toEqual([]);
  });

  it("computes removed projects correctly", () => {
    const initial = makeJorchfile([
      { name: "frontend", path: "/a" },
      { name: "backend", path: "/b" },
    ]);
    watcher.start(initial);

    const updated = makeJorchfile([{ name: "frontend", path: "/a" }]);
    const changes = watcher.computeChanges(updated);

    expect(changes.added).toEqual([]);
    expect(changes.removed).toEqual(["backend"]);
    expect(changes.modified).toEqual([]);
  });

  it("computes modified projects when path changes", () => {
    const initial = makeJorchfile([{ name: "frontend", path: "/a" }]);
    watcher.start(initial);

    const updated = makeJorchfile([{ name: "frontend", path: "/b" }]);
    const changes = watcher.computeChanges(updated);

    expect(changes.modified).toEqual(["frontend"]);
    expect(changes.added).toEqual([]);
    expect(changes.removed).toEqual([]);
  });

  it("computes modified projects when commands change", () => {
    const initial = makeJorchfile([
      { name: "frontend", path: "/a", commands: { dev: "npm start" } },
    ]);
    watcher.start(initial);

    const updated = makeJorchfile([
      { name: "frontend", path: "/a", commands: { dev: "npm run dev" } },
    ]);
    const changes = watcher.computeChanges(updated);

    expect(changes.modified).toEqual(["frontend"]);
  });

  it("does not report unchanged projects", () => {
    const initial = makeJorchfile([
      { name: "frontend", path: "/a", commands: { dev: "npm start" } },
    ]);
    watcher.start(initial);

    const updated = makeJorchfile([
      { name: "frontend", path: "/a", commands: { dev: "npm start" } },
    ]);
    const changes = watcher.computeChanges(updated);

    expect(changes.added).toEqual([]);
    expect(changes.removed).toEqual([]);
    expect(changes.modified).toEqual([]);
  });
});
