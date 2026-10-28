import type { DataField } from "../mock-data.ts";
import {
  formatMetricExpression,
  validateMetricDefinition,
  type AggregationNode,
  type MetricDefinitionDraft,
  type MetricExpression,
  type MetricPreview,
  type MetricValidationIssue,
} from "./metrics.ts";
import { selectOverviewTickets, type OverviewAnalyticsFilters } from "./overview-analytics.ts";
import { isDateOnly, parseAnalyticalDate } from "./notion-opening-date.ts";
import type { NormalizedNotionRecord } from "./notion-record-transformer.ts";
import { ticketCategoryValues, ticketFirstResponseMinutes, validTicketField } from "./analytical-ticket-rules.ts";
import type { SnapshotDataset } from "./sync-store.ts";

type EvaluatedAggregation = { value: number; coverage: number; sampleSize: number };

export class SnapshotMetricEvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotMetricEvaluationError";
  }
}

function issue(code: string, message: string, path: string): MetricValidationIssue {
  return { code, message, path };
}

function fieldSource(fieldId: string): "tickets" | "history" {
  return ["event-count", "event-date", "event-type", "stage-duration", "registered-by"].includes(fieldId)
    ? "history"
    : "tickets";
}

function fieldValues(record: NormalizedNotionRecord, key: Parameters<typeof validTicketField>[1]): Array<string | number | boolean> {
  const value = validTicketField(record, key);
  if (value?.kind === "text") return value.value.trim() ? [value.value.trim()] : [];
  if (value?.kind === "text_list") return value.value.map((item) => item.trim()).filter(Boolean);
  if (value?.kind === "ids") return value.value;
  if (value?.kind === "number") return [value.value];
  if (value?.kind === "boolean") return [value.value];
  if (value?.kind === "date") return [value.value];
  return [];
}

function durationBetween(record: NormalizedNotionRecord, startKey: Parameters<typeof validTicketField>[1], endKey: Parameters<typeof validTicketField>[1]): number | null {
  const start = validTicketField(record, startKey);
  const end = validTicketField(record, endKey);
  if (start?.kind !== "date" || end?.kind !== "date" || isDateOnly(start.value) || isDateOnly(end.value)) return null;
  const parsedStart = parseAnalyticalDate(start.value);
  const parsedEnd = parseAnalyticalDate(end.value);
  if (!parsedStart || !parsedEnd) return null;
  const elapsed = parsedEnd.getTime() - parsedStart.getTime();
  return elapsed >= 0 ? Math.round((elapsed / 60_000) * 100) / 100 : null;
}

function valuesForField(record: NormalizedNotionRecord, fieldId: string): Array<string | number | boolean> {
  if (fieldId === "ticket-count" || fieldId === "event-count") return [1];
  if (fieldId === "opened-at") return fieldValues(record, "ticket.openedAt");
  if (fieldId === "started-at") return fieldValues(record, "ticket.startedAt");
  if (fieldId === "closed-at") return fieldValues(record, "ticket.completedAt");
  if (fieldId === "first-response") {
    const value = ticketFirstResponseMinutes(record);
    return value === null ? [] : [value];
  }
  if (fieldId === "resolution-time") {
    const value = durationBetween(record, "ticket.openedAt", "ticket.completedAt");
    return value === null ? [] : [value];
  }
  if (fieldId === "priority") return ticketCategoryValues(record, "ticket.priority");
  if (fieldId === "status") return ticketCategoryValues(record, "ticket.status");
  if (fieldId === "sector") return ticketCategoryValues(record, "ticket.sector");
  if (fieldId === "reason") return ticketCategoryValues(record, "ticket.reason");
  if (fieldId === "category") return ticketCategoryValues(record, "ticket.reason").map((value) => value.split(/\s[-–—]\s/, 1)[0]?.trim()).filter(Boolean);
  if (fieldId === "assignee") return fieldValues(record, "ticket.assignees");
  if (fieldId === "sla-result") return ticketCategoryValues(record, "ticket.slaStatus");
  if (fieldId === "scheduled") return [validTicketField(record, "ticket.plannedAt")?.kind === "date"];
  if (fieldId === "event-date") return fieldValues(record, "history.occurredAt");
  if (fieldId === "event-type") return ticketCategoryValues(record, "history.eventType");
  if (fieldId === "stage-duration") return fieldValues(record, "history.businessMinutes");
  if (fieldId === "registered-by") return fieldValues(record, "history.recordedBy");
  return [];
}

function percentile(values: readonly number[], rank: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * rank / 100) - 1)];
}

function aggregate(node: AggregationNode, records: readonly NormalizedNotionRecord[], nullPolicy: MetricDefinitionDraft["nullPolicy"]): EvaluatedAggregation {
  const perRecord = records.map((record) => valuesForField(record, node.input.fieldId));
  const coveredRecords = perRecord.filter((values) => values.length > 0).length;
  if (nullPolicy === "invalidar" && coveredRecords !== records.length) {
    throw new SnapshotMetricEvaluationError("A política escolhida invalida a métrica porque há registros sem o campo selecionado.");
  }
  const values = perRecord.flat();
  const coverage = records.length > 0 ? Math.round((coveredRecords / records.length) * 10_000) / 100 : 0;
  if (node.operation === "contagem") {
    return { value: nullPolicy === "separar" ? records.length : coveredRecords, coverage, sampleSize: coveredRecords };
  }
  if (node.operation === "contagem_distinta") {
    return { value: new Set(values.map(String)).size, coverage, sampleSize: coveredRecords };
  }
  const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (numbers.length === 0) throw new SnapshotMetricEvaluationError("O campo não possui valores numéricos válidos no recorte atual.");
  const sorted = [...numbers].sort((left, right) => left - right);
  let value: number;
  if (node.operation === "soma") value = numbers.reduce((sum, item) => sum + item, 0);
  else if (node.operation === "média") value = numbers.reduce((sum, item) => sum + item, 0) / numbers.length;
  else if (node.operation === "mediana") {
    const middle = Math.floor(sorted.length / 2);
    value = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  } else if (node.operation === "percentil") value = percentile(numbers, node.percentile ?? 90);
  else if (node.operation === "mínimo") value = sorted[0];
  else value = sorted.at(-1)!;
  return { value, coverage, sampleSize: numbers.length };
}

export function previewSnapshotMetricDefinition(
  definition: MetricDefinitionDraft,
  fields: DataField[],
  dataset: Pick<SnapshotDataset, "tickets" | "history">,
  filters: Partial<OverviewAnalyticsFilters> = {},
): MetricPreview {
  const validation = validateMetricDefinition(definition, fields);
  if (!validation.valid || !validation.inferredType) throw new SnapshotMetricEvaluationError("A definição contém erros de validação.");
  const selectedTickets = selectOverviewTickets({ tickets: dataset.tickets }, filters).tickets;
  const selectedTicketIds = new Set(selectedTickets.map((record) => record.pageId));
  const selectedHistory = dataset.history.filter((record) => {
    const relation = validTicketField(record, "history.ticketRelation");
    return relation?.kind === "ids" && relation.value.some((ticketId) => selectedTicketIds.has(ticketId));
  });
  const samples: EvaluatedAggregation[] = [];

  function evaluate(expression: MetricExpression): number {
    if (expression.kind === "constante") return expression.value;
    if (expression.kind === "agregação") {
      const records = fieldSource(expression.input.fieldId) === "history" ? selectedHistory : selectedTickets;
      const result = aggregate(expression, records, definition.nullPolicy);
      samples.push(result);
      return result.value;
    }
    const left = evaluate(expression.left);
    const right = evaluate(expression.right);
    if (expression.operation === "somar") return left + right;
    if (expression.operation === "subtrair") return left - right;
    if (expression.operation === "multiplicar") return left * right;
    if (right === 0) throw new SnapshotMetricEvaluationError("O resultado não pode ser calculado porque o divisor é zero no recorte atual.");
    return left / right;
  }

  const rawValue = evaluate(definition.expression);
  if (!Number.isFinite(rawValue)) throw new SnapshotMetricEvaluationError("O resultado da métrica não é finito.");
  const coverage = samples.length > 0 ? Math.min(...samples.map((sample) => sample.coverage)) : 100;
  const sampleSize = samples.length > 0 ? Math.min(...samples.map((sample) => sample.sampleSize)) : 0;
  const warnings = [...validation.warnings];
  if (coverage < definition.coverageThreshold) {
    warnings.push(issue("cobertura_abaixo_do_limiar", `A cobertura de ${coverage.toLocaleString("pt-BR")}% está abaixo do limiar definido.`, "coverageThreshold"));
  }
  const formattedValue = validation.inferredType === "duração"
    ? `${rawValue.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} min`
    : rawValue.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  return {
    rawValue,
    formattedValue,
    coverage,
    sampleSize,
    formula: formatMetricExpression(definition.expression, fields),
    inferredType: validation.inferredType,
    warnings,
  };
}
