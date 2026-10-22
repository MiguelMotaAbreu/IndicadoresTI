import test from "node:test";
import assert from "node:assert/strict";
import {
  cloneDashboardDraft,
  createDefaultDashboardDraft,
  dashboardDraftStorageKey,
  dashboardDraftsEqual,
  parseDashboardDraft,
  serializeDashboardDraft,
} from "../app/lib/dashboard-drafts.ts";

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
  snapshot.layout.push({ i: customWidget.id, x: 8, y: 2, w: 4, h: 4 });
  snapshot.customWidgets.push(customWidget);
  snapshot.savedAt = "2026-10-22T15:00:00.000Z";

  const restored = parseDashboardDraft(serializeDashboardDraft(snapshot), "overview", defaultLayout);

  assert.ok(restored);
  assert.equal(restored.customWidgets[0].title, "Índice de carga");
  assert.equal(restored.layout[2].i, customWidget.id);
});

test("não carrega rascunho pertencente a outro painel", () => {
  const snapshot = createDefaultDashboardDraft("overview", defaultLayout);
  const restored = parseDashboardDraft(serializeDashboardDraft(snapshot), "demand", defaultLayout);

  assert.equal(restored, null);
  assert.notEqual(dashboardDraftStorageKey("overview"), dashboardDraftStorageKey("demand"));
});

test("rejeita layout incompleto ou adulterado", () => {
  const snapshot = createDefaultDashboardDraft("overview", defaultLayout);
  snapshot.layout.pop();

  assert.equal(parseDashboardDraft(serializeDashboardDraft(snapshot), "overview", defaultLayout), null);
});

test("mudança de data de salvamento não marca o conteúdo como alterado", () => {
  const left = createDefaultDashboardDraft("overview", defaultLayout);
  const right = createDefaultDashboardDraft("overview", defaultLayout);
  right.savedAt = "2026-10-22T15:00:00.000Z";

  assert.equal(dashboardDraftsEqual(left, right), true);
  right.layout[0].x = 2;
  assert.equal(dashboardDraftsEqual(left, right), false);
});

test("remoção altera somente o rascunho atual até que seja salvo", () => {
  const saved = createDefaultDashboardDraft("overview", defaultLayout);
  saved.layout.push({ i: customWidget.id, x: 8, y: 2, w: 4, h: 4 });
  saved.customWidgets.push(customWidget);
  const current = cloneDashboardDraft(saved);

  current.customWidgets = current.customWidgets.filter((widget) => widget.id !== customWidget.id);
  current.layout = current.layout.filter((item) => item.i !== customWidget.id);

  assert.equal(current.customWidgets.length, 0);
  assert.equal(saved.customWidgets.length, 1);
  assert.equal(dashboardDraftsEqual(current, saved), false);
  assert.equal(dashboardDraftsEqual(cloneDashboardDraft(saved), saved), true);
});
