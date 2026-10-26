import { getApplicationDatabase } from "@/app/lib/database";
import { inspectNotionConfiguration } from "@/app/lib/notion-configuration";
import { notionMappingFields } from "@/app/lib/notion-mapping";
import { NotionMappingStore } from "@/app/lib/notion-mapping-store";
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
    const database = getApplicationDatabase().connection;
    const overview = new SyncStore(database).overview(10);
    const mappedKeys = new Set(new NotionMappingStore(database).list().map((mapping) => mapping.fieldKey));
    const requiredFields = notionMappingFields.filter((field) => field.required);
    const mapping = {
      mapped: mappedKeys.size,
      total: notionMappingFields.length,
      requiredMapped: requiredFields.filter((field) => mappedKeys.has(field.key)).length,
      requiredTotal: requiredFields.length,
      ready: requiredFields.every((field) => mappedKeys.has(field.key)),
    };
    const blockedReason = !configuration.ready
      ? `Configuração pendente: ${configuration.missing.join(", ")}.`
      : !mapping.ready
        ? `Mapeamento obrigatório pendente: ${mapping.requiredMapped} de ${mapping.requiredTotal} campos configurados.`
        : "A pré-validação está disponível; a publicação da carga analítica ainda será habilitada em uma etapa posterior.";

    return noStoreJson({
      ok: true,
      configuration,
      mapping,
      capabilities: {
        canPreflight: configuration.ready && mapping.ready,
        canStart: false,
        blockedReason,
      },
      ...overview,
    });
  } catch {
    return noStoreJson(
      { ok: false, error: "Não foi possível consultar o estado das sincronizações." },
      { status: 503 },
    );
  }
}
