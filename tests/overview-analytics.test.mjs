import test from "node:test";
import assert from "node:assert/strict";

import { calculateOverviewAnalytics } from "../app/lib/overview-analytics.ts";

function valid(kind, value, extra = {}) {
  return { state: "valid", value: { kind, value, ...extra } };
}

function ticket(pageId, fields) {
  return { source: "tickets", pageId, fields };
}

const snapshot = {
  id: "snapshot-overview",
  status: "published",
  ticketCount: 4,
  eventCount: 0,
  warningCount: 2,
  createdAt: "2026-10-26T15:00:00.000Z",
  publishedAt: "2026-10-26T15:00:00.000Z",
};

test("calcula a visão geral com dias corridos, cobertura e classificações registradas", () => {
  const analytics = calculateOverviewAnalytics(snapshot, {
    tickets: [
      ticket("ticket-one", {
        "ticket.openedAt": valid("date", "2026-10-01T10:00:00-03:00"),
        "ticket.completedAt": valid("date", "2026-10-02T11:00:00-03:00"),
        "ticket.status": valid("text", "Concluído"),
        "ticket.priority": valid("text", "Alta"),
        "ticket.reason": valid("text", "Impressora"),
        "ticket.slaStatus": valid("text", "Dentro do prazo"),
      }),
      ticket("ticket-two", {
        "ticket.openedAt": valid("date", "2026-10-03T08:00:00-03:00"),
        "ticket.status": valid("text", "Aguardando informação"),
        "ticket.priority": valid("text", "Crítico"),
        "ticket.reason": valid("text", "Computador"),
        "ticket.slaStatus": valid("text", "Fora do prazo"),
      }),
      ticket("ticket-three", {
        "ticket.openedAt": valid("date", "2026-10-03T15:00:00-03:00"),
        "ticket.status": valid("text", "Com fornecedor"),
        "ticket.priority": valid("text", "Média"),
        "ticket.reason": valid("text", "Impressora"),
        "ticket.slaStatus": valid("text", "Não avaliado"),
      }),
      ticket("ticket-four", {
        "ticket.openedAt": { state: "missing" },
        "ticket.status": { state: "missing" },
        "ticket.priority": { state: "missing" },
        "ticket.reason": valid("text_list", ["Rede", "Computador"]),
        "ticket.slaStatus": { state: "missing" },
      }),
    ],
    history: [],
  });

  assert.equal(analytics.cards.totalTickets, 4);
  assert.deepEqual(analytics.cards.averagePerCalendarDay, {
    value: 1,
    validOpenings: 3,
    calendarDays: 3,
    coveragePercent: 75,
    periodStart: "2026-10-01",
    periodEnd: "2026-10-03",
  });
  assert.deepEqual(analytics.cards.slaCompliance, {
    valuePercent: 50,
    evaluated: 2,
    within: 1,
    outside: 1,
    coveragePercent: 50,
  });
  assert.deepEqual(analytics.cards.pendingTickets, {
    value: 2,
    validStatuses: 3,
    coveragePercent: 75,
  });
  assert.deepEqual(analytics.demand, {
    granularity: "day",
    points: [
      { period: "2026-10-01", opened: 1, completed: 0 },
      { period: "2026-10-02", opened: 0, completed: 1 },
      { period: "2026-10-03", opened: 2, completed: 0 },
    ],
  });
  assert.deepEqual(analytics.distributions.status.items, [
    { name: "Aguardando informação", value: 1 },
    { name: "Com fornecedor", value: 1 },
    { name: "Concluído", value: 1 },
  ]);
  assert.deepEqual(analytics.distributions.priority.items, [
    { name: "Crítico", value: 1 },
    { name: "Alta", value: 1 },
    { name: "Média", value: 1 },
  ]);
  assert.deepEqual(analytics.distributions.reason.items, [
    { name: "Computador", value: 2 },
    { name: "Impressora", value: 2 },
    { name: "Rede", value: 1 },
  ]);
  assert.equal(analytics.distributions.reason.coveragePercent, 100);
});

test("não inventa médias ou SLA quando o snapshot não possui amostra válida", () => {
  const analytics = calculateOverviewAnalytics(
    { ...snapshot, ticketCount: 1 },
    {
      tickets: [ticket("ticket-empty", {
        "ticket.openedAt": { state: "invalid", issue: "malformed" },
        "ticket.status": { state: "missing" },
        "ticket.slaStatus": valid("text", "Não avaliado"),
        "ticket.reason": valid("ids", ["relation-id"], { truncated: false }),
      })],
      history: [],
    },
  );

  assert.equal(analytics.cards.averagePerCalendarDay.value, null);
  assert.equal(analytics.cards.averagePerCalendarDay.calendarDays, 0);
  assert.equal(analytics.cards.slaCompliance.valuePercent, null);
  assert.equal(analytics.cards.slaCompliance.evaluated, 0);
  assert.equal(analytics.demand.points.length, 0);
  assert.equal(analytics.distributions.reason.coveragePercent, 0);
  assert.deepEqual(analytics.distributions.reason.items, []);
});

test("não trata qualquer status aguardando como espera por informação", () => {
  const analytics = calculateOverviewAnalytics(
    { ...snapshot, ticketCount: 2 },
    {
      tickets: [
        ticket("ticket-information", { "ticket.status": valid("text", "Aguardando informação") }),
        ticket("ticket-schedule", { "ticket.status": valid("text", "Aguardando agendamento") }),
      ],
      history: [],
    },
  );

  assert.equal(analytics.cards.pendingTickets.value, 1);
  assert.equal(analytics.cards.pendingTickets.validStatuses, 2);
});

test("agrega séries longas por mês e limita o número de pontos", () => {
  const analytics = calculateOverviewAnalytics(
    { ...snapshot, ticketCount: 2 },
    {
      tickets: [
        ticket("ticket-old", { "ticket.openedAt": valid("date", "2024-01-10T10:00:00-03:00") }),
        ticket("ticket-new", { "ticket.openedAt": valid("date", "2026-10-10T10:00:00-03:00") }),
      ],
      history: [],
    },
  );

  assert.equal(analytics.demand.granularity, "month");
  assert.equal(analytics.demand.points[0].period, "2024-01");
  assert.equal(analytics.demand.points.at(-1).period, "2026-10");
  assert.ok(analytics.demand.points.length <= 600);
});
