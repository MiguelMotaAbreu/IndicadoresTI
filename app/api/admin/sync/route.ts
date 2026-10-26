import { after } from "next/server";
import { AuditStore } from "@/app/lib/audit-store";
import { getApplicationDatabase } from "@/app/lib/database";
import { NotionReadClient } from "@/app/lib/notion-client";
import { inspectNotionConfiguration, loadNotionConfiguration } from "@/app/lib/notion-configuration";
import { notionMappingFields } from "@/app/lib/notion-mapping";
import { NotionMappingStore } from "@/app/lib/notion-mapping-store";
import { executeNotionSync } from "@/app/lib/notion-sync";
import { getCurrentSession } from "@/app/lib/request-session";
import { SyncStore, SyncStoreError } from "@/app/lib/sync-store";

export const maxDuration = 300;

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

function mappingState(database: ReturnType<typeof getApplicationDatabase>["connection"]) {
  const store = new NotionMappingStore(database);
  const ingestionMappings = store.listForIngestion();
  const mappedKeys = new Set(ingestionMappings.map((mapping) => mapping.fieldKey));
  const requiredFields = notionMappingFields.filter((field) => field.required);
  return {
    ingestionMappings,
    overview: {
      mapped: mappedKeys.size,
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
    const configuration = inspectNotionConfiguration();
    const database = getApplicationDatabase().connection;
    const overview = new SyncStore(database).overview(10);
    const mapping = mappingState(database).overview;
    const blockedReason = !configuration.ready
      ? `Configuração pendente: ${configuration.missing.join(", ")}.`
      : !mapping.ready
        ? `Mapeamento obrigatório pendente: ${mapping.requiredMapped} de ${mapping.requiredTotal} campos configurados.`
        : overview.activeRun
          ? "Já existe uma sincronização em andamento."
          : "Configuração e mapeamentos prontos para sincronizar.";

    return noStoreJson({
      ok: true,
      configuration,
      mapping,
      capabilities: {
        canPreflight: configuration.ready && mapping.ready,
        canStart: configuration.ready && mapping.ready && !overview.activeRun,
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

export async function POST() {
  const authorization = await authorizeAdministrator();
  if ("response" in authorization) return authorization.response;

  const database = getApplicationDatabase().connection;
  const auditStore = new AuditStore(database);
  const syncStore = new SyncStore(database);
  const actor = {
    userId: authorization.session.user.id,
    displayName: authorization.session.user.displayName,
    role: authorization.session.user.role,
  };
  const configuration = loadNotionConfiguration();
  if (!configuration) {
    auditStore.append({
      actor,
      action: "sync.run_completed",
      targetType: "integration",
      targetLabel: "Notion",
      outcome: "failure",
      summary: "Sincronização recusada porque a configuração do Notion está incompleta.",
    });
    return noStoreJson(
      { ok: false, code: "configuration_missing", error: "A integração com o Notion ainda não está completamente configurada." },
      { status: 409 },
    );
  }

  const mapping = mappingState(database);
  if (!mapping.overview.ready) {
    auditStore.append({
      actor,
      action: "sync.run_completed",
      targetType: "integration",
      targetLabel: "Notion",
      outcome: "failure",
      summary: "Sincronização recusada porque o mapeamento obrigatório está incompleto.",
    });
    return noStoreJson(
      { ok: false, code: "mapping_incomplete", error: "Conclua os campos obrigatórios antes de sincronizar." },
      { status: 409 },
    );
  }

  try {
    const run = syncStore.start({ userId: actor.userId, displayName: actor.displayName });
    const client = new NotionReadClient(configuration);
    after(async () => {
      await executeNotionSync({
        runId: run.id,
        actor,
        client,
        mappings: mapping.ingestionMappings,
        syncStore,
        auditStore,
      });
    });
    return noStoreJson({ ok: true, run }, { status: 202 });
  } catch (error) {
    if (error instanceof SyncStoreError && error.code === "sync_in_progress") {
      return noStoreJson({ ok: false, code: error.code, error: error.message }, { status: 409 });
    }
    return noStoreJson(
      { ok: false, code: "sync_unavailable", error: "Não foi possível iniciar a sincronização." },
      { status: 503 },
    );
  }
}
