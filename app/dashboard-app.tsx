"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactGridLayout, {
  type Layout,
  useContainerWidth,
} from "react-grid-layout";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Label,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type LabelProps,
} from "recharts";
import {
  ActivityIcon,
  ArrowLeftIcon,
  ArrowUpRightIcon,
  ArrowsClockwiseIcon,
  BellIcon,
  CalendarBlankIcon,
  CaretDownIcon,
  CaretRightIcon,
  ChartBarIcon,
  ChartLineUpIcon,
  CheckCircleIcon,
  CloudCheckIcon,
  DatabaseIcon,
  DotsSixVerticalIcon,
  DownloadSimpleIcon,
  FloppyDiskIcon,
  FunnelSimpleIcon,
  GearSixIcon,
  HouseIcon,
  InfoIcon,
  ListChecksIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  PlusIcon,
  ShieldCheckIcon,
  SignOutIcon,
  SlidersHorizontalIcon,
  SquaresFourIcon,
  TrendUpIcon,
  TrashIcon,
  UserCircleIcon,
  UsersThreeIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { logout } from "./actions/auth";
import { AdminAudit } from "./components/admin-audit";
import { AdminHealth } from "./components/admin-health";
import { AdminMapping } from "./components/admin-mapping";
import { AdminSync } from "./components/admin-sync";
import { AdminUsers } from "./components/admin-users";
import { Brand } from "./components/brand";
import {
  coverageData,
  dataFields,
  dashboardThemes,
  demandSeries,
  heatmap,
  inconsistencyData,
  indicators,
  movementTimeline,
  movementTypeData,
  oldestPending,
  pendingAgeData,
  pendingCompositionData,
  reasonData,
  responseHistogram,
  slaByPriority,
  stageCompositionData,
  ticketRows,
  timeComparisonData,
  type DataField,
  type DashboardKey,
} from "./mock-data";
import {
  decomposeMetricBuilderExpression,
  formatMetricExpression,
  validateMetricDefinition,
  type AggregationOperation,
  type BinaryOperation,
  type MetricDefinitionDraft,
  type MetricPreview,
  type MetricVisualization,
} from "./lib/metrics";
import {
  DASHBOARD_MAX_PAGES,
  DASHBOARD_PAGE_MAX_ROWS,
  cloneDashboardDraft,
  createDefaultDashboardDraft,
  dashboardDraftStorageKey,
  dashboardDraftsEqual,
  dashboardPageLayoutsEqual,
  findDashboardItemPlacement,
  parseDashboardDraft,
  serializeDashboardDraft,
  type DashboardDraftSnapshot,
  type DraftCustomWidget,
  type DraftLayoutItem,
} from "./lib/dashboard-drafts";
import { dashboardLayouts } from "./lib/dashboard-layouts";
import { createBoundedDashboardCompactor, dashboardLayoutFitsBounds, magnetizeDashboardItem, resolveDashboardLayoutCollisions } from "./lib/dashboard-layout-collisions";
import type { OverviewAnalytics } from "./lib/overview-analytics";
import type { UserRole } from "./lib/user-store";

type View = "catalog" | "dashboard" | "admin";
type AdminSection = "sync" | "users" | "mapping" | "health" | "audit";

type CurrentUser = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
};

type Filters = {
  period: "Toda a base" | "Últimos 90 dias" | "Últimos 30 dias";
  sector: string;
  priority: string;
  status: string;
};

type FilterOptions = {
  sectors: string[];
  priorities: string[];
  statuses: string[];
};

type OverviewCrossFilter = {
  field: "status" | "priority" | "reason";
  value: string;
};

const overviewCrossFilterLabels: Record<OverviewCrossFilter["field"], string> = {
  status: "Status",
  priority: "Prioridade",
  reason: "Motivo",
};

const defaultFilters: Filters = {
  period: "Toda a base",
  sector: "Todos os setores",
  priority: "Todas",
  status: "Todos",
};

const demoFilterOptions: FilterOptions = {
  sectors: ["Recepção", "Farmácia", "Consultório 03", "Sala de Medicação"],
  priorities: ["Crítico", "Muito alta", "Alta", "Média"],
  statuses: ["Concluído", "Arquivado", "Aguardando Info", "Fornecedor"],
};

type MetricDefinition = {
  id: string;
  value: string;
  title: string;
  delta: string;
  tone?: "default" | "primary" | "warning";
};

type OverviewLoadState =
  | { status: "loading"; data: null; message: string }
  | { status: "ready"; data: OverviewAnalytics; message: string }
  | { status: "empty" | "error"; data: null; message: string };

type OverviewDetailRow = {
  rowKey: string;
  code: string;
  requester: string;
  sector: string;
  priority: string;
  status: string;
  reason: string;
  openedAt: string | null;
};

type OverviewDetails = {
  snapshot: { id: string; publishedAt: string };
  selection: {
    totalRecords: number;
    page: number;
    pageSize: number;
    pageCount: number;
  };
  privacy: { requesterMasked: boolean };
  rows: OverviewDetailRow[];
};

type OverviewDetailsLoadState =
  | { status: "loading"; data: null; message: string }
  | { status: "ready"; data: OverviewDetails; message: string }
  | { status: "empty" | "error"; data: null; message: string };

function createOverviewSearchParams(filters: Filters, crossFilter: OverviewCrossFilter | null): URLSearchParams {
  const searchParams = new URLSearchParams();
  searchParams.set("period", filters.period === "Últimos 30 dias" ? "last30" : filters.period === "Últimos 90 dias" ? "last90" : "all");
  if (filters.sector !== defaultFilters.sector) searchParams.set("sector", filters.sector);
  if (crossFilter?.field === "priority") searchParams.set("priority", crossFilter.value);
  else if (filters.priority !== defaultFilters.priority) searchParams.set("priority", filters.priority);
  if (crossFilter?.field === "status") searchParams.set("status", crossFilter.value);
  else if (filters.status !== defaultFilters.status) searchParams.set("status", filters.status);
  if (crossFilter?.field === "reason") searchParams.set("reason", crossFilter.value);
  return searchParams;
}

async function loadOverviewAnalytics(filters: Filters, crossFilter: OverviewCrossFilter | null, signal?: AbortSignal): Promise<OverviewAnalytics | null> {
  const searchParams = createOverviewSearchParams(filters, crossFilter);
  const response = await fetch(`/api/analytics/overview?${searchParams}`, { cache: "no-store", signal });
  const payload = await response.json().catch(() => null) as { ok?: boolean; data?: OverviewAnalytics | null; error?: string } | null;
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error ?? "Não foi possível carregar a Visão geral.");
  }
  return payload.data ?? null;
}

async function loadOverviewDetails(
  filters: Filters,
  crossFilter: OverviewCrossFilter | null,
  page: number,
  signal?: AbortSignal,
): Promise<OverviewDetails | null> {
  const searchParams = createOverviewSearchParams(filters, crossFilter);
  searchParams.set("page", String(page));
  searchParams.set("pageSize", "20");
  const response = await fetch(`/api/analytics/overview/details?${searchParams}`, { cache: "no-store", signal });
  const payload = await response.json().catch(() => null) as { ok?: boolean; data?: OverviewDetails | null; error?: string } | null;
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error ?? "Não foi possível carregar os chamados deste recorte.");
  }
  return payload.data ?? null;
}

async function downloadOverviewCsv(filters: Filters, crossFilter: OverviewCrossFilter | null): Promise<string> {
  const searchParams = createOverviewSearchParams(filters, crossFilter);
  const response = await fetch(`/api/analytics/overview/export?${searchParams}`, { cache: "no-store" });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? "Não foi possível exportar o recorte atual.");
  }

  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "pulseti-visao-geral.csv";
  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  return filename;
}

function formatMetricNumber(value: number | null, maximumFractionDigits = 2): string {
  return value === null ? "—" : value.toLocaleString("pt-BR", { maximumFractionDigits });
}

function formatAnalyticsDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(`${value}T12:00:00-03:00`));
}

function formatAnalyticsPeriod(value: string): string {
  if (/^\d{4}-\d{2}$/.test(value)) {
    const [year, month] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" })
      .format(new Date(Date.UTC(year, month - 1, 1)));
  }
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" })
    .format(new Date(`${value}T12:00:00Z`));
}

function overviewMetrics(state: OverviewLoadState): MetricDefinition[] {
  if (state.status !== "ready") {
    const value = state.status === "loading" ? "…" : "—";
    return [
      { id: "metric-total", value, title: "Total de chamados", delta: state.message, tone: "primary" },
      { id: "metric-average", value, title: "Média por dia", delta: state.message },
      { id: "metric-sla", value, title: "Dentro do SLA avaliado", delta: state.message },
      { id: "metric-pending", value, title: "Pendências atuais", delta: state.message, tone: "warning" },
    ];
  }
  const { cards } = state.data;
  return [
    { id: "metric-total", value: formatMetricNumber(cards.totalTickets, 0), title: "Total de chamados", delta: "Snapshot publicado", tone: "primary" },
    { id: "metric-average", value: formatMetricNumber(cards.averagePerCalendarDay.value), title: "Média por dia", delta: `${formatMetricNumber(cards.averagePerCalendarDay.coveragePercent)}% de cobertura` },
    { id: "metric-sla", value: cards.slaCompliance.valuePercent === null ? "—" : `${formatMetricNumber(cards.slaCompliance.valuePercent)}%`, title: "Dentro do SLA avaliado", delta: `N = ${cards.slaCompliance.evaluated} avaliados` },
    { id: "metric-pending", value: formatMetricNumber(cards.pendingTickets.value, 0), title: "Pendências atuais", delta: `${formatMetricNumber(cards.pendingTickets.coveragePercent)}% com status válido`, tone: cards.pendingTickets.value > 0 ? "warning" : "default" },
  ];
}

const themeIcons = {
  overview: SquaresFourIcon,
  demand: ChartLineUpIcon,
  pending: ListChecksIcon,
  sla: ShieldCheckIcon,
  movement: ArrowsClockwiseIcon,
  quality: DatabaseIcon,
};

const themeMetrics: Record<DashboardKey, MetricDefinition[]> = {
  overview: [
    { id: "metric-total", value: "518", title: "Total de chamados", delta: "8,4% vs. período anterior", tone: "primary" },
    { id: "metric-average", value: "4,9", title: "Média por dia", delta: "0,6 acima da média" },
    { id: "metric-sla", value: "93,4%", title: "Dentro do SLA avaliado", delta: "N = 226 avaliados" },
    { id: "metric-pending", value: "5", title: "Pendências atuais", delta: "2 exigem atenção", tone: "warning" },
  ],
  demand: [
    { id: "metric-total", value: "518", title: "Chamados no período", delta: "Base íntegra", tone: "primary" },
    { id: "metric-average", value: "4,9", title: "Aberturas por dia", delta: "Dias corridos" },
    { id: "metric-variation", value: "+8,4%", title: "Variação da demanda", delta: "Períodos equivalentes" },
    { id: "metric-reasons", value: "44", title: "Motivos mapeados", delta: "5 categorias principais" },
  ],
  pending: [
    { id: "metric-total", value: "5", title: "Pendências atuais", delta: "Retrato da fila", tone: "primary" },
    { id: "metric-age", value: "2d 7h", title: "Idade mediana", delta: "1 acima de 15 dias" },
    { id: "metric-supplier", value: "1", title: "Com fornecedor", delta: "20% da fila" },
    { id: "metric-owner", value: "1", title: "Sem responsável", delta: "Exige atribuição", tone: "warning" },
  ],
  sla: [
    { id: "metric-evaluated", value: "226", title: "Chamados avaliados", delta: "43,6% da base", tone: "primary" },
    { id: "metric-median", value: "38 min", title: "Mediana até início", delta: "N = 280 válidos" },
    { id: "metric-p90", value: "3h 08", title: "P90 até início", delta: "90% abaixo deste tempo" },
    { id: "metric-coverage", value: "43,6%", title: "Cobertura do SLA", delta: "Abaixo do limiar de 80%", tone: "warning" },
  ],
  movement: [
    { id: "metric-events", value: "72", title: "Eventos registrados", delta: "Histórico recente", tone: "primary" },
    { id: "metric-tickets", value: "37", title: "Chamados com histórico", delta: "7,1% da base" },
    { id: "metric-resumed", value: "6", title: "Retomadas", delta: "3 chamados distintos" },
    { id: "metric-supplier", value: "5", title: "Encaminhamentos", delta: "Cobertura limitada", tone: "warning" },
  ],
  quality: [
    { id: "metric-start", value: "54,1%", title: "Cobertura de início", delta: "280 de 518", tone: "primary" },
    { id: "metric-finish", value: "51,0%", title: "Cobertura de conclusão", delta: "264 de 518" },
    { id: "metric-history", value: "7,1%", title: "Cobertura do histórico", delta: "37 de 518" },
    { id: "metric-errors", value: "12", title: "Inconsistências", delta: "4 tipos detectados", tone: "warning" },
  ],
};

function cn(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type ShellProps = {
  view: View;
  selectedDashboard: DashboardKey;
  currentUser: CurrentUser;
  onViewChange: (view: View) => void;
  onDashboardChange: (dashboard: DashboardKey) => void;
  children: React.ReactNode;
};

function userInitials(displayName: string): string {
  return displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("pt-BR"))
    .join("");
}

function AppShell({ view, selectedDashboard, currentUser, onViewChange, onDashboardChange, children }: ShellProps) {
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <main className="app-stage">
      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar__brand"><Brand /></div>
          <nav className="sidebar__nav" aria-label="Navegação principal">
            <p className="nav-label">Análise</p>
            <button className={cn("nav-item", view === "catalog" && "is-active")} onClick={() => onViewChange("catalog")}>
              <HouseIcon size={18} /> <span>Catálogo</span>
            </button>
            {dashboardThemes.map((theme) => {
              const Icon = themeIcons[theme.key];
              return (
                <button
                  key={theme.key}
                  className={cn("nav-item", view === "dashboard" && selectedDashboard === theme.key && "is-active")}
                  onClick={() => {
                    onDashboardChange(theme.key);
                    onViewChange("dashboard");
                  }}
                >
                  <Icon size={18} /> <span>{theme.shortTitle}</span>
                </button>
              );
            })}
            {currentUser.role === "administrador" && (
              <>
                <p className="nav-label nav-label--spaced">Gestão</p>
                <button className={cn("nav-item", view === "admin" && "is-active")} onClick={() => onViewChange("admin")}>
                  <GearSixIcon size={18} /> <span>Administração</span>
                </button>
              </>
            )}
          </nav>
          <div className="sidebar__status">
            <span className="status-orb"><CloudCheckIcon size={16} weight="fill" /></span>
            <span><strong>Dados atualizados</strong><small>20 out · 14:32</small></span>
          </div>
        </aside>

        <section className="app-main">
          <header className="topbar">
            <button className="topbar__search" onClick={() => setSearchOpen(true)}>
              <MagnifyingGlassIcon size={17} />
              <span>Buscar painel ou indicador...</span>
              <kbd>Ctrl K</kbd>
            </button>
            <div className="topbar__actions">
              <div className="popover-wrap">
                <button className="icon-button" aria-label="Notificações" onClick={() => setNotificationsOpen((value) => !value)}>
                  <BellIcon size={19} /><span className="notification-dot" />
                </button>
                {notificationsOpen && (
                  <div className="popover notification-popover">
                    <div className="popover__title"><strong>Notificações</strong><span>2 novas</span></div>
                    <div className="notification-item"><CheckCircleIcon size={18} weight="fill" /><span><strong>Sincronização concluída</strong><small>518 chamados validados</small></span></div>
                    <div className="notification-item notification-item--warning"><WarningCircleIcon size={18} weight="fill" /><span><strong>Cobertura limitada</strong><small>Histórico disponível para 37 chamados</small></span></div>
                  </div>
                )}
              </div>
              <div className="popover-wrap">
                <button className="profile-button" onClick={() => setProfileOpen((value) => !value)}>
                  <span className="avatar">{userInitials(currentUser.displayName)}</span>
                  <span><strong>{currentUser.displayName}</strong><small>{currentUser.role === "administrador" ? "Administrador" : "Analista"}</small></span>
                  <CaretDownIcon size={14} />
                </button>
                {profileOpen && (
                  <div className="popover profile-popover">
                    <button><UserCircleIcon size={17} /> Minha conta</button>
                    <form action={logout}>
                      <button type="submit"><SignOutIcon size={17} /> Encerrar sessão</button>
                    </form>
                  </div>
                )}
              </div>
            </div>
          </header>
          <div className="page-scroll">{children}</div>
        </section>
      </div>

      {searchOpen && (
        <div className="modal-layer" onMouseDown={() => setSearchOpen(false)}>
          <section className="command-palette" onMouseDown={(event) => event.stopPropagation()}>
            <div className="command-palette__input"><MagnifyingGlassIcon size={20} /><input autoFocus placeholder="Busque por painel, indicador ou setor" /><button onClick={() => setSearchOpen(false)}>Esc</button></div>
            <p className="command-palette__label">Acesso rápido</p>
            {dashboardThemes.slice(0, 4).map((theme) => {
              const Icon = themeIcons[theme.key];
              return <button key={theme.key} onClick={() => { onDashboardChange(theme.key); onViewChange("dashboard"); setSearchOpen(false); }}><Icon size={18} /><span><strong>{theme.title}</strong><small>{theme.description}</small></span><CaretRightIcon size={16} /></button>;
            })}
          </section>
        </div>
      )}
    </main>
  );
}

function Catalog({ onOpen }: { onOpen: (key: DashboardKey) => void }) {
  return (
    <div className="page page--catalog">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Análise de indicadores</p>
          <h1>Catálogo de painéis</h1>
          <p>Escolha uma perspectiva para investigar os chamados de TI.</p>
        </div>
        <div className="heading-meta"><span className="healthy-dot" />Fonte oficial <strong>Notion</strong></div>
      </div>

      <section className="catalog-hero">
        <div>
          <span className="catalog-hero__badge"><TrendUpIcon size={15} /> Resumo da base</span>
          <h2>Uma visão confiável da operação, sem ruído.</h2>
          <p>A Visão geral usa o último snapshot íntegro do Notion; os demais painéis identificam dados demonstrativos enquanto são conectados.</p>
        </div>
        <div className="catalog-hero__numbers">
          <span><strong>47</strong><small>indicadores</small></span>
          <span><strong>6</strong><small>painéis</small></span>
          <span><strong>1</strong><small>fonte oficial</small></span>
        </div>
      </section>

      <div className="catalog-grid">
        {dashboardThemes.map((theme) => {
          const Icon = themeIcons[theme.key];
          const featured = indicators.filter((item) => item.dashboard === theme.key).slice(0, 3);
          return (
            <button className={cn("dashboard-card", `dashboard-card--${theme.accent}`)} key={theme.key} onClick={() => onOpen(theme.key)}>
              <span className="dashboard-card__top"><span className="dashboard-card__icon"><Icon size={22} /></span><ArrowUpRightIcon size={18} /></span>
              <span className="dashboard-card__copy"><strong>{theme.title}</strong><small>{theme.description}</small></span>
              <span className="dashboard-card__list">
                {featured.map((item) => <span key={item.name}><CheckCircleIcon size={13} weight="fill" />{item.name}</span>)}
              </span>
              <span className="dashboard-card__foot"><b>{theme.count} indicadores</b><span>Abrir painel <CaretRightIcon size={14} /></span></span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MetricCard({ title, value, delta, tone = "default", editing, onOpen }: { title: string; value: string; delta: string; tone?: "default" | "primary" | "warning"; editing: boolean; onOpen: () => void }) {
  return (
    <button className={cn("metric-card", `metric-card--${tone}`, editing && "metric-card--editing")} onClick={() => { if (!editing) onOpen(); }}>
      <span className="metric-card__top widget-drag-handle"><small>{title}</small>{editing ? <DotsSixVerticalIcon size={16} weight="bold" /> : <ArrowUpRightIcon size={16} />}</span>
      <strong>{value}</strong>
      <span className="metric-card__delta"><TrendUpIcon size={13} weight="bold" />{delta}</span>
    </button>
  );
}

function WidgetFrame({ title, subtitle, editing, children, action, detailsEnabled = true, onDetails }: { title: string; subtitle?: string; editing: boolean; children: React.ReactNode; action?: React.ReactNode; detailsEnabled?: boolean; onDetails?: () => void }) {
  return (
    <section className={cn("widget", editing && "widget--editing")}>
      <header className="widget__header widget-drag-handle">
        <span><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</span>
        <span className="widget__actions">{action}{editing && <DotsSixVerticalIcon className="drag-grip" size={17} weight="bold" />}<button aria-label="Abrir detalhes" disabled={!detailsEnabled} title={detailsEnabled ? "Abrir chamados do recorte" : "Detalhamento indisponível enquanto os dados são carregados."} onClick={(event) => { event.stopPropagation(); onDetails?.(); }}><ArrowUpRightIcon size={16} /></button></span>
      </header>
      <div className="widget__content">{children}</div>
    </section>
  );
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      {payload.map((item, index) => <span key={`${item.name}-${index}`}><i style={{ background: item.color }} />{item.name}: <b>{item.value}</b></span>)}
    </div>
  );
}

function DonutCenterLabel({ viewBox, value, caption }: { viewBox?: LabelProps["viewBox"]; value: string; caption: string }) {
  if (!viewBox || !("cx" in viewBox) || !("cy" in viewBox) || !("innerRadius" in viewBox)) return null;
  const { cx, cy, innerRadius } = viewBox;
  if (![cx, cy, innerRadius].every((item) => typeof item === "number" && Number.isFinite(item)) || innerRadius <= 0) return null;

  const usableWidth = innerRadius * 1.72;
  const valueFontSize = Math.max(8, Math.min(innerRadius * 0.62, usableWidth / (Math.max(value.length, 1) * 0.57)));
  const captionFontSize = Math.max(5.5, Math.min(innerRadius * 0.23, usableWidth / (Math.max(caption.length, 1) * 0.54)));

  return (
    <g className="donut-center-label" data-center-x={cx} data-center-y={cy} data-inner-radius={innerRadius} pointerEvents="none">
      <text className="donut-center-label__value" x={cx} y={cy - captionFontSize * 0.28} textAnchor="middle" fontSize={valueFontSize}>{value}</text>
      <text className="donut-center-label__caption" x={cx} y={cy + valueFontSize * 0.66} textAnchor="middle" fontSize={captionFontSize}>{caption}</text>
    </g>
  );
}

function AnalyticalWidgetState({ state }: { state: OverviewLoadState }) {
  return (
    <div className={`analytical-widget-state analytical-widget-state--${state.status}`}>
      {state.status === "loading" ? <ArrowsClockwiseIcon className="spin" size={24} /> : <DatabaseIcon size={24} />}
      <strong>{state.status === "loading" ? "Carregando dados publicados" : state.status === "empty" ? "Aguardando primeiro snapshot" : "Dados indisponíveis"}</strong>
      <span>{state.message}</span>
    </div>
  );
}

function AnalyticalEmptyResult({ message }: { message: string }) {
  return <div className="analytical-widget-state analytical-widget-state--empty"><InfoIcon size={24} /><strong>Sem amostra válida</strong><span>{message}</span></div>;
}

function normalizedAnalyticalLabel(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

function renderDashboardWidgets(
  dashboardKey: DashboardKey,
  editing: boolean,
  scaledDemand: typeof demandSeries,
  setCrossFilter: (value: string) => void,
  onOverviewCrossFilter: (field: OverviewCrossFilter["field"], value: string) => void,
  overviewState: OverviewLoadState,
  onOpenOverviewDetails: () => void,
) {
  const chartGrid = <CartesianGrid stroke="#edf0ed" vertical={false} />;
  const paretoTotal = reasonData.reduce((sum, item) => sum + item.value, 0);
  let cumulative = 0;
  const paretoData = reasonData.map((item) => {
    cumulative += item.value;
    return { ...item, cumulative: Math.round((cumulative / paretoTotal) * 100) };
  });

  if (dashboardKey === "overview") {
    if (overviewState.status !== "ready") {
      return [
        <div key="overview-demand"><WidgetFrame title="Evolução da demanda" subtitle="Dados do snapshot publicado" editing={editing} detailsEnabled={false}><AnalyticalWidgetState state={overviewState} /></WidgetFrame></div>,
        <div key="overview-status"><WidgetFrame title="Distribuição por status" subtitle="Retrato atual da base" editing={editing} detailsEnabled={false}><AnalyticalWidgetState state={overviewState} /></WidgetFrame></div>,
        <div key="overview-reason"><WidgetFrame title="Chamados por motivo" subtitle="Principais classificações registradas" editing={editing} detailsEnabled={false}><AnalyticalWidgetState state={overviewState} /></WidgetFrame></div>,
        <div key="overview-priority"><WidgetFrame title="Distribuição por prioridade" subtitle="Ordem de criticidade registrada" editing={editing} detailsEnabled={false}><AnalyticalWidgetState state={overviewState} /></WidgetFrame></div>,
      ];
    }
    const analytics = overviewState.data;
    const hasMatchingTickets = analytics.selection.matchedTickets > 0;
    const liveDemand = analytics.demand.points.map((point) => ({
      label: formatAnalyticsPeriod(point.period),
      chamados: point.opened,
      concluidos: point.completed,
    }));
    const statusColors = ["#146b49", "#90ad9f", "#e6a943", "#6867a5", "#d16a6e", "#6f8fb8", "#9aa39e"];
    const liveStatus = analytics.distributions.status.items.map((item, index) => ({ ...item, color: statusColors[index % statusColors.length] }));
    const priorityColors = ["#b43241", "#de6049", "#e6a943", "#2f8a61", "#83a995", "#6489b5", "#adb4af"];
    const livePriority = analytics.distributions.priority.items.map((item, index) => ({ ...item, color: priorityColors[index % priorityColors.length] }));
    const liveReasons = analytics.distributions.reason.items;
    const completed = liveStatus
      .filter((item) => normalizedAnalyticalLabel(item.name).includes("conclu"))
      .reduce((sum, item) => sum + item.value, 0);
    const completedPercent = analytics.cards.totalTickets > 0
      ? (completed / analytics.cards.totalTickets) * 100
      : 0;
    const completedPercentLabel = `${formatMetricNumber(completedPercent)}%`;
    return [
      <div key="overview-demand">
        <WidgetFrame title="Evolução da demanda" subtitle={`Aberturas e conclusões · por ${analytics.demand.granularity === "day" ? "dia" : "mês"}`} editing={editing} onDetails={onOpenOverviewDetails} action={<span className="coverage-badge">Cobertura {formatMetricNumber(analytics.cards.averagePerCalendarDay.coveragePercent)}%</span>}>
          {hasMatchingTickets && liveDemand.length > 0 ? <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={liveDemand} margin={{ top: 10, right: 6, left: -24, bottom: 0 }}>
              {chartGrid}
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#8c958f" }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#8c958f" }} />
              <Tooltip content={<CustomTooltip />} />
              <Area isAnimationActive={false} type="monotone" dataKey="chamados" name="Abertos" stroke="#146b49" strokeWidth={2.5} fill="#dcebe4" fillOpacity={0.8} />
              <Area isAnimationActive={false} type="monotone" dataKey="concluidos" name="Concluídos" stroke="#90ad9f" strokeWidth={1.8} fill="#f0f4f1" fillOpacity={0.45} />
            </AreaChart>
          </ResponsiveContainer> : <AnalyticalEmptyResult message={hasMatchingTickets ? "Nenhuma data de abertura ou conclusão válida foi encontrada." : "Nenhum chamado corresponde aos filtros aplicados."} />}
        </WidgetFrame>
      </div>,
      <div key="overview-status">
        <WidgetFrame title="Distribuição por status" subtitle={`Cobertura ${formatMetricNumber(analytics.distributions.status.coveragePercent)}% · clique para cruzar`} editing={editing} onDetails={onOpenOverviewDetails}>
          {liveStatus.length > 0 ? <div className="donut-wrap">
            <ResponsiveContainer width="100%" height="55%">
              <PieChart>
                <Pie isAnimationActive={false} data={liveStatus} dataKey="value" nameKey="name" innerRadius="64%" outerRadius="88%" paddingAngle={2} stroke="none" cursor="pointer" onClick={(data) => onOverviewCrossFilter("status", data.name ?? "Sem classificação")}>
                  {liveStatus.map((item) => <Cell key={item.name} fill={item.color} />)}
                  <Label content={(props) => <DonutCenterLabel viewBox={props.viewBox} value={completedPercentLabel} caption="concluídos" />} />
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="legend-list">{liveStatus.map((item) => <button key={item.name} onClick={() => onOverviewCrossFilter("status", item.name)}><i style={{ background: item.color }} /><span>{item.name}</span><b>{item.value}</b></button>)}</div>
          </div> : <AnalyticalEmptyResult message={hasMatchingTickets ? "Nenhum status válido foi encontrado no recorte." : "Nenhum chamado corresponde aos filtros aplicados."} />}
        </WidgetFrame>
      </div>,
      <div key="overview-reason">
        <WidgetFrame title="Chamados por motivo" subtitle={`Cobertura ${formatMetricNumber(analytics.distributions.reason.coveragePercent)}% · clique para cruzar`} editing={editing} onDetails={onOpenOverviewDetails}>
          {liveReasons.length > 0 ? <ResponsiveContainer width="100%" height="100%">
            <BarChart data={liveReasons} layout="vertical" margin={{ top: 4, right: 22, left: 2, bottom: 0 }}>
              <CartesianGrid stroke="#edf0ed" horizontal={false} />
              <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#8c958f" }} />
              <YAxis type="category" dataKey="name" width={82} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#606963" }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar isAnimationActive={false} dataKey="value" name="Chamados" radius={[0, 5, 5, 0]} fill="#1a7450" maxBarSize={18} cursor="pointer" onClick={(data) => onOverviewCrossFilter("reason", data.name ?? "Sem classificação")} />
            </BarChart>
          </ResponsiveContainer> : <AnalyticalEmptyResult message={hasMatchingTickets ? "Nenhum motivo textual válido foi encontrado no recorte." : "Nenhum chamado corresponde aos filtros aplicados."} />}
        </WidgetFrame>
      </div>,
      <div key="overview-priority">
        <WidgetFrame title="Distribuição por prioridade" subtitle={`Cobertura ${formatMetricNumber(analytics.distributions.priority.coveragePercent)}% · clique para cruzar`} editing={editing} onDetails={onOpenOverviewDetails} action={<span className="sample-badge">N = {analytics.cards.totalTickets}</span>}>
          {livePriority.length > 0 ? <ResponsiveContainer width="100%" height="100%">
            <BarChart data={livePriority} margin={{ top: 8, right: 26, left: -24, bottom: 0 }}>
              {chartGrid}
              <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#747d77" }} interval={0} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#8c958f" }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar isAnimationActive={false} dataKey="value" name="Chamados" radius={[5, 5, 0, 0]} maxBarSize={34} cursor="pointer" onClick={(data) => onOverviewCrossFilter("priority", data.name ?? "Sem classificação")}>
                {livePriority.map((item) => <Cell key={item.name} fill={item.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer> : <AnalyticalEmptyResult message={hasMatchingTickets ? "Nenhuma prioridade válida foi encontrada no recorte." : "Nenhum chamado corresponde aos filtros aplicados."} />}
        </WidgetFrame>
      </div>,
    ];
  }

  if (dashboardKey === "demand") {
    return [
      <div key="demand-trend">
        <WidgetFrame title="Evolução e sazonalidade" subtitle="Aberturas e conclusões por quinzena" editing={editing} action={<span className="coverage-badge">Jul/out parciais</span>}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={scaledDemand} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
              {chartGrid}
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#8c958f" }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#8c958f" }} />
              <Tooltip content={<CustomTooltip />} />
              <Area isAnimationActive={false} type="monotone" dataKey="chamados" name="Aberturas" stroke="#176f4c" strokeWidth={2.5} fill="#dcebe4" />
              <Area isAnimationActive={false} type="monotone" dataKey="concluidos" name="Conclusões" stroke="#688c7a" strokeWidth={1.6} fill="transparent" />
            </AreaChart>
          </ResponsiveContainer>
        </WidgetFrame>
      </div>,
      <div key="demand-heatmap">
        <WidgetFrame title="Demanda por dia e horário" subtitle="Concentração das aberturas · faixas de 3 horas" editing={editing}>
          <div className="heatmap-chart">
            <div className="heatmap-axis"><span /><span>00h</span><span>03h</span><span>06h</span><span>09h</span><span>12h</span><span>15h</span><span>18h</span><span>21h</span></div>
            {heatmap.map((row, rowIndex) => <div className="heatmap-row" key={rowIndex}><span>{["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"][rowIndex]}</span>{row.map((value, columnIndex) => <button key={columnIndex} aria-label={`${value} chamados`} style={{ backgroundColor: `rgba(23, 111, 76, ${0.08 + value / 11})` }} onClick={() => setCrossFilter(`${["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"][rowIndex]} · ${columnIndex * 3}h`)}>{value || ""}</button>)}</div>)}
            <div className="heatmap-scale"><span>Menor volume</span><i /><i /><i /><i /><span>Maior volume</span></div>
          </div>
        </WidgetFrame>
      </div>,
      <div key="demand-reasons">
        <WidgetFrame title="Chamados por motivo" subtitle="Volume absoluto e participação" editing={editing}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={reasonData} layout="vertical" margin={{ top: 4, right: 22, left: 4, bottom: 0 }}>
              <CartesianGrid stroke="#edf0ed" horizontal={false} />
              <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#8c958f" }} />
              <YAxis type="category" dataKey="name" width={80} tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#606963" }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar isAnimationActive={false} dataKey="value" name="Chamados" fill="#2f8a61" radius={[0, 5, 5, 0]} maxBarSize={18} onClick={(data) => setCrossFilter(data.name ?? "Sem classificação")} />
            </BarChart>
          </ResponsiveContainer>
        </WidgetFrame>
      </div>,
      <div key="demand-pareto">
        <WidgetFrame title="Pareto dos motivos" subtitle="Volume e participação acumulada" editing={editing} action={<span className="sample-badge">Top 5 = 100%</span>}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={paretoData} margin={{ top: 8, right: 12, left: -24, bottom: 0 }}>
              {chartGrid}
              <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#747d77" }} />
              <YAxis yAxisId="left" tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#8c958f" }} />
              <YAxis yAxisId="right" orientation="right" domain={[0, 100]} hide />
              <Tooltip content={<CustomTooltip />} />
              <Bar yAxisId="left" isAnimationActive={false} dataKey="value" name="Chamados" fill="#75a28b" radius={[4, 4, 0, 0]} maxBarSize={30} />
              <Line yAxisId="right" isAnimationActive={false} type="monotone" dataKey="cumulative" name="% acumulado" stroke="#176f4c" strokeWidth={2.5} dot={{ r: 3, fill: "#176f4c" }} />
            </ComposedChart>
          </ResponsiveContainer>
        </WidgetFrame>
      </div>,
    ];
  }

  if (dashboardKey === "pending") {
    return [
      <div key="pending-age">
        <WidgetFrame title="Idade das pendências" subtitle="Faixas de tempo desde a abertura" editing={editing} action={<span className="sample-badge">N = 5</span>}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={pendingAgeData} margin={{ top: 8, right: 12, left: -24, bottom: 0 }}>
              {chartGrid}
              <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#747d77" }} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#8c958f" }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar isAnimationActive={false} dataKey="value" name="Pendências" fill="#d29a3d" radius={[5, 5, 0, 0]} maxBarSize={44} />
            </BarChart>
          </ResponsiveContainer>
        </WidgetFrame>
      </div>,
      <div key="pending-oldest">
        <WidgetFrame title="Pendências mais antigas" subtitle="Prioridade para revisão da fila" editing={editing}>
          <div className="ranked-list">{oldestPending.map((item, index) => <button key={item.id} onClick={() => setCrossFilter(item.id)}><span className="ranked-list__index">{index + 1}</span><span><strong>{item.id} · {item.reason}</strong><small>{item.sector}</small></span><b>{item.age}</b></button>)}</div>
        </WidgetFrame>
      </div>,
      <div key="pending-composition">
        <WidgetFrame title="Composição das pendências" subtitle="Setor × prioridade registrada" editing={editing}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={pendingCompositionData} layout="vertical" margin={{ top: 4, right: 18, left: 6, bottom: 0 }}>
              <CartesianGrid stroke="#edf0ed" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#8c958f" }} />
              <YAxis type="category" dataKey="name" width={96} tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#606963" }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar isAnimationActive={false} dataKey="critica" name="Crítica" stackId="pending" fill="#b5474c" maxBarSize={22} />
              <Bar isAnimationActive={false} dataKey="alta" name="Alta" stackId="pending" fill="#e6a943" maxBarSize={22} />
              <Bar isAnimationActive={false} dataKey="media" name="Média" stackId="pending" fill="#6f9d85" radius={[0, 5, 5, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </WidgetFrame>
      </div>,
    ];
  }

  if (dashboardKey === "sla") {
    const coveragePie = [{ name: "Avaliado", value: 43.6, color: "#176f4c" }, { name: "Não avaliado", value: 56.4, color: "#e5ebe7" }];
    return [
      <div key="sla-histogram">
        <WidgetFrame title="Tempo até o primeiro atendimento" subtitle="Distribuição dos 280 registros válidos" editing={editing} action={<span className="coverage-badge">Mediana 38 min</span>}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={responseHistogram} margin={{ top: 8, right: 12, left: -24, bottom: 0 }}>
              {chartGrid}
              <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#747d77" }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#8c958f" }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar isAnimationActive={false} dataKey="value" name="Chamados" fill="#6968a6" radius={[5, 5, 0, 0]} maxBarSize={44} />
            </BarChart>
          </ResponsiveContainer>
        </WidgetFrame>
      </div>,
      <div key="sla-compliance">
        <WidgetFrame title="Cumprimento por prioridade" subtitle="Dentro e fora do SLA registrado" editing={editing}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={slaByPriority} layout="vertical" margin={{ top: 4, right: 14, left: 8, bottom: 0 }}>
              <CartesianGrid stroke="#edf0ed" horizontal={false} />
              <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#8c958f" }} />
              <YAxis type="category" dataKey="name" width={76} tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#606963" }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar isAnimationActive={false} dataKey="dentro" name="Dentro" stackId="sla" fill="#2f8a61" maxBarSize={22} />
              <Bar isAnimationActive={false} dataKey="fora" name="Fora" stackId="sla" fill="#c85d62" radius={[0, 5, 5, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </WidgetFrame>
      </div>,
      <div key="sla-comparison">
        <WidgetFrame title="Tempos por prioridade" subtitle="Mediana e P90 · minutos corridos" editing={editing} action={<span className="sample-badge">N mínimo 20</span>}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={timeComparisonData} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
              {chartGrid}
              <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#747d77" }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#8c958f" }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar isAnimationActive={false} dataKey="mediana" name="Mediana" fill="#8d8cc1" radius={[5, 5, 0, 0]} maxBarSize={34} />
              <Line isAnimationActive={false} type="monotone" dataKey="p90" name="P90" stroke="#4d4c8c" strokeWidth={2.5} dot={{ r: 3, fill: "#4d4c8c" }} />
            </ComposedChart>
          </ResponsiveContainer>
        </WidgetFrame>
      </div>,
      <div key="sla-coverage">
        <WidgetFrame title="Cobertura da avaliação" subtitle="Quanto da base sustenta o SLA" editing={editing}>
          <div className="coverage-donut">
            <ResponsiveContainer width="100%" height="72%">
              <PieChart><Pie isAnimationActive={false} data={coveragePie} dataKey="value" innerRadius="62%" outerRadius="88%" paddingAngle={2} stroke="none">{coveragePie.map((item) => <Cell key={item.name} fill={item.color} />)}</Pie><Tooltip content={<CustomTooltip />} /></PieChart>
            </ResponsiveContainer>
            <div className="coverage-donut__center"><strong>43,6%</strong><span>avaliado</span></div>
            <p><WarningCircleIcon size={14} weight="fill" />Abaixo do limiar recomendado de 80%</p>
          </div>
        </WidgetFrame>
      </div>,
    ];
  }

  if (dashboardKey === "movement") {
    return [
      <div key="movement-types">
        <WidgetFrame title="Movimentações por tipo" subtitle="72 eventos do histórico recente" editing={editing} action={<span className="sample-badge">37 chamados</span>}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={movementTypeData} margin={{ top: 8, right: 12, left: -24, bottom: 0 }}>
              {chartGrid}
              <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 8, fill: "#747d77" }} interval={0} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#8c958f" }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar isAnimationActive={false} dataKey="value" name="Eventos" fill="#367986" radius={[5, 5, 0, 0]} maxBarSize={38} />
            </BarChart>
          </ResponsiveContainer>
        </WidgetFrame>
      </div>,
      <div key="movement-timeline">
        <WidgetFrame title="Linha do tempo recente" subtitle="Ações registradas pelos profissionais" editing={editing}>
          <div className="event-timeline">{movementTimeline.map((item) => <button key={item.time + item.ticket} onClick={() => setCrossFilter(item.ticket)}><time>{item.time}</time><i /><span><strong>{item.event}</strong><small>{item.ticket} · {item.author}</small></span></button>)}</div>
        </WidgetFrame>
      </div>,
      <div key="movement-stages">
        <WidgetFrame title="Composição do tempo por chamado" subtitle="Andamento, espera por informação e fornecedor · minutos" editing={editing}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stageCompositionData} layout="vertical" margin={{ top: 4, right: 18, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#edf0ed" horizontal={false} />
              <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#8c958f" }} />
              <YAxis type="category" dataKey="name" width={54} tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#606963" }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar isAnimationActive={false} dataKey="andamento" name="Em andamento" stackId="time" fill="#2e8b78" maxBarSize={22} />
              <Bar isAnimationActive={false} dataKey="informacao" name="Aguardando informação" stackId="time" fill="#e3aa49" maxBarSize={22} />
              <Bar isAnimationActive={false} dataKey="fornecedor" name="Com fornecedor" stackId="time" fill="#6d6fb4" radius={[0, 5, 5, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </WidgetFrame>
      </div>,
      <div key="movement-coverage">
        <WidgetFrame title="Cobertura do histórico" subtitle="Base elegível para indicadores por etapa" editing={editing}>
          <div className="coverage-summary"><strong>7,1%</strong><span>37 de 518 chamados</span><div><i style={{ width: "7.1%" }} /></div><p>Os tempos por etapa representam apenas a amostra recente.</p></div>
        </WidgetFrame>
      </div>,
    ];
  }

  const reliabilityPie = [{ name: "Íntegros", value: 93, color: "#2f8a61" }, { name: "Com alerta", value: 7, color: "#e5ebe7" }];
  return [
    <div key="quality-coverage">
      <WidgetFrame title="Cobertura dos registros" subtitle="Presença dos campos necessários para cada análise" editing={editing}>
        <div className="coverage-bars">{coverageData.map((item) => <button key={item.name} onClick={() => setCrossFilter(item.name)}><span><strong>{item.name}</strong><b>{item.value.toLocaleString("pt-BR")}%</b></span><div><i style={{ width: `${item.value}%` }} /></div></button>)}</div>
      </WidgetFrame>
    </div>,
    <div key="quality-score">
      <WidgetFrame title="Confiabilidade da carga" subtitle="Validações estruturais da última sincronização" editing={editing}>
        <div className="quality-score">
          <ResponsiveContainer width="100%" height="72%"><PieChart><Pie isAnimationActive={false} data={reliabilityPie} dataKey="value" innerRadius="65%" outerRadius="88%" paddingAngle={2} stroke="none">{reliabilityPie.map((item) => <Cell key={item.name} fill={item.color} />)}</Pie></PieChart></ResponsiveContainer>
          <div><strong>93</strong><span>/ 100</span></div>
          <p><CheckCircleIcon size={14} weight="fill" />Carga íntegra, com 12 alertas não críticos</p>
        </div>
      </WidgetFrame>
    </div>,
    <div key="quality-errors">
      <WidgetFrame title="Inconsistências encontradas" subtitle="Registros afetados por regra de validação" editing={editing} action={<span className="sample-badge">12 alertas</span>}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={inconsistencyData} layout="vertical" margin={{ top: 4, right: 18, left: 8, bottom: 0 }}>
            <CartesianGrid stroke="#edf0ed" horizontal={false} />
            <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#8c958f" }} />
            <YAxis type="category" dataKey="name" width={122} tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#606963" }} />
            <Tooltip content={<CustomTooltip />} />
            <Bar isAnimationActive={false} dataKey="value" name="Registros" fill="#bd6269" radius={[0, 5, 5, 0]} maxBarSize={20} />
          </BarChart>
        </ResponsiveContainer>
      </WidgetFrame>
    </div>,
    <div key="quality-rules">
      <WidgetFrame title="Regras de qualidade" subtitle="Como os dados são protegidos antes da publicação" editing={editing}>
        <div className="rule-list"><span><CheckCircleIcon size={16} weight="fill" /><strong>Datas válidas</strong><small>Horários invertidos ficam fora dos cálculos.</small></span><span><CheckCircleIcon size={16} weight="fill" /><strong>Carga atômica</strong><small>A versão anterior permanece disponível em caso de falha.</small></span><span><CheckCircleIcon size={16} weight="fill" /><strong>Cobertura explícita</strong><small>N e percentual válido acompanham cada indicador.</small></span></div>
      </WidgetFrame>
    </div>,
  ];
}

type DashboardDraftEditor = {
  current: DashboardDraftSnapshot;
  saved: DashboardDraftSnapshot;
};

type DraftPersistenceStatus = "loading" | "ready" | "saving" | "error";

type DashboardDraftApiResponse = {
  ok: boolean;
  draft?: DashboardDraftSnapshot | null;
  error?: string;
};

function toDraftLayout(layout: Layout): DraftLayoutItem[] {
  const draftLayout = layout.map((item) => {
    const draftItem: DraftLayoutItem = { i: item.i, x: item.x, y: item.y, w: item.w, h: item.h };
    if (item.minW !== undefined) draftItem.minW = item.minW;
    if (item.minH !== undefined) draftItem.minH = item.minH;
    if (item.maxW !== undefined) draftItem.maxW = item.maxW;
    if (item.maxH !== undefined) draftItem.maxH = item.maxH;
    return draftItem;
  });
  return resolveDashboardLayoutCollisions(draftLayout);
}

function initialDashboardDraft(dashboardKey: DashboardKey): DashboardDraftEditor {
  const fallback = createDefaultDashboardDraft(dashboardKey, dashboardLayouts[dashboardKey]);
  return { current: cloneDashboardDraft(fallback), saved: fallback };
}

function normalizeApiDraft(payload: DashboardDraftApiResponse, dashboardKey: DashboardKey): DashboardDraftSnapshot | null {
  if (!payload.draft) return null;
  return parseDashboardDraft(serializeDashboardDraft(payload.draft), dashboardKey, dashboardLayouts[dashboardKey]);
}

function Dashboard({ dashboardKey, currentUser, onBack }: { dashboardKey: DashboardKey; currentUser: CurrentUser; onBack: () => void }) {
  const theme = dashboardThemes.find((item) => item.key === dashboardKey) ?? dashboardThemes[0];
  const [editing, setEditing] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderWidgetId, setBuilderWidgetId] = useState<string | null>(null);
  const [activePageId, setActivePageId] = useState("page-1");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [crossFilter, setCrossFilter] = useState<string | null>(null);
  const [overviewCrossFilter, setOverviewCrossFilter] = useState<OverviewCrossFilter | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [draftEditor, setDraftEditor] = useState<DashboardDraftEditor>(() => initialDashboardDraft(dashboardKey));
  const [draftPersistenceStatus, setDraftPersistenceStatus] = useState<DraftPersistenceStatus>("loading");
  const [overviewState, setOverviewState] = useState<OverviewLoadState>(() => dashboardKey === "overview"
    ? { status: "loading", data: null, message: "Consultando o snapshot publicado." }
    : { status: "empty", data: null, message: "Modelo analítico não utilizado neste painel." });
  const { width, containerRef, mounted } = useContainerWidth();
  const boundedDashboardCompactor = useMemo(() => createBoundedDashboardCompactor(DASHBOARD_PAGE_MAX_ROWS), []);
  const interactionStartLayout = useRef<Layout | null>(null);
  const activePage = draftEditor.current.pages.find((page) => page.id === activePageId) ?? draftEditor.current.pages[0];
  const layout = (activePage?.layout ?? []) as Layout;
  const activeLayoutIds = new Set(layout.map((item) => item.i));
  const customWidgets = draftEditor.current.customWidgets.filter((widget) => activeLayoutIds.has(widget.id));
  const builderWidget = builderWidgetId ? draftEditor.current.customWidgets.find((widget) => widget.id === builderWidgetId) ?? null : null;
  const hasUnsavedChanges = !dashboardDraftsEqual(draftEditor.current, draftEditor.saved);
  const persistenceBusy = draftPersistenceStatus === "loading" || draftPersistenceStatus === "saving";

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let toastTimer: number | undefined;

    async function loadDraft() {
      setDraftPersistenceStatus("loading");
      try {
        const response = await fetch(`/api/dashboard-drafts/${dashboardKey}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json() as DashboardDraftApiResponse;
        if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Não foi possível carregar o painel.");

        let saved = normalizeApiDraft(payload, dashboardKey);
        if (payload.draft && !saved) throw new Error("O servidor retornou um rascunho incompatível.");

        if (!saved) {
          const userStorageKey = dashboardDraftStorageKey(dashboardKey, currentUser.id);
          const legacyStorageKeys = currentUser.role === "administrador"
            ? [userStorageKey, dashboardDraftStorageKey(dashboardKey, currentUser.id, 1), dashboardDraftStorageKey(dashboardKey), dashboardDraftStorageKey(dashboardKey, "admin", 1)]
            : [userStorageKey, dashboardDraftStorageKey(dashboardKey, currentUser.id, 1)];
          let legacyRaw: string | null = null;
          let migratedStorageKey: string | null = null;
          try {
            for (const storageKey of legacyStorageKeys) {
              legacyRaw = window.localStorage.getItem(storageKey);
              if (legacyRaw) {
                migratedStorageKey = storageKey;
                break;
              }
            }
          } catch {
            // O servidor continua sendo a fonte principal mesmo sem acesso ao armazenamento legado.
          }
          const legacyDraft = legacyRaw ? parseDashboardDraft(legacyRaw, dashboardKey, dashboardLayouts[dashboardKey]) : null;

          if (legacyDraft) {
            const migrationResponse = await fetch(`/api/dashboard-drafts/${dashboardKey}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: serializeDashboardDraft(legacyDraft),
              signal: controller.signal,
            });
            const migrationPayload = await migrationResponse.json() as DashboardDraftApiResponse;
            saved = normalizeApiDraft(migrationPayload, dashboardKey);
            if (!migrationResponse.ok || !migrationPayload.ok || !saved) {
              throw new Error(migrationPayload.error ?? "Não foi possível migrar o rascunho local.");
            }
            if (migratedStorageKey) window.localStorage.removeItem(migratedStorageKey);
            if (active) {
              setToast("Rascunho local migrado para o servidor");
              toastTimer = window.setTimeout(() => setToast(null), 2600);
            }
          }
        }

        if (!active) return;
        const resolved = saved ?? createDefaultDashboardDraft(dashboardKey, dashboardLayouts[dashboardKey]);
        setDraftEditor({ current: cloneDashboardDraft(resolved), saved: resolved });
        setActivePageId((current) => resolved.pages.some((page) => page.id === current) ? current : resolved.pages[0].id);
        setDraftPersistenceStatus("ready");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (!active) return;
        setDraftPersistenceStatus("error");
        setToast("Não foi possível carregar o rascunho do servidor");
        toastTimer = window.setTimeout(() => setToast(null), 2600);
      }
    }

    void loadDraft();
    return () => {
      active = false;
      controller.abort();
      if (toastTimer !== undefined) window.clearTimeout(toastTimer);
    };
  }, [currentUser.id, currentUser.role, dashboardKey]);

  useEffect(() => {
    if (dashboardKey !== "overview") return;
    const controller = new AbortController();
    void loadOverviewAnalytics(filters, overviewCrossFilter, controller.signal)
      .then((data) => setOverviewState(data
        ? { status: "ready", data, message: "Snapshot publicado carregado." }
        : { status: "empty", data: null, message: "Conclua uma sincronização para publicar os primeiros indicadores reais." }))
      .catch((loadError) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setOverviewState({
          status: "error",
          data: null,
          message: loadError instanceof Error ? loadError.message : "Não foi possível carregar os indicadores.",
        });
      });
    return () => controller.abort();
  }, [dashboardKey, filters, overviewCrossFilter]);

  function setLayout(updater: Layout | ((current: Layout) => Layout)) {
    setDraftEditor((state) => {
      const page = state.current.pages.find((candidate) => candidate.id === activePageId) ?? state.current.pages[0];
      const nextLayout = typeof updater === "function" ? updater(page.layout as Layout) : updater;
      const nextDraftLayout = toDraftLayout(nextLayout);
      if (dashboardPageLayoutsEqual(page.layout, nextDraftLayout)) return state;
      return {
        ...state,
        current: {
          ...state.current,
          pages: state.current.pages.map((candidate) => candidate.id === page.id
            ? { ...candidate, layout: nextDraftLayout }
            : candidate),
        },
      };
    });
  }

  function markOverviewReloading(message: string) {
    if (dashboardKey === "overview") {
      setOverviewState({ status: "loading", data: null, message });
    }
  }

  function updateFilters(nextFilters: Filters) {
    markOverviewReloading("Aplicando filtros ao snapshot publicado.");
    setFilters(nextFilters);
  }

  function applyFilters(nextFilters: Filters) {
    markOverviewReloading("Aplicando filtros ao snapshot publicado.");
    setOverviewCrossFilter(null);
    setFilters(nextFilters);
  }

  function applyOverviewCrossFilter(field: OverviewCrossFilter["field"], value: string) {
    const nextCrossFilter = overviewCrossFilter?.field === field && overviewCrossFilter.value === value
      ? null
      : { field, value };
    markOverviewReloading(nextCrossFilter ? "Aplicando seleção cruzada ao snapshot." : "Removendo seleção cruzada.");
    setOverviewCrossFilter(nextCrossFilter);
  }

  const scale = useMemo(() => {
    let result = filters.period === "Últimos 30 dias" ? 0.34 : filters.period === "Últimos 90 dias" ? 0.78 : 1;
    if (filters.sector !== "Todos os setores") result *= 0.19;
    if (filters.priority !== "Todas") result *= 0.23;
    if (crossFilter) result *= 0.33;
    return result;
  }, [filters, crossFilter]);

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }

  function cancelEditing() {
    const restored = cloneDashboardDraft(draftEditor.saved);
    setActivePageId((pageId) => restored.pages.some((page) => page.id === pageId) ? pageId : restored.pages[0].id);
    setDraftEditor((state) => ({ ...state, current: restored }));
    setEditing(false);
    flash(hasUnsavedChanges ? "Alterações não salvas descartadas" : "Edição encerrada");
  }

  function restoreInitialLayout() {
    setDraftEditor((state) => {
      const page = state.current.pages.find((candidate) => candidate.id === activePageId) ?? state.current.pages[0];
      const removedWidgetIds = new Set(page.layout.filter((item) => item.i.startsWith("custom-")).map((item) => item.i));
      const isFirstPage = state.current.pages[0].id === page.id;
      return {
        ...state,
        current: {
          ...state.current,
          pages: state.current.pages.map((candidate) => candidate.id === page.id
            ? { ...candidate, layout: isFirstPage ? dashboardLayouts[dashboardKey].map((item) => ({ ...item })) : [] }
            : candidate),
          customWidgets: state.current.customWidgets.filter((widget) => !removedWidgetIds.has(widget.id)),
        },
      };
    });
    flash(activePage?.id === draftEditor.current.pages[0].id ? "Layout inicial aplicado à Página 1" : "Página esvaziada; salve para confirmar");
  }

  function createPage() {
    if (draftEditor.current.pages.length >= DASHBOARD_MAX_PAGES) {
      flash(`Limite de ${DASHBOARD_MAX_PAGES} páginas atingido`);
      return;
    }
    const id = `page-${crypto.randomUUID()}`;
    const name = `Página ${draftEditor.current.pages.length + 1}`;
    setDraftEditor((state) => ({
      ...state,
      current: { ...state.current, pages: [...state.current.pages, { id, name, layout: [] }] },
    }));
    setActivePageId(id);
    setEditing(true);
    setFiltersOpen(false);
    flash(`${name} criada no rascunho`);
  }

  function selectPage(pageId: string) {
    setActivePageId(pageId);
    setFiltersOpen(false);
    setBuilderOpen(false);
    setBuilderWidgetId(null);
    setDetailsOpen(false);
  }

  async function exportOverviewCsv() {
    if (dashboardKey !== "overview" || overviewState.status !== "ready" || exporting) return;
    setExporting(true);
    try {
      await downloadOverviewCsv(filters, overviewCrossFilter);
      flash("CSV exportado com o recorte e as proteções atuais");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Não foi possível exportar o painel");
    } finally {
      setExporting(false);
    }
  }

  async function saveDraft() {
    if (draftPersistenceStatus === "saving") return;
    try {
      const candidate: DashboardDraftSnapshot = {
        ...draftEditor.current,
        savedAt: new Date().toISOString(),
      };
      const serialized = serializeDashboardDraft(candidate);
      const normalized = parseDashboardDraft(serialized, dashboardKey, dashboardLayouts[dashboardKey]);
      if (!normalized) throw new Error("rascunho_inválido");

      setDraftPersistenceStatus("saving");
      setEditing(false);
      const response = await fetch(`/api/dashboard-drafts/${dashboardKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: serializeDashboardDraft(normalized),
      });
      const payload = await response.json() as DashboardDraftApiResponse;
      const saved = normalizeApiDraft(payload, dashboardKey);
      if (!response.ok || !payload.ok || !saved) throw new Error(payload.error ?? "rascunho_não_salvo");

      window.localStorage.removeItem(dashboardDraftStorageKey(dashboardKey, currentUser.id));
      window.localStorage.removeItem(dashboardDraftStorageKey(dashboardKey, currentUser.id, 1));
      if (currentUser.role === "administrador") {
        window.localStorage.removeItem(dashboardDraftStorageKey(dashboardKey));
        window.localStorage.removeItem(dashboardDraftStorageKey(dashboardKey, "admin", 1));
      }
      setDraftEditor({ current: cloneDashboardDraft(saved), saved });
      setDraftPersistenceStatus("ready");
      setEditing(false);
      flash("Layout e métricas salvos no servidor");
    } catch {
      setDraftPersistenceStatus("error");
      setEditing(true);
      flash("Não foi possível salvar o rascunho no servidor");
    }
  }

  function addWidget(definition: MetricDefinitionDraft, preview: MetricPreview) {
    const id = `custom-${Date.now()}`;
    const widget: DraftCustomWidget = {
      id,
      title: definition.name,
      visualization: definition.visualization,
      formula: preview.formula,
      definition,
      preview,
    };
    const placement = findDashboardItemPlacement(
      { i: id, x: 0, y: 0, w: 6, h: 4, minW: 4, minH: 3 },
      activePage?.layout ?? [],
    );
    if (!placement || !activePage) {
      flash("Esta página está cheia; crie uma nova página para adicionar o indicador");
      return;
    }
    setDraftEditor((state) => {
      return {
        ...state,
        current: {
          ...state.current,
          customWidgets: [...state.current.customWidgets, widget],
          pages: state.current.pages.map((page) => page.id === activePage.id
            ? { ...page, layout: [...page.layout, placement] }
            : page),
        },
      };
    });
    setBuilderOpen(false);
    setBuilderWidgetId(null);
    setEditing(true);
    flash("Indicador adicionado ao rascunho");
  }

  function updateWidget(definition: MetricDefinitionDraft, preview: MetricPreview) {
    if (!builderWidgetId) return;
    setDraftEditor((state) => ({
      ...state,
      current: {
        ...state.current,
        customWidgets: state.current.customWidgets.map((widget) => widget.id === builderWidgetId ? {
          ...widget,
          title: definition.name,
          visualization: definition.visualization,
          formula: preview.formula,
          definition,
          preview,
        } : widget),
      },
    }));
    setBuilderOpen(false);
    setBuilderWidgetId(null);
    flash("Métrica atualizada no rascunho; salve para confirmar");
  }

  function closeBuilder() {
    setBuilderOpen(false);
    setBuilderWidgetId(null);
  }

  function removeCustomWidget(widgetId: string) {
    setDraftEditor((state) => ({
      ...state,
      current: {
        ...state.current,
        customWidgets: state.current.customWidgets.filter((widget) => widget.id !== widgetId),
        pages: state.current.pages.map((page) => ({ ...page, layout: page.layout.filter((item) => item.i !== widgetId) })),
      },
    }));
    flash("Métrica removida do rascunho; salve para confirmar");
  }

  const scaledDemand = demandSeries.map((item) => ({ ...item, chamados: Math.max(1, Math.round(item.chamados * scale)), concluidos: Math.max(1, Math.round(item.concluidos * scale)) }));
  const metrics = dashboardKey === "overview" ? overviewMetrics(overviewState) : themeMetrics[dashboardKey];
  const allMetrics = dashboardKey === "overview"
    ? metrics
    : metrics.map((metric) => metric.id === "metric-total" && scale !== 1 ? { ...metric, value: String(Math.round(Number(metric.value) * scale)) } : metric);
  const visibleMetrics = allMetrics.filter((metric) => activeLayoutIds.has(metric.id));
  const overviewPeriod = overviewState.status === "ready"
    && overviewState.data.selection.periodStart
    && overviewState.data.selection.periodEnd
    ? `${formatAnalyticsDate(overviewState.data.selection.periodStart)} — ${formatAnalyticsDate(overviewState.data.selection.periodEnd)}`
    : "Período indisponível";
  const filterOptions = overviewState.status === "ready" ? overviewState.data.selection.options : demoFilterOptions;
  const overviewFiltersAvailable = dashboardKey !== "overview" || overviewState.status === "ready";
  const dataQualityLabel = dashboardKey !== "overview"
    ? "Base demonstrativa · conexão analítica pendente"
    : overviewState.status === "ready"
      ? `Recorte: ${overviewState.data.selection.matchedTickets}/${overviewState.data.selection.totalTickets} · ${overviewState.data.snapshot.warningCount} alerta(s) · carga ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(overviewState.data.snapshot.publishedAt))}`
      : overviewState.message;

  return (
    <div className="page page--dashboard">
      <div className="dashboard-heading">
        <div>
          <button className="back-link" onClick={onBack}><ArrowLeftIcon size={15} /> Catálogo</button>
          <h1>{theme.title}</h1>
          <p>{theme.description}</p>
        </div>
        <div className="dashboard-heading__actions">
          <span className={`draft-persistence draft-persistence--${draftPersistenceStatus}`} role="status">
            {draftPersistenceStatus === "error" ? <WarningCircleIcon size={15} weight="fill" /> : persistenceBusy ? <ArrowsClockwiseIcon className="spin" size={15} /> : <CloudCheckIcon size={15} weight="fill" />}
            {draftPersistenceStatus === "loading" ? "Carregando painel" : draftPersistenceStatus === "saving" ? "Salvando" : draftPersistenceStatus === "error" ? "Servidor indisponível" : "Painel sincronizado"}
          </span>
          <button
            className="button button--ghost"
            disabled={dashboardKey !== "overview" || overviewState.status !== "ready" || exporting}
            title={dashboardKey !== "overview" ? "A exportação será conectada quando este painel usar o snapshot real." : overviewState.status !== "ready" ? "Aguarde o snapshot real ser carregado." : "Exportar o recorte atual em CSV"}
            onClick={() => void exportOverviewCsv()}
          ><DownloadSimpleIcon size={17} /> {exporting ? "Exportando..." : "Exportar CSV"}</button>
          {editing ? (
            <>
              <button className="button button--ghost" disabled={persistenceBusy} onClick={restoreInitialLayout}>Restaurar</button>
              <button className="button button--primary" disabled={!hasUnsavedChanges || persistenceBusy} onClick={() => void saveDraft()}><FloppyDiskIcon size={17} /> {draftPersistenceStatus === "saving" ? "Salvando..." : "Salvar layout"}</button>
            </>
          ) : (
            <button className="button button--ghost" disabled={persistenceBusy} onClick={() => setEditing(true)}><PencilSimpleIcon size={17} /> Editar layout</button>
          )}
          <button className="button button--primary" disabled={persistenceBusy || dashboardKey === "overview"} title={dashboardKey === "overview" ? "Métricas personalizadas serão reativadas após o avaliador usar o snapshot real." : undefined} onClick={() => { setBuilderWidgetId(null); setBuilderOpen(true); }}><PlusIcon size={17} /> Indicador</button>
        </div>
      </div>

      <section className="filter-bar">
        <button className="filter-bar__main" disabled={!overviewFiltersAvailable} title={!overviewFiltersAvailable ? "Aguarde o carregamento do snapshot para filtrar." : undefined} onClick={() => setFiltersOpen((value) => !value)}><FunnelSimpleIcon size={17} /><strong>Filtros</strong><span>{filters.period}</span><CaretDownIcon size={14} /></button>
        <span className="filter-separator" />
        <button className="filter-pill" disabled={dashboardKey === "overview"}><CalendarBlankIcon size={15} /> {dashboardKey === "overview" ? overviewPeriod : "07 jul — 20 out"}</button>
        <div className="dashboard-pages" role="tablist" aria-label="Páginas do painel">
          {draftEditor.current.pages.map((page) => <button key={page.id} role="tab" aria-selected={page.id === activePage?.id} className={page.id === activePage?.id ? "is-active" : ""} onClick={() => selectPage(page.id)}>{page.name}</button>)}
          <button className="dashboard-pages__add" aria-label="Criar nova página" title={`Criar página vazia (${draftEditor.current.pages.length}/${DASHBOARD_MAX_PAGES})`} disabled={draftEditor.current.pages.length >= DASHBOARD_MAX_PAGES || persistenceBusy} onClick={createPage}><PlusIcon size={13} /></button>
        </div>
        {filters.sector !== defaultFilters.sector && <button className="filter-chip" onClick={() => updateFilters({ ...filters, sector: defaultFilters.sector })}>Setor: {filters.sector}<XIcon size={12} /></button>}
        {filters.priority !== defaultFilters.priority && overviewCrossFilter?.field !== "priority" && <button className="filter-chip" onClick={() => updateFilters({ ...filters, priority: defaultFilters.priority })}>Prioridade: {filters.priority}<XIcon size={12} /></button>}
        {filters.status !== defaultFilters.status && overviewCrossFilter?.field !== "status" && <button className="filter-chip" onClick={() => updateFilters({ ...filters, status: defaultFilters.status })}>Status: {filters.status}<XIcon size={12} /></button>}
        {dashboardKey === "overview" && overviewCrossFilter && <button className="filter-chip filter-chip--active" onClick={() => applyOverviewCrossFilter(overviewCrossFilter.field, overviewCrossFilter.value)}>{overviewCrossFilterLabels[overviewCrossFilter.field]} cruzado: {overviewCrossFilter.value}<XIcon size={12} /></button>}
        {dashboardKey !== "overview" && crossFilter && <button className="filter-chip filter-chip--active" onClick={() => setCrossFilter(null)}>Categoria: {crossFilter}<XIcon size={12} /></button>}
        <span className="filter-bar__spacer" />
        <span className="data-quality"><InfoIcon size={15} /> {dataQualityLabel}</span>
      </section>

      {filtersOpen && <FilterPanel filters={filters} options={filterOptions} onChange={applyFilters} onClose={() => setFiltersOpen(false)} />}

      {editing && (
        <div className="edit-notice"><PencilSimpleIcon size={16} /><span><strong>{hasUnsavedChanges ? "Alterações ainda não salvas." : "Modo de edição ativo."}</strong> Aproxime blocos para encaixá-los magneticamente; afaste duas células para preservar um espaço. Somente “Salvar layout” torna as mudanças permanentes.</span><button onClick={cancelEditing}>Cancelar</button></div>
      )}

      <div className={cn("dashboard-grid-wrap", layout.length === 0 && "dashboard-grid-wrap--empty")} ref={containerRef}>
        {layout.length === 0 && <div className="dashboard-page-empty"><SquaresFourIcon size={28} weight="duotone" /><strong>{activePage?.name} está vazia</strong><span>{dashboardKey === "overview" ? "Esta página está pronta para receber novos indicadores quando o construtor analítico da Visão geral for habilitado." : "Use “Indicador” para começar uma nova composição analítica."}</span></div>}
        {mounted && (
          <ReactGridLayout
            width={width}
            layout={layout.map((item) => ({ ...item, static: !editing }))}
            autoSize={false}
            gridConfig={{ cols: 12, rowHeight: 31, margin: [10, 10], containerPadding: [0, 0], maxRows: DASHBOARD_PAGE_MAX_ROWS }}
            dragConfig={{ enabled: editing, handle: ".widget-drag-handle", bounded: true }}
            resizeConfig={{ enabled: editing, handles: ["n", "e", "s", "w", "ne", "nw", "se", "sw"] }}
            compactor={boundedDashboardCompactor}
            onDragStart={() => {
              interactionStartLayout.current = layout.map((item) => ({ ...item }));
            }}
            onDragStop={(nextLayout, _oldItem, movedItem) => {
              if (!editing || !movedItem) return;
              const candidate = magnetizeDashboardItem(nextLayout, movedItem.i, { maxRows: DASHBOARD_PAGE_MAX_ROWS });
              if (dashboardLayoutFitsBounds(candidate, 12, DASHBOARD_PAGE_MAX_ROWS)) {
                setLayout(candidate);
              } else {
                if (interactionStartLayout.current) setLayout(interactionStartLayout.current);
                flash("Movimento desfeito: o bloco ultrapassaria o limite da página");
              }
              interactionStartLayout.current = null;
            }}
            onResizeStart={() => {
              interactionStartLayout.current = layout.map((item) => ({ ...item }));
            }}
            onResizeStop={(nextLayout) => {
              if (dashboardLayoutFitsBounds(nextLayout, 12, DASHBOARD_PAGE_MAX_ROWS)) {
                setLayout(nextLayout.map((item) => ({ ...item })));
              } else {
                if (interactionStartLayout.current) setLayout(interactionStartLayout.current);
                flash("Redimensionamento desfeito: não há espaço dentro desta página");
              }
              interactionStartLayout.current = null;
            }}
          >

            {visibleMetrics.map((metric) => (
              <div key={metric.id}>
                <MetricCard title={metric.title} value={metric.value} delta={metric.delta} tone={metric.tone} editing={editing} onOpen={() => setDetailsOpen(true)} />
              </div>
            ))}

            {renderDashboardWidgets(dashboardKey, editing, scaledDemand, setCrossFilter, applyOverviewCrossFilter, overviewState, () => setDetailsOpen(true))
              .filter((widget) => activeLayoutIds.has(String(widget.key)))}

            {customWidgets.map((widget) => (
              <div key={widget.id}>
                <WidgetFrame
                  title={widget.title}
                  subtitle={`${widget.visualization} · métrica calculada`}
                  editing={editing}
                  action={editing ? (
                    <>
                      <button
                        aria-label={`Editar métrica ${widget.title}`}
                        title={dashboardKey === "overview" ? "Edição suspensa até a métrica usar o snapshot real." : "Editar métrica"}
                        disabled={dashboardKey === "overview"}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => { event.stopPropagation(); setBuilderWidgetId(widget.id); setBuilderOpen(true); }}
                      >
                        <PencilSimpleIcon size={15} />
                      </button>
                      <button
                        className="widget-action--danger"
                        aria-label={`Remover métrica ${widget.title}`}
                        title="Remover do rascunho"
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => { event.stopPropagation(); removeCustomWidget(widget.id); }}
                      >
                        <TrashIcon size={15} />
                      </button>
                    </>
                  ) : undefined}
                >
                  {dashboardKey === "overview" ? (
                    <div className="analytical-widget-state analytical-widget-state--empty">
                      <ChartBarIcon size={24} weight="duotone" />
                      <strong>Recálculo real pendente</strong>
                      <span>{widget.formula}</span>
                    </div>
                  ) : (
                    <div className="custom-widget-state">
                      <ChartBarIcon size={30} weight="duotone" />
                      <strong className="custom-widget-state__value">{widget.preview.formattedValue}</strong>
                      <span>{widget.formula}</span>
                      <small>N = {widget.preview.sampleSize} · cobertura {widget.preview.coverage.toLocaleString("pt-BR")}%</small>
                    </div>
                  )}
                </WidgetFrame>
              </div>
            ))}
          </ReactGridLayout>
        )}
      </div>

      {builderOpen && <IndicatorBuilder dashboardKey={dashboardKey} initialDefinition={builderWidget?.definition} onClose={closeBuilder} onSubmit={builderWidget ? updateWidget : addWidget} />}
      {detailsOpen && (dashboardKey === "overview"
        ? <OverviewDetailsDrawer filters={filters} crossFilter={overviewCrossFilter} onClose={() => setDetailsOpen(false)} />
        : <DetailsDrawer crossFilter={crossFilter} onClose={() => setDetailsOpen(false)} />)}
      {toast && <div className="toast"><CheckCircleIcon size={19} weight="fill" />{toast}</div>}
    </div>
  );
}

function FilterPanel({ filters, options, onChange, onClose }: { filters: Filters; options: FilterOptions; onChange: (filters: Filters) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(filters);
  const draftIsDefault = draft.period === defaultFilters.period
    && draft.sector === defaultFilters.sector
    && draft.priority === defaultFilters.priority
    && draft.status === defaultFilters.status;
  return (
    <section className="filter-panel">
      <div className="filter-panel__heading"><span><SlidersHorizontalIcon size={18} /><strong>Refinar análise</strong></span><button onClick={onClose}><XIcon size={16} /></button></div>
      <label>Período de abertura<select value={draft.period} onChange={(event) => setDraft({ ...draft, period: event.target.value as Filters["period"] })}><option>Toda a base</option><option>Últimos 90 dias</option><option>Últimos 30 dias</option></select></label>
      <label>Setor<select value={draft.sector} onChange={(event) => setDraft({ ...draft, sector: event.target.value })}><option>{defaultFilters.sector}</option>{options.sectors.map((option) => <option key={option}>{option}</option>)}</select></label>
      <label>Prioridade<select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value })}><option>{defaultFilters.priority}</option>{options.priorities.map((option) => <option key={option}>{option}</option>)}</select></label>
      <label>Status<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}><option>{defaultFilters.status}</option>{options.statuses.map((option) => <option key={option}>{option}</option>)}</select></label>
      <div className="filter-panel__actions">
        <button className="button button--ghost" disabled={draftIsDefault} onClick={() => { onChange(defaultFilters); onClose(); }}>Limpar filtros</button>
        <button className="button button--primary" onClick={() => { onChange(draft); onClose(); }}>Aplicar filtros</button>
      </div>
    </section>
  );
}

const aggregationLabels: Record<AggregationOperation, string> = {
  contagem: "Contagem",
  contagem_distinta: "Contagem distinta",
  soma: "Soma",
  média: "Média",
  mediana: "Mediana",
  percentil: "P90",
  mínimo: "Mínimo",
  máximo: "Máximo",
};

function aggregationsFor(field: DataField): AggregationOperation[] {
  if (field.type === "número" || field.type === "duração") {
    return ["contagem", "soma", "média", "mediana", "percentil", "mínimo", "máximo"];
  }
  return ["contagem", "contagem_distinta"];
}

type PreviewState = {
  status: "idle" | "validating" | "valid" | "invalid";
  preview: MetricPreview | null;
  errors: string[];
  definitionKey: string | null;
};

type IndicatorBuilderProps = {
  dashboardKey: DashboardKey;
  initialDefinition?: MetricDefinitionDraft;
  onClose: () => void;
  onSubmit: (definition: MetricDefinitionDraft, preview: MetricPreview) => void;
};

function IndicatorBuilder({ dashboardKey, initialDefinition, onClose, onSubmit }: IndicatorBuilderProps) {
  const initialParts = initialDefinition ? decomposeMetricBuilderExpression(initialDefinition.expression) : null;
  const isEditingMetric = Boolean(initialDefinition);
  const unsupportedInitialDefinition = isEditingMetric && !initialParts;
  const [metricName, setMetricName] = useState(initialDefinition?.name ?? "Índice de carga operacional");
  const [metricDescription, setMetricDescription] = useState(initialDefinition?.description ?? "Relação calculada entre os dados selecionados.");
  const [fieldAId, setFieldAId] = useState(initialParts?.fieldAId ?? "ticket-count");
  const [fieldBId, setFieldBId] = useState(initialParts?.fieldBId ?? "event-count");
  const [aggregationA, setAggregationA] = useState<AggregationOperation>(initialParts?.aggregationA ?? "contagem");
  const [aggregationB, setAggregationB] = useState<AggregationOperation>(initialParts?.aggregationB ?? "contagem");
  const [activeSlot, setActiveSlot] = useState<"a" | "b">("a");
  const [operator, setOperator] = useState<BinaryOperation>(initialParts?.operator ?? "multiplicar");
  const [divisor, setDivisor] = useState(String(initialParts?.divisor ?? 30));
  const [dimensionId, setDimensionId] = useState(initialDefinition?.dimensionFieldId ?? "");
  const [visualization, setVisualization] = useState<MetricVisualization>(initialDefinition?.visualization ?? "Cartão numérico");
  const [coverage, setCoverage] = useState(initialDefinition?.coverageThreshold ?? 80);
  const [search, setSearch] = useState("");
  const [previewState, setPreviewState] = useState<PreviewState>({ status: "idle", preview: null, errors: [], definitionKey: null });

  const filteredFields = dataFields.filter((item) => item.label.toLowerCase().includes(search.toLowerCase()) || item.source.toLowerCase().includes(search.toLowerCase()));
  const fieldA = dataFields.find((item) => item.id === fieldAId) ?? dataFields[0];
  const fieldB = dataFields.find((item) => item.id === fieldBId) ?? dataFields[1];
  const dimensions = dataFields.filter((item) => item.type === "categoria" || item.type === "data" || item.type === "booleano");
  const dimension = dataFields.find((item) => item.id === dimensionId);

  const definition = useMemo<MetricDefinitionDraft>(() => ({
    name: metricName.trim(),
    description: metricDescription.trim(),
    expression: {
      kind: "operação",
      operation: "dividir",
      left: {
        kind: "operação",
        operation: operator,
        left: { kind: "agregação", operation: aggregationA, input: { kind: "campo", fieldId: fieldA.id }, ...(aggregationA === "percentil" ? { percentile: 90 } : {}) },
        right: { kind: "agregação", operation: aggregationB, input: { kind: "campo", fieldId: fieldB.id }, ...(aggregationB === "percentil" ? { percentile: 90 } : {}) },
      },
      right: { kind: "constante", value: Number(divisor) },
    },
    dimensionFieldId: dimensionId || null,
    visualization,
    coverageThreshold: coverage,
    nullPolicy: "ignorar",
  }), [aggregationA, aggregationB, coverage, dimensionId, divisor, fieldA.id, fieldB.id, metricDescription, metricName, operator, visualization]);

  const clientValidation = useMemo(() => validateMetricDefinition(definition, dataFields), [definition]);
  const formula = useMemo(() => formatMetricExpression(definition.expression, dataFields), [definition.expression]);
  const definitionKey = useMemo(() => JSON.stringify(definition), [definition]);
  const canValidate = clientValidation.valid && !unsupportedInitialDefinition;

  useEffect(() => {
    if (!canValidate) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setPreviewState({ status: "validating", preview: null, errors: [], definitionKey });
      try {
        const response = await fetch("/api/metrics/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(definition),
          signal: controller.signal,
        });
        const result = await response.json() as { ok: boolean; preview?: MetricPreview; errors?: Array<{ message: string }> };
        if (response.ok && result.ok && result.preview) {
          setPreviewState({ status: "valid", preview: result.preview, errors: [], definitionKey });
        } else {
          setPreviewState({ status: "invalid", preview: null, errors: result.errors?.map((error) => error.message) ?? ["O servidor recusou a definição."], definitionKey });
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPreviewState({ status: "invalid", preview: null, errors: ["Não foi possível validar a métrica no servidor."], definitionKey });
      }
    }, 350);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [canValidate, definition, definitionKey]);

  function selectField(field: DataField) {
    if (activeSlot === "a") {
      setFieldAId(field.id);
      if (!aggregationsFor(field).includes(aggregationA)) setAggregationA("contagem");
      setActiveSlot("b");
    } else {
      setFieldBId(field.id);
      if (!aggregationsFor(field).includes(aggregationB)) setAggregationB("contagem");
    }
  }

  const previewMatchesDefinition = previewState.definitionKey === definitionKey;
  const activePreview = canValidate && previewMatchesDefinition ? previewState.preview : null;
  const effectivePreviewStatus = canValidate && previewMatchesDefinition ? previewState.status : "idle";
  const displayedErrors = [
    ...(unsupportedInitialDefinition ? ["Esta fórmula não pode ser editada por este construtor visual."] : []),
    ...clientValidation.errors.map((error) => error.message),
    ...(canValidate && previewMatchesDefinition ? previewState.errors : []),
  ];
  const readyToSubmit = canValidate && effectivePreviewStatus === "valid" && activePreview;

  return (
    <div className="modal-layer" onMouseDown={onClose}>
      <section className="builder-modal" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><p className="eyebrow">Laboratório de métricas · {dashboardThemes.find((item) => item.key === dashboardKey)?.title}</p><h2>{isEditingMetric ? "Editar métrica calculada" : "Nova métrica calculada"}</h2><span>{isEditingMetric ? "Revise a definição existente; as mudanças permanecem no rascunho até salvar o painel." : "Relacione campos disponíveis sem escrever código ou acessar dados sensíveis."}</span></div><button onClick={onClose} aria-label="Fechar construtor"><XIcon size={19} /></button></header>
        <div className="builder-modal__body builder-modal__body--formula">
          <div className="builder-column builder-column--library">
            <label>1. Dados disponíveis</label>
            <div className="builder-search"><MagnifyingGlassIcon size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar campo ou fonte" /></div>
            <div className="data-source-tabs"><span>Adicionar ao</span><button className={activeSlot === "a" ? "is-selected" : ""} onClick={() => setActiveSlot("a")}>Dado 1</button><button className={activeSlot === "b" ? "is-selected" : ""} onClick={() => setActiveSlot("b")}>Dado 2</button></div>
            <div className="data-field-list">
              {filteredFields.map((field) => <button key={field.id} className={cn(field.id === fieldAId && "is-a", field.id === fieldBId && "is-b")} onClick={() => selectField(field)}><span className="data-field-list__type">{field.type.slice(0, 3)}</span><span><strong>{field.label}</strong><small>{field.source} · {field.description}</small></span>{field.id === fieldAId ? <b>A</b> : field.id === fieldBId ? <b>B</b> : <PlusIcon size={14} />}</button>)}
            </div>
          </div>

          <div className="builder-column builder-column--formula">
            <label>2. Fórmula</label>
            <label className="field-label">Nome da métrica<input className="builder-text-input" value={metricName} onChange={(event) => setMetricName(event.target.value)} aria-invalid={metricName.trim().length < 3} /></label>
            <label className="field-label">Descrição<input className="builder-text-input" value={metricDescription} onChange={(event) => setMetricDescription(event.target.value)} /></label>
            <div className="aggregation-row">
              <label>Dado 1<select value={aggregationA} onChange={(event) => setAggregationA(event.target.value as AggregationOperation)}>{aggregationsFor(fieldA).map((item) => <option key={item} value={item}>{aggregationLabels[item]}</option>)}</select></label>
              <label>Dado 2<select value={aggregationB} onChange={(event) => setAggregationB(event.target.value as AggregationOperation)}>{aggregationsFor(fieldB).map((item) => <option key={item} value={item}>{aggregationLabels[item]}</option>)}</select></label>
            </div>
            <div className="formula-canvas">
              <button className={activeSlot === "a" ? "is-active" : ""} onClick={() => setActiveSlot("a")}><span>Dado 1</span><strong>{aggregationLabels[aggregationA]} · {fieldA.label}</strong><small>{fieldA.source}</small></button>
              <select aria-label="Operador principal" value={operator} onChange={(event) => setOperator(event.target.value as BinaryOperation)}><option value="multiplicar">× Multiplicar</option><option value="dividir">÷ Dividir</option><option value="somar">+ Somar</option><option value="subtrair">− Subtrair</option></select>
              <button className={activeSlot === "b" ? "is-active" : ""} onClick={() => setActiveSlot("b")}><span>Dado 2</span><strong>{aggregationLabels[aggregationB]} · {fieldB.label}</strong><small>{fieldB.source}</small></button>
              <span className="formula-divider">÷</span>
              <label className="formula-constant"><span>Constante</span><input type="number" value={divisor} onChange={(event) => setDivisor(event.target.value)} step="0.01" aria-invalid={!Number.isFinite(Number(divisor)) || Number(divisor) === 0} /></label>
            </div>
            <div className="formula-readable"><span>Expressão resultante</span><code>{formula}</code></div>
            {clientValidation.warnings.map((warning) => <div className="builder-warning" key={warning.code}><WarningCircleIcon size={17} weight="fill" /><span><strong>Cobertura combinada limitada</strong><small>{warning.message}</small></span></div>)}
            {displayedErrors.length > 0 && <div className="builder-errors" role="alert"><strong>Corrija antes de continuar</strong>{displayedErrors.map((error) => <span key={error}><WarningCircleIcon size={13} />{error}</span>)}</div>}
          </div>

          <div className="builder-column builder-column--preview">
            <label>3. Contexto e visualização</label>
            <label className="field-label">Segmentar por<select value={dimensionId} onChange={(event) => setDimensionId(event.target.value)}><option value="">Sem segmentação</option>{dimensions.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</select></label>
            <label className="field-label">Visualização<select value={visualization} onChange={(event) => setVisualization(event.target.value as MetricVisualization)}><option>Cartão numérico</option><option>Barras horizontais</option><option>Colunas</option><option>Linha temporal</option><option>Barra 100% empilhada</option></select></label>
            <label className="field-label">Cobertura mínima<div className="coverage-input"><input type="range" value={coverage} min="0" max="100" onChange={(event) => setCoverage(Number(event.target.value))} /><strong>{coverage}%</strong></div></label>
            <div className="builder-preview builder-preview--formula">
              <span>{effectivePreviewStatus === "validating" ? "Validando no servidor..." : "Prévia calculada no servidor"}</span>
              <ChartBarIcon size={30} weight="duotone" />
              <strong>{activePreview?.formattedValue ?? (clientValidation.valid ? "Aguardando cálculo" : "Definição incompleta")}</strong>
              <small>{visualization}{dimension ? ` · por ${dimension.label}` : " · valor único"}</small>
              <code>{activePreview ? `N = ${activePreview.sampleSize} · ${activePreview.coverage.toLocaleString("pt-BR")}%` : formula}</code>
            </div>
            {activePreview?.warnings.map((warning) => <div className="builder-warning" key={warning.code}><WarningCircleIcon size={17} weight="fill" /><span><strong>Atenção à interpretação</strong><small>{warning.message}</small></span></div>)}
            <div className="quality-note"><InfoIcon size={17} /><span><strong>Validação em duas etapas</strong><small>O navegador dá retorno imediato; o servidor repete as regras e é o único que calcula a prévia.</small></span></div>
          </div>
        </div>
        <footer><span className="builder-footer-status">{effectivePreviewStatus === "validating" ? "Validando AST no servidor..." : readyToSubmit ? "Fórmula válida e prévia confirmada" : displayedErrors.length > 0 ? `${displayedErrors.length} validação(ões) pendente(s)` : "Aguardando validação do servidor..."}</span><button className="button button--ghost" onClick={onClose}>Cancelar</button><button className="button button--primary" disabled={!readyToSubmit} onClick={() => { if (activePreview) onSubmit(definition, activePreview); }}>{isEditingMetric ? <FloppyDiskIcon size={16} /> : <PlusIcon size={16} />}{isEditingMetric ? "Atualizar no rascunho" : "Adicionar ao rascunho"}</button></footer>
      </section>
    </div>
  );
}

function formatDetailDateTime(value: string | null): string {
  if (!value) return "Não informada";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Não informada";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(parsed);
}

function OverviewDetailsDrawer({ filters, crossFilter, onClose }: { filters: Filters; crossFilter: OverviewCrossFilter | null; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [state, setState] = useState<OverviewDetailsLoadState>({
    status: "loading",
    data: null,
    message: "Consultando os chamados do recorte.",
  });

  useEffect(() => {
    const controller = new AbortController();
    void loadOverviewDetails(filters, crossFilter, page, controller.signal)
      .then((data) => setState(data
        ? { status: "ready", data, message: "Detalhamento carregado." }
        : { status: "empty", data: null, message: "Ainda não existe um snapshot publicado para detalhar." }))
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({
          status: "error",
          data: null,
          message: error instanceof Error ? error.message : "Não foi possível carregar o detalhamento.",
        });
      });
    return () => controller.abort();
  }, [crossFilter, filters, page, reload]);

  const data = state.status === "ready" ? state.data : null;
  const selectionLabel = crossFilter
    ? `${overviewCrossFilterLabels[crossFilter.field]} cruzado: ${crossFilter.value}`
    : "Filtros atuais da Visão geral";

  async function exportCsv() {
    if (exporting || state.status !== "ready") return;
    setExporting(true);
    setExportError(null);
    try {
      await downloadOverviewCsv(filters, crossFilter);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Não foi possível exportar o recorte atual.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="drawer-layer" onMouseDown={onClose}>
      <aside className="details-drawer" onMouseDown={(event) => event.stopPropagation()} aria-label="Detalhamento dos chamados">
        <header><div><p className="eyebrow">Detalhamento real</p><h2>Chamados do recorte</h2><span>{selectionLabel}</span></div><button aria-label="Fechar detalhamento" onClick={onClose}><XIcon size={18} /></button></header>
        <div className="drawer-summary">
          <span><strong>{data ? data.selection.totalRecords.toLocaleString("pt-BR") : "—"}</strong><small>registros no recorte</small></span>
          <span><strong>{data ? `${data.selection.page}/${data.selection.pageCount}` : "—"}</strong><small>página atual</small></span>
          <span><strong>{data ? formatDetailDateTime(data.snapshot.publishedAt) : "—"}</strong><small>snapshot publicado</small></span>
        </div>
        <div className="privacy-note"><ShieldCheckIcon size={17} /><span><strong>Dados pessoais protegidos</strong><small>{data?.privacy.requesterMasked ? "Solicitantes permanecem mascarados para o perfil Analista." : "O perfil Administrador visualiza somente a identificação necessária; emails e IDs internos não são enviados."}</small></span></div>
        {state.status !== "ready" ? (
          <div className={`details-state details-state--${state.status}`} role="status">
            {state.status === "loading" ? <ArrowsClockwiseIcon className="spin" size={25} /> : state.status === "error" ? <WarningCircleIcon size={25} /> : <DatabaseIcon size={25} />}
            <strong>{state.status === "loading" ? "Carregando chamados" : state.status === "error" ? "Detalhamento indisponível" : "Nenhum snapshot publicado"}</strong>
            <span>{state.message}</span>
            {state.status === "error" && <button className="button button--ghost" onClick={() => { setState({ status: "loading", data: null, message: "Consultando os chamados do recorte." }); setReload((value) => value + 1); }}>Tentar novamente</button>}
          </div>
        ) : state.data.rows.length === 0 ? (
          <div className="details-state details-state--empty" role="status"><InfoIcon size={25} /><strong>Nenhum chamado neste recorte</strong><span>Revise os filtros ou remova a seleção cruzada para ampliar a consulta.</span></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Chamado</th><th>Solicitante</th><th>Setor</th><th>Prioridade</th><th>Status</th><th>Abertura</th></tr></thead>
              <tbody>{state.data.rows.map((row) => <tr key={row.rowKey}><td><strong>{row.code}</strong><small>{row.reason}</small></td><td>{row.requester}</td><td>{row.sector}</td><td><span className={cn("priority-tag", `priority-tag--${normalizedAnalyticalLabel(row.priority).replace(/\s+/g, "-")}`)}>{row.priority}</span></td><td>{row.status}</td><td>{formatDetailDateTime(row.openedAt)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        <footer>
          <div className="drawer-export-action">
            <button className="button button--ghost" disabled={state.status !== "ready" || exporting} onClick={() => void exportCsv()}><DownloadSimpleIcon size={16} />{exporting ? "Exportando..." : "Exportar CSV"}</button>
            {exportError && <small role="alert">{exportError}</small>}
          </div>
          <div className="drawer-pagination">
            <button className="button button--ghost" disabled={!data || data.selection.page <= 1 || state.status === "loading"} onClick={() => { setState({ status: "loading", data: null, message: "Consultando os chamados do recorte." }); setPage((value) => Math.max(1, value - 1)); }}>Anterior</button>
            <button className="button button--ghost" disabled={!data || data.selection.page >= data.selection.pageCount || state.status === "loading"} onClick={() => { setState({ status: "loading", data: null, message: "Consultando os chamados do recorte." }); setPage((value) => value + 1); }}>Próxima</button>
          </div>
          <button className="button button--primary" onClick={onClose}>Fechar</button>
        </footer>
      </aside>
    </div>
  );
}

function DetailsDrawer({ crossFilter, onClose }: { crossFilter: string | null; onClose: () => void }) {
  return (
    <div className="drawer-layer" onMouseDown={onClose}>
      <aside className="details-drawer" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><p className="eyebrow">Detalhamento</p><h2>Chamados do recorte</h2><span>{crossFilter ? `Filtro cruzado: ${crossFilter}` : "Todos os chamados selecionados"}</span></div><button onClick={onClose}><XIcon size={18} /></button></header>
        <div className="drawer-summary"><span><strong>518</strong><small>registros</small></span><span><strong>100%</strong><small>cobertura</small></span><span><strong>20 out</strong><small>última carga</small></span></div>
        <div className="privacy-note"><ShieldCheckIcon size={17} /><span><strong>Dados pessoais protegidos</strong><small>Solicitantes permanecem mascarados neste perfil.</small></span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Chamado</th><th>Solicitante</th><th>Setor</th><th>Prioridade</th><th>Status</th></tr></thead>
            <tbody>{ticketRows.map((row) => <tr key={row.id}><td><strong>{row.id}</strong><small>{row.reason}</small></td><td>{row.requester}</td><td>{row.sector}</td><td><span className={cn("priority-tag", `priority-tag--${row.priority.toLowerCase().replace(" ", "-")}`)}>{row.priority}</span></td><td>{row.status}</td></tr>)}</tbody>
          </table>
        </div>
        <footer><button className="button button--ghost" disabled title="Disponível quando este painel usar o snapshot real."><DownloadSimpleIcon size={16} />Exportar CSV mascarado</button><button className="button button--primary" onClick={onClose}>Fechar</button></footer>
      </aside>
    </div>
  );
}

function Admin({ currentUser }: { currentUser: CurrentUser }) {
  const [section, setSection] = useState<AdminSection>("sync");
  const adminItems: Array<[AdminSection, typeof ActivityIcon, string]> = [
    ["sync", ArrowsClockwiseIcon, "Sincronização"],
    ["users", UsersThreeIcon, "Usuários"],
    ["mapping", DatabaseIcon, "Mapeamentos"],
    ["health", ActivityIcon, "Saúde do sistema"],
    ["audit", ListChecksIcon, "Auditoria"],
  ];
  return (
    <div className="page page--admin">
      <div className="page-heading"><div><p className="eyebrow">Gestão da plataforma</p><h1>Administração</h1><p>Controle acesso, dados, catálogo e saúde da instalação local.</p></div><span className="admin-badge"><ShieldCheckIcon size={16} />Área de administrador</span></div>
      <div className="admin-layout">
        <nav className="admin-nav">
          {adminItems.map(([key, ItemIcon, label]) => {
            return <button key={key} className={section === key ? "is-active" : ""} onClick={() => setSection(key)}><ItemIcon size={18} />{label}<CaretRightIcon size={14} /></button>;
          })}
        </nav>
        <section className="admin-content">
          {section === "sync" && <AdminSync />}
          {section === "users" && <AdminUsers currentUserId={currentUser.id} />}
          {section === "mapping" && <AdminMapping />}
          {section === "health" && <AdminHealth />}
          {section === "audit" && <AdminAudit />}
        </section>
      </div>
    </div>
  );
}

export default function DashboardApp({ currentUser }: { currentUser: CurrentUser }) {
  const [view, setView] = useState<View>("catalog");
  const [selectedDashboard, setSelectedDashboard] = useState<DashboardKey>("overview");

  return (
    <AppShell view={view} selectedDashboard={selectedDashboard} currentUser={currentUser} onViewChange={setView} onDashboardChange={setSelectedDashboard}>
      {view === "catalog" && <Catalog onOpen={(key) => { setSelectedDashboard(key); setView("dashboard"); }} />}
      {view === "dashboard" && <Dashboard key={selectedDashboard} dashboardKey={selectedDashboard} currentUser={currentUser} onBack={() => setView("catalog")} />}
      {view === "admin" && currentUser.role === "administrador" && <Admin currentUser={currentUser} />}
    </AppShell>
  );
}
