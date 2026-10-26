import test from "node:test";
import assert from "node:assert/strict";

import { NotionPreflightError, runTicketPreflight } from "../app/lib/notion-preflight.ts";

const schemas = [
  {
    key: "tickets",
    label: "Base de chamados",
    name: "Chamados",
    dataSourceId: "tickets-source",
    properties: [
      { id: "code", name: "Código", type: "rich_text" },
      { id: "opened", name: "Abertura", type: "date" },
      { id: "requester", name: "Solicitante", type: "title" },
      { id: "reason", name: "Motivo", type: "select" },
      { id: "priority", name: "Prioridade", type: "select" },
      { id: "sector", name: "Setor", type: "select" },
      { id: "status", name: "Status", type: "status" },
    ],
  },
  {
    key: "history",
    label: "Base de histórico",
    name: "Histórico",
    dataSourceId: "history-source",
    properties: [
      { id: "event", name: "Evento", type: "title" },
      { id: "ticket-relation", name: "Chamado", type: "relation" },
      { id: "occurred", name: "Data e hora", type: "date" },
    ],
  },
];

const mappingMetadata = {
  updatedBy: { userId: "admin", displayName: "Administrador" },
  updatedAt: "2026-10-26T10:00:00.000Z",
};

const mappings = [
  { fieldKey: "ticket.externalCode", source: "tickets", propertyId: "code", propertyName: "Código", propertyType: "rich_text", ...mappingMetadata },
  { fieldKey: "ticket.openedAt", source: "tickets", propertyId: "opened", propertyName: "Abertura", propertyType: "date", ...mappingMetadata },
  { fieldKey: "ticket.requester", source: "tickets", propertyId: "requester", propertyName: "Solicitante", propertyType: "title", ...mappingMetadata },
  { fieldKey: "ticket.reason", source: "tickets", propertyId: "reason", propertyName: "Motivo", propertyType: "select", ...mappingMetadata },
  { fieldKey: "ticket.priority", source: "tickets", propertyId: "priority", propertyName: "Prioridade", propertyType: "select", ...mappingMetadata },
  { fieldKey: "ticket.sector", source: "tickets", propertyId: "sector", propertyName: "Setor", propertyType: "select", ...mappingMetadata },
  { fieldKey: "ticket.status", source: "tickets", propertyId: "status", propertyName: "Status", propertyType: "status", ...mappingMetadata },
  { fieldKey: "history.eventType", source: "history", propertyId: "event", propertyName: "Evento", propertyType: "title", ...mappingMetadata },
  { fieldKey: "history.ticketRelation", source: "history", propertyId: "ticket-relation", propertyName: "Chamado", propertyType: "relation", ...mappingMetadata },
  { fieldKey: "history.occurredAt", source: "history", propertyId: "occurred", propertyName: "Data e hora", propertyType: "date", ...mappingMetadata },
];

function ticketPage(id, overrides = {}) {
  return {
    id,
    properties: {
      Código: { id: "code", type: "rich_text", rich_text: [] },
      Abertura: { id: "opened", type: "date", date: { start: "2026-10-25T10:00:00-03:00", end: null, time_zone: null } },
      Solicitante: { id: "requester", type: "title", title: [{ plain_text: "Solicitante protegido" }] },
      Motivo: { id: "reason", type: "select", select: { name: "Impressora" } },
      Prioridade: { id: "priority", type: "select", select: { name: "Média" } },
      Setor: { id: "sector", type: "select", select: { name: "Recepção" } },
      Status: { id: "status", type: "status", status: { name: "Concluído" } },
      ...overrides,
    },
  };
}

function clientFor(pages) {
  return {
    async loadSchema() { return schemas; },
    async queryDataSource(dataSourceId, propertyIds) {
      assert.equal(dataSourceId, "tickets-source");
      assert.equal(propertyIds.includes("requester"), true);
      return { pages, requestCount: 2 };
    },
  };
}

test("mantém chamado sem código visível elegível e calcula cobertura sem expor valores", async () => {
  const result = await runTicketPreflight(
    clientFor([ticketPage("notion-page-id")]),
    mappings,
    () => new Date("2026-10-26T12:00:00.000Z"),
  );

  assert.equal(result.checkedAt, "2026-10-26T12:00:00.000Z");
  assert.equal(result.pagesRead, 1);
  assert.equal(result.eligibleRecords, 1);
  assert.equal(result.rejectedRecords, 0);
  assert.equal(result.warningCount, 0);
  assert.equal(result.fields.find((field) => field.fieldKey === "ticket.externalCode").coveragePercent, 0);
  assert.equal(result.fields.find((field) => field.fieldKey === "ticket.requester").coveragePercent, 100);
  assert.equal(JSON.stringify(result).includes("Solicitante protegido"), false);
  assert.equal(JSON.stringify(result).includes("notion-page-id"), false);
});

test("contabiliza duplicidade técnica e ausência obrigatória sem descartar outros chamados", async () => {
  const result = await runTicketPreflight(clientFor([
    ticketPage("page-one"),
    ticketPage("page-one"),
    ticketPage("page-two", { Status: { id: "status", type: "status", status: null } }),
  ]), mappings);

  assert.equal(result.pagesRead, 3);
  assert.equal(result.eligibleRecords, 2);
  assert.equal(result.rejectedRecords, 1);
  assert.equal(result.warningCount, 2);
  assert.equal(result.fields.find((field) => field.fieldKey === "ticket.status").missingCount, 1);
});

test("bloqueia pré-validação com mapeamento incompleto ou esquema alterado", async () => {
  await assert.rejects(
    () => runTicketPreflight(clientFor([]), []),
    (error) => error instanceof NotionPreflightError && error.code === "mapping_incomplete",
  );

  await assert.rejects(
    () => runTicketPreflight(clientFor([]), mappings.map((mapping) => (
      mapping.fieldKey === "ticket.status" ? { ...mapping, propertyId: "removed-status" } : mapping
    ))),
    (error) => error instanceof NotionPreflightError && error.code === "mapping_outdated",
  );
});
