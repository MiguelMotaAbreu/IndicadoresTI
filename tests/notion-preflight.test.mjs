import test from "node:test";
import assert from "node:assert/strict";

import { NotionPreflightError, runNotionPreflight } from "../app/lib/notion-preflight.ts";

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

function historyPage(id, ticketIds, overrides = {}) {
  return {
    id,
    properties: {
      Evento: { id: "event", type: "title", title: [{ plain_text: "Início" }] },
      Chamado: {
        id: "ticket-relation",
        type: "relation",
        relation: ticketIds.map((ticketId) => ({ id: ticketId })),
        has_more: false,
      },
      "Data e hora": { id: "occurred", type: "date", date: { start: "2026-10-25T11:00:00-03:00", end: null, time_zone: null } },
      ...overrides,
    },
  };
}

function clientFor({ tickets = [], history = [], ticketRequests = 2, historyRequests = 1 } = {}) {
  return {
    async loadSchema() { return schemas; },
    async queryDataSource(dataSourceId, propertyIds) {
      if (dataSourceId === "tickets-source") {
        assert.equal(propertyIds.includes("requester"), true);
        assert.equal(propertyIds.includes("ticket-relation"), false);
        return { pages: tickets, requestCount: ticketRequests };
      }
      assert.equal(dataSourceId, "history-source");
      assert.equal(propertyIds.includes("ticket-relation"), true);
      assert.equal(propertyIds.includes("requester"), false);
      return { pages: history, requestCount: historyRequests };
    },
  };
}

test("mantém chamado sem código elegível e mede os vínculos sem expor valores ou IDs", async () => {
  const result = await runNotionPreflight(
    clientFor({
      tickets: [ticketPage("ticket-one"), ticketPage("ticket-two")],
      history: [historyPage("event-one", ["ticket-one"])],
    }),
    mappings,
    () => new Date("2026-10-26T12:00:00.000Z"),
  );

  assert.equal(result.checkedAt, "2026-10-26T12:00:00.000Z");
  assert.equal(result.requestCount, 3);
  assert.equal(result.tickets.eligibleRecords, 2);
  assert.equal(result.history.eligibleRecords, 1);
  assert.equal(result.warningCount, 0);
  assert.equal(result.tickets.fields.find((field) => field.fieldKey === "ticket.externalCode").coveragePercent, 0);
  assert.equal(result.relationship.linkedEvents, 1);
  assert.equal(result.relationship.distinctLinkedTickets, 1);
  assert.equal(result.relationship.eventCoveragePercent, 100);
  assert.equal(result.relationship.ticketCoveragePercent, 50);
  assert.equal(JSON.stringify(result).includes("Solicitante protegido"), false);
  assert.equal(JSON.stringify(result).includes("ticket-one"), false);
  assert.equal(JSON.stringify(result).includes("event-one"), false);
});

test("separa vínculo ausente, órfão e ambíguo e evita contagem dupla do campo obrigatório", async () => {
  const result = await runNotionPreflight(clientFor({
    tickets: [ticketPage("ticket-one")],
    history: [
      historyPage("linked", ["ticket-one"]),
      historyPage("missing", []),
      historyPage("orphan", ["unknown-ticket"]),
      historyPage("ambiguous", ["ticket-one", "unknown-ticket"]),
    ],
  }), mappings);

  assert.deepEqual(result.relationship, {
    linkedEvents: 1,
    missingRelationEvents: 1,
    orphanEvents: 1,
    ambiguousEvents: 1,
    unlinkedEvents: 3,
    distinctLinkedTickets: 1,
    eventCoveragePercent: 25,
    ticketCoveragePercent: 100,
  });
  assert.equal(result.history.fields.find((field) => field.fieldKey === "history.ticketRelation").missingCount, 1);
  assert.equal(result.history.warningCount, 1);
  assert.equal(result.warningCount, 3);
});

test("trata relação truncada como ambígua em vez de assumir um chamado incorreto", async () => {
  const result = await runNotionPreflight(clientFor({
    tickets: [ticketPage("ticket-one")],
    history: [historyPage("truncated", ["ticket-one"], {
      Chamado: { id: "ticket-relation", type: "relation", relation: [{ id: "ticket-one" }], has_more: true },
    })],
  }), mappings);

  assert.equal(result.relationship.linkedEvents, 0);
  assert.equal(result.relationship.ambiguousEvents, 1);
  assert.equal(result.warningCount, 1);
});

test("contabiliza duplicidades e ausências obrigatórias em cada fonte", async () => {
  const result = await runNotionPreflight(clientFor({
    tickets: [
      ticketPage("page-one"),
      ticketPage("page-one"),
      ticketPage("page-two", { Status: { id: "status", type: "status", status: null } }),
    ],
    history: [historyPage("event-one", ["page-one"]), historyPage("event-one", ["page-one"])],
  }), mappings);

  assert.equal(result.tickets.pagesRead, 3);
  assert.equal(result.tickets.eligibleRecords, 2);
  assert.equal(result.tickets.rejectedRecords, 1);
  assert.equal(result.tickets.warningCount, 2);
  assert.equal(result.history.rejectedRecords, 1);
  assert.equal(result.history.warningCount, 1);
  assert.equal(result.warningCount, 3);
});

test("bloqueia pré-validação com mapeamento incompleto ou esquema alterado", async () => {
  await assert.rejects(
    () => runNotionPreflight(clientFor(), []),
    (error) => error instanceof NotionPreflightError && error.code === "mapping_incomplete",
  );

  await assert.rejects(
    () => runNotionPreflight(clientFor(), mappings.map((mapping) => (
      mapping.fieldKey === "ticket.status" ? { ...mapping, propertyId: "removed-status" } : mapping
    ))),
    (error) => error instanceof NotionPreflightError && error.code === "mapping_outdated",
  );
});
