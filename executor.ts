import { Page } from "playwright";
import { BotAction } from "./types";

const SEL = {
  foldBtn: ".action-buttons button.fold",
  checkBtn: ".action-buttons button.check",
  callBtn: ".action-buttons button.call",
  raiseBtn: ".action-buttons button.raise",
  raiseInput: ".action-buttons input",
  raiseConfirm: ".action-buttons button.raise",
};

function humanDelay(min = 800, max = 2800): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min) + min);
  console.log(`  [executor] waiting ${ms}ms...`);
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function clickWithDelay(page: Page, selector: string): Promise<void> {
  await humanDelay();
  console.log(`  [executor] looking for: ${selector}`);
  const el = await page.$(selector);
  if (!el) {
    // list what buttons ARE available to help debug
    const available = await page.$$eval(".action-buttons button", els =>
      els.map(e => `"${e.textContent?.trim()}" [class="${e.className}"]`)
    ).catch(() => []);
    throw new Error(`Button not found: ${selector}\n  Available buttons: ${available.join(", ") || "none"}`);
  }
  const box = await el.boundingBox();
  if (box) {
    const x = box.x + box.width * (0.3 + Math.random() * 0.4);
    const y = box.y + box.height * (0.3 + Math.random() * 0.4);
    await page.mouse.move(x, y, { steps: 5 });
    await humanDelay(100, 300);
  }
  console.log(`  [executor] clicking ${selector}`);
  await el.click();
  console.log(`  [executor] ✅ clicked`);
}

export async function executeAction(page: Page, action: BotAction): Promise<void> {
  console.log(`\n[executor] ▶ action=${action.action}${action.amount ? ` amount=${action.amount}` : ""}`);
  console.log(`[executor]   reasoning: ${action.reasoning ?? "none"}`);

  switch (action.action) {
    case "fold":
      await clickWithDelay(page, SEL.foldBtn);
      break;

    case "check":
      await clickWithDelay(page, SEL.checkBtn);
      break;

    case "call":
      await clickWithDelay(page, SEL.callBtn);
      break;

    case "raise":
      await clickWithDelay(page, SEL.raiseBtn);
      if (action.amount) {
        await humanDelay(300, 700);
        const input = await page.$(SEL.raiseInput);
        if (input) {
          console.log(`  [executor] filling raise input with ${action.amount}`);
          await input.click({ clickCount: 3 });
          await input.fill(String(action.amount));
          await humanDelay(200, 500);
          await clickWithDelay(page, SEL.raiseConfirm);
        } else {
          console.warn("  [executor] ⚠ raise input not found — clicking raise btn directly");
          await clickWithDelay(page, SEL.raiseConfirm);
        }
      }
      break;

    default:
      console.warn(`[executor] ⚠ unknown action "${action.action}", folding as fallback`);
      await clickWithDelay(page, SEL.foldBtn);
  }
}
