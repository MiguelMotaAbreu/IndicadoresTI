import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ApplicationDatabase } from "../app/lib/database.ts";
import { SyncStore, SyncStoreError } from "../app/lib/sync-store.ts";

function testContext() {
  const directory = mkdtempSync(join(tmpdir(), "pulseti-sync-store-"));
  const database = new ApplicationDatabase(join(directory, "test.sqlite"));
  database.connection.prepare(`
    INSERT INTO users (id, email, display_name, role, password_hash)
    VALUES (?, ?, ?, ?, ?)
  `).run("admin-sync", "sync@upa.local", "Administrador Sincronização", "administrador", "a".repeat(64));

  return {
    directory,
    database,
    store: new SyncStore(database.connection),
    actor: { userId: "admin-sync", displayName: "Administrador Sincronização" },
  };
}

function closeContext(context) {
  context.database.close();
  rmSync(context.directory, { recursive: true, force: true });
}

function ticket(pageId, fields = {}) {
  return { source: "tickets", pageId, fields };
}

function event(pageId, fields = {}) {
  return { source: "history", pageId, fields };
}

function dataset({ tickets = [ticket("ticket-one")], history = [], warningCount = 0 } = {}) {
  return { tickets, history, warningCount };
}

test("registra uma execução ativa e impede sincronizações concorrentes", () => {
  const context = testContext();
  try {
    const startedAt = new Date("2026-10-25T12:00:00.000Z");
    const run = context.store.start(context.actor, startedAt);

    assert.equal(run.status, "running");
    assert.equal(run.startedAt, startedAt.toISOString());
    assert.equal(context.store.overview().activeRun?.id, run.id);
    assert.throws(
      () => context.store.start(context.actor),
      (error) => error instanceof SyncStoreError && error.code === "sync_in_progress",
    );
  } finally {
    closeContext(context);
  }
});

test("publica uma nova carga atomicamente e substitui somente o snapshot anterior", () => {
  const context = testContext();
  try {
    const firstRun = context.store.start(context.actor, new Date("2026-10-25T12:00:00.000Z"));
    const firstSnapshot = context.store.publish(
      firstRun.id,
      dataset({
        tickets: [
          ticket("ticket-one", {
            "ticket.reason": { state: "valid", value: { kind: "text", value: "Impressora" } },
          }),
          ticket("ticket-two"),
        ],
        history: [event("event-one")],
        warningCount: 12,
      }),
      new Date("2026-10-25T12:05:00.000Z"),
    );
    assert.equal(firstSnapshot.status, "published");
    assert.equal(firstSnapshot.ticketCount, 2);
    const persistedTickets = context.store.recordsForSnapshot(firstSnapshot.id, "tickets");
    assert.deepEqual(persistedTickets.map((record) => record.pageId), ["ticket-one", "ticket-two"]);
    assert.deepEqual(persistedTickets[0].fields["ticket.reason"], {
      state: "valid",
      value: { kind: "text", value: "Impressora" },
    });

    const secondRun = context.store.start(context.actor, new Date("2026-10-25T13:00:00.000Z"));
    const secondSnapshot = context.store.publish(
      secondRun.id,
      dataset({ tickets: [ticket("ticket-current")], warningCount: 4 }),
      new Date("2026-10-25T13:04:00.000Z"),
    );
    const overview = context.store.overview();

    assert.equal(overview.activeRun, null);
    assert.equal(overview.latestSnapshot?.id, secondSnapshot.id);
    assert.equal(overview.latestSnapshot?.ticketCount, 1);
    assert.equal(overview.recentRuns[0].status, "succeeded");
    assert.equal(
      context.database.connection.prepare("SELECT status FROM analytical_snapshots WHERE id = ?").get(firstSnapshot.id).status,
      "superseded",
    );
    assert.equal(context.store.recordsForSnapshot(firstSnapshot.id, "tickets").length, 2);
    assert.equal(context.store.recordsForSnapshot(secondSnapshot.id, "tickets").length, 1);
  } finally {
    closeContext(context);
  }
});

test("uma falha encerra a execução sem remover a última carga íntegra", () => {
  const context = testContext();
  try {
    const successfulRun = context.store.start(context.actor);
    const published = context.store.publish(successfulRun.id, dataset());

    const failedRun = context.store.start(context.actor);
    const failure = context.store.fail(
      failedRun.id,
      "notion_unavailable",
      "A API do Notion não respondeu dentro do limite.",
      new Date("2026-10-25T14:00:00.000Z"),
    );
    const overview = context.store.overview();

    assert.equal(failure.status, "failed");
    assert.equal(failure.error?.code, "notion_unavailable");
    assert.equal(overview.activeRun, null);
    assert.equal(overview.latestSnapshot?.id, published.id);
    assert.equal(overview.recentRuns[0].status, "failed");
  } finally {
    closeContext(context);
  }
});

test("rejeita carga vazia ou duplicada sem alterar o snapshot já publicado", () => {
  const context = testContext();
  try {
    const firstRun = context.store.start(context.actor);
    const published = context.store.publish(firstRun.id, dataset());
    const secondRun = context.store.start(context.actor);

    assert.throws(
      () => context.store.publish(secondRun.id, dataset({ tickets: [] })),
      (error) => error instanceof SyncStoreError && error.code === "invalid_records",
    );
    assert.throws(
      () => context.store.publish(secondRun.id, dataset({ tickets: [ticket("duplicated"), ticket("duplicated")] })),
      (error) => error instanceof SyncStoreError && error.code === "invalid_records",
    );
    assert.throws(
      () => context.store.publish(secondRun.id, dataset({
        tickets: [ticket("raw-value", { "ticket.reason": "conteúdo bruto" })],
      })),
      (error) => error instanceof SyncStoreError && error.code === "invalid_records",
    );
    assert.throws(
      () => context.store.publish(secondRun.id, dataset({
        tickets: [ticket("hidden-extra", {
          "ticket.reason": { state: "missing", raw: "conteúdo que não deve ser persistido" },
        })],
      })),
      (error) => error instanceof SyncStoreError && error.code === "invalid_records",
    );
    assert.throws(
      () => context.store.publish(secondRun.id, dataset({ warningCount: -1 })),
      (error) => error instanceof SyncStoreError && error.code === "invalid_counts",
    );
    assert.equal(context.store.overview().latestSnapshot?.id, published.id);
    assert.equal(context.store.overview().activeRun?.id, secondRun.id);
  } finally {
    closeContext(context);
  }
});

test("reverte metadados e registros quando a persistência da nova carga falha", () => {
  const context = testContext();
  try {
    const firstRun = context.store.start(context.actor);
    const published = context.store.publish(firstRun.id, dataset());
    const secondRun = context.store.start(context.actor);
    context.database.connection.exec(`
      CREATE TRIGGER reject_history_record
      BEFORE INSERT ON analytical_snapshot_records
      WHEN NEW.source_key = 'history'
      BEGIN
        SELECT RAISE(ABORT, 'falha de persistência simulada');
      END;
    `);

    assert.throws(
      () => context.store.publish(secondRun.id, dataset({
        tickets: [ticket("ticket-two")],
        history: [event("event-two")],
      })),
      /falha de persistência simulada/,
    );

    const overview = context.store.overview();
    assert.equal(overview.latestSnapshot?.id, published.id);
    assert.equal(overview.activeRun?.id, secondRun.id);
    assert.equal(
      context.database.connection.prepare("SELECT COUNT(*) AS total FROM analytical_snapshots").get().total,
      1,
    );
    assert.equal(context.store.recordsForSnapshot(published.id, "tickets").length, 1);
  } finally {
    closeContext(context);
  }
});

test("mantém publicação e auditoria na mesma transação", () => {
  const context = testContext();
  try {
    const firstRun = context.store.start(context.actor);
    const published = context.store.publish(firstRun.id, dataset());
    const secondRun = context.store.start(context.actor);

    assert.throws(
      () => context.store.publish(
        secondRun.id,
        dataset({ tickets: [ticket("ticket-two")] }),
        new Date("2026-10-26T16:00:00.000Z"),
        () => { throw new Error("auditoria indisponível"); },
      ),
      /auditoria indisponível/,
    );

    assert.equal(context.store.overview().latestSnapshot?.id, published.id);
    assert.equal(context.store.overview().activeRun?.id, secondRun.id);
    assert.equal(
      context.database.connection.prepare("SELECT COUNT(*) AS total FROM analytical_snapshots").get().total,
      1,
    );
  } finally {
    closeContext(context);
  }
});
