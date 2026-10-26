import type { DatabaseSync } from "node:sqlite";

import type { NotionConfigurationStatus } from "./notion-configuration.ts";
import { notionMappingFields } from "./notion-mapping.ts";
import { NotionMappingStore } from "./notion-mapping-store.ts";
import { isSyncRunStale, SyncStore } from "./sync-store.ts";

export type SystemHealthStatus = "healthy" | "attention" | "critical";

export type SystemHealthCheck = {
  key: "database" | "integration" | "mapping" | "snapshot" | "jobs" | "process";
  label: string;
  status: SystemHealthStatus;
  summary: string;
  detail: string;
};

export type SystemHealthReport = {
  status: SystemHealthStatus;
  checkedAt: string;
  checks: SystemHealthCheck[];
};

type SystemHealthOptions = {
  database: DatabaseSync;
  schemaVersion: number;
  latestSchemaVersion: number;
  configuration: NotionConfigurationStatus;
  now?: Date;
  uptimeSeconds?: number;
};

const statusPriority: Record<SystemHealthStatus, number> = {
  healthy: 0,
  attention: 1,
  critical: 2,
};

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}min`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function databaseCheck(database: DatabaseSync, schemaVersion: number, latestSchemaVersion: number): SystemHealthCheck {
  try {
    const row = database.prepare("PRAGMA quick_check;").get() as Record<string, unknown> | undefined;
    const integrity = row ? String(Object.values(row)[0] ?? "") : "";
    const schemaReady = schemaVersion === latestSchemaVersion;
    const healthy = integrity === "ok" && schemaReady;
    return {
      key: "database",
      label: "Banco SQLite",
      status: healthy ? "healthy" : "critical",
      summary: healthy ? "Íntegro e atualizado" : "Verificação necessária",
      detail: integrity !== "ok"
        ? "A verificação de integridade do SQLite não retornou o estado esperado."
        : `Migração ${schemaVersion} de ${latestSchemaVersion} aplicada.`,
    };
  } catch {
    return {
      key: "database",
      label: "Banco SQLite",
      status: "critical",
      summary: "Diagnóstico indisponível",
      detail: "Não foi possível executar a verificação de integridade do banco.",
    };
  }
}

function integrationCheck(configuration: NotionConfigurationStatus): SystemHealthCheck {
  return {
    key: "integration",
    label: "Configuração do Notion",
    status: configuration.ready ? "healthy" : "attention",
    summary: configuration.ready ? "Credenciais configuradas" : "Configuração incompleta",
    detail: configuration.ready
      ? `${configuration.configuredSources}/${configuration.totalSources} bases configuradas; os valores secretos permanecem somente no servidor.`
      : `${configuration.configuredSources}/${configuration.totalSources} bases configuradas. Pendências: ${configuration.missing.join(", ")}.`,
  };
}

function mappingCheck(database: DatabaseSync): SystemHealthCheck {
  try {
    const mappings = new NotionMappingStore(database).list();
    const mappedKeys = new Set(mappings.map((mapping) => mapping.fieldKey));
    const required = notionMappingFields.filter((field) => field.required);
    const requiredMapped = required.filter((field) => mappedKeys.has(field.key)).length;
    const ready = requiredMapped === required.length;
    return {
      key: "mapping",
      label: "Mapeamento analítico",
      status: ready ? "healthy" : "attention",
      summary: ready ? "Campos obrigatórios completos" : "Campos obrigatórios pendentes",
      detail: `${requiredMapped}/${required.length} obrigatórios e ${mappedKeys.size}/${notionMappingFields.length} campos totais mapeados.`,
    };
  } catch {
    return {
      key: "mapping",
      label: "Mapeamento analítico",
      status: "critical",
      summary: "Diagnóstico indisponível",
      detail: "Não foi possível consultar os mapeamentos persistidos.",
    };
  }
}

function dataChecks(database: DatabaseSync, now: Date): SystemHealthCheck[] {
  try {
    const overview = new SyncStore(database).overview(1);
    const snapshot = overview.latestSnapshot;
    const latestRun = overview.recentRuns[0] ?? null;
    const snapshotCheck: SystemHealthCheck = snapshot
      ? {
        key: "snapshot",
        label: "Snapshot analítico",
        status: snapshot.warningCount > 0 ? "attention" : "healthy",
        summary: `${snapshot.ticketCount} chamados e ${snapshot.eventCount} eventos`,
        detail: `${snapshot.warningCount} alerta(s) na carga publicada em ${snapshot.publishedAt}.`,
      }
      : {
        key: "snapshot",
        label: "Snapshot analítico",
        status: "attention",
        summary: "Nenhuma carga publicada",
        detail: "Os painéis ainda não possuem uma cópia analítica proveniente do Notion.",
      };

    let jobsCheck: SystemHealthCheck;
    if (isSyncRunStale(overview.activeRun, now)) {
      jobsCheck = {
        key: "jobs",
        label: "Execuções de sincronização",
        status: "critical",
        summary: "Execução possivelmente interrompida",
        detail: "Há um job além do limite seguro; encerre-o na tela de Sincronização antes de tentar novamente.",
      };
    } else if (overview.activeRun) {
      jobsCheck = {
        key: "jobs",
        label: "Execuções de sincronização",
        status: "attention",
        summary: "Sincronização em andamento",
        detail: `Execução iniciada em ${overview.activeRun.startedAt}.`,
      };
    } else if (latestRun?.status === "failed") {
      jobsCheck = {
        key: "jobs",
        label: "Execuções de sincronização",
        status: "attention",
        summary: "Última execução falhou",
        detail: latestRun.error?.message ?? "Consulte a tela de Sincronização para revisar a falha.",
      };
    } else {
      jobsCheck = {
        key: "jobs",
        label: "Execuções de sincronização",
        status: "healthy",
        summary: latestRun ? "Última execução concluída" : "Nenhuma execução bloqueada",
        detail: latestRun?.finishedAt
          ? `Última conclusão em ${latestRun.finishedAt}.`
          : "A primeira sincronização ainda não foi executada.",
      };
    }
    return [snapshotCheck, jobsCheck];
  } catch {
    return [
      {
        key: "snapshot",
        label: "Snapshot analítico",
        status: "critical",
        summary: "Diagnóstico indisponível",
        detail: "Não foi possível consultar a carga analítica publicada.",
      },
      {
        key: "jobs",
        label: "Execuções de sincronização",
        status: "critical",
        summary: "Diagnóstico indisponível",
        detail: "Não foi possível consultar o histórico de sincronizações.",
      },
    ];
  }
}

export function createSystemHealthReport(options: SystemHealthOptions): SystemHealthReport {
  const now = options.now ?? new Date();
  const checks: SystemHealthCheck[] = [
    databaseCheck(options.database, options.schemaVersion, options.latestSchemaVersion),
    integrationCheck(options.configuration),
    mappingCheck(options.database),
    ...dataChecks(options.database, now),
    {
      key: "process",
      label: "Processo da aplicação",
      status: "healthy",
      summary: "Aplicação em execução",
      detail: `Tempo ativo neste processo: ${formatDuration(options.uptimeSeconds ?? process.uptime())}.`,
    },
  ];
  const status = checks.reduce<SystemHealthStatus>((current, check) => (
    statusPriority[check.status] > statusPriority[current] ? check.status : current
  ), "healthy");

  return { status, checkedAt: now.toISOString(), checks };
}
