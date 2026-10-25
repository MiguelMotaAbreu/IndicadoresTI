import type { DatabaseSync } from "node:sqlite";

import type { NotionMappingFieldKey, ValidatedNotionMapping } from "./notion-mapping.ts";
import type { NotionSourceKey } from "./notion-client.ts";

export type StoredNotionMapping = {
  fieldKey: NotionMappingFieldKey;
  source: NotionSourceKey;
  propertyName: string;
  propertyType: string;
  updatedBy: { userId: string | null; displayName: string };
  updatedAt: string;
};

type MappingRow = {
  field_key: NotionMappingFieldKey;
  source_key: NotionSourceKey;
  property_name: string;
  property_type: string;
  updated_by_user_id: string | null;
  updated_by_name: string;
  updated_at: string;
};

type MappingActor = { userId: string; displayName: string };

function mapRow(row: MappingRow): StoredNotionMapping {
  return {
    fieldKey: row.field_key,
    source: row.source_key,
    propertyName: row.property_name,
    propertyType: row.property_type,
    updatedBy: { userId: row.updated_by_user_id, displayName: row.updated_by_name },
    updatedAt: row.updated_at,
  };
}

export class NotionMappingStore {
  private readonly database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.database = database;
  }

  list(): StoredNotionMapping[] {
    const rows = this.database.prepare(`
      SELECT field_key, source_key, property_name, property_type,
             updated_by_user_id, updated_by_name, updated_at
      FROM notion_property_mappings
      ORDER BY source_key, field_key
    `).all() as MappingRow[];
    return rows.map(mapRow);
  }

  saveAtomically<T>(
    mappings: readonly ValidatedNotionMapping[],
    actor: MappingActor,
    afterSave: (saved: StoredNotionMapping[]) => T,
    updatedAt = new Date(),
  ): { mappings: StoredNotionMapping[]; effect: T } {
    const timestamp = updatedAt.toISOString();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      this.database.prepare("DELETE FROM notion_property_mappings").run();
      const insert = this.database.prepare(`
        INSERT INTO notion_property_mappings (
          field_key, source_key, property_id, property_name, property_type,
          updated_by_user_id, updated_by_name, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const mapping of mappings) {
        insert.run(
          mapping.fieldKey,
          mapping.source,
          mapping.propertyId,
          mapping.propertyName,
          mapping.propertyType,
          actor.userId,
          actor.displayName,
          timestamp,
        );
      }
      const saved = this.list();
      const effect = afterSave(saved);
      this.database.exec("COMMIT;");
      return { mappings: saved, effect };
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }
}
