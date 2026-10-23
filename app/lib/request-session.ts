import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { getApplicationDatabase } from "./database";
import { SessionStore, type AuthenticatedSession, type CreatedSession } from "./session-store";

export const SESSION_COOKIE_NAME = "pulseti_session";

function sessionStore(): SessionStore {
  return new SessionStore(getApplicationDatabase().connection);
}

export async function getSessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE_NAME)?.value ?? null;
}

export async function getCurrentSession(): Promise<AuthenticatedSession | null> {
  await connection();
  const token = await getSessionToken();
  return token ? sessionStore().resolve(token, new Date()) : null;
}

export async function requireApplicationSession(): Promise<AuthenticatedSession> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.user.mustChangePassword) redirect("/trocar-senha");
  return session;
}

export async function setSessionCookie(session: CreatedSession): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    expires: new Date(session.absoluteExpiresAt),
    path: "/",
    priority: "high",
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE_NAME);
}
