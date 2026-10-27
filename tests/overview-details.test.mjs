import test from "node:test";
import assert from "node:assert/strict";

import { createOverviewDetails } from "../app/lib/overview-details.ts";
import { parseOverviewDetailsQuery, parseOverviewFilters } from "../app/lib/overview-query.ts";

function valid(kind, value, extra = {}) {
  return { state: "valid", value: { kind, value, ...extra } };
}

function ticket(pageId, fields) {
  return { source: "tickets", pageId, fields };
}

const snapshot = {
  id: "snapshot-details",
  status: "published",
  ticketCount: 3,
  eventCount: 0,
  warningCount: 0,
  createdAt: "2026-10-26T15:00:00.000Z",
  publishedAt: "2026-10-26T15:00:00.000Z",
};

const dataset = {
  tickets: [
    ticket("notion-private-one", {
      "ticket.externalCode": valid("text", "TKT-001"),
      "ticket.requester": valid("text", "Maria da Silva"),
      "ticket.requesterEmail": valid("text", "maria@example.invalid"),
      "ticket.openedAt": valid("date", "2026-10-03T10:00:00-03:00"),
      "ticket.sector": valid("text", "Recepção"),
      "ticket.priority": valid("text", "Alta"),
      "ticket.status": valid("text", "Concluído"),
      "ticket.reason": valid("text", "Impressora"),
    }),
    ticket("notion-private-two", {
      "ticket.requester": valid("text", "João Souza"),
      "ticket.openedAt": valid("date", "2026-10-02T10:00:00-03:00"),
      "ticket.sector": valid("text", "Farmácia"),
      "ticket.priority": valid("text", "Média"),
      "ticket.status": valid("text", "Aguardando informação"),
      "ticket.reason": valid("text_list", ["Computador", "Rede"]),
    }),
    ticket("notion-private-three", {
      "ticket.openedAt": valid("date", "2026-10-01T10:00:00-03:00"),
      "ticket.sector": valid("text", "Farmácia"),
      "ticket.priority": valid("text", "Média"),
      "ticket.status": valid("text", "Concluído"),
      "ticket.reason": valid("text", "Computador"),
    }),
  ],
};

const allFilters = { period: "all", sector: null, priority: null, status: null, reason: null };

test("pagina o mesmo recorte analítico e ordena pela abertura mais recente", () => {
  const firstPage = createOverviewDetails(snapshot, dataset, allFilters, "administrador", 1, 2);
  const secondPage = createOverviewDetails(snapshot, dataset, allFilters, "administrador", 2, 2);

  assert.deepEqual(firstPage.selection, {
    totalRecords: 3,
    page: 1,
    pageSize: 2,
    pageCount: 2,
    filters: allFilters,
  });
  assert.deepEqual(firstPage.rows.map((row) => row.code), ["TKT-001", "Sem código"]);
  assert.equal(secondPage.rows.length, 1);
  assert.equal(secondPage.rows[0].openedAt, "2026-10-01T10:00:00-03:00");
  assert.equal(new Set([...firstPage.rows, ...secondPage.rows].map((row) => row.rowKey)).size, 3);
});

test("aplica os filtros compartilhados e limita a resposta aos campos seguros", () => {
  const details = createOverviewDetails(
    snapshot,
    dataset,
    { ...allFilters, sector: "farmacia", priority: "média", reason: "computador" },
    "administrador",
    1,
    20,
  );

  assert.equal(details.selection.totalRecords, 2);
  assert.deepEqual(details.rows.map((row) => row.reason), ["Computador, Rede", "Computador"]);
  const serialized = JSON.stringify(details);
  assert.equal(serialized.includes("notion-private"), false);
  assert.equal(serialized.includes("maria@example.invalid"), false);
  assert.equal(serialized.includes("requesterEmail"), false);
});

test("mascara solicitantes para Analista e preserva identificação permitida para Administrador", () => {
  const analyst = createOverviewDetails(snapshot, dataset, allFilters, "analista", 1, 20);
  const administrator = createOverviewDetails(snapshot, dataset, allFilters, "administrador", 1, 20);

  assert.equal(analyst.privacy.requesterMasked, true);
  assert.deepEqual(analyst.rows.map((row) => row.requester), [
    "Solicitante protegido",
    "Solicitante protegido",
    "Não informado",
  ]);
  assert.equal(administrator.privacy.requesterMasked, false);
  assert.deepEqual(administrator.rows.map((row) => row.requester), [
    "Maria da Silva",
    "João Souza",
    "Não informado",
  ]);
});

test("valida filtros, repetição de parâmetros e limites de paginação", () => {
  assert.deepEqual(parseOverviewDetailsQuery(new URLSearchParams("period=last30&page=2&pageSize=50")), {
    filters: { period: "last30", sector: null, priority: null, status: null, reason: null },
    page: 2,
    pageSize: 50,
  });
  assert.equal(parseOverviewDetailsQuery(new URLSearchParams("page=0")), null);
  assert.equal(parseOverviewDetailsQuery(new URLSearchParams("pageSize=51")), null);
  assert.equal(parseOverviewDetailsQuery(new URLSearchParams("page=1&page=2")), null);
  assert.equal(parseOverviewFilters(new URLSearchParams("unknown=value")), null);
});
