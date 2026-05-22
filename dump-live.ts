import "dotenv/config";
import { chromium } from "playwright";
import fs from "fs";

const TABLE_URL = process.env.TABLE_URL ?? "";
const BOT_NAME  = process.env.BOT_NAME  ?? "DumpBot";
const STACK     = parseInt(process.env.STACK ?? "1000");

async function main() {
  if (!TABLE_URL) { console.error("Set TABLE_URL in .env"); process.exit(1); }

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto(TABLE_URL, { waitUntil: "networkidle" });

  // Accept ToS
  const tos = await page.$("#accept-tos-button");
  if (tos) { await tos.click(); await page.waitForTimeout(600); }

  // Sit down
  const sitBtn = await page.$(".table-player-seat .table-player-seat-button");
  if (sitBtn) {
    await sitBtn.click();
    await page.waitForSelector(".request-ingress-popover", { timeout: 5000 }).catch(() => {});
    const nameInput = await page.$('.request-ingress-popover input[placeholder="Your Name"]');
    if (nameInput) { await nameInput.fill(BOT_NAME); }
    const stackInput = await page.$('.request-ingress-popover input[placeholder="Intended Stack"]');
    if (stackInput) { await stackInput.fill(String(STACK)); }
    const submit = await page.$('.request-ingress-popover button[type="submit"]');
    if (submit) { await submit.click(); await page.waitForTimeout(1500); }
    console.log("✅ Seat requested");
  } else {
    console.log("No empty seat found — already seated or table full");
  }

  console.log("\n⏳ Waiting for your turn...");
  console.log("   When it's your turn, click RAISE to open the raise panel");
  console.log("   Leave it open, then press Enter here to dump\n");

  await new Promise<void>(r => {
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.once("data", () => { process.stdin.setRawMode?.(false); r(); });
  });

  fs.writeFileSync("pokernow-dom-dump.html", await page.content());
  console.log("✅ Saved pokernow-dom-dump.html");
  await browser.close();
}

main().catch(console.error);
