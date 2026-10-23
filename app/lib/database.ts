import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_DATABASE_PATH = join("data", "pulseti.sqlite");

type DatabaseMigration = {
  version: number;
  name: string;
  sql: string;
};

type AppliedMigrationRow = {
  version: number;
  name: string;
  checksum: string;
  applied_at: string;
};

export type AppliedMigration = {
  version: number;
  name: string;
  checksum: string;
  appliedAt: string;
};

const databaseMigrations: readonly DatabaseMigration[] = [
  {
    version: 1,
    name: "create_dashboard_drafts",
    sql: `
      CREATE TABLE IF NOT EXISTS dashboard_drafts (
        user_id TEXT NOT NULL,
        dashboard_key TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL,
        saved_at TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, dashboard_key)
      ) STRICT;
    `,
  },
  {
    version: 2,
    name: "create_users",
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL COLLATE NOCASE UNIQUE,
        display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
        role TEXT NOT NULL CHECK (role IN ('administrador', 'analista')),
        password_hash TEXT NOT NULL CHECK (length(password_hash) >= 32),
        must_change_password INTEGER NOT NULL DEFAULT 1 CHECK (must_change_password IN (0, 1)),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deactivated_at TEXT
      ) STRICT;
    `,
  },
] as const;

export const LATEST_DATABASE_VERSION = databaseMigrations.at(-1)?.version ?? 0;

function migrationChecksum(migration: DatabaseMigration): string {
  return createHash("sha256")
    .update(`${migration.version}\0${migration.name}\0${migration.sql.trim()}`)
    .digest("hex");
}

function runMigrations(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;
  `);

  const appliedRows = database.prepare(`
    SELECT version, name, checksum, applied_at
    FROM schema_migrations
    ORDER BY version
  `).all() as AppliedMigrationRow[];
  const migrationsByVersion = new Map(databaseMigrations.map((migration) => [migration.version, migration]));

  for (const applied of appliedRows) {
    const expected = migrationsByVersion.get(applied.version);
    if (!expected) {
      throw new Error(`O banco usa a migração ${applied.version}, que esta versão da aplicação não reconhece.`);
    }
    if (applied.name !== expected.name || applied.checksum !== migrationChecksum(expected)) {
      throw new Error(`A integridade da migração ${applied.version} não pôde ser confirmada.`);
    }
  }

  const appliedVersions = new Set(appliedRows.map((migration) => migration.version));
  for (const migration of databaseMigrations) {
    if (appliedVersions.has(migration.version)) continue;

    database.exec("BEGIN IMMEDIATE;");
    try {
      database.exec(migration.sql);
      database.prepare(`
        INSERT INTO schema_migrations (version, name, checksum)
        VALUES (?, ?, ?)
      `).run(migration.version, migration.name, migrationChecksum(migration));
      database.exec(`PRAGMA user_version = ${migration.version};`);
      database.exec("COMMIT;");
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }
  }
}

export class ApplicationDatabase {
  readonly connection: DatabaseSync;
  private closed = false;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
    this.connection = new DatabaseSync(databasePath, { timeout: 5_000 });

    try {
      this.connection.exec("PRAGMA journal_mode = WAL;");
      this.connection.exec("PRAGMA foreign_keys = ON;");
      runMigrations(this.connection);
    } catch (error) {
      this.connection.close();
      this.closed = true;
      throw error;
    }
  }

  get schemaVersion(): number {
    const row = this.connection.prepare("PRAGMA user_version;").get() as { user_version: number };
    return row.user_version;
  }

  getAppliedMigrations(): AppliedMigration[] {
    const rows = this.connection.prepare(`
      SELECT version, name, checksum, applied_at
      FROM schema_migrations
      ORDER BY version
    `).all() as AppliedMigrationRow[];

    return rows.map((row) => ({
      version: row.version,
      name: row.name,
      checksum: row.checksum,
      appliedAt: row.applied_at,
    }));
  }

  close(): void {
    if (this.closed) return;
    this.connection.close();
    this.closed = true;
  }
}

function configuredDatabasePath(): string {
  const configured = process.env.PULSETI_DATABASE_PATH?.trim() || DEFAULT_DATABASE_PATH;
  if (configured === ":memory:" || isAbsolute(configured)) return configured;
  return resolve(/* turbopackIgnore: true */ process.cwd(), configured);
}

const globalDatabase = globalThis as typeof globalThis & {
  pulsetiApplicationDatabase?: ApplicationDatabase;
};

export function getApplicationDatabase(): ApplicationDatabase {
  if (!globalDatabase.pulsetiApplicationDatabase) {
    globalDatabase.pulsetiApplicationDatabase = new ApplicationDatabase(configuredDatabasePath());
  }
  return globalDatabase.pulsetiApplicationDatabase;
}
