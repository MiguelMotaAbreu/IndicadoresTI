"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  ListChecksIcon,
  MagnifyingGlassIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";

type AuditAction =
  | "auth.login_succeeded"
  | "auth.login_failed"
  | "auth.password_changed"
  | "auth.logout"
  | "user.created"
  | "user.deactivated"
  | "user.reactivated"
  | "sync.connection_tested"
  | "sync.mapping_saved"
  | "sync.preflight_completed"
  | "sync.run_completed";

type AuditEvent = {
  id: string;
  occurredAt: string;
  actor: { userId: string; displayName: string; role: "administrador" | "analista" } | null;
  action: AuditAction;
  targetType: "account" | "session" | "integration";
  targetId: string | null;
  targetLabel: string | null;
  outcome: "success" | "failure";
  summary: string;
};

const actionLabels: Record<AuditAction, string> = {
  "auth.login_succeeded": "Login realizado",
  "auth.login_failed": "Login rejeitado",
  "auth.password_changed": "Senha alterada",
  "auth.logout": "Logout realizado",
  "user.created": "Usuário criado",
  "user.deactivated": "Usuário desativado",
  "user.reactivated": "Usuário reativado",
  "sync.connection_tested": "Conexão com o Notion testada",
  "sync.mapping_saved": "Mapeamento do Notion salvo",
  "sync.preflight_completed": "Pré-validação do Notion concluída",
  "sync.run_completed": "Sincronização do Notion concluída",
};

async function fetchAuditEvents(signal?: AbortSignal): Promise<AuditEvent[]> {
  const response = await fetch("/api/admin/audit?limit=200", { cache: "no-store", signal });
  let payload: { events?: unknown; error?: unknown } = {};
  try {
    payload = await response.json() as typeof payload;
  } catch {
    // A mensagem genérica abaixo evita depender do formato de uma falha intermediária.
  }
  if (!response.ok || !Array.isArray(payload.events)) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Não foi possível carregar a auditoria.");
  }
  return payload.events as AuditEvent[];
}

function formatOccurredAt(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

export function AdminAudit() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [referenceTime, setReferenceTime] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<"all" | "auth" | "user" | "sync">("all");
  const [outcome, setOutcome] = useState<"all" | "success" | "failure">("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetchAuditEvents(controller.signal)
      .then((loadedEvents) => {
        setEvents(loadedEvents);
        setReferenceTime(Date.now());
      })
      .catch((loadError) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar a auditoria.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const filteredEvents = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    return events.filter((event) => {
      if (category !== "all" && !event.action.startsWith(`${category}.`)) return false;
      if (outcome !== "all" && event.outcome !== outcome) return false;
      if (!query) return true;
      return [actionLabels[event.action], event.actor?.displayName, event.targetLabel, event.summary]
        .some((value) => value?.toLocaleLowerCase("pt-BR").includes(query));
    });
  }, [category, events, outcome, search]);

  const last24Hours = referenceTime === null ? 0 : events.filter((event) => {
    const elapsed = referenceTime - Date.parse(event.occurredAt);
    return elapsed >= 0 && elapsed <= 24 * 60 * 60 * 1_000;
  }).length;
  const failures = events.filter((event) => event.outcome === "failure").length;
  const userChanges = events.filter((event) => event.action.startsWith("user.")).length;

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setEvents(await fetchAuditEvents());
      setReferenceTime(Date.now());
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Não foi possível carregar a auditoria.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="admin-audit">
      <div className="admin-section-heading">
        <div><h2>Log de auditoria</h2><p>Rastreabilidade append-only de autenticação, usuários e integrações.</p></div>
        <button className="button button--ghost" disabled={loading} onClick={() => void refresh()}><ArrowsClockwiseIcon className={loading ? "spin" : ""} size={17} />Atualizar</button>
      </div>

      <div className="admin-audit__summary">
        <span><ListChecksIcon size={20} /><strong>{events.length}</strong><small>eventos carregados</small></span>
        <span><CheckCircleIcon size={20} /><strong>{last24Hours}</strong><small>nas últimas 24 horas</small></span>
        <span className={failures > 0 ? "has-warning" : ""}><WarningCircleIcon size={20} /><strong>{failures}</strong><small>eventos com falha</small></span>
        <span><ListChecksIcon size={20} /><strong>{userChanges}</strong><small>alterações de usuários</small></span>
      </div>

      <div className="admin-audit__filters">
        <label className="admin-audit__search"><MagnifyingGlassIcon size={15} /><span className="sr-only">Buscar eventos</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar ator, alvo ou evento..." /></label>
        <label><span>Categoria</span><select value={category} onChange={(event) => setCategory(event.target.value as typeof category)}><option value="all">Todas</option><option value="auth">Autenticação</option><option value="user">Usuários</option><option value="sync">Sincronização</option></select></label>
        <label><span>Resultado</span><select value={outcome} onChange={(event) => setOutcome(event.target.value as typeof outcome)}><option value="all">Todos</option><option value="success">Sucesso</option><option value="failure">Falha</option></select></label>
        <small>{filteredEvents.length} de {events.length} eventos</small>
      </div>

      {error && <div className="admin-users__error" role="alert"><WarningCircleIcon size={18} weight="fill" /><span>{error}</span></div>}

      <div className="admin-audit__table-wrap">
        {loading && events.length === 0 ? (
          <div className="admin-users__state">Carregando auditoria...</div>
        ) : filteredEvents.length === 0 ? (
          <div className="admin-users__state">Nenhum evento corresponde aos filtros.</div>
        ) : (
          <table className="admin-audit__table">
            <thead><tr><th>Data e hora</th><th>Evento</th><th>Ator</th><th>Alvo</th><th>Resultado</th></tr></thead>
            <tbody>{filteredEvents.map((event) => (
              <tr key={event.id}>
                <td><time dateTime={event.occurredAt}>{formatOccurredAt(event.occurredAt)}</time></td>
                <td><strong>{actionLabels[event.action]}</strong><small>{event.summary}</small></td>
                <td><strong>{event.actor?.displayName ?? "Não autenticado"}</strong><small>{event.actor ? (event.actor.role === "administrador" ? "Administrador" : "Analista") : "Origem externa"}</small></td>
                <td>{event.targetLabel ?? "—"}</td>
                <td><span className={`audit-outcome audit-outcome--${event.outcome}`}><i />{event.outcome === "success" ? "Sucesso" : "Falha"}</span></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <p className="admin-audit__retention">Esta tela mostra os 200 eventos mais recentes. Senhas e tokens de sessão nunca são registrados.</p>
    </div>
  );
}
