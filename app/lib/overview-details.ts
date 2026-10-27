import { createHash } from "node:crypto";

import type { NotionMappingFieldKey } from "./notion-mapping.ts";
import type { NormalizedNotionRecord } from "./notion-record-transformer.ts";
import type { AnalyticalSnapshot, SnapshotDataset } from "./sync-store.ts";
import type { UserRole } from "./user-store.ts";
import {
  selectOverviewTickets,
  type OverviewAnalyticsFilters,
} from "./overview-analytics.ts";

export type OverviewDetailRow = {
  rowKey: string;
  code: string;
  requester: string;
  sector: string;
  priority: string;
  status: string;
  reason: string;
  openedAt: string | null;
};

export type OverviewDetails = {
  snapshot: { id: string; publishedAt: string };
  selection: {
    totalRecords: number;
    page: number;
    pageSize: number;
    pageCount: number;
    filters: OverviewAnalyticsFilters;
  };
  privacy: { requesterMasked: boolean };
  rows: OverviewDetailRow[];
};

function validValue(record: NormalizedNotionRecord, fieldKey: NotionMappingFieldKey) {
  const field = record.fields[fieldKey];
  return field?.state === "valid" ? field.value : null;
}

function textValues(record: NormalizedNotionRecord, fieldKey: NotionMappingFieldKey): string[] {
  const value = validValue(record, fieldKey);
  if (value?.kind === "text") return [value.value];
  if (value?.kind === "text_list") return value.value;
  return [];
}

function displayText(record: NormalizedNotionRecord, fieldKey: NotionMappingFieldKey): string {
  const values = textValues(record, fieldKey).map((value) => value.trim()).filter(Boolean);
  return values.length > 0 ? [...new Set(values)].join(", ") : "Não informado";
}

function displayCode(record: NormalizedNotionRecord): string {
  const value = validValue(record, "ticket.externalCode");
  if (value?.kind === "text") return value.value.trim() || "Sem código";
  if (value?.kind === "number") return String(value.value);
  return "Sem código";
}

function displayRequester(record: NormalizedNotionRecord, role: UserRole): string {
  const value = validValue(record, "ticket.requester");
  if (!value) return "Não informado";
  if (role === "analista") return "Solicitante protegido";
  if (value.kind === "text") return value.value.trim() || "Não informado";
  return "Solicitante identificado";
}

function openedAt(record: NormalizedNotionRecord): string | null {
  const value = validValue(record, "ticket.openedAt");
  return value?.kind === "date" ? value.value : null;
}

function rowKey(snapshotId: string, pageId: string): string {
  return createHash("sha256").update(`${snapshotId}:${pageId}`).digest("hex").slice(0, 16);
}

export function createOverviewDetails(
  snapshot: AnalyticalSnapshot,
  dataset: Pick<SnapshotDataset, "tickets">,
  filters: OverviewAnalyticsFilters,
  role: UserRole,
  page: number,
  pageSize: number,
): OverviewDetails {
  const selection = selectOverviewTickets(dataset, filters);
  const sorted = [...selection.tickets].sort((left, right) => {
    const dateDifference = (Date.parse(openedAt(right) ?? "") || 0) - (Date.parse(openedAt(left) ?? "") || 0);
    return dateDifference || left.pageId.localeCompare(right.pageId);
  });
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const first = (safePage - 1) * pageSize;
  const rows = sorted.slice(first, first + pageSize).map((record) => ({
    rowKey: rowKey(snapshot.id, record.pageId),
    code: displayCode(record),
    requester: displayRequester(record, role),
    sector: displayText(record, "ticket.sector"),
    priority: displayText(record, "ticket.priority"),
    status: displayText(record, "ticket.status"),
    reason: displayText(record, "ticket.reason"),
    openedAt: openedAt(record),
  }));

  return {
    snapshot: { id: snapshot.id, publishedAt: snapshot.publishedAt },
    selection: {
      totalRecords: sorted.length,
      page: safePage,
      pageSize,
      pageCount,
      filters: selection.filters,
    },
    privacy: { requesterMasked: role === "analista" },
    rows,
  };
}
