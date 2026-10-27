import type { AnalyticalSnapshot, SnapshotDataset } from "./sync-store.ts";
import type { NotionMappingFieldKey } from "./notion-mapping.ts";
import type { NormalizedNotionRecord } from "./notion-record-transformer.ts";

export type AnalyticsDistributionItem = { name: string; value: number };

export type OverviewPeriod = "all" | "last90" | "last30";

export type OverviewAnalyticsFilters = {
  period: OverviewPeriod;
  sector: string | null;
  priority: string | null;
  status: string | null;
  reason: string | null;
};

export type OverviewAnalytics = {
  snapshot: {
    id: string;
    publishedAt: string;
    warningCount: number;
    ticketCount: number;
    eventCount: number;
  };
  selection: {
    totalTickets: number;
    matchedTickets: number;
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
    totalTickets: number;
    averagePerCalendarDay: {
      value: number | null;
      validOpenings: number;
      calendarDays: number;
      coveragePercent: number;
      periodStart: string | null;
      periodEnd: string | null;
    };
    slaCompliance: {
      valuePercent: number | null;
      evaluated: number;
      within: number;
      outside: number;
      coveragePercent: number;
    };
    pendingTickets: {
      value: number;
      validStatuses: number;
      coveragePercent: number;
    };
  };
  demand: {
    granularity: "day" | "month";
    points: Array<{ period: string; opened: number; completed: number }>;
  };
  distributions: {
    status: { coveragePercent: number; items: AnalyticsDistributionItem[] };
    priority: { coveragePercent: number; items: AnalyticsDistributionItem[] };
    reason: { coveragePercent: number; items: AnalyticsDistributionItem[] };
  };
};

const saoPauloDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

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

function readDate(record: NormalizedNotionRecord, fieldKey: NotionMappingFieldKey): Date | null {
  const value = validField(record, fieldKey);
  if (value?.kind !== "date") return null;
  const parsed = new Date(value.value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateKey(value: Date): string {
  const parts = saoPauloDateFormatter.formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

function utcDay(key: string): number {
  const [year, month, day] = key.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function calendarDaysInclusive(first: string, last: string): number {
  return Math.floor((utcDay(last) - utcDay(first)) / 86_400_000) + 1;
}

function addCalendarDays(key: string, days: number): string {
  return new Date(utcDay(key) + days * 86_400_000).toISOString().slice(0, 10);
}

function categoryValues(record: NormalizedNotionRecord, fieldKey: NotionMappingFieldKey): string[] {
  const value = validField(record, fieldKey);
  if (value?.kind === "text") return [value.value];
  if (value?.kind === "text_list") return [...new Set(value.value)];
  return [];
}

function priorityRank(value: string): number {
  const priority = new Map([
    ["critico", 0],
    ["muito alta", 1],
    ["alta", 2],
    ["media", 3],
    ["baixa", 4],
    ["planejado", 5],
    ["nao definido", 6],
  ]);
  return priority.get(normalizeLabel(value)) ?? Number.MAX_SAFE_INTEGER;
}

function filterOptions(
  records: readonly NormalizedNotionRecord[],
  fieldKey: NotionMappingFieldKey,
  priorityOrder = false,
): string[] {
  const unique = new Map<string, string>();
  for (const record of records) {
    for (const rawValue of categoryValues(record, fieldKey)) {
      const value = rawValue.trim();
      const normalized = normalizeLabel(value);
      if (normalized && !unique.has(normalized)) unique.set(normalized, value);
    }
  }
  return [...unique.values()].sort((left, right) => {
    if (priorityOrder) {
      const rankDifference = priorityRank(left) - priorityRank(right);
      if (rankDifference !== 0) return rankDifference;
    }
    return left.localeCompare(right, "pt-BR");
  });
}

function matchesCategory(
  record: NormalizedNotionRecord,
  fieldKey: NotionMappingFieldKey,
  selected: string | null,
): boolean {
  if (!selected) return true;
  const normalizedSelected = normalizeLabel(selected);
  return categoryValues(record, fieldKey).some((value) => normalizeLabel(value) === normalizedSelected);
}

function normalizeFilters(filters: Partial<OverviewAnalyticsFilters>): OverviewAnalyticsFilters {
  const normalizedDimension = (value: string | null | undefined) => {
    const trimmed = value?.trim() ?? "";
    return trimmed || null;
  };
  return {
    period: filters.period === "last30" || filters.period === "last90" ? filters.period : "all",
    sector: normalizedDimension(filters.sector),
    priority: normalizedDimension(filters.priority),
    status: normalizedDimension(filters.status),
    reason: normalizedDimension(filters.reason),
  };
}

function distribution(
  records: readonly NormalizedNotionRecord[],
  fieldKey: NotionMappingFieldKey,
  options: { priorityOrder?: boolean; top?: number } = {},
): { coveragePercent: number; items: AnalyticsDistributionItem[] } {
  const counts = new Map<string, number>();
  let coveredRecords = 0;
  for (const record of records) {
    const values = categoryValues(record, fieldKey);
    if (values.length === 0) continue;
    coveredRecords += 1;
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  let items = Array.from(counts, ([name, value]) => ({ name, value }));
  items.sort((left, right) => {
    if (options.priorityOrder) {
      const leftPriority = priorityRank(left.name);
      const rightPriority = priorityRank(right.name);
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    }
    return right.value - left.value || left.name.localeCompare(right.name, "pt-BR");
  });

  if (options.top && items.length > options.top) {
    const visible = items.slice(0, options.top);
    const remainder = items.slice(options.top).reduce((sum, item) => sum + item.value, 0);
    items = [...visible, { name: "Outros", value: remainder }];
  }
  return { coveragePercent: percentage(coveredRecords, records.length), items };
}

function classifySla(records: readonly NormalizedNotionRecord[]) {
  let within = 0;
  let outside = 0;
  for (const record of records) {
    const label = categoryValues(record, "ticket.slaStatus")[0];
    if (!label) continue;
    const normalized = normalizeLabel(label);
    if (normalized.includes("dentro") && (normalized.includes("prazo") || normalized.includes("sla"))) {
      within += 1;
    } else if (
      normalized.includes("fora do prazo")
      || normalized.includes("fora do sla")
      || normalized.includes("exced")
      || normalized.includes("vencid")
    ) {
      outside += 1;
    }
  }
  const evaluated = within + outside;
  return {
    valuePercent: evaluated ? percentage(within, evaluated) : null,
    evaluated,
    within,
    outside,
    coveragePercent: percentage(evaluated, records.length),
  };
}

function classifyPending(records: readonly NormalizedNotionRecord[]) {
  let validStatuses = 0;
  let value = 0;
  for (const record of records) {
    const label = categoryValues(record, "ticket.status")[0];
    if (!label) continue;
    validStatuses += 1;
    const normalized = normalizeLabel(label);
    if (
      normalized.includes("nao iniciado")
      || normalized.includes("aguardando info")
      || normalized.includes("fornecedor")
    ) value += 1;
  }
  return { value, validStatuses, coveragePercent: percentage(validStatuses, records.length) };
}

function demandSeries(
  records: readonly NormalizedNotionRecord[],
  periodStart: string | null,
  periodEnd: string | null,
) {
  const openedDates = records.flatMap((record) => {
    const value = readDate(record, "ticket.openedAt");
    if (!value) return [];
    const key = dateKey(value);
    return periodStart && periodEnd && (key < periodStart || key > periodEnd) ? [] : [key];
  });
  const completedDates = records.flatMap((record) => {
    const value = readDate(record, "ticket.completedAt");
    if (!value) return [];
    const key = dateKey(value);
    return periodStart && periodEnd && (key < periodStart || key > periodEnd) ? [] : [key];
  });
  const allDates = [...openedDates, ...completedDates].sort();
  const first = periodStart ?? allDates[0];
  const last = periodEnd ?? allDates.at(-1);
  if (!first || !last) return { granularity: "day" as const, points: [] };

  const daySpan = calendarDaysInclusive(first, last);
  const granularity = daySpan <= 366 ? "day" as const : "month" as const;
  const toBucket = (value: string) => granularity === "day" ? value : value.slice(0, 7);
  const counts = new Map<string, { opened: number; completed: number }>();
  for (const value of openedDates) {
    const bucket = toBucket(value);
    const current = counts.get(bucket) ?? { opened: 0, completed: 0 };
    current.opened += 1;
    counts.set(bucket, current);
  }
  for (const value of completedDates) {
    const bucket = toBucket(value);
    const current = counts.get(bucket) ?? { opened: 0, completed: 0 };
    current.completed += 1;
    counts.set(bucket, current);
  }

  const points: Array<{ period: string; opened: number; completed: number }> = [];
  if (granularity === "day") {
    for (let cursor = utcDay(first), count = 0; cursor <= utcDay(last) && count < 367; cursor += 86_400_000, count += 1) {
      const period = new Date(cursor).toISOString().slice(0, 10);
      const current = counts.get(period) ?? { opened: 0, completed: 0 };
      points.push({ period, ...current });
    }
  } else {
    const [firstYear, firstMonth] = first.split("-").map(Number);
    const [lastYear, lastMonth] = last.split("-").map(Number);
    let cursor = firstYear * 12 + firstMonth - 1;
    const end = lastYear * 12 + lastMonth - 1;
    for (let count = 0; cursor <= end && count < 600; cursor += 1, count += 1) {
      const year = Math.floor(cursor / 12);
      const month = String((cursor % 12) + 1).padStart(2, "0");
      const period = `${year}-${month}`;
      const current = counts.get(period) ?? { opened: 0, completed: 0 };
      points.push({ period, ...current });
    }
  }
  return { granularity, points };
}

export function calculateOverviewAnalytics(
  snapshot: AnalyticalSnapshot,
  dataset: Pick<SnapshotDataset, "tickets" | "history">,
  requestedFilters: Partial<OverviewAnalyticsFilters> = {},
): OverviewAnalytics {
  const filters = normalizeFilters(requestedFilters);
  const allTickets = dataset.tickets;
  const allOpenedKeys = allTickets.flatMap((record) => {
    const value = readDate(record, "ticket.openedAt");
    return value ? [dateKey(value)] : [];
  }).sort();
  const lastOpening = allOpenedKeys.at(-1) ?? null;
  const periodStart = filters.period === "all"
    ? allOpenedKeys[0] ?? null
    : lastOpening
      ? addCalendarDays(lastOpening, filters.period === "last30" ? -29 : -89)
      : null;
  const periodEnd = lastOpening;
  const tickets = allTickets.filter((record) => {
    if (filters.period !== "all") {
      const openedAt = readDate(record, "ticket.openedAt");
      if (!openedAt || !periodStart || !periodEnd) return false;
      const openedKey = dateKey(openedAt);
      if (openedKey < periodStart || openedKey > periodEnd) return false;
    }
    return matchesCategory(record, "ticket.sector", filters.sector)
      && matchesCategory(record, "ticket.priority", filters.priority)
      && matchesCategory(record, "ticket.status", filters.status)
      && matchesCategory(record, "ticket.reason", filters.reason);
  });
  const openedKeys = tickets.flatMap((record) => {
    const value = readDate(record, "ticket.openedAt");
    return value ? [dateKey(value)] : [];
  });
  const calendarDays = periodStart && periodEnd ? calendarDaysInclusive(periodStart, periodEnd) : 0;

  return {
    snapshot: {
      id: snapshot.id,
      publishedAt: snapshot.publishedAt,
      warningCount: snapshot.warningCount,
      ticketCount: snapshot.ticketCount,
      eventCount: snapshot.eventCount,
    },
    selection: {
      totalTickets: allTickets.length,
      matchedTickets: tickets.length,
      periodStart,
      periodEnd,
      filters,
      options: {
        sectors: filterOptions(allTickets, "ticket.sector"),
        priorities: filterOptions(allTickets, "ticket.priority", true),
        statuses: filterOptions(allTickets, "ticket.status"),
      },
    },
    cards: {
      totalTickets: tickets.length,
      averagePerCalendarDay: {
        value: calendarDays ? Math.round((openedKeys.length / calendarDays) * 100) / 100 : null,
        validOpenings: openedKeys.length,
        calendarDays,
        coveragePercent: percentage(openedKeys.length, tickets.length),
        periodStart,
        periodEnd,
      },
      slaCompliance: classifySla(tickets),
      pendingTickets: classifyPending(tickets),
    },
    demand: demandSeries(tickets, periodStart, periodEnd),
    distributions: {
      status: distribution(tickets, "ticket.status"),
      priority: distribution(tickets, "ticket.priority", { priorityOrder: true }),
      reason: distribution(tickets, "ticket.reason", { top: 8 }),
    },
  };
}
