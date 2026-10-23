import type { Compactor, Layout } from "react-grid-layout";

export type GridRectangle = {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
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

export const collisionSafeFreeCompactor: Compactor = {
  type: "vertical",
  allowOverlap: false,
  compact(layout: Layout): Layout {
    return resolveDashboardLayoutCollisions(layout);
  },
};
