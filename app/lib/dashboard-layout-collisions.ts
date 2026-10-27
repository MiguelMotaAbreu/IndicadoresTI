import type { Compactor, Layout } from "react-grid-layout";

export type GridRectangle = {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  moved?: boolean;
};

export type MagneticSnapOptions = {
  cols?: number;
  maxRows?: number;
  attractionDistance?: number;
};

export function layoutItemsCollide(left: GridRectangle, right: GridRectangle): boolean {
  if (left.i === right.i) return false;
  return !(
    left.x + left.w <= right.x ||
    right.x + right.w <= left.x ||
    left.y + left.h <= right.y ||
    right.y + right.h <= left.y
  );
}

export function dashboardLayoutFitsBounds<T extends GridRectangle>(
  layout: readonly T[],
  cols = 12,
  maxRows = 13,
): boolean {
  return layout.every((item) => (
    item.x >= 0
    && item.y >= 0
    && item.w >= 1
    && item.h >= 1
    && item.x + item.w <= cols
    && item.y + item.h <= maxRows
  )) && !layout.some((item, index) => (
    layout.slice(index + 1).some((other) => layoutItemsCollide(item, other))
  ));
}

export function resolveDashboardLayoutCollisions<T extends GridRectangle>(layout: readonly T[]): T[] {
  const resolved = layout.map((item) => ({ ...item })) as T[];
  const processingOrder = resolved
    .map((item, originalIndex) => ({ item, originalIndex }))
    .sort((left, right) => (
      left.item.y - right.item.y ||
      left.item.x - right.item.x ||
      left.originalIndex - right.originalIndex
    ));
  const placed: T[] = [];

  for (const { item } of processingOrder) {
    let collisions = placed.filter((candidate) => layoutItemsCollide(item, candidate));
    while (collisions.length > 0) {
      item.y = Math.max(...collisions.map((candidate) => candidate.y + candidate.h));
      collisions = placed.filter((candidate) => layoutItemsCollide(item, candidate));
    }
    placed.push(item);
  }

  return resolved;
}

/**
 * Reorganiza um layout dentro de uma página finita, preservando primeiro o
 * bloco que está sendo manipulado e escolhendo a posição livre mais próxima
 * para os demais. Retorna null quando as dimensões atuais não cabem na página.
 */
export function fitDashboardLayoutWithinBounds<T extends GridRectangle>(
  layout: readonly T[],
  cols = 12,
  maxRows = 13,
): T[] | null {
  if (layout.some((item) => (
    item.w < 1
    || item.h < 1
    || item.w > cols
    || item.h > maxRows
  ))) return null;

  type IndexedItem = { item: T; originalIndex: number };
  type PositionCandidate = { x: number; y: number; distance: number; movesUp: number };

  const source = layout.map((item) => ({ ...item })) as T[];
  const processingOrder: IndexedItem[] = source
    .map((item, originalIndex) => ({ item, originalIndex }))
    .sort((left, right) => (
      Number(Boolean(right.item.moved)) - Number(Boolean(left.item.moved))
      || left.item.y - right.item.y
      || left.item.x - right.item.x
      || left.originalIndex - right.originalIndex
    ));
  const placed: T[] = [];
  const positions = new Map<string, Pick<GridRectangle, "x" | "y">>();

  for (const { item } of processingOrder) {
    const desiredX = Math.min(Math.max(item.x, 0), cols - item.w);
    const desiredY = Math.min(Math.max(item.y, 0), maxRows - item.h);
    const candidates: PositionCandidate[] = [];

    for (let y = 0; y <= maxRows - item.h; y += 1) {
      for (let x = 0; x <= cols - item.w; x += 1) {
        candidates.push({
          x,
          y,
          distance: Math.abs(x - desiredX) + Math.abs(y - desiredY),
          movesUp: y < desiredY ? 1 : 0,
        });
      }
    }

    const available = candidates
      .sort((left, right) => (
        left.distance - right.distance
        || left.movesUp - right.movesUp
        || Math.abs(left.y - desiredY) - Math.abs(right.y - desiredY)
        || Math.abs(left.x - desiredX) - Math.abs(right.x - desiredX)
        || left.y - right.y
        || left.x - right.x
      ))
      .find((candidate) => {
        const positioned = { ...item, x: candidate.x, y: candidate.y };
        return placed.every((other) => !layoutItemsCollide(positioned, other));
      });

    if (!available) return null;

    const positioned = { ...item, x: available.x, y: available.y } as T;
    placed.push(positioned);
    positions.set(item.i, { x: available.x, y: available.y });
  }

  return source.map((item) => ({ ...item, ...positions.get(item.i) })) as T[];
}

function overlapLength(firstStart: number, firstLength: number, secondStart: number, secondLength: number): number {
  return Math.max(0, Math.min(firstStart + firstLength, secondStart + secondLength) - Math.max(firstStart, secondStart));
}

export function magnetizeDashboardItem<T extends GridRectangle>(
  layout: readonly T[],
  itemId: string,
  options: MagneticSnapOptions = {},
): T[] {
  const cols = options.cols ?? 12;
  const maxRows = options.maxRows ?? 13;
  const attractionDistance = options.attractionDistance ?? 1;
  const source = layout.find((item) => item.i === itemId);
  if (!source || attractionDistance <= 0) return layout.map((item) => ({ ...item })) as T[];

  type Candidate = {
    x: number;
    y: number;
    distance: number;
    contact: number;
    anchorOrder: number;
    sideOrder: number;
  };

  const candidates: Candidate[] = [];
  const anchors = layout.filter((item) => item.i !== itemId);
  anchors.forEach((anchor, anchorOrder) => {
    const verticalContact = overlapLength(source.y, source.h, anchor.y, anchor.h);
    if (verticalContact > 0) {
      candidates.push(
        { x: anchor.x - source.w, y: source.y, distance: Math.abs(anchor.x - source.w - source.x), contact: verticalContact, anchorOrder, sideOrder: 0 },
        { x: anchor.x + anchor.w, y: source.y, distance: Math.abs(anchor.x + anchor.w - source.x), contact: verticalContact, anchorOrder, sideOrder: 1 },
      );
    }

    const horizontalContact = overlapLength(source.x, source.w, anchor.x, anchor.w);
    if (horizontalContact > 0) {
      candidates.push(
        { x: source.x, y: anchor.y - source.h, distance: Math.abs(anchor.y - source.h - source.y), contact: horizontalContact, anchorOrder, sideOrder: 2 },
        { x: source.x, y: anchor.y + anchor.h, distance: Math.abs(anchor.y + anchor.h - source.y), contact: horizontalContact, anchorOrder, sideOrder: 3 },
      );
    }
  });

  const best = candidates
    .filter((candidate) => (
      candidate.distance <= attractionDistance
      && candidate.x >= 0
      && candidate.y >= 0
      && candidate.x + source.w <= cols
      && candidate.y + source.h <= maxRows
    ))
    .filter((candidate) => {
      const snapped = { ...source, x: candidate.x, y: candidate.y };
      return anchors.every((anchor) => !layoutItemsCollide(snapped, anchor));
    })
    .sort((left, right) => (
      left.distance - right.distance
      || right.contact - left.contact
      || left.anchorOrder - right.anchorOrder
      || left.sideOrder - right.sideOrder
    ))[0];

  if (!best || (best.x === source.x && best.y === source.y)) {
    return layout.map((item) => ({ ...item })) as T[];
  }

  return layout.map((item) => (
    item.i === itemId ? { ...item, x: best.x, y: best.y } : { ...item }
  )) as T[];
}

export function createBoundedDashboardCompactor(maxRows = 13): Compactor {
  let lastValidLayout: Layout = [];

  return {
    type: "vertical",
    allowOverlap: false,
    compact(layout: Layout, cols: number): Layout {
      const fitted = fitDashboardLayoutWithinBounds(layout, cols, maxRows);
      if (fitted) {
        lastValidLayout = fitted.map((item) => ({ ...item }));
        return fitted;
      }

      const currentIds = new Set(layout.map((item) => item.i));
      const canRestore = lastValidLayout.length === layout.length
        && lastValidLayout.every((item) => currentIds.has(item.i));

      return canRestore
        ? lastValidLayout.map((item) => ({ ...item }))
        : layout.map((item) => ({ ...item }));
    },
  };
}
