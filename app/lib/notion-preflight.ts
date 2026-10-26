import type { NotionPageRecord, NotionReadClient } from "./notion-client.ts";
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

export type TicketPreflightResult = {
  checkedAt: string;
  pagesRead: number;
  eligibleRecords: number;
  rejectedRecords: number;
  warningCount: number;
  requestCount: number;
  fields: PreflightFieldCoverage[];
};

type PreflightClient = Pick<NotionReadClient, "loadSchema" | "queryDataSource">;
type UnknownRecord = Record<string, unknown>;

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

function ticketDefinition(mapping: IngestionNotionMapping): NotionMappingField | undefined {
  return notionMappingFields.find((field) => field.key === mapping.fieldKey && field.source === "tickets");
}

export async function runTicketPreflight(
  client: PreflightClient,
  mappings: readonly IngestionNotionMapping[],
  now = () => new Date(),
): Promise<TicketPreflightResult> {
  const schemas = await client.loadSchema();
  validateMappingsAgainstSchema(mappings, schemas);

  const ticketSchema = schemas.find((schema) => schema.key === "tickets");
  const ticketMappings = mappings
    .filter((mapping) => mapping.source === "tickets")
    .map((mapping) => ({ mapping, definition: ticketDefinition(mapping) }))
    .filter((entry): entry is { mapping: IngestionNotionMapping; definition: NotionMappingField } => Boolean(entry.definition));
  if (!ticketSchema || ticketMappings.length === 0) {
    throw new NotionPreflightError("mapping_incomplete", "Mapeie os campos da base de chamados antes da pré-validação.");
  }

  const query = await client.queryDataSource(
    ticketSchema.dataSourceId,
    ticketMappings.map(({ mapping }) => mapping.propertyId),
  );
  const seenPageIds = new Set<string>();
  const uniquePages: NotionPageRecord[] = [];
  let rejectedRecords = 0;
  for (const page of query.pages) {
    if (seenPageIds.has(page.id)) {
      rejectedRecords += 1;
      continue;
    }
    seenPageIds.add(page.id);
    uniquePages.push(page);
  }

  const fields = ticketMappings.map(({ mapping, definition }) => {
    const presentCount = uniquePages.reduce((total, page) => (
      total + (hasPropertyValue(findProperty(page, mapping.propertyId)) ? 1 : 0)
    ), 0);
    const missingCount = uniquePages.length - presentCount;
    return {
      fieldKey: mapping.fieldKey,
      label: definition.label,
      required: definition.required,
      presentCount,
      missingCount,
      coveragePercent: uniquePages.length === 0
        ? 0
        : Math.round((presentCount / uniquePages.length) * 1_000) / 10,
    };
  });
  const requiredWarnings = fields
    .filter((field) => field.required)
    .reduce((total, field) => total + field.missingCount, 0);

  return {
    checkedAt: now().toISOString(),
    pagesRead: query.pages.length,
    eligibleRecords: uniquePages.length,
    rejectedRecords,
    warningCount: rejectedRecords + requiredWarnings,
    requestCount: query.requestCount,
    fields,
  };
}
