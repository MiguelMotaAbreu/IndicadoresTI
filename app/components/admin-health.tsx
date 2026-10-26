"use client";

import { useEffect, useState } from "react";
import {
  ActivityIcon,
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  DatabaseIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";

type HealthStatus = "healthy" | "attention" | "critical";

type HealthReport = {
  status: HealthStatus;
  checkedAt: string;
  checks: Array<{
    key: string;
    label: string;
    status: HealthStatus;
    summary: string;
    detail: string;
  }>;
};

const statusLabels: Record<HealthStatus, string> = {
  healthy: "Saudável",
  attention: "Atenção",
  critical: "Crítico",
};

const overallLabels: Record<HealthStatus, string> = {
  healthy: "Instalação saudável",
  attention: "Atenção necessária",
  critical: "Intervenção necessária",
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

async function loadHealth(signal?: AbortSignal): Promise<HealthReport> {
  const response = await fetch("/api/admin/health", { cache: "no-store", signal });
  const payload = await response.json().catch(() => null) as { ok?: boolean; report?: HealthReport; error?: string } | null;
  if (!response.ok || !payload?.ok || !payload.report) {
    throw new Error(payload?.error ?? "Não foi possível carregar o diagnóstico da instalação.");
  }
  return payload.report;
}

export function AdminHealth() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh(signal?: AbortSignal) {
    setLoading(true);
    setError(null);
    try {
      setReport(await loadHealth(signal));
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar o diagnóstico da instalação.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadHealth(controller.signal)
      .then(setReport)
      .catch((loadError) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar o diagnóstico da instalação.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const healthyCount = report?.checks.filter((check) => check.status === "healthy").length ?? 0;
  const attentionCount = report?.checks.filter((check) => check.status === "attention").length ?? 0;
  const criticalCount = report?.checks.filter((check) => check.status === "critical").length ?? 0;

  return (
    <div className="admin-health">
      <div className="admin-section-heading">
        <div><h2>Saúde da instalação</h2><p>Diagnóstico local do banco, integração, dados publicados e execuções em segundo plano.</p></div>
        <button className="button button--ghost" disabled={loading} onClick={() => void refresh()}><ArrowsClockwiseIcon className={loading ? "spin" : ""} size={17} />{loading ? "Verificando..." : "Executar diagnóstico"}</button>
      </div>

      {error && <div className="admin-users__error" role="alert"><WarningCircleIcon size={18} weight="fill" /><span>{error}</span></div>}

      <section className={`health-hero health-hero--${report?.status ?? "loading"}`} aria-live="polite">
        <span>{report?.status === "healthy" ? <CheckCircleIcon size={26} weight="fill" /> : <WarningCircleIcon size={26} weight="fill" />}</span>
        <div>
          <small>Estado geral</small>
          <strong>{loading && !report ? "Executando verificações..." : report ? overallLabels[report.status] : "Diagnóstico indisponível"}</strong>
          <p>{report ? `Verificado em ${formatDate(report.checkedAt)}.` : "Use o botão acima para tentar novamente."}</p>
        </div>
      </section>

      <div className="health-summary">
        <span><CheckCircleIcon size={20} /><strong>{healthyCount}</strong><small>verificações saudáveis</small></span>
        <span className={attentionCount ? "has-warning" : ""}><ActivityIcon size={20} /><strong>{attentionCount}</strong><small>exigem atenção</small></span>
        <span className={criticalCount ? "has-critical" : ""}><WarningCircleIcon size={20} /><strong>{criticalCount}</strong><small>críticas</small></span>
      </div>

      <div className="health-checks">
        {loading && !report ? (
          <div className="admin-users__state">Consultando os componentes locais...</div>
        ) : report?.checks.map((check) => (
          <article className={`health-check health-check--${check.status}`} key={check.key}>
            <span className="health-check__icon">{check.key === "database" || check.key === "snapshot" || check.key === "mapping" ? <DatabaseIcon size={20} /> : <ActivityIcon size={20} />}</span>
            <div><small>{check.label}</small><strong>{check.summary}</strong><p>{check.detail}</p></div>
            <em>{statusLabels[check.status]}</em>
          </article>
        ))}
      </div>

      <p className="health-scope-note">Este diagnóstico não expõe tokens, IDs das bases, caminhos locais ou conteúdo dos chamados. Conectividade externa continua sendo testada em Sincronização.</p>
    </div>
  );
}
