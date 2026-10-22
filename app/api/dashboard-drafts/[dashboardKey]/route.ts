import { dashboardLayouts } from "@/app/lib/dashboard-layouts";
import { getDashboardDraftStore } from "@/app/lib/dashboard-draft-store";
import { parseDashboardDraft } from "@/app/lib/dashboard-drafts";
import type { DashboardKey } from "@/app/mock-data";

const TEMPORARY_USER_ID = "admin";
const MAX_SNAPSHOT_LENGTH = 1_000_000;

function isDashboardKey(value: string): value is DashboardKey {
  return Object.hasOwn(dashboardLayouts, value);
}

function noStoreJson(payload: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(payload, { ...init, headers });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ dashboardKey: string }> },
) {
  const { dashboardKey } = await params;
  if (!isDashboardKey(dashboardKey)) {
    return noStoreJson({ ok: false, error: "Painel desconhecido." }, { status: 404 });
  }

  let serialized: string | null;
  try {
    serialized = getDashboardDraftStore().findSerialized(TEMPORARY_USER_ID, dashboardKey);
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
    getDashboardDraftStore().save(TEMPORARY_USER_ID, savedDraft);
  } catch {
    return noStoreJson({ ok: false, error: "Não foi possível gravar o rascunho no armazenamento." }, { status: 503 });
  }

  return noStoreJson({ ok: true, draft: savedDraft });
}
