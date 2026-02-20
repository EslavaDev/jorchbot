import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { MakefileReadError } from "../errors/index.js";

const TARGET_RE = /^([a-zA-Z0-9_-]+)\s*:/;

/**
 * Read Makefile target names from a project directory.
 *
 * @param projectPath - Absolute path to the project directory containing a Makefile
 * @returns Array of target names (may be empty)
 * @throws {MakefileReadError} If the Makefile exists but cannot be read
 */
export function readMakefileTargets(projectPath: string): string[] {
  const makefilePath = path.join(projectPath, "Makefile");

  if (!existsSync(makefilePath)) {
    return [];
  }

  let content: string;
  try {
    content = readFileSync(makefilePath, "utf-8");
  } catch (err: unknown) {
    throw new MakefileReadError(`Cannot read Makefile: ${makefilePath}`, { cause: err });
  }

  const targets: string[] = [];
  for (const line of content.split("\n")) {
    // Skip recipe lines (tab/space-indented)
    if (line.startsWith("\t") || line.startsWith(" ")) {
      continue;
    }
    // Skip dot-prefixed special targets (.PHONY, .DEFAULT, etc.)
    if (line.startsWith(".")) {
      continue;
    }
    const match = TARGET_RE.exec(line);
    if (match) {
      targets.push(match[1]);
    }
  }

  return targets;
}
