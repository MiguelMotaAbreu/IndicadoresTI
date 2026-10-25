import { AuditStore } from "@/app/lib/audit-store";
import { getApplicationDatabase } from "@/app/lib/database";
import { NotionClientError, NotionReadClient } from "@/app/lib/notion-client";
import { loadNotionConfiguration } from "@/app/lib/notion-configuration";
import { getCurrentSession } from "@/app/lib/request-session";

function noStoreJson(payload: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(payload, { ...init, headers });
}

function statusForNotionError(error: NotionClientError): number {
  if (error.code === "configuration_missing") return 409;
  if (error.code === "multiple_data_sources" || error.code === "invalid_response") return 422;
  if (error.code === "rate_limited" || error.code === "unavailable") return 503;
  return 502;
}

export async function POST() {
  const session = await getCurrentSession();
  if (!session) {
    return noStoreJson({ ok: false, error: "Sessão inválida ou expirada." }, { status: 401 });
  }
  if (session.user.mustChangePassword || session.user.role !== "administrador") {
    return noStoreJson({ ok: false, error: "Acesso restrito a administradores." }, { status: 403 });
  }

  const database = getApplicationDatabase().connection;
  const audit = new AuditStore(database);
  const actor = {
    userId: session.user.id,
    displayName: session.user.displayName,
    role: session.user.role,
  };
  const configuration = loadNotionConfiguration();

  if (!configuration) {
    audit.append({
      actor,
      action: "sync.connection_tested",
      targetType: "integration",
      targetLabel: "Notion",
      outcome: "failure",
      summary: "Teste de conexão recusado porque a configuração está incompleta.",
    });
    return noStoreJson(
      { ok: false, code: "configuration_missing", error: "A integração com o Notion ainda não está completamente configurada." },
      { status: 409 },
    );
  }

  try {
    const diagnostic = await new NotionReadClient(configuration).testConnection();
    audit.append({
      actor,
      action: "sync.connection_tested",
      targetType: "integration",
      targetLabel: "Notion",
      outcome: "success",
      summary: `Conexão somente leitura validada para ${diagnostic.sources.length} fontes.`,
    });
    return noStoreJson({ ok: true, ...diagnostic });
  } catch (error) {
    const safeError = error instanceof NotionClientError
      ? error
      : new NotionClientError("unavailable");
    audit.append({
      actor,
      action: "sync.connection_tested",
      targetType: "integration",
      targetLabel: "Notion",
      outcome: "failure",
      summary: `Teste de conexão com o Notion falhou (${safeError.code}).`,
    });
    return noStoreJson(
      { ok: false, code: safeError.code, error: safeError.message },
      { status: statusForNotionError(safeError) },
    );
  }
}
