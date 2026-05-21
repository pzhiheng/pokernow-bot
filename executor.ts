import { Page } from "playwright";
import { BotAction } from "./types";

const SEL = {
  foldBtn: ".fold-button",
  checkBtn: ".check-button",
  callBtn: ".call-button",
  raiseBtn: ".raise-button",
  raiseInput: ".raise-input",
  raiseConfirm: ".raise-confirm-button",
};

function humanDelay(min = 800, max = 2800): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min) + min);
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function clickWithDelay(page: Page, selector: string): Promise<void> {
  await humanDelay();
  const el = await page.$(selector);
  if (!el) throw new Error(`Button not found: ${selector}`);
  // slight mouse jitter to look human
  const box = await el.boundingBox();
  if (box) {
    const x = box.x + box.width * (0.3 + Math.random() * 0.4);
    const y = box.y + box.height * (0.3 + Math.random() * 0.4);
    await page.mouse.move(x, y, { steps: 5 });
    await humanDelay(100, 300);
  }
  await el.click();
}

export async function executeAction(page: Page, action: BotAction): Promise<void> {
  console.log(`[executor] Action: ${action.action}${action.amount ? ` ${action.amount}` : ""} — ${action.reasoning}`);

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
          await input.triple_click?.();
          await input.fill(String(action.amount));
          await humanDelay(200, 500);
        }
      }
      await clickWithDelay(page, SEL.raiseConfirm);
      break;

    default:
      console.warn("[executor] Unknown action, folding as fallback");
      await clickWithDelay(page, SEL.foldBtn);
  }
}
