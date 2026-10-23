import test from "node:test";
import assert from "node:assert/strict";

import { bootstrapFirstAdministrator } from "../app/lib/bootstrap-admin.ts";
import { ApplicationDatabase } from "../app/lib/database.ts";
import { verifyPassword } from "../app/lib/passwords.ts";
import { UserStore, UserStoreError } from "../app/lib/user-store.ts";

test("cria o primeiro administrador uma única vez e não expõe o hash", async () => {
  const database = new ApplicationDatabase(":memory:");
  const store = new UserStore(database.connection);

  try {
    const result = await bootstrapFirstAdministrator(store, {
      email: "  ADMIN@UPA.LOCAL ",
      displayName: "  Administrador   Local  ",
      temporaryPassword: "Senha temporária 123",
    });

    assert.equal(result.passwordWasGenerated, false);
    assert.equal(result.account.email, "admin@upa.local");
    assert.equal(result.account.displayName, "Administrador Local");
    assert.equal(result.account.role, "administrador");
    assert.equal(result.account.mustChangePassword, true);
    assert.equal(result.account.isActive, true);
    assert.equal("passwordHash" in result.account, false);
    assert.equal(store.count(), 1);

    const storedHash = database.connection.prepare("SELECT password_hash FROM users WHERE id = ?").get(result.account.id).password_hash;
    assert.equal(await verifyPassword("Senha temporária 123", storedHash), true);

    await assert.rejects(
      bootstrapFirstAdministrator(store, {
        email: "outro@upa.local",
        displayName: "Outro administrador",
      }),
      (error) => error instanceof UserStoreError && error.code === "bootstrap_indisponivel",
    );
    assert.equal(store.count(), 1);
  } finally {
    database.close();
  }
});

test("cria contas normalizadas e traduz email duplicado para erro de domínio", async () => {
  const database = new ApplicationDatabase(":memory:");
  const store = new UserStore(database.connection);

  try {
    const analyst = await store.create({
      email: "Analista@UPA.Local",
      displayName: "Analista TI",
      role: "analista",
      temporaryPassword: "Senha temporária 456",
    });

    assert.deepEqual(store.findByEmail(" ANALISTA@upa.local "), analyst);
    await assert.rejects(
      store.create({
        email: "analista@upa.local",
        displayName: "Segundo analista",
        role: "analista",
        temporaryPassword: "Senha temporária 789",
      }),
      (error) => error instanceof UserStoreError && error.code === "email_duplicado",
    );
  } finally {
    database.close();
  }
});

test("autentica somente credenciais corretas de contas ativas", async () => {
  const database = new ApplicationDatabase(":memory:");
  const store = new UserStore(database.connection);

  try {
    const analyst = await store.create({
      email: "analista@upa.local",
      displayName: "Analista TI",
      role: "analista",
      temporaryPassword: "Senha temporária 456",
    });

    assert.deepEqual(await store.authenticate(" ANALISTA@UPA.LOCAL ", "Senha temporária 456"), analyst);
    assert.equal(await store.authenticate("analista@upa.local", "senha incorreta"), null);
    assert.equal(await store.authenticate("inexistente@upa.local", "Senha temporária 456"), null);
    assert.equal(await store.authenticate("email-inválido", "Senha temporária 456"), null);

    database.connection.prepare(`
      UPDATE users
      SET is_active = 0, deactivated_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), analyst.id);
    assert.equal(await store.authenticate("analista@upa.local", "Senha temporária 456"), null);
  } finally {
    database.close();
  }
});

test("troca a senha temporária sem permitir reutilização", async () => {
  const database = new ApplicationDatabase(":memory:");
  const store = new UserStore(database.connection);

  try {
    const analyst = await store.create({
      email: "analista@upa.local",
      displayName: "Analista TI",
      role: "analista",
      temporaryPassword: "Senha temporária 456",
    });

    await assert.rejects(
      store.changePassword(analyst.id, "Senha temporária 456"),
      (error) => error instanceof UserStoreError && error.code === "senha_reutilizada",
    );

    const changed = await store.changePassword(analyst.id, "Nova senha definitiva 789");
    assert.equal(changed.mustChangePassword, false);
    assert.equal(await store.authenticate(analyst.email, "Senha temporária 456"), null);
    assert.deepEqual(await store.authenticate(analyst.email, "Nova senha definitiva 789"), changed);
    assert.deepEqual(store.findById(analyst.id), changed);
  } finally {
    database.close();
  }
});
