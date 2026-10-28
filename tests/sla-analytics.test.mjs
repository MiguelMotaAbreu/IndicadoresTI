import test from "node:test";
import assert from "node:assert/strict";

import { calculateSlaAnalytics } from "../app/lib/sla-analytics.ts";

function valid(kind, value) {
  return { state: "valid", value: { kind, value } };
}

function ticket(pageId, minutes, { priority = "Média", slaStatus, openedAt = "2026-10-28T10:00:00-03:00", sector = "Recepção" } = {}) {
  const fields = {
    "ticket.openedAt": valid("date", openedAt),
    "ticket.priority": valid("text", priority),
    "ticket.sector": valid("text", sector),
    "ticket.status": valid("text", "Concluído"),
    "ticket.reason": valid("text", "Computador"),
  };
  if (minutes !== null) {
    fields["ticket.startedAt"] = valid("date", new Date(Date.parse("2026-10-28T10:00:00-03:00") + minutes * 60_000).toISOString());
  }
  if (slaStatus) fields["ticket.slaStatus"] = valid("text", slaStatus);
  return { source: "tickets", pageId, fields };
}

const snapshot = {
  id: "snapshot-sla",
  status: "published",
  ticketCount: 6,
  eventCount: 0,
  warningCount: 1,
  createdAt: "2026-10-28T18:00:00.000Z",
  publishedAt: "2026-10-28T18:00:00.000Z",
};

const dataset = {
  tickets: [
    ticket("high-within", 10, { priority: "Alta", slaStatus: "Dentro do prazo" }),
    ticket("high-outside", 20, { priority: "Alta", slaStatus: "Fora do prazo" }),
    ticket("medium-within", 30, { slaStatus: "Dentro do SLA", sector: "Farmácia" }),
    ticket("medium-outside", 60, { slaStatus: "Excedido", sector: "Farmácia" }),
    ticket("medium-not-evaluated", 300, { slaStatus: "Não avaliado", sector: "Farmácia" }),
    ticket("low-missing", null, { priority: "Baixa" }),
  ],
};

test("calcula cobertura e cumprimento somente com classificações reconhecidas", () => {
  const analytics = calculateSlaAnalytics(snapshot, dataset);

  assert.deepEqual(analytics.cards.evaluated, {
    value: 4,
    within: 2,
    outside: 2,
    coveragePercent: 66.67,
    compliancePercent: 50,
  });
});

test("calcula mediana, P90 e histograma apenas para intervalos cronológicos válidos", () => {
  const analytics = calculateSlaAnalytics(snapshot, dataset);

  assert.deepEqual(analytics.cards.firstResponse, {
    validIntervals: 5,
    coveragePercent: 83.33,
    medianMinutes: 30,
    p90Minutes: 300,
  });
  assert.deepEqual(analytics.histogram.buckets.map((item) => item.value), [1, 2, 1, 0, 1, 0]);
});

test("oculta P90 por prioridade abaixo da amostra mínima sem ocultar a mediana", () => {
  const analytics = calculateSlaAnalytics(snapshot, dataset);

  assert.deepEqual(analytics.timesByPriority.items, [
    { name: "Alta", samples: 2, medianMinutes: 15, p90Minutes: null },
    { name: "Média", samples: 3, medianMinutes: 60, p90Minutes: null },
  ]);
  assert.deepEqual(analytics.complianceByPriority.items, [
    { name: "Alta", within: 1, outside: 1, evaluated: 2, compliancePercent: 50 },
    { name: "Média", within: 1, outside: 1, evaluated: 2, compliancePercent: 50 },
  ]);
});

test("aplica o contrato compartilhado de filtros antes dos cálculos", () => {
  const analytics = calculateSlaAnalytics(snapshot, dataset, { sector: "farmacia" });

  assert.equal(analytics.selection.matchedTickets, 3);
  assert.equal(analytics.cards.evaluated.value, 2);
  assert.equal(analytics.cards.firstResponse.validIntervals, 3);
  assert.deepEqual(analytics.complianceByPriority.items.map((item) => item.name), ["Média"]);
});

test("não fabrica duração quando falta horário ou a ordem cronológica está invertida", () => {
  const dateOnly = ticket("date-only", 30, { openedAt: "2026-10-28", slaStatus: "Dentro do prazo" });
  const inverted = ticket("inverted", -10, { slaStatus: "Fora do prazo" });
  const analytics = calculateSlaAnalytics(snapshot, { tickets: [dateOnly, inverted] });

  assert.equal(analytics.cards.evaluated.value, 2);
  assert.deepEqual(analytics.cards.firstResponse, {
    validIntervals: 0,
    coveragePercent: 0,
    medianMinutes: null,
    p90Minutes: null,
  });
});
