import type { OverviewAnalyticsFilters, OverviewPeriod } from "./overview-analytics.ts";
import type { AnalyticalDetailScope } from "./overview-details.ts";

const filterKeys = ["period", "sector", "priority", "status", "reason"] as const;

function parseDimension(searchParams: URLSearchParams, key: "sector" | "priority" | "status" | "reason") {
  const value = searchParams.get(key)?.trim() ?? "";
  if (value.length === 0) return null;
  return value.length <= 120 ? value : undefined;
}

export function parseOverviewFilters(
  searchParams: URLSearchParams,
  extraAllowedKeys: readonly string[] = [],
): OverviewAnalyticsFilters | null {
  const allowedKeys = new Set<string>([...filterKeys, ...extraAllowedKeys]);
  if ([...searchParams.keys()].some((key) => !allowedKeys.has(key))) return null;
  if ([...allowedKeys].some((key) => searchParams.getAll(key).length > 1)) return null;

  const period = searchParams.get("period") ?? "all";
  if (period !== "all" && period !== "last90" && period !== "last30") return null;

  const sector = parseDimension(searchParams, "sector");
  const priority = parseDimension(searchParams, "priority");
  const status = parseDimension(searchParams, "status");
  const reason = parseDimension(searchParams, "reason");
  if (sector === undefined || priority === undefined || status === undefined || reason === undefined) return null;

  return { period: period as OverviewPeriod, sector, priority, status, reason };
}

function parsePositiveInteger(value: string | null, fallback: number, maximum: number): number | null {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : null;
}

export function parseOverviewDetailsQuery(searchParams: URLSearchParams): {
  filters: OverviewAnalyticsFilters;
  page: number;
  pageSize: number;
  scope: AnalyticalDetailScope;
} | null {
  const filters = parseOverviewFilters(searchParams, ["page", "pageSize", "scope"]);
  const page = parsePositiveInteger(searchParams.get("page"), 1, 100_000);
  const pageSize = parsePositiveInteger(searchParams.get("pageSize"), 20, 50);
  const scope = searchParams.get("scope") ?? "all";
  const allowedScopes = new Set<AnalyticalDetailScope>([
    "all",
    "pending",
    "pending-valid-age",
    "pending-supplier",
    "pending-unassigned",
    "sla-evaluated",
    "sla-first-response",
  ]);
  return filters && page && pageSize && allowedScopes.has(scope as AnalyticalDetailScope)
    ? { filters, page, pageSize, scope: scope as AnalyticalDetailScope }
    : null;
}
