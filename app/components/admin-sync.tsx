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
  mapping: {
    mapped: number;
    total: number;
    requiredMapped: number;
    requiredTotal: number;
    ready: boolean;
  };
  capabilities: { canPreflight: boolean; canStart: boolean; blockedReason: string };
  activeRun: SyncRun | null;
  latestSnapshot: (SnapshotCounts & { id: string; publishedAt: string }) | null;
  recentRuns: SyncRun[];
};

type ConnectionDiagnostic = {
  ok: true;
  checkedAt: string;
  apiVersion: string;
  sources: Array<{
    key: "tickets" | "history";
    label: string;
    name: string;
    propertyCount: number;
    properties: Array<{ name: string; type: string }>;
  }>;
};

type PreflightSourceDiagnostic = {
  pagesRead: number;
  eligibleRecords: number;
  rejectedRecords: number;
  warningCount: number;
  requestCount: number;
  fields: Array<{
    fieldKey: string;
    label: string;
    required: boolean;
    presentCount: number;
    validCount: number;
    invalidCount: number;
    missingCount: number;
    coveragePercent: number;
  }>;
};

type PreflightDiagnostic = {
  ok: true;
  checkedAt: string;
  requestCount: number;
  warningCount: number;
  tickets: PreflightSourceDiagnostic;
  history: PreflightSourceDiagnostic;
  relationship: {
    linkedEvents: number;
    missingRelationEvents: number;
    orphanEvents: number;
    ambiguousEvents: number;
    unlinkedEvents: number;
    distinctLinkedTickets: number;
    eventCoveragePercent: number;
    ticketCoveragePercent: number;
  };
  consistency: {
    issueCount: number;
    recordsAffected: number;
    rules: Array<{
      code: string;
      label: string;
      source: "tickets" | "history";
      count: number;
    }>;
  };
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

async function testNotionConnection(): Promise<ConnectionDiagnostic> {
  const response = await fetch("/api/admin/sync/connection", {
    method: "POST",
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as unknown;
  const isObject = typeof payload === "object" && payload !== null;
  const errorMessage = isObject && "error" in payload && typeof payload.error === "string"
    ? payload.error
    : null;
  if (!response.ok || !isObject || !("ok" in payload) || payload.ok !== true) {
    throw new Error(errorMessage ?? "Não foi possível validar a conexão com o Notion.");
  }
  return payload as ConnectionDiagnostic;
}

async function preflightNotionSources(): Promise<PreflightDiagnostic> {
  const response = await fetch("/api/admin/sync/preflight", {
    method: "POST",
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as unknown;
  const isObject = typeof payload === "object" && payload !== null;
  const errorMessage = isObject && "error" in payload && typeof payload.error === "string"
    ? payload.error
    : null;
  if (!response.ok || !isObject || !("ok" in payload) || payload.ok !== true) {
    throw new Error(errorMessage ?? "Não foi possível pré-validar as bases do Notion.");
  }
  return payload as PreflightDiagnostic;
}

export function AdminSync() {
  const [state, setState] = useState<SyncResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connectionDiagnostic, setConnectionDiagnostic] = useState<ConnectionDiagnostic | null>(null);
  const [runningPreflight, setRunningPreflight] = useState(false);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [preflightDiagnostic, setPreflightDiagnostic] = useState<PreflightDiagnostic | null>(null);

  async function refresh(signal?: AbortSignal) {
    setLoading(true);
    setError(null);
    setConnectionError(null);
    setConnectionDiagnostic(null);
    setPreflightError(null);
    setPreflightDiagnostic(null);
    try {
      setState(await loadSyncState(signal));
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar as sincronizações.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  async function runConnectionTest() {
    setTestingConnection(true);
    setConnectionError(null);
    setConnectionDiagnostic(null);
    try {
      setConnectionDiagnostic(await testNotionConnection());
    } catch (testError) {
      setConnectionError(testError instanceof Error ? testError.message : "Não foi possível validar a conexão com o Notion.");
    } finally {
      setTestingConnection(false);
    }
  }

  async function runPreflight() {
    setRunningPreflight(true);
    setPreflightError(null);
    setPreflightDiagnostic(null);
    try {
      setPreflightDiagnostic(await preflightNotionSources());
    } catch (preflightFailure) {
      setPreflightError(preflightFailure instanceof Error ? preflightFailure.message : "Não foi possível pré-validar as bases do Notion.");
    } finally {
      setRunningPreflight(false);
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
          <button className="button button--ghost" disabled={loading || testingConnection || runningPreflight} onClick={() => void refresh()}><ArrowsClockwiseIcon className={loading ? "spin" : ""} size={16} />Atualizar estado</button>
          <button className="button button--ghost" disabled={loading || runningPreflight || !state?.configuration.ready || testingConnection} onClick={() => void runConnectionTest()} title={state?.configuration.ready ? "Valida acesso e esquema sem importar registros." : "Complete a configuração do Notion para testar."}><CloudCheckIcon size={17} />{testingConnection ? "Testando..." : "Testar conexão"}</button>
          <button className="button button--primary" disabled={loading || testingConnection || runningPreflight || !state?.capabilities.canPreflight} onClick={() => void runPreflight()} title={state?.capabilities.canPreflight ? "Lê chamados e histórico sem publicar uma carga." : state?.capabilities.blockedReason ?? "Carregando disponibilidade."}><ArrowsClockwiseIcon className={runningPreflight ? "spin" : ""} size={17} />{runningPreflight ? "Pré-validando..." : "Pré-validar bases"}</button>
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
          <small>{state ? `${state.configuration.configuredSources}/${state.configuration.totalSources} bases · ${state.mapping.requiredMapped}/${state.mapping.requiredTotal} campos obrigatórios` : "Consultando configuração..."}</small>
        </span>
        <span className={latestRun?.status === "failed" ? "has-warning" : ""}>
          <ActivityIcon size={22} />
          <b>Integridade</b>
          <strong>{integrityLabel}</strong>
          <small>{snapshot ? `${snapshot.warningCount} alerta(s) na carga publicada` : "Nenhum snapshot analítico disponível"}</small>
        </span>
      </div>

      {state?.activeRun && <div className="sync-progress"><span><b>Sincronização iniciada por {state.activeRun.requestedBy.displayName}</b><small>A carga anterior continua disponível durante o processamento.</small></span><i><b /></i></div>}

      {connectionError && <div className="admin-users__error" role="alert"><WarningCircleIcon size={18} weight="fill" /><span>{connectionError}</span></div>}
      {preflightError && <div className="admin-users__error" role="alert"><WarningCircleIcon size={18} weight="fill" /><span>{preflightError}</span></div>}

      {connectionDiagnostic && (
        <section className="connection-diagnostic" aria-live="polite">
          <header>
            <span><CheckCircleIcon size={20} weight="fill" /></span>
            <div><strong>Conexão somente leitura validada</strong><small>API {connectionDiagnostic.apiVersion} · {formatDate(connectionDiagnostic.checkedAt)}</small></div>
          </header>
          <div className="connection-diagnostic__sources">
            {connectionDiagnostic.sources.map((source) => (
              <article key={source.key}>
                <div><DatabaseIcon size={18} /><span><b>{source.label}</b><strong>{source.name}</strong></span><em>{source.propertyCount} propriedades</em></div>
                <ul>{source.properties.map((property) => <li key={`${property.name}-${property.type}`}><span>{property.name}</span><code>{property.type}</code></li>)}</ul>
              </article>
            ))}
          </div>
        </section>
      )}

      {preflightDiagnostic && (
        <section className="preflight-diagnostic" aria-live="polite">
          <header>
            <span><CheckCircleIcon size={20} weight="fill" /></span>
            <div><strong>Pré-validação das bases concluída</strong><small>{formatDate(preflightDiagnostic.checkedAt)} · {preflightDiagnostic.requestCount} consulta(s) paginada(s)</small></div>
          </header>
          <div className="preflight-diagnostic__summary">
            <span><b>Chamados</b><strong>{preflightDiagnostic.tickets.eligibleRecords}</strong><small>{preflightDiagnostic.tickets.pagesRead} página(s) lida(s)</small></span>
            <span><b>Eventos</b><strong>{preflightDiagnostic.history.eligibleRecords}</strong><small>{preflightDiagnostic.history.pagesRead} página(s) lida(s)</small></span>
            <span className={preflightDiagnostic.relationship.unlinkedEvents ? "has-warning" : ""}><b>Eventos vinculados</b><strong>{preflightDiagnostic.relationship.linkedEvents}</strong><small>{preflightDiagnostic.relationship.unlinkedEvents} sem vínculo seguro</small></span>
            <span className={preflightDiagnostic.warningCount ? "has-warning" : ""}><b>Alertas</b><strong>{preflightDiagnostic.warningCount}</strong><small>Ausências, vínculos, cronologia e rejeições</small></span>
          </div>
          <div className="preflight-relationship">
            <div><strong>Integridade entre as bases</strong><small>Somente relações com um único page.id existente são consideradas seguras para indicadores históricos.</small></div>
            <ul>
              <li><span><b>Cobertura dos eventos</b><small>{preflightDiagnostic.relationship.linkedEvents} de {preflightDiagnostic.history.eligibleRecords}</small></span><em>{preflightDiagnostic.relationship.eventCoveragePercent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</em></li>
              <li><span><b>Chamados com histórico</b><small>{preflightDiagnostic.relationship.distinctLinkedTickets} de {preflightDiagnostic.tickets.eligibleRecords}</small></span><em>{preflightDiagnostic.relationship.ticketCoveragePercent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</em></li>
              <li className={preflightDiagnostic.relationship.missingRelationEvents ? "has-warning" : ""}><span><b>Relação ausente</b><small>Eventos sem chamado relacionado</small></span><em>{preflightDiagnostic.relationship.missingRelationEvents}</em></li>
              <li className={preflightDiagnostic.relationship.orphanEvents || preflightDiagnostic.relationship.ambiguousEvents ? "has-warning" : ""}><span><b>Órfãos ou ambíguos</b><small>{preflightDiagnostic.relationship.orphanEvents} órfão(s) · {preflightDiagnostic.relationship.ambiguousEvents} ambíguo(s)</small></span><em>{preflightDiagnostic.relationship.orphanEvents + preflightDiagnostic.relationship.ambiguousEvents}</em></li>
            </ul>
          </div>
          <div className="preflight-consistency">
            <div><strong>Consistência cronológica</strong><small>{preflightDiagnostic.consistency.issueCount} ocorrência(s) em {preflightDiagnostic.consistency.recordsAffected} registro(s). Ausências são tratadas na cobertura e não como inversão de horário.</small></div>
            <ul>
              {preflightDiagnostic.consistency.rules.map((rule) => (
                <li key={rule.code} className={rule.count ? "has-warning" : ""}>
                  <span><b>{rule.label}</b><small>{rule.source === "tickets" ? "Base de chamados" : "Base de histórico"}</small></span>
                  <em>{rule.count}</em>
                </li>
              ))}
            </ul>
          </div>
          <div className="preflight-diagnostic__sources">
            {([
              { key: "tickets", label: "Campos dos chamados", source: preflightDiagnostic.tickets },
              { key: "history", label: "Campos do histórico", source: preflightDiagnostic.history },
            ] as const).map(({ key, label, source }) => (
              <div className="preflight-coverage" key={key}>
                <div><strong>{label}</strong><small>{source.requestCount} consulta(s) · {source.rejectedRecords} duplicidade(s). A cobertura considera somente valores válidos para o tipo analítico.</small></div>
                <ul>
                  {source.fields.map((field) => (
                    <li key={field.fieldKey} className={field.invalidCount > 0 || (field.required && field.missingCount > 0) ? "has-warning" : ""}>
                      <span><b>{field.label}</b><small>{field.required ? "Obrigatório" : "Opcional"} · {field.missingCount} ausente(s) · {field.invalidCount} inválido(s)</small></span>
                      <em>{field.coveragePercent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</em>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

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
