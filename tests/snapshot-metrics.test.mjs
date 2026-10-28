import test from "node:test";
import assert from "node:assert/strict";

import { dataFields } from "../app/mock-data.ts";
import { previewSnapshotMetricDefinition, SnapshotMetricEvaluationError } from "../app/lib/snapshot-metrics.ts";

function valid(kind, value) {
  return { state: "valid", value: { kind, value } };
}

const dataset = {
  tickets: [
    {
      source: "tickets",
      pageId: "ticket-1",
      fields: {
        "ticket.openedAt": valid("date", "2026-10-20T10:00:00-03:00"),
        "ticket.startedAt": valid("date", "2026-10-20T10:30:00-03:00"),
        "ticket.sector": valid("text", "Farmácia"),
        "ticket.priority": valid("text", "Média"),
        "ticket.status": valid("text", "Concluído"),
      },
    },
    {
      source: "tickets",
      pageId: "ticket-2",
      fields: {
        "ticket.openedAt": valid("date", "2026-10-21T10:00:00-03:00"),
        "ticket.sector": valid("text", "Recepção"),
        "ticket.priority": valid("text", "Alta"),
        "ticket.status": valid("text", "Não iniciado"),
      },
    },
  ],
  history: [
    { source: "history", pageId: "event-1", fields: { "history.eventType": valid("text", "Início"), "history.ticketRelation": valid("ids", ["ticket-1"]) } },
    { source: "history", pageId: "event-2", fields: { "history.eventType": valid("text", "Conclusão"), "history.ticketRelation": valid("ids", ["ticket-1"]) } },
    { source: "history", pageId: "event-3", fields: { "history.eventType": valid("text", "Retomar"), "history.ticketRelation": valid("ids", ["ticket-2"]) } },
  ],
};

function definition(overrides = {}) {
  return {
    name: "Índice real de carga",
    description: "Chamados multiplicados por eventos e normalizados.",
    expression: {
      kind: "operação",
      operation: "multiplicar",
      left: { kind: "agregação", operation: "contagem", input: { kind: "campo", fieldId: "ticket-count" } },
      right: { kind: "agregação", operation: "contagem", input: { kind: "campo", fieldId: "event-count" } },
    },
    dimensionFieldId: null,
    visualization: "Cartão numérico",
    coverageThreshold: 80,
    nullPolicy: "ignorar",
    ...overrides,
  };
}

test("calcula a prévia com os registros reais do snapshot", () => {
  const preview = previewSnapshotMetricDefinition(definition(), dataFields, dataset);

  assert.equal(preview.rawValue, 6);
  assert.equal(preview.formattedValue, "6");
  assert.equal(preview.sampleSize, 2);
  assert.equal(preview.coverage, 100);
});

test("aplica os filtros compartilhados somente à população de chamados", () => {
  const preview = previewSnapshotMetricDefinition(
    definition(),
    dataFields,
    dataset,
    { period: "all", sector: "Farmácia", priority: null, status: null, reason: null },
  );

  assert.equal(preview.rawValue, 2);
  assert.equal(preview.sampleSize, 1);
});

test("calcula cobertura real e respeita a política de nulos", () => {
  const metric = definition({
    expression: {
      kind: "operação",
      operation: "dividir",
      left: { kind: "agregação", operation: "mediana", input: { kind: "campo", fieldId: "first-response" } },
      right: { kind: "agregação", operation: "contagem", input: { kind: "campo", fieldId: "ticket-count" } },
    },
  });
  const preview = previewSnapshotMetricDefinition(metric, dataFields, dataset);

  assert.equal(preview.rawValue, 15);
  assert.equal(preview.coverage, 50);
  assert.equal(preview.sampleSize, 1);
  assert.ok(preview.warnings.some((warning) => warning.code === "cobertura_abaixo_do_limiar"));
  assert.throws(
    () => previewSnapshotMetricDefinition({ ...metric, nullPolicy: "invalidar" }, dataFields, dataset),
    SnapshotMetricEvaluationError,
  );
});
