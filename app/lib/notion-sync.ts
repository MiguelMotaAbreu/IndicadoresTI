import type { AuditActor, AuditStore } from "./audit-store.ts";
import { NotionClientError } from "./notion-client.ts";
import type { IngestionNotionMapping } from "./notion-mapping-store.ts";
import {
  NotionPreflightError,
  prepareNotionDataset,
  type NotionPreflightClient,
} from "./notion-preflight.ts";
import { SyncStore, SyncStoreError, type AnalyticalSnapshot, type SyncRun } from "./sync-store.ts";

export type NotionSyncOutcome =
  | { status: "succeeded"; snapshot: AnalyticalSnapshot }
  | { status: "failed"; run: SyncRun };

type NotionSyncDependencies = {
  runId: string;
  actor: AuditActor;
  client: NotionPreflightClient;
  mappings: readonly IngestionNotionMapping[];
  syncStore: SyncStore;
  auditStore: AuditStore;
  now?: () => Date;
};

function safeFailure(error: unknown): { code: string; message: string } {
  if (error instanceof NotionClientError || error instanceof NotionPreflightError || error instanceof SyncStoreError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "sync_failed",
    message: "A sincronização não pôde ser concluída. A última carga íntegra permanece publicada.",
  };
}

export async function executeNotionSync({
  runId,
  actor,
  client,
  mappings,
  syncStore,
  auditStore,
  now = () => new Date(),
}: NotionSyncDependencies): Promise<NotionSyncOutcome> {
  try {
    const prepared = await prepareNotionDataset(client, mappings, now);
    const completedAt = now();
    const snapshot = syncStore.publish(
      runId,
      {
        tickets: prepared.records.tickets,
        history: prepared.records.history,
        warningCount: prepared.diagnostic.warningCount,
      },
      completedAt,
      (published) => auditStore.append({
        actor,
        action: "sync.run_completed",
        targetType: "integration",
        targetId: published.id,
        targetLabel: "Notion",
        outcome: "success",
        summary: `Sincronização publicada com ${published.ticketCount} chamados, ${published.eventCount} eventos e ${published.warningCount} alerta(s).`,
      }, completedAt),
    );
    return { status: "succeeded", snapshot };
  } catch (error) {
    const failure = safeFailure(error);
    const completedAt = now();
    const run = syncStore.fail(
      runId,
      failure.code,
      failure.message,
      completedAt,
      () => auditStore.append({
        actor,
        action: "sync.run_completed",
        targetType: "integration",
        targetLabel: "Notion",
        outcome: "failure",
        summary: `Sincronização falhou (${failure.code}); a última carga íntegra foi preservada.`,
      }, completedAt),
    );
    return { status: "failed", run };
  }
}
