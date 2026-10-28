import test from "node:test";
import assert from "node:assert/strict";

import { normalizeNotionRecords } from "../app/lib/notion-record-transformer.ts";

const metadata = {
  updatedBy: { userId: "admin", displayName: "Administrador" },
  updatedAt: "2026-10-26T10:00:00.000Z",
};

const mappings = [
  { fieldKey: "ticket.openedAt", source: "tickets", propertyId: "opened", propertyName: "Abertura", propertyType: "date", ...metadata },
  { fieldKey: "ticket.openingTime", source: "tickets", propertyId: "opening-time", propertyName: "Hora - Abertura", propertyType: "rich_text", ...metadata },
  { fieldKey: "ticket.reason", source: "tickets", propertyId: "reason", propertyName: "Motivo", propertyType: "select", ...metadata },
  { fieldKey: "history.eventType", source: "history", propertyId: "event", propertyName: "Evento", propertyType: "title", ...metadata },
];

test("transforma somente propriedades mapeadas e não carrega texto livre", () => {
  const records = normalizeNotionRecords([{
    id: "ticket-page",
    properties: {
      Abertura: { id: "opened", type: "date", date: { start: "2026-10-26T10:00:00-03:00" } },
      Motivo: { id: "reason", type: "select", select: { name: "Impressora" } },
      Descrição: { id: "description", type: "rich_text", rich_text: [{ plain_text: "Conteúdo sensível" }] },
    },
  }], mappings, "tickets");

  assert.equal(records.length, 1);
  assert.equal(records[0].pageId, "ticket-page");
  assert.deepEqual(records[0].fields["ticket.openedAt"], {
    state: "valid",
    value: { kind: "date", value: "2026-10-26T10:00:00-03:00" },
  });
  assert.deepEqual(records[0].fields["ticket.reason"], {
    state: "valid",
    value: { kind: "text", value: "Impressora" },
  });
  assert.equal(JSON.stringify(records).includes("Conteúdo sensível"), false);
  assert.equal("history.eventType" in records[0].fields, false);
});

test("preserva o estado inválido no registro canônico sem copiar o valor bruto", () => {
  const records = normalizeNotionRecords([{
    id: "invalid-ticket",
    properties: {
      Abertura: { id: "opened", type: "date", date: { start: "data impossível" } },
      Motivo: { id: "reason", type: "select", select: null },
    },
  }], mappings, "tickets");

  assert.deepEqual(records[0].fields["ticket.openedAt"], { state: "invalid", issue: "malformed" });
  assert.deepEqual(records[0].fields["ticket.reason"], { state: "missing" });
  assert.equal(JSON.stringify(records).includes("data impossível"), false);
});

test("combina Data - Abertura e Hora - Abertura antes de publicar o registro canônico", () => {
  const records = normalizeNotionRecords([{
    id: "composed-ticket",
    properties: {
      Abertura: { id: "opened", type: "date", date: { start: "2026-10-27" } },
      "Hora - Abertura": { id: "opening-time", type: "rich_text", rich_text: [{ plain_text: "10:35" }] },
      Motivo: { id: "reason", type: "select", select: { name: "Impressora" } },
    },
  }], mappings, "tickets");

  assert.deepEqual(records[0].fields["ticket.openedAt"], {
    state: "valid",
    value: { kind: "date", value: "2026-10-27T13:35:00.000Z" },
  });
  assert.deepEqual(records[0].fields["ticket.openingTime"], {
    state: "valid",
    value: { kind: "text", value: "10:35" },
  });
});

test("mantém a data e sinaliza uma hora textual inválida sem guardar o conteúdo bruto", () => {
  const records = normalizeNotionRecords([{
    id: "invalid-clock-ticket",
    properties: {
      Abertura: { id: "opened", type: "date", date: { start: "2026-10-27" } },
      "Hora - Abertura": { id: "opening-time", type: "rich_text", rich_text: [{ plain_text: "horário inválido" }] },
      Motivo: { id: "reason", type: "select", select: { name: "Impressora" } },
    },
  }], mappings, "tickets");

  assert.deepEqual(records[0].fields["ticket.openedAt"], {
    state: "valid",
    value: { kind: "date", value: "2026-10-27" },
  });
  assert.deepEqual(records[0].fields["ticket.openingTime"], { state: "invalid", issue: "malformed" });
  assert.equal(JSON.stringify(records).includes("horário inválido"), false);
});
