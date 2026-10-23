import test from "node:test";
import assert from "node:assert/strict";

import { ApplicationDatabase } from "../app/lib/database.ts";
import {
  SESSION_ABSOLUTE_TIMEOUT_MS,
  SESSION_IDLE_TIMEOUT_MS,
  SessionStore,
  SessionStoreError,
} from "../app/lib/session-store.ts";
import { UserStore } from "../app/lib/user-store.ts";

async function createTestContext() {
  const database = new ApplicationDatabase(":memory:");
  const users = new UserStore(database.connection);
  const user = await users.create({
    email: "analista@upa.local",
    displayName: "Analista TI",
    role: "analista",
    temporaryPassword: "Senha temporária 456",
  });

  return { database, sessions: new SessionStore(database.connection), user };
}

test("cria sessão com token opaco e armazena somente seu hash", async () => {
  const { database, sessions, user } = await createTestContext();
  const now = new Date("2026-10-23T12:00:00.000Z");

  try {
    const created = sessions.create(user.id, now);
    const stored = database.connection.prepare(`
      SELECT token_hash, idle_expires_at, absolute_expires_at
      FROM user_sessions
      WHERE id = ?
    `).get(created.id);

    assert.match(created.token, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(stored.token_hash, created.token);
    assert.equal(stored.token_hash.length, 64);
    assert.equal(stored.idle_expires_at, new Date(now.getTime() + SESSION_IDLE_TIMEOUT_MS).toISOString());
    assert.equal(stored.absolute_expires_at, new Date(now.getTime() + SESSION_ABSOLUTE_TIMEOUT_MS).toISOString());
    assert.equal(created.user.email, user.email);
    assert.equal(created.user.mustChangePassword, true);
  } finally {
    database.close();
  }
});

test("renova a janela de inatividade sem ultrapassar o limite absoluto", async () => {
  const { database, sessions, user } = await createTestContext();
  const createdAt = new Date("2026-10-23T12:00:00.000Z");

  try {
    const created = sessions.create(user.id, createdAt);
    const afterActivity = sessions.resolve(created.token, new Date("2026-10-23T12:20:00.000Z"));
    assert.equal(afterActivity?.idleExpiresAt, "2026-10-23T12:50:00.000Z");

    let nearAbsoluteLimit = afterActivity;
    for (let minutes = 40; minutes <= 460; minutes += 20) {
      nearAbsoluteLimit = sessions.resolve(
        created.token,
        new Date(createdAt.getTime() + minutes * 60 * 1_000),
      );
      assert.ok(nearAbsoluteLimit);
    }
    assert.equal(nearAbsoluteLimit?.idleExpiresAt, "2026-10-23T20:00:00.000Z");
    assert.equal(sessions.resolve(created.token, new Date("2026-10-23T20:00:00.000Z")), null);
  } finally {
    database.close();
  }
});

test("expira por inatividade, permite logout e rejeita conta desativada", async () => {
  const { database, sessions, user } = await createTestContext();
  const now = new Date("2026-10-23T12:00:00.000Z");

  try {
    const idleSession = sessions.create(user.id, now);
    assert.equal(sessions.resolve(idleSession.token, new Date("2026-10-23T12:30:00.000Z")), null);

    const logoutSession = sessions.create(user.id, now);
    assert.equal(sessions.revoke(logoutSession.token, new Date("2026-10-23T12:05:00.000Z")), true);
    assert.equal(sessions.resolve(logoutSession.token, new Date("2026-10-23T12:06:00.000Z")), null);

    const inactiveSession = sessions.create(user.id, now);
    database.connection.prepare("UPDATE users SET is_active = 0 WHERE id = ?").run(user.id);
    assert.equal(sessions.resolve(inactiveSession.token, new Date("2026-10-23T12:10:00.000Z")), null);
    assert.throws(() => sessions.create(user.id, now), SessionStoreError);
  } finally {
    database.close();
  }
});

test("revoga todas as sessões do usuário sem afetar outras contas", async () => {
  const { database, sessions, user } = await createTestContext();
  const users = new UserStore(database.connection);
  const otherUser = await users.create({
    email: "outro@upa.local",
    displayName: "Outro Analista",
    role: "analista",
    temporaryPassword: "Outra senha temporária 789",
  });

  try {
    const first = sessions.create(user.id);
    const second = sessions.create(user.id);
    const other = sessions.create(otherUser.id);

    assert.equal(sessions.revokeAllForUser(user.id), 2);
    assert.equal(sessions.resolve(first.token), null);
    assert.equal(sessions.resolve(second.token), null);
    assert.ok(sessions.resolve(other.token));
  } finally {
    database.close();
  }
});
