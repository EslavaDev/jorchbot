import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { JorchfileParseError } from "../errors/index.js";
import type { Jorchfile } from "./parser.js";
import { parseJorchfile } from "./parser.js";

export const DEFAULT_JORCHFILE_PATH = path.join(homedir(), ".jorchbot", "Jorchfile");

/**
 * Load and parse the Jorchfile from the default location.
 * Returns null if the file does not exist (no Jorchfile is valid — optional config).
 * Logs warnings for projects whose `path` directory does not exist.
 *
 * @throws {JorchfileParseError} If the file exists but cannot be parsed
 */
export function loadJorchfile(filePath?: string): Jorchfile | null {
  const resolvedPath = filePath ?? DEFAULT_JORCHFILE_PATH;

  if (!existsSync(resolvedPath)) {
    return null;
  }

  let content: string;
  try {
    content = readFileSync(resolvedPath, "utf-8");
  } catch (err: unknown) {
    throw new JorchfileParseError(`Cannot read Jorchfile: ${resolvedPath}`, { cause: err });
  }

  const jorchfile = parseJorchfile(content);

  // Warn about non-existent project paths (not fatal — user may create later)
  for (const project of jorchfile.projects) {
    if (!existsSync(project.path)) {
      console.warn(
        `[jorchbot] Warning: project "${project.name}" path does not exist: ${project.path}`,
      );
    }
  }

  return jorchfile;
}
