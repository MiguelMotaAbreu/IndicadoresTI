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

    const analystContext = await browser.newContext();
    const analystPage = await analystContext.newPage();
    try {
      await login(analystPage, analystEmail, created.temporaryPassword);
      await analystPage.waitForURL(/\/trocar-senha$/);
      const forbiddenAudit = await analystContext.request.get(`${baseUrl}/api/admin/audit`);
      if (forbiddenAudit.status() !== 403) throw new Error("Uma conta Analista consultou a auditoria.");
      const forbiddenHealth = await analystContext.request.get(`${baseUrl}/api/admin/health`);
      if (forbiddenHealth.status() !== 403) throw new Error("Uma conta Analista consultou a saúde do sistema.");
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
    } finally {
      await analystContext.close();
    }

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
        new SyncStore(recoveryDatabase.connection).start(
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
    }

    await administratorPage.getByLabel("Categoria").selectOption("auth");
    await administratorPage.getByLabel("Resultado").selectOption("failure");
    await administratorPage.getByText("Login rejeitado", { exact: true }).first().waitFor();

    process.stdout.write("QA concluído: auditoria, autorização, saúde, mapeamentos, proteção e recuperação da sincronização funcionam.\n");
  } finally {
    await anonymousContext.close();
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
