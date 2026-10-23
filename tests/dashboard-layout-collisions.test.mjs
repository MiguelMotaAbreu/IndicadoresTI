import test from "node:test";
import assert from "node:assert/strict";

import {
  layoutItemsCollide,
  resolveDashboardLayoutCollisions,
} from "../app/lib/dashboard-layout-collisions.ts";

test("propaga colisões verticais por toda a cadeia sem sobrepor cartões", () => {
  const source = [
    { i: "top", x: 0, y: 0, w: 6, h: 3 },
    { i: "middle", x: 0, y: 2, w: 6, h: 3 },
    { i: "bottom", x: 0, y: 4, w: 6, h: 3 },
  ];

  const resolved = resolveDashboardLayoutCollisions(source);

  assert.deepEqual(resolved.map(({ i, y }) => ({ i, y })), [
    { i: "top", y: 0 },
    { i: "middle", y: 3 },
    { i: "bottom", y: 6 },
  ]);
  assert.equal(resolved.some((item, index) => resolved.slice(index + 1).some((other) => layoutItemsCollide(item, other))), false);
  assert.deepEqual(source.map(({ i, y }) => ({ i, y })), [
    { i: "top", y: 0 },
    { i: "middle", y: 2 },
    { i: "bottom", y: 4 },
  ]);
});

test("preserva espaços livres e cartões posicionados em colunas independentes", () => {
  const source = [
    { i: "left", x: 0, y: 0, w: 5, h: 3 },
    { i: "right", x: 7, y: 1, w: 5, h: 3 },
    { i: "lower", x: 0, y: 12, w: 12, h: 4 },
  ];

  assert.deepEqual(resolveDashboardLayoutCollisions(source), source);
});
