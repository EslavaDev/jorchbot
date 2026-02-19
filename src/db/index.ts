import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { JorchBotDbInitError, JorchBotDbMigrationError } from "../errors/index.js";
import { resolveDbPath } from "./paths.js";
import * as schema from "./schema.js";

let _db: BetterSQLite3Database<typeof schema> | null = null;
let _sqlite: Database.Database | null = null;

function resolveDbMigrationsPath(): string {
  // In development: src/db/migrations/ relative to this source file
  // In production (dist/): go up from dist/ to project root, then src/db/migrations/
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const fromSource = join(thisDir, "migrations");
  if (existsSync(join(fromSource, "meta"))) {
    return fromSource;
  }
  // Fallback: resolve from project root (dist/ → ../ → src/db/migrations/)
  const projectRoot = join(thisDir, "..");
  return join(projectRoot, "src", "db", "migrations");
}

/**
 * Get the Drizzle ORM database instance (singleton).
 *
 * On first call, creates the SQLite database file and runs migrations.
 * Subsequent calls return the same instance.
 *
 * @throws {JorchBotDbInitError} If database creation fails
 * @throws {JorchBotDbMigrationError} If migration fails
 */
export function getDb(): BetterSQLite3Database<typeof schema> {
  if (_db) {
    return _db;
  }

  const dbPath = resolveDbPath();
  const dbDir = dirname(dbPath);

  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true, mode: 0o700 });
  }

  try {
    _sqlite = new Database(dbPath);
  } catch (err: unknown) {
    throw new JorchBotDbInitError(
      `Failed to open SQLite database at ${dbPath}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  _sqlite.pragma("journal_mode = WAL");
  _sqlite.pragma("foreign_keys = ON");

  _db = drizzle(_sqlite, { schema });

  try {
    migrate(_db, { migrationsFolder: resolveDbMigrationsPath() });
  } catch (err: unknown) {
    throw new JorchBotDbMigrationError(
      `Failed to run database migrations: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  return _db;
}

/**
 * Close the database connection. Call on graceful shutdown.
 */
export function closeDb(): void {
  if (_sqlite) {
    _sqlite.close();
    _sqlite = null;
    _db = null;
  }
}
