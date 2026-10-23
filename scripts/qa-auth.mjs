export const qaEmail = process.env.QA_EMAIL ?? "";
export const qaPassword = process.env.QA_PASSWORD ?? "";

export async function authenticateQaUser(page) {
  if (!page.url().includes("/login")) return;
  if (!qaEmail || !qaPassword) {
    throw new Error("Defina QA_EMAIL e QA_PASSWORD para executar o QA em uma aplicação protegida.");
  }

  await page.getByLabel("Email").fill(qaEmail);
  await page.getByLabel("Senha", { exact: true }).fill(qaPassword);
  await page.getByRole("button", { name: "Entrar na plataforma" }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"));

  if (page.url().includes("/trocar-senha")) {
    throw new Error("A conta de QA ainda exige a troca da senha temporária.");
  }
}
