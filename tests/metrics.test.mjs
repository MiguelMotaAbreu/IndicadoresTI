import test from "node:test";
import assert from "node:assert/strict";
import {
  decomposeMetricBuilderExpression,
  previewMetricDefinition,
  validateMetricDefinition,
} from "../app/lib/metrics.ts";

const fields = [
  { id: "ticket-count", label: "Quantidade de chamados", source: "Chamados", type: "número" },
  { id: "event-count", label: "Quantidade de movimentações", source: "Histórico", type: "número" },
  { id: "opened-at", label: "Data de abertura", source: "Chamados", type: "data" },
  { id: "sector", label: "Setor", source: "Chamados", type: "categoria" },
];

function definition(overrides = {}) {
  return {
    name: "Índice de carga operacional",
    description: "Relação entre chamados e movimentações.",
    expression: {
      kind: "operação",
      operation: "dividir",
      left: {
        kind: "operação",
        operation: "multiplicar",
        left: { kind: "agregação", operation: "contagem", input: { kind: "campo", fieldId: "ticket-count" } },
        right: { kind: "agregação", operation: "contagem", input: { kind: "campo", fieldId: "event-count" } },
      },
      right: { kind: "constante", value: 30 },
    },
    dimensionFieldId: null,
    visualization: "Cartão numérico",
    coverageThreshold: 80,
    nullPolicy: "ignorar",
    ...overrides,
  };
}

test("valida e executa uma AST segura sem texto executável", () => {
  const metric = definition();
  const validation = validateMetricDefinition(metric, fields);
  const preview = previewMetricDefinition(metric, fields);

  assert.equal(validation.valid, true);
  assert.equal(validation.nodeCount, 7);
  assert.deepEqual(validation.sources.sort(), ["Chamados", "Histórico"]);
  assert.equal(preview.rawValue, 1243.2);
  assert.equal(preview.coverage, 7.1);
  assert.equal(preview.sampleSize, 37);
  assert.ok(preview.warnings.some((warning) => warning.code === "cobertura_abaixo_do_limiar"));
});

test("bloqueia divisão por zero", () => {
  const metric = definition({
    expression: {
      kind: "operação",
      operation: "dividir",
      left: { kind: "agregação", operation: "contagem", input: { kind: "campo", fieldId: "ticket-count" } },
      right: { kind: "constante", value: 0 },
    },
  });
  const validation = validateMetricDefinition(metric, fields);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === "divisão_por_zero"));
});

test("exige dimensão temporal para linha", () => {
  const metric = definition({ visualization: "Linha temporal", dimensionFieldId: "sector" });
  const validation = validateMetricDefinition(metric, fields);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === "linha_sem_data"));
});

test("limita a expressão a dez nós", () => {
  let expression = { kind: "constante", value: 1 };
  for (let index = 0; index < 6; index += 1) {
    expression = { kind: "operação", operation: "somar", left: expression, right: { kind: "constante", value: 1 } };
  }
  const validation = validateMetricDefinition(definition({ expression }), fields);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === "expressão_complexa"));
});

test("decompõe uma AST existente para reabrir o construtor visual", () => {
  const parts = decomposeMetricBuilderExpression(definition().expression);

  assert.deepEqual(parts, {
    fieldAId: "ticket-count",
    fieldBId: "event-count",
    aggregationA: "contagem",
    aggregationB: "contagem",
    operator: "multiplicar",
    divisor: 30,
  });
  assert.equal(decomposeMetricBuilderExpression({ kind: "constante", value: 10 }), null);
});
