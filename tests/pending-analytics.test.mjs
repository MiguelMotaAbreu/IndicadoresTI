import test from "node:test";
import assert from "node:assert/strict";

import { calculatePendingAnalytics } from "../app/lib/pending-analytics.ts";

function valid(kind, value) {
  return { state: "valid", value: { kind, value } };
}

function ticket(pageId, { openedAt, status, priority = "Média", sector = "Recepção", reason = "Computador", code = pageId, assignees } = {}) {
  const fields = {
    "ticket.openedAt": valid("date", openedAt),
    "ticket.status": status ? valid("text", status) : { state: "missing" },
    "ticket.priority": valid("text", priority),
    "ticket.sector": valid("text", sector),
    "ticket.reason": valid("text", reason),
    "ticket.externalCode": valid("text", code),
  };
  if (assignees === "invalid") fields["ticket.assignees"] = { state: "invalid", issue: "malformed" };
  else if (assignees) fields["ticket.assignees"] = valid("ids", assignees);
  else fields["ticket.assignees"] = { state: "missing" };
  return { source: "tickets", pageId, fields };
}

const snapshot = {
  id: "snapshot-pending",
  status: "published",
  ticketCount: 5,
  eventCount: 0,
  warningCount: 2,
  createdAt: "2026-10-28T15:00:00.000Z",
  publishedAt: "2026-10-28T15:00:00.000Z",
};

const dataset = {
  tickets: [
    ticket("recent", { openedAt: "2026-10-28T12:00:00.000Z", status: "Não Iniciado", priority: "Alta", code: "CH-5" }),
    ticket("supplier", { openedAt: "2026-10-26T15:00:00.000Z", status: "Fornecedor", priority: "Crítico", sector: "Farmácia", reason: "Impressora", code: "CH-4", assignees: ["person-1"] }),
    ticket("waiting", { openedAt: "2026-10-20T15:00:00.000Z", status: "Aguardando Info", priority: "Média", code: "CH-3", assignees: "invalid" }),
    ticket("completed", { openedAt: "2026-10-10T15:00:00.000Z", status: "Concluído", code: "CH-2", assignees: ["person-1"] }),
    ticket("status-missing", { openedAt: "2026-10-01T15:00:00.000Z", code: "CH-1" }),
  ],
};

test("calcula a fila atual, idade mediana e cobertura sem misturar chamados concluídos", () => {
  const analytics = calculatePendingAnalytics(snapshot, dataset);

  assert.deepEqual(analytics.cards.total, {
    value: 3,
    evaluatedStatuses: 4,
    coveragePercent: 80,
  });
  assert.deepEqual(analytics.cards.medianAgeHours, {
    value: 48,
    validOpenings: 3,
    coveragePercent: 100,
  });
  assert.deepEqual(analytics.cards.withSupplier, { value: 1, percentage: 33.33 });
  assert.deepEqual(analytics.cards.withoutAssignee, {
    value: 1,
    evaluatedAssignments: 2,
    coveragePercent: 66.67,
  });
  assert.deepEqual(analytics.age.buckets.map((item) => item.value), [1, 1, 0, 1, 0]);
});

test("ordena os chamados mais antigos usando o instante publicado do snapshot", () => {
  const analytics = calculatePendingAnalytics(snapshot, dataset);

  assert.deepEqual(analytics.oldest.map((item) => [item.code, item.ageHours]), [
    ["CH-3", 192],
    ["CH-4", 48],
    ["CH-5", 3],
  ]);
});

test("compõe setor por prioridade com séries dinâmicas e cobertura explícita", () => {
  const analytics = calculatePendingAnalytics(snapshot, dataset);

  assert.deepEqual(analytics.composition.priorities.map((item) => item.label), ["Crítico", "Alta", "Média"]);
  assert.equal(analytics.composition.coveragePercent, 100);
  assert.equal(analytics.composition.items[0].sector, "Recepção");
  assert.equal(analytics.composition.items[0].total, 2);
  assert.equal(analytics.composition.items[1].sector, "Farmácia");
  assert.equal(analytics.composition.items[1].total, 1);
});

test("aplica os filtros compartilhados antes de classificar as pendências", () => {
  const analytics = calculatePendingAnalytics(snapshot, dataset, { sector: "farmacia" });

  assert.equal(analytics.selection.matchedTickets, 1);
  assert.equal(analytics.selection.pendingTickets, 1);
  assert.equal(analytics.cards.total.value, 1);
  assert.equal(analytics.cards.withSupplier.value, 1);
  assert.equal(analytics.oldest[0].code, "CH-4");
});

test("exclui abertura futura da idade sem transformar a inconsistência em zero", () => {
  const analytics = calculatePendingAnalytics(snapshot, {
    tickets: [ticket("future", { openedAt: "2026-10-29T15:00:00.000Z", status: "Não Iniciado" })],
  });

  assert.equal(analytics.cards.total.value, 1);
  assert.deepEqual(analytics.cards.medianAgeHours, {
    value: null,
    validOpenings: 0,
    coveragePercent: 0,
  });
  assert.equal(analytics.oldest.length, 0);
});
