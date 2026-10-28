import {
  normalizeAnalyticalLabel,
  ticketCategory,
  ticketFirstResponseMinutes,
  ticketSlaClassification,
} from "./analytical-ticket-rules.ts";
import {
  selectOverviewTickets,
  type OverviewAnalyticsFilters,
} from "./overview-analytics.ts";
import type { AnalyticalSnapshot, SnapshotDataset } from "./sync-store.ts";

export type SlaAnalytics = {
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
    evaluated: {
      value: number;
      within: number;
      outside: number;
      coveragePercent: number;
      compliancePercent: number | null;
    };
    firstResponse: {
      validIntervals: number;
      coveragePercent: number;
      medianMinutes: number | null;
      p90Minutes: number | null;
    };
  };
  histogram: {
    validIntervals: number;
    coveragePercent: number;
    buckets: Array<{ name: string; value: number }>;
  };
  complianceByPriority: {
    coveredTickets: number;
    coveragePercent: number;
    items: Array<{
      name: string;
      within: number;
      outside: number;
      evaluated: number;
      compliancePercent: number;
    }>;
  };
  timesByPriority: {
    coveredTickets: number;
    coveragePercent: number;
    items: Array<{
      name: string;
      samples: number;
      medianMinutes: number;
      p90Minutes: number | null;
    }>;
  };
};

function percentage(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  const result = sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint];
  return Math.round(result * 100) / 100;
}

function p90(values: readonly number[]): number | null {
  if (values.length < 5) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.9) - 1];
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
  return ranks.get(normalizeAnalyticalLabel(value)) ?? Number.MAX_SAFE_INTEGER;
}

function histogramBucket(minutes: number): number {
  if (minutes <= 15) return 0;
  if (minutes <= 30) return 1;
  if (minutes <= 60) return 2;
  if (minutes <= 240) return 3;
  if (minutes <= 480) return 4;
  return 5;
}

export function calculateSlaAnalytics(
  snapshot: AnalyticalSnapshot,
  dataset: Pick<SnapshotDataset, "tickets">,
  filters: Partial<OverviewAnalyticsFilters> = {},
): SlaAnalytics {
  const selection = selectOverviewTickets(dataset, filters);
  const intervals = selection.tickets.flatMap((record) => {
    const minutes = ticketFirstResponseMinutes(record);
    return minutes === null ? [] : [{ record, minutes }];
  });
  const intervalValues = intervals.map((item) => item.minutes);

  let within = 0;
  let outside = 0;
  const complianceGroups = new Map<string, { name: string; within: number; outside: number }>();
  for (const record of selection.tickets) {
    const classification = ticketSlaClassification(record);
    if (!classification) continue;
    if (classification === "within") within += 1;
    else outside += 1;
    const priority = ticketCategory(record, "ticket.priority");
    if (!priority) continue;
    const key = normalizeAnalyticalLabel(priority);
    const group = complianceGroups.get(key) ?? { name: priority, within: 0, outside: 0 };
    group[classification] += 1;
    complianceGroups.set(key, group);
  }
  const evaluated = within + outside;

  const histogramNames = ["0–15 min", "15–30", "30–60", "1–4 h", "4–8 h", "> 8 h"];
  const buckets = histogramNames.map((name) => ({ name, value: 0 }));
  for (const minutes of intervalValues) buckets[histogramBucket(minutes)].value += 1;

  const timeGroups = new Map<string, { name: string; values: number[] }>();
  for (const { record, minutes } of intervals) {
    const priority = ticketCategory(record, "ticket.priority");
    if (!priority) continue;
    const key = normalizeAnalyticalLabel(priority);
    const group = timeGroups.get(key) ?? { name: priority, values: [] };
    group.values.push(minutes);
    timeGroups.set(key, group);
  }
  const timeCoveredTickets = [...timeGroups.values()].reduce((sum, group) => sum + group.values.length, 0);
  const complianceCoveredTickets = [...complianceGroups.values()].reduce((sum, group) => sum + group.within + group.outside, 0);

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
      periodStart: selection.periodStart,
      periodEnd: selection.periodEnd,
      filters: selection.filters,
      options: selection.options,
    },
    cards: {
      evaluated: {
        value: evaluated,
        within,
        outside,
        coveragePercent: percentage(evaluated, selection.tickets.length),
        compliancePercent: evaluated > 0 ? percentage(within, evaluated) : null,
      },
      firstResponse: {
        validIntervals: intervalValues.length,
        coveragePercent: percentage(intervalValues.length, selection.tickets.length),
        medianMinutes: median(intervalValues),
        p90Minutes: p90(intervalValues),
      },
    },
    histogram: {
      validIntervals: intervalValues.length,
      coveragePercent: percentage(intervalValues.length, selection.tickets.length),
      buckets,
    },
    complianceByPriority: {
      coveredTickets: complianceCoveredTickets,
      coveragePercent: percentage(complianceCoveredTickets, selection.tickets.length),
      items: [...complianceGroups.values()]
        .map((group) => {
          const groupEvaluated = group.within + group.outside;
          return {
            ...group,
            evaluated: groupEvaluated,
            compliancePercent: percentage(group.within, groupEvaluated),
          };
        })
        .sort((left, right) => priorityRank(left.name) - priorityRank(right.name) || left.name.localeCompare(right.name, "pt-BR")),
    },
    timesByPriority: {
      coveredTickets: timeCoveredTickets,
      coveragePercent: percentage(timeCoveredTickets, selection.tickets.length),
      items: [...timeGroups.values()]
        .map((group) => ({
          name: group.name,
          samples: group.values.length,
          medianMinutes: median(group.values) ?? 0,
          p90Minutes: p90(group.values),
        }))
        .sort((left, right) => priorityRank(left.name) - priorityRank(right.name) || left.name.localeCompare(right.name, "pt-BR")),
    },
  };
}
