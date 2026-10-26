import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ApplicationDatabase, LATEST_DATABASE_VERSION } from "../app/lib/database.ts";
import { notionMappingFields } from "../app/lib/notion-mapping.ts";
import { SyncStore } from "../app/lib/sync-store.ts";
import { createSystemHealthReport } from "../app/lib/system-health.ts";

const actor = { userId: "health-admin", displayName: "Administrador Saúde" };

function testContext() {
  const directory = mkdtempSync(join(tmpdir(), "pulseti-health-"));
  const database = new ApplicationDatabase(join(directory, "health.sqlite"));
  database.connection.prepare(`
    INSERT INTO users (id, email, display_name, role, password_hash)
    VALUES (?, ?, ?, 'administrador', ?)
  `).run(actor.userId, "health@upa.local", actor.displayName, "a".repeat(64));
  return { directory, database, syncStore: new SyncStore(database.connection) };
}

function closeContext(context) {
  context.database.close();
  rmSync(context.directory, { recursive: true, force: true });
}

function report(context, overrides = {}) {
  return createSystemHealthReport({
    database: context.database.connection,
    schemaVersion: context.database.schemaVersion,
    latestSchemaVersion: LATEST_DATABASE_VERSION,
    configuration: {
      ready: false,
      configuredSources: 0,
      totalSources: 2,
      missing: ["token da integração", "base de chamados", "base de histórico"],
    },
    now: new Date("2026-10-26T15:00:00.000Z"),
    uptimeSeconds: 3_661,
    ...overrides,
  });
}

function saveRequiredMappings(context) {
  const insert = context.database.connection.prepare(`
    INSERT INTO notion_property_mappings (
      field_key, source_key, property_id, property_name, property_type,
      updated_by_user_id, updated_by_name, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const field of notionMappingFields.filter((candidate) => candidate.required)) {
    insert.run(
      field.key,
      field.source,
      `property-${field.key}`,
      field.label,
      field.acceptedTypes[0],
      actor.userId,
      actor.displayName,
      "2026-10-26T14:00:00.000Z",
    );
  }
}

test("diagnostica instalação incompleta sem expor configuração confidencial", () => {
  const context = testContext();
  try {
    const health = report(context);

    assert.equal(health.status, "attention");
    assert.equal(health.checks.length, 6);
    assert.equal(health.checks.find((check) => check.key === "database")?.status, "healthy");
    assert.equal(health.checks.find((check) => check.key === "integration")?.status, "attention");
    assert.equal(health.checks.find((check) => check.key === "snapshot")?.summary, "Nenhuma carga publicada");
    assert.equal(health.checks.find((check) => check.key === "process")?.detail, "Tempo ativo neste processo: 1h 1min.");
    assert.equal(JSON.stringify(health).includes("PULSETI_NOTION_TOKEN"), false);
    assert.equal(JSON.stringify(health).includes("secret_"), false);
  } finally {
    closeContext(context);
  }
});

test("considera saudável uma instalação pronta e com snapshot íntegro", () => {
  const context = testContext();
  try {
    saveRequiredMappings(context);
    const run = context.syncStore.start(actor, new Date("2026-10-26T14:00:00.000Z"));
    context.syncStore.publish(run.id, {
      tickets: [{ source: "tickets", pageId: "ticket-health", fields: {} }],
      history: [],
      warningCount: 0,
    }, new Date("2026-10-26T14:05:00.000Z"));

    const health = report(context, {
      configuration: { ready: true, configuredSources: 2, totalSources: 2, missing: [] },
    });

    assert.equal(health.status, "healthy");
    assert.ok(health.checks.every((check) => check.status === "healthy"));
    assert.equal(health.checks.find((check) => check.key === "snapshot")?.summary, "1 chamados e 0 eventos");
    assert.equal(health.checks.find((check) => check.key === "jobs")?.summary, "Última execução concluída");
  } finally {
    closeContext(context);
  }
});

test("eleva o estado geral para crítico quando há execução interrompida", () => {
  const context = testContext();
  try {
    context.syncStore.start(actor, new Date("2026-10-26T14:44:59.000Z"));
    const health = report(context);

    assert.equal(health.status, "critical");
    assert.equal(health.checks.find((check) => check.key === "jobs")?.status, "critical");
    assert.equal(health.checks.find((check) => check.key === "jobs")?.summary, "Execução possivelmente interrompida");
  } finally {
    closeContext(context);
  }
});
