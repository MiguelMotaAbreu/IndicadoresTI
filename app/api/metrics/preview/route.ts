import { dataFields } from "@/app/mock-data";
import {
  isMetricDefinitionDraft,
  validateMetricDefinition,
} from "@/app/lib/metrics";
import { getCurrentSession } from "@/app/lib/request-session";
import { parseOverviewFilters } from "@/app/lib/overview-query";
import { getApplicationDatabase } from "@/app/lib/database";
import { SnapshotMetricEvaluationError, previewSnapshotMetricDefinition } from "@/app/lib/snapshot-metrics";
import { SyncStore } from "@/app/lib/sync-store";

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return Response.json({ ok: false, error: "Sessão inválida ou expirada." }, { status: 401 });
  }
  if (session.user.mustChangePassword) {
    return Response.json({ ok: false, error: "Troque a senha temporária antes de continuar." }, { status: 403 });
  }

  const filters = parseOverviewFilters(new URL(request.url).searchParams);
  if (!filters) {
    return Response.json(
      { ok: false, errors: [{ code: "filtros_inválidos", message: "Os filtros informados são inválidos.", path: "filters" }] },
      { status: 400 },
    );
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { ok: false, errors: [{ code: "json_inválido", message: "O corpo da requisição deve ser um JSON válido.", path: "request" }] },
      { status: 400 },
    );
  }

  if (!isMetricDefinitionDraft(payload)) {
    return Response.json(
      { ok: false, errors: [{ code: "definição_inválida", message: "A definição da métrica está incompleta ou malformada.", path: "request" }] },
      { status: 400 },
    );
  }

  const validation = validateMetricDefinition(payload, dataFields);
  if (!validation.valid) {
    return Response.json({ ok: false, errors: validation.errors, warnings: validation.warnings }, { status: 422 });
  }

  try {
    const store = new SyncStore(getApplicationDatabase().connection);
    const snapshot = store.overview(1).latestSnapshot;
    if (!snapshot) {
      return Response.json(
        { ok: false, errors: [{ code: "snapshot_ausente", message: "Publique uma sincronização antes de calcular a métrica.", path: "snapshot" }] },
        { status: 409 },
      );
    }
    const preview = previewSnapshotMetricDefinition(payload, dataFields, {
      tickets: store.recordsForSnapshot(snapshot.id, "tickets"),
      history: store.recordsForSnapshot(snapshot.id, "history"),
    }, filters);
    return Response.json({ ok: true, preview });
  } catch (error) {
    return Response.json(
      { ok: false, errors: [{ code: "não_calculável", message: error instanceof SnapshotMetricEvaluationError ? error.message : "O resultado não pôde ser calculado com segurança.", path: "expression" }] },
      { status: 422 },
    );
  }
}
