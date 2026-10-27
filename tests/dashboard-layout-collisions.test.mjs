import test from "node:test";
import assert from "node:assert/strict";

import {
  createBoundedDashboardCompactor,
  dashboardLayoutFitsBounds,
  fitDashboardLayoutWithinBounds,
  layoutItemsCollide,
  magnetizeDashboardItem,
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

test("atrai o bloco para a borda livre mais próxima dentro de uma célula", () => {
  const source = [
    { i: "anchor", x: 0, y: 0, w: 4, h: 3 },
    { i: "dragged", x: 5, y: 1, w: 3, h: 2 },
  ];

  const magnetized = magnetizeDashboardItem(source, "dragged");

  assert.deepEqual(magnetized.find((item) => item.i === "dragged"), {
    i: "dragged", x: 4, y: 1, w: 3, h: 2,
  });
  assert.equal(layoutItemsCollide(magnetized[0], magnetized[1]), false);
  assert.deepEqual(source[1], { i: "dragged", x: 5, y: 1, w: 3, h: 2 });
});

test("preserva a vontade do usuário quando o espaço supera a atração", () => {
  const source = [
    { i: "anchor", x: 0, y: 0, w: 4, h: 3 },
    { i: "dragged", x: 6, y: 1, w: 3, h: 2 },
  ];

  assert.deepEqual(magnetizeDashboardItem(source, "dragged"), source);
});

test("não encaixa quando a posição magnética está ocupada", () => {
  const source = [
    { i: "anchor", x: 0, y: 0, w: 4, h: 3 },
    { i: "blocker", x: 4, y: 0, w: 1, h: 3 },
    { i: "dragged", x: 5, y: 1, w: 3, h: 2 },
  ];

  assert.deepEqual(magnetizeDashboardItem(source, "dragged"), source);
});

test("encaixa verticalmente sem alterar o eixo escolhido pelo usuário", () => {
  const source = [
    { i: "anchor", x: 3, y: 0, w: 5, h: 3 },
    { i: "dragged", x: 5, y: 4, w: 3, h: 2 },
  ];

  const magnetized = magnetizeDashboardItem(source, "dragged");
  assert.deepEqual(magnetized.find((item) => item.i === "dragged"), {
    i: "dragged", x: 5, y: 3, w: 3, h: 2,
  });
});

test("rejeita layouts que ultrapassam a página ou mantêm sobreposição", () => {
  assert.equal(dashboardLayoutFitsBounds([
    { i: "inside", x: 0, y: 11, w: 6, h: 2 },
    { i: "beside", x: 6, y: 11, w: 6, h: 2 },
  ]), true);
  assert.equal(dashboardLayoutFitsBounds([
    { i: "outside", x: 0, y: 12, w: 6, h: 2 },
  ]), false);
  assert.equal(dashboardLayoutFitsBounds([
    { i: "one", x: 0, y: 0, w: 6, h: 2 },
    { i: "two", x: 5, y: 1, w: 6, h: 2 },
  ]), false);
});

test("reposiciona uma cadeia empurrada sem deixar blocos abaixo do limite", () => {
  const source = [
    { i: "dragged", x: 0, y: 4, w: 12, h: 4, moved: true },
    { i: "middle", x: 0, y: 6, w: 12, h: 4 },
    { i: "bottom", x: 0, y: 10, w: 12, h: 3 },
  ];

  const fitted = fitDashboardLayoutWithinBounds(source, 12, 13);

  assert.ok(fitted);
  assert.equal(dashboardLayoutFitsBounds(fitted, 12, 13), true);
  assert.deepEqual(fitted.find((item) => item.i === "dragged"), source[0]);
  assert.equal(Math.max(...fitted.map((item) => item.y + item.h)), 12);
});

test("informa quando a cadeia não cabe fisicamente na página", () => {
  assert.equal(fitDashboardLayoutWithinBounds([
    { i: "one", x: 0, y: 0, w: 12, h: 7 },
    { i: "two", x: 0, y: 6, w: 12, h: 7 },
  ], 12, 13), null);
});

test("compactador limitado restaura o último layout válido quando um redimensionamento excede a página", () => {
  const compactor = createBoundedDashboardCompactor(13);
  const valid = [
    { i: "one", x: 0, y: 0, w: 12, h: 6 },
    { i: "two", x: 0, y: 6, w: 12, h: 7 },
  ];
  const impossible = [
    { i: "one", x: 0, y: 0, w: 12, h: 8, moved: true },
    { i: "two", x: 0, y: 6, w: 12, h: 7 },
  ];

  assert.deepEqual(compactor.compact(valid, 12), valid);
  const restored = compactor.compact(impossible, 12);
  assert.deepEqual(restored, valid);
  assert.equal(dashboardLayoutFitsBounds(restored, 12, 13), true);
});
