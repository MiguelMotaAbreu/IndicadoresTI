import { chromium } from "@playwright/test";
import { authenticateQaUser } from "./qa-auth.mjs";

const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:3000";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });

async function readGridBoxes() {
  return page.locator(".dashboard-grid-wrap .react-grid-item").evaluateAll((items) => items.map((item, index) => {
    const box = item.getBoundingClientRect();
    return {
      index,
      label: item.textContent?.trim().slice(0, 80) || `item ${index + 1}`,
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
    };
  }));
}

function assertNoOverlaps(boxes) {
  for (let leftIndex = 0; leftIndex < boxes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < boxes.length; rightIndex += 1) {
      const left = boxes[leftIndex];
      const right = boxes[rightIndex];
      const overlaps = !(
        left.right <= right.left + 1 ||
        right.right <= left.left + 1 ||
        left.bottom <= right.top + 1 ||
        right.bottom <= left.top + 1
      );
      if (overlaps) throw new Error(`Sobreposição entre "${left.label}" e "${right.label}".`);
    }
  }
}

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await authenticateQaUser(page);
  await page.getByRole("button", { name: /Visão geral/ }).first().click();
  await page.getByRole("heading", { name: "Visão geral", exact: true }).waitFor();
  await page.getByRole("button", { name: "Editar layout" }).click();

  const before = await readGridBoxes();
  assertNoOverlaps(before);

  const draggedCard = page.locator(".dashboard-grid-wrap .react-grid-item").first();
  const dragHandle = draggedCard.locator(".widget-drag-handle");
  const handleBox = await dragHandle.boundingBox();
  if (!handleBox) throw new Error("A alça do primeiro cartão não foi encontrada.");

  await page.mouse.move(handleBox.x + 18, handleBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + 180, handleBox.y + 100, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const after = await readGridBoxes();
  assertNoOverlaps(after);
  const draggedMoved = Math.abs(after[0].top - before[0].top) > 20 || Math.abs(after[0].left - before[0].left) > 20;
  if (!draggedMoved) throw new Error("O cartão arrastado não mudou de posição.");
  const anotherCardMoved = after.slice(1).some((item, index) => Math.abs(item.top - before[index + 1].top) > 20);
  if (!anotherCardMoved) throw new Error("O movimento não acionou o reposicionamento de outro cartão.");

  await page.getByRole("button", { name: "Salvar layout" }).click();
  await page.getByText("Layout e métricas salvos no servidor", { exact: true }).waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await authenticateQaUser(page);
  await page.getByRole("button", { name: /Visão geral/ }).first().click();
  await page.getByRole("heading", { name: "Visão geral", exact: true }).waitFor();
  await page.waitForTimeout(300);
  assertNoOverlaps(await readGridBoxes());

  process.stdout.write("QA concluído: a cascata move cartões, não gera sobreposição e permanece válida após recarregar.\n");
} finally {
  await browser.close();
}
