import test from "node:test";
import assert from "node:assert/strict";

import {
  combineOpeningDateAndTime,
  parseAnalyticalDate,
  parseOpeningClock,
} from "../app/lib/notion-opening-date.ts";

test("interpreta formatos usuais da hora textual sem aceitar horários impossíveis", () => {
  assert.deepEqual(parseOpeningClock("8:05"), { hour: 8, minute: 5, second: 0 });
  assert.deepEqual(parseOpeningClock("08h30"), { hour: 8, minute: 30, second: 0 });
  assert.deepEqual(parseOpeningClock("21:14:09"), { hour: 21, minute: 14, second: 9 });
  assert.equal(parseOpeningClock("24:00"), null);
  assert.equal(parseOpeningClock("8 e meia"), null);
});

test("combina a data e a hora no fuso de Santos", () => {
  assert.equal(
    combineOpeningDateAndTime("2026-10-27", "10:30"),
    "2026-10-27T13:30:00.000Z",
  );
  assert.equal(combineOpeningDateAndTime("2026-10-27T10:30:00-03:00", "11:00"), null);
});

test("uma data sem horário mantém o próprio dia na leitura analítica", () => {
  assert.equal(parseAnalyticalDate("2026-10-27")?.toISOString(), "2026-10-27T12:00:00.000Z");
});
