import { getApplicationDatabase } from "@/app/lib/database";
import { parseOverviewFilters } from "@/app/lib/overview-query";
import { getCurrentSession } from "@/app/lib/request-session";
import { calculateSlaAnalytics } from "@/app/lib/sla-analytics";
import { SyncStore } from "@/app/lib/sync-store";

function noStoreJson(payload: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(payload, { ...init, headers });
}

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return noStoreJson({ ok: false, error: "Sessão inválida ou expirada." }, { status: 401 });
  if (session.user.mustChangePassword) {
    return noStoreJson({ ok: false, error: "Troque a senha temporária antes de continuar." }, { status: 403 });
  }

  const filters = parseOverviewFilters(new URL(request.url).searchParams);
  if (!filters) return noStoreJson({ ok: false, error: "Os filtros informados são inválidos." }, { status: 400 });

  try {
    const store = new SyncStore(getApplicationDatabase().connection);
    const snapshot = store.overview(1).latestSnapshot;
    if (!snapshot) return noStoreJson({ ok: true, data: null, reason: "no_snapshot" });
    const data = calculateSlaAnalytics(snapshot, {
      tickets: store.recordsForSnapshot(snapshot.id, "tickets"),
    }, filters);
    return noStoreJson({ ok: true, data });
  } catch {
    return noStoreJson({ ok: false, error: "Não foi possível calcular tempos e SLA do snapshot publicado." }, { status: 503 });
  }
}
