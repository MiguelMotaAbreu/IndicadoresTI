import test from "node:test";
import assert from "node:assert/strict";

import {
  generateTemporaryPassword,
  hashPassword,
  MAXIMUM_PASSWORD_LENGTH,
  MINIMUM_PASSWORD_LENGTH,
  PasswordPolicyError,
  verifyPassword,
} from "../app/lib/passwords.ts";

test("gera hashes scrypt com salt exclusivo e verifica a senha sem expô-la", async () => {
  const password = "Senha temporária segura";
  const firstHash = await hashPassword(password);
  const secondHash = await hashPassword(password);

  assert.match(firstHash, /^scrypt-v1\$N=16384,r=8,p=1\$/);
  assert.notEqual(firstHash, secondHash);
  assert.equal(firstHash.includes(password), false);
  assert.equal(await verifyPassword(password, firstHash), true);
  assert.equal(await verifyPassword("senha incorreta", firstHash), false);
  assert.equal(await verifyPassword(password, "hash-malformado"), false);
});

test("aplica limites explícitos à senha e gera uma senha temporária válida", async () => {
  await assert.rejects(hashPassword("a".repeat(MINIMUM_PASSWORD_LENGTH - 1)), PasswordPolicyError);
  await assert.rejects(hashPassword("a".repeat(MAXIMUM_PASSWORD_LENGTH + 1)), PasswordPolicyError);

  const temporaryPassword = generateTemporaryPassword();
  assert.ok(temporaryPassword.length >= MINIMUM_PASSWORD_LENGTH);
  assert.ok(temporaryPassword.length <= MAXIMUM_PASSWORD_LENGTH);
});
