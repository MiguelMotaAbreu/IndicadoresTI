import test from "node:test";
import assert from "node:assert/strict";

import { calculateDemandAnalytics } from "../app/lib/demand-analytics.ts";

function valid(kind, value) {
  return { state: "valid", value: { kind, value } };
}

function ticket(pageId, openedAt, reason, sector = "Recepção") {
  return {
    source: "tickets",
    pageId,
    fields: {
      "ticket.openedAt": valid("date", openedAt),
      "ticket.completedAt": valid("date", openedAt),
      "ticket.reason": valid(Array.isArray(reason) ? "text_list" : "text", reason),
      "ticket.sector": valid("text", sector),
      "ticket.priority": valid("text", "Média"),
      "ticket.status": valid("text", "Concluído"),
    },
  };
}

const snapshot = {
  id: "snapshot-demand",
  status: "published",
  ticketCount: 5,
  eventCount: 0,
  warningCount: 1,
  createdAt: "2026-10-27T18:00:00.000Z",
  publishedAt: "2026-10-27T18:00:00.000Z",
};

const dataset = {
  tickets: [
    ticket("current-tuesday", "2026-10-27T10:15:00-03:00", "Impressora"),
    ticket("current-monday", "2026-10-26T01:20:00-03:00", "Computador"),
    ticket("current-thursday", "2026-10-01T15:40:00-03:00", ["Impressora", "Rede"], "Farmácia"),
    ticket("previous-one", "2026-09-27T10:00:00-03:00", "Impressora"),
    ticket("previous-two", "2026-09-01T10:00:00-03:00", "Rede"),
  ],
  history: [],
};

test("calcula cartões e compara períodos de mesma duração", () => {
  const analytics = calculateDemandAnalytics(snapshot, dataset, { period: "last30" });

  assert.equal(analytics.cards.totalTickets, 3);
  assert.deepEqual(analytics.cards.averagePerCalendarDay, {
    value: 0.1,
    validOpenings: 3,
    calendarDays: 30,
    coveragePercent: 100,
  });
  assert.deepEqual(analytics.cards.variation, {
    valuePercent: 50,
    current: 3,
    previous: 2,
    comparableDays: 30,
  });
  assert.deepEqual(analytics.cards.distinctReasons, {
    value: 3,
    coveredTickets: 3,
    coveragePercent: 100,
  });
});

test("produz heatmap no fuso de Santos e Pareto cumulativo dos motivos", () => {
  const analytics = calculateDemandAnalytics(snapshot, dataset, { period: "last30" });

  assert.equal(analytics.heatmap.validOpenings, 3);
  assert.equal(analytics.heatmap.coveragePercent, 100);
  assert.equal(analytics.heatmap.rows.find((row) => row.day === "Ter").buckets[3], 1);
  assert.equal(analytics.heatmap.rows.find((row) => row.day === "Seg").buckets[0], 1);
  assert.equal(analytics.heatmap.rows.find((row) => row.day === "Qui").buckets[5], 1);
  assert.deepEqual(analytics.reasons.items.map(({ name, value }) => ({ name, value })), [
    { name: "Impressora", value: 2 },
    { name: "Computador", value: 1 },
    { name: "Rede", value: 1 },
  ]);
  assert.deepEqual(analytics.pareto.items.map(({ name, cumulativePercent }) => ({ name, cumulativePercent })), [
    { name: "Impressora", cumulativePercent: 50 },
    { name: "Computador", cumulativePercent: 75 },
    { name: "Rede", cumulativePercent: 100 },
  ]);
});

test("não inventa variação para toda a base e aplica dimensões ao mesmo recorte", () => {
  const all = calculateDemandAnalytics(snapshot, dataset, { period: "all" });
  const pharmacy = calculateDemandAnalytics(snapshot, dataset, { period: "last30", sector: "farmacia" });

  assert.deepEqual(all.cards.variation, {
    valuePercent: null,
    current: 5,
    previous: null,
    comparableDays: null,
  });
  assert.equal(pharmacy.selection.matchedTickets, 1);
  assert.equal(pharmacy.cards.totalTickets, 1);
  assert.equal(pharmacy.reasons.items[0].name, "Impressora");
});

test("contabiliza uma data sem hora no dia correto e a exclui do heatmap horário", () => {
  const analytics = calculateDemandAnalytics(snapshot, {
    tickets: [ticket("date-only", "2026-10-27", "Impressora")],
    history: [],
  }, { period: "all" });

  assert.equal(analytics.selection.periodStart, "2026-10-27");
  assert.equal(analytics.selection.periodEnd, "2026-10-27");
  assert.equal(analytics.trend.points[0].period, "2026-10-27");
  assert.equal(analytics.trend.points[0].opened, 1);
  assert.equal(analytics.heatmap.validOpenings, 0);
  assert.equal(analytics.heatmap.coveragePercent, 0);
});
