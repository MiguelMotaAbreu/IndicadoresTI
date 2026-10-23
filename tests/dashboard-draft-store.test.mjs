import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DashboardDraftStore } from "../app/lib/dashboard-draft-store.ts";
import { ApplicationDatabase } from "../app/lib/database.ts";
import {
  createDefaultDashboardDraft,
  parseDashboardDraft,
  serializeDashboardDraft,
} from "../app/lib/dashboard-drafts.ts";

const defaultLayout = [
  { i: "metric-total", x: 0, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
];

test("persiste e atualiza um rascunho por usuário e painel", () => {
  const directory = mkdtempSync(join(tmpdir(), "pulseti-drafts-"));
  const databasePath = join(directory, "test.sqlite");
  let database = new ApplicationDatabase(databasePath);
  let store = new DashboardDraftStore(database.connection);

  try {
    assert.equal(store.findSerialized("admin", "overview"), null);

    const first = createDefaultDashboardDraft("overview", defaultLayout);
    first.savedAt = "2026-10-22T15:00:00.000Z";
    store.save("admin", first);

    const storedFirst = store.findSerialized("admin", "overview");
    assert.ok(storedFirst);
    assert.deepEqual(
      parseDashboardDraft(storedFirst, "overview", defaultLayout),
      parseDashboardDraft(serializeDashboardDraft(first), "overview", defaultLayout),
    );

    const revised = structuredClone(first);
    revised.layout[0].x = 4;
    revised.savedAt = "2026-10-22T16:00:00.000Z";
    store.save("admin", revised);
    database.close();
    database = new ApplicationDatabase(databasePath);
    store = new DashboardDraftStore(database.connection);

    const storedRevised = store.findSerialized("admin", "overview");
    assert.ok(storedRevised);
    assert.equal(JSON.parse(storedRevised).layout[0].x, 4);
    assert.equal(store.findSerialized("analyst", "overview"), null);
    assert.equal(store.findSerialized("admin", "demand"), null);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
