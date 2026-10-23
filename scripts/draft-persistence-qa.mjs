import { chromium } from "@playwright/test";
import { authenticateQaUser } from "./qa-auth.mjs";

const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:3000";
const storageKey = "pulseti:v1:dashboard-draft:admin:overview";
const demandStorageKey = "pulseti:v1:dashboard-draft:admin:demand";
const metricName = "Índice de carga operacional";
const revisedMetricName = "Índice de carga revisado";
const legacyDemandDraft = {
  schemaVersion: 1,
  dashboardKey: "demand",
  layout: [
    { i: "metric-total", x: 0, y: 0, w: 4, h: 2, minW: 2, minH: 2 },
    { i: "metric-average", x: 4, y: 0, w: 2, h: 2, minW: 2, minH: 2 },
    { i: "metric-variation", x: 6, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
    { i: "metric-reasons", x: 9, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
    { i: "demand-trend", x: 0, y: 2, w: 7, h: 5, minW: 4, minH: 4 },
    { i: "demand-heatmap", x: 7, y: 2, w: 5, h: 5, minW: 4, minH: 4 },
    { i: "demand-reasons", x: 0, y: 7, w: 5, h: 5, minW: 4, minH: 4 },
    { i: "demand-pareto", x: 5, y: 7, w: 7, h: 5, minW: 4, minH: 4 },
  ],
  customWidgets: [],
  savedAt: "2026-10-22T15:00:00.000Z",
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });

async function loginAndOpenOverview() {
  await authenticateQaUser(page);
  await page.getByRole("heading", { name: "Catálogo de painéis" }).waitFor();
  await page.getByRole("button", { name: /Visão geral/ }).first().click();
  await page.getByRole("heading", { name: "Visão geral" }).waitFor();
}

async function waitForEnabledButton(label) {
  await page.waitForFunction((buttonLabel) => {
    const button = Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.includes(String(buttonLabel)));
    return button instanceof HTMLButtonElement && !button.disabled;
  }, label);
}

async function readServerDraft(dashboardKey = "overview") {
  const response = await page.request.get(`${baseUrl}/api/dashboard-drafts/${dashboardKey}`);
  const payload = await response.json();
  if (!response.ok() || !payload.ok) throw new Error(payload.error ?? "A API de rascunhos não respondeu corretamente.");
  return payload.draft;
}

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate((key) => localStorage.removeItem(key), storageKey);
  await page.reload({ waitUntil: "networkidle" });
  await loginAndOpenOverview();

  await page.getByRole("button", { name: "Indicador", exact: true }).click();
  const addButton = page.getByRole("button", { name: "Adicionar ao rascunho" });
  await addButton.waitFor();
  await waitForEnabledButton("Adicionar ao rascunho");
  await addButton.click();
  await page.getByText(metricName, { exact: true }).last().waitFor();
  await page.getByRole("button", { name: "Salvar layout" }).click();
  await page.getByText("Layout e métricas salvos no servidor", { exact: true }).waitFor();

  const saved = await readServerDraft();
  if (saved?.customWidgets?.length !== 1) throw new Error("A métrica não foi persistida no servidor após salvar.");
  const legacyAfterSave = await page.evaluate((key) => localStorage.getItem(key), storageKey);
  if (legacyAfterSave !== null) throw new Error("O navegador continuou sendo usado como armazenamento principal.");
  const rejected = await page.request.put(`${baseUrl}/api/dashboard-drafts/overview`, {
    data: { schemaVersion: 1, dashboardKey: "overview", layout: [], customWidgets: [], savedAt: null },
  });
  if (rejected.status() !== 422) throw new Error("A API aceitou um layout incompleto.");
  if ((await readServerDraft())?.customWidgets?.length !== 1) throw new Error("Uma requisição inválida alterou o rascunho salvo.");

  await page.reload({ waitUntil: "networkidle" });
  await loginAndOpenOverview();
  await page.getByText(metricName, { exact: true }).last().waitFor();

  await page.getByRole("button", { name: "Editar layout" }).click();
  await page.getByRole("button", { name: `Editar métrica ${metricName}` }).click();
  await page.getByLabel("Nome da métrica").fill(revisedMetricName);
  await waitForEnabledButton("Atualizar no rascunho");
  await page.getByRole("button", { name: "Atualizar no rascunho" }).click();
  await page.getByText(revisedMetricName, { exact: true }).last().waitFor();
  await page.getByRole("button", { name: "Cancelar" }).click();
  await page.getByText(metricName, { exact: true }).last().waitFor();
  if (await page.getByText(revisedMetricName, { exact: true }).count() !== 0) throw new Error("Cancelar não recuperou a definição salva.");

  await page.getByRole("button", { name: "Editar layout" }).click();
  await page.getByRole("button", { name: `Editar métrica ${metricName}` }).click();
  await page.getByLabel("Nome da métrica").fill(revisedMetricName);
  await waitForEnabledButton("Atualizar no rascunho");
  await page.getByRole("button", { name: "Atualizar no rascunho" }).click();
  await page.getByRole("button", { name: "Salvar layout" }).click();
  await page.getByText("Layout e métricas salvos no servidor", { exact: true }).waitFor();
  const edited = await readServerDraft();
  if (edited?.customWidgets?.[0]?.title !== revisedMetricName) throw new Error("A edição da métrica não foi persistida.");

  await page.reload({ waitUntil: "networkidle" });
  await loginAndOpenOverview();
  await page.getByText(revisedMetricName, { exact: true }).last().waitFor();

  await page.getByRole("button", { name: "Editar layout" }).click();
  await page.getByRole("button", { name: `Remover métrica ${revisedMetricName}` }).click();
  if (await page.getByText(revisedMetricName, { exact: true }).count() !== 0) throw new Error("A métrica continuou visível após ser removida do rascunho.");
  await page.getByRole("button", { name: "Cancelar" }).click();
  await page.getByText(revisedMetricName, { exact: true }).last().waitFor();

  await page.getByRole("button", { name: "Editar layout" }).click();
  await page.getByRole("button", { name: `Remover métrica ${revisedMetricName}` }).click();
  await page.getByRole("button", { name: "Salvar layout" }).click();
  await page.getByText("Layout e métricas salvos no servidor", { exact: true }).waitFor();
  const removed = await readServerDraft();
  if (removed?.customWidgets?.length !== 0) throw new Error("A remoção individual não foi persistida.");

  await page.reload({ waitUntil: "networkidle" });
  await loginAndOpenOverview();
  if (await page.getByText(revisedMetricName, { exact: true }).count() !== 0) throw new Error("A métrica removida reapareceu após recarregar.");

  await page.evaluate(({ key, draft }) => localStorage.setItem(key, JSON.stringify(draft)), { key: demandStorageKey, draft: legacyDemandDraft });
  await page.getByRole("button", { name: "Catálogo" }).last().click();
  await page.getByRole("heading", { name: "Catálogo de painéis" }).waitFor();
  await page.getByRole("button", { name: /Demanda e perfil/ }).click();
  await page.getByRole("heading", { name: "Demanda e perfil" }).waitFor();
  await page.getByText("Rascunho local migrado para o servidor", { exact: true }).waitFor();
  const migrated = await readServerDraft("demand");
  if (!migrated?.savedAt) throw new Error("O rascunho legado não foi migrado para o SQLite.");
  const legacyAfterMigration = await page.evaluate((key) => localStorage.getItem(key), demandStorageKey);
  if (legacyAfterMigration !== null) throw new Error("O rascunho legado não foi removido após a migração.");

  process.stdout.write("QA concluído: SQLite preserva o fluxo e migra rascunhos antigos do navegador.\n");
} finally {
  await browser.close();
}
