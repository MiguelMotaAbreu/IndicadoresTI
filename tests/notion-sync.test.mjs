import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AuditStore } from "../app/lib/audit-store.ts";
import { ApplicationDatabase } from "../app/lib/database.ts";
import { NotionClientError } from "../app/lib/notion-client.ts";
import { executeNotionSync } from "../app/lib/notion-sync.ts";
import { SyncStore } from "../app/lib/sync-store.ts";

const actor = { userId: "sync-admin", displayName: "Administrador Sync", role: "administrador" };
const mappingMetadata = {
  updatedBy: { userId: actor.userId, displayName: actor.displayName },
  updatedAt: "2026-10-26T10:00:00.000Z",
};
const mappings = [
  { fieldKey: "ticket.openedAt", source: "tickets", propertyId: "opened", propertyName: "Abertura", propertyType: "date", ...mappingMetadata },
  { fieldKey: "ticket.reason", source: "tickets", propertyId: "reason", propertyName: "Motivo", propertyType: "select", ...mappingMetadata },
  { fieldKey: "ticket.priority", source: "tickets", propertyId: "priority", propertyName: "Prioridade", propertyType: "select", ...mappingMetadata },
  { fieldKey: "ticket.sector", source: "tickets", propertyId: "sector", propertyName: "Setor", propertyType: "select", ...mappingMetadata },
  { fieldKey: "ticket.status", source: "tickets", propertyId: "status", propertyName: "Status", propertyType: "status", ...mappingMetadata },
  { fieldKey: "history.eventType", source: "history", propertyId: "event", propertyName: "Evento", propertyType: "title", ...mappingMetadata },
  { fieldKey: "history.ticketRelation", source: "history", propertyId: "relation", propertyName: "Chamado", propertyType: "relation", ...mappingMetadata },
  { fieldKey: "history.occurredAt", source: "history", propertyId: "occurred", propertyName: "Data", propertyType: "date", ...mappingMetadata },
];

const schemas = [
  {
    key: "tickets",
    label: "Chamados",
    name: "Chamados",
    dataSourceId: "tickets-source",
    properties: [
      { id: "opened", name: "Abertura", type: "date" },
      { id: "reason", name: "Motivo", type: "select" },
      { id: "priority", name: "Prioridade", type: "select" },
      { id: "sector", name: "Setor", type: "select" },
      { id: "status", name: "Status", type: "status" },
    ],
  },
  {
    key: "history",
    label: "Histórico",
    name: "Histórico",
    dataSourceId: "history-source",
    properties: [
      { id: "event", name: "Evento", type: "title" },
      { id: "relation", name: "Chamado", type: "relation" },
      { id: "occurred", name: "Data", type: "date" },
    ],
  },
];

function testContext() {
  const directory = mkdtempSync(join(tmpdir(), "pulseti-notion-sync-"));
  const database = new ApplicationDatabase(join(directory, "test.sqlite"));
  database.connection.prepare(`
    INSERT INTO users (id, email, display_name, role, password_hash)
    VALUES (?, ?, ?, ?, ?)
  `).run(actor.userId, "sync.admin@upa.local", actor.displayName, actor.role, "a".repeat(64));
  return {
    directory,
    database,
    syncStore: new SyncStore(database.connection),
    auditStore: new AuditStore(database.connection),
  };
}

function closeContext(context) {
  context.database.close();
  rmSync(context.directory, { recursive: true, force: true });
}

function successfulClient() {
  return {
    async loadSchema() { return schemas; },
    async queryDataSource(dataSourceId) {
      if (dataSourceId === "tickets-source") {
        return {
          requestCount: 1,
          pages: [{
            id: "ticket-one",
            properties: {
              Abertura: { id: "opened", type: "date", date: { start: "2026-10-26T10:00:00-03:00" } },
              Motivo: { id: "reason", type: "select", select: { name: "Impressora" } },
              Prioridade: { id: "priority", type: "select", select: { name: "Média" } },
              Setor: { id: "sector", type: "select", select: { name: "Recepção" } },
              Status: { id: "status", type: "status", status: { name: "Concluído" } },
              Descrição: { id: "description", type: "rich_text", rich_text: [{ plain_text: "Não persistir" }] },
            },
          }],
        };
      }
      return {
        requestCount: 1,
        pages: [{
          id: "event-one",
          properties: {
            Evento: { id: "event", type: "title", title: [{ plain_text: "Início" }] },
            Chamado: { id: "relation", type: "relation", relation: [{ id: "ticket-one" }], has_more: false },
            Data: { id: "occurred", type: "date", date: { start: "2026-10-26T10:30:00-03:00" } },
          },
        }],
      };
    },
  };
}

test("orquestra leitura, validação, publicação e auditoria sem persistir campos livres", async () => {
  const context = testContext();
  try {
    const run = context.syncStore.start(actor);
    const outcome = await executeNotionSync({
      runId: run.id,
      actor,
      client: successfulClient(),
      mappings,
      syncStore: context.syncStore,
      auditStore: context.auditStore,
      now: () => new Date("2026-10-26T14:00:00.000Z"),
    });

    assert.equal(outcome.status, "succeeded");
    assert.equal(context.syncStore.overview().latestSnapshot?.ticketCount, 1);
    assert.equal(context.syncStore.overview().latestSnapshot?.eventCount, 1);
    const records = context.syncStore.recordsForSnapshot(outcome.snapshot.id, "tickets");
    assert.equal(JSON.stringify(records).includes("Não persistir"), false);
    const audit = context.auditStore.list(1)[0];
    assert.equal(audit.action, "sync.run_completed");
    assert.equal(audit.outcome, "success");
    assert.equal(audit.targetId, outcome.snapshot.id);
  } finally {
    closeContext(context);
  }
});

test("registra falha segura e preserva o snapshot anterior quando o Notion fica indisponível", async () => {
  const context = testContext();
  try {
    const firstRun = context.syncStore.start(actor);
    const published = context.syncStore.publish(firstRun.id, {
      tickets: [{ source: "tickets", pageId: "existing-ticket", fields: {} }],
      history: [],
      warningCount: 0,
    });
    const failedRun = context.syncStore.start(actor);
    const outcome = await executeNotionSync({
      runId: failedRun.id,
      actor,
      client: {
        async loadSchema() { throw new NotionClientError("unavailable"); },
        async queryDataSource() { throw new Error("não deveria consultar"); },
      },
      mappings,
      syncStore: context.syncStore,
      auditStore: context.auditStore,
      now: () => new Date("2026-10-26T15:00:00.000Z"),
    });

    assert.equal(outcome.status, "failed");
    assert.equal(outcome.run.error?.code, "unavailable");
    assert.equal(context.syncStore.overview().latestSnapshot?.id, published.id);
    assert.equal(context.syncStore.overview().activeRun, null);
    const audit = context.auditStore.list(1)[0];
    assert.equal(audit.action, "sync.run_completed");
    assert.equal(audit.outcome, "failure");
    assert.equal(audit.summary.includes("unavailable"), true);
  } finally {
    closeContext(context);
  }
});
