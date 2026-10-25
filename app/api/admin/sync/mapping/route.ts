import { AuditStore } from "@/app/lib/audit-store";
import { getApplicationDatabase } from "@/app/lib/database";
import { NotionClientError, NotionReadClient } from "@/app/lib/notion-client";
import { inspectNotionConfiguration, loadNotionConfiguration } from "@/app/lib/notion-configuration";
import { NotionMappingError, notionMappingFields, validateNotionMapping } from "@/app/lib/notion-mapping";
import { NotionMappingStore } from "@/app/lib/notion-mapping-store";
import { getCurrentSession } from "@/app/lib/request-session";

const MAX_REQUEST_BODY_LENGTH = 32_000;

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

function notionErrorStatus(error: NotionClientError): number {
  if (error.code === "configuration_missing") return 409;
  if (error.code === "multiple_data_sources" || error.code === "invalid_response") return 422;
  if (error.code === "rate_limited" || error.code === "unavailable") return 503;
  return 502;
}

function mappingPayload() {
  const mappings = new NotionMappingStore(getApplicationDatabase().connection).list();
  const mappedKeys = new Set(mappings.map((mapping) => mapping.fieldKey));
  const requiredFields = notionMappingFields.filter((field) => field.required);
  return {
    configuration: inspectNotionConfiguration(),
    fields: notionMappingFields,
    mappings,
    completeness: {
      mapped: mappings.length,
      total: notionMappingFields.length,
      requiredMapped: requiredFields.filter((field) => mappedKeys.has(field.key)).length,
      requiredTotal: requiredFields.length,
      ready: requiredFields.every((field) => mappedKeys.has(field.key)),
    },
  };
}

export async function GET() {
  const authorization = await authorizeAdministrator();
  if ("response" in authorization) return authorization.response;

  try {
    return noStoreJson({ ok: true, ...mappingPayload() });
  } catch {
    return noStoreJson({ ok: false, error: "Não foi possível consultar os mapeamentos." }, { status: 503 });
  }
}

export async function PUT(request: Request) {
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

  let payload: unknown;
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    return noStoreJson({ ok: false, error: "O corpo da requisição deve ser um JSON válido." }, { status: 400 });
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload) || !("mappings" in payload)) {
    return noStoreJson({ ok: false, error: "Informe o conjunto de mapeamentos." }, { status: 422 });
  }

  const configuration = loadNotionConfiguration();
  if (!configuration) {
    return noStoreJson(
      { ok: false, code: "configuration_missing", error: "Configure a integração antes de salvar os mapeamentos." },
      { status: 409 },
    );
  }

  try {
    const schemas = await new NotionReadClient(configuration).loadSchema();
    const validated = validateNotionMapping((payload as { mappings: unknown }).mappings, schemas);
    const database = getApplicationDatabase().connection;
    const actor = {
      userId: authorization.session.user.id,
      displayName: authorization.session.user.displayName,
    };
    const { mappings } = new NotionMappingStore(database).saveAtomically(
      validated,
      actor,
      (saved) => new AuditStore(database).append({
        actor: { ...actor, role: authorization.session.user.role },
        action: "sync.mapping_saved",
        targetType: "integration",
        targetLabel: "Notion",
        outcome: "success",
        summary: `Mapeamento analítico salvo com ${saved.length} propriedades.`,
      }),
    );
    return noStoreJson({ ok: true, ...mappingPayload(), mappings });
  } catch (error) {
    if (error instanceof NotionMappingError) {
      return noStoreJson(
        { ok: false, code: "invalid_mapping", error: error.message, issues: error.issues },
        { status: 422 },
      );
    }
    if (error instanceof NotionClientError) {
      return noStoreJson(
        { ok: false, code: error.code, error: error.message },
        { status: notionErrorStatus(error) },
      );
    }
    return noStoreJson({ ok: false, error: "Não foi possível salvar os mapeamentos." }, { status: 503 });
  }
}
