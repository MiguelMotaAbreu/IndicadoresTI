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
  {
    version: 3,
    name: "create_user_sessions",
    sql: `
      CREATE TABLE IF NOT EXISTS user_sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        idle_expires_at TEXT NOT NULL,
        absolute_expires_at TEXT NOT NULL,
        revoked_at TEXT,
        CHECK (idle_expires_at <= absolute_expires_at)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx
      ON user_sessions (user_id);

      CREATE INDEX IF NOT EXISTS user_sessions_expiration_idx
      ON user_sessions (idle_expires_at, absolute_expires_at)
      WHERE revoked_at IS NULL;
    `,
  },
  {
    version: 4,
    name: "create_audit_events",
    sql: `
      CREATE TABLE IF NOT EXISTS audit_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        occurred_at TEXT NOT NULL,
        actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        actor_name TEXT,
        actor_role TEXT CHECK (actor_role IS NULL OR actor_role IN ('administrador', 'analista')),
        action TEXT NOT NULL CHECK (length(action) BETWEEN 3 AND 80),
        target_type TEXT NOT NULL CHECK (length(target_type) BETWEEN 2 AND 40),
        target_id TEXT,
        target_label TEXT CHECK (target_label IS NULL OR length(target_label) <= 254),
        outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
        summary TEXT NOT NULL CHECK (length(summary) BETWEEN 3 AND 500)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS audit_events_occurred_at_idx
      ON audit_events (occurred_at DESC);

      CREATE INDEX IF NOT EXISTS audit_events_action_idx
      ON audit_events (action, occurred_at DESC);
    `,
  },
  {
    version: 5,
    name: "create_sync_state",
    sql: `
      CREATE TABLE IF NOT EXISTS analytical_snapshots (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('published', 'superseded')),
        ticket_count INTEGER NOT NULL CHECK (ticket_count >= 0),
        event_count INTEGER NOT NULL CHECK (event_count >= 0),
        warning_count INTEGER NOT NULL CHECK (warning_count >= 0),
        created_at TEXT NOT NULL,
        published_at TEXT NOT NULL
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS analytical_snapshots_one_published_idx
      ON analytical_snapshots (status)
      WHERE status = 'published';

      CREATE TABLE IF NOT EXISTS sync_runs (
        id TEXT PRIMARY KEY,
        requested_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        requested_by_name TEXT NOT NULL CHECK (length(trim(requested_by_name)) BETWEEN 2 AND 100),
        status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
        started_at TEXT NOT NULL,
        finished_at TEXT,
        snapshot_id TEXT REFERENCES analytical_snapshots(id) ON DELETE SET NULL,
        ticket_count INTEGER CHECK (ticket_count IS NULL OR ticket_count >= 0),
        event_count INTEGER CHECK (event_count IS NULL OR event_count >= 0),
        warning_count INTEGER CHECK (warning_count IS NULL OR warning_count >= 0),
        error_code TEXT CHECK (error_code IS NULL OR length(error_code) BETWEEN 3 AND 80),
        error_message TEXT CHECK (error_message IS NULL OR length(error_message) BETWEEN 3 AND 500),
        CHECK (
          (status = 'running' AND finished_at IS NULL AND snapshot_id IS NULL AND error_code IS NULL AND error_message IS NULL)
          OR (status = 'succeeded' AND finished_at IS NOT NULL AND snapshot_id IS NOT NULL AND error_code IS NULL AND error_message IS NULL)
          OR (status = 'failed' AND finished_at IS NOT NULL AND snapshot_id IS NULL AND error_code IS NOT NULL AND error_message IS NOT NULL)
        )
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS sync_runs_one_running_idx
      ON sync_runs ((1))
      WHERE status = 'running';

      CREATE INDEX IF NOT EXISTS sync_runs_started_at_idx
      ON sync_runs (started_at DESC);
    `,
  },
  {
    version: 6,
    name: "create_notion_property_mappings",
    sql: `
      CREATE TABLE IF NOT EXISTS notion_property_mappings (
        field_key TEXT PRIMARY KEY CHECK (length(field_key) BETWEEN 3 AND 80),
        source_key TEXT NOT NULL CHECK (source_key IN ('tickets', 'history')),
        property_id TEXT NOT NULL CHECK (length(trim(property_id)) > 0),
        property_name TEXT NOT NULL CHECK (length(trim(property_name)) > 0),
        property_type TEXT NOT NULL CHECK (length(trim(property_type)) > 0),
        updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        updated_by_name TEXT NOT NULL CHECK (length(trim(updated_by_name)) BETWEEN 2 AND 100),
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS notion_property_mappings_source_idx
      ON notion_property_mappings (source_key, field_key);
    `,
  },
  {
    version: 7,
    name: "remove_legacy_ticket_title_mapping",
    sql: `
      DELETE FROM notion_property_mappings
      WHERE field_key = 'ticket.title';
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
