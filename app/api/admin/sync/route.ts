import { getApplicationDatabase } from "@/app/lib/database";
import { inspectNotionConfiguration } from "@/app/lib/notion-configuration";
import { getCurrentSession } from "@/app/lib/request-session";
import { SyncStore } from "@/app/lib/sync-store";

function noStoreJson(payload: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(payload, { ...init, headers });
}

export async function GET() {
  const session = await getCurrentSession();
  if (!session) {
    return noStoreJson({ ok: false, error: "Sessão inválida ou expirada." }, { status: 401 });
  }
  if (session.user.mustChangePassword || session.user.role !== "administrador") {
    return noStoreJson({ ok: false, error: "Acesso restrito a administradores." }, { status: 403 });
  }

  try {
    const configuration = inspectNotionConfiguration();
    const overview = new SyncStore(getApplicationDatabase().connection).overview(10);
    const blockedReason = configuration.ready
      ? "O conector e o mapeamento de propriedades ainda precisam ser habilitados."
      : `Configuração pendente: ${configuration.missing.join(", ")}.`;

    return noStoreJson({
      ok: true,
      configuration,
      capabilities: { canStart: false, blockedReason },
      ...overview,
    });
  } catch {
    return noStoreJson(
      { ok: false, error: "Não foi possível consultar o estado das sincronizações." },
      { status: 503 },
    );
  }
}
