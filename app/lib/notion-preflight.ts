import type { NotionPageRecord, NotionReadClient, NotionSourceKey } from "./notion-client.ts";
import type { IngestionNotionMapping } from "./notion-mapping-store.ts";
import { notionMappingFields, type NotionMappingField } from "./notion-mapping.ts";

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
};

type PreflightClient = Pick<NotionReadClient, "loadSchema" | "queryDataSource">;
type UnknownRecord = Record<string, unknown>;
type MappedField = { mapping: IngestionNotionMapping; definition: NotionMappingField };

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidDate(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

function hasTextItems(value: unknown): boolean {
  return Array.isArray(value) && value.some((item) => (
    isRecord(item)
    && (
      (typeof item.plain_text === "string" && item.plain_text.trim().length > 0)
      || (isRecord(item.text) && typeof item.text.content === "string" && item.text.content.trim().length > 0)
    )
  ));
}

function hasNamedObject(value: unknown): boolean {
  return isRecord(value) && typeof value.name === "string" && value.name.trim().length > 0;
}

function hasNamedItems(value: unknown): boolean {
  return Array.isArray(value) && value.some(hasNamedObject);
}

function hasIdentifiedItems(value: unknown): boolean {
  return Array.isArray(value) && value.some((item) => isRecord(item) && typeof item.id === "string" && item.id.trim().length > 0);
}

function hasFormulaValue(value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "date") {
    return isRecord(value.date) && isValidDate(value.date.start);
  }
  if (value.type === "string") return typeof value.string === "string" && value.string.trim().length > 0;
  if (value.type === "number") return typeof value.number === "number" && Number.isFinite(value.number);
  if (value.type === "boolean") return typeof value.boolean === "boolean";
  return false;
}

function hasPropertyValue(value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== "string") return false;

  switch (value.type) {
    case "title":
      return hasTextItems(value.title);
    case "rich_text":
      return hasTextItems(value.rich_text);
    case "select":
      return hasNamedObject(value.select);
    case "status":
      return hasNamedObject(value.status);
    case "multi_select":
      return hasNamedItems(value.multi_select);
    case "relation":
      return hasIdentifiedItems(value.relation);
    case "people":
      return hasIdentifiedItems(value.people);
    case "date":
      return isRecord(value.date) && isValidDate(value.date.start);
    case "created_time":
      return isValidDate(value.created_time);
    case "formula":
      return hasFormulaValue(value.formula);
    case "unique_id":
      return isRecord(value.unique_id) && Number.isSafeInteger(value.unique_id.number);
    case "number":
      return typeof value.number === "number" && Number.isFinite(value.number);
    case "checkbox":
      return typeof value.checkbox === "boolean";
    case "email":
    case "url":
    case "phone_number": {
      const scalar = value[value.type];
      return typeof scalar === "string" && scalar.trim().length > 0;
    }
    case "created_by":
      return isRecord(value.created_by) && typeof value.created_by.id === "string" && value.created_by.id.trim().length > 0;
    default:
      return value[value.type] !== null && value[value.type] !== undefined;
  }
}

function findProperty(page: NotionPageRecord, propertyId: string): unknown {
  return Object.values(page.properties).find((property) => (
    isRecord(property) && property.id === propertyId
  ));
}

function validateMappingsAgainstSchema(
  mappings: readonly IngestionNotionMapping[],
  schemas: Awaited<ReturnType<PreflightClient["loadSchema"]>>,
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
): SourcePreflightResult & { uniquePages: NotionPageRecord[] } {
  const unique = uniquePages(rawPages);
  const fields = mappedFields.map(({ mapping, definition }) => {
    const presentCount = unique.pages.reduce((total, page) => (
      total + (hasPropertyValue(findProperty(page, mapping.propertyId)) ? 1 : 0)
    ), 0);
    const missingCount = unique.pages.length - presentCount;
    return {
      fieldKey: mapping.fieldKey,
      label: definition.label,
      required: definition.required,
      presentCount,
      missingCount,
      coveragePercent: coveragePercent(presentCount, unique.pages.length),
    };
  });
  const requiredWarnings = fields
    .filter((field) => field.required)
    .reduce((total, field) => total + field.missingCount, 0);

  return {
    pagesRead: rawPages.length,
    eligibleRecords: unique.pages.length,
    rejectedRecords: unique.rejectedRecords,
    warningCount: unique.rejectedRecords + requiredWarnings,
    requestCount,
    fields,
    uniquePages: unique.pages,
  };
}

function relationDetails(value: unknown): { ids: string[]; hasMore: boolean } {
  if (!isRecord(value) || value.type !== "relation" || !Array.isArray(value.relation)) {
    return { ids: [], hasMore: false };
  }
  const ids = [...new Set(value.relation.flatMap((item) => (
    isRecord(item) && typeof item.id === "string" && item.id.trim().length > 0
      ? [item.id.trim()]
      : []
  )))];
  return { ids, hasMore: value.has_more === true };
}

function analyzeRelationships(
  ticketPages: readonly NotionPageRecord[],
  historyPages: readonly NotionPageRecord[],
  relationPropertyId: string,
): PreflightRelationshipResult {
  const ticketIds = new Set(ticketPages.map((page) => page.id));
  const linkedTicketIds = new Set<string>();
  let linkedEvents = 0;
  let missingRelationEvents = 0;
  let orphanEvents = 0;
  let ambiguousEvents = 0;

  for (const page of historyPages) {
    const relation = relationDetails(findProperty(page, relationPropertyId));
    if (relation.hasMore || relation.ids.length > 1) {
      ambiguousEvents += 1;
      continue;
    }
    if (relation.ids.length === 0) {
      missingRelationEvents += 1;
      continue;
    }
    const ticketId = relation.ids[0];
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
    eventCoveragePercent: coveragePercent(linkedEvents, historyPages.length),
    ticketCoveragePercent: coveragePercent(linkedTicketIds.size, ticketPages.length),
  };
}

export async function runNotionPreflight(
  client: PreflightClient,
  mappings: readonly IngestionNotionMapping[],
  now = () => new Date(),
): Promise<NotionPreflightResult> {
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
  const tickets = analyzeSource(ticketQuery.pages, ticketQuery.requestCount, ticketMappings);
  const history = analyzeSource(historyQuery.pages, historyQuery.requestCount, historyMappings);
  const relationship = analyzeRelationships(
    tickets.uniquePages,
    history.uniquePages,
    relationMapping.mapping.propertyId,
  );
  const relationshipWarnings = relationship.orphanEvents + relationship.ambiguousEvents;

  return {
    checkedAt: now().toISOString(),
    requestCount: tickets.requestCount + history.requestCount,
    warningCount: tickets.warningCount + history.warningCount + relationshipWarnings,
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
  };
}
