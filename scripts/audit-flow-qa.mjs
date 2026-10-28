import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { chromium } from "@playwright/test";

import { ApplicationDatabase } from "../app/lib/database.ts";
import { SYNC_STALE_AFTER_MS, SyncStore } from "../app/lib/sync-store.ts";
import { UserStore } from "../app/lib/user-store.ts";

const DEFAULT_ADMINISTRATOR_EMAIL = "admin.qa@upa.local";
const DEFAULT_ADMINISTRATOR_PASSWORD = "Senha definitiva QA 456";
const TEMPORARY_ADMINISTRATOR_PASSWORD = "Senha temporaria QA 123";
const externalBaseUrl = process.env.QA_BASE_URL?.trim() || null;
const administratorEmail = externalBaseUrl
  ? process.env.QA_EMAIL?.trim() || DEFAULT_ADMINISTRATOR_EMAIL
  : DEFAULT_ADMINISTRATOR_EMAIL;
const administratorPassword = externalBaseUrl
  ? process.env.QA_PASSWORD || DEFAULT_ADMINISTRATOR_PASSWORD
  : DEFAULT_ADMINISTRATOR_PASSWORD;

let applicationProcess = null;
let disposableDirectory = null;
let disposableDatabasePath = null;
let disposableAdministratorId = null;
let applicationOutput = "";

function hasProcessExited(childProcess) {
  return childProcess.exitCode !== null || childProcess.signalCode !== null;
}

function rectanglesOverlap(left, right) {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

async function assertDonutCenterFits(page) {
  const measurements = await page.locator(".donut-center-label").evaluate((group) => {
    const innerRadius = Number(group.getAttribute("data-inner-radius"));
    const centerX = Number(group.getAttribute("data-center-x"));
    const centerY = Number(group.getAttribute("data-center-y"));
    const value = group.querySelector(".donut-center-label__value");
    const caption = group.querySelector(".donut-center-label__caption");
    if (!(value instanceof SVGGraphicsElement) || !(caption instanceof SVGGraphicsElement)) return null;
    const valueBox = value.getBBox();
    const captionBox = caption.getBBox();
    return { innerRadius, centerX, centerY, valueBox, captionBox, valueFontSize: Number(value.getAttribute("font-size")) };
  });
  if (!measurements) throw new Error("O centro proporcional da rosca não foi renderizado.");
  const { innerRadius, centerX, centerY, valueBox, captionBox } = measurements;
  const left = Math.min(valueBox.x, captionBox.x);
  const right = Math.max(valueBox.x + valueBox.width, captionBox.x + captionBox.width);
  const top = Math.min(valueBox.y, captionBox.y);
  const bottom = Math.max(valueBox.y + valueBox.height, captionBox.y + captionBox.height);
  if (
    !Number.isFinite(innerRadius)
    || left < centerX - innerRadius * 0.88
    || right > centerX + innerRadius * 0.88
    || top < centerY - innerRadius * 0.82
    || bottom > centerY + innerRadius * 0.82
  ) {
    throw new Error("A porcentagem ou sua legenda ultrapassou a área interna da rosca.");
  }
  return measurements;
}

function rememberApplicationOutput(chunk) {
  applicationOutput = `${applicationOutput}${chunk.toString()}`.slice(-12_000);
}

function normalizeBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`QA_BASE_URL não é uma URL válida: ${value}`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("QA_BASE_URL deve usar http ou https.");
  }

  return parsed.toString().replace(/\/$/, "");
}

async function findAvailablePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.unref();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        rejectPort(new Error("Não foi possível reservar uma porta para o QA."));
        return;
      }

      const { port } = address;
      server.close((error) => (error ? rejectPort(error) : resolvePort(port)));
    });
  });
}

async function waitForApplication(baseUrl, childProcess) {
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    if (hasProcessExited(childProcess)) {
      throw new Error(
        `O servidor de QA encerrou antes de ficar disponível.\n${applicationOutput.trim()}`,
      );
    }

    try {
      const response = await fetch(`${baseUrl}/login`, {
        redirect: "follow",
        signal: AbortSignal.timeout(1_500),
      });
      if (response.status < 500) return;
    } catch {
      // A inicialização do Next pode levar alguns segundos; tentamos novamente até o limite.
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }

  throw new Error(
    `O servidor de QA não respondeu em 60 segundos.\n${applicationOutput.trim()}`,
  );
}

async function assertExternalApplicationIsReachable(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/login`, {
      redirect: "follow",
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status >= 500) {
      throw new Error(`o servidor respondeu com HTTP ${response.status}`);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Não foi possível acessar ${baseUrl}. Inicie a aplicação antes de usar QA_BASE_URL ou remova essa variável para o QA criar um ambiente isolado automaticamente. Detalhe: ${detail}`,
    );
  }
}

async function prepareDisposableApplication() {
  disposableDirectory = mkdtempSync(join(tmpdir(), "pulseti-audit-qa-"));
  const databasePath = join(disposableDirectory, "pulseti-qa.sqlite");
  disposableDatabasePath = databasePath;
  const database = new ApplicationDatabase(databasePath);

  try {
    const users = new UserStore(database.connection);
    const administrator = await users.create({
      email: administratorEmail,
      displayName: "Administrador QA",
      role: "administrador",
      temporaryPassword: TEMPORARY_ADMINISTRATOR_PASSWORD,
    });
    disposableAdministratorId = administrator.id;
    await users.changePassword(administrator.id, administratorPassword);
  } finally {
    database.close();
  }

  const port = await findAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const nextExecutable = resolve(process.cwd(), "node_modules", "next", "dist", "bin", "next");

  applicationProcess = spawn(
    process.execPath,
    [nextExecutable, "dev", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CI: "1",
        NEXT_TELEMETRY_DISABLED: "1",
        PULSETI_DATABASE_PATH: databasePath,
        PULSETI_NOTION_TOKEN: "",
        PULSETI_NOTION_TICKETS_DATABASE_ID: "",
        PULSETI_NOTION_HISTORY_DATABASE_ID: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  applicationProcess.stdout.on("data", rememberApplicationOutput);
  applicationProcess.stderr.on("data", rememberApplicationOutput);

  await waitForApplication(baseUrl, applicationProcess);
  process.stdout.write(`QA: ambiente isolado iniciado em ${baseUrl}.\n`);
  return baseUrl;
}

async function stopApplication() {
  if (!applicationProcess || hasProcessExited(applicationProcess)) return;

  async function waitForExit(timeout) {
    if (hasProcessExited(applicationProcess)) return;
    await Promise.race([
      new Promise((resolveStop) => applicationProcess.once("exit", resolveStop)),
      new Promise((resolveStop) => setTimeout(resolveStop, timeout)),
    ]);
  }

  if (process.platform === "win32") {
    const taskkillResult = await new Promise((resolveStop) => {
      const killer = spawn(
        "taskkill",
        ["/PID", String(applicationProcess.pid), "/T", "/F"],
        { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
      );
      let output = "";
      killer.stdout.on("data", (chunk) => { output += chunk.toString(); });
      killer.stderr.on("data", (chunk) => { output += chunk.toString(); });
      killer.once("error", (error) => {
        resolveStop({ exitCode: null, output: error.message });
      });
      killer.once("exit", (exitCode) => resolveStop({ exitCode, output }));
    });

    if (taskkillResult.exitCode !== 0 && !hasProcessExited(applicationProcess)) {
      applicationProcess.kill();
    }
    await waitForExit(5_000);

    if (!hasProcessExited(applicationProcess)) {
      throw new Error(
        `Não foi possível encerrar o servidor temporário de QA. ${taskkillResult.output.trim()}`,
      );
    }
    return;
  }

  applicationProcess.kill("SIGTERM");
  await waitForExit(5_000);
  if (!hasProcessExited(applicationProcess)) applicationProcess.kill("SIGKILL");
}

async function removeDisposableDirectory() {
  if (!disposableDirectory) return;

  for (let attempt = 1; attempt <= 120; attempt += 1) {
    try {
      rmSync(disposableDirectory, { recursive: true, force: true });
      return;
    } catch (error) {
      const canRetry = error && ["EBUSY", "ENOTEMPTY", "EPERM"].includes(error.code);
      if (!canRetry || attempt === 120) throw error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
  }
}

async function runAuditFlow(baseUrl) {
  const uniqueSuffix = Date.now().toString(36);
  const analystEmail = `auditoria.${uniqueSuffix}@upa.local`;
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const anonymousContext = await browser.newContext();
  const administratorContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const administratorPage = await administratorContext.newPage();
  const administratorPageErrors = [];
  administratorPage.on("pageerror", (error) => administratorPageErrors.push(error));
  const analystContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const analystPage = await analystContext.newPage();
  const analystPassword = "Senha definitiva Analista QA 789";

  async function login(page, email, password) {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Entrar na plataforma" }).click();
  }

  try {
    const anonymousAudit = await anonymousContext.request.get(`${baseUrl}/api/admin/audit`);
    if (anonymousAudit.status() !== 401) throw new Error("A auditoria aceitou uma consulta anônima.");
    const anonymousHealth = await anonymousContext.request.get(`${baseUrl}/api/admin/health`);
    if (anonymousHealth.status() !== 401) throw new Error("A saúde do sistema aceitou uma consulta anônima.");
    const anonymousOverview = await anonymousContext.request.get(`${baseUrl}/api/analytics/overview`);
    if (anonymousOverview.status() !== 401) throw new Error("A visão geral analítica aceitou uma consulta anônima.");
    const anonymousOverviewDetails = await anonymousContext.request.get(`${baseUrl}/api/analytics/overview/details`);
    if (anonymousOverviewDetails.status() !== 401) throw new Error("O detalhamento analítico aceitou uma consulta anônima.");
    const anonymousOverviewExport = await anonymousContext.request.get(`${baseUrl}/api/analytics/overview/export`);
    if (anonymousOverviewExport.status() !== 401) throw new Error("A exportação analítica aceitou uma consulta anônima.");
    const anonymousSync = await anonymousContext.request.get(`${baseUrl}/api/admin/sync`);
    if (anonymousSync.status() !== 401) throw new Error("O estado das sincronizações aceitou uma consulta anônima.");
    const anonymousSyncStart = await anonymousContext.request.post(`${baseUrl}/api/admin/sync`);
    if (anonymousSyncStart.status() !== 401) throw new Error("A execução da sincronização aceitou uma solicitação anônima.");
    const anonymousSyncRecovery = await anonymousContext.request.post(`${baseUrl}/api/admin/sync/recovery`);
    if (anonymousSyncRecovery.status() !== 401) throw new Error("A recuperação da sincronização aceitou uma solicitação anônima.");
    const anonymousConnectionTest = await anonymousContext.request.post(`${baseUrl}/api/admin/sync/connection`);
    if (anonymousConnectionTest.status() !== 401) throw new Error("O teste de conexão aceitou uma solicitação anônima.");
    const anonymousMapping = await anonymousContext.request.get(`${baseUrl}/api/admin/sync/mapping`);
    if (anonymousMapping.status() !== 401) throw new Error("Os mapeamentos aceitaram uma consulta anônima.");
    const anonymousMappingUpdate = await anonymousContext.request.put(`${baseUrl}/api/admin/sync/mapping`, { data: { mappings: {} } });
    if (anonymousMappingUpdate.status() !== 401) throw new Error("Os mapeamentos aceitaram uma alteração anônima.");
    const anonymousPreflight = await anonymousContext.request.post(`${baseUrl}/api/admin/sync/preflight`);
    if (anonymousPreflight.status() !== 401) throw new Error("A pré-validação aceitou uma solicitação anônima.");

    const failedLoginPage = await anonymousContext.newPage();
    await login(failedLoginPage, administratorEmail, "senha propositalmente incorreta");
    await failedLoginPage.getByRole("alert").getByText("Email ou senha incorretos.").waitFor();

    await login(administratorPage, administratorEmail, administratorPassword);
    await administratorPage.getByRole("heading", { name: "Catálogo de painéis" }).waitFor();

    const createResponse = await administratorContext.request.post(`${baseUrl}/api/admin/users`, {
      headers: { "Content-Type": "application/json" },
      data: { displayName: "Analista Auditoria", email: analystEmail, role: "analista" },
    });
    if (createResponse.status() !== 201) throw new Error("Não foi possível preparar o usuário do teste de auditoria.");
    const created = await createResponse.json();

    for (const isActive of [false, true]) {
      const updateResponse = await administratorContext.request.patch(`${baseUrl}/api/admin/users/${created.user.id}`, {
        headers: { "Content-Type": "application/json" },
        data: { isActive },
      });
      if (!updateResponse.ok()) throw new Error("Não foi possível preparar os eventos de ativação do teste.");
    }

    await login(analystPage, analystEmail, created.temporaryPassword);
    await analystPage.waitForURL(/\/trocar-senha$/);
    const forbiddenAudit = await analystContext.request.get(`${baseUrl}/api/admin/audit`);
    if (forbiddenAudit.status() !== 403) throw new Error("Uma conta Analista consultou a auditoria.");
    const forbiddenHealth = await analystContext.request.get(`${baseUrl}/api/admin/health`);
    if (forbiddenHealth.status() !== 403) throw new Error("Uma conta Analista consultou a saúde do sistema.");
    const analystOverviewBeforePasswordChange = await analystContext.request.get(`${baseUrl}/api/analytics/overview`);
    if (analystOverviewBeforePasswordChange.status() !== 403) throw new Error("Uma conta com senha temporária consultou a visão geral analítica.");
    const analystDetailsBeforePasswordChange = await analystContext.request.get(`${baseUrl}/api/analytics/overview/details`);
    if (analystDetailsBeforePasswordChange.status() !== 403) throw new Error("Uma conta com senha temporária consultou o detalhamento analítico.");
    const analystExportBeforePasswordChange = await analystContext.request.get(`${baseUrl}/api/analytics/overview/export`);
    if (analystExportBeforePasswordChange.status() !== 403) throw new Error("Uma conta com senha temporária exportou dados analíticos.");
    const forbiddenSync = await analystContext.request.get(`${baseUrl}/api/admin/sync`);
    if (forbiddenSync.status() !== 403) throw new Error("Uma conta Analista consultou o estado das sincronizações.");
    const forbiddenSyncStart = await analystContext.request.post(`${baseUrl}/api/admin/sync`);
    if (forbiddenSyncStart.status() !== 403) throw new Error("Uma conta Analista iniciou uma sincronização.");
    const forbiddenSyncRecovery = await analystContext.request.post(`${baseUrl}/api/admin/sync/recovery`);
    if (forbiddenSyncRecovery.status() !== 403) throw new Error("Uma conta Analista recuperou uma sincronização.");
    const forbiddenConnectionTest = await analystContext.request.post(`${baseUrl}/api/admin/sync/connection`);
    if (forbiddenConnectionTest.status() !== 403) throw new Error("Uma conta Analista testou a conexão com o Notion.");
    const forbiddenMapping = await analystContext.request.get(`${baseUrl}/api/admin/sync/mapping`);
    if (forbiddenMapping.status() !== 403) throw new Error("Uma conta Analista consultou os mapeamentos.");
    const forbiddenMappingUpdate = await analystContext.request.put(`${baseUrl}/api/admin/sync/mapping`, { data: { mappings: {} } });
    if (forbiddenMappingUpdate.status() !== 403) throw new Error("Uma conta Analista alterou os mapeamentos.");
    const forbiddenPreflight = await analystContext.request.post(`${baseUrl}/api/admin/sync/preflight`);
    if (forbiddenPreflight.status() !== 403) throw new Error("Uma conta Analista executou a pré-validação.");
    await analystPage.getByLabel("Nova senha", { exact: true }).fill(analystPassword);
    await analystPage.getByLabel("Confirme a nova senha").fill(analystPassword);
    await analystPage.getByRole("button", { name: "Salvar e acessar os painéis" }).click();
    await analystPage.getByRole("heading", { name: "Catálogo de painéis" }).waitFor();

    if (!externalBaseUrl) {
      const missingConfigurationTest = await administratorContext.request.post(`${baseUrl}/api/admin/sync/connection`);
      if (missingConfigurationTest.status() !== 409) {
        throw new Error("O teste de conexão não recusou uma configuração incompleta.");
      }
      const missingConfigurationPayload = await missingConfigurationTest.json();
      if (missingConfigurationPayload.code !== "configuration_missing") {
        throw new Error("O teste de conexão não classificou a configuração incompleta.");
      }
      const missingMappingUpdate = await administratorContext.request.put(`${baseUrl}/api/admin/sync/mapping`, {
        data: { mappings: {} },
      });
      if (missingMappingUpdate.status() !== 409) {
        throw new Error("O mapeamento não recusou uma configuração incompleta.");
      }
      const missingPreflight = await administratorContext.request.post(`${baseUrl}/api/admin/sync/preflight`);
      if (missingPreflight.status() !== 409) {
        throw new Error("A pré-validação não recusou uma configuração incompleta.");
      }
      const missingSyncStart = await administratorContext.request.post(`${baseUrl}/api/admin/sync`);
      if (missingSyncStart.status() !== 409) {
        throw new Error("A sincronização não recusou uma configuração incompleta.");
      }
      const missingActiveRunRecovery = await administratorContext.request.post(`${baseUrl}/api/admin/sync/recovery`);
      if (missingActiveRunRecovery.status() !== 409) {
        throw new Error("A recuperação não recusou a ausência de uma execução ativa.");
      }
    }

    const auditResponse = await administratorContext.request.get(`${baseUrl}/api/admin/audit?limit=200`);
    if (!auditResponse.ok()) throw new Error("A conta Administrador não conseguiu consultar a auditoria.");
    const auditPayload = await auditResponse.json();
    const actions = new Set(auditPayload.events.map((event) => event.action));
    const expectedActions = ["auth.login_failed", "auth.login_succeeded", "user.created", "user.deactivated", "user.reactivated"];
    if (!externalBaseUrl) expectedActions.push("sync.connection_tested", "sync.preflight_completed", "sync.run_completed");
    for (const expectedAction of expectedActions) {
      if (!actions.has(expectedAction)) throw new Error(`O evento ${expectedAction} não foi registrado.`);
    }
    const serializedAudit = JSON.stringify(auditPayload);
    if (serializedAudit.includes(created.temporaryPassword) || serializedAudit.includes("token_hash")) {
      throw new Error("A auditoria expôs uma credencial ou token.");
    }

    const syncResponse = await administratorContext.request.get(`${baseUrl}/api/admin/sync`);
    if (!syncResponse.ok()) throw new Error("A conta Administrador não conseguiu consultar as sincronizações.");
    const syncPayload = await syncResponse.json();
    if (syncPayload.latestSnapshot !== null || syncPayload.capabilities?.canStart !== false) {
      throw new Error("O estado inicial da sincronização não corresponde ao banco descartável.");
    }
    if (syncPayload.capabilities?.canRecover !== false) {
      throw new Error("O estado inicial ofereceu recuperação sem uma execução interrompida.");
    }
    if (syncPayload.mapping?.requiredMapped !== 0 || syncPayload.mapping?.ready !== false) {
      throw new Error("O estado inicial dos mapeamentos não corresponde ao banco descartável.");
    }
    const serializedSync = JSON.stringify(syncPayload);
    if (serializedSync.includes("PULSETI_NOTION_TOKEN") || serializedSync.includes("secret_")) {
      throw new Error("O estado das sincronizações expôs uma credencial do Notion.");
    }

    const mappingResponse = await administratorContext.request.get(`${baseUrl}/api/admin/sync/mapping`);
    if (!mappingResponse.ok()) throw new Error("A conta Administrador não conseguiu consultar os mapeamentos.");
    const mappingPayload = await mappingResponse.json();
    if (mappingPayload.mappings?.length !== 0 || mappingPayload.completeness?.requiredMapped !== 0) {
      throw new Error("O estado inicial da tela de mapeamentos não está vazio.");
    }

    const healthResponse = await administratorContext.request.get(`${baseUrl}/api/admin/health`);
    if (!healthResponse.ok()) throw new Error("A conta Administrador não conseguiu executar o diagnóstico da instalação.");
    const healthPayload = await healthResponse.json();
    const healthKeys = new Set(healthPayload.report?.checks?.map((check) => check.key));
    for (const expectedKey of ["database", "integration", "mapping", "snapshot", "jobs", "process"]) {
      if (!healthKeys.has(expectedKey)) throw new Error(`O diagnóstico não retornou a verificação ${expectedKey}.`);
    }
    const serializedHealth = JSON.stringify(healthPayload);
    if (serializedHealth.includes("PULSETI_NOTION_TOKEN") || serializedHealth.includes("secret_")) {
      throw new Error("O diagnóstico da instalação expôs uma credencial do Notion.");
    }

    const overviewResponse = await administratorContext.request.get(`${baseUrl}/api/analytics/overview`);
    if (!overviewResponse.ok()) throw new Error("A conta autenticada não conseguiu consultar a visão geral analítica.");
    const overviewPayload = await overviewResponse.json();
    if (overviewPayload.data !== null || overviewPayload.reason !== "no_snapshot") {
      throw new Error("A visão geral não representou corretamente a ausência de snapshot no banco descartável.");
    }

    await administratorPage.getByRole("button", { name: "Visão geral", exact: true }).click();
    await administratorPage.getByRole("heading", { name: "Visão geral" }).waitFor();
    await administratorPage.getByText("Aguardando primeiro snapshot", { exact: true }).first().waitFor();
    if (!(await administratorPage.getByRole("button", { name: "Filtros" }).isDisabled())) {
      throw new Error("A Visão geral liberou filtros antes de conectá-los ao modelo analítico.");
    }
    if (!(await administratorPage.getByRole("button", { name: "Indicador", exact: true }).isDisabled())) {
      throw new Error("A Visão geral liberou métricas personalizadas ainda baseadas em demonstração.");
    }

    await administratorPage.getByRole("button", { name: "Administração" }).click();
    await administratorPage.getByRole("heading", { name: "Sincronização com o Notion" }).waitFor();
    await administratorPage.getByText("Nenhuma carga publicada", { exact: true }).waitFor();
    await administratorPage.getByText("Execução ainda indisponível", { exact: true }).waitFor();
    if (!externalBaseUrl && !(await administratorPage.getByRole("button", { name: "Testar conexão" }).isDisabled())) {
      throw new Error("A interface liberou o teste de conexão sem configuração completa.");
    }
    if (!externalBaseUrl && !(await administratorPage.getByRole("button", { name: "Pré-validar bases" }).isDisabled())) {
      throw new Error("A interface liberou a pré-validação sem configuração completa.");
    }
    if (!externalBaseUrl && !(await administratorPage.getByRole("button", { name: "Sincronizar agora" }).isDisabled())) {
      throw new Error("A interface liberou a sincronização sem configuração completa.");
    }
    if (await administratorPage.getByRole("button", { name: "Encerrar execução" }).count()) {
      throw new Error("A interface ofereceu recuperação sem uma execução interrompida.");
    }
    if (!externalBaseUrl) {
      if (!disposableDatabasePath || !disposableAdministratorId) {
        throw new Error("O banco descartável não foi preparado para testar a recuperação.");
      }
      const recoveryDatabase = new ApplicationDatabase(disposableDatabasePath);
      try {
        const recoveryStore = new SyncStore(recoveryDatabase.connection);
        const publishedRun = recoveryStore.start(
          { userId: disposableAdministratorId, displayName: "Administrador QA" },
          new Date(Date.now() - SYNC_STALE_AFTER_MS - 120_000),
        );
        recoveryStore.publish(publishedRun.id, {
          tickets: [
            {
              source: "tickets",
              pageId: "qa-ticket-one",
              fields: {
                "ticket.openedAt": { state: "valid", value: { kind: "date", value: "2026-10-01T10:00:00-03:00" } },
                "ticket.externalCode": { state: "valid", value: { kind: "text", value: "TKT-001" } },
                "ticket.requester": { state: "valid", value: { kind: "text", value: "Maria da Silva" } },
                "ticket.requesterEmail": { state: "valid", value: { kind: "text", value: "maria.qa@example.invalid" } },
                "ticket.status": { state: "valid", value: { kind: "text", value: "Concluído" } },
                "ticket.priority": { state: "valid", value: { kind: "text", value: "Alta" } },
                "ticket.sector": { state: "valid", value: { kind: "text", value: "Recepção" } },
                "ticket.reason": { state: "valid", value: { kind: "text", value: "Impressora" } },
                "ticket.slaStatus": { state: "valid", value: { kind: "text", value: "Dentro do prazo" } },
              },
            },
            {
              source: "tickets",
              pageId: "qa-ticket-two",
              fields: {
                "ticket.openedAt": { state: "valid", value: { kind: "date", value: "2026-10-02T10:00:00-03:00" } },
                "ticket.externalCode": { state: "valid", value: { kind: "text", value: "TKT-002" } },
                "ticket.requester": { state: "valid", value: { kind: "text", value: "João Souza" } },
                "ticket.requesterEmail": { state: "valid", value: { kind: "text", value: "joao.qa@example.invalid" } },
                "ticket.status": { state: "valid", value: { kind: "text", value: "Aguardando informação" } },
                "ticket.priority": { state: "valid", value: { kind: "text", value: "Média" } },
                "ticket.sector": { state: "valid", value: { kind: "text", value: "Farmácia" } },
                "ticket.reason": { state: "valid", value: { kind: "text", value: "Computador" } },
                "ticket.slaStatus": { state: "valid", value: { kind: "text", value: "Fora do prazo" } },
              },
            },
          ],
          history: [],
          warningCount: 0,
        });
        recoveryStore.start(
          { userId: disposableAdministratorId, displayName: "Administrador QA" },
          new Date(Date.now() - SYNC_STALE_AFTER_MS - 1_000),
        );
      } finally {
        recoveryDatabase.close();
      }

      await administratorPage.getByRole("button", { name: "Atualizar estado" }).click();
      await administratorPage.getByText("Execução possivelmente interrompida", { exact: true }).waitFor();
      await administratorPage.getByRole("button", { name: "Encerrar execução" }).click();
      await administratorPage.getByRole("button", { name: "Sincronizar agora" }).waitFor();
      await administratorPage.getByText("Falhou", { exact: true }).first().waitFor();

      const publishedOverviewResponse = await administratorContext.request.get(`${baseUrl}/api/analytics/overview`);
      if (!publishedOverviewResponse.ok()) throw new Error("A visão geral não conseguiu ler o snapshot descartável publicado.");
      const publishedOverview = await publishedOverviewResponse.json();
      if (
        publishedOverview.data?.cards?.totalTickets !== 2
        || publishedOverview.data?.cards?.averagePerCalendarDay?.value !== 1
        || publishedOverview.data?.cards?.slaCompliance?.valuePercent !== 50
        || publishedOverview.data?.cards?.pendingTickets?.value !== 1
      ) {
        throw new Error("A visão geral não calculou corretamente o snapshot descartável publicado.");
      }
      const filteredOverviewResponse = await administratorContext.request.get(`${baseUrl}/api/analytics/overview?period=all&sector=${encodeURIComponent("Farmácia")}&priority=${encodeURIComponent("Média")}&status=${encodeURIComponent("Aguardando informação")}&reason=${encodeURIComponent("Computador")}`);
      if (!filteredOverviewResponse.ok()) throw new Error("A visão geral rejeitou filtros analíticos válidos.");
      const filteredOverview = await filteredOverviewResponse.json();
      if (
        filteredOverview.data?.selection?.matchedTickets !== 1
        || filteredOverview.data?.cards?.totalTickets !== 1
        || filteredOverview.data?.selection?.options?.sectors?.length !== 2
      ) {
        throw new Error("A visão geral não aplicou corretamente os filtros combinados.");
      }
      const invalidFilterResponse = await administratorContext.request.get(`${baseUrl}/api/analytics/overview?period=invalid`);
      if (invalidFilterResponse.status() !== 400) throw new Error("A visão geral aceitou um período analítico inválido.");

      const detailsResponse = await administratorContext.request.get(`${baseUrl}/api/analytics/overview/details?period=all&page=1&pageSize=1`);
      if (!detailsResponse.ok()) throw new Error("O Administrador não conseguiu consultar o detalhamento analítico.");
      const detailsPayload = await detailsResponse.json();
      if (
        detailsPayload.data?.selection?.totalRecords !== 2
        || detailsPayload.data?.selection?.pageCount !== 2
        || detailsPayload.data?.rows?.[0]?.code !== "TKT-002"
        || detailsPayload.data?.rows?.[0]?.requester !== "João Souza"
        || detailsPayload.data?.privacy?.requesterMasked !== false
      ) {
        throw new Error("O detalhamento do Administrador não respeitou ordenação, paginação ou perfil.");
      }
      const serializedDetails = JSON.stringify(detailsPayload);
      if (serializedDetails.includes("qa-ticket") || serializedDetails.includes("@example.invalid") || serializedDetails.includes("requesterEmail")) {
        throw new Error("O detalhamento expôs ID interno ou email do solicitante.");
      }
      const filteredDetailsResponse = await administratorContext.request.get(`${baseUrl}/api/analytics/overview/details?period=all&sector=${encodeURIComponent("Farmácia")}&priority=${encodeURIComponent("Média")}&status=${encodeURIComponent("Aguardando informação")}&reason=${encodeURIComponent("Computador")}`);
      const filteredDetails = await filteredDetailsResponse.json();
      if (!filteredDetailsResponse.ok() || filteredDetails.data?.selection?.totalRecords !== 1 || filteredDetails.data?.rows?.[0]?.code !== "TKT-002") {
        throw new Error("O detalhamento não reutilizou o recorte combinado da Visão geral.");
      }
      const analystDetailsResponse = await analystContext.request.get(`${baseUrl}/api/analytics/overview/details`);
      const analystDetails = await analystDetailsResponse.json();
      if (
        !analystDetailsResponse.ok()
        || analystDetails.data?.privacy?.requesterMasked !== true
        || analystDetails.data?.rows?.some((row) => row.requester !== "Solicitante protegido")
      ) {
        throw new Error("O detalhamento não mascarou solicitantes para a conta Analista.");
      }
      const invalidDetailsResponse = await administratorContext.request.get(`${baseUrl}/api/analytics/overview/details?pageSize=51`);
      if (invalidDetailsResponse.status() !== 400) throw new Error("O detalhamento aceitou paginação acima do limite seguro.");

      const administratorExportResponse = await administratorContext.request.get(`${baseUrl}/api/analytics/overview/export?period=all`);
      const administratorCsv = await administratorExportResponse.text();
      if (
        !administratorExportResponse.ok()
        || !administratorExportResponse.headers()["content-type"]?.startsWith("text/csv")
        || !administratorExportResponse.headers()["content-disposition"]?.includes("pulseti-visao-geral_")
        || !administratorCsv.includes("Maria da Silva")
        || !administratorCsv.includes("João Souza")
      ) {
        throw new Error("O Administrador não recebeu o CSV esperado da Visão geral.");
      }
      if (administratorCsv.includes("qa-ticket") || administratorCsv.includes("@example.invalid") || administratorCsv.includes("requesterEmail")) {
        throw new Error("A exportação CSV expôs ID interno ou email do solicitante.");
      }
      const analystExportResponse = await analystContext.request.get(`${baseUrl}/api/analytics/overview/export?period=all`);
      const analystCsv = await analystExportResponse.text();
      if (
        !analystExportResponse.ok()
        || !analystCsv.includes("Solicitante protegido")
        || analystCsv.includes("Maria da Silva")
        || analystCsv.includes("João Souza")
      ) {
        throw new Error("A exportação CSV não mascarou solicitantes para a conta Analista.");
      }
      const invalidExportResponse = await administratorContext.request.get(`${baseUrl}/api/analytics/overview/export?period=invalid`);
      if (invalidExportResponse.status() !== 400) throw new Error("A exportação aceitou filtros analíticos inválidos.");
    }
    await administratorPage.getByRole("button", { name: "Mapeamentos" }).click();
    await administratorPage.getByRole("heading", { name: "Mapeamentos do Notion" }).waitFor();
    await administratorPage.getByText("Nenhum mapeamento salvo", { exact: true }).waitFor();
    if (!externalBaseUrl && !(await administratorPage.getByRole("button", { name: "Carregar propriedades" }).isDisabled())) {
      throw new Error("A interface liberou o mapeamento sem configuração completa.");
    }
    await administratorPage.getByRole("button", { name: "Saúde do sistema" }).click();
    await administratorPage.getByRole("heading", { name: "Saúde da instalação" }).waitFor();
    await administratorPage.getByText("Banco SQLite", { exact: true }).waitFor();
    await administratorPage.getByText("Configuração do Notion", { exact: true }).waitFor();
    await administratorPage.getByRole("button", { name: "Executar diagnóstico" }).click();
    await administratorPage.getByText("Verificado em", { exact: false }).waitFor();
    await administratorPage.getByRole("button", { name: "Auditoria" }).click();
    await administratorPage.getByRole("heading", { name: "Log de auditoria" }).waitFor();
    await administratorPage.getByText("Usuário criado", { exact: true }).first().waitFor();

    if (!externalBaseUrl) {
      await administratorPage.getByLabel("Categoria").selectOption("sync");
      await administratorPage.getByText("Conexão com o Notion testada", { exact: true }).first().waitFor();
      await administratorPage.getByText("Pré-validação do Notion concluída", { exact: true }).first().waitFor();
      await administratorPage.getByText("Sincronização do Notion concluída", { exact: true }).first().waitFor();
      await administratorPage.getByText("Execução interrompida encerrada", { exact: true }).first().waitFor();
      await administratorPage.getByLabel("Categoria").selectOption("analytics");
      await administratorPage.getByText("Visão geral exportada", { exact: true }).first().waitFor();
    }

    await administratorPage.getByLabel("Categoria").selectOption("auth");
    await administratorPage.getByLabel("Resultado").selectOption("failure");
    await administratorPage.getByText("Login rejeitado", { exact: true }).first().waitFor();

    if (!externalBaseUrl) {
      await administratorPage.getByRole("button", { name: "Visão geral", exact: true }).click();
      await administratorPage.getByRole("heading", { name: "Visão geral" }).waitFor();
      const metricCards = administratorPage.locator(".metric-card");
      await metricCards.filter({ hasText: "Total de chamados" }).getByText("2", { exact: true }).waitFor();
      await metricCards.filter({ hasText: "Média por dia" }).getByText("1", { exact: true }).waitFor();
      await metricCards.filter({ hasText: "Dentro do SLA avaliado" }).getByText("50%", { exact: true }).waitFor();
      await metricCards.filter({ hasText: "Pendências atuais" }).getByText("1", { exact: true }).waitFor();
      await administratorPage.getByText("Evolução da demanda", { exact: true }).waitFor();
      await administratorPage.getByText("Distribuição por status", { exact: true }).waitFor();
      await administratorPage.getByText("Recorte: 2/2", { exact: false }).waitFor();
      const downloadPromise = administratorPage.waitForEvent("download");
      await administratorPage.getByRole("button", { name: "Exportar CSV", exact: true }).click();
      const downloadedCsv = await downloadPromise;
      if (!downloadedCsv.suggestedFilename().startsWith("pulseti-visao-geral_")) {
        throw new Error("O botão da Visão geral não iniciou o download CSV esperado.");
      }
      const compactDonut = await assertDonutCenterFits(administratorPage);
      const donutWrap = administratorPage.locator(".donut-wrap");
      const originalDonutStyle = await donutWrap.getAttribute("style");
      await donutWrap.evaluate((element) => {
        element.style.width = "600px";
        element.style.height = "300px";
      });
      await administratorPage.waitForFunction(
        (fontSize) => Number(document.querySelector(".donut-center-label__value")?.getAttribute("font-size")) > fontSize,
        compactDonut.valueFontSize,
      );
      const expandedDonut = await assertDonutCenterFits(administratorPage);
      if (expandedDonut.innerRadius <= compactDonut.innerRadius || expandedDonut.valueFontSize <= compactDonut.valueFontSize) {
        throw new Error("A porcentagem central não acompanhou o crescimento da rosca.");
      }
      await donutWrap.evaluate((element, originalStyle) => {
        if (originalStyle === null) element.removeAttribute("style");
        else element.setAttribute("style", originalStyle);
      }, originalDonutStyle);
      if (await administratorPage.getByText("518", { exact: true }).count()) {
        throw new Error("A Visão geral ainda exibiu o total demonstrativo após carregar o snapshot real.");
      }
      await administratorPage.getByRole("button", { name: "Filtros" }).click();
      const filterFieldBoxes = await administratorPage.locator(".filter-panel label").evaluateAll((elements) => elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
      }));
      const filterActionsBox = await administratorPage.locator(".filter-panel__actions").boundingBox();
      if (!filterActionsBox || filterFieldBoxes.length !== 4) {
        throw new Error("O painel de filtros não apresentou os quatro campos e suas ações.");
      }
      for (let index = 0; index < filterFieldBoxes.length; index += 1) {
        for (let comparedIndex = index + 1; comparedIndex < filterFieldBoxes.length; comparedIndex += 1) {
          if (rectanglesOverlap(filterFieldBoxes[index], filterFieldBoxes[comparedIndex])) {
            throw new Error("Os campos do painel de filtros estão sobrepostos.");
          }
        }
        if (rectanglesOverlap(filterFieldBoxes[index], filterActionsBox)) {
          throw new Error("As ações do painel estão sobrepondo um campo de filtro.");
        }
      }
      await administratorPage.getByLabel("Setor").selectOption("Farmácia");
      await administratorPage.getByLabel("Prioridade").selectOption("Média");
      await administratorPage.getByLabel("Status").selectOption("Aguardando informação");
      await administratorPage.getByRole("button", { name: "Aplicar filtros" }).click();
      await metricCards.filter({ hasText: "Total de chamados" }).getByText("1", { exact: true }).waitFor();
      await administratorPage.getByText("Recorte: 1/2", { exact: false }).waitFor();
      await administratorPage.getByRole("button", { name: "Setor: Farmácia" }).waitFor();
      await administratorPage.getByRole("button", { name: "Prioridade: Média" }).waitFor();
      await administratorPage.getByRole("button", { name: "Status: Aguardando informação" }).waitFor();
      await administratorPage.getByRole("button", { name: "Filtros" }).click();
      await administratorPage.getByRole("button", { name: "Limpar filtros" }).click();
      await metricCards.filter({ hasText: "Total de chamados" }).getByText("2", { exact: true }).waitFor();
      await administratorPage.getByText("Recorte: 2/2", { exact: false }).waitFor();
      await metricCards.filter({ hasText: "Total de chamados" }).click();
      const detailsDrawer = administratorPage.getByLabel("Detalhamento dos chamados");
      await detailsDrawer.getByRole("heading", { name: "Chamados do recorte" }).waitFor();
      await detailsDrawer.getByText("TKT-002", { exact: true }).waitFor();
      await detailsDrawer.getByText("João Souza", { exact: true }).waitFor();
      if (await detailsDrawer.getByText(/@example\.invalid/).count()) {
        throw new Error("O drawer exibiu email do solicitante.");
      }
      await detailsDrawer.getByRole("button", { name: "Fechar", exact: true }).click();
      await administratorPage.locator(".legend-list button").filter({ hasText: "Concluído" }).click();
      await metricCards.filter({ hasText: "Total de chamados" }).getByText("1", { exact: true }).waitFor();
      await administratorPage.getByRole("button", { name: "Status cruzado: Concluído" }).waitFor();
      await administratorPage.getByText("Recorte: 1/2", { exact: false }).waitFor();
      await assertDonutCenterFits(administratorPage);
      await administratorPage.locator(".widget").filter({ hasText: "Distribuição por status" }).getByRole("button", { name: "Abrir detalhes" }).click();
      const filteredDrawer = administratorPage.getByLabel("Detalhamento dos chamados");
      await filteredDrawer.getByText("Status cruzado: Concluído", { exact: true }).waitFor();
      await filteredDrawer.getByText("TKT-001", { exact: true }).waitFor();
      if (await filteredDrawer.getByText("TKT-002", { exact: true }).count()) {
        throw new Error("O drawer ignorou a seleção cruzada por status.");
      }
      await filteredDrawer.getByRole("button", { name: "Fechar", exact: true }).click();
      await administratorPage.getByRole("button", { name: "Status cruzado: Concluído" }).click();
      await metricCards.filter({ hasText: "Total de chamados" }).getByText("2", { exact: true }).waitFor();
      await administratorPage.getByText("Recorte: 2/2", { exact: false }).waitFor();

      await administratorPage.getByRole("button", { name: "Editar layout" }).click();
      const dragHandle = administratorPage.locator(".react-grid-item .widget-drag-handle").first();
      const dragHandleBox = await dragHandle.boundingBox();
      if (!dragHandleBox) throw new Error("O QA não encontrou um bloco para testar a movimentação do layout.");
      const dragStartX = dragHandleBox.x + dragHandleBox.width / 2;
      const dragStartY = dragHandleBox.y + dragHandleBox.height / 2;
      await administratorPage.mouse.move(dragStartX, dragStartY);
      await administratorPage.mouse.down();
      await administratorPage.mouse.move(dragStartX + 180, dragStartY + 120, { steps: 24 });
      await administratorPage.mouse.up();
      const updateDepthError = administratorPageErrors.find((error) => error.message.includes("Maximum update depth exceeded"));
      if (updateDepthError) throw new Error("Movimentar o layout causou um ciclo de atualizações do React.");

      await administratorPage.getByRole("button", { name: "Criar nova página" }).click();
      await administratorPage.getByText("Página 2 está vazia", { exact: true }).waitFor();
      if (await administratorPage.locator(".dashboard-grid-wrap .react-grid-item").count()) {
        throw new Error("Uma página recém-criada não iniciou vazia.");
      }
      const emptyPageBox = await administratorPage.locator(".dashboard-grid-wrap").boundingBox();
      if (!emptyPageBox || Math.abs(emptyPageBox.height - 523) > 2) {
        throw new Error("A página analítica não respeitou o limite vertical de 13 linhas.");
      }
      await administratorPage.getByRole("button", { name: "Salvar layout" }).click();
      await administratorPage.getByText("Layout e métricas salvos no servidor", { exact: true }).waitFor();
      const pagedDraftResponse = await administratorContext.request.get(`${baseUrl}/api/dashboard-drafts/overview`);
      const pagedDraft = await pagedDraftResponse.json();
      if (!pagedDraftResponse.ok() || pagedDraft.draft?.schemaVersion !== 2 || pagedDraft.draft?.pages?.length !== 2) {
        throw new Error("A nova página não foi persistida no rascunho versão 2.");
      }
      await administratorPage.reload({ waitUntil: "networkidle" });
      await administratorPage.getByRole("button", { name: "Visão geral", exact: true }).click();
      await administratorPage.getByRole("heading", { name: "Visão geral" }).waitFor();
      await administratorPage.getByRole("tab", { name: "Página 2" }).click();
      await administratorPage.getByText("Página 2 está vazia", { exact: true }).waitFor();
      await administratorPage.getByRole("tab", { name: "Página 1" }).click();
      const boundedCanvas = await administratorPage.locator(".dashboard-grid-wrap").boundingBox();
      const boundedItems = await administratorPage.locator(".dashboard-grid-wrap .react-grid-item").evaluateAll((items) => items.map((item) => item.getBoundingClientRect().bottom));
      if (!boundedCanvas || boundedItems.some((bottom) => bottom > boundedCanvas.y + boundedCanvas.height + 1)) {
        throw new Error("Um bloco ultrapassou o limite inferior da página ativa.");
      }
    }

    process.stdout.write("QA concluído: auditoria, autorização, páginas limitadas, Visão geral real, detalhamento protegido, exportação CSV, filtros, cruzamentos, mapeamentos e sincronização funcionam.\n");
  } finally {
    await anonymousContext.close();
    await analystContext.close();
    await administratorContext.close();
    await browser.close();
  }
}

try {
  const baseUrl = externalBaseUrl
    ? normalizeBaseUrl(externalBaseUrl)
    : await prepareDisposableApplication();

  if (externalBaseUrl) await assertExternalApplicationIsReachable(baseUrl);
  await runAuditFlow(baseUrl);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`QA de auditoria não concluído: ${message}\n`);
  process.exitCode = 1;
} finally {
  await stopApplication();
  await removeDisposableDirectory();
}
