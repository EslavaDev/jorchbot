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
