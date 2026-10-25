import { AuditStore } from "@/app/lib/audit-store";
import { getApplicationDatabase } from "@/app/lib/database";
import { getCurrentSession } from "@/app/lib/request-session";
import { SessionStore } from "@/app/lib/session-store";
import { UserStore, UserStoreError } from "@/app/lib/user-store";

const MAX_REQUEST_BODY_LENGTH = 2_000;

function noStoreJson(payload: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(payload, { ...init, headers });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const session = await getCurrentSession();
  if (!session) return noStoreJson({ ok: false, error: "Sessão inválida ou expirada." }, { status: 401 });
  if (session.user.mustChangePassword || session.user.role !== "administrador") {
    return noStoreJson({ ok: false, error: "Acesso restrito a administradores." }, { status: 403 });
  }

  let rawPayload: string;
  try {
    rawPayload = await request.text();
  } catch {
    return noStoreJson({ ok: false, error: "Não foi possível ler os dados enviados." }, { status: 400 });
  }
  if (rawPayload.length > MAX_REQUEST_BODY_LENGTH) {
    return noStoreJson({ ok: false, error: "Os dados enviados excedem o limite permitido." }, { status: 413 });
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(rawPayload);
  } catch {
    return noStoreJson({ ok: false, error: "O corpo da requisição deve ser um JSON válido." }, { status: 400 });
  }
  if (typeof parsedPayload !== "object" || parsedPayload === null || Array.isArray(parsedPayload)) {
    return noStoreJson({ ok: false, error: "Informe se a conta deve ficar ativa." }, { status: 422 });
  }
  const payload = parsedPayload as { isActive?: unknown };
  if (typeof payload.isActive !== "boolean") {
    return noStoreJson({ ok: false, error: "Informe se a conta deve ficar ativa." }, { status: 422 });
  }

  const { userId } = await params;
  if (userId === session.user.id && !payload.isActive) {
    return noStoreJson(
      { ok: false, error: "Você não pode desativar a própria conta durante uma sessão ativa." },
      { status: 422 },
    );
  }

  const database = getApplicationDatabase().connection;
  database.exec("BEGIN IMMEDIATE;");
  try {
    const user = new UserStore(database).setActiveStatus(userId, payload.isActive);
    if (!payload.isActive) new SessionStore(database).revokeAllForUser(userId);
    new AuditStore(database).append({
      actor: {
        userId: session.user.id,
        displayName: session.user.displayName,
        role: session.user.role,
      },
      action: payload.isActive ? "user.reactivated" : "user.deactivated",
      targetType: "account",
      targetId: user.id,
      targetLabel: user.email,
      outcome: "success",
      summary: payload.isActive ? "Conta reativada." : "Conta desativada e sessões revogadas.",
    });
    database.exec("COMMIT;");
    return noStoreJson({ ok: true, user });
  } catch (error) {
    database.exec("ROLLBACK;");
    if (error instanceof UserStoreError) {
      return noStoreJson({ ok: false, error: error.message, code: error.code }, { status: 404 });
    }
    return noStoreJson({ ok: false, error: "Não foi possível atualizar a conta." }, { status: 503 });
  }
}
