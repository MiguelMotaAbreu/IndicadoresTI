import type { SnapshotDataset, AnalyticalSnapshot } from "./sync-store.ts";
import { isDateOnly } from "./notion-opening-date.ts";
import type { OverviewAnalyticsFilters } from "./overview-analytics.ts";
import { createOverviewDetails } from "./overview-details.ts";
import type { UserRole } from "./user-store.ts";

export const MAX_OVERVIEW_CSV_ROWS = 10_000;

export class OverviewCsvExportLimitError extends Error {
  readonly totalRecords: number;

  constructor(totalRecords: number) {
    super(`O recorte possui ${totalRecords} registros e excede o limite de ${MAX_OVERVIEW_CSV_ROWS} linhas por arquivo.`);
    this.name = "OverviewCsvExportLimitError";
    this.totalRecords = totalRecords;
  }
}

export type OverviewCsvExport = {
  contents: string;
  filename: string;
  rowCount: number;
  requesterMasked: boolean;
};

function spreadsheetSafeCell(value: string): string {
  const normalized = value.replace(/\0/g, "");
  const protectedValue = /^[\s]*[=+\-@]/.test(normalized) ? `'${normalized}` : normalized;
  return `"${protectedValue.replace(/"/g, '""')}"`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "Não informada";
  if (isDateOnly(value)) {
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Não informada";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "America/Sao_Paulo",
  }).format(parsed);
}

function filenameTimestamp(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Sao_Paulo",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((candidate) => candidate.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}_${part("hour")}-${part("minute")}`;
}

export function createOverviewCsvExport(
  snapshot: AnalyticalSnapshot,
  dataset: Pick<SnapshotDataset, "tickets">,
  filters: OverviewAnalyticsFilters,
  role: UserRole,
  generatedAt = new Date(),
): OverviewCsvExport {
  const details = createOverviewDetails(
    snapshot,
    dataset,
    filters,
    role,
    1,
    MAX_OVERVIEW_CSV_ROWS + 1,
  );
  if (details.selection.totalRecords > MAX_OVERVIEW_CSV_ROWS) {
    throw new OverviewCsvExportLimitError(details.selection.totalRecords);
  }

  const lines = [
    ["Chamado", "Solicitante", "Setor", "Prioridade", "Status", "Motivo", "Abertura"],
    ...details.rows.map((row) => [
      row.code,
      row.requester,
      row.sector,
      row.priority,
      row.status,
      row.reason,
      formatDateTime(row.openedAt),
    ]),
  ].map((row) => row.map(spreadsheetSafeCell).join(";"));

  return {
    contents: `\uFEFF${lines.join("\r\n")}\r\n`,
    filename: `pulseti-visao-geral_${filenameTimestamp(generatedAt)}.csv`,
    rowCount: details.selection.totalRecords,
    requesterMasked: details.privacy.requesterMasked,
  };
}
