import { dashboardLayouts } from "@/app/lib/dashboard-layouts";
import { DashboardDraftStore } from "@/app/lib/dashboard-draft-store";
import { parseDashboardDraft } from "@/app/lib/dashboard-drafts";
import { getApplicationDatabase } from "@/app/lib/database";
import { getCurrentSession } from "@/app/lib/request-session";
import type { DashboardKey } from "@/app/mock-data";

const MAX_SNAPSHOT_LENGTH = 1_000_000;

function isDashboardKey(value: string): value is DashboardKey {
  return Object.hasOwn(dashboardLayouts, value);
}

function noStoreJson(payload: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(payload, { ...init, headers });
}

function getDashboardDraftStore(): DashboardDraftStore {
  return new DashboardDraftStore(getApplicationDatabase().connection);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ dashboardKey: string }> },
) {
  const session = await getCurrentSession();
  if (!session) return noStoreJson({ ok: false, error: "Sessão inválida ou expirada." }, { status: 401 });
  if (session.user.mustChangePassword) {
    return noStoreJson({ ok: false, error: "Troque a senha temporária antes de continuar." }, { status: 403 });
  }

  const { dashboardKey } = await params;
  if (!isDashboardKey(dashboardKey)) {
    return noStoreJson({ ok: false, error: "Painel desconhecido." }, { status: 404 });
  }

  let serialized: string | null;
  try {
    const store = getDashboardDraftStore();
    if (session.user.role === "administrador") store.adoptLegacyDrafts(session.user.id);
    serialized = store.findSerialized(session.user.id, dashboardKey);
  } catch {
    return noStoreJson({ ok: false, error: "Não foi possível consultar o armazenamento de rascunhos." }, { status: 503 });
  }
  if (!serialized) return noStoreJson({ ok: true, draft: null });

  const draft = parseDashboardDraft(serialized, dashboardKey, dashboardLayouts[dashboardKey]);
  if (!draft) {
    return noStoreJson({ ok: false, error: "O rascunho salvo está corrompido ou incompatível." }, { status: 500 });
  }

  return noStoreJson({ ok: true, draft });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ dashboardKey: string }> },
) {
  const session = await getCurrentSession();
  if (!session) return noStoreJson({ ok: false, error: "Sessão inválida ou expirada." }, { status: 401 });
  if (session.user.mustChangePassword) {
    return noStoreJson({ ok: false, error: "Troque a senha temporária antes de continuar." }, { status: 403 });
  }

  const { dashboardKey } = await params;
  if (!isDashboardKey(dashboardKey)) {
    return noStoreJson({ ok: false, error: "Painel desconhecido." }, { status: 404 });
  }

  let rawPayload: string;
  try {
    rawPayload = await request.text();
  } catch {
    return noStoreJson({ ok: false, error: "Não foi possível ler o rascunho enviado." }, { status: 400 });
  }

  if (rawPayload.length > MAX_SNAPSHOT_LENGTH) {
    return noStoreJson({ ok: false, error: "O rascunho excede o limite permitido." }, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    return noStoreJson({ ok: false, error: "O corpo da requisição deve ser um JSON válido." }, { status: 400 });
  }

  const parsed = parseDashboardDraft(JSON.stringify(payload), dashboardKey, dashboardLayouts[dashboardKey]);
  if (!parsed) {
    return noStoreJson({ ok: false, error: "O rascunho contém layout ou métricas inválidas." }, { status: 422 });
  }

  const savedDraft = { ...parsed, savedAt: new Date().toISOString() };
  try {
    getDashboardDraftStore().save(session.user.id, savedDraft);
  } catch {
    return noStoreJson({ ok: false, error: "Não foi possível gravar o rascunho no armazenamento." }, { status: 503 });
  }

  return noStoreJson({ ok: true, draft: savedDraft });
}
