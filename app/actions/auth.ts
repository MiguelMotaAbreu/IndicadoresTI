"use server";

import { redirect } from "next/navigation";

import { getApplicationDatabase } from "@/app/lib/database";
import { PasswordPolicyError } from "@/app/lib/passwords";
import {
  clearSessionCookie,
  getCurrentSession,
  getSessionToken,
  setSessionCookie,
} from "@/app/lib/request-session";
import { SessionStore } from "@/app/lib/session-store";
import { UserStore, UserStoreError } from "@/app/lib/user-store";

export type AuthFormState = {
  error: string | null;
};

function fieldValue(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

export async function login(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = fieldValue(formData, "email");
  const password = fieldValue(formData, "password");
  const database = getApplicationDatabase();
  const user = await new UserStore(database.connection).authenticate(email, password);

  if (!user) return { error: "Email ou senha incorretos." };

  const session = new SessionStore(database.connection).create(user.id);
  await setSessionCookie(session);
  redirect(user.mustChangePassword ? "/trocar-senha" : "/");
}

export async function changeTemporaryPassword(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (!session.user.mustChangePassword) redirect("/");

  const password = fieldValue(formData, "password");
  const confirmation = fieldValue(formData, "passwordConfirmation");
  if (password !== confirmation) return { error: "As senhas informadas não coincidem." };

  const database = getApplicationDatabase();
  const users = new UserStore(database.connection);
  try {
    await users.changePassword(session.user.id, password);
  } catch (error) {
    if (error instanceof PasswordPolicyError || error instanceof UserStoreError) {
      return { error: error.message };
    }
    throw error;
  }

  const sessions = new SessionStore(database.connection);
  sessions.revokeAllForUser(session.user.id);
  const replacement = sessions.create(session.user.id);
  await setSessionCookie(replacement);
  redirect("/");
}

export async function logout(): Promise<void> {
  const token = await getSessionToken();
  try {
    if (token) new SessionStore(getApplicationDatabase().connection).revoke(token);
  } finally {
    await clearSessionCookie();
  }
  redirect("/login");
}
