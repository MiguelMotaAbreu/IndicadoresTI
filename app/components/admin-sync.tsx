"use client";

import { useEffect, useState } from "react";
import {
  ActivityIcon,
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  CloudCheckIcon,
  DatabaseIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";

type SnapshotCounts = {
  ticketCount: number;
  eventCount: number;
  warningCount: number;
};

type SyncRun = {
  id: string;
  requestedBy: { userId: string | null; displayName: string };
  status: "running" | "succeeded" | "failed";
  startedAt: string;
  finishedAt: string | null;
  counts: SnapshotCounts | null;
  error: { code: string; message: string } | null;
};

type SyncResponse = {
  ok: true;
  configuration: {
    ready: boolean;
    configuredSources: number;
    totalSources: number;
    missing: string[];
  };
  capabilities: { canStart: boolean; blockedReason: string };
  activeRun: SyncRun | null;
  latestSnapshot: (SnapshotCounts & { id: string; publishedAt: string }) | null;
  recentRuns: SyncRun[];
};

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Data indisponível" : dateFormatter.format(parsed);
}

function runLabel(status: SyncRun["status"]): string {
  if (status === "running") return "Em andamento";
  if (status === "succeeded") return "Publicada";
  return "Falhou";
}

async function loadSyncState(signal?: AbortSignal): Promise<SyncResponse> {
  const response = await fetch("/api/admin/sync", { cache: "no-store", signal });
  const payload = await response.json().catch(() => null) as unknown;
  const isObject = typeof payload === "object" && payload !== null;
  const errorMessage = isObject && "error" in payload && typeof payload.error === "string"
    ? payload.error
    : null;
  if (!response.ok || !isObject || !("ok" in payload) || payload.ok !== true) {
    throw new Error(errorMessage
      ? errorMessage
      : "Não foi possível carregar as sincronizações.");
  }
  return payload as SyncResponse;
}

export function AdminSync() {
  const [state, setState] = useState<SyncResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh(signal?: AbortSignal) {
    setLoading(true);
    setError(null);
    try {
      setState(await loadSyncState(signal));
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar as sincronizações.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadSyncState(controller.signal)
      .then(setState)
      .catch((loadError) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar as sincronizações.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const snapshot = state?.latestSnapshot ?? null;
  const latestRun = state?.recentRuns[0] ?? null;
  const integrityLabel = state?.activeRun
    ? "Carga em processamento"
    : latestRun?.status === "failed"
      ? "Última tentativa falhou"
      : snapshot
        ? snapshot.warningCount > 0 ? "Publicada com alertas" : "Sem bloqueios"
        : "Aguardando primeira carga";

  return (
    <div className="admin-sync">
      <div className="admin-section-heading">
        <div><h2>Sincronização com o Notion</h2><p>A última carga íntegra permanece publicada enquanto uma nova carga é preparada e validada.</p></div>
        <div className="admin-sync__actions">
          <button className="button button--ghost" disabled={loading} onClick={() => void refresh()}><ArrowsClockwiseIcon className={loading ? "spin" : ""} size={16} />Atualizar estado</button>
          <button className="button button--primary" disabled title={state?.capabilities.blockedReason ?? "Carregando disponibilidade."}><ArrowsClockwiseIcon size={17} />Sincronizar agora</button>
        </div>
      </div>

      {error && <div className="admin-users__error" role="alert"><WarningCircleIcon size={18} weight="fill" /><span>{error}</span></div>}

      <div className="sync-overview">
        <span>
          <CloudCheckIcon size={22} weight="fill" />
          <b>Última carga íntegra</b>
          <strong>{loading && !state ? "Consultando..." : snapshot ? formatDate(snapshot.publishedAt) : "Nenhuma carga publicada"}</strong>
          <small>{snapshot ? `${snapshot.ticketCount} chamados · ${snapshot.eventCount} eventos` : "Os painéis ainda usam dados demonstrativos."}</small>
        </span>
        <span className={state?.configuration.ready ? "" : "has-warning"}>
          <DatabaseIcon size={22} />
          <b>Fonte</b>
          <strong>{state?.configuration.ready ? "Notion · Somente leitura" : "Configuração pendente"}</strong>
          <small>{state ? `${state.configuration.configuredSources} de ${state.configuration.totalSources} bases informadas` : "Consultando configuração..."}</small>
        </span>
        <span className={latestRun?.status === "failed" ? "has-warning" : ""}>
          <ActivityIcon size={22} />
          <b>Integridade</b>
          <strong>{integrityLabel}</strong>
          <small>{snapshot ? `${snapshot.warningCount} alerta(s) na carga publicada` : "Nenhum snapshot analítico disponível"}</small>
        </span>
      </div>

      {state?.activeRun && <div className="sync-progress"><span><b>Sincronização iniciada por {state.activeRun.requestedBy.displayName}</b><small>A carga anterior continua disponível durante o processamento.</small></span><i><b /></i></div>}

      {state && !state.capabilities.canStart && (
        <div className="admin-sync__notice"><WarningCircleIcon size={18} weight="fill" /><span><strong>Execução ainda indisponível</strong><small>{state.capabilities.blockedReason}</small></span></div>
      )}

      <div className="admin-panel">
        <h3>Execuções recentes</h3>
        {loading && !state ? (
          <div className="admin-sync__empty">Carregando histórico...</div>
        ) : state?.recentRuns.length ? (
          state.recentRuns.map((run) => (
            <div className="audit-row" key={run.id}>
              <span className={`audit-dot ${run.status === "succeeded" ? "audit-dot--success" : run.status === "failed" ? "audit-dot--failure" : ""}`} />
              <span><strong>{runLabel(run.status)}</strong><small>{run.error?.message ?? (run.counts ? `${run.counts.ticketCount} chamados · ${run.counts.eventCount} eventos · ${run.counts.warningCount} alertas` : `Solicitada por ${run.requestedBy.displayName}`)}</small></span>
              <time>{formatDate(run.finishedAt ?? run.startedAt)}</time>
            </div>
          ))
        ) : (
          <div className="admin-sync__empty"><CheckCircleIcon size={20} /><span><strong>Nenhuma execução registrada</strong><small>O histórico começará quando o conector do Notion for habilitado.</small></span></div>
        )}
      </div>
    </div>
  );
}
