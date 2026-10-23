import { generateTemporaryPassword } from "./passwords.ts";
import type { UserAccount, UserStore } from "./user-store.ts";

export type BootstrapAdministratorInput = {
  email: string;
  displayName: string;
  temporaryPassword?: string;
};

export type BootstrapAdministratorResult = {
  account: UserAccount;
  temporaryPassword: string;
  passwordWasGenerated: boolean;
};

export async function bootstrapFirstAdministrator(
  userStore: UserStore,
  input: BootstrapAdministratorInput,
): Promise<BootstrapAdministratorResult> {
  const passwordWasGenerated = !input.temporaryPassword;
  const temporaryPassword = input.temporaryPassword || generateTemporaryPassword();
  const account = await userStore.createFirstAdministrator({
    email: input.email,
    displayName: input.displayName,
    temporaryPassword,
  });

  return { account, temporaryPassword, passwordWasGenerated };
}
