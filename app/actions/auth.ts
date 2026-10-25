"use server";

import { redirect } from "next/navigation";

import { AuditStore } from "@/app/lib/audit-store";
import { getApplicationDatabase } from "@/app/lib/database";
import { PasswordPolicyError } from "@/app/lib/passwords";
import {
  clearSessionCookie,
  getCurrentSession,
  getSessionToken,
  setSessionCookie,
} from "@/app/lib/request-session";
import { SessionStore, type CreatedSession } from "@/app/lib/session-store";
import { UserStore, UserStoreError } from "@/app/lib/user-store";

export type AuthFormState = {
  error: string | null;
};

function fieldValue(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

function auditActor(user: { id: string; displayName: string; role: "administrador" | "analista" }) {
  return { userId: user.id, displayName: user.displayName, role: user.role };
}

function attemptedEmail(email: string): string | null {
  const normalized = email.trim().toLocaleLowerCase("pt-BR");
  return normalized ? normalized.slice(0, 254) : null;
}

export async function login(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = fieldValue(formData, "email");
  const password = fieldValue(formData, "password");
  const database = getApplicationDatabase();
  const user = await new UserStore(database.connection).authenticate(email, password);

  if (!user) {
    try {
      new AuditStore(database.connection).append({
        actor: null,
        action: "auth.login_failed",
        targetType: "account",
        targetLabel: attemptedEmail(email),
        outcome: "failure",
        summary: "Tentativa de acesso rejeitada.",
      });
    } catch {
      // Uma falha secundária de auditoria não deve revelar dados nem mudar a resposta de autenticação.
    }
    return { error: "Email ou senha incorretos." };
  }

  database.connection.exec("BEGIN IMMEDIATE;");
  let session: CreatedSession;
  try {
    session = new SessionStore(database.connection).create(user.id);
    new AuditStore(database.connection).append({
      actor: auditActor(user),
      action: "auth.login_succeeded",
      targetType: "session",
      targetId: session.id,
      targetLabel: user.email,
      outcome: "success",
      summary: "Sessão autenticada criada.",
    });
    database.connection.exec("COMMIT;");
  } catch (error) {
    database.connection.exec("ROLLBACK;");
    throw error;
  }
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
  let replacement: CreatedSession;
  try {
    const changed = await users.changePasswordAtomically(session.user.id, password, () => {
      const sessions = new SessionStore(database.connection);
      sessions.revokeAllForUser(session.user.id);
      const createdSession = sessions.create(session.user.id);
      new AuditStore(database.connection).append({
        actor: auditActor(session.user),
        action: "auth.password_changed",
        targetType: "account",
        targetId: session.user.id,
        targetLabel: session.user.email,
        outcome: "success",
        summary: "Senha temporária substituída e sessões anteriores revogadas.",
      });
      return createdSession;
    });
    replacement = changed.result;
  } catch (error) {
    if (error instanceof PasswordPolicyError || error instanceof UserStoreError) {
      return { error: error.message };
    }
    throw error;
  }

  await setSessionCookie(replacement);
  redirect("/");
}

export async function logout(): Promise<void> {
  const session = await getCurrentSession();
  const token = await getSessionToken();
  const database = getApplicationDatabase().connection;
  try {
    if (token) {
      database.exec("BEGIN IMMEDIATE;");
      try {
        new SessionStore(database).revoke(token);
        if (session) {
          new AuditStore(database).append({
            actor: auditActor(session.user),
            action: "auth.logout",
            targetType: "session",
            targetId: session.id,
            targetLabel: session.user.email,
            outcome: "success",
            summary: "Sessão encerrada pelo usuário.",
          });
        }
        database.exec("COMMIT;");
      } catch {
        database.exec("ROLLBACK;");
        new SessionStore(database).revoke(token);
      }
    }
  } finally {
    await clearSessionCookie();
  }
  redirect("/login");
}
