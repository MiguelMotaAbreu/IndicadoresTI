import test from "node:test";
import assert from "node:assert/strict";

import { decodeMappedNotionProperty } from "../app/lib/notion-value-normalizer.ts";

function decode(fieldKey, propertyType, property) {
  return decodeMappedNotionProperty(property, { fieldKey, propertyType });
}

test("normaliza datas nativas e separa vazio de data inválida", () => {
  assert.deepEqual(
    decode("ticket.openedAt", "date", { type: "date", date: { start: "2026-10-25T10:00:00-03:00" } }),
    { state: "valid", value: { kind: "date", value: "2026-10-25T10:00:00-03:00" } },
  );
  assert.deepEqual(
    decode("ticket.openedAt", "date", { type: "date", date: null }),
    { state: "missing" },
  );
  assert.deepEqual(
    decode("ticket.openedAt", "date", { type: "date", date: { start: "2026-02-31" } }),
    { state: "invalid", issue: "malformed" },
  );
  assert.deepEqual(
    decode("ticket.openedAt", "date", { type: "date", date: { start: "2026-02-31T10:00:00-03:00" } }),
    { state: "invalid", issue: "malformed" },
  );
});

test("valida o tipo produzido por fórmulas em vez de aceitar apenas a propriedade formula", () => {
  assert.deepEqual(
    decode("ticket.completedAt", "formula", {
      type: "formula",
      formula: { type: "date", date: { start: "2026-10-25T12:00:00-03:00" } },
    }),
    { state: "valid", value: { kind: "date", value: "2026-10-25T12:00:00-03:00" } },
  );
  assert.deepEqual(
    decode("ticket.completedAt", "formula", {
      type: "formula",
      formula: { type: "string", string: "25/10/2026" },
    }),
    { state: "invalid", issue: "semantic_mismatch" },
  );
  assert.deepEqual(
    decode("ticket.completedAt", "formula", {
      type: "formula",
      formula: { type: "unsupported", unsupported: {} },
    }),
    { state: "invalid", issue: "unsupported" },
  );
});

test("aceita somente resultado numérico utilizável para minutos em expediente", () => {
  assert.deepEqual(
    decode("history.businessMinutes", "rollup", {
      type: "rollup",
      rollup: { type: "number", number: 37, function: "sum" },
    }),
    { state: "valid", value: { kind: "number", value: 37 } },
  );
  assert.deepEqual(
    decode("history.businessMinutes", "rollup", {
      type: "rollup",
      rollup: { type: "incomplete", incomplete: {} },
    }),
    { state: "invalid", issue: "unsupported" },
  );
  assert.deepEqual(
    decode("history.businessMinutes", "formula", {
      type: "formula",
      formula: { type: "string", string: "37 minutos" },
    }),
    { state: "invalid", issue: "semantic_mismatch" },
  );
});

test("preserva false, categorias múltiplas e metadado de relação truncada", () => {
  assert.deepEqual(
    decode("ticket.outsideHours", "checkbox", { type: "checkbox", checkbox: false }),
    { state: "valid", value: { kind: "boolean", value: false } },
  );
  assert.deepEqual(
    decode("ticket.reason", "multi_select", {
      type: "multi_select",
      multi_select: [{ name: "Impressora" }, { name: "Rede" }],
    }),
    { state: "valid", value: { kind: "text_list", value: ["Impressora", "Rede"] } },
  );
  assert.deepEqual(
    decode("history.ticketRelation", "relation", {
      type: "relation",
      relation: [{ id: "ticket-one" }],
      has_more: true,
    }),
    { state: "valid", value: { kind: "ids", value: ["ticket-one"], truncated: true } },
  );
});

test("recusa tipo de resposta divergente do esquema salvo", () => {
  assert.deepEqual(
    decode("ticket.priority", "select", { type: "status", status: { name: "Alta" } }),
    { state: "invalid", issue: "malformed" },
  );
});
