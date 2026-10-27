import { getApplicationDatabase } from "@/app/lib/database";
import {
  calculateOverviewAnalytics,
  type OverviewAnalyticsFilters,
  type OverviewPeriod,
} from "@/app/lib/overview-analytics";
import { getCurrentSession } from "@/app/lib/request-session";
import { SyncStore } from "@/app/lib/sync-store";

function noStoreJson(payload: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(payload, { ...init, headers });
}

function parseFilters(searchParams: URLSearchParams): OverviewAnalyticsFilters | null {
  const allowedKeys = new Set(["period", "sector", "priority", "status", "reason"]);
  if ([...searchParams.keys()].some((key) => !allowedKeys.has(key))) return null;
  if ([...allowedKeys].some((key) => searchParams.getAll(key).length > 1)) return null;

  const period = searchParams.get("period") ?? "all";
  if (period !== "all" && period !== "last90" && period !== "last30") return null;
  const dimension = (key: "sector" | "priority" | "status" | "reason") => {
    const value = searchParams.get(key)?.trim() ?? "";
    return value.length > 0 && value.length <= 120 ? value : value.length === 0 ? null : undefined;
  };
  const sector = dimension("sector");
  const priority = dimension("priority");
  const status = dimension("status");
  const reason = dimension("reason");
  if (sector === undefined || priority === undefined || status === undefined || reason === undefined) return null;
  return { period: period as OverviewPeriod, sector, priority, status, reason };
}

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return noStoreJson({ ok: false, error: "Sessão inválida ou expirada." }, { status: 401 });
  }
  if (session.user.mustChangePassword) {
    return noStoreJson({ ok: false, error: "Troque a senha temporária antes de continuar." }, { status: 403 });
  }

  const filters = parseFilters(new URL(request.url).searchParams);
  if (!filters) {
    return noStoreJson({ ok: false, error: "Os filtros informados são inválidos." }, { status: 400 });
  }

  try {
    const store = new SyncStore(getApplicationDatabase().connection);
    const snapshot = store.overview(1).latestSnapshot;
    if (!snapshot) {
      return noStoreJson({ ok: true, data: null, reason: "no_snapshot" });
    }
    const data = calculateOverviewAnalytics(
      snapshot,
      {
        tickets: store.recordsForSnapshot(snapshot.id, "tickets"),
        history: store.recordsForSnapshot(snapshot.id, "history"),
      },
      filters,
    );
    return noStoreJson({ ok: true, data });
  } catch {
    return noStoreJson(
      { ok: false, error: "Não foi possível calcular a visão geral do snapshot publicado." },
      { status: 503 },
    );
  }
}
