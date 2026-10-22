import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const outputDir = "qa-artifacts";
const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:3000";
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({
  viewport: { width: 1366, height: 768 },
  deviceScaleFactor: 1,
});

const consoleErrors = [];
const pageErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => pageErrors.push(error.message));

const checks = [];
async function check(name, action) {
  try {
    await action();
    checks.push({ name, passed: true });
  } catch (error) {
    checks.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
  }
}

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.screenshot({ path: `${outputDir}/login-1366x768.png` });

await check("login visível", async () => {
  await page.getByRole("heading", { name: /Decisões melhores/ }).waitFor();
  await page.getByRole("button", { name: "Entrar na plataforma" }).click();
  await page.getByRole("heading", { name: "Catálogo de painéis" }).waitFor();
});

await page.screenshot({ path: `${outputDir}/catalog-1366x768.png` });

await check("abrir painel Visão geral", async () => {
  await page.getByRole("button", { name: /Visão geral/ }).first().click();
  await page.getByRole("heading", { name: "Visão geral" }).waitFor();
});

await page.screenshot({ path: `${outputDir}/dashboard-1366x768.png` });

await check("painéis com composições próprias", async () => {
  const panels = [
    ["Demanda", "Demanda e perfil", "Demanda por dia e horário", "demand"],
    ["Pendências", "Pendências", "Idade das pendências", "pending"],
    ["Tempos e SLA", "Tempos e SLA", "Tempo até o primeiro atendimento", "sla"],
    ["Movimentações", "Movimentações", "Movimentações por tipo", "movement"],
    ["Qualidade", "Qualidade dos dados", "Cobertura dos registros", "quality"],
  ];
  for (const [nav, heading, widget, file] of panels) {
    await page.getByRole("button", { name: nav, exact: true }).click();
    await page.getByRole("heading", { name: heading, exact: true }).waitFor();
    await page.getByText(widget, { exact: true }).waitFor();
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${outputDir}/dashboard-${file}-1366x768.png` });
  }
  await page.getByRole("button", { name: "Visão geral", exact: true }).click();
  await page.getByRole("heading", { name: "Visão geral", exact: true }).waitFor();
});

await check("aplicar filtros", async () => {
  await page.getByRole("button", { name: /Filtros/ }).click();
  await page.screenshot({ path: `${outputDir}/filters-1366x768.png` });
  await page.locator(".filter-panel label").filter({ hasText: "Período" }).locator("select").selectOption("Últimos 30 dias");
  await page.locator(".filter-panel label").filter({ hasText: "Setor" }).locator("select").selectOption("Farmácia");
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await page.getByRole("button", { name: /Farmácia/ }).waitFor();
});

await check("abrir e fechar detalhamento", async () => {
  await page.locator(".metric-card").first().click();
  await page.getByRole("heading", { name: "Chamados do recorte" }).waitFor();
  await page.screenshot({ path: `${outputDir}/details-1366x768.png` });
  await page.getByRole("button", { name: "Fechar" }).click();
});

await check("editar e salvar layout", async () => {
  await page.getByRole("button", { name: "Editar layout" }).click();
  await page.getByText("Modo de edição ativo.").waitFor();
  await page.screenshot({ path: `${outputDir}/layout-edit-1366x768.png` });
  const handles = await page.locator(".react-resizable-handle").count();
  if (handles < 8) throw new Error("Redimensionamento em oito direções não foi ativado");
  const card = page.locator(".react-grid-item").first();
  const before = await card.boundingBox();
  const dragHandle = card.locator(".widget-drag-handle");
  const handleBox = await dragHandle.boundingBox();
  if (!before || !handleBox) throw new Error("Cartão editável não encontrado");
  await page.mouse.move(handleBox.x + 20, handleBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + 180, handleBox.y + 90, { steps: 8 });
  await page.mouse.up();
  const after = await card.boundingBox();
  if (!after || (Math.abs(after.x - before.x) < 20 && Math.abs(after.y - before.y) < 20)) throw new Error("Drag-and-drop não alterou a posição");
  await page.getByRole("button", { name: "Salvar layout" }).click();
});

await check("adicionar indicador", async () => {
  await page.getByRole("button", { name: "Indicador", exact: true }).click();
  await page.getByRole("heading", { name: "Nova métrica calculada" }).waitFor();
  await page.screenshot({ path: `${outputDir}/builder-1366x768.png` });
  const divisor = page.locator(".formula-constant input");
  await divisor.fill("0");
  await page.getByText("O divisor deve ser um número maior que zero.").waitFor();
  if (await page.getByRole("button", { name: "Adicionar ao rascunho" }).isEnabled()) throw new Error("Fórmula inválida não bloqueou o salvamento");
  await divisor.fill("30");
  await page.getByRole("button", { name: "Adicionar ao rascunho" }).click();
  await page.getByText("Indicador adicionado ao rascunho").waitFor();
});

await check("administração e sincronização", async () => {
  await page.getByRole("button", { name: "Administração" }).click();
  await page.getByRole("heading", { name: "Administração" }).waitFor();
  await page.getByRole("button", { name: "Sincronizar agora" }).click();
  await page.getByText("Sincronização concluída").first().waitFor({ timeout: 5000 });
});

await page.screenshot({ path: `${outputDir}/admin-1366x768.png` });

await check("logout", async () => {
  await page.getByRole("button", { name: /Miguel Mota/ }).click();
  await page.getByRole("button", { name: "Encerrar sessão" }).click();
  await page.getByRole("heading", { name: /Decisões melhores/ }).waitFor();
});

const result = {
  viewport: "1366x768",
  checks,
  consoleErrors,
  pageErrors,
};

console.log(JSON.stringify(result, null, 2));
await browser.close();

if (checks.some((item) => !item.passed) || consoleErrors.length || pageErrors.length) {
  process.exitCode = 1;
}
