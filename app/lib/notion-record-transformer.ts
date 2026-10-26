import type { NotionPageRecord, NotionSourceKey } from "./notion-client.ts";
import type { IngestionNotionMapping } from "./notion-mapping-store.ts";
import type { NotionMappingFieldKey } from "./notion-mapping.ts";
import { decodeMappedNotionProperty, type NotionValueResult } from "./notion-value-normalizer.ts";

type UnknownRecord = Record<string, unknown>;

export type NormalizedNotionRecord = {
  source: NotionSourceKey;
  pageId: string;
  fields: Partial<Record<NotionMappingFieldKey, NotionValueResult>>;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findProperty(page: NotionPageRecord, propertyId: string): unknown {
  return Object.values(page.properties).find((property) => (
    isRecord(property) && property.id === propertyId
  ));
}

export function normalizeNotionRecords(
  pages: readonly NotionPageRecord[],
  mappings: readonly IngestionNotionMapping[],
  source: NotionSourceKey,
): NormalizedNotionRecord[] {
  const sourceMappings = mappings.filter((mapping) => mapping.source === source);
  return pages.map((page) => {
    const fields: NormalizedNotionRecord["fields"] = {};
    for (const mapping of sourceMappings) {
      fields[mapping.fieldKey] = decodeMappedNotionProperty(
        findProperty(page, mapping.propertyId),
        mapping,
      );
    }
    return { source, pageId: page.id, fields };
  });
}
