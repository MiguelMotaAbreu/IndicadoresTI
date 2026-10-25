"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  DatabaseIcon,
  FloppyDiskIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";

type SourceKey = "tickets" | "history";

type MappingField = {
  key: string;
  source: SourceKey;
  label: string;
  description: string;
  required: boolean;
  acceptedTypes: string[];
  aliases: string[];
};

type StoredMapping = {
  fieldKey: string;
  source: SourceKey;
  propertyName: string;
  propertyType: string;
  updatedBy: { userId: string | null; displayName: string };
  updatedAt: string;
};

type MappingState = {
  ok: true;
  configuration: { ready: boolean; configuredSources: number; totalSources: number; missing: string[] };
  fields: MappingField[];
  mappings: StoredMapping[];
  completeness: { mapped: number; total: number; requiredMapped: number; requiredTotal: number; ready: boolean };
};

type NotionSource = {
  key: SourceKey;
  label: string;
  name: string;
  propertyCount: number;
  properties: Array<{ name: string; type: string }>;
};

type ConnectionResponse = {
  ok: true;
  checkedAt: string;
  sources: NotionSource[];
};

type MappingIssue = { fieldKey: string | null; message: string };

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

function normalizeName(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("pt-BR");
}

async function readJsonResponse<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok || typeof payload !== "object" || payload === null || !("ok" in payload) || payload.ok !== true) {
    const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
      ? payload.error
      : fallback;
    const error = new Error(message) as Error & { issues?: MappingIssue[] };
    if (typeof payload === "object" && payload !== null && "issues" in payload && Array.isArray(payload.issues)) {
      error.issues = payload.issues as MappingIssue[];
    }
    throw error;
  }
  return payload as T;
}

async function loadMappingState(signal?: AbortSignal): Promise<MappingState> {
  return readJsonResponse<MappingState>(
    await fetch("/api/admin/sync/mapping", { cache: "no-store", signal }),
    "Não foi possível carregar os mapeamentos.",
  );
}

function suggestedSelection(
  field: MappingField,
  source: NotionSource | undefined,
  saved: StoredMapping | undefined,
): string {
  if (!source) return "";
  const compatible = source.properties.filter((property) => field.acceptedTypes.includes(property.type));
  const savedProperty = compatible.find((property) => property.name === saved?.propertyName);
  if (savedProperty) return savedProperty.name;
  const aliases = new Set(field.aliases.map(normalizeName));
  return compatible.find((property) => aliases.has(normalizeName(property.name)))?.name ?? "";
}

export function AdminMapping() {
  const [state, setState] = useState<MappingState | null>(null);
  const [sources, setSources] = useState<NotionSource[]>([]);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadingSources, setLoadingSources] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<MappingIssue[]>([]);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void loadMappingState(controller.signal)
      .then(setState)
      .catch((loadError) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar os mapeamentos.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const clientIssues = useMemo(() => {
    if (!state || sources.length === 0) return [] as MappingIssue[];
    const nextIssues: MappingIssue[] = [];
    const used = new Map<string, string>();
    for (const field of state.fields) {
      const selection = selections[field.key]?.trim() ?? "";
      if (!selection && field.required) {
        nextIssues.push({ fieldKey: field.key, message: `Selecione uma propriedade para “${field.label}”.` });
        continue;
      }
      if (!selection) continue;
      const duplicateKey = `${field.source}:${selection}`;
      const previous = used.get(duplicateKey);
      if (previous) {
        nextIssues.push({ fieldKey: field.key, message: `“${selection}” já está associada a ${previous}.` });
      } else {
        used.set(duplicateKey, field.label);
      }
    }
    return nextIssues;
  }, [selections, sources.length, state]);

  async function loadSources() {
    setLoadingSources(true);
    setError(null);
    setIssues([]);
    setSuccess(null);
    try {
      const diagnostic = await readJsonResponse<ConnectionResponse>(
        await fetch("/api/admin/sync/connection", { method: "POST", cache: "no-store" }),
        "Não foi possível carregar as propriedades do Notion.",
      );
      setSources(diagnostic.sources);
      if (state) {
        setSelections(Object.fromEntries(state.fields.map((field) => [
          field.key,
          suggestedSelection(field, diagnostic.sources.find((source) => source.key === field.source), state.mappings.find((mapping) => mapping.fieldKey === field.key)),
        ])));
      }
      setSuccess(`Propriedades consultadas em ${dateFormatter.format(new Date(diagnostic.checkedAt))}. Revise antes de salvar.`);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar as propriedades do Notion.");
    } finally {
      setLoadingSources(false);
    }
  }

  async function saveMappings() {
    if (!state || clientIssues.length > 0) return;
    setSaving(true);
    setError(null);
    setIssues([]);
    setSuccess(null);
    try {
      const payload = await readJsonResponse<MappingState>(
        await fetch("/api/admin/sync/mapping", {
          method: "PUT",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mappings: selections }),
        }),
        "Não foi possível salvar os mapeamentos.",
      );
      setState(payload);
      setSuccess(`${payload.mappings.length} mapeamentos validados e salvos.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar os mapeamentos.");
      setIssues(saveError instanceof Error && "issues" in saveError && Array.isArray(saveError.issues) ? saveError.issues as MappingIssue[] : []);
    } finally {
      setSaving(false);
    }
  }

  const displayedIssues = issues.length > 0 ? issues : clientIssues;
  const latestMapping = state?.mappings.reduce<StoredMapping | null>((latest, mapping) => (
    !latest || Date.parse(mapping.updatedAt) > Date.parse(latest.updatedAt) ? mapping : latest
  ), null) ?? null;

  return (
    <div className="admin-mapping">
      <div className="admin-section-heading">
        <div><h2>Mapeamentos do Notion</h2><p>Associe o esquema operacional a campos analíticos sem alterar as bases de origem.</p></div>
        <div className="admin-sync__actions">
          <button className="button button--ghost" disabled={loading || loadingSources || !state?.configuration.ready} onClick={() => void loadSources()}><ArrowsClockwiseIcon className={loadingSources ? "spin" : ""} size={16} />{loadingSources ? "Consultando..." : "Carregar propriedades"}</button>
          <button className="button button--primary" disabled={sources.length === 0 || saving || clientIssues.length > 0} onClick={() => void saveMappings()}><FloppyDiskIcon size={16} />{saving ? "Validando..." : "Salvar mapeamento"}</button>
        </div>
      </div>

      {error && <div className="admin-users__error" role="alert"><WarningCircleIcon size={18} weight="fill" /><span>{error}</span></div>}
      {success && <div className="mapping-feedback mapping-feedback--success" role="status"><CheckCircleIcon size={18} weight="fill" /><span>{success}</span></div>}

      <div className="mapping-overview">
        <span><DatabaseIcon size={21} /><b>Campos obrigatórios</b><strong>{state ? `${state.completeness.requiredMapped}/${state.completeness.requiredTotal}` : "—"}</strong><small>{state?.completeness.ready ? "Contrato mínimo configurado" : "Necessários para importar com segurança"}</small></span>
        <span><DatabaseIcon size={21} /><b>Mapeamentos totais</b><strong>{state ? `${state.completeness.mapped}/${state.completeness.total}` : "—"}</strong><small>Opcionais aumentam a cobertura dos indicadores</small></span>
        <span><CheckCircleIcon size={21} /><b>Última revisão</b><strong>{latestMapping ? dateFormatter.format(new Date(latestMapping.updatedAt)) : "Ainda não salvo"}</strong><small>{latestMapping ? `Por ${latestMapping.updatedBy.displayName}` : "Carregue o esquema para começar"}</small></span>
      </div>

      {state && !state.configuration.ready && (
        <div className="admin-sync__notice"><WarningCircleIcon size={18} weight="fill" /><span><strong>Configuração do Notion incompleta</strong><small>Informe {state.configuration.missing.join(", ")} antes de carregar as propriedades.</small></span></div>
      )}

      <div className="mapping-identity-note"><CheckCircleIcon size={18} weight="fill" /><span><strong>Identidade independente do título</strong><small>Cada chamado será identificado internamente pelo page.id fornecido pela API do Notion. Código visível e solicitante são campos distintos e podem estar vazios sem excluir o registro dos indicadores.</small></span></div>

      {displayedIssues.length > 0 && sources.length > 0 && (
        <div className="mapping-feedback mapping-feedback--error" role="alert"><WarningCircleIcon size={18} weight="fill" /><span><strong>Revise o mapeamento</strong>{displayedIssues.map((issue) => <small key={`${issue.fieldKey}-${issue.message}`}>{issue.message}</small>)}</span></div>
      )}

      {loading ? (
        <div className="admin-sync__empty">Carregando contrato analítico...</div>
      ) : sources.length === 0 ? (
        <div className="mapping-empty"><DatabaseIcon size={30} weight="duotone" /><strong>{state?.mappings.length ? "Mapeamento salvo" : "Nenhum mapeamento salvo"}</strong><p>{state?.configuration.ready ? "Carregue as propriedades atuais do Notion para revisar ou criar as associações." : "A configuração do Notion precisa estar completa antes da primeira associação."}</p></div>
      ) : (
        <div className="mapping-sources">
          {sources.map((source) => (
            <section className="mapping-source" key={source.key}>
              <header><span><DatabaseIcon size={19} /></span><div><small>{source.label}</small><strong>{source.name}</strong></div><em>{source.propertyCount} propriedades</em></header>
              <div className="mapping-fields">
                {state?.fields.filter((field) => field.source === source.key).map((field) => {
                  const compatible = source.properties.filter((property) => field.acceptedTypes.includes(property.type));
                  const hasIssue = displayedIssues.some((issue) => issue.fieldKey === field.key);
                  return (
                    <label className={hasIssue ? "has-error" : ""} key={field.key}>
                      <span><b>{field.label}{field.required && <i>Obrigatório</i>}</b><small>{field.description}</small></span>
                      <select aria-label={field.label} value={selections[field.key] ?? ""} onChange={(event) => { setSelections((current) => ({ ...current, [field.key]: event.target.value })); setIssues([]); setSuccess(null); }}>
                        <option value="">{field.required ? "Selecione uma propriedade" : "Não mapear nesta versão"}</option>
                        {compatible.map((property) => <option key={`${property.name}-${property.type}`} value={property.name}>{property.name} · {property.type}</option>)}
                      </select>
                    </label>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
