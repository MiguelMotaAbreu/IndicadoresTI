import { AuditStore } from "@/app/lib/audit-store";
import { getApplicationDatabase } from "@/app/lib/database";
import { createOverviewCsvExport, OverviewCsvExportLimitError } from "@/app/lib/overview-export";
import { parseOverviewFilters } from "@/app/lib/overview-query";
import { getCurrentSession } from "@/app/lib/request-session";
import { SyncStore } from "@/app/lib/sync-store";

function noStoreJson(payload: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(payload, { ...init, headers });
}

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return noStoreJson({ ok: false, error: "Sessão inválida ou expirada." }, { status: 401 });
  }
  if (session.user.mustChangePassword) {
    return noStoreJson({ ok: false, error: "Troque a senha temporária antes de continuar." }, { status: 403 });
  }

  const filters = parseOverviewFilters(new URL(request.url).searchParams);
  if (!filters) {
    return noStoreJson({ ok: false, error: "Os filtros informados são inválidos." }, { status: 400 });
  }

  const database = getApplicationDatabase().connection;
  const audit = new AuditStore(database);
  const actor = {
    userId: session.user.id,
    displayName: session.user.displayName,
    role: session.user.role,
  };
  let snapshotId: string | null = null;

  try {
    const store = new SyncStore(database);
    const snapshot = store.overview(1).latestSnapshot;
    if (!snapshot) {
      audit.append({
        actor,
        action: "analytics.overview_exported",
        targetType: "snapshot",
        targetLabel: "Visão geral · CSV",
        outcome: "failure",
        summary: "Exportação CSV recusada porque ainda não existe um snapshot publicado.",
      });
      return noStoreJson({ ok: false, error: "Ainda não existe um snapshot publicado para exportar." }, { status: 404 });
    }
    snapshotId = snapshot.id;

    const exported = createOverviewCsvExport(
      snapshot,
      { tickets: store.recordsForSnapshot(snapshot.id, "tickets") },
      filters,
      session.user.role,
    );
    audit.append({
      actor,
      action: "analytics.overview_exported",
      targetType: "snapshot",
      targetId: snapshot.id,
      targetLabel: "Visão geral · CSV",
      outcome: "success",
      summary: `Exportação CSV concluída com ${exported.rowCount} registro(s); solicitantes mascarados: ${exported.requesterMasked ? "sim" : "não"}.`,
    });

    return new Response(exported.contents, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${exported.filename}"`,
        "Content-Type": "text/csv; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    try {
      audit.append({
        actor,
        action: "analytics.overview_exported",
        targetType: "snapshot",
        targetId: snapshotId,
        targetLabel: "Visão geral · CSV",
        outcome: "failure",
        summary: error instanceof OverviewCsvExportLimitError
          ? "Exportação CSV recusada porque o recorte excede o limite seguro de linhas."
          : "Exportação CSV não concluída por uma falha interna.",
      });
    } catch {
      // A resposta permanece genérica mesmo quando a auditoria também está indisponível.
    }

    if (error instanceof OverviewCsvExportLimitError) {
      return noStoreJson({ ok: false, error: error.message }, { status: 413 });
    }
    return noStoreJson({ ok: false, error: "Não foi possível exportar o recorte da Visão geral." }, { status: 503 });
  }
}
