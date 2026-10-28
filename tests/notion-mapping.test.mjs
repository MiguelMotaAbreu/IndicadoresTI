import test from "node:test";
import assert from "node:assert/strict";

import {
  NotionMappingError,
  validateNotionMapping,
} from "../app/lib/notion-mapping.ts";

const schemas = [
  {
    key: "tickets",
    label: "Base de chamados",
    name: "Chamados",
    dataSourceId: "tickets-source",
    properties: [
      { id: "ticket-title", name: "Solicitante", type: "title" },
      { id: "ticket-code", name: "Chamados T.I UPA ZONA LESTE", type: "rich_text" },
      { id: "ticket-opened", name: "Abertura", type: "date" },
      { id: "ticket-opening-time", name: "Hora - Abertura", type: "rich_text" },
      { id: "ticket-reason", name: "Motivo", type: "select" },
      { id: "ticket-priority", name: "Prioridade", type: "select" },
      { id: "ticket-sector", name: "Setor", type: "relation" },
      { id: "ticket-status", name: "Status", type: "status" },
      { id: "ticket-formula", name: "Classificação calculada", type: "formula" },
      { id: "ticket-number", name: "Número", type: "number" },
    ],
  },
  {
    key: "history",
    label: "Base de histórico",
    name: "Histórico",
    dataSourceId: "history-source",
    properties: [
      { id: "history-event", name: "Evento", type: "title" },
      { id: "history-ticket", name: "Chamado relacionado", type: "relation" },
      { id: "history-date", name: "Data e hora", type: "date" },
    ],
  },
];

const requiredSelection = {
  "ticket.openedAt": "Abertura",
  "ticket.reason": "Motivo",
  "ticket.priority": "Prioridade",
  "ticket.sector": "Setor",
  "ticket.status": "Status",
  "history.eventType": "Evento",
  "history.ticketRelation": "Chamado relacionado",
  "history.occurredAt": "Data e hora",
};

test("valida o contrato mínimo e resolve nomes para IDs somente no servidor", () => {
  const mappings = validateNotionMapping(requiredSelection, schemas);

  assert.equal(mappings.length, 8);
  assert.deepEqual(mappings.find((mapping) => mapping.fieldKey === "ticket.openedAt"), {
    fieldKey: "ticket.openedAt",
    source: "tickets",
    propertyId: "ticket-opened",
    propertyName: "Abertura",
    propertyType: "date",
  });
});

test("aceita solicitante como título e não exige código visível do chamado", () => {
  const mappings = validateNotionMapping({
    ...requiredSelection,
    "ticket.requester": "Solicitante",
  }, schemas);

  assert.equal(mappings.some((mapping) => mapping.fieldKey === "ticket.externalCode"), false);
  assert.deepEqual(mappings.find((mapping) => mapping.fieldKey === "ticket.requester"), {
    fieldKey: "ticket.requester",
    source: "tickets",
    propertyId: "ticket-title",
    propertyName: "Solicitante",
    propertyType: "title",
  });
});

test("aceita a hora textual como complemento opcional da data de abertura", () => {
  const mappings = validateNotionMapping({
    ...requiredSelection,
    "ticket.openingTime": "Hora - Abertura",
  }, schemas);

  assert.deepEqual(mappings.find((mapping) => mapping.fieldKey === "ticket.openingTime"), {
    fieldKey: "ticket.openingTime",
    source: "tickets",
    propertyId: "ticket-opening-time",
    propertyName: "Hora - Abertura",
    propertyType: "rich_text",
  });
});

test("lista todos os campos obrigatórios ausentes em uma única validação", () => {
  assert.throws(
    () => validateNotionMapping({}, schemas),
    (error) => {
      assert.equal(error instanceof NotionMappingError, true);
      assert.equal(error.issues.filter((issue) => issue.code === "required_field").length, 8);
      return true;
    },
  );
});

test("recusa tipo incompatível, campo desconhecido e propriedade inexistente", () => {
  assert.throws(
    () => validateNotionMapping({
      ...requiredSelection,
      "ticket.openedAt": "Número",
      "ticket.startedAt": "Campo removido",
      "campo.inventado": "Status",
    }, schemas),
    (error) => {
      assert.equal(error instanceof NotionMappingError, true);
      assert.deepEqual(
        new Set(error.issues.map((issue) => issue.code)),
        new Set(["unknown_field", "incompatible_type", "property_not_found"]),
      );
      return true;
    },
  );
});

test("impede reutilizar a mesma propriedade em dois campos internos", () => {
  assert.throws(
    () => validateNotionMapping({
      ...requiredSelection,
      "ticket.reason": "Classificação calculada",
      "ticket.priority": "Classificação calculada",
    }, schemas),
    (error) => {
      assert.equal(error instanceof NotionMappingError, true);
      assert.equal(error.issues.some((issue) => issue.code === "duplicate_property"), true);
      return true;
    },
  );
});
