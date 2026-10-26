import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { notionMappingFields, type NotionMappingFieldKey } from "./notion-mapping.ts";
import type { NormalizedNotionRecord } from "./notion-record-transformer.ts";

export type SyncRunStatus = "running" | "succeeded" | "failed";
export type SnapshotStatus = "published" | "superseded";

export type SyncActor = {
  userId: string;
  displayName: string;
};

export type SnapshotCounts = {
  ticketCount: number;
  eventCount: number;
  warningCount: number;
};

export type SnapshotDataset = {
  tickets: readonly NormalizedNotionRecord[];
  history: readonly NormalizedNotionRecord[];
  warningCount: number;
};

export type AnalyticalSnapshot = SnapshotCounts & {
  id: string;
  status: SnapshotStatus;
  createdAt: string;
  publishedAt: string;
};

export type SyncRun = {
  id: string;
  requestedBy: { userId: string | null; displayName: string };
  status: SyncRunStatus;
  startedAt: string;
  finishedAt: string | null;
  snapshotId: string | null;
  counts: SnapshotCounts | null;
  error: { code: string; message: string } | null;
};

export type SyncOverview = {
  activeRun: SyncRun | null;
  latestSnapshot: AnalyticalSnapshot | null;
  recentRuns: SyncRun[];
};

export type SyncStoreErrorCode =
  | "sync_in_progress"
  | "run_unavailable"
  | "invalid_counts"
  | "invalid_records"
  | "invalid_error";

export class SyncStoreError extends Error {
  readonly code: SyncStoreErrorCode;

  constructor(code: SyncStoreErrorCode, message: string) {
    super(message);
    this.name = "SyncStoreError";
    this.code = code;
  }
}

type SyncRunRow = {
  id: string;
  requested_by_user_id: string | null;
  requested_by_name: string;
  status: SyncRunStatus;
  started_at: string;
  finished_at: string | null;
  snapshot_id: string | null;
  ticket_count: number | null;
  event_count: number | null;
  warning_count: number | null;
  error_code: string | null;
  error_message: string | null;
};

type SnapshotRow = {
  id: string;
  status: SnapshotStatus;
  ticket_count: number;
  event_count: number;
  warning_count: number;
  created_at: string;
  published_at: string;
};

type SnapshotRecordRow = {
  source_key: "tickets" | "history";
  notion_page_id: string;
  fields_json: string;
};

type PreparedSnapshotRecord = {
  source: "tickets" | "history";
  pageId: string;
  fieldsJson: string;
};

type UnknownRecord = Record<string, unknown>;

const SYNC_RUN_COLUMNS = `
  id, requested_by_user_id, requested_by_name, status, started_at, finished_at,
  snapshot_id, ticket_count, event_count, warning_count, error_code, error_message
`;

function mapRun(row: SyncRunRow): SyncRun {
  const hasCounts = row.ticket_count !== null && row.event_count !== null && row.warning_count !== null;
  const hasError = row.error_code !== null && row.error_message !== null;

  return {
    id: row.id,
    requestedBy: { userId: row.requested_by_user_id, displayName: row.requested_by_name },
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    snapshotId: row.snapshot_id,
    counts: hasCounts
      ? { ticketCount: row.ticket_count!, eventCount: row.event_count!, warningCount: row.warning_count! }
      : null,
    error: hasError ? { code: row.error_code!, message: row.error_message! } : null,
  };
}

function mapSnapshot(row: SnapshotRow): AnalyticalSnapshot {
  return {
    id: row.id,
    status: row.status,
    ticketCount: row.ticket_count,
    eventCount: row.event_count,
    warningCount: row.warning_count,
    createdAt: row.created_at,
    publishedAt: row.published_at,
  };
}

function validateCounts(counts: SnapshotCounts): void {
  if (![counts.ticketCount, counts.eventCount, counts.warningCount].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new SyncStoreError("invalid_counts", "As contagens da carga devem ser números inteiros não negativos.");
  }
}

const mappingSourceByField = new Map<NotionMappingFieldKey, "tickets" | "history">(
  notionMappingFields.map((field) => [field.key, field.source]),
);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

function hasOnlyKeys(value: UnknownRecord, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}

function isNormalizedResult(value: unknown): boolean {
  if (!isRecord(value) || typeof value.state !== "string") return false;
  if (value.state === "missing") return hasOnlyKeys(value, ["state"]);
  if (value.state === "invalid") {
    return hasOnlyKeys(value, ["state", "issue"])
      && (value.issue === "malformed" || value.issue === "unsupported" || value.issue === "semantic_mismatch");
  }
  if (
    value.state !== "valid"
    || !hasOnlyKeys(value, ["state", "value"])
    || !isRecord(value.value)
    || typeof value.value.kind !== "string"
  ) return false;

  if (value.value.kind === "text") {
    return hasOnlyKeys(value.value, ["kind", "value"]) && isNonEmptyString(value.value.value);
  }
  if (value.value.kind === "text_list") {
    return hasOnlyKeys(value.value, ["kind", "value"]) && isStringList(value.value.value);
  }
  if (value.value.kind === "ids") {
    return hasOnlyKeys(value.value, ["kind", "value", "truncated"])
      && isStringList(value.value.value)
      && typeof value.value.truncated === "boolean";
  }
  if (value.value.kind === "date") {
    return hasOnlyKeys(value.value, ["kind", "value"])
      && isNonEmptyString(value.value.value)
      && !Number.isNaN(Date.parse(value.value.value));
  }
  if (value.value.kind === "number") {
    return hasOnlyKeys(value.value, ["kind", "value"])
      && typeof value.value.value === "number"
      && Number.isFinite(value.value.value);
  }
  return value.value.kind === "boolean"
    && hasOnlyKeys(value.value, ["kind", "value"])
    && typeof value.value.value === "boolean";
}

function prepareRecords(
  records: readonly NormalizedNotionRecord[],
  expectedSource: "tickets" | "history",
): PreparedSnapshotRecord[] {
  if (!Array.isArray(records)) {
    throw new SyncStoreError("invalid_records", "A carga analítica não contém uma coleção válida de registros.");
  }

  const pageIds = new Set<string>();
  return records.map((record) => {
    const pageId = typeof record?.pageId === "string" ? record.pageId : "";
    if (
      record?.source !== expectedSource
      || pageId !== pageId.trim()
      || pageId.length === 0
      || pageId.length > 200
      || pageIds.has(pageId)
    ) {
      throw new SyncStoreError("invalid_records", "A carga analítica contém origem, identidade ou duplicidade inválida.");
    }
    pageIds.add(pageId);

    if (!record.fields || typeof record.fields !== "object" || Array.isArray(record.fields)) {
      throw new SyncStoreError("invalid_records", "A carga analítica contém campos inválidos.");
    }
    const fieldKeys = Object.keys(record.fields) as NotionMappingFieldKey[];
    if (
      fieldKeys.some((fieldKey) => mappingSourceByField.get(fieldKey) !== expectedSource)
      || Object.values(record.fields).some((value) => !isNormalizedResult(value))
    ) {
      throw new SyncStoreError("invalid_records", "A carga analítica contém um campo incompatível com sua origem.");
    }

    let fieldsJson: string;
    try {
      fieldsJson = JSON.stringify(record.fields);
    } catch {
      throw new SyncStoreError("invalid_records", "A carga analítica contém campos que não podem ser serializados.");
    }
    if (fieldsJson.length < 2 || fieldsJson.length > 1_000_000) {
      throw new SyncStoreError("invalid_records", "A carga analítica excede o limite seguro por registro.");
    }
    return { source: expectedSource, pageId, fieldsJson };
  });
}

function normalizeError(code: string, message: string): { code: string; message: string } {
  const normalizedCode = typeof code === "string" ? code.trim() : "";
  const normalizedMessage = typeof message === "string" ? message.trim().replace(/\s+/g, " ") : "";
  if (normalizedCode.length < 3 || normalizedCode.length > 80 || normalizedMessage.length < 3 || normalizedMessage.length > 500) {
    throw new SyncStoreError("invalid_error", "O código ou a mensagem da falha de sincronização é inválido.");
  }
  return { code: normalizedCode, message: normalizedMessage };
}

function isRunningConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("sync_runs_one_running_idx");
}

export class SyncStore {
  private readonly database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.database = database;
  }

  start(actor: SyncActor, startedAt = new Date()): SyncRun {
    const displayName = actor.displayName.trim().replace(/\s+/g, " ");
    if (displayName.length < 2 || displayName.length > 100) {
      throw new SyncStoreError("run_unavailable", "O responsável pela sincronização é inválido.");
    }

    try {
      const row = this.database.prepare(`
        INSERT INTO sync_runs (id, requested_by_user_id, requested_by_name, status, started_at)
        VALUES (?, ?, ?, 'running', ?)
        RETURNING ${SYNC_RUN_COLUMNS}
      `).get(randomUUID(), actor.userId, displayName, startedAt.toISOString()) as SyncRunRow;
      return mapRun(row);
    } catch (error) {
      if (isRunningConstraintError(error)) {
        throw new SyncStoreError("sync_in_progress", "Já existe uma sincronização em andamento.");
      }
      throw error;
    }
  }

  publish(runId: string, dataset: SnapshotDataset, publishedAt = new Date()): AnalyticalSnapshot {
    const tickets = prepareRecords(dataset.tickets, "tickets");
    const history = prepareRecords(dataset.history, "history");
    if (tickets.length === 0) {
      throw new SyncStoreError("invalid_records", "Uma carga vazia de chamados não pode substituir o snapshot publicado.");
    }
    const counts: SnapshotCounts = {
      ticketCount: tickets.length,
      eventCount: history.length,
      warningCount: dataset.warningCount,
    };
    validateCounts(counts);
    const timestamp = publishedAt.toISOString();
    const snapshotId = randomUUID();

    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const run = this.database.prepare("SELECT status FROM sync_runs WHERE id = ?").get(runId) as { status: SyncRunStatus } | undefined;
      if (!run || run.status !== "running") {
        throw new SyncStoreError("run_unavailable", "A execução de sincronização não está disponível para publicação.");
      }

      this.database.prepare("UPDATE analytical_snapshots SET status = 'superseded' WHERE status = 'published'").run();
      const snapshot = this.database.prepare(`
        INSERT INTO analytical_snapshots (
          id, status, ticket_count, event_count, warning_count, created_at, published_at
        ) VALUES (?, 'published', ?, ?, ?, ?, ?)
        RETURNING id, status, ticket_count, event_count, warning_count, created_at, published_at
      `).get(
        snapshotId,
        counts.ticketCount,
        counts.eventCount,
        counts.warningCount,
        timestamp,
        timestamp,
      ) as SnapshotRow;

      const insertRecord = this.database.prepare(`
        INSERT INTO analytical_snapshot_records (snapshot_id, source_key, notion_page_id, fields_json)
        VALUES (?, ?, ?, ?)
      `);
      for (const record of [...tickets, ...history]) {
        insertRecord.run(snapshotId, record.source, record.pageId, record.fieldsJson);
      }

      this.database.prepare(`
        UPDATE sync_runs
        SET status = 'succeeded', finished_at = ?, snapshot_id = ?,
            ticket_count = ?, event_count = ?, warning_count = ?
        WHERE id = ?
      `).run(
        timestamp,
        snapshotId,
        counts.ticketCount,
        counts.eventCount,
        counts.warningCount,
        runId,
      );
      this.database.exec("COMMIT;");
      return mapSnapshot(snapshot);
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  recordsForSnapshot(
    snapshotId: string,
    source: "tickets" | "history",
  ): NormalizedNotionRecord[] {
    const rows = this.database.prepare(`
      SELECT source_key, notion_page_id, fields_json
      FROM analytical_snapshot_records
      WHERE snapshot_id = ? AND source_key = ?
      ORDER BY notion_page_id
    `).all(snapshotId, source) as SnapshotRecordRow[];

    return rows.map((row) => ({
      source: row.source_key,
      pageId: row.notion_page_id,
      fields: JSON.parse(row.fields_json) as NormalizedNotionRecord["fields"],
    }));
  }

  fail(runId: string, code: string, message: string, finishedAt = new Date()): SyncRun {
    const failure = normalizeError(code, message);
    const row = this.database.prepare(`
      UPDATE sync_runs
      SET status = 'failed', finished_at = ?, error_code = ?, error_message = ?
      WHERE id = ? AND status = 'running'
      RETURNING ${SYNC_RUN_COLUMNS}
    `).get(finishedAt.toISOString(), failure.code, failure.message, runId) as SyncRunRow | undefined;

    if (!row) {
      throw new SyncStoreError("run_unavailable", "A execução de sincronização não está disponível para registrar falha.");
    }
    return mapRun(row);
  }

  overview(limit = 10): SyncOverview {
    const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 50) : 10;
    const activeRow = this.database.prepare(`
      SELECT ${SYNC_RUN_COLUMNS}
      FROM sync_runs
      WHERE status = 'running'
      ORDER BY started_at DESC
      LIMIT 1
    `).get() as SyncRunRow | undefined;
    const snapshotRow = this.database.prepare(`
      SELECT id, status, ticket_count, event_count, warning_count, created_at, published_at
      FROM analytical_snapshots
      WHERE status = 'published'
      LIMIT 1
    `).get() as SnapshotRow | undefined;
    const recentRows = this.database.prepare(`
      SELECT ${SYNC_RUN_COLUMNS}
      FROM sync_runs
      ORDER BY started_at DESC
      LIMIT ?
    `).all(safeLimit) as SyncRunRow[];

    return {
      activeRun: activeRow ? mapRun(activeRow) : null,
      latestSnapshot: snapshotRow ? mapSnapshot(snapshotRow) : null,
      recentRuns: recentRows.map(mapRun),
    };
  }
}
