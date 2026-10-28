import type { NotionMappingFieldKey } from "./notion-mapping.ts";
import { isDateOnly, parseAnalyticalDate } from "./notion-opening-date.ts";
import type { NormalizedNotionRecord } from "./notion-record-transformer.ts";
import {
  calculateOverviewAnalytics,
  selectOverviewTickets,
  type OverviewAnalyticsFilters,
} from "./overview-analytics.ts";
import type { AnalyticalSnapshot, SnapshotDataset } from "./sync-store.ts";

export type DemandAnalytics = {
  snapshot: {
    id: string;
    publishedAt: string;
    warningCount: number;
    ticketCount: number;
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
    };
    variation: {
      valuePercent: number | null;
      current: number;
      previous: number | null;
      comparableDays: number | null;
    };
    distinctReasons: {
      value: number;
      coveredTickets: number;
      coveragePercent: number;
    };
  };
  trend: {
    granularity: "day" | "month";
    points: Array<{ period: string; opened: number; completed: number }>;
  };
  heatmap: {
    coveragePercent: number;
    validOpenings: number;
    maximum: number;
    rows: Array<{ day: string; buckets: number[] }>;
  };
  reasons: {
    coveragePercent: number;
    items: Array<{ name: string; value: number }>;
  };
  pareto: {
    totalOccurrences: number;
    items: Array<{ name: string; value: number; cumulativePercent: number }>;
  };
};

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Sao_Paulo",
  weekday: "short",
  hour: "2-digit",
  hourCycle: "h23",
});
const dayLabels = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const weekdayIndex = new Map([
  ["Mon", 0],
  ["Tue", 1],
  ["Wed", 2],
  ["Thu", 3],
  ["Fri", 4],
  ["Sat", 5],
  ["Sun", 6],
]);

function percentage(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

function normalizeLabel(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
}

function validField(record: NormalizedNotionRecord, fieldKey: NotionMappingFieldKey) {
  const field = record.fields[fieldKey];
  return field?.state === "valid" ? field.value : null;
}

function readDate(record: NormalizedNotionRecord, fieldKey: NotionMappingFieldKey): Date | null {
  const value = validField(record, fieldKey);
  if (value?.kind !== "date") return null;
  return parseAnalyticalDate(value.value);
}

function readDateTime(record: NormalizedNotionRecord, fieldKey: NotionMappingFieldKey): Date | null {
  const value = validField(record, fieldKey);
  if (value?.kind !== "date" || isDateOnly(value.value)) return null;
  return parseAnalyticalDate(value.value);
}

function categoryValues(record: NormalizedNotionRecord, fieldKey: NotionMappingFieldKey): string[] {
  const value = validField(record, fieldKey);
  if (value?.kind === "text") return value.value.trim() ? [value.value.trim()] : [];
  if (value?.kind === "text_list") return [...new Set(value.value.map((item) => item.trim()).filter(Boolean))];
  return [];
}

function dateKey(value: Date): string {
  const parts = dateFormatter.formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((candidate) => candidate.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function shiftDate(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) + days * 86_400_000).toISOString().slice(0, 10);
}

function comparison(
  dataset: Pick<SnapshotDataset, "tickets">,
  filters: OverviewAnalyticsFilters,
  periodStart: string | null,
  current: number,
) {
  const comparableDays = filters.period === "last30" ? 30 : filters.period === "last90" ? 90 : null;
  if (!comparableDays || !periodStart) {
    return { valuePercent: null, current, previous: null, comparableDays: null };
  }

  const dimensionSelection = selectOverviewTickets(dataset, { ...filters, period: "all" });
  const previousEnd = shiftDate(periodStart, -1);
  const previousStart = shiftDate(previousEnd, -(comparableDays - 1));
  const previous = dimensionSelection.tickets.filter((record) => {
    const openedAt = readDate(record, "ticket.openedAt");
    if (!openedAt) return false;
    const openedKey = dateKey(openedAt);
    return openedKey >= previousStart && openedKey <= previousEnd;
  }).length;

  return {
    valuePercent: previous > 0 ? Math.round(((current - previous) / previous) * 10_000) / 100 : null,
    current,
    previous,
    comparableDays,
  };
}

function reasonAnalysis(records: readonly NormalizedNotionRecord[]) {
  const counts = new Map<string, { name: string; value: number }>();
  let coveredTickets = 0;
  for (const record of records) {
    const reasons = categoryValues(record, "ticket.reason");
    if (reasons.length === 0) continue;
    coveredTickets += 1;
    for (const reason of reasons) {
      const key = normalizeLabel(reason);
      const current = counts.get(key) ?? { name: reason, value: 0 };
      current.value += 1;
      counts.set(key, current);
    }
  }

  const sorted = [...counts.values()].sort((left, right) => right.value - left.value || left.name.localeCompare(right.name, "pt-BR"));
  const totalOccurrences = sorted.reduce((sum, item) => sum + item.value, 0);
  let cumulative = 0;
  return {
    distinctReasons: counts.size,
    coveredTickets,
    coveragePercent: percentage(coveredTickets, records.length),
    items: sorted.slice(0, 8),
    pareto: {
      totalOccurrences,
      items: sorted.slice(0, 10).map((item) => {
        cumulative += item.value;
        return {
          ...item,
          cumulativePercent: totalOccurrences ? Math.round((cumulative / totalOccurrences) * 10_000) / 100 : 0,
        };
      }),
    },
  };
}

function openingHeatmap(records: readonly NormalizedNotionRecord[]) {
  const rows = dayLabels.map((day) => ({ day, buckets: Array.from({ length: 8 }, () => 0) }));
  let validOpenings = 0;
  for (const record of records) {
    const openedAt = readDateTime(record, "ticket.openedAt");
    if (!openedAt) continue;
    const parts = dateTimeFormatter.formatToParts(openedAt);
    const dayIndex = weekdayIndex.get(parts.find((part) => part.type === "weekday")?.value ?? "");
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    if (dayIndex === undefined || !Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    rows[dayIndex].buckets[Math.floor(hour / 3)] += 1;
    validOpenings += 1;
  }
  return {
    coveragePercent: percentage(validOpenings, records.length),
    validOpenings,
    maximum: Math.max(0, ...rows.flatMap((row) => row.buckets)),
    rows,
  };
}

export function calculateDemandAnalytics(
  snapshot: AnalyticalSnapshot,
  dataset: Pick<SnapshotDataset, "tickets" | "history">,
  filters: Partial<OverviewAnalyticsFilters> = {},
): DemandAnalytics {
  const overview = calculateOverviewAnalytics(snapshot, dataset, filters);
  const selection = selectOverviewTickets(dataset, overview.selection.filters);
  const reasons = reasonAnalysis(selection.tickets);

  return {
    snapshot: {
      id: overview.snapshot.id,
      publishedAt: overview.snapshot.publishedAt,
      warningCount: overview.snapshot.warningCount,
      ticketCount: overview.snapshot.ticketCount,
    },
    selection: overview.selection,
    cards: {
      totalTickets: overview.cards.totalTickets,
      averagePerCalendarDay: {
        value: overview.cards.averagePerCalendarDay.value,
        validOpenings: overview.cards.averagePerCalendarDay.validOpenings,
        calendarDays: overview.cards.averagePerCalendarDay.calendarDays,
        coveragePercent: overview.cards.averagePerCalendarDay.coveragePercent,
      },
      variation: comparison(dataset, overview.selection.filters, overview.selection.periodStart, overview.cards.totalTickets),
      distinctReasons: {
        value: reasons.distinctReasons,
        coveredTickets: reasons.coveredTickets,
        coveragePercent: reasons.coveragePercent,
      },
    },
    trend: overview.demand,
    heatmap: openingHeatmap(selection.tickets),
    reasons: { coveragePercent: reasons.coveragePercent, items: reasons.items },
    pareto: reasons.pareto,
  };
}
