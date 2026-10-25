import test from "node:test";
import assert from "node:assert/strict";

import { AuditStore } from "../app/lib/audit-store.ts";
import { ApplicationDatabase } from "../app/lib/database.ts";
import { UserStore } from "../app/lib/user-store.ts";

test("registra e lista eventos sem credenciais ou objetos mutáveis", async () => {
  const database = new ApplicationDatabase(":memory:");
  const users = new UserStore(database.connection);
  const audit = new AuditStore(database.connection);

  try {
    const administrator = await users.create({
      email: "admin@upa.local",
      displayName: "Administrador local",
      role: "administrador",
      temporaryPassword: "Senha temporária 123",
    });
    const actor = {
      userId: administrator.id,
      displayName: administrator.displayName,
      role: administrator.role,
    };

    const first = audit.append({
      actor: null,
      action: "auth.login_failed",
      targetType: "account",
      targetLabel: "desconhecido@upa.local",
      outcome: "failure",
      summary: "Tentativa de acesso rejeitada.",
    }, new Date("2026-10-23T12:00:00.000Z"));
    const second = audit.append({
      actor,
      action: "auth.login_succeeded",
      targetType: "session",
      targetId: "session-id",
      targetLabel: administrator.email,
      outcome: "success",
      summary: "Sessão autenticada criada.",
    }, new Date("2026-10-23T12:01:00.000Z"));

    assert.deepEqual(audit.list(), [second, first]);
    const serializedEvents = JSON.stringify(audit.list());
    assert.equal(serializedEvents.includes("Senha temporária 123"), false);
    assert.equal(serializedEvents.includes("password"), false);
    assert.equal(serializedEvents.includes("token"), false);
  } finally {
    database.close();
  }
});

test("preserva o retrato do ator e limita a quantidade consultada", async () => {
  const database = new ApplicationDatabase(":memory:");
  const users = new UserStore(database.connection);
  const audit = new AuditStore(database.connection);

  try {
    const administrator = await users.create({
      email: "admin@upa.local",
      displayName: "Nome original",
      role: "administrador",
      temporaryPassword: "Senha temporária 123",
    });
    const actor = { userId: administrator.id, displayName: administrator.displayName, role: administrator.role };

    audit.append({
      actor,
      action: "user.created",
      targetType: "account",
      targetId: "novo-usuario",
      targetLabel: "analista@upa.local",
      outcome: "success",
      summary: "Conta Analista criada.",
    });
    database.connection.prepare("UPDATE users SET display_name = ? WHERE id = ?").run("Nome alterado", administrator.id);

    assert.equal(audit.list(1).length, 1);
    assert.equal(audit.list(1)[0].actor.displayName, "Nome original");
    assert.equal(audit.list(0).length, 1);
  } finally {
    database.close();
  }
});

test("registra diagnóstico de integração sem armazenar credenciais", async () => {
  const database = new ApplicationDatabase(":memory:");
  const audit = new AuditStore(database.connection);

  try {
    const event = audit.append({
      actor: null,
      action: "sync.connection_tested",
      targetType: "integration",
      targetLabel: "Notion",
      outcome: "failure",
      summary: "Teste de conexão recusado porque a configuração está incompleta.",
    });

    assert.equal(event.action, "sync.connection_tested");
    assert.equal(event.targetType, "integration");
    assert.equal(event.targetLabel, "Notion");
  } finally {
    database.close();
  }
});
