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
    revised.pages[0].layout[0].x = 4;
    revised.savedAt = "2026-10-22T16:00:00.000Z";
    store.save("admin", revised);
    database.close();
    database = new ApplicationDatabase(databasePath);
    store = new DashboardDraftStore(database.connection);

    const storedRevised = store.findSerialized("admin", "overview");
    assert.ok(storedRevised);
    assert.equal(JSON.parse(storedRevised).pages[0].layout[0].x, 4);
    assert.equal(store.findSerialized("analyst", "overview"), null);
    assert.equal(store.findSerialized("admin", "demand"), null);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("adota rascunhos do usuário provisório sem sobrescrever os atuais", () => {
  const database = new ApplicationDatabase(":memory:");
  const store = new DashboardDraftStore(database.connection);

  try {
    const legacyOverview = createDefaultDashboardDraft("overview", defaultLayout);
    legacyOverview.savedAt = "2026-10-22T15:00:00.000Z";
    store.save("admin", legacyOverview);

    const currentOverview = structuredClone(legacyOverview);
    currentOverview.savedAt = "2026-10-23T15:00:00.000Z";
    store.save("user-1", currentOverview);

    const legacyDemand = createDefaultDashboardDraft("demand", defaultLayout);
    legacyDemand.savedAt = "2026-10-22T16:00:00.000Z";
    store.save("admin", legacyDemand);

    assert.equal(store.adoptLegacyDrafts("user-1"), 1);
    assert.equal(JSON.parse(store.findSerialized("user-1", "overview")).savedAt, currentOverview.savedAt);
    assert.equal(JSON.parse(store.findSerialized("user-1", "demand")).savedAt, legacyDemand.savedAt);
    assert.equal(store.adoptLegacyDrafts("user-1"), 0);
  } finally {
    database.close();
  }
});
