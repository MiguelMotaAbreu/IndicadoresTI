import type { NotionMappingFieldKey } from "./notion-mapping.ts";
import { parseAnalyticalDate } from "./notion-opening-date.ts";
import type { NormalizedNotionRecord } from "./notion-record-transformer.ts";
import {
  selectOverviewTickets,
  type OverviewAnalyticsFilters,
} from "./overview-analytics.ts";
import type { AnalyticalSnapshot, SnapshotDataset } from "./sync-store.ts";

export type PendingAnalytics = {
  snapshot: {
    id: string;
    publishedAt: string;
    warningCount: number;
    ticketCount: number;
  };
  selection: {
    totalTickets: number;
    matchedTickets: number;
    pendingTickets: number;
    periodStart: string | null;
    periodEnd: string | null;
    filters: OverviewAnalyticsFilters;
    options: {
      sectors: string[];
      priorities: string[];
      statuses: string[];
    };
  };
  cards: {
    total: {
      value: number;
      evaluatedStatuses: number;
      coveragePercent: number;
    };
    medianAgeHours: {
      value: number | null;
      validOpenings: number;
      coveragePercent: number;
    };
    withSupplier: {
      value: number;
      percentage: number;
    };
    withoutAssignee: {
      value: number;
      evaluatedAssignments: number;
      coveragePercent: number;
    };
  };
  age: {
    validOpenings: number;
    coveragePercent: number;
    buckets: Array<{ name: string; value: number }>;
  };
  oldest: Array<{
    rowKey: string;
    code: string;
    reason: string;
    sector: string;
    priority: string;
    openedAt: string;
    ageHours: number;
  }>;
  composition: {
    coveragePercent: number;
    priorities: Array<{ key: string; label: string }>;
    items: Array<{
      sector: string;
      total: number;
      values: Record<string, number>;
    }>;
  };
};

const pendingStatusPatterns = ["nao iniciado", "aguardando info", "fornecedor"];

function percentage(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

function normalizeLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function validField(record: NormalizedNotionRecord, fieldKey: NotionMappingFieldKey) {
  const field = record.fields[fieldKey];
  return field?.state === "valid" ? field.value : null;
}

function categoryValues(record: NormalizedNotionRecord, fieldKey: NotionMappingFieldKey): string[] {
  const value = validField(record, fieldKey);
  if (value?.kind === "text") return value.value.trim() ? [value.value.trim()] : [];
  if (value?.kind === "text_list") return [...new Set(value.value.map((item) => item.trim()).filter(Boolean))];
  return [];
}

function firstCategory(record: NormalizedNotionRecord, fieldKey: NotionMappingFieldKey): string | null {
  return categoryValues(record, fieldKey)[0] ?? null;
}

function readText(record: NormalizedNotionRecord, fieldKey: NotionMappingFieldKey): string | null {
  const value = validField(record, fieldKey);
  if (value?.kind === "text") return value.value.trim() || null;
  if (value?.kind === "number") return String(value.value);
  return null;
}

function isPendingStatus(value: string): boolean {
  const normalized = normalizeLabel(value);
  return pendingStatusPatterns.some((pattern) => normalized.includes(pattern));
}

function isSupplierStatus(value: string): boolean {
  return normalizeLabel(value).includes("fornecedor");
}

function ageHours(record: NormalizedNotionRecord, publishedAt: Date): number | null {
  const opening = validField(record, "ticket.openedAt");
  if (opening?.kind !== "date") return null;
  const parsed = parseAnalyticalDate(opening.value);
  if (!parsed) return null;
  const elapsed = publishedAt.getTime() - parsed.getTime();
  return elapsed >= 0 ? Math.floor(elapsed / 3_600_000) : null;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[midpoint - 1] + sorted[midpoint]) / 2) * 100) / 100
    : sorted[midpoint];
}

function ageBucket(hours: number): number {
  if (hours <= 24) return 0;
  if (hours <= 72) return 1;
  if (hours <= 168) return 2;
  if (hours <= 360) return 3;
  return 4;
}

function priorityRank(value: string): number {
  const ranks = new Map([
    ["critico", 0],
    ["muito alta", 1],
    ["alta", 2],
    ["media", 3],
    ["baixa", 4],
    ["planejado", 5],
    ["nao definido", 6],
  ]);
  return ranks.get(normalizeLabel(value)) ?? Number.MAX_SAFE_INTEGER;
}

function assignmentState(record: NormalizedNotionRecord): "assigned" | "unassigned" | "invalid" {
  const field = record.fields["ticket.assignees"];
  if (!field || field.state === "missing") return "unassigned";
  if (field.state !== "valid" || field.value.kind !== "ids") return "invalid";
  return field.value.value.length > 0 ? "assigned" : "unassigned";
}

export function calculatePendingAnalytics(
  snapshot: AnalyticalSnapshot,
  dataset: Pick<SnapshotDataset, "tickets">,
  filters: Partial<OverviewAnalyticsFilters> = {},
): PendingAnalytics {
  const selection = selectOverviewTickets(dataset, filters);
  const publishedAt = new Date(snapshot.publishedAt);
  const statusEvaluated = selection.tickets.filter((record) => firstCategory(record, "ticket.status") !== null);
  const pending = statusEvaluated.filter((record) => isPendingStatus(firstCategory(record, "ticket.status") ?? ""));
  const ages = pending.map((record) => ageHours(record, publishedAt)).filter((value): value is number => value !== null);
  const bucketNames = ["Até 1 dia", "1–3 dias", "4–7 dias", "8–15 dias", "Mais de 15"];
  const ageBuckets = bucketNames.map((name) => ({ name, value: 0 }));
  for (const hours of ages) ageBuckets[ageBucket(hours)].value += 1;

  const assignments = pending.map(assignmentState);
  const evaluatedAssignments = assignments.filter((state) => state !== "invalid").length;
  const withoutAssignee = assignments.filter((state) => state === "unassigned").length;
  const withSupplier = pending.filter((record) => isSupplierStatus(firstCategory(record, "ticket.status") ?? "")).length;

  const priorities = new Map<string, string>();
  for (const record of pending) {
    const priority = firstCategory(record, "ticket.priority");
    if (priority) priorities.set(normalizeLabel(priority), priority);
  }
  const priorityLabels = [...priorities.values()].sort((left, right) => (
    priorityRank(left) - priorityRank(right) || left.localeCompare(right, "pt-BR")
  ));
  const prioritySeries = priorityLabels.map((label, index) => ({ key: `priority${index}`, label }));
  const priorityKeys = new Map(prioritySeries.map((series) => [normalizeLabel(series.label), series.key]));
  const sectors = new Map<string, { sector: string; total: number; values: Record<string, number> }>();
  let compositionCovered = 0;
  for (const record of pending) {
    const sector = firstCategory(record, "ticket.sector");
    const priority = firstCategory(record, "ticket.priority");
    const priorityKey = priority ? priorityKeys.get(normalizeLabel(priority)) : null;
    if (!sector || !priorityKey) continue;
    compositionCovered += 1;
    const sectorKey = normalizeLabel(sector);
    const item = sectors.get(sectorKey) ?? { sector, total: 0, values: {} };
    item.total += 1;
    item.values[priorityKey] = (item.values[priorityKey] ?? 0) + 1;
    sectors.set(sectorKey, item);
  }

  const oldest = pending
    .flatMap((record) => {
      const hours = ageHours(record, publishedAt);
      const opening = validField(record, "ticket.openedAt");
      if (hours === null || opening?.kind !== "date") return [];
      return [{
        rowKey: record.pageId,
        code: readText(record, "ticket.externalCode") ?? "Sem código",
        reason: firstCategory(record, "ticket.reason") ?? "Motivo não informado",
        sector: firstCategory(record, "ticket.sector") ?? "Setor não informado",
        priority: firstCategory(record, "ticket.priority") ?? "Prioridade não informada",
        openedAt: opening.value,
        ageHours: hours,
      }];
    })
    .sort((left, right) => right.ageHours - left.ageHours || left.code.localeCompare(right.code, "pt-BR"))
    .slice(0, 5);

  return {
    snapshot: {
      id: snapshot.id,
      publishedAt: snapshot.publishedAt,
      warningCount: snapshot.warningCount,
      ticketCount: snapshot.ticketCount,
    },
    selection: {
      totalTickets: selection.allTickets.length,
      matchedTickets: selection.tickets.length,
      pendingTickets: pending.length,
      periodStart: selection.periodStart,
      periodEnd: selection.periodEnd,
      filters: selection.filters,
      options: selection.options,
    },
    cards: {
      total: {
        value: pending.length,
        evaluatedStatuses: statusEvaluated.length,
        coveragePercent: percentage(statusEvaluated.length, selection.tickets.length),
      },
      medianAgeHours: {
        value: median(ages),
        validOpenings: ages.length,
        coveragePercent: percentage(ages.length, pending.length),
      },
      withSupplier: {
        value: withSupplier,
        percentage: percentage(withSupplier, pending.length),
      },
      withoutAssignee: {
        value: withoutAssignee,
        evaluatedAssignments,
        coveragePercent: percentage(evaluatedAssignments, pending.length),
      },
    },
    age: {
      validOpenings: ages.length,
      coveragePercent: percentage(ages.length, pending.length),
      buckets: ageBuckets,
    },
    oldest,
    composition: {
      coveragePercent: percentage(compositionCovered, pending.length),
      priorities: prioritySeries,
      items: [...sectors.values()]
        .sort((left, right) => right.total - left.total || left.sector.localeCompare(right.sector, "pt-BR"))
        .slice(0, 8),
    },
  };
}
