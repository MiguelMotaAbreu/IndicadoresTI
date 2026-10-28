import type { IngestionNotionMapping } from "./notion-mapping-store.ts";
import type { NotionMappingFieldKey } from "./notion-mapping.ts";

type UnknownRecord = Record<string, unknown>;

export type NormalizedNotionValue =
  | { kind: "text"; value: string }
  | { kind: "text_list"; value: string[] }
  | { kind: "ids"; value: string[]; truncated: boolean }
  | { kind: "date"; value: string }
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean };

export type NotionValueIssue = "malformed" | "unsupported" | "semantic_mismatch";

export type NotionValueResult =
  | { state: "missing" }
  | { state: "invalid"; issue: NotionValueIssue }
  | { state: "valid"; value: NormalizedNotionValue };

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isValidCalendarDate(yearText: string, monthText: string, dayText: string): boolean {
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function isValidDate(value: string): boolean {
  const dateParts = /^(\d{4})-(\d{2})-(\d{2})(?:$|T\d{2}:\d{2})/.exec(value);
  if (!dateParts || !isValidCalendarDate(dateParts[1], dateParts[2], dateParts[3])) return false;
  return !Number.isNaN(Date.parse(value));
}

function readDate(value: unknown): NotionValueResult {
  if (value === null || value === undefined) return { state: "missing" };
  if (!isRecord(value)) return { state: "invalid", issue: "malformed" };
  const start = normalizedText(value.start);
  if (!start) return { state: "missing" };
  return isValidDate(start)
    ? { state: "valid", value: { kind: "date", value: start } }
    : { state: "invalid", issue: "malformed" };
}

function readTextItems(value: unknown): NotionValueResult {
  if (!Array.isArray(value)) return { state: "invalid", issue: "malformed" };
  if (value.length === 0) return { state: "missing" };
  const parts: string[] = [];
  for (const item of value) {
    if (!isRecord(item)) return { state: "invalid", issue: "malformed" };
    if (typeof item.plain_text === "string") {
      parts.push(item.plain_text);
      continue;
    }
    if (isRecord(item.text) && typeof item.text.content === "string") {
      parts.push(item.text.content);
      continue;
    }
    return { state: "invalid", issue: "malformed" };
  }
  const text = parts.join("").trim();
  return text
    ? { state: "valid", value: { kind: "text", value: text } }
    : { state: "missing" };
}

function readNamedItem(value: unknown): NotionValueResult {
  if (value === null || value === undefined) return { state: "missing" };
  if (!isRecord(value)) return { state: "invalid", issue: "malformed" };
  const name = normalizedText(value.name);
  return name
    ? { state: "valid", value: { kind: "text", value: name } }
    : { state: "invalid", issue: "malformed" };
}

function readNamedItems(value: unknown): NotionValueResult {
  if (!Array.isArray(value)) return { state: "invalid", issue: "malformed" };
  if (value.length === 0) return { state: "missing" };
  const names = value.map((item) => isRecord(item) ? normalizedText(item.name) : null);
  if (names.some((name) => !name)) return { state: "invalid", issue: "malformed" };
  return { state: "valid", value: { kind: "text_list", value: names as string[] } };
}

function readIdentifiedItems(value: unknown, truncated = false): NotionValueResult {
  if (!Array.isArray(value)) return { state: "invalid", issue: "malformed" };
  if (value.length === 0 && !truncated) return { state: "missing" };
  const ids = value.map((item) => isRecord(item) ? normalizedText(item.id) : null);
  if (ids.some((id) => !id)) return { state: "invalid", issue: "malformed" };
  return { state: "valid", value: { kind: "ids", value: [...new Set(ids as string[])], truncated } };
}

function readNumber(value: unknown): NotionValueResult {
  if (value === null || value === undefined) return { state: "missing" };
  return typeof value === "number" && Number.isFinite(value)
    ? { state: "valid", value: { kind: "number", value } }
    : { state: "invalid", issue: "malformed" };
}

function readScalarText(value: unknown): NotionValueResult {
  if (value === null || value === undefined || value === "") return { state: "missing" };
  const text = normalizedText(value);
  return text
    ? { state: "valid", value: { kind: "text", value: text } }
    : { state: "invalid", issue: "malformed" };
}

function readTypedCalculation(value: unknown): NotionValueResult {
  if (!isRecord(value) || typeof value.type !== "string") return { state: "invalid", issue: "malformed" };
  switch (value.type) {
    case "string":
      return readScalarText(value.string);
    case "number":
      return readNumber(value.number);
    case "boolean":
      return typeof value.boolean === "boolean"
        ? { state: "valid", value: { kind: "boolean", value: value.boolean } }
        : { state: "invalid", issue: "malformed" };
    case "date":
      return readDate(value.date);
    case "array": {
      if (!Array.isArray(value.array)) return { state: "invalid", issue: "malformed" };
      if (value.array.length === 0) return { state: "missing" };
      const decoded = value.array.map(readTypedCalculation);
      if (decoded.some((item) => item.state !== "valid")) return { state: "invalid", issue: "malformed" };
      const textValues = decoded.flatMap((item) => item.state === "valid" && item.value.kind === "text" ? [item.value.value] : []);
      return textValues.length === decoded.length
        ? { state: "valid", value: { kind: "text_list", value: textValues } }
        : { state: "invalid", issue: "semantic_mismatch" };
    }
    case "unsupported":
    case "incomplete":
      return { state: "invalid", issue: "unsupported" };
    default:
      return { state: "invalid", issue: "malformed" };
  }
}

function decodeRawProperty(property: UnknownRecord): NotionValueResult {
  if (typeof property.type !== "string") return { state: "invalid", issue: "malformed" };
  switch (property.type) {
    case "title":
      return readTextItems(property.title);
    case "rich_text":
      return readTextItems(property.rich_text);
    case "select":
      return readNamedItem(property.select);
    case "status":
      return readNamedItem(property.status);
    case "multi_select":
      return readNamedItems(property.multi_select);
    case "relation":
      return readIdentifiedItems(property.relation, property.has_more === true);
    case "people":
      return readIdentifiedItems(property.people);
    case "date":
      return readDate(property.date);
    case "created_time": {
      const value = normalizedText(property.created_time);
      if (!value) return { state: "missing" };
      return isValidDate(value)
        ? { state: "valid", value: { kind: "date", value } }
        : { state: "invalid", issue: "malformed" };
    }
    case "formula":
      return readTypedCalculation(property.formula);
    case "rollup":
      return readTypedCalculation(property.rollup);
    case "unique_id": {
      if (!isRecord(property.unique_id)) return { state: "invalid", issue: "malformed" };
      const number = property.unique_id.number;
      if (number === null || number === undefined) return { state: "missing" };
      if (!Number.isSafeInteger(number)) return { state: "invalid", issue: "malformed" };
      const prefix = typeof property.unique_id.prefix === "string" ? property.unique_id.prefix : "";
      return { state: "valid", value: { kind: "text", value: `${prefix}${number}` } };
    }
    case "number":
      return readNumber(property.number);
    case "checkbox":
      return typeof property.checkbox === "boolean"
        ? { state: "valid", value: { kind: "boolean", value: property.checkbox } }
        : { state: "invalid", issue: "malformed" };
    case "email":
    case "url":
    case "phone_number":
      return readScalarText(property[property.type]);
    case "created_by":
      return isRecord(property.created_by)
        ? readIdentifiedItems([property.created_by])
        : { state: "invalid", issue: "malformed" };
    default:
      return { state: "invalid", issue: "unsupported" };
  }
}

const dateFields = new Set<NotionMappingFieldKey>([
  "ticket.openedAt",
  "ticket.startedAt",
  "ticket.completedAt",
  "ticket.plannedAt",
  "history.occurredAt",
  "history.stageStartedAt",
  "history.stageEndedAt",
]);

const categoryFields = new Set<NotionMappingFieldKey>([
  "ticket.reason",
  "ticket.sector",
]);

const textFields = new Set<NotionMappingFieldKey>([
  "ticket.openingTime",
  "ticket.priority",
  "ticket.slaStatus",
  "ticket.status",
  "history.eventType",
]);

function hasCompatibleSemantics(fieldKey: NotionMappingFieldKey, value: NormalizedNotionValue): boolean {
  if (dateFields.has(fieldKey)) return value.kind === "date";
  if (categoryFields.has(fieldKey)) return value.kind === "text" || value.kind === "text_list" || value.kind === "ids";
  if (textFields.has(fieldKey)) return value.kind === "text";

  switch (fieldKey) {
    case "ticket.externalCode":
      return value.kind === "text" || value.kind === "number";
    case "ticket.requester":
      return value.kind === "text" || value.kind === "ids";
    case "ticket.requesterEmail":
      return value.kind === "text";
    case "ticket.assignees":
    case "history.recordedBy":
    case "history.ticketRelation":
      return value.kind === "ids";
    case "ticket.outsideHours":
      return value.kind === "boolean" || value.kind === "text";
    case "history.businessMinutes":
      return value.kind === "number";
    default:
      return false;
  }
}

export function decodeMappedNotionProperty(
  property: unknown,
  mapping: Pick<IngestionNotionMapping, "fieldKey" | "propertyType">,
): NotionValueResult {
  if (property === undefined || property === null) return { state: "missing" };
  if (!isRecord(property) || property.type !== mapping.propertyType) {
    return { state: "invalid", issue: "malformed" };
  }
  const decoded = decodeRawProperty(property);
  if (decoded.state !== "valid") return decoded;
  return hasCompatibleSemantics(mapping.fieldKey, decoded.value)
    ? decoded
    : { state: "invalid", issue: "semantic_mismatch" };
}
