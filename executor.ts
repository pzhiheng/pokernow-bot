import { Page } from "playwright";
import { BotAction } from "./types";

const SEL = {
  foldBtn:      ".action-buttons button.fold",
  checkBtn:     ".action-buttons button.check",
  callBtn:      ".action-buttons button.call",
  raiseBtn:     ".action-buttons button.raise",
  raiseForm:    ".raise-controller-form",           // appears after clicking Raise
  raiseInput:   ".raise-bet-value input.value",     // the amount text field
  raiseConfirm: ".raise-controller-form input[type='submit']", // the green "Bet" button
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
    const available = await page.$$eval(".action-buttons button", els =>
      els.map(e => `"${e.textContent?.trim()}" [class="${e.className}"]`)
    ).catch(() => []);
    throw new Error(`Button not found: ${selector}\n  Available: ${available.join(", ") || "none"}`);
  }

  const box = await el.boundingBox();
  if (!box) throw new Error(`No bounding box for: ${selector}`);

  // Bring Playwright window to front so mouse events aren't swallowed
  await page.bringToFront();

  const x = box.x + box.width  * (0.3 + Math.random() * 0.4);
  const y = box.y + box.height * (0.3 + Math.random() * 0.4);
  console.log(`  [executor] clicking (${x.toFixed(0)}, ${y.toFixed(0)})`);

  // Move to button first (natural mouse path), then full click (down+up+click)
  await page.mouse.move(x, y, { steps: 8 });
  await humanDelay(60, 150);
  await page.mouse.click(x, y);   // fires mousedown → mouseup → click together

  // Brief wait for React handler + network round-trip
  await new Promise(r => setTimeout(r, 500));
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
        // Wait for the raise-controller-form to slide in
        console.log(`  [executor] waiting for raise panel...`);
        try {
          await page.waitForSelector(SEL.raiseForm, { state: "visible", timeout: 4000 });
        } catch {
          console.warn("  [executor] ⚠ raise form did not appear");
          break;
        }

        // Clear the amount field and type our value.
        // page.fill() focuses + clears + sets value atomically (works on React inputs).
        // Then we triple-click + Select-All + Delete as a belt-and-suspenders clear,
        // re-type the amount, so the field contains ONLY our desired number.
        console.log(`  [executor] setting raise amount: ${action.amount}`);
        await page.fill(SEL.raiseInput, String(action.amount));
        await new Promise(r => setTimeout(r, 100));

        // Verify the value looks right; if page.fill left residue, force-clear and retype
        const currentVal = await page.$eval(SEL.raiseInput, (el: HTMLInputElement) => el.value);
        console.log(`  [executor] raise input value after fill: "${currentVal}"`);
        if (currentVal !== String(action.amount)) {
          console.warn(`  [executor] ⚠ fill mismatch — forcing select-all + delete + retype`);
          await page.focus(SEL.raiseInput);
          await page.keyboard.press("Control+a");
          await new Promise(r => setTimeout(r, 80));
          await page.keyboard.press("Delete");
          await new Promise(r => setTimeout(r, 80));
          await page.keyboard.type(String(action.amount));
        }
        await humanDelay(200, 400);

        // Click the green "Bet" submit button
        console.log(`  [executor] clicking Bet to confirm`);
        await clickWithDelay(page, SEL.raiseConfirm);
      }
      break;

    default:
      console.warn(`[executor] ⚠ unknown action "${action.action}", folding as fallback`);
      await clickWithDelay(page, SEL.foldBtn);
  }
}
