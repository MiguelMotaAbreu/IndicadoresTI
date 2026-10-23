import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { ApplicationDatabase, LATEST_DATABASE_VERSION } from "../app/lib/database.ts";

function temporaryDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), "pulseti-migrations-"));
  return { directory, databasePath: join(directory, "test.sqlite") };
}

test("aplica migrações pendentes uma única vez e cria a tabela de usuários", () => {
  const { directory, databasePath } = temporaryDatabasePath();
  let database = new ApplicationDatabase(databasePath);

  try {
    assert.equal(database.schemaVersion, LATEST_DATABASE_VERSION);
    assert.deepEqual(
      database.getAppliedMigrations().map(({ version, name }) => ({ version, name })),
      [
        { version: 1, name: "create_dashboard_drafts" },
        { version: 2, name: "create_users" },
        { version: 3, name: "create_user_sessions" },
      ],
    );

    const userColumns = database.connection.prepare("PRAGMA table_info(users);").all();
    assert.deepEqual(
      userColumns.map((column) => column.name),
      ["id", "email", "display_name", "role", "password_hash", "must_change_password", "is_active", "created_at", "updated_at", "deactivated_at"],
    );

    const insertUser = database.connection.prepare(`
      INSERT INTO users (id, email, display_name, role, password_hash)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertUser.run("user-admin", "admin@upa.local", "Administrador", "administrador", "a".repeat(64));
    assert.throws(
      () => insertUser.run("user-duplicate", "ADMIN@UPA.LOCAL", "Outro", "analista", "b".repeat(64)),
      /UNIQUE constraint failed/,
    );
    assert.throws(
      () => insertUser.run("user-invalid", "invalid@upa.local", "Inválido", "gestor", "c".repeat(64)),
      /CHECK constraint failed/,
    );

    const sessionColumns = database.connection.prepare("PRAGMA table_info(user_sessions);").all();
    assert.deepEqual(
      sessionColumns.map((column) => column.name),
      [
        "id",
        "token_hash",
        "user_id",
        "created_at",
        "last_seen_at",
        "idle_expires_at",
        "absolute_expires_at",
        "revoked_at",
      ],
    );

    database.close();
    database = new ApplicationDatabase(databasePath);
    assert.equal(database.getAppliedMigrations().length, 3);
    assert.equal(database.connection.prepare("SELECT COUNT(*) AS total FROM users;").get().total, 1);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("adota um banco legado sem apagar os rascunhos existentes", () => {
  const { directory, databasePath } = temporaryDatabasePath();
  const legacyDatabase = new DatabaseSync(databasePath);
  legacyDatabase.exec(`
    CREATE TABLE dashboard_drafts (
      user_id TEXT NOT NULL,
      dashboard_key TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      saved_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, dashboard_key)
    ) STRICT;
  `);
  legacyDatabase.prepare(`
    INSERT INTO dashboard_drafts (user_id, dashboard_key, schema_version, snapshot_json, saved_at)
    VALUES (?, ?, ?, ?, ?)
  `).run("admin", "overview", 1, "{\"legacy\":true}", "2026-10-22T15:00:00.000Z");
  legacyDatabase.close();

  const migratedDatabase = new ApplicationDatabase(databasePath);
  try {
    assert.equal(migratedDatabase.schemaVersion, LATEST_DATABASE_VERSION);
    assert.equal(migratedDatabase.getAppliedMigrations().length, 3);
    assert.equal(
      migratedDatabase.connection.prepare("SELECT snapshot_json FROM dashboard_drafts WHERE user_id = ? AND dashboard_key = ?").get("admin", "overview").snapshot_json,
      "{\"legacy\":true}",
    );
  } finally {
    migratedDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("interrompe a inicialização quando o histórico de migrações foi adulterado", () => {
  const { directory, databasePath } = temporaryDatabasePath();
  const database = new ApplicationDatabase(databasePath);
  database.close();

  const tamperedDatabase = new DatabaseSync(databasePath);
  tamperedDatabase.prepare("UPDATE schema_migrations SET checksum = ? WHERE version = 1").run("checksum-inválido");
  tamperedDatabase.close();

  try {
    assert.throws(() => new ApplicationDatabase(databasePath), /integridade da migração 1/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
