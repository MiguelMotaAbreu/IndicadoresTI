import { getApplicationDatabase } from "@/app/lib/database";
import { createOverviewDetails } from "@/app/lib/overview-details";
import { parseOverviewDetailsQuery } from "@/app/lib/overview-query";
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

  const query = parseOverviewDetailsQuery(new URL(request.url).searchParams);
  if (!query) {
    return noStoreJson({ ok: false, error: "Os filtros ou a paginação informados são inválidos." }, { status: 400 });
  }

  try {
    const store = new SyncStore(getApplicationDatabase().connection);
    const snapshot = store.overview(1).latestSnapshot;
    if (!snapshot) return noStoreJson({ ok: true, data: null, reason: "no_snapshot" });

    const data = createOverviewDetails(
      snapshot,
      { tickets: store.recordsForSnapshot(snapshot.id, "tickets") },
      query.filters,
      session.user.role,
      query.page,
      query.pageSize,
    );
    return noStoreJson({ ok: true, data });
  } catch {
    return noStoreJson(
      { ok: false, error: "Não foi possível detalhar o recorte do snapshot publicado." },
      { status: 503 },
    );
  }
}
