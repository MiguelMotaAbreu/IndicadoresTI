import { AuditStore } from "@/app/lib/audit-store";
import { getApplicationDatabase } from "@/app/lib/database";
import { getCurrentSession } from "@/app/lib/request-session";
import { SYNC_STALE_AFTER_MS, SyncStore, SyncStoreError } from "@/app/lib/sync-store";

function noStoreJson(payload: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(payload, { ...init, headers });
}

export async function POST() {
  const session = await getCurrentSession();
  if (!session) {
    return noStoreJson({ ok: false, error: "Sessão inválida ou expirada." }, { status: 401 });
  }
  if (session.user.mustChangePassword || session.user.role !== "administrador") {
    return noStoreJson({ ok: false, error: "Acesso restrito a administradores." }, { status: 403 });
  }

  const database = getApplicationDatabase().connection;
  const syncStore = new SyncStore(database);
  const activeRun = syncStore.overview(1).activeRun;
  if (!activeRun) {
    return noStoreJson(
      { ok: false, code: "run_not_recoverable", error: "Não existe uma sincronização em andamento para recuperar." },
      { status: 409 },
    );
  }

  const recoveredAt = new Date();
  const staleBefore = new Date(recoveredAt.getTime() - SYNC_STALE_AFTER_MS);
  const actor = {
    userId: session.user.id,
    displayName: session.user.displayName,
    role: session.user.role,
  };
  try {
    const run = syncStore.recoverInterrupted(
      activeRun.id,
      staleBefore,
      recoveredAt,
      (recovered) => new AuditStore(database).append({
        actor,
        action: "sync.run_recovered",
        targetType: "integration",
        targetId: recovered.id,
        targetLabel: "Notion",
        outcome: "success",
        summary: "Execução interrompida encerrada manualmente; o último snapshot íntegro foi preservado.",
      }, recoveredAt),
    );
    return noStoreJson({ ok: true, run });
  } catch (error) {
    if (error instanceof SyncStoreError && error.code === "run_not_recoverable") {
      return noStoreJson({ ok: false, code: error.code, error: error.message }, { status: 409 });
    }
    return noStoreJson(
      { ok: false, code: "recovery_unavailable", error: "Não foi possível encerrar a execução interrompida." },
      { status: 503 },
    );
  }
}
