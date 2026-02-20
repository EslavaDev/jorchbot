import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { JorchfileParseError, JorchfileValidationError } from "../errors/index.js";

/** Default commands that run in background */
const DEFAULT_BACKGROUND_COMMANDS = ["dev", "build"];

export const JorchProjectSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, {
      message: "Project name must be alphanumeric with hyphens/underscores only",
    }),
  path: z.string().min(1),
  port: z.number().int().min(1).max(65535).optional(),
  tunnel: z.enum(["serve", "funnel"]).optional(),
  funnelPath: z.string().optional(),
  approve: z.enum(["confirm", "plan", "auto"]).optional(),
  output: z.enum(["verbose", "summary", "silent"]).optional(),
  instructions: z.string().optional(),
  /** Commands that run in background by default. Default: ["dev", "build"] */
  background: z.array(z.string()).default(DEFAULT_BACKGROUND_COMMANDS),
  /** Custom commands: key = command name, value = shell command */
  commands: z.record(z.string(), z.string()),
});

export const JorchSettingsSchema = z.object({
  logRetentionDays: z.number().int().min(1).optional(),
  summaryRetentionDays: z.number().int().min(1).optional(),
  errorRetentionDays: z.number().int().min(1).optional(),
  dbMaxSizeMb: z.number().int().min(10).optional(),
});

export const JorchfileSchema = z.object({
  projects: z.array(JorchProjectSchema),
  settings: JorchSettingsSchema,
});

export type JorchProject = z.infer<typeof JorchProjectSchema>;
export type JorchSettings = z.infer<typeof JorchSettingsSchema>;
export type Jorchfile = z.infer<typeof JorchfileSchema>;

export const RESERVED_FIELDS = new Set([
  "path",
  "port",
  "tunnel",
  "funnel_path",
  "approve",
  "output",
  "instructions",
  "background",
]);

/**
 * Parse a Jorchfile string into a structured Jorchfile object.
 *
 * @throws {JorchfileParseError} On syntax errors (bad format, unreadable @file)
 * @throws {JorchfileValidationError} On validation errors (missing path, duplicate names)
 */
export function parseJorchfile(content: string): Jorchfile {
  const lines = content.split("\n");
  const projects: JorchProject[] = [];
  const settings: Record<string, string> = {};

  let currentBlock: "project" | "settings" | null = null;
  /** Raw fields for the current PROJECT block (key -> { value, lineNum }) */
  let currentFields: Map<string, { value: string; lineNum: number }> | null = null;
  let currentProjectName: string | null = null;
  let pendingKey: string | null = null;
  let pendingValue = "";

  const flushProject = (endLineNum: number) => {
    if (currentProjectName && currentFields) {
      projects.push(finalizeProject(currentProjectName, currentFields, endLineNum));
    }
    currentProjectName = null;
    currentFields = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const raw = lines[i];

    // Handle backslash continuation
    if (pendingKey !== null) {
      const trimmed = raw.trim();
      if (pendingValue.endsWith("\\")) {
        pendingValue = pendingValue.slice(0, -1).trimEnd() + " " + trimmed;
        if (!trimmed.endsWith("\\")) {
          // End of continuation — flush to raw fields
          flushRawField(currentBlock, currentFields, settings, pendingKey, pendingValue, lineNum);
          pendingKey = null;
          pendingValue = "";
        }
        continue;
      }
    }

    // Skip blank lines and comments
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }

    // PROJECT block start
    if (trimmed.startsWith("PROJECT ")) {
      flushProject(lineNum);
      const name = trimmed.slice("PROJECT ".length).trim();
      if (!name) {
        throw new JorchfileParseError(`Line ${lineNum}: PROJECT requires a name`);
      }
      currentBlock = "project";
      currentProjectName = name;
      currentFields = new Map();
      continue;
    }

    // SETTINGS block start
    if (trimmed === "SETTINGS") {
      flushProject(lineNum);
      currentBlock = "settings";
      continue;
    }

    // Field line (must be indented)
    if (raw.startsWith("  ") || raw.startsWith("\t")) {
      if (!currentBlock) {
        throw new JorchfileParseError(
          `Line ${lineNum}: indented line outside of a PROJECT or SETTINGS block`,
        );
      }

      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) {
        throw new JorchfileParseError(`Line ${lineNum}: expected "key = value" format`);
      }

      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();

      if (!key) {
        throw new JorchfileParseError(`Line ${lineNum}: empty key`);
      }

      // Check for backslash continuation
      if (value.endsWith("\\")) {
        pendingKey = key;
        pendingValue = value;
        continue;
      }

      flushRawField(currentBlock, currentFields, settings, key, value, lineNum);
      continue;
    }

    // Unrecognized line
    throw new JorchfileParseError(
      `Line ${lineNum}: unexpected content "${trimmed}". Expected PROJECT, SETTINGS, or indented field.`,
    );
  }

  // Flush pending continuation
  if (pendingKey !== null) {
    flushRawField(currentBlock, currentFields, settings, pendingKey, pendingValue, lines.length);
  }

  // Flush last project
  flushProject(lines.length);

  // Validate: no duplicate project names
  const names = new Set<string>();
  for (const project of projects) {
    if (names.has(project.name)) {
      throw new JorchfileValidationError(`Duplicate project name: "${project.name}"`);
    }
    names.add(project.name);
  }

  // Map SETTINGS to JorchSettings
  const jorchSettings: JorchSettings = {};
  if (settings["log_retention_days"]) {
    jorchSettings.logRetentionDays = parseIntStrict(
      settings["log_retention_days"],
      "log_retention_days",
    );
  }
  if (settings["summary_retention_days"]) {
    jorchSettings.summaryRetentionDays = parseIntStrict(
      settings["summary_retention_days"],
      "summary_retention_days",
    );
  }
  if (settings["error_retention_days"]) {
    jorchSettings.errorRetentionDays = parseIntStrict(
      settings["error_retention_days"],
      "error_retention_days",
    );
  }
  if (settings["db_max_size_mb"]) {
    jorchSettings.dbMaxSizeMb = parseIntStrict(settings["db_max_size_mb"], "db_max_size_mb");
  }

  return JorchfileSchema.parse({ projects, settings: jorchSettings });
}

/** Store a raw field value (no @file resolution yet — that's deferred) */
function flushRawField(
  block: "project" | "settings" | null,
  currentFields: Map<string, { value: string; lineNum: number }> | null,
  settings: Record<string, string>,
  key: string,
  value: string,
  lineNum: number,
): void {
  if (block === "project" && currentFields) {
    currentFields.set(key, { value, lineNum });
  } else if (block === "settings") {
    settings[key] = value;
  }
}

/**
 * Process raw fields into a JorchProject.
 * Two-pass: (1) extract `path` first, (2) resolve @file for all other fields using that path.
 * `path` itself does NOT support @file — always literal (with ~ expansion).
 */
function processProjectFields(
  name: string,
  fields: Map<string, { value: string; lineNum: number }>,
): Partial<JorchProject> & { commands: Record<string, string> } {
  const project: Partial<JorchProject> & { commands: Record<string, string> } = {
    name,
    commands: {},
  };

  // Pass 1: extract path (no @file, just ~ expansion)
  const pathField = fields.get("path");
  if (pathField) {
    project.path = expandTilde(pathField.value);
  }

  const projectPath = project.path ?? "";

  // Pass 2: process all other fields with @file resolution
  for (const [key, { value, lineNum }] of fields) {
    if (key === "path") {
      continue; // already handled
    }

    // Resolve @file references (except for `path`)
    const resolved = resolveFileReference(value, projectPath, lineNum);

    switch (key) {
      case "port":
        project.port = parseIntStrict(resolved, `port (line ${lineNum})`);
        break;
      case "tunnel":
        if (resolved !== "serve" && resolved !== "funnel") {
          throw new JorchfileParseError(
            `Line ${lineNum}: tunnel must be "serve" or "funnel", got "${resolved}"`,
          );
        }
        project.tunnel = resolved;
        break;
      case "funnel_path":
        project.funnelPath = resolved;
        break;
      case "approve":
        if (resolved !== "confirm" && resolved !== "plan" && resolved !== "auto") {
          throw new JorchfileParseError(
            `Line ${lineNum}: approve must be "confirm", "plan", or "auto", got "${resolved}"`,
          );
        }
        project.approve = resolved;
        break;
      case "output":
        if (resolved !== "verbose" && resolved !== "summary" && resolved !== "silent") {
          throw new JorchfileParseError(
            `Line ${lineNum}: output must be "verbose", "summary", or "silent", got "${resolved}"`,
          );
        }
        project.output = resolved;
        break;
      case "instructions":
        project.instructions = resolved;
        break;
      case "background":
        // Comma-separated list: "dev, build, start"
        project.background = resolved
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      default:
        // Custom command
        project.commands[key] = resolved;
        break;
    }
  }

  return project;
}

/**
 * Resolve a field value. If it starts with @, read the referenced file contents.
 * Otherwise, return the value as-is. Works for ANY field (instructions, commands, etc.).
 *
 * @throws {JorchfileParseError} If @file does not exist
 */
function resolveFileReference(value: string, projectPath: string, lineNum: number): string {
  if (!value.startsWith("@")) {
    return value;
  }

  const filePath = value.slice(1);
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(projectPath, filePath);

  try {
    return readFileSync(resolved, "utf-8").trim();
  } catch (err: unknown) {
    throw new JorchfileParseError(`Line ${lineNum}: cannot read instructions file "${resolved}"`, {
      cause: err,
    });
  }
}

function finalizeProject(
  name: string,
  fields: Map<string, { value: string; lineNum: number }>,
  lineNum: number,
): JorchProject {
  const partial = processProjectFields(name, fields);

  if (!partial.path) {
    throw new JorchfileValidationError(
      `Project "${name}" is missing required field "path" (near line ${lineNum})`,
    );
  }

  return {
    name,
    path: partial.path,
    port: partial.port,
    tunnel: partial.tunnel,
    funnelPath: partial.funnelPath,
    approve: partial.approve,
    output: partial.output,
    instructions: partial.instructions,
    background: partial.background ?? DEFAULT_BACKGROUND_COMMANDS,
    commands: partial.commands,
  };
}

function expandTilde(p: string): string {
  if (p.startsWith("~/")) {
    return path.join(homedir(), p.slice(2));
  }
  return p;
}

function parseIntStrict(value: string, fieldName: string): number {
  const num = Number.parseInt(value, 10);
  if (Number.isNaN(num)) {
    throw new JorchfileParseError(`Invalid integer for "${fieldName}": "${value}"`);
  }
  return num;
}
