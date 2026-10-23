import { bootstrapFirstAdministrator } from "../app/lib/bootstrap-admin.ts";
import { getApplicationDatabase } from "../app/lib/database.ts";
import { UserStore, UserStoreError } from "../app/lib/user-store.ts";
import { PasswordPolicyError } from "../app/lib/passwords.ts";

const email = process.env.PULSETI_BOOTSTRAP_ADMIN_EMAIL?.trim() ?? "";
const displayName = process.env.PULSETI_BOOTSTRAP_ADMIN_NAME?.trim() ?? "";
const suppliedPassword = process.env.PULSETI_BOOTSTRAP_ADMIN_PASSWORD;
delete process.env.PULSETI_BOOTSTRAP_ADMIN_PASSWORD;

if (!email || !displayName) {
  process.stderr.write(
    "Defina PULSETI_BOOTSTRAP_ADMIN_EMAIL e PULSETI_BOOTSTRAP_ADMIN_NAME antes de executar o bootstrap.\n",
  );
  process.exitCode = 1;
} else {
  const database = getApplicationDatabase();

  try {
    const result = await bootstrapFirstAdministrator(new UserStore(database.connection), {
      email,
      displayName,
      temporaryPassword: suppliedPassword,
    });

    process.stdout.write(`Primeiro administrador criado: ${result.account.email}\n`);
    process.stdout.write("A troca de senha será obrigatória no primeiro acesso.\n");
    if (result.passwordWasGenerated) {
      process.stdout.write(`Senha temporária gerada (exibida uma única vez): ${result.temporaryPassword}\n`);
    } else {
      process.stdout.write("Foi utilizada a senha temporária fornecida pela variável de ambiente.\n");
    }
  } catch (error) {
    if (error instanceof UserStoreError || error instanceof PasswordPolicyError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      process.stderr.write("Não foi possível criar o primeiro administrador.\n");
    }
    process.exitCode = 1;
  } finally {
    database.close();
  }
}
