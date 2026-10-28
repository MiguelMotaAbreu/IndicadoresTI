import type { NotionMappingFieldKey } from "./notion-mapping.ts";
import { isDateOnly, parseAnalyticalDate } from "./notion-opening-date.ts";
import type { NormalizedNotionRecord } from "./notion-record-transformer.ts";

export type TicketSlaClassification = "within" | "outside" | null;

export function normalizeAnalyticalLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function validTicketField(record: NormalizedNotionRecord, fieldKey: NotionMappingFieldKey) {
  const field = record.fields[fieldKey];
  return field?.state === "valid" ? field.value : null;
}

export function ticketCategoryValues(record: NormalizedNotionRecord, fieldKey: NotionMappingFieldKey): string[] {
  const value = validTicketField(record, fieldKey);
  if (value?.kind === "text") return value.value.trim() ? [value.value.trim()] : [];
  if (value?.kind === "text_list") return [...new Set(value.value.map((item) => item.trim()).filter(Boolean))];
  return [];
}

export function ticketCategory(record: NormalizedNotionRecord, fieldKey: NotionMappingFieldKey): string | null {
  return ticketCategoryValues(record, fieldKey)[0] ?? null;
}

export function isPendingTicket(record: NormalizedNotionRecord): boolean {
  const status = normalizeAnalyticalLabel(ticketCategory(record, "ticket.status") ?? "");
  return ["nao iniciado", "aguardando info", "fornecedor"].some((pattern) => status.includes(pattern));
}

export function isSupplierPendingTicket(record: NormalizedNotionRecord): boolean {
  return isPendingTicket(record)
    && normalizeAnalyticalLabel(ticketCategory(record, "ticket.status") ?? "").includes("fornecedor");
}

export function isUnassignedPendingTicket(record: NormalizedNotionRecord): boolean {
  if (!isPendingTicket(record)) return false;
  const field = record.fields["ticket.assignees"];
  if (!field || field.state === "missing") return true;
  return field.state === "valid" && field.value.kind === "ids" && field.value.value.length === 0;
}

export function ticketSlaClassification(record: NormalizedNotionRecord): TicketSlaClassification {
  const value = ticketCategory(record, "ticket.slaStatus");
  if (!value) return null;
  const normalized = normalizeAnalyticalLabel(value);
  if (normalized.includes("dentro") && (normalized.includes("prazo") || normalized.includes("sla"))) return "within";
  if (
    normalized.includes("fora do prazo")
    || normalized.includes("fora do sla")
    || normalized.includes("exced")
    || normalized.includes("vencid")
  ) return "outside";
  return null;
}

export function ticketFirstResponseMinutes(record: NormalizedNotionRecord): number | null {
  const opening = validTicketField(record, "ticket.openedAt");
  const started = validTicketField(record, "ticket.startedAt");
  if (opening?.kind !== "date" || started?.kind !== "date") return null;
  if (isDateOnly(opening.value) || isDateOnly(started.value)) return null;
  const openingDate = parseAnalyticalDate(opening.value);
  const startedDate = parseAnalyticalDate(started.value);
  if (!openingDate || !startedDate) return null;
  const elapsed = startedDate.getTime() - openingDate.getTime();
  return elapsed >= 0 ? Math.round((elapsed / 60_000) * 100) / 100 : null;
}

export function ticketAgeHours(record: NormalizedNotionRecord, reference: Date): number | null {
  const opening = validTicketField(record, "ticket.openedAt");
  if (opening?.kind !== "date") return null;
  const parsed = parseAnalyticalDate(opening.value);
  if (!parsed) return null;
  const elapsed = reference.getTime() - parsed.getTime();
  return elapsed >= 0 ? Math.floor(elapsed / 3_600_000) : null;
}
