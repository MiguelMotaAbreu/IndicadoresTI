import test from "node:test";
import assert from "node:assert/strict";
import {
  cloneDashboardDraft,
  createDefaultDashboardDraft,
  dashboardDraftStorageKey,
  dashboardDraftsEqual,
  dashboardPageLayoutsEqual,
  parseDashboardDraft,
  serializeDashboardDraft,
} from "../app/lib/dashboard-drafts.ts";

test("trata layouts geometricamente idênticos como a mesma atualização", () => {
  const left = [
    { i: "one", x: 0, y: 0, w: 6, h: 3, minW: 2 },
    { i: "two", x: 6, y: 0, w: 6, h: 3 },
  ];
  const clonedInAnotherOrder = [
    { ...left[1] },
    { ...left[0] },
  ];

  assert.equal(dashboardPageLayoutsEqual(left, clonedInAnotherOrder), true);
  assert.equal(dashboardPageLayoutsEqual(left, [
    { ...left[0], y: 1 },
    left[1],
  ]), false);
});

const defaultLayout = [
  { i: "metric-total", x: 0, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { i: "overview-demand", x: 0, y: 2, w: 8, h: 5, minW: 4, minH: 4 },
];

const customWidget = {
  id: "custom-123",
  title: "Índice de carga",
  visualization: "Cartão numérico",
  formula: "(Contagem(Quantidade de chamados) ÷ 30)",
  definition: {
    name: "Índice de carga",
    description: "Métrica de teste.",
    expression: {
      kind: "operação",
      operation: "dividir",
      left: { kind: "agregação", operation: "contagem", input: { kind: "campo", fieldId: "ticket-count" } },
      right: { kind: "constante", value: 30 },
    },
    dimensionFieldId: null,
    visualization: "Cartão numérico",
    coverageThreshold: 80,
    nullPolicy: "ignorar",
  },
  preview: {
    rawValue: 17.266,
    formattedValue: "17,27",
    coverage: 100,
    sampleSize: 518,
    formula: "(Contagem(Quantidade de chamados) ÷ 30)",
    inferredType: "número",
    warnings: [],
  },
};

test("serializa e recupera layout e métricas do painel correto", () => {
  const snapshot = createDefaultDashboardDraft("overview", defaultLayout);
  snapshot.pages[0].layout.push({ i: customWidget.id, x: 8, y: 2, w: 4, h: 4 });
  snapshot.customWidgets.push(customWidget);
  snapshot.savedAt = "2026-10-22T15:00:00.000Z";

  const restored = parseDashboardDraft(serializeDashboardDraft(snapshot), "overview", defaultLayout);

  assert.ok(restored);
  assert.equal(restored.customWidgets[0].title, "Índice de carga");
  assert.equal(restored.pages[0].layout[2].i, customWidget.id);
});

test("não carrega rascunho pertencente a outro painel", () => {
  const snapshot = createDefaultDashboardDraft("overview", defaultLayout);
  const restored = parseDashboardDraft(serializeDashboardDraft(snapshot), "demand", defaultLayout);

  assert.equal(restored, null);
  assert.notEqual(dashboardDraftStorageKey("overview"), dashboardDraftStorageKey("demand"));
});

test("rejeita layout incompleto ou adulterado", () => {
  const snapshot = createDefaultDashboardDraft("overview", defaultLayout);
  snapshot.pages[0].layout.pop();

  assert.equal(parseDashboardDraft(serializeDashboardDraft(snapshot), "overview", defaultLayout), null);
});

test("repara uma cadeia de sobreposições presente em rascunho antigo", () => {
  const snapshot = createDefaultDashboardDraft("overview", defaultLayout);
  snapshot.pages[0].layout[1].y = 1;

  const restored = parseDashboardDraft(serializeDashboardDraft(snapshot), "overview", defaultLayout);

  assert.ok(restored);
  assert.equal(restored.pages[0].layout[0].y, 0);
  assert.equal(restored.pages[0].layout[1].y, 2);
});

test("mudança de data de salvamento não marca o conteúdo como alterado", () => {
  const left = createDefaultDashboardDraft("overview", defaultLayout);
  const right = createDefaultDashboardDraft("overview", defaultLayout);
  right.savedAt = "2026-10-22T15:00:00.000Z";

  assert.equal(dashboardDraftsEqual(left, right), true);
  right.pages[0].layout[0].x = 2;
  assert.equal(dashboardDraftsEqual(left, right), false);
});

test("remoção altera somente o rascunho atual até que seja salvo", () => {
  const saved = createDefaultDashboardDraft("overview", defaultLayout);
  saved.pages[0].layout.push({ i: customWidget.id, x: 8, y: 2, w: 4, h: 4 });
  saved.customWidgets.push(customWidget);
  const current = cloneDashboardDraft(saved);

  current.customWidgets = current.customWidgets.filter((widget) => widget.id !== customWidget.id);
  current.pages[0].layout = current.pages[0].layout.filter((item) => item.i !== customWidget.id);

  assert.equal(current.customWidgets.length, 0);
  assert.equal(saved.customWidgets.length, 1);
  assert.equal(dashboardDraftsEqual(current, saved), false);
  assert.equal(dashboardDraftsEqual(cloneDashboardDraft(saved), saved), true);
});

test("edição substitui a definição sem alterar identidade ou posição", () => {
  const saved = createDefaultDashboardDraft("overview", defaultLayout);
  saved.pages[0].layout.push({ i: customWidget.id, x: 8, y: 2, w: 4, h: 4 });
  saved.customWidgets.push(customWidget);
  const current = cloneDashboardDraft(saved);
  const originalLayout = structuredClone(current.pages[0].layout);

  current.customWidgets = current.customWidgets.map((widget) => widget.id === customWidget.id ? {
    ...widget,
    title: "Índice revisado",
    definition: { ...widget.definition, name: "Índice revisado" },
  } : widget);

  assert.equal(current.customWidgets[0].id, customWidget.id);
  assert.equal(current.customWidgets[0].title, "Índice revisado");
  assert.equal(saved.customWidgets[0].title, "Índice de carga");
  assert.deepEqual(current.pages[0].layout, originalLayout);
  assert.equal(dashboardDraftsEqual(current, saved), false);
});

test("migra o rascunho de página única para Página 1 sem perder métricas", () => {
  const legacy = {
    schemaVersion: 1,
    dashboardKey: "overview",
    layout: [...defaultLayout, { i: customWidget.id, x: 8, y: 2, w: 4, h: 4 }],
    customWidgets: [customWidget],
    savedAt: "2026-10-22T15:00:00.000Z",
  };

  const restored = parseDashboardDraft(JSON.stringify(legacy), "overview", defaultLayout);

  assert.ok(restored);
  assert.equal(restored.schemaVersion, 2);
  assert.equal(restored.pages[0].name, "Página 1");
  assert.equal(restored.pages.flatMap((page) => page.layout).some((item) => item.i === customWidget.id), true);
});

test("aceita páginas vazias e rejeita blocos duplicados entre páginas", () => {
  const snapshot = createDefaultDashboardDraft("overview", defaultLayout);
  snapshot.pages.push({ id: "page-second", name: "Página 2", layout: [] });
  assert.ok(parseDashboardDraft(serializeDashboardDraft(snapshot), "overview", defaultLayout));

  snapshot.pages[1].layout.push({ ...snapshot.pages[0].layout[0] });
  assert.equal(parseDashboardDraft(serializeDashboardDraft(snapshot), "overview", defaultLayout), null);
});

test("mantém todos os blocos dentro do limite vertical da página", () => {
  const snapshot = createDefaultDashboardDraft("overview", defaultLayout);
  snapshot.pages[0].layout[1].y = 999;

  const restored = parseDashboardDraft(serializeDashboardDraft(snapshot), "overview", defaultLayout);

  assert.ok(restored);
  assert.ok(restored.pages[0].layout.every((item) => item.y >= 0 && item.y + item.h <= 13));
});
