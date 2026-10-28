import test from "node:test";
import assert from "node:assert/strict";

import {
  createOverviewCsvExport,
  MAX_OVERVIEW_CSV_ROWS,
  OverviewCsvExportLimitError,
} from "../app/lib/overview-export.ts";

function valid(kind, value) {
  return { state: "valid", value: { kind, value } };
}

function ticket(pageId, requester = "Maria da Silva") {
  return {
    source: "tickets",
    pageId,
    fields: {
      "ticket.externalCode": valid("text", "=HYPERLINK(\"https://example.invalid\")"),
      "ticket.requester": valid("text", requester),
      "ticket.requesterEmail": valid("text", "segredo@example.invalid"),
      "ticket.openedAt": valid("date", "2026-10-27T14:30:00-03:00"),
      "ticket.sector": valid("text", "Recepção; classificação"),
      "ticket.priority": valid("text", "Alta"),
      "ticket.status": valid("text", "Concluído"),
      "ticket.reason": valid("text", "Impressora \"principal\""),
    },
  };
}

const snapshot = {
  id: "snapshot-export",
  status: "published",
  ticketCount: 1,
  eventCount: 0,
  warningCount: 0,
  createdAt: "2026-10-27T17:00:00.000Z",
  publishedAt: "2026-10-27T17:00:00.000Z",
};
const filters = { period: "all", sector: null, priority: null, status: null, reason: null };

test("gera CSV compatível com pt-BR sem expor IDs, emails ou fórmulas executáveis", () => {
  const exported = createOverviewCsvExport(
    snapshot,
    { tickets: [ticket("notion-private-id")] },
    filters,
    "administrador",
    new Date("2026-10-27T18:05:00.000Z"),
  );

  assert.equal(exported.filename, "pulseti-visao-geral_2026-10-27_15-05.csv");
  assert.equal(exported.rowCount, 1);
  assert.equal(exported.requesterMasked, false);
  assert.match(exported.contents, /^\uFEFF"Chamado";"Solicitante"/);
  assert.match(exported.contents, /"'=HYPERLINK\(""https:\/\/example\.invalid""\)"/);
  assert.match(exported.contents, /"Recepção; classificação"/);
  assert.match(exported.contents, /"Impressora ""principal"""/);
  assert.equal(exported.contents.includes("notion-private-id"), false);
  assert.equal(exported.contents.includes("segredo@example.invalid"), false);
});

test("mantém solicitantes mascarados no CSV do perfil Analista", () => {
  const exported = createOverviewCsvExport(
    snapshot,
    { tickets: [ticket("ticket-one", "João Souza")] },
    filters,
    "analista",
  );

  assert.equal(exported.requesterMasked, true);
  assert.match(exported.contents, /"Solicitante protegido"/);
  assert.equal(exported.contents.includes("João Souza"), false);
});

test("recusa exportação acima do limite seguro de linhas", () => {
  const tickets = Array.from({ length: MAX_OVERVIEW_CSV_ROWS + 1 }, (_, index) => ({
    source: "tickets",
    pageId: `ticket-${index}`,
    fields: {},
  }));

  assert.throws(
    () => createOverviewCsvExport(snapshot, { tickets }, filters, "analista"),
    OverviewCsvExportLimitError,
  );
});
