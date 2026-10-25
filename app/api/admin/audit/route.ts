import { AuditStore } from "@/app/lib/audit-store";
import { getApplicationDatabase } from "@/app/lib/database";
import { getCurrentSession } from "@/app/lib/request-session";

function noStoreJson(payload: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(payload, { ...init, headers });
}

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return noStoreJson({ ok: false, error: "Sessão inválida ou expirada." }, { status: 401 });
  if (session.user.mustChangePassword || session.user.role !== "administrador") {
    return noStoreJson({ ok: false, error: "Acesso restrito a administradores." }, { status: 403 });
  }

  const requestedLimit = Number(new URL(request.url).searchParams.get("limit") ?? "100");
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 200) : 100;

  try {
    return noStoreJson({ ok: true, events: new AuditStore(getApplicationDatabase().connection).list(limit) });
  } catch {
    return noStoreJson({ ok: false, error: "Não foi possível consultar o histórico de auditoria." }, { status: 503 });
  }
}
