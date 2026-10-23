import { chromium } from "@playwright/test";

const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:3000";
const administratorEmail = process.env.QA_EMAIL ?? "admin.qa@upa.local";
const administratorPassword = process.env.QA_PASSWORD ?? "Senha definitiva QA 456";
const uniqueSuffix = Date.now().toString(36);
const analystEmail = process.env.QA_NEW_USER_EMAIL ?? `analista.${uniqueSuffix}@upa.local`;
const analystPassword = process.env.QA_NEW_USER_PASSWORD ?? `Senha analista QA ${uniqueSuffix}`;

const browser = await chromium.launch({ channel: "msedge", headless: true });
const administratorContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const administratorPage = await administratorContext.newPage();

async function login(page, email, password) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar na plataforma" }).click();
}

try {
  const anonymousAdminApi = await administratorContext.request.get(`${baseUrl}/api/admin/users`);
  if (anonymousAdminApi.status() !== 401) throw new Error("A API administrativa aceitou uma requisição anônima.");

  await login(administratorPage, administratorEmail, administratorPassword);
  await administratorPage.getByRole("heading", { name: "Catálogo de painéis" }).waitFor();

  const adminUsersResponse = await administratorContext.request.get(`${baseUrl}/api/admin/users`);
  const adminUsersPayload = await adminUsersResponse.json();
  const currentAdministrator = adminUsersPayload.users?.find((user) => user.email === administratorEmail);
  if (!currentAdministrator) throw new Error("A conta administrativa atual não apareceu na listagem.");

  const malformedCreate = await administratorContext.request.post(`${baseUrl}/api/admin/users`, {
    headers: { "Content-Type": "application/json" },
    data: null,
  });
  if (malformedCreate.status() !== 422) throw new Error("A API não rejeitou um cadastro sem dados.");

  const selfDeactivation = await administratorContext.request.patch(`${baseUrl}/api/admin/users/${currentAdministrator.id}`, {
    headers: { "Content-Type": "application/json" },
    data: { isActive: false },
  });
  if (selfDeactivation.status() !== 422) throw new Error("A API permitiu desativar a própria conta em uso.");

  await administratorPage.getByRole("button", { name: "Administração" }).click();
  await administratorPage.getByRole("button", { name: "Usuários" }).click();
  await administratorPage.getByRole("heading", { name: "Usuários e permissões" }).waitFor();

  await administratorPage.getByRole("button", { name: "Novo usuário" }).click();
  const createDialog = administratorPage.getByRole("dialog");
  await createDialog.getByLabel("Nome completo").fill("Analista QA");
  await createDialog.getByLabel("Email").fill(analystEmail);
  await createDialog.getByLabel("Perfil").selectOption("analista");
  await createDialog.getByRole("button", { name: "Criar usuário" }).click();

  const credentialsDialog = administratorPage.getByRole("dialog");
  await credentialsDialog.getByRole("heading", { name: "Entregue estas credenciais agora" }).waitFor();
  const temporaryPassword = await credentialsDialog.locator("code").innerText();
  if (temporaryPassword.length < 12) throw new Error("A senha temporária não foi apresentada corretamente.");
  await credentialsDialog.getByRole("button", { name: "Concluído" }).click();

  await administratorPage.getByRole("button", { name: "Novo usuário" }).click();
  const duplicateDialog = administratorPage.getByRole("dialog");
  await duplicateDialog.getByLabel("Nome completo").fill("Analista duplicado");
  await duplicateDialog.getByLabel("Email").fill(analystEmail);
  await duplicateDialog.getByRole("button", { name: "Criar usuário" }).click();
  await duplicateDialog.getByRole("alert").getByText("Já existe uma conta com este email.").waitFor();
  await duplicateDialog.getByRole("button", { name: "Fechar", exact: true }).click();

  const analystRow = administratorPage.getByRole("row").filter({ hasText: analystEmail });
  await analystRow.getByText("Analista", { exact: true }).waitFor();
  await analystRow.getByText("Troca pendente", { exact: true }).waitFor();

  const analystContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const analystPage = await analystContext.newPage();
  try {
    await login(analystPage, analystEmail, temporaryPassword);
    await analystPage.waitForURL(/\/trocar-senha$/);
    await analystPage.getByLabel("Nova senha", { exact: true }).fill(analystPassword);
    await analystPage.getByLabel("Confirme a nova senha").fill(analystPassword);
    await analystPage.getByRole("button", { name: "Salvar e acessar os painéis" }).click();
    await analystPage.getByRole("heading", { name: "Catálogo de painéis" }).waitFor();

    const forbiddenAdminApi = await analystContext.request.get(`${baseUrl}/api/admin/users`);
    if (forbiddenAdminApi.status() !== 403) throw new Error("Uma conta Analista acessou a API administrativa.");
    if (await analystPage.getByRole("button", { name: "Administração" }).count()) {
      throw new Error("A navegação administrativa foi exibida para uma conta Analista.");
    }

    administratorPage.once("dialog", (dialog) => dialog.accept());
    await analystRow.getByRole("button", { name: "Desativar" }).click();
    await analystRow.getByText("Desativada", { exact: true }).waitFor();

    const revokedSession = await analystContext.request.get(`${baseUrl}/api/dashboard-drafts/overview`);
    if (revokedSession.status() !== 401) throw new Error("A desativação não revogou a sessão da conta.");

    administratorPage.once("dialog", (dialog) => dialog.accept());
    await analystRow.getByRole("button", { name: "Reativar" }).click();
    await analystRow.getByText("Ativa", { exact: true }).waitFor();

    await login(analystPage, analystEmail, analystPassword);
    await analystPage.getByRole("heading", { name: "Catálogo de painéis" }).waitFor();
  } finally {
    await analystContext.close();
  }

  process.stdout.write("QA concluído: criação, primeiro acesso, autorização, desativação, revogação e reativação funcionam.\n");
} finally {
  await administratorContext.close();
  await browser.close();
}
