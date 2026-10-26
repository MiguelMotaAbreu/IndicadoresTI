import { getApplicationDatabase, LATEST_DATABASE_VERSION } from "@/app/lib/database";
import { inspectNotionConfiguration } from "@/app/lib/notion-configuration";
import { getCurrentSession } from "@/app/lib/request-session";
import { createSystemHealthReport } from "@/app/lib/system-health";

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
    const applicationDatabase = getApplicationDatabase();
    const report = createSystemHealthReport({
      database: applicationDatabase.connection,
      schemaVersion: applicationDatabase.schemaVersion,
      latestSchemaVersion: LATEST_DATABASE_VERSION,
      configuration: inspectNotionConfiguration(),
    });
    return noStoreJson({ ok: true, report });
  } catch {
    return noStoreJson(
      { ok: false, error: "Não foi possível executar o diagnóstico da instalação." },
      { status: 503 },
    );
  }
}
