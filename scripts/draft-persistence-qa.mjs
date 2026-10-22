import { chromium } from "@playwright/test";

const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:3000";
const storageKey = "pulseti:v1:dashboard-draft:admin:overview";
const metricName = "Índice de carga operacional";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });

async function loginAndOpenOverview() {
  await page.getByRole("button", { name: "Entrar na plataforma" }).click();
  await page.getByRole("heading", { name: "Catálogo de painéis" }).waitFor();
  await page.getByRole("button", { name: /Visão geral/ }).first().click();
  await page.getByRole("heading", { name: "Visão geral" }).waitFor();
}

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate((key) => localStorage.removeItem(key), storageKey);
  await page.reload({ waitUntil: "networkidle" });
  await loginAndOpenOverview();

  await page.getByRole("button", { name: "Indicador", exact: true }).click();
  const addButton = page.getByRole("button", { name: "Adicionar ao rascunho" });
  await addButton.waitFor();
  await page.waitForFunction(() => {
    const button = Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.includes("Adicionar ao rascunho"));
    return button instanceof HTMLButtonElement && !button.disabled;
  });
  await addButton.click();
  await page.getByText(metricName, { exact: true }).last().waitFor();
  await page.getByRole("button", { name: "Salvar layout" }).click();

  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), storageKey);
  if (saved?.customWidgets?.length !== 1) throw new Error("A métrica não foi persistida após salvar.");

  await page.reload({ waitUntil: "networkidle" });
  await loginAndOpenOverview();
  await page.getByText(metricName, { exact: true }).last().waitFor();

  await page.getByRole("button", { name: "Editar layout" }).click();
  await page.getByRole("button", { name: `Remover métrica ${metricName}` }).click();
  if (await page.getByText(metricName, { exact: true }).count() !== 0) throw new Error("A métrica continuou visível após ser removida do rascunho.");
  await page.getByRole("button", { name: "Cancelar" }).click();
  await page.getByText(metricName, { exact: true }).last().waitFor();

  await page.getByRole("button", { name: "Editar layout" }).click();
  await page.getByRole("button", { name: `Remover métrica ${metricName}` }).click();
  await page.getByRole("button", { name: "Salvar layout" }).click();
  const removed = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), storageKey);
  if (removed?.customWidgets?.length !== 0) throw new Error("A remoção individual não foi persistida.");

  await page.reload({ waitUntil: "networkidle" });
  await loginAndOpenOverview();
  if (await page.getByText(metricName, { exact: true }).count() !== 0) throw new Error("A métrica removida reapareceu após recarregar.");

  process.stdout.write("QA de remoção concluído: cancelar recupera e salvar confirma a exclusão.\n");
} finally {
  await browser.close();
}
