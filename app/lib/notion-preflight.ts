import type { NotionPageRecord, NotionReadClient, NotionSourceKey } from "./notion-client.ts";
import { analyzeNotionConsistency, type NotionConsistencyResult } from "./notion-consistency.ts";
import type { IngestionNotionMapping } from "./notion-mapping-store.ts";
import { notionMappingFields, type NotionMappingField } from "./notion-mapping.ts";
import { normalizeNotionRecords, type NormalizedNotionRecord } from "./notion-record-transformer.ts";

export type NotionPreflightErrorCode = "mapping_incomplete" | "mapping_outdated";

export class NotionPreflightError extends Error {
  readonly code: NotionPreflightErrorCode;

  constructor(code: NotionPreflightErrorCode, message: string) {
    super(message);
    this.name = "NotionPreflightError";
    this.code = code;
  }
}

export type PreflightFieldCoverage = {
  fieldKey: string;
  label: string;
  required: boolean;
  presentCount: number;
  validCount: number;
  invalidCount: number;
  missingCount: number;
  coveragePercent: number;
};

export type SourcePreflightResult = {
  pagesRead: number;
  eligibleRecords: number;
  rejectedRecords: number;
  warningCount: number;
  requestCount: number;
  fields: PreflightFieldCoverage[];
};

export type PreflightRelationshipResult = {
  linkedEvents: number;
  missingRelationEvents: number;
  orphanEvents: number;
  ambiguousEvents: number;
  unlinkedEvents: number;
  distinctLinkedTickets: number;
  eventCoveragePercent: number;
  ticketCoveragePercent: number;
};

export type NotionPreflightResult = {
  checkedAt: string;
  requestCount: number;
  warningCount: number;
  tickets: SourcePreflightResult;
  history: SourcePreflightResult;
  relationship: PreflightRelationshipResult;
  consistency: NotionConsistencyResult;
};

export type PreparedNotionDataset = {
  diagnostic: NotionPreflightResult;
  records: {
    tickets: NormalizedNotionRecord[];
    history: NormalizedNotionRecord[];
  };
};

export type NotionPreflightClient = Pick<NotionReadClient, "loadSchema" | "queryDataSource">;
type MappedField = { mapping: IngestionNotionMapping; definition: NotionMappingField };

function validateMappingsAgainstSchema(
  mappings: readonly IngestionNotionMapping[],
  schemas: Awaited<ReturnType<NotionPreflightClient["loadSchema"]>>,
): void {
  const definitions = new Map(notionMappingFields.map((field) => [field.key, field]));
  const mappedKeys = new Set(mappings.map((mapping) => mapping.fieldKey));
  const missingRequired = notionMappingFields.filter((field) => field.required && !mappedKeys.has(field.key));
  if (missingRequired.length > 0) {
    throw new NotionPreflightError(
      "mapping_incomplete",
      `Conclua os ${missingRequired.length} campo(s) obrigatório(s) ainda pendente(s) antes da pré-validação.`,
    );
  }

  const staleMapping = mappings.find((mapping) => {
    const definition = definitions.get(mapping.fieldKey);
    const schema = schemas.find((candidate) => candidate.key === mapping.source);
    const property = schema?.properties.find((candidate) => candidate.id === mapping.propertyId);
    return !definition || !property || !definition.acceptedTypes.includes(property.type);
  });
  if (staleMapping) {
    throw new NotionPreflightError(
      "mapping_outdated",
      "O esquema do Notion mudou desde o último mapeamento. Revise e salve os mapeamentos novamente.",
    );
  }
}

function mappedFieldsForSource(
  mappings: readonly IngestionNotionMapping[],
  source: NotionSourceKey,
): MappedField[] {
  const definitions = new Map(notionMappingFields.map((field) => [field.key, field]));
  return mappings
    .filter((mapping) => mapping.source === source)
    .map((mapping) => ({ mapping, definition: definitions.get(mapping.fieldKey) }))
    .filter((entry): entry is MappedField => entry.definition?.source === source);
}

function uniquePages(pages: readonly NotionPageRecord[]): {
  pages: NotionPageRecord[];
  rejectedRecords: number;
} {
  const seenPageIds = new Set<string>();
  const unique: NotionPageRecord[] = [];
  let rejectedRecords = 0;
  for (const page of pages) {
    if (seenPageIds.has(page.id)) {
      rejectedRecords += 1;
      continue;
    }
    seenPageIds.add(page.id);
    unique.push(page);
  }
  return { pages: unique, rejectedRecords };
}

function coveragePercent(present: number, total: number): number {
  return total === 0 ? 0 : Math.round((present / total) * 1_000) / 10;
}

function analyzeSource(
  rawPages: readonly NotionPageRecord[],
  requestCount: number,
  mappedFields: readonly MappedField[],
  source: NotionSourceKey,
): SourcePreflightResult & { records: NormalizedNotionRecord[] } {
  const unique = uniquePages(rawPages);
  const records = normalizeNotionRecords(
    unique.pages,
    mappedFields.map(({ mapping }) => mapping),
    source,
  );
  const fields = mappedFields.map(({ mapping, definition }) => {
    const states = records.map((record) => record.fields[mapping.fieldKey]?.state ?? "missing");
    const validCount = states.filter((state) => state === "valid").length;
    const invalidCount = states.filter((state) => state === "invalid").length;
    const missingCount = states.filter((state) => state === "missing").length;
    return {
      fieldKey: mapping.fieldKey,
      label: definition.label,
      required: definition.required,
      presentCount: validCount + invalidCount,
      validCount,
      invalidCount,
      missingCount,
      coveragePercent: coveragePercent(validCount, unique.pages.length),
    };
  });
  const fieldWarnings = fields.reduce((total, field) => (
    total + field.invalidCount + (field.required ? field.missingCount : 0)
  ), 0);

  return {
    pagesRead: rawPages.length,
    eligibleRecords: unique.pages.length,
    rejectedRecords: unique.rejectedRecords,
    warningCount: unique.rejectedRecords + fieldWarnings,
    requestCount,
    fields,
    records,
  };
}

function analyzeRelationships(
  ticketRecords: readonly NormalizedNotionRecord[],
  historyRecords: readonly NormalizedNotionRecord[],
): PreflightRelationshipResult {
  const ticketIds = new Set(ticketRecords.map((record) => record.pageId));
  const linkedTicketIds = new Set<string>();
  let linkedEvents = 0;
  let missingRelationEvents = 0;
  let orphanEvents = 0;
  let ambiguousEvents = 0;

  for (const record of historyRecords) {
    const relation = record.fields["history.ticketRelation"];
    if (relation?.state === "invalid") {
      ambiguousEvents += 1;
      continue;
    }
    if (relation?.state !== "valid" || relation.value.kind !== "ids") {
      missingRelationEvents += 1;
      continue;
    }
    if (relation.value.truncated || relation.value.value.length > 1) {
      ambiguousEvents += 1;
      continue;
    }
    const ticketId = relation.value.value[0];
    if (!ticketId) {
      missingRelationEvents += 1;
      continue;
    }
    if (!ticketIds.has(ticketId)) {
      orphanEvents += 1;
      continue;
    }
    linkedEvents += 1;
    linkedTicketIds.add(ticketId);
  }

  const unlinkedEvents = missingRelationEvents + orphanEvents + ambiguousEvents;
  return {
    linkedEvents,
    missingRelationEvents,
    orphanEvents,
    ambiguousEvents,
    unlinkedEvents,
    distinctLinkedTickets: linkedTicketIds.size,
    eventCoveragePercent: coveragePercent(linkedEvents, historyRecords.length),
    ticketCoveragePercent: coveragePercent(linkedTicketIds.size, ticketRecords.length),
  };
}

export async function prepareNotionDataset(
  client: NotionPreflightClient,
  mappings: readonly IngestionNotionMapping[],
  now = () => new Date(),
): Promise<PreparedNotionDataset> {
  const schemas = await client.loadSchema();
  validateMappingsAgainstSchema(mappings, schemas);

  const ticketSchema = schemas.find((schema) => schema.key === "tickets");
  const historySchema = schemas.find((schema) => schema.key === "history");
  const ticketMappings = mappedFieldsForSource(mappings, "tickets");
  const historyMappings = mappedFieldsForSource(mappings, "history");
  const relationMapping = historyMappings.find(({ mapping }) => mapping.fieldKey === "history.ticketRelation");
  if (!ticketSchema || !historySchema || ticketMappings.length === 0 || historyMappings.length === 0 || !relationMapping) {
    throw new NotionPreflightError("mapping_incomplete", "Mapeie os campos das duas bases antes da pré-validação.");
  }

  const [ticketQuery, historyQuery] = await Promise.all([
    client.queryDataSource(ticketSchema.dataSourceId, ticketMappings.map(({ mapping }) => mapping.propertyId)),
    client.queryDataSource(historySchema.dataSourceId, historyMappings.map(({ mapping }) => mapping.propertyId)),
  ]);
  const tickets = analyzeSource(ticketQuery.pages, ticketQuery.requestCount, ticketMappings, "tickets");
  const history = analyzeSource(historyQuery.pages, historyQuery.requestCount, historyMappings, "history");
  const relationship = analyzeRelationships(
    tickets.records,
    history.records,
  );
  const consistency = analyzeNotionConsistency(tickets.records, history.records);
  const relationshipWarnings = relationship.orphanEvents + relationship.ambiguousEvents;

  const diagnostic: NotionPreflightResult = {
    checkedAt: now().toISOString(),
    requestCount: tickets.requestCount + history.requestCount,
    warningCount: tickets.warningCount + history.warningCount + relationshipWarnings + consistency.issueCount,
    tickets: {
      pagesRead: tickets.pagesRead,
      eligibleRecords: tickets.eligibleRecords,
      rejectedRecords: tickets.rejectedRecords,
      warningCount: tickets.warningCount,
      requestCount: tickets.requestCount,
      fields: tickets.fields,
    },
    history: {
      pagesRead: history.pagesRead,
      eligibleRecords: history.eligibleRecords,
      rejectedRecords: history.rejectedRecords,
      warningCount: history.warningCount,
      requestCount: history.requestCount,
      fields: history.fields,
    },
    relationship,
    consistency,
  };
  return {
    diagnostic,
    records: {
      tickets: tickets.records,
      history: history.records,
    },
  };
}

export async function runNotionPreflight(
  client: NotionPreflightClient,
  mappings: readonly IngestionNotionMapping[],
  now = () => new Date(),
): Promise<NotionPreflightResult> {
  return (await prepareNotionDataset(client, mappings, now)).diagnostic;
}
