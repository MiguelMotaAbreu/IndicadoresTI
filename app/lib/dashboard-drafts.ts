import type { DashboardKey } from "../mock-data";
import type { MetricDefinitionDraft, MetricPreview } from "./metrics";
import { resolveDashboardLayoutCollisions } from "./dashboard-layout-collisions.ts";

export const DASHBOARD_DRAFT_SCHEMA_VERSION = 1;

export type DraftLayoutItem = {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
};

export type DraftCustomWidget = {
  id: string;
  title: string;
  visualization: string;
  formula: string;
  definition: MetricDefinitionDraft;
  preview: MetricPreview;
};

export type DashboardDraftSnapshot = {
  schemaVersion: typeof DASHBOARD_DRAFT_SCHEMA_VERSION;
  dashboardKey: DashboardKey;
  layout: DraftLayoutItem[];
  customWidgets: DraftCustomWidget[];
  savedAt: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStoredMetricDefinition(value: unknown): value is MetricDefinitionDraft {
  if (!isRecord(value) || !isRecord(value.expression)) return false;
  return (
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    (typeof value.dimensionFieldId === "string" || value.dimensionFieldId === null) &&
    typeof value.visualization === "string" &&
    finiteNumber(value.coverageThreshold) &&
    ["ignorar", "separar", "invalidar"].includes(String(value.nullPolicy)) &&
    ["agregação", "constante", "operação"].includes(String(value.expression.kind))
  );
}

function sanitizeLayoutItem(value: unknown): DraftLayoutItem | null {
  if (!isRecord(value) || typeof value.i !== "string" || !value.i) return null;
  if (![value.x, value.y, value.w, value.h].every(finiteNumber)) return null;

  const w = Math.min(12, Math.max(1, Math.round(value.w as number)));
  const x = Math.min(12 - w, Math.max(0, Math.round(value.x as number)));
  const item: DraftLayoutItem = {
    i: value.i,
    x,
    y: Math.max(0, Math.round(value.y as number)),
    w,
    h: Math.max(1, Math.round(value.h as number)),
  };

  for (const property of ["minW", "minH", "maxW", "maxH"] as const) {
    if (finiteNumber(value[property])) item[property] = Math.max(1, Math.round(value[property]));
  }
  return item;
}

function isMetricPreview(value: unknown): value is MetricPreview {
  if (!isRecord(value)) return false;
  return (
    finiteNumber(value.rawValue) &&
    typeof value.formattedValue === "string" &&
    finiteNumber(value.coverage) &&
    finiteNumber(value.sampleSize) &&
    typeof value.formula === "string" &&
    ["número", "duração"].includes(String(value.inferredType)) &&
    Array.isArray(value.warnings)
  );
}

function sanitizeWidget(value: unknown): DraftCustomWidget | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" || !value.id.startsWith("custom-") ||
    typeof value.title !== "string" ||
    typeof value.visualization !== "string" ||
    typeof value.formula !== "string" ||
    !isStoredMetricDefinition(value.definition) ||
    !isMetricPreview(value.preview)
  ) return null;

  return {
    id: value.id,
    title: value.title,
    visualization: value.visualization,
    formula: value.formula,
    definition: value.definition,
    preview: value.preview,
  };
}

export function dashboardDraftStorageKey(dashboardKey: DashboardKey, userId = "admin"): string {
  return `pulseti:v${DASHBOARD_DRAFT_SCHEMA_VERSION}:dashboard-draft:${userId}:${dashboardKey}`;
}

export function createDefaultDashboardDraft(
  dashboardKey: DashboardKey,
  layout: ReadonlyArray<DraftLayoutItem>,
): DashboardDraftSnapshot {
  return {
    schemaVersion: DASHBOARD_DRAFT_SCHEMA_VERSION,
    dashboardKey,
    layout: layout.map((item) => ({ ...item })),
    customWidgets: [],
    savedAt: null,
  };
}

export function cloneDashboardDraft(snapshot: DashboardDraftSnapshot): DashboardDraftSnapshot {
  return structuredClone(snapshot);
}

export function serializeDashboardDraft(snapshot: DashboardDraftSnapshot): string {
  return JSON.stringify(snapshot);
}

export function parseDashboardDraft(
  raw: string,
  expectedDashboardKey: DashboardKey,
  defaultLayout: ReadonlyArray<DraftLayoutItem>,
): DashboardDraftSnapshot | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return null;
    if (value.schemaVersion !== DASHBOARD_DRAFT_SCHEMA_VERSION || value.dashboardKey !== expectedDashboardKey) return null;
    if (!Array.isArray(value.layout) || !Array.isArray(value.customWidgets)) return null;

    const widgets = value.customWidgets.map(sanitizeWidget);
    if (widgets.some((widget) => widget === null)) return null;
    const validWidgets = widgets as DraftCustomWidget[];
    const allowedIds = new Set([...defaultLayout.map((item) => item.i), ...validWidgets.map((widget) => widget.id)]);
    const seenIds = new Set<string>();
    const parsedLayout: DraftLayoutItem[] = [];

    for (const rawItem of value.layout) {
      const item = sanitizeLayoutItem(rawItem);
      if (!item || !allowedIds.has(item.i) || seenIds.has(item.i)) return null;
      seenIds.add(item.i);
      parsedLayout.push(item);
    }

    if (allowedIds.size !== seenIds.size) return null;
    if (value.savedAt !== null && (typeof value.savedAt !== "string" || Number.isNaN(Date.parse(value.savedAt)))) return null;

    return {
      schemaVersion: DASHBOARD_DRAFT_SCHEMA_VERSION,
      dashboardKey: expectedDashboardKey,
      layout: resolveDashboardLayoutCollisions(parsedLayout),
      customWidgets: validWidgets,
      savedAt: value.savedAt as string | null,
    };
  } catch {
    return null;
  }
}

export function dashboardDraftsEqual(left: DashboardDraftSnapshot, right: DashboardDraftSnapshot): boolean {
  return JSON.stringify({ layout: left.layout, customWidgets: left.customWidgets }) === JSON.stringify({ layout: right.layout, customWidgets: right.customWidgets });
}
