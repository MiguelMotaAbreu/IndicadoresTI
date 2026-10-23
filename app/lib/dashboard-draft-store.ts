import type { DatabaseSync } from "node:sqlite";

import type { DashboardKey } from "../mock-data";
import type { DashboardDraftSnapshot } from "./dashboard-drafts";

type StoredDraftRow = {
  snapshot_json: string;
};

export class DashboardDraftStore {
  private readonly database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.database = database;
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

}
