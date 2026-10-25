import { AuditStore } from "@/app/lib/audit-store";
import { getApplicationDatabase } from "@/app/lib/database";
import { generateTemporaryPassword, PasswordPolicyError } from "@/app/lib/passwords";
import { getCurrentSession } from "@/app/lib/request-session";
import { UserStore, UserStoreError, type UserRole } from "@/app/lib/user-store";

const MAX_REQUEST_BODY_LENGTH = 8_000;

function noStoreJson(payload: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(payload, { ...init, headers });
}

async function authorizeAdministrator() {
  const session = await getCurrentSession();
  if (!session) {
    return { response: noStoreJson({ ok: false, error: "Sessão inválida ou expirada." }, { status: 401 }) } as const;
  }
  if (session.user.mustChangePassword || session.user.role !== "administrador") {
    return { response: noStoreJson({ ok: false, error: "Acesso restrito a administradores." }, { status: 403 }) } as const;
  }
  return { session } as const;
}

export async function GET() {
  const authorization = await authorizeAdministrator();
  if ("response" in authorization) return authorization.response;

  try {
    return noStoreJson({ ok: true, users: new UserStore(getApplicationDatabase().connection).list() });
  } catch {
    return noStoreJson({ ok: false, error: "Não foi possível consultar os usuários." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const authorization = await authorizeAdministrator();
  if ("response" in authorization) return authorization.response;

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
    return noStoreJson({ ok: false, error: "Informe nome, email e perfil do usuário." }, { status: 422 });
  }
  const payload = parsedPayload as { displayName?: unknown; email?: unknown; role?: unknown };

  const temporaryPassword = generateTemporaryPassword();
  const database = getApplicationDatabase().connection;
  try {
    const { account: user } = await new UserStore(database).createAtomically(
      {
        displayName: typeof payload.displayName === "string" ? payload.displayName : "",
        email: typeof payload.email === "string" ? payload.email : "",
        role: payload.role as UserRole,
        temporaryPassword,
      },
      (createdUser) => new AuditStore(database).append({
        actor: {
          userId: authorization.session.user.id,
          displayName: authorization.session.user.displayName,
          role: authorization.session.user.role,
        },
        action: "user.created",
        targetType: "account",
        targetId: createdUser.id,
        targetLabel: createdUser.email,
        outcome: "success",
        summary: `Conta ${createdUser.role === "administrador" ? "Administrador" : "Analista"} criada.`,
      }),
    );
    return noStoreJson({ ok: true, user, temporaryPassword }, { status: 201 });
  } catch (error) {
    if (error instanceof UserStoreError) {
      return noStoreJson(
        { ok: false, error: error.message, code: error.code },
        { status: error.code === "email_duplicado" ? 409 : 422 },
      );
    }
    if (error instanceof PasswordPolicyError) {
      return noStoreJson({ ok: false, error: error.message }, { status: 422 });
    }
    return noStoreJson({ ok: false, error: "Não foi possível criar o usuário." }, { status: 503 });
  }
}
