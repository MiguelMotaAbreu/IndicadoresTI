import { chromium } from "@playwright/test";

const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:3000";
const email = process.env.QA_EMAIL ?? "admin.qa@upa.local";
const temporaryPassword = process.env.QA_TEMPORARY_PASSWORD ?? "Senha temporaria QA 123";
const definitivePassword = process.env.QA_NEW_PASSWORD ?? "Senha definitiva QA 456";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await context.newPage();

try {
  const anonymousApi = await context.request.get(`${baseUrl}/api/dashboard-drafts/overview`);
  if (anonymousApi.status() !== 401) throw new Error("A API de rascunhos aceitou uma requisição anônima.");

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForURL(/\/login$/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("senha incorreta");
  await page.getByRole("button", { name: "Entrar na plataforma" }).click();
  await page.getByRole("alert").getByText("Email ou senha incorretos.").waitFor();

  await page.getByLabel("Senha", { exact: true }).fill(temporaryPassword);
  await page.getByRole("button", { name: "Entrar na plataforma" }).click();
  await page.waitForURL(/\/trocar-senha$/);

  const protectedApi = await context.request.get(`${baseUrl}/api/dashboard-drafts/overview`);
  if (protectedApi.status() !== 403) throw new Error("A senha temporária permitiu acessar uma API protegida.");

  const sessionCookie = (await context.cookies()).find((cookie) => cookie.name === "pulseti_session");
  if (!sessionCookie?.httpOnly || sessionCookie.sameSite !== "Strict") {
    throw new Error("O cookie de sessão não recebeu as proteções HttpOnly e SameSite=Strict.");
  }
  const browserCookie = await page.evaluate(() => document.cookie);
  if (browserCookie.includes("pulseti_session")) throw new Error("O token de sessão ficou acessível ao JavaScript do navegador.");

  await page.getByLabel("Nova senha", { exact: true }).fill(definitivePassword);
  await page.getByLabel("Confirme a nova senha").fill("confirmação diferente");
  await page.getByRole("button", { name: "Salvar e acessar os painéis" }).click();
  await page.getByRole("alert").getByText("As senhas informadas não coincidem.").waitFor();

  await page.getByLabel("Nova senha", { exact: true }).fill(definitivePassword);
  await page.getByLabel("Confirme a nova senha").fill(definitivePassword);
  await page.getByRole("button", { name: "Salvar e acessar os painéis" }).click();
  await page.getByRole("heading", { name: "Catálogo de painéis" }).waitFor();

  const authenticatedApi = await context.request.get(`${baseUrl}/api/dashboard-drafts/overview`);
  if (!authenticatedApi.ok()) throw new Error("A sessão definitiva não acessou a API protegida.");

  await page.getByRole("button", { name: /Administrador QA/ }).click();
  await page.getByRole("button", { name: "Encerrar sessão" }).click();
  await page.waitForURL(/\/login$/);
  if ((await context.cookies()).some((cookie) => cookie.name === "pulseti_session")) {
    throw new Error("O logout não removeu o cookie de sessão.");
  }

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(temporaryPassword);
  await page.getByRole("button", { name: "Entrar na plataforma" }).click();
  await page.getByRole("alert").getByText("Email ou senha incorretos.").waitFor();

  await page.getByLabel("Senha", { exact: true }).fill(definitivePassword);
  await page.getByRole("button", { name: "Entrar na plataforma" }).click();
  await page.getByRole("heading", { name: "Catálogo de painéis" }).waitFor();

  process.stdout.write("QA concluído: login, troca obrigatória, cookie protegido, APIs e logout funcionam.\n");
} finally {
  await browser.close();
}
