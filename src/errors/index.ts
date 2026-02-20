/**
 * Base error class for all JorchBot errors.
 * All custom errors extend this class.
 */
export class JorchBotError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

// --- Config errors ---

/** Config directory or file cannot be accessed */
export class JorchBotConfigNotFoundError extends JorchBotError {}

/** Config file contains invalid JSON */
export class JorchBotConfigParseError extends JorchBotError {}

/** Config values fail zod validation */
export class JorchBotConfigValidationError extends JorchBotError {}

// --- Database errors ---

/** SQLite database cannot be opened or created */
export class JorchBotDbInitError extends JorchBotError {}

/** Database migration failed */
export class JorchBotDbMigrationError extends JorchBotError {}

/** A database query failed */
export class JorchBotDbQueryError extends JorchBotError {}

// --- Gateway errors ---

/** Gateway server failed to start (port in use, etc.) */
export class JorchBotGatewayStartError extends JorchBotError {}

/** Attempted operation on a gateway that is not running */
export class JorchBotGatewayNotRunningError extends JorchBotError {}

// --- ClaudeRunner errors ---

/** Claude binary not found or failed to spawn */
export class ClaudeRunnerSpawnError extends JorchBotError {}

/** Failed to parse Claude Code NDJSON output */
export class ClaudeRunnerParseError extends JorchBotError {}

/** Claude Code process exceeded timeout */
export class ClaudeRunnerTimeoutError extends JorchBotError {}

/** Claude Code process exited with non-zero code or other runtime error */
export class ClaudeRunnerProcessError extends JorchBotError {}

// --- Session errors (Phase 2) ---

/** Failed to create a session (DB, config, or runner failure) */
export class SessionCreateError extends JorchBotError {}

/** Session not found by project name or ID */
export class SessionNotFoundError extends JorchBotError {}

/** Maximum concurrent sessions limit reached */
export class SessionLimitError extends JorchBotError {}

/** Session with this project name already exists */
export class SessionAlreadyExistsError extends JorchBotError {}

/** Failed to destroy a session cleanly */
export class SessionDestroyError extends JorchBotError {}

// --- Shell errors (Phase 2) ---

/** Shell command execution failed */
export class ShellRunnerExecError extends JorchBotError {}

/** Shell command timed out */
export class ShellRunnerTimeoutError extends JorchBotError {}

/** Dangerous shell command detected (used internally, not thrown to user) */
export class ShellRunnerDangerousCommandError extends JorchBotError {}

// --- Jorchfile errors (Phase 3) ---

/** Jorchfile has syntax errors or malformed format */
export class JorchfileParseError extends JorchBotError {}

/** Jorchfile validation failed (missing required fields like path) */
export class JorchfileValidationError extends JorchBotError {}

/** Project not found in Jorchfile */
export class JorchfileProjectNotFoundError extends JorchBotError {}

/** Command not found for a project in Jorchfile */
export class JorchfileCommandNotFoundError extends JorchBotError {}

/** Failed to read or parse a project's Makefile */
export class MakefileReadError extends JorchBotError {}

// --- Background task errors (Phase 3) ---

/** Background task (long-running command) failed to start */
export class BackgroundTaskStartError extends JorchBotError {}

/** Background task not found by PID or name */
export class BackgroundTaskNotFoundError extends JorchBotError {}
