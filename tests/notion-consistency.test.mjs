import test from "node:test";
import assert from "node:assert/strict";

import { analyzeNotionConsistency } from "../app/lib/notion-consistency.ts";

function date(value) {
  return { state: "valid", value: { kind: "date", value } };
}

function relation(...ids) {
  return { state: "valid", value: { kind: "ids", value: ids, truncated: false } };
}

function ticket(pageId, fields) {
  return { source: "tickets", pageId, fields };
}

function event(pageId, fields) {
  return { source: "history", pageId, fields };
}

test("detecta inversões cronológicas sem transformar ausências em inconsistências", () => {
  const tickets = [
    ticket("ticket-inverted", {
      "ticket.openedAt": date("2026-10-26T10:00:00-03:00"),
      "ticket.startedAt": date("2026-10-26T09:00:00-03:00"),
      "ticket.completedAt": date("2026-10-26T08:00:00-03:00"),
    }),
    ticket("ticket-linked", {
      "ticket.openedAt": date("2026-10-26T10:00:00-03:00"),
    }),
    ticket("ticket-missing", {
      "ticket.openedAt": { state: "missing" },
      "ticket.startedAt": date("2026-10-26T09:00:00-03:00"),
    }),
  ];
  const history = [
    event("event-inverted", {
      "history.ticketRelation": relation("ticket-linked"),
      "history.occurredAt": date("2026-10-26T09:30:00-03:00"),
      "history.stageStartedAt": date("2026-10-26T12:00:00-03:00"),
      "history.stageEndedAt": date("2026-10-26T11:00:00-03:00"),
    }),
    event("event-ambiguous", {
      "history.ticketRelation": relation("ticket-linked", "ticket-inverted"),
      "history.occurredAt": date("2026-10-26T07:00:00-03:00"),
    }),
  ];

  const result = analyzeNotionConsistency(tickets, history);

  assert.equal(result.issueCount, 5);
  assert.equal(result.recordsAffected, 2);
  assert.deepEqual(
    Object.fromEntries(result.rules.map((rule) => [rule.code, rule.count])),
    {
      ticket_started_before_opened: 1,
      ticket_completed_before_opened: 1,
      ticket_completed_before_started: 1,
      history_stage_ended_before_started: 1,
      history_event_before_ticket_opened: 1,
    },
  );
});

test("não inventa inconsistência quando as datas são iguais ou crescentes", () => {
  const timestamp = "2026-10-26T10:00:00-03:00";
  const result = analyzeNotionConsistency([
    ticket("ticket-valid", {
      "ticket.openedAt": date(timestamp),
      "ticket.startedAt": date(timestamp),
      "ticket.completedAt": date("2026-10-26T11:00:00-03:00"),
    }),
  ], [
    event("event-valid", {
      "history.ticketRelation": relation("ticket-valid"),
      "history.occurredAt": date(timestamp),
    }),
  ]);

  assert.equal(result.issueCount, 0);
  assert.equal(result.recordsAffected, 0);
  assert.equal(result.rules.every((rule) => rule.count === 0), true);
});
