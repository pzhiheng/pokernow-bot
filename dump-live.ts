import "dotenv/config";
import { chromium } from "playwright";
import fs from "fs";

const TABLE_URL = process.env.TABLE_URL ?? "";

async function main() {
  if (!TABLE_URL) {
    console.error("Set TABLE_URL in .env");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto(TABLE_URL, { waitUntil: "networkidle" });

  console.log("\n✅ Browser opened. In the Playwright window:");
  console.log("   1. Sit down at a seat");
  console.log("   2. Add chips if needed");
  console.log("   3. Start a hand (deal cards)");
  console.log("\n⏳ Waiting 60 seconds — press Enter here to dump early...\n");

  // wait for Enter key or 60s timeout
  const timeout = new Promise<void>(r => setTimeout(r, 60000));
  const keypress = new Promise<void>(r => {
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.once("data", () => { process.stdin.setRawMode?.(false); r(); });
  });

  await Promise.race([timeout, keypress]);

  const html = await page.content();
  fs.writeFileSync("pokernow-dom-dump.html", html);
  console.log("✅ Saved pokernow-dom-dump.html");

  await browser.close();
}

main().catch(console.error);
