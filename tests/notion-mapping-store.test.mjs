import test from "node:test";
import assert from "node:assert/strict";

import { ApplicationDatabase } from "../app/lib/database.ts";
import { NotionMappingStore } from "../app/lib/notion-mapping-store.ts";

const actor = { userId: "mapping-admin", displayName: "Administrador Mapeamento" };

function prepareDatabase() {
  const database = new ApplicationDatabase(":memory:");
  database.connection.prepare(`
    INSERT INTO users (id, email, display_name, role, password_hash)
    VALUES (?, ?, ?, 'administrador', ?)
  `).run(actor.userId, "mapping@upa.local", actor.displayName, "a".repeat(64));
  return database;
}

test("substitui o conjunto de mapeamentos e não expõe IDs de propriedades", () => {
  const database = prepareDatabase();
  const store = new NotionMappingStore(database.connection);

  try {
    const first = store.saveAtomically([
      { fieldKey: "ticket.externalCode", source: "tickets", propertyId: "private-title-id", propertyName: "Chamado", propertyType: "title" },
      { fieldKey: "ticket.openedAt", source: "tickets", propertyId: "private-date-id", propertyName: "Abertura", propertyType: "date" },
    ], actor, (saved) => saved.length, new Date("2026-10-25T15:00:00.000Z"));

    assert.equal(first.effect, 2);
    assert.equal(first.mappings.length, 2);
    assert.equal(JSON.stringify(first.mappings).includes("private-title-id"), false);
    assert.equal(store.listForIngestion()[0].propertyId, "private-title-id");

    const second = store.saveAtomically([
      { fieldKey: "ticket.externalCode", source: "tickets", propertyId: "new-title-id", propertyName: "Código atualizado", propertyType: "title" },
    ], actor, (saved) => saved.length, new Date("2026-10-25T16:00:00.000Z"));

    assert.equal(second.effect, 1);
    assert.deepEqual(store.list(), second.mappings);
    assert.equal(store.list()[0].propertyName, "Código atualizado");
  } finally {
    database.close();
  }
});

test("reverte o novo conjunto quando o efeito auditável falha", () => {
  const database = prepareDatabase();
  const store = new NotionMappingStore(database.connection);

  try {
    store.saveAtomically([
      { fieldKey: "ticket.externalCode", source: "tickets", propertyId: "title-id", propertyName: "Chamado", propertyType: "title" },
    ], actor, () => true);

    assert.throws(() => store.saveAtomically([
      { fieldKey: "ticket.openedAt", source: "tickets", propertyId: "date-id", propertyName: "Abertura", propertyType: "date" },
    ], actor, () => { throw new Error("falha de auditoria"); }), /falha de auditoria/);

    assert.equal(store.list().length, 1);
    assert.equal(store.list()[0].fieldKey, "ticket.externalCode");
  } finally {
    database.close();
  }
});
