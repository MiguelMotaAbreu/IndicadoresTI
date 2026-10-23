import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { UserRole } from "./user-store.ts";

export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1_000;
export const SESSION_ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60 * 1_000;

const SESSION_TOKEN_BYTES = 32;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type AuthenticatedSession = {
  id: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    role: UserRole;
    mustChangePassword: boolean;
  };
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
};

export type CreatedSession = AuthenticatedSession & {
  token: string;
};

type SessionRow = {
  session_id: string;
  user_id: string;
  email: string;
  display_name: string;
  role: UserRole;
  must_change_password: number;
  is_active: number;
  created_at: string;
  last_seen_at: string;
  idle_expires_at: string;
  absolute_expires_at: string;
  revoked_at: string | null;
};

export class SessionStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionStoreError";
  }
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isoDate(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function mapSession(row: SessionRow): AuthenticatedSession {
  return {
    id: row.session_id,
    user: {
      id: row.user_id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      mustChangePassword: row.must_change_password === 1,
    },
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    idleExpiresAt: row.idle_expires_at,
    absoluteExpiresAt: row.absolute_expires_at,
  };
}

export class SessionStore {
  private readonly database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.database = database;
  }

  create(userId: string, now = new Date()): CreatedSession {
    const token = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
    const createdAt = now.toISOString();
    const absoluteExpiresAt = isoDate(now.getTime() + SESSION_ABSOLUTE_TIMEOUT_MS);
    const idleExpiresAt = isoDate(
      Math.min(now.getTime() + SESSION_IDLE_TIMEOUT_MS, Date.parse(absoluteExpiresAt)),
    );

    const result = this.database.prepare(`
      INSERT INTO user_sessions (
        id, token_hash, user_id, created_at, last_seen_at,
        idle_expires_at, absolute_expires_at
      )
      SELECT ?, ?, id, ?, ?, ?, ?
      FROM users
      WHERE id = ? AND is_active = 1
    `).run(
      randomUUID(),
      tokenHash(token),
      createdAt,
      createdAt,
      idleExpiresAt,
      absoluteExpiresAt,
      userId,
    );

    if (result.changes !== 1) {
      throw new SessionStoreError("Não foi possível criar uma sessão para esta conta.");
    }

    const session = this.findByTokenHash(tokenHash(token));
    if (!session) throw new SessionStoreError("A sessão criada não pôde ser recuperada.");

    return { ...mapSession(session), token };
  }

  resolve(token: string, now = new Date()): AuthenticatedSession | null {
    if (!SESSION_TOKEN_PATTERN.test(token)) return null;

    const hash = tokenHash(token);
    const row = this.findByTokenHash(hash);
    if (!row) return null;

    const nowIso = now.toISOString();
    if (
      row.revoked_at !== null ||
      row.is_active !== 1 ||
      row.idle_expires_at <= nowIso ||
      row.absolute_expires_at <= nowIso
    ) {
      if (row.revoked_at === null) {
        this.database.prepare(`
          UPDATE user_sessions
          SET revoked_at = ?
          WHERE token_hash = ? AND revoked_at IS NULL
        `).run(nowIso, hash);
      }
      return null;
    }

    const idleExpiresAt = isoDate(
      Math.min(now.getTime() + SESSION_IDLE_TIMEOUT_MS, Date.parse(row.absolute_expires_at)),
    );
    this.database.prepare(`
      UPDATE user_sessions
      SET last_seen_at = ?, idle_expires_at = ?
      WHERE token_hash = ? AND revoked_at IS NULL
    `).run(nowIso, idleExpiresAt, hash);

    return mapSession({
      ...row,
      last_seen_at: nowIso,
      idle_expires_at: idleExpiresAt,
    });
  }

  revoke(token: string, now = new Date()): boolean {
    if (!SESSION_TOKEN_PATTERN.test(token)) return false;

    const result = this.database.prepare(`
      UPDATE user_sessions
      SET revoked_at = ?
      WHERE token_hash = ? AND revoked_at IS NULL
    `).run(now.toISOString(), tokenHash(token));

    return result.changes === 1;
  }

  revokeAllForUser(userId: string, now = new Date()): number {
    const result = this.database.prepare(`
      UPDATE user_sessions
      SET revoked_at = ?
      WHERE user_id = ? AND revoked_at IS NULL
    `).run(now.toISOString(), userId);

    return Number(result.changes);
  }

  private findByTokenHash(hash: string): SessionRow | null {
    const row = this.database.prepare(`
      SELECT
        sessions.id AS session_id,
        users.id AS user_id,
        users.email,
        users.display_name,
        users.role,
        users.must_change_password,
        users.is_active,
        sessions.created_at,
        sessions.last_seen_at,
        sessions.idle_expires_at,
        sessions.absolute_expires_at,
        sessions.revoked_at
      FROM user_sessions AS sessions
      INNER JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ?
    `).get(hash) as SessionRow | undefined;

    return row ?? null;
  }
}
