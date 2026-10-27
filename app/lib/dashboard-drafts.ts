import type { DashboardKey } from "../mock-data";
import type { MetricDefinitionDraft, MetricPreview } from "./metrics";
import { layoutItemsCollide } from "./dashboard-layout-collisions.ts";

export const DASHBOARD_DRAFT_SCHEMA_VERSION = 2;
export const DASHBOARD_PAGE_MAX_ROWS = 13;
export const DASHBOARD_MAX_PAGES = 12;

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

export type DashboardDraftPage = {
  id: string;
  name: string;
  layout: DraftLayoutItem[];
};

export type DashboardDraftSnapshot = {
  schemaVersion: typeof DASHBOARD_DRAFT_SCHEMA_VERSION;
  dashboardKey: DashboardKey;
  pages: DashboardDraftPage[];
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
  const h = Math.min(DASHBOARD_PAGE_MAX_ROWS, Math.max(1, Math.round(value.h as number)));
  const item: DraftLayoutItem = {
    i: value.i,
    x,
    y: Math.min(DASHBOARD_PAGE_MAX_ROWS - h, Math.max(0, Math.round(value.y as number))),
    w,
    h,
  };

  for (const property of ["minW", "minH", "maxW", "maxH"] as const) {
    if (finiteNumber(value[property])) {
      const maximum = property.endsWith("W") ? 12 : DASHBOARD_PAGE_MAX_ROWS;
      item[property] = Math.min(maximum, Math.max(1, Math.round(value[property])));
    }
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

export function dashboardDraftStorageKey(
  dashboardKey: DashboardKey,
  userId = "admin",
  schemaVersion = DASHBOARD_DRAFT_SCHEMA_VERSION,
): string {
  return `pulseti:v${schemaVersion}:dashboard-draft:${userId}:${dashboardKey}`;
}

export function createDefaultDashboardDraft(
  dashboardKey: DashboardKey,
  layout: ReadonlyArray<DraftLayoutItem>,
): DashboardDraftSnapshot {
  return {
    schemaVersion: DASHBOARD_DRAFT_SCHEMA_VERSION,
    dashboardKey,
    pages: [{ id: "page-1", name: "Página 1", layout: layout.map((item) => ({ ...item })) }],
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

export function findDashboardItemPlacement(
  item: DraftLayoutItem,
  placed: readonly DraftLayoutItem[],
): DraftLayoutItem | null {
  const candidates: Array<{ x: number; y: number; distance: number }> = [];
  for (let y = 0; y <= DASHBOARD_PAGE_MAX_ROWS - item.h; y += 1) {
    for (let x = 0; x <= 12 - item.w; x += 1) {
      candidates.push({ x, y, distance: Math.abs(x - item.x) + Math.abs(y - item.y) });
    }
  }
  candidates.sort((left, right) => left.distance - right.distance || left.y - right.y || left.x - right.x);
  const candidate = candidates.find(({ x, y }) => {
    const positioned = { ...item, x, y };
    return placed.every((placedItem) => !layoutItemsCollide(positioned, placedItem));
  });
  return candidate ? { ...item, x: candidate.x, y: candidate.y } : null;
}

function fitPageLayout(items: readonly DraftLayoutItem[]): DraftLayoutItem[] | null {
  const placed: DraftLayoutItem[] = [];
  for (const item of items) {
    const positioned = findDashboardItemPlacement(item, placed);
    if (!positioned) return null;
    placed.push(positioned);
  }
  return placed;
}

function migrateLegacyLayout(items: readonly DraftLayoutItem[]): DashboardDraftPage[] | null {
  const pages: DashboardDraftPage[] = [{ id: "page-1", name: "Página 1", layout: [] }];
  for (const item of items) {
    let current = pages.at(-1) as DashboardDraftPage;
    let positioned = findDashboardItemPlacement(item, current.layout);
    if (!positioned) {
      if (pages.length >= DASHBOARD_MAX_PAGES) return null;
      current = { id: `page-${pages.length + 1}`, name: `Página ${pages.length + 1}`, layout: [] };
      pages.push(current);
      positioned = findDashboardItemPlacement(item, current.layout);
    }
    if (!positioned) return null;
    current.layout.push(positioned);
  }
  return pages;
}

function sanitizePageIdentity(value: unknown): Pick<DashboardDraftPage, "id" | "name"> | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!/^page-[a-zA-Z0-9-]{1,80}$/.test(id) || name.length < 1 || name.length > 40) return null;
  return { id, name };
}

export function parseDashboardDraft(
  raw: string,
  expectedDashboardKey: DashboardKey,
  defaultLayout: ReadonlyArray<DraftLayoutItem>,
): DashboardDraftSnapshot | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return null;
    if (value.dashboardKey !== expectedDashboardKey || !Array.isArray(value.customWidgets)) return null;
    if (value.schemaVersion !== 1 && value.schemaVersion !== DASHBOARD_DRAFT_SCHEMA_VERSION) return null;

    const widgets = value.customWidgets.map(sanitizeWidget);
    if (widgets.some((widget) => widget === null)) return null;
    const validWidgets = widgets as DraftCustomWidget[];
    const allowedIds = new Set([...defaultLayout.map((item) => item.i), ...validWidgets.map((widget) => widget.id)]);
    const seenItemIds = new Set<string>();
    const sanitizeItems = (rawItems: unknown[]): DraftLayoutItem[] | null => {
      const items: DraftLayoutItem[] = [];
      for (const rawItem of rawItems) {
        const item = sanitizeLayoutItem(rawItem);
        if (!item || !allowedIds.has(item.i) || seenItemIds.has(item.i)) return null;
        seenItemIds.add(item.i);
        items.push(item);
      }
      return items;
    };

    let pages: DashboardDraftPage[];
    if (value.schemaVersion === 1) {
      if (!Array.isArray(value.layout)) return null;
      const legacyItems = sanitizeItems(value.layout);
      const migrated = legacyItems ? migrateLegacyLayout(legacyItems) : null;
      if (!migrated) return null;
      pages = migrated;
    } else {
      if (!Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > DASHBOARD_MAX_PAGES) return null;
      const seenPageIds = new Set<string>();
      pages = [];
      for (const rawPage of value.pages) {
        const identity = sanitizePageIdentity(rawPage);
        if (!identity || seenPageIds.has(identity.id) || !isRecord(rawPage) || !Array.isArray(rawPage.layout)) return null;
        seenPageIds.add(identity.id);
        const items = sanitizeItems(rawPage.layout);
        const layout = items ? fitPageLayout(items) : null;
        if (!layout) return null;
        pages.push({ ...identity, layout });
      }
    }

    if (allowedIds.size !== seenItemIds.size) return null;
    if (value.savedAt !== null && (typeof value.savedAt !== "string" || Number.isNaN(Date.parse(value.savedAt)))) return null;

    return {
      schemaVersion: DASHBOARD_DRAFT_SCHEMA_VERSION,
      dashboardKey: expectedDashboardKey,
      pages,
      customWidgets: validWidgets,
      savedAt: value.savedAt as string | null,
    };
  } catch {
    return null;
  }
}

export function dashboardDraftsEqual(left: DashboardDraftSnapshot, right: DashboardDraftSnapshot): boolean {
  return JSON.stringify({ pages: left.pages, customWidgets: left.customWidgets }) === JSON.stringify({ pages: right.pages, customWidgets: right.customWidgets });
}

export function dashboardPageLayoutsEqual(
  left: readonly DraftLayoutItem[],
  right: readonly DraftLayoutItem[],
): boolean {
  if (left.length !== right.length) return false;
  const rightById = new Map(right.map((item) => [item.i, item]));
  return left.every((item) => {
    const candidate = rightById.get(item.i);
    return Boolean(candidate)
      && item.x === candidate?.x
      && item.y === candidate?.y
      && item.w === candidate?.w
      && item.h === candidate?.h
      && item.minW === candidate?.minW
      && item.minH === candidate?.minH
      && item.maxW === candidate?.maxW
      && item.maxH === candidate?.maxH;
  });
}
