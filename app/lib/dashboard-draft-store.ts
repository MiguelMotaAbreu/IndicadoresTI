import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { DashboardKey } from "../mock-data";
import type { DashboardDraftSnapshot } from "./dashboard-drafts";

const DEFAULT_DATABASE_PATH = join("data", "pulseti.sqlite");

type StoredDraftRow = {
  snapshot_json: string;
};

export class DashboardDraftStore {
  private readonly database: DatabaseSync;
  private closed = false;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath, { timeout: 5_000 });
    this.database.exec("PRAGMA journal_mode = WAL;");
    this.database.exec("PRAGMA foreign_keys = ON;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS dashboard_drafts (
        user_id TEXT NOT NULL,
        dashboard_key TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL,
        saved_at TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, dashboard_key)
      ) STRICT;
    `);
  }

  findSerialized(userId: string, dashboardKey: DashboardKey): string | null {
    const row = this.database.prepare(`
      SELECT snapshot_json
      FROM dashboard_drafts
      WHERE user_id = ? AND dashboard_key = ?
    `).get(userId, dashboardKey) as StoredDraftRow | undefined;

    return row?.snapshot_json ?? null;
  }

  save(userId: string, snapshot: DashboardDraftSnapshot): void {
    if (!snapshot.savedAt) throw new Error("O rascunho precisa de uma data de salvamento.");

    this.database.prepare(`
      INSERT INTO dashboard_drafts (
        user_id,
        dashboard_key,
        schema_version,
        snapshot_json,
        saved_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, dashboard_key) DO UPDATE SET
        schema_version = excluded.schema_version,
        snapshot_json = excluded.snapshot_json,
        saved_at = excluded.saved_at,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      userId,
      snapshot.dashboardKey,
      snapshot.schemaVersion,
      JSON.stringify(snapshot),
      snapshot.savedAt,
    );
  }

  close(): void {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }
}

function configuredDatabasePath(): string {
  const configured = process.env.PULSETI_DATABASE_PATH?.trim() || DEFAULT_DATABASE_PATH;
  if (configured === ":memory:" || isAbsolute(configured)) return configured;
  return resolve(/* turbopackIgnore: true */ process.cwd(), configured);
}

const globalStore = globalThis as typeof globalThis & {
  pulsetiDashboardDraftStore?: DashboardDraftStore;
};

export function getDashboardDraftStore(): DashboardDraftStore {
  if (!globalStore.pulsetiDashboardDraftStore) {
    globalStore.pulsetiDashboardDraftStore = new DashboardDraftStore(configuredDatabasePath());
  }
  return globalStore.pulsetiDashboardDraftStore;
}
