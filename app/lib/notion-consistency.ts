import type { NotionMappingFieldKey } from "./notion-mapping.ts";
import type { NormalizedNotionRecord } from "./notion-record-transformer.ts";
import type { NormalizedNotionValue } from "./notion-value-normalizer.ts";

export type ConsistencyRuleCode =
  | "ticket_started_before_opened"
  | "ticket_completed_before_opened"
  | "ticket_completed_before_started"
  | "history_stage_ended_before_started"
  | "history_event_before_ticket_opened";

export type ConsistencyRuleResult = {
  code: ConsistencyRuleCode;
  label: string;
  source: "tickets" | "history";
  count: number;
};

export type NotionConsistencyResult = {
  issueCount: number;
  recordsAffected: number;
  rules: ConsistencyRuleResult[];
};

type MutableRule = ConsistencyRuleResult & { affected: Set<string> };

function valueFor(record: NormalizedNotionRecord, fieldKey: NotionMappingFieldKey): NormalizedNotionValue | null {
  const result = record.fields[fieldKey];
  return result?.state === "valid" ? result.value : null;
}

function dateTimeFor(record: NormalizedNotionRecord, fieldKey: NotionMappingFieldKey): number | null {
  const value = valueFor(record, fieldKey);
  if (value?.kind !== "date") return null;
  const timestamp = Date.parse(value.value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function safeTicketRelation(record: NormalizedNotionRecord): string | null {
  const value = valueFor(record, "history.ticketRelation");
  return value?.kind === "ids" && !value.truncated && value.value.length === 1
    ? value.value[0]
    : null;
}

function createRule(
  code: ConsistencyRuleCode,
  label: string,
  source: "tickets" | "history",
): MutableRule {
  return { code, label, source, count: 0, affected: new Set<string>() };
}

function register(rule: MutableRule, record: NormalizedNotionRecord): void {
  rule.count += 1;
  rule.affected.add(`${record.source}:${record.pageId}`);
}

export function analyzeNotionConsistency(
  tickets: readonly NormalizedNotionRecord[],
  history: readonly NormalizedNotionRecord[],
): NotionConsistencyResult {
  const startedBeforeOpened = createRule(
    "ticket_started_before_opened",
    "Início anterior à abertura",
    "tickets",
  );
  const completedBeforeOpened = createRule(
    "ticket_completed_before_opened",
    "Conclusão anterior à abertura",
    "tickets",
  );
  const completedBeforeStarted = createRule(
    "ticket_completed_before_started",
    "Conclusão anterior ao início",
    "tickets",
  );
  const stageEndedBeforeStarted = createRule(
    "history_stage_ended_before_started",
    "Fim de etapa anterior ao início",
    "history",
  );
  const eventBeforeTicketOpened = createRule(
    "history_event_before_ticket_opened",
    "Movimentação anterior à abertura",
    "history",
  );

  for (const ticket of tickets) {
    const openedAt = dateTimeFor(ticket, "ticket.openedAt");
    const startedAt = dateTimeFor(ticket, "ticket.startedAt");
    const completedAt = dateTimeFor(ticket, "ticket.completedAt");
    if (openedAt !== null && startedAt !== null && startedAt < openedAt) register(startedBeforeOpened, ticket);
    if (openedAt !== null && completedAt !== null && completedAt < openedAt) register(completedBeforeOpened, ticket);
    if (startedAt !== null && completedAt !== null && completedAt < startedAt) register(completedBeforeStarted, ticket);
  }

  const ticketsById = new Map(tickets.map((ticket) => [ticket.pageId, ticket]));
  for (const event of history) {
    const stageStartedAt = dateTimeFor(event, "history.stageStartedAt");
    const stageEndedAt = dateTimeFor(event, "history.stageEndedAt");
    if (stageStartedAt !== null && stageEndedAt !== null && stageEndedAt < stageStartedAt) {
      register(stageEndedBeforeStarted, event);
    }

    const relatedTicketId = safeTicketRelation(event);
    const ticket = relatedTicketId ? ticketsById.get(relatedTicketId) : null;
    const eventAt = dateTimeFor(event, "history.occurredAt");
    const openedAt = ticket ? dateTimeFor(ticket, "ticket.openedAt") : null;
    if (eventAt !== null && openedAt !== null && eventAt < openedAt) {
      register(eventBeforeTicketOpened, event);
    }
  }

  const mutableRules = [
    startedBeforeOpened,
    completedBeforeOpened,
    completedBeforeStarted,
    stageEndedBeforeStarted,
    eventBeforeTicketOpened,
  ];
  const affectedRecords = new Set(mutableRules.flatMap((rule) => [...rule.affected]));
  return {
    issueCount: mutableRules.reduce((total, rule) => total + rule.count, 0),
    recordsAffected: affectedRecords.size,
    rules: mutableRules.map((rule) => ({
      code: rule.code,
      label: rule.label,
      source: rule.source,
      count: rule.count,
    })),
  };
}
