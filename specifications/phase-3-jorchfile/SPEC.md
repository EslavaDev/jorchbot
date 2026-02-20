# Phase 3 — Jorchfile Engine

> **Status**: Pending
> **Dependency**: Phase 2 (completed)
> **Deliverable**: Declarative per-project config file with commands, background tasks, auto-port, basic tunnels, Makefile reader
> **When finished**: `/dev frontend` starts the dev server in background with auto-port + Tailscale tunnel, `/test backend` runs tests, `/new frontend` auto-loads Jorchfile config, `/tasks` lists background processes, `/stop-cmd frontend dev` kills a specific task, `/projects` lists all Jorchfile projects, `/make deploy` runs Makefile targets

---

## 1. WHY — Why this phase

Phase 2 delivered multi-session workspaces where you can create sessions with `/new frontend /path/to/frontend`. But every session requires manually specifying the path, and running project commands means typing full shell commands every time.

Real development has repeatable patterns per project: `npm run dev`, `pytest`, `make deploy`. These should be one-tap shortcuts, not typed-out commands. And dev servers are long-running — they shouldn't block your WhatsApp thread.

The **Jorchfile** solves this: a single config file (`~/.jorchbot/Jorchfile`) that declares all your projects with their paths, commands, ports, tunnel preferences, and Claude Code instructions. It turns JorchBot from "a chat with Claude Code" into "a project-aware development control plane."

**What this phase builds**:

1. **Jorchfile Parser** — reads `~/.jorchbot/Jorchfile` (custom Makefile-like format with multi-line support)
2. **Jorchfile Executor** — registers project commands as dynamic `/command` shortcuts
3. **Background Task Manager** — long-running commands (`dev`, `build`) run in background with `/tasks` + `/stop-cmd`
4. **Port Auto-Management** — detects port conflicts, auto-increments, injects `PORT` env var
5. **Basic Tunnel Integration** — auto-starts `tailscale serve/funnel` when `/dev` runs with `tunnel` config
6. **Session Manager Integration** — `/new frontend` auto-loads Jorchfile config; `/dev frontend` auto-creates session
7. **Makefile Reader** — `/make <target>` executes Makefile targets from the project directory
8. **`/projects` command** — lists all Jorchfile projects with session status and background tasks
9. **Hot-reload** — watches Jorchfile for changes, kills affected sessions, reloads commands
10. **Command Priority** — Jorchfile commands take precedence over Phase 2 shell shortcuts

**What is NOT built** (later phases):

- `/tunnels` command (listing all active tunnels) — Phase 4
- Reverse proxy path-based routing for Funnel — Phase 4
- Advanced tunnel lifecycle management — Phase 4
- `/replay`, `/history` commands — Phase 5
- Plan/auto/silent modes via `/mode` — Phase 5
- "Yes + feedback" approvals, Kapso lists — Phase 5
- Telegram channel — Phase 7

---

## 2. WHAT — What is delivered

### 2.1 Jorchfile Format

Location: `~/.jorchbot/Jorchfile`

The Jorchfile is a custom Makefile-like format where each `PROJECT` block declares a project with its path, commands, and config. A `SETTINGS` block provides global overrides.

```makefile
# ~/.jorchbot/Jorchfile

PROJECT frontend
  path = ~/projects/my-app/frontend
  dev = npm run dev
  build = npm run build
  test = npm run test
  lint = npm run lint
  port = 3000
  tunnel = serve
  approve = confirm
  output = verbose
  background = dev, build
  instructions = Eres experto en React y Next.js. \
    Usa App Router con TypeScript. \
    Sigue las convenciones del proyecto.

PROJECT backend
  path = ~/projects/my-app/backend
  dev = python manage.py runserver
  test = pytest
  migrate = python manage.py migrate
  port = 8000
  tunnel = serve
  approve = confirm
  output = verbose
  background = dev
  instructions = @./backend-instructions.md

SETTINGS
  log_retention_days = 7
  summary_retention_days = 30
  error_retention_days = 90
  db_max_size_mb = 500
```

**Format rules**:

- `PROJECT <name>` starts a project block. Name must match `^[a-zA-Z0-9_-]+$`.
- `SETTINGS` starts the global settings block (at most one).
- Indented lines (`  key = value`) belong to the current block.
- Lines starting with `#` are comments, blank lines are ignored.
- Backslash (`\`) at end of line continues to next line.
- Values starting with `@` are file references (read file contents as value).

**Reserved fields** (per project):

| Field          | Type                               | Required | Default            | Description                                                  |
| -------------- | ---------------------------------- | -------- | ------------------ | ------------------------------------------------------------ |
| `path`         | string                             | **Yes**  | —                  | Project directory (~ expanded)                               |
| `port`         | number                             | No       | —                  | Desired local port for `dev`                                 |
| `tunnel`       | `serve` \| `funnel`                | No       | —                  | Tailscale mode for `dev`                                     |
| `funnel_path`  | string                             | No       | —                  | Reserved for Phase 4                                         |
| `approve`      | `confirm` \| `plan` \| `auto`      | No       | `confirm`          | Default approval mode                                        |
| `output`       | `verbose` \| `summary` \| `silent` | No       | `verbose`          | Default output mode                                          |
| `instructions` | string                             | No       | —                  | System prompt for Claude Code                                |
| `background`   | string[]                           | No       | `["dev", "build"]` | Commands that run in background by default (comma-separated) |

Any other `key = value` is a **custom command** (shell shortcut). Examples: `dev`, `build`, `test`, `lint`, `migrate`, `deploy`.

**File references**: Any field value starting with `@` is treated as a file reference. The file contents replace the `@path` value. Paths starting with `./` are resolved relative to the project `path`; absolute paths are used as-is. This works for commands too (e.g., `dev = @./scripts/dev.sh`).

### 2.2 Jorchfile Parser (`src/jorchfile/parser.ts`)

Parses the Jorchfile text into a structured `Jorchfile` object. Handles multi-line values (backslash continuation), file references (`@path`), `~` expansion, and validation.

**Key behaviors**:

- `path` is the only required field per project.
- `~` is expanded to `os.homedir()`.
- `@` prefixed values in **any field except `path`** read the file contents (relative to project `path`, or absolute if starts with `/`). This applies to `instructions`, custom commands, and other fields.
- `path` field does **NOT** support `@file` — it is always a literal string (with `~` expansion). This avoids a circular dependency (`@file` needs `path` to resolve).
- `@file` resolution is **deferred**: all fields are parsed as raw strings first. After the entire `PROJECT` block is parsed and `path` is known, `@file` references are resolved. This means field order within a block does not matter.
- If `@` file does not exist, throws `JorchfileParseError`.
- If `path` directory does not exist, emits a **warning** to console (not a fatal error) — the user might create it later. The warning is logged at load time by the loader, not by the parser.
- Duplicate project names throw `JorchfileValidationError`.
- Empty project name or missing `path` throw `JorchfileValidationError`.

### 2.3 Jorchfile Executor (`src/jorchfile/executor.ts`)

Registers Jorchfile commands dynamically in the CommandRouter and executes them.

**Command resolution logic**:

1. If `/<cmd> <project>` — execute command `cmd` for that project.
2. If `/<cmd>` (no project) — execute in the focused session's project.
3. If no focused session — error with clear message.
4. If the project has no active session — **auto-create session** from Jorchfile config.

**Foreground vs Background**:

- Commands listed in the project's `background` field run in **background** by default (long-running). Default: `["dev", "build"]`.
- All other commands run in **foreground** (output sent to chat).
- Trailing `&` forces any command to background: `/test frontend &`.
- Foreground commands use `ShellRunner.execute()` with output sent to chat.
- Background commands use `child_process.spawn()` with output logged.
- The `background` field is configurable per project: `background = dev, build, start, serve`.

### 2.4 Background Task Manager (`src/jorchfile/task-manager.ts`)

Manages long-running background processes (dev servers, builds).

**In-memory state** (not persisted to DB — tasks are ephemeral, die with gateway):

```
Map<string, BackgroundTask[]>  // key = project name
```

Each `BackgroundTask` tracks: PID, project, command name, spawn time, assigned port, child process handle.

**New commands**:

| Command                     | Action                                                             |
| --------------------------- | ------------------------------------------------------------------ |
| `/tasks`                    | List all background tasks with PID, project, command, port, uptime |
| `/stop-cmd <project> <cmd>` | Kill a specific background task                                    |
| `/stop-cmd <project>`       | Kill ALL background tasks for a project                            |

**Lifecycle**:

- When a background task's process exits, it is removed from the map automatically.
- When a session is destroyed (`/stop <project>`), all its background tasks are killed.
- When a background task finishes or crashes, a notification is sent to chat.

### 2.5 Port Auto-Management (`src/jorchfile/port-manager.ts`)

Prevents port conflicts when multiple projects run simultaneously.

**Logic**:

1. If the Jorchfile project defines `port`, check if that port is free.
2. If occupied, auto-increment until a free port is found (up to +100).
3. Inject `PORT=<assigned>` as environment variable when spawning the command.
4. Notify the user if the port changed.
5. If no `port` is defined in Jorchfile, skip port management entirely.

### 2.6 Basic Tunnel Integration (`src/jorchfile/tunnel.ts`)

When `/dev` runs and the project has `tunnel = serve` or `tunnel = funnel`:

1. After the dev server starts, run `tailscale serve --bg <assigned-port>` or `tailscale funnel --bg <assigned-port>`.
2. For `funnel`, ask user confirmation first (public exposure).
3. Send the tunnel URL to chat.
4. When `/stop-cmd` kills the dev server, close the tunnel with `tailscale serve off <port>` or `tailscale funnel off <port>`.
5. If Tailscale is not installed, send a warning (not a fatal error).

> **Note**: This is basic tunnel integration. Phase 4 adds `/tunnels` listing, reverse proxy, and advanced lifecycle management.

### 2.7 Session Manager Integration

When `/new <project>` is called and the project exists in the Jorchfile:

1. Use the Jorchfile `path` instead of requiring the user to type it.
2. Inject `instructions` as the `systemPrompt` for ClaudeRunner.
3. Apply `approve` and `output` as default modes.
4. Usage: `/new frontend` (no path needed if in Jorchfile).

When a Jorchfile command is called and no session exists for that project:

1. Auto-create the session using Jorchfile config.
2. Then execute the command.
3. Example: `/dev frontend` with no prior `/new` → creates session + runs dev.

The existing `/new <project> <path>` syntax still works for ad-hoc projects not in the Jorchfile.

### 2.8 Makefile Reader (`src/jorchfile/makefile-reader.ts`)

Reads Makefile targets from the focused session's project directory.

- `/make` (no args) → lists available targets.
- `/make <target>` → executes `make <target>` in the project directory.
- If no Makefile exists, responds with a clear message.
- Only parses target names (lines matching `^target:`) — does NOT interpret recipes.

### 2.9 `/projects` Command

Lists all projects defined in the Jorchfile with their current state:

```
User: /projects
Bot:  Proyectos en Jorchfile:
      1. frontend (~/projects/my-app/frontend)
         Comandos: dev, build, test, lint
         Sesion: ● activa (enfocada, 18%)
         Tasks: dev (PID 12345, port 3000)

      2. backend (~/projects/my-app/backend)
         Comandos: dev, test, migrate
         Sesion: ○ activa (background, 8%)
         Tasks: -

      3. mobile (~/projects/my-app/mobile)
         Comandos: dev
         Sesion: sin sesion
         Tasks: -
```

### 2.10 Hot-Reload

Watches `~/.jorchbot/Jorchfile` for changes using `fs.watch()`:

1. Re-parse the file on change.
2. If a project with an active session was **modified** (path or commands changed): kill the session + all background tasks + close tunnels. Notify user.
3. If a project was **removed**: same as modified — kill everything.
4. If a project was **added**: just notify, don't auto-create session.
5. Re-register commands in CommandRouter.
6. Debounce file changes (300ms) to avoid multiple reloads on rapid edits.

### 2.11 Command Priority

The CommandRouter resolves commands in this order:

```
1. Built-in JorchBot commands  → /new, /switch, /list, /stop, /tasks, /stop-cmd,
                                  /compact, /logs, /status, /help, /projects, /make
2. Jorchfile project commands  → /dev, /test, /build, /lint, /migrate, /<custom>
3. Phase 2 shell shortcuts     → /ls, /cat, /grep, /pwd, /git, /tree
4. Makefile targets            → /make <target>
5. Free text                   → Claude Code session
```

If a Jorchfile command name collides with a shell shortcut (e.g., a project defines `git` as a command), the Jorchfile command wins. To force the shell shortcut, use `$ git ...`.

---

## 3. HOW — How it is implemented

### 3.1 Component Architecture

```
WhatsApp User
     │
     ▼ (webhook POST)
┌──────────────────────┐
│   Kapso Channel      │
└──────────┬───────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│   Command Router (extended for Phase 3)                 │
│   Priority: built-in > jorchfile > shell > makefile     │
│                                                         │
│   New commands:                                         │
│   /projects, /tasks, /stop-cmd, /make, /<jorchfile cmd> │
└──────────┬──────────────────────────────────────────────┘
           │
     ┌─────┼────────────────┬───────────────────┐
     ▼     ▼                ▼                   ▼
┌─────────┐ ┌────────────┐ ┌────────────────┐ ┌──────────┐
│ Session │ │ Jorchfile  │ │ Background     │ │ Makefile │
│ Manager │ │ Executor   │ │ Task Manager   │ │ Reader   │
│ (Ph. 2) │ │            │ │                │ │          │
└─────────┘ └─────┬──────┘ └───────┬────────┘ └──────────┘
                  │               │
            ┌─────┼───────┐       │
            ▼     ▼       ▼      ▼
      ┌────────┐ ┌──────┐ ┌──────────┐
      │ Parser │ │ Port │ │ Tunnel   │
      │        │ │ Mgr  │ │ (basic)  │
      └────────┘ └──────┘ └──────────┘
```

### 3.2 Jorchfile Parser — Detail

#### 3.2.1 Types (Zod schemas — single source of truth)

All types are inferred from Zod schemas. No duplicate plain interfaces.

```typescript
// src/jorchfile/parser.ts
import { z } from "zod";

/** Default commands that run in background */
const DEFAULT_BACKGROUND_COMMANDS = ["dev", "build"];

const JorchProjectSchema = z.object({
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

const JorchSettingsSchema = z.object({
  logRetentionDays: z.number().int().min(1).optional(),
  summaryRetentionDays: z.number().int().min(1).optional(),
  errorRetentionDays: z.number().int().min(1).optional(),
  dbMaxSizeMb: z.number().int().min(10).optional(),
});

const JorchfileSchema = z.object({
  projects: z.array(JorchProjectSchema),
  settings: JorchSettingsSchema,
});

export type JorchProject = z.infer<typeof JorchProjectSchema>;
export type JorchSettings = z.infer<typeof JorchSettingsSchema>;
export type Jorchfile = z.infer<typeof JorchfileSchema>;
```

#### 3.2.2 Parser implementation

```typescript
// src/jorchfile/parser.ts
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { JorchfileParseError, JorchfileValidationError } from "../errors/index.js";

const RESERVED_FIELDS = new Set([
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
  /** Raw fields for the current PROJECT block (key → { value, lineNum }) */
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
  if (settings.log_retention_days) {
    jorchSettings.logRetentionDays = parseIntStrict(
      settings.log_retention_days,
      "log_retention_days",
    );
  }
  if (settings.summary_retention_days) {
    jorchSettings.summaryRetentionDays = parseIntStrict(
      settings.summary_retention_days,
      "summary_retention_days",
    );
  }
  if (settings.error_retention_days) {
    jorchSettings.errorRetentionDays = parseIntStrict(
      settings.error_retention_days,
      "error_retention_days",
    );
  }
  if (settings.db_max_size_mb) {
    jorchSettings.dbMaxSizeMb = parseIntStrict(settings.db_max_size_mb, "db_max_size_mb");
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
    if (key === "path") continue; // already handled

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
    background: partial.background, // undefined → Zod default ["dev", "build"]
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
```

#### 3.2.3 Loading the Jorchfile from disk

```typescript
// src/jorchfile/loader.ts
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { JorchfileParseError } from "../errors/index.js";
import { parseJorchfile } from "./parser.js";
import type { Jorchfile } from "./parser.js";

const DEFAULT_JORCHFILE_PATH = path.join(homedir(), ".jorchbot", "Jorchfile");

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

export { DEFAULT_JORCHFILE_PATH };
```

### 3.3 Jorchfile Executor — Detail

```typescript
// src/jorchfile/executor.ts
import type { Jorchfile, JorchProject } from "./parser.js";
import type { BackgroundTaskManager, BackgroundTask } from "./task-manager.js";
import type { PortManager } from "./port-manager.js";
import type { TunnelManager } from "./tunnel.js";
import type { SessionManager } from "../sessions/jorchbot/manager.js";
import type { ShellRunner } from "../sessions/jorchbot/shell-runner.js";
import { JorchfileProjectNotFoundError, JorchfileCommandNotFoundError } from "../errors/index.js";

/** Default commands that run in background (used when project has no explicit `background` field) */
const DEFAULT_BACKGROUND_COMMANDS = ["dev", "build"];

interface JorchfileExecutorDeps {
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
    await this.deps.tunnelManager.stop(project, port);
  }

  /** Stop all tunnels for a project (delegates to TunnelManager) */
  async stopAllTunnels(project: string): Promise<void> {
    await this.deps.tunnelManager.stopAll(project);
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
  ): Promise<void> {
    // Resolve project
    const resolvedProjectName = projectName ?? this.getProjectFromFocused();
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

    // Auto-create session if none exists
    await this.ensureSession(project);

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
    commandName: string,
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
        `[${project.name}] Error running "${commandName}": ${err instanceof Error ? err.message : String(err)}`,
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

    // Start tunnel if configured
    if (project.tunnel && assignedPort !== undefined) {
      await this.deps.tunnelManager.start({
        project: project.name,
        port: assignedPort,
        mode: project.tunnel,
      });
    }
  }

  private async ensureSession(project: JorchProject): Promise<void> {
    const existing = this.deps.sessionManager.getByProject(project.name);
    if (existing) {
      return;
    }

    try {
      await this.deps.sessionManager.create({
        project: project.name,
        path: project.path,
        systemPrompt: project.instructions,
      });

      await this.deps.sendReply(
        `[${project.name}] Session auto-created from Jorchfile\nPath: ${project.path}`,
      );
    } catch (err: unknown) {
      await this.deps.sendReply(
        `[${project.name}] Failed to auto-create session: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private getProjectFromFocused(): string | null {
    const focused = this.deps.sessionManager.getFocused();
    return focused?.project ?? null;
  }
}
```

### 3.4 Background Task Manager — Detail

```typescript
// src/jorchfile/task-manager.ts
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

interface StartTaskInput {
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
  /** Map: project name → list of background tasks */
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
      const emoji = code === 0 ? "🔔" : "🔴";
      const status = code === 0 ? "finished" : `crashed (exit ${code})`;
      const uptime = formatUptime(task.startedAt);
      void this.deps.sendReply(
        `[${input.project}] ${emoji} Background task "${input.commandName}" ${status} (${uptime})`,
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
    if (!tasks) return;
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
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
```

### 3.5 Port Manager — Detail

```typescript
// src/jorchfile/port-manager.ts
import { createServer } from "node:net";

const MAX_PORT_SEARCH = 100;

export class PortManager {
  /**
   * Find an available port starting from the desired port.
   * If the desired port is in use, increments until finding a free one.
   *
   * @param desired - The preferred port number
   * @returns The first available port (may equal desired)
   * @throws {Error} If no free port found within MAX_PORT_SEARCH range
   */
  async findAvailablePort(desired: number): Promise<number> {
    for (let port = desired; port < desired + MAX_PORT_SEARCH; port++) {
      const free = await this.isPortFree(port);
      if (free) {
        return port;
      }
    }
    throw new Error(`No free port found in range ${desired}-${desired + MAX_PORT_SEARCH - 1}`);
  }

  /**
   * Check if a port is available by attempting to listen on it.
   */
  async isPortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close(() => resolve(true));
      });
      server.listen(port, "127.0.0.1");
    });
  }
}
```

### 3.6 Basic Tunnel Manager — Detail

```typescript
// src/jorchfile/tunnel.ts
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

interface TunnelStartInput {
  project: string;
  port: number;
  mode: "serve" | "funnel";
}

interface ActiveTunnel {
  project: string;
  port: number;
  mode: "serve" | "funnel";
  url: string;
}

interface TunnelManagerDeps {
  sendReply: (text: string) => Promise<void>;
  sendButtons: (text: string, buttons: Array<{ id: string; title: string }>) => Promise<void>;
}

export class TunnelManager {
  private activeTunnels = new Map<string, ActiveTunnel>(); // key = "project:port"
  private deps: TunnelManagerDeps;

  constructor(deps: TunnelManagerDeps) {
    this.deps = deps;
  }

  /**
   * Start a Tailscale tunnel for a project.
   * For funnel mode, asks user confirmation first (public exposure).
   */
  async start(input: TunnelStartInput): Promise<void> {
    // Check if tailscale is available
    const available = await this.isTailscaleAvailable();
    if (!available) {
      await this.deps.sendReply(
        `[${input.project}] Tailscale not installed. Tunnel skipped. Install: https://tailscale.com/download`,
      );
      return;
    }

    if (input.mode === "funnel") {
      // Funnel is public — ask confirmation
      await this.deps.sendButtons(
        `[${input.project}] Funnel exposes port ${input.port} to the public internet. Continue?`,
        [
          {
            id: JSON.stringify({
              type: "tunnel_approve",
              project: input.project,
              port: input.port,
            }),
            title: "Yes, expose",
          },
          {
            id: JSON.stringify({ type: "tunnel_reject", project: input.project }),
            title: "No",
          },
        ],
      );
      return;
    }

    await this.startServe(input);
  }

  /** Execute tailscale serve */
  async startServe(input: TunnelStartInput): Promise<void> {
    const cmd =
      input.mode === "funnel"
        ? `tailscale funnel --bg ${input.port}`
        : `tailscale serve --bg ${input.port}`;

    try {
      await execAsync(cmd);

      // Get the tunnel URL
      const url = await this.getTunnelUrl(input.port);

      const key = `${input.project}:${input.port}`;
      this.activeTunnels.set(key, {
        project: input.project,
        port: input.port,
        mode: input.mode,
        url,
      });

      const modeLabel = input.mode === "funnel" ? "public" : "tailnet only";
      await this.deps.sendReply(`[${input.project}] Tunnel active (${modeLabel}):\n${url}`);
    } catch (err: unknown) {
      await this.deps.sendReply(
        `[${input.project}] Tunnel failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Stop a tunnel for a project+port */
  async stop(project: string, port: number): Promise<void> {
    const key = `${project}:${port}`;
    const tunnel = this.activeTunnels.get(key);
    if (!tunnel) return;

    const cmd =
      tunnel.mode === "funnel" ? `tailscale funnel off ${port}` : `tailscale serve off ${port}`;

    try {
      await execAsync(cmd);
    } catch {
      // Best-effort — tunnel may already be stopped
    }

    this.activeTunnels.delete(key);
    await this.deps.sendReply(`[${project}] Tunnel closed: ${tunnel.url}`);
  }

  /** Stop all tunnels for a project */
  async stopAll(project: string): Promise<void> {
    const toRemove: string[] = [];
    for (const [key, tunnel] of this.activeTunnels) {
      if (tunnel.project === project) {
        toRemove.push(key);
        const cmd =
          tunnel.mode === "funnel"
            ? `tailscale funnel off ${tunnel.port}`
            : `tailscale serve off ${tunnel.port}`;
        try {
          await execAsync(cmd);
        } catch {
          // Best-effort
        }
      }
    }
    for (const key of toRemove) {
      this.activeTunnels.delete(key);
    }
  }

  /** List all active tunnels */
  listAll(): ActiveTunnel[] {
    return [...this.activeTunnels.values()];
  }

  private async isTailscaleAvailable(): Promise<boolean> {
    try {
      await execAsync("tailscale version");
      return true;
    } catch {
      return false;
    }
  }

  private async getTunnelUrl(port: number): Promise<string> {
    try {
      const { stdout } = await execAsync("tailscale status --json");
      const status = JSON.parse(stdout) as { Self?: { DNSName?: string } };
      const dnsName = status.Self?.DNSName?.replace(/\.$/, "") ?? "localhost";
      return `https://${dnsName}:${port}`;
    } catch {
      return `https://<your-device>.ts.net:${port}`;
    }
  }
}
```

### 3.7 Makefile Reader — Detail

```typescript
// src/jorchfile/makefile-reader.ts
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { MakefileReadError } from "../errors/index.js";

/** Regex to match Makefile target lines: "target:" or "target: deps" */
const TARGET_PATTERN = /^([a-zA-Z0-9_-]+)\s*:/;

/**
 * Read Makefile targets from a project directory.
 *
 * @param projectPath - The project directory
 * @returns Array of target names, or empty if no Makefile exists
 * @throws {MakefileReadError} If Makefile exists but cannot be read
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
    // Skip lines starting with . (special targets like .PHONY)
    if (line.startsWith(".")) continue;
    // Skip lines starting with tab/space (recipe lines)
    if (line.startsWith("\t") || line.startsWith(" ")) continue;

    const match = TARGET_PATTERN.exec(line);
    if (match?.[1]) {
      targets.push(match[1]);
    }
  }

  return targets;
}
```

### 3.8 Hot-Reload Watcher — Detail

```typescript
// src/jorchfile/watcher.ts
import { watch, existsSync } from "node:fs";
import type { FSWatcher } from "node:fs";
import { loadJorchfile, DEFAULT_JORCHFILE_PATH } from "./loader.js";
import type { Jorchfile, JorchProject } from "./parser.js";

interface WatcherDeps {
  onReload: (jorchfile: Jorchfile, changes: JorchfileChanges) => void;
  onError: (err: Error) => void;
}

interface JorchfileChanges {
  added: string[]; // project names added
  removed: string[]; // project names removed
  modified: string[]; // project names modified (path or commands changed)
}

const DEBOUNCE_MS = 300;

export class JorchfileWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private previousProjects = new Map<string, JorchProject>();
  private deps: WatcherDeps;
  private filePath: string;

  constructor(deps: WatcherDeps, filePath?: string) {
    this.deps = deps;
    this.filePath = filePath ?? DEFAULT_JORCHFILE_PATH;
  }

  /** Start watching. Sets initial state from current Jorchfile. */
  start(initialJorchfile: Jorchfile | null): void {
    if (initialJorchfile) {
      for (const p of initialJorchfile.projects) {
        this.previousProjects.set(p.name, p);
      }
    }

    if (!existsSync(this.filePath)) {
      return; // Nothing to watch — file might be created later
    }

    this.watcher = watch(this.filePath, () => {
      this.debouncedReload();
    });
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.watcher?.close();
    this.watcher = null;
  }

  private debouncedReload(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.reload();
    }, DEBOUNCE_MS);
  }

  private reload(): void {
    try {
      const jorchfile = loadJorchfile(this.filePath);
      if (!jorchfile) {
        // File was deleted — treat all projects as removed
        const removed = [...this.previousProjects.keys()];
        this.previousProjects.clear();
        this.deps.onReload({ projects: [], settings: {} }, { added: [], removed, modified: [] });
        return;
      }

      const changes = this.computeChanges(jorchfile);
      this.updatePrevious(jorchfile);
      this.deps.onReload(jorchfile, changes);
    } catch (err: unknown) {
      this.deps.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private computeChanges(newJorchfile: Jorchfile): JorchfileChanges {
    const newNames = new Set(newJorchfile.projects.map((p) => p.name));
    const oldNames = new Set(this.previousProjects.keys());

    const added: string[] = [];
    const removed: string[] = [];
    const modified: string[] = [];

    // Added
    for (const name of newNames) {
      if (!oldNames.has(name)) {
        added.push(name);
      }
    }

    // Removed
    for (const name of oldNames) {
      if (!newNames.has(name)) {
        removed.push(name);
      }
    }

    // Modified (exists in both, but path or commands changed)
    for (const newProject of newJorchfile.projects) {
      const old = this.previousProjects.get(newProject.name);
      if (!old) continue;

      if (
        old.path !== newProject.path ||
        JSON.stringify(old.commands) !== JSON.stringify(newProject.commands) ||
        old.instructions !== newProject.instructions
      ) {
        modified.push(newProject.name);
      }
    }

    return { added, removed, modified };
  }

  private updatePrevious(jorchfile: Jorchfile): void {
    this.previousProjects.clear();
    for (const p of jorchfile.projects) {
      this.previousProjects.set(p.name, p);
    }
  }
}
```

### 3.9 CommandRouter Extensions — Detail

The CommandRouter (Phase 2) is extended with the following changes:

1. **New dependency**: `JorchfileExecutor` (optional — null if no Jorchfile).
2. **New dependency**: `BackgroundTaskManager`.
3. **New handlers**: `/projects`, `/tasks`, `/stop-cmd`, `/make`, and dynamic Jorchfile commands.
4. **Updated `handleCommand()`**: checks Jorchfile commands before falling through to `default`.
5. **Updated `handleNew()`**: looks up Jorchfile for project config.

```typescript
// Changes to src/commands/router.ts

// Extended deps interface
export interface CommandRouterDeps {
  sessionManager: SessionManager;
  shellRunner: ShellRunner;
  /** Getter function — always returns the current executor (supports hot-reload updates) */
  getJorchfileExecutor: () => JorchfileExecutor | null;
  taskManager: BackgroundTaskManager;
  sendReply: (text: string) => Promise<void>;
  sendButtons: (text: string, buttons: Array<{ id: string; title: string }>) => Promise<void>;
}

// Updated handleCommand — new priority chain
private async handleCommand(command: string, args: string[]): Promise<void> {
  // 1. Built-in commands (highest priority)
  switch (command) {
    case "new":    return this.handleNew(args);
    case "switch": return this.handleSwitch(args);
    case "list":   return this.handleList();
    case "stop":   return this.handleStop(args);
    case "logs":   return this.handleLogs(args);
    case "compact": return this.handleCompact(args);
    case "help":   return this.handleHelp();
    case "status": return this.handleStatus();
    // Phase 3 built-ins
    case "projects": return this.handleProjects();
    case "tasks":    return this.handleTasks();
    case "stop-cmd": return this.handleStopCmd(args);
    case "make":     return this.handleMake(args);
  }

  // 2. Jorchfile commands (second priority)
  if (this.deps.getJorchfileExecutor()?.hasCommand(command)) {
    // Parse trailing "&" for forced background execution
    const lastArg = args.length > 0 ? args[args.length - 1] : undefined;
    const forceBackground = lastArg === "&";
    const cleanArgs = forceBackground ? args.slice(0, -1) : args;
    const project = cleanArgs[0]; // undefined if no project specified
    try {
      await this.deps.getJorchfileExecutor().execute(command, project, forceBackground);
    } catch (err: unknown) {
      await this.deps.sendReply(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return;
  }

  // 3. Shell shortcuts (third priority)
  switch (command) {
    case "ls":   return this.handleShell(`ls -la ${args.join(" ")}`.trim());
    case "cat":  return this.handleShell(`cat ${args.join(" ")}`.trim());
    case "grep": return this.handleShell(`grep -rn ${args.join(" ")}`.trim());
    case "pwd":  return this.handleShell("pwd");
    case "git":  return this.handleShell(`git ${args.join(" ")}`.trim());
    case "tree": return this.handleShell(`tree -L ${args[0] ?? "3"}`.trim());
  }

  // 4. Unknown
  await this.deps.sendReply(
    `Unknown command: /${command}\nUse /help to see available commands.`,
  );
}

// Updated handleNew — Jorchfile integration
private async handleNew(args: string[]): Promise<void> {
  const [project, ...pathParts] = args;
  if (!project) {
    await this.deps.sendReply("Usage: /new <project> [path]");
    return;
  }

  // Check Jorchfile first
  const jorchProject = this.deps.getJorchfileExecutor()?.getProject(project);
  const projectPath = pathParts.join(" ") || jorchProject?.path;

  if (!projectPath) {
    await this.deps.sendReply(
      `"${project}" not found in Jorchfile. Usage: /new ${project} <path>`,
    );
    return;
  }

  try {
    const session = await this.deps.sessionManager.create({
      project,
      path: projectPath,
      systemPrompt: jorchProject?.instructions,
    });

    const lines = [
      `[${project}] Session created${jorchProject ? " (from Jorchfile)" : ""}`,
      `Path: ${session.path}`,
      `Mode: ${session.mode}+${session.outputMode}`,
      `Context: ${session.contextPercent}%`,
    ];
    if (jorchProject?.instructions) {
      lines.push(`Instructions: "${jorchProject.instructions.slice(0, 80)}..."`);
    }

    await this.deps.sendReply(lines.join("\n"));
  } catch (err: unknown) {
    await this.deps.sendReply(
      `Failed to create session: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
```

**New command handlers**:

```typescript
// /projects
private async handleProjects(): Promise<void> {
  const executor = this.deps.getJorchfileExecutor();
  if (!executor) {
    await this.deps.sendReply("No Jorchfile loaded. Create one at ~/.jorchbot/Jorchfile");
    return;
  }

  const jorchfile = executor.getJorchfile();
  const lines = ["*Jorchfile projects:*", ""];

  for (const project of jorchfile.projects) {
    const session = this.deps.sessionManager.getByProject(project.name);
    const tasks = this.deps.taskManager.listByProject(project.name);

    const cmds = Object.keys(project.commands).join(", ") || "(none)";
    let sessionStatus: string;
    if (session) {
      const focused = this.deps.sessionManager.getFocused();
      const isFocused = focused?.project === project.name;
      const contextPercent = session.runner.getContextPercent();
      sessionStatus = isFocused
        ? `● active (focused, ${contextPercent}%)`
        : `○ active (background, ${contextPercent}%)`;
    } else {
      sessionStatus = "no session";
    }

    let taskStatus = "-";
    if (tasks.length > 0) {
      taskStatus = tasks
        .map((t) => `${t.commandName} (PID ${t.pid}${t.port ? `, port ${t.port}` : ""})`)
        .join(", ");
    }

    lines.push(`*${project.name}* (${project.path})`);
    lines.push(`  Commands: ${cmds}`);
    lines.push(`  Session: ${sessionStatus}`);
    lines.push(`  Tasks: ${taskStatus}`);
    lines.push("");
  }

  await this.deps.sendReply(lines.join("\n"));
}

// /tasks
private async handleTasks(): Promise<void> {
  const tasks = this.deps.taskManager.listAll();

  if (tasks.length === 0) {
    await this.deps.sendReply("No background tasks running.");
    return;
  }

  const lines = ["*Background tasks:*", ""];
  for (const task of tasks) {
    const uptime = formatUptime(task.startedAt);
    const portInfo = task.port ? `port ${task.port}` : "-";
    lines.push(
      `PID ${task.pid}  ${task.project}  ${task.commandName}  ${uptime}  ${portInfo}`,
    );
  }

  await this.deps.sendReply(lines.join("\n"));
}

// /stop-cmd <project> [cmd]
private async handleStopCmd(args: string[]): Promise<void> {
  const [project, commandName] = args;
  if (!project) {
    await this.deps.sendReply("Usage: /stop-cmd <project> [command]");
    return;
  }

  try {
    if (commandName) {
      // Get port before stopping (for tunnel cleanup)
      const tasks = this.deps.taskManager.listByProject(project);
      const task = tasks.find((t) => t.commandName === commandName);
      const taskPort = task?.port;

      // Stop specific task
      this.deps.taskManager.stop(project, commandName);

      // Stop associated tunnel via executor's public method
      if (taskPort !== undefined && this.deps.getJorchfileExecutor()) {
        await this.deps.getJorchfileExecutor().stopTunnel(project, taskPort);
      }

      await this.deps.sendReply(`[${project}] Stopped "${commandName}"`);
    } else {
      // Stop ALL tasks for project
      const killed = this.deps.taskManager.stopAll(project);
      if (killed === 0) {
        await this.deps.sendReply(`[${project}] No background tasks to stop.`);
      } else {
        // Stop all tunnels via executor's public method
        if (this.deps.getJorchfileExecutor()) {
          await this.deps.getJorchfileExecutor().stopAllTunnels(project);
        }
        await this.deps.sendReply(`[${project}] Stopped ${killed} background task(s)`);
      }
    }
  } catch (err: unknown) {
    await this.deps.sendReply(
      `Error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// /make [target]
private async handleMake(args: string[]): Promise<void> {
  const focused = this.deps.sessionManager.getFocused();
  if (!focused) {
    await this.deps.sendReply("No active session. Use /new <project> first.");
    return;
  }

  if (args.length === 0) {
    // List targets
    const targets = readMakefileTargets(focused.path);
    if (targets.length === 0) {
      await this.deps.sendReply(`[${focused.project}] No Makefile found in this workspace.`);
    } else {
      await this.deps.sendReply(
        `[${focused.project}] Makefile targets:\n${targets.map((t) => `  - ${t}`).join("\n")}`,
      );
    }
    return;
  }

  const target = args.join(" ");
  await this.executeShell(`make ${target}`, focused);
}
```

### 3.10 SETTINGS Override Logic

When the Jorchfile SETTINGS block is loaded, its values override the corresponding config values from `jorchbot.json`. This happens at load time in `jorchbot-start.ts`:

```typescript
// In jorchbot-start.ts, after loading both config and Jorchfile
const config = loadConfig();
const jorchfile = loadJorchfile();

if (jorchfile?.settings) {
  const s = jorchfile.settings;
  // Override config with Jorchfile SETTINGS (Jorchfile is more specific)
  if (s.logRetentionDays !== undefined) config.db.logRetentionDays = s.logRetentionDays;
  if (s.summaryRetentionDays !== undefined) config.db.summaryRetentionDays = s.summaryRetentionDays;
  if (s.errorRetentionDays !== undefined) config.db.errorRetentionDays = s.errorRetentionDays;
  if (s.dbMaxSizeMb !== undefined) config.db.maxSizeMb = s.dbMaxSizeMb;
}
```

### 3.11 Gateway Integration Updates

`src/gateway/jorchbot-start.ts` is updated to wire the new Phase 3 components:

```typescript
// After creating sessionManager, shellRunner, and loading config:

const jorchfile = loadJorchfile();

const taskManager = new BackgroundTaskManager({ sendReply });
const portManager = new PortManager();
const tunnelManager = new TunnelManager({ sendReply, sendButtons });

let jorchfileExecutor: JorchfileExecutor | null = null;

if (jorchfile) {
  // Apply SETTINGS overrides
  applyJorchfileSettings(config, jorchfile.settings);

  jorchfileExecutor = new JorchfileExecutor({
    jorchfile,
    sessionManager,
    shellRunner,
    taskManager,
    portManager,
    tunnelManager,
    sendReply,
    sendButtons,
  });

  console.log(`[jorchbot] Jorchfile loaded: ${jorchfile.projects.length} project(s)`);
}

// Start hot-reload watcher
const watcher = new JorchfileWatcher({
  onReload: (newJorchfile, changes) => {
    if (jorchfileExecutor) {
      jorchfileExecutor.updateJorchfile(newJorchfile);
    } else {
      jorchfileExecutor = new JorchfileExecutor({
        jorchfile: newJorchfile,
        sessionManager,
        shellRunner,
        taskManager,
        portManager,
        tunnelManager,
        sendReply,
        sendButtons,
      });
    }

    // Kill sessions for modified/removed projects
    for (const name of [...changes.modified, ...changes.removed]) {
      taskManager.stopAll(name);
      void tunnelManager.stopAll(name);
      const session = sessionManager.getByProject(name);
      if (session) {
        void sessionManager.destroy(name);
        void sendReply(
          `[${name}] Jorchfile changed. Session destroyed. Use /new ${name} to recreate.`,
        );
      }
    }

    if (changes.added.length > 0) {
      void sendReply(`Jorchfile updated. New projects: ${changes.added.join(", ")}`);
    }
  },
  onError: (err) => {
    console.error("[jorchbot] Jorchfile reload error:", err.message);
  },
});

watcher.start(jorchfile);

// Update CommandRouter with new deps (getter for hot-reload support)
const router = new CommandRouter({
  sessionManager,
  shellRunner,
  getJorchfileExecutor: () => jorchfileExecutor,
  taskManager,
  sendReply,
  sendButtons,
});

// Update shutdown handler — kill all background tasks
const shutdown = async () => {
  watcher.stop();
  const allTasks = taskManager.listAll();
  for (const task of allTasks) {
    task.process.kill("SIGTERM");
  }
  // ... existing session cleanup
};
```

---

## 4. Errors

### 4.1 Error classes (already stubbed in `src/errors/index.ts`)

The Phase 3 error classes already exist as stubs. They need clear, descriptive messages:

| Error                           | When                                       | User-facing message example                            |
| ------------------------------- | ------------------------------------------ | ------------------------------------------------------ |
| `JorchfileParseError`           | Syntax error, bad format, unreadable @file | `Line 5: expected "key = value" format`                |
| `JorchfileValidationError`      | Missing `path`, duplicate names            | `Project "frontend" missing required field "path"`     |
| `JorchfileProjectNotFoundError` | `/dev unknown`                             | `Project "unknown" not found in Jorchfile`             |
| `JorchfileCommandNotFoundError` | `/migrate frontend` when not defined       | `Command "migrate" not defined for project "frontend"` |
| `MakefileReadError`             | Can't read Makefile                        | `Cannot read Makefile: /path/to/Makefile`              |
| `BackgroundTaskStartError`      | `spawn()` fails                            | `Failed to start "dev" for frontend`                   |
| `BackgroundTaskNotFoundError`   | `/stop-cmd` for unknown task               | `No background task "dev" for project "frontend"`      |

All extend `JorchBotError`. All chain original cause with `{ cause: err }`.

---

## 5. Design Decisions

### 5.1 Why a custom Makefile-like format instead of YAML/JSON/TOML

The Jorchfile is a **UX differentiator**. It looks and feels like a developer tool (Makefile, Dockerfile, Procfile). Key reasons:

- **Minimal syntax**: no quotes, no braces, no colons — just `key = value`.
- **Familiar**: any developer who's seen a Makefile or Procfile recognizes it instantly.
- **Comments**: `#` comments for documentation.
- **Multi-line**: backslash continuation, same as shell/Makefile.
- **No dependencies**: no YAML parser needed — the parser is ~150 lines of custom code.

### 5.2 Why background tasks are in-memory only

Background tasks (dev servers, builds) are ephemeral by definition. They die when the gateway stops. Persisting them to DB would create stale state — a DB record saying "PID 12345 is running" is useless after a restart because PID 12345 no longer exists.

The `BackgroundTask` interface holds a `ChildProcess` handle — this is inherently in-memory. On gateway restart, all background tasks must be re-started manually by the user.

### 5.3 Why auto-create sessions from Jorchfile

The friction of `/new frontend /path/to/frontend` followed by `/dev frontend` is unnecessary when the Jorchfile already knows the path. Auto-creation means `/dev frontend` "just works" even without a prior `/new`.

This mirrors how `docker-compose up` creates containers from the compose file without requiring `docker create` first.

### 5.4 Why SETTINGS override jorchbot.json

The Jorchfile is project-aware and user-edited frequently. `jorchbot.json` is the base config that rarely changes. When both exist, the more specific (Jorchfile) wins. This follows the principle of least surprise.

### 5.5 Why hot-reload kills sessions instead of updating them

A modified Jorchfile means the project's path, commands, or instructions may have changed. An active session was created with the old config — its ClaudeRunner has the old system prompt, its working directory might point to a moved folder. Updating in-place would require re-injecting the system prompt (not supported by Claude Code) and potentially re-patching hooks.

Killing and letting the user recreate is cleaner, simpler, and avoids subtle state bugs.

### 5.6 Why basic tunnel in Phase 3 instead of full Phase 4

Phase 3's tunnel is minimal: start `tailscale serve/funnel --bg <port>` and stop it. No `/tunnels` listing, no reverse proxy, no lifecycle management. This keeps Phase 3 focused on the Jorchfile engine while making `/dev frontend` immediately useful (dev server + tunnel in one command).

Phase 4 adds the full tunnel management system on top of this basic foundation.

---

## 6. Testing

### 6.1 Strategy

- **Unit tests**: Parser, executor, task manager, port manager, tunnel manager, makefile reader, watcher — all tested in isolation with mocks.
- **No live tests**: No real Tailscale, no real dev servers, no real file watchers in unit tests.
- **Test isolation**: Temp directories for Jorchfile, mock `SessionManager`, mock `ShellRunner`.

### 6.2 Tests by module

#### Jorchfile Parser (`src/jorchfile/parser.test.ts`)

```typescript
describe("parseJorchfile", () => {
  it("parses a basic Jorchfile with one project", () => {
    const content = `
PROJECT frontend
  path = /tmp/frontend
  dev = npm run dev
  test = npm test
`;
    const result = parseJorchfile(content);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].name).toBe("frontend");
    expect(result.projects[0].path).toBe("/tmp/frontend");
    expect(result.projects[0].commands).toStrictEqual({
      dev: "npm run dev",
      test: "npm test",
    });
  });

  it("parses multiple projects", () => {
    const content = `
PROJECT frontend
  path = /tmp/frontend
  dev = npm run dev

PROJECT backend
  path = /tmp/backend
  dev = python manage.py runserver
`;
    const result = parseJorchfile(content);
    expect(result.projects).toHaveLength(2);
    expect(result.projects[0].name).toBe("frontend");
    expect(result.projects[1].name).toBe("backend");
  });

  it("parses reserved fields correctly", () => {
    const content = `
PROJECT test-proj
  path = /tmp/test
  port = 3000
  tunnel = serve
  approve = auto
  output = silent
`;
    const result = parseJorchfile(content);
    const p = result.projects[0];
    expect(p.port).toBe(3000);
    expect(p.tunnel).toBe("serve");
    expect(p.approve).toBe("auto");
    expect(p.output).toBe("silent");
  });

  it("handles backslash continuation", () => {
    const content = `
PROJECT frontend
  path = /tmp/frontend
  instructions = Line one. \\
    Line two. \\
    Line three.
`;
    const result = parseJorchfile(content);
    expect(result.projects[0].instructions).toBe("Line one. Line two. Line three.");
  });

  it("expands ~ in path", () => {
    const content = `
PROJECT frontend
  path = ~/projects/frontend
`;
    const result = parseJorchfile(content);
    expect(result.projects[0].path).not.toContain("~");
    expect(result.projects[0].path).toContain("projects/frontend");
  });

  it("parses SETTINGS block", () => {
    const content = `
PROJECT p
  path = /tmp/p

SETTINGS
  log_retention_days = 14
  db_max_size_mb = 1000
`;
    const result = parseJorchfile(content);
    expect(result.settings.logRetentionDays).toBe(14);
    expect(result.settings.dbMaxSizeMb).toBe(1000);
  });

  it("ignores comments and blank lines", () => {
    const content = `
# This is a comment

PROJECT frontend
  # Another comment
  path = /tmp/frontend

`;
    const result = parseJorchfile(content);
    expect(result.projects).toHaveLength(1);
  });

  it("throws JorchfileValidationError for missing path", () => {
    const content = `
PROJECT frontend
  dev = npm run dev
`;
    expect(() => parseJorchfile(content)).toThrow(JorchfileValidationError);
  });

  it("throws JorchfileValidationError for duplicate project names", () => {
    const content = `
PROJECT frontend
  path = /tmp/a

PROJECT frontend
  path = /tmp/b
`;
    expect(() => parseJorchfile(content)).toThrow(JorchfileValidationError);
  });

  it("throws JorchfileParseError for invalid format", () => {
    const content = `random text without a block`;
    expect(() => parseJorchfile(content)).toThrow(JorchfileParseError);
  });

  it("throws JorchfileParseError for invalid tunnel value", () => {
    const content = `
PROJECT p
  path = /tmp/p
  tunnel = cloudflare
`;
    expect(() => parseJorchfile(content)).toThrow(JorchfileParseError);
  });

  it("parses background field as comma-separated list", () => {
    const content = `
PROJECT frontend
  path = /tmp/frontend
  dev = npm run dev
  start = npm start
  background = dev, start, watch
`;
    const result = parseJorchfile(content);
    expect(result.projects[0].background).toStrictEqual(["dev", "start", "watch"]);
  });

  it("defaults background to ['dev', 'build'] when not specified", () => {
    const content = `
PROJECT frontend
  path = /tmp/frontend
  dev = npm run dev
`;
    const result = parseJorchfile(content);
    expect(result.projects[0].background).toStrictEqual(["dev", "build"]);
  });

  it("resolves @file references in command values", () => {
    // Create temp file with command content, then:
    // dev = @./scripts/dev.sh → reads file content as the command
    // Test verifies the value is the file content, not "@./scripts/dev.sh"
  });
});
```

#### Background Task Manager (`src/jorchfile/task-manager.test.ts`)

```typescript
describe("BackgroundTaskManager", () => {
  it("starts a task and assigns PID", async () => {
    const manager = createTestTaskManager();
    const task = await manager.start({
      project: "frontend",
      commandName: "dev",
      shellCommand: "sleep 60",
      cwd: "/tmp",
    });
    expect(task.pid).toBeGreaterThan(0);
    expect(task.project).toBe("frontend");
    expect(task.commandName).toBe("dev");
    task.process.kill("SIGTERM");
  });

  it("lists all tasks", async () => {
    const manager = createTestTaskManager();
    const t1 = await manager.start({
      project: "a",
      commandName: "dev",
      shellCommand: "sleep 60",
      cwd: "/tmp",
    });
    const t2 = await manager.start({
      project: "b",
      commandName: "dev",
      shellCommand: "sleep 60",
      cwd: "/tmp",
    });
    expect(manager.listAll()).toHaveLength(2);
    t1.process.kill("SIGTERM");
    t2.process.kill("SIGTERM");
  });

  it("stops a specific task", async () => {
    const manager = createTestTaskManager();
    await manager.start({
      project: "frontend",
      commandName: "dev",
      shellCommand: "sleep 60",
      cwd: "/tmp",
    });
    manager.stop("frontend", "dev");
    // Task is removed async on exit event
  });

  it("stops all tasks for a project", async () => {
    const manager = createTestTaskManager();
    await manager.start({
      project: "frontend",
      commandName: "dev",
      shellCommand: "sleep 60",
      cwd: "/tmp",
    });
    await manager.start({
      project: "frontend",
      commandName: "build",
      shellCommand: "sleep 60",
      cwd: "/tmp",
    });
    const killed = manager.stopAll("frontend");
    expect(killed).toBe(2);
  });

  it("throws BackgroundTaskNotFoundError for unknown task", () => {
    const manager = createTestTaskManager();
    expect(() => manager.stop("unknown", "dev")).toThrow(BackgroundTaskNotFoundError);
  });
});
```

#### Port Manager (`src/jorchfile/port-manager.test.ts`)

```typescript
describe("PortManager", () => {
  it("returns the desired port if free", async () => {
    const manager = new PortManager();
    // Use a high ephemeral port unlikely to be in use
    const port = await manager.findAvailablePort(49152);
    expect(port).toBe(49152);
  });

  it("auto-increments if port is occupied", async () => {
    const manager = new PortManager();
    // Occupy a port, then check
    const server = createServer().listen(49200, "127.0.0.1");
    try {
      const port = await manager.findAvailablePort(49200);
      expect(port).toBe(49201);
    } finally {
      server.close();
    }
  });

  it("isPortFree returns true for free port", async () => {
    const manager = new PortManager();
    const free = await manager.isPortFree(49300);
    expect(free).toBe(true);
  });

  it("isPortFree returns false for occupied port", async () => {
    const manager = new PortManager();
    const server = createServer().listen(49301, "127.0.0.1");
    try {
      const free = await manager.isPortFree(49301);
      expect(free).toBe(false);
    } finally {
      server.close();
    }
  });
});
```

#### Makefile Reader (`src/jorchfile/makefile-reader.test.ts`)

```typescript
describe("readMakefileTargets", () => {
  it("reads target names from a Makefile", () => {
    // Create temp Makefile with:
    // build:
    //   echo building
    // test:
    //   echo testing
    const targets = readMakefileTargets(tempDir);
    expect(targets).toHaveLength(2);
    expect(targets).toStrictEqual(["build", "test"]);
  });

  it("returns empty array when no Makefile exists", () => {
    const targets = readMakefileTargets("/tmp/nonexistent-dir");
    expect(targets).toHaveLength(0);
  });

  it("skips .PHONY and other dot-targets", () => {
    // Makefile with .PHONY: build test
    const targets = readMakefileTargets(tempDir);
    expect(targets).not.toContain(".PHONY");
  });
});
```

#### Watcher (`src/jorchfile/watcher.test.ts`)

```typescript
describe("JorchfileWatcher", () => {
  it("computes added projects", () => {
    // Start with no projects, reload with one → added
  });

  it("computes removed projects", () => {
    // Start with one project, reload with none → removed
  });

  it("computes modified projects when path changes", () => {
    // Start with project path=/a, reload with path=/b → modified
  });

  it("does not report unchanged projects", () => {
    // Same content → no changes
  });
});
```

### 6.3 Test count estimate

| Module                       | Tests   |
| ---------------------------- | ------- |
| Jorchfile Parser             | 15      |
| Jorchfile Loader             | 4       |
| Jorchfile Executor           | 8       |
| Background Task Manager      | 6       |
| Port Manager                 | 4       |
| Tunnel Manager               | 4       |
| Makefile Reader              | 4       |
| Watcher                      | 5       |
| CommandRouter (Phase 3 ext.) | 10      |
| Gateway integration          | 3       |
| **Total**                    | **~64** |

---

## 7. New/Modified Files

### 7.1 New files

| File                                    | Purpose                                                           | Est. LOC |
| --------------------------------------- | ----------------------------------------------------------------- | -------- |
| `src/jorchfile/parser.ts`               | Jorchfile parser + Zod schemas (single source of truth for types) | ~270     |
| `src/jorchfile/parser.test.ts`          | Parser tests                                                      | ~200     |
| `src/jorchfile/loader.ts`               | Load Jorchfile from disk                                          | ~40      |
| `src/jorchfile/loader.test.ts`          | Loader tests                                                      | ~50      |
| `src/jorchfile/executor.ts`             | Command executor + session auto-create                            | ~200     |
| `src/jorchfile/executor.test.ts`        | Executor tests                                                    | ~200     |
| `src/jorchfile/task-manager.ts`         | Background task manager                                           | ~180     |
| `src/jorchfile/task-manager.test.ts`    | Task manager tests                                                | ~120     |
| `src/jorchfile/port-manager.ts`         | Port auto-management                                              | ~50      |
| `src/jorchfile/port-manager.test.ts`    | Port manager tests                                                | ~80      |
| `src/jorchfile/tunnel.ts`               | Basic Tailscale tunnel manager                                    | ~160     |
| `src/jorchfile/tunnel.test.ts`          | Tunnel tests (mocked tailscale)                                   | ~100     |
| `src/jorchfile/makefile-reader.ts`      | Makefile target reader                                            | ~50      |
| `src/jorchfile/makefile-reader.test.ts` | Makefile reader tests                                             | ~60      |
| `src/jorchfile/watcher.ts`              | Hot-reload file watcher                                           | ~130     |
| `src/jorchfile/watcher.test.ts`         | Watcher tests                                                     | ~80      |

### 7.2 Modified files

| File                               | Change                                                                                                                                                                     |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/commands/router.ts`           | Add Jorchfile command resolution, `/projects`, `/tasks`, `/stop-cmd`, `/make`, update `/new` for Jorchfile lookup, update `/help`, update `/status`, update priority chain |
| `src/commands/router.test.ts`      | Add Phase 3 command tests                                                                                                                                                  |
| `src/gateway/jorchbot-start.ts`    | Wire Jorchfile loader, executor, task manager, port manager, tunnel manager, watcher, SETTINGS overrides, shutdown cleanup                                                 |
| `src/sessions/jorchbot/manager.ts` | Update `destroy()` to also call `taskManager.stopAll()` and `tunnelManager.stopAll()`                                                                                      |

---

## 8. Acceptance Criteria (Definition of Done)

- [ ] Jorchfile parser handles the full format: PROJECT blocks, SETTINGS, comments, blank lines, multi-line backslash, @file references, ~ expansion
- [ ] `/dev frontend` executes the command in background with PID, auto-port, and tunnel
- [ ] `/test backend` executes in foreground with output sent to chat
- [ ] `/new frontend` loads path and instructions from Jorchfile (no path argument needed)
- [ ] `/dev frontend` without prior `/new` auto-creates session from Jorchfile config
- [ ] `/tasks` lists all background processes with PID, project, command, port, uptime
- [ ] `/stop-cmd frontend dev` kills the process and closes associated tunnel
- [ ] `/stop-cmd frontend` kills ALL background tasks for that project
- [ ] `/make` lists Makefile targets; `/make deploy` executes `make deploy`
- [ ] `/projects` lists all Jorchfile projects with session status and background tasks
- [ ] Editing `~/.jorchbot/Jorchfile` triggers hot-reload: kills affected sessions, reloads commands
- [ ] Jorchfile commands (`/dev`, `/test`) take priority over shell shortcuts (`/ls`, `/cat`)
- [ ] SETTINGS from Jorchfile override `jorchbot.json` defaults
- [ ] Port auto-management works: occupied port → auto-increment → notification
- [ ] Basic tunnel: `tailscale serve --bg <port>` starts, `/stop-cmd` closes it
- [ ] Funnel mode asks user confirmation before exposing to internet
- [ ] If Tailscale is not installed, tunnel skipped with warning (not error)
- [ ] All error messages are clear and actionable
- [ ] No Jorchfile is a valid state — all features degrade gracefully
- [ ] `background` field per project configures which commands are background by default
- [ ] `@file` references work in any field value (instructions, commands, etc.)
- [ ] Loader warns about non-existent project paths (not fatal)
- [ ] Duplicate task prevention: running same command sends confirmation buttons
- [ ] Hot-reload updates executor via getter function (no stale references)
- [ ] All unit tests pass (~64 tests)
- [ ] `pnpm check` passes (format + types + lint)
- [ ] No `any` in new JorchBot code

---

## 9. Limitations of this Phase

| Limitation                                                     | Phase that resolves it          |
| -------------------------------------------------------------- | ------------------------------- |
| No `/tunnels` command to list all active tunnels               | Phase 4                         |
| No reverse proxy for multi-project Funnel (path-based routing) | Phase 4                         |
| No advanced tunnel lifecycle (reconnect, health check)         | Phase 4                         |
| No `/replay`, `/history` commands                              | Phase 5                         |
| No plan/auto/silent modes via `/mode`                          | Phase 5                         |
| No "Yes + feedback" approvals                                  | Phase 5                         |
| No Kapso lists for complex approvals                           | Phase 5                         |
| No Telegram channel                                            | Phase 7                         |
| Background tasks don't survive gateway restart                 | By design (ephemeral)           |
| Only one Jorchfile location (`~/.jorchbot/Jorchfile`)          | Could add per-project in future |

---

## 10. Implementation Notes

### 10.1 Recommended implementation order

1. **Parser + Loader** — parse the Jorchfile format, load from disk
2. **Port Manager** — independent utility, no deps
3. **Background Task Manager** — independent, manages child processes
4. **Makefile Reader** — independent utility, simple
5. **Tunnel Manager (basic)** — depends on nothing internal
6. **Executor** — ties parser + port + task + tunnel together
7. **Watcher** — uses loader, emits changes
8. **CommandRouter extensions** — wire executor, task manager, makefile into router
9. **SessionManager integration** — update `/new` and `destroy()` for Jorchfile
10. **Gateway integration** — wire everything in `jorchbot-start.ts`
11. **Final verification** — all tests, `pnpm check` clean

### 10.2 Implementation risks

| Risk                                             | Mitigation                                                     |
| ------------------------------------------------ | -------------------------------------------------------------- |
| `fs.watch()` is unreliable on some Linux systems | Use polling fallback or `chokidar` if needed                   |
| Background task PID 0 on spawn failure           | Check `child.pid` before storing task                          |
| Port scan floods log with connection errors      | Use single `createServer` attempt per port                     |
| Tailscale not installed → confusing errors       | Check `tailscale version` before any tunnel command            |
| Jorchfile parse errors crash gateway             | Catch at loader level, log warning, continue without Jorchfile |
| Rapid Jorchfile edits trigger multiple reloads   | Debounce at 300ms                                              |
| Large Makefile with hundreds of targets          | Only parse target names, not recipes; limit output             |
