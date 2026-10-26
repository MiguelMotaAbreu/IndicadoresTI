import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { UserRole } from "./user-store.ts";

export type AuditAction =
  | "auth.login_succeeded"
  | "auth.login_failed"
  | "auth.password_changed"
  | "auth.logout"
  | "user.created"
  | "user.deactivated"
  | "user.reactivated"
  | "sync.connection_tested"
  | "sync.mapping_saved"
  | "sync.preflight_completed"
  | "sync.run_completed"
  | "sync.run_recovered";

export type AuditOutcome = "success" | "failure";

export type AuditActor = {
  userId: string;
  displayName: string;
  role: UserRole;
};

export type AppendAuditEventInput = {
  actor: AuditActor | null;
  action: AuditAction;
  targetType: "account" | "session" | "integration";
  targetId?: string | null;
  targetLabel?: string | null;
  outcome: AuditOutcome;
  summary: string;
};

export type AuditEvent = {
  id: string;
  occurredAt: string;
  actor: AuditActor | null;
  action: AuditAction;
  targetType: "account" | "session" | "integration";
  targetId: string | null;
  targetLabel: string | null;
  outcome: AuditOutcome;
  summary: string;
};

type AuditEventRow = {
  id: string;
  occurred_at: string;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_role: UserRole | null;
  action: AuditAction;
  target_type: "account" | "session" | "integration";
  target_id: string | null;
  target_label: string | null;
  outcome: AuditOutcome;
  summary: string;
};

function normalizeOptional(value: string | null | undefined, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maximumLength) : null;
}

function normalizeSummary(summary: string): string {
  const normalized = typeof summary === "string" ? summary.trim().replace(/\s+/g, " ") : "";
  if (normalized.length < 3 || normalized.length > 500) {
    throw new Error("O resumo do evento de auditoria deve ter entre 3 e 500 caracteres.");
  }
  return normalized;
}

function mapAuditEvent(row: AuditEventRow): AuditEvent {
  const actor = row.actor_user_id && row.actor_name && row.actor_role
    ? { userId: row.actor_user_id, displayName: row.actor_name, role: row.actor_role }
    : null;

  return {
    id: row.id,
    occurredAt: row.occurred_at,
    actor,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    targetLabel: row.target_label,
    outcome: row.outcome,
    summary: row.summary,
  };
}

export class AuditStore {
  private readonly database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.database = database;
  }

  append(input: AppendAuditEventInput, occurredAt = new Date()): AuditEvent {
    const row = this.database.prepare(`
      INSERT INTO audit_events (
        id, occurred_at, actor_user_id, actor_name, actor_role, action,
        target_type, target_id, target_label, outcome, summary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING
        id, occurred_at, actor_user_id, actor_name, actor_role, action,
        target_type, target_id, target_label, outcome, summary
    `).get(
      randomUUID(),
      occurredAt.toISOString(),
      input.actor?.userId ?? null,
      normalizeOptional(input.actor?.displayName, 100),
      input.actor?.role ?? null,
      input.action,
      input.targetType,
      normalizeOptional(input.targetId, 254),
      normalizeOptional(input.targetLabel, 254),
      input.outcome,
      normalizeSummary(input.summary),
    ) as AuditEventRow;

    return mapAuditEvent(row);
  }

  list(limit = 100): AuditEvent[] {
    const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 200) : 100;
    const rows = this.database.prepare(`
      SELECT
        id, occurred_at, actor_user_id, actor_name, actor_role, action,
        target_type, target_id, target_label, outcome, summary
      FROM audit_events
      ORDER BY sequence DESC
      LIMIT ?
    `).all(safeLimit) as AuditEventRow[];

    return rows.map(mapAuditEvent);
  }
}
