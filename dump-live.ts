import "dotenv/config";
import { chromium } from "playwright";
import fs from "fs";

const TABLE_URL = process.env.TABLE_URL ?? "";

async function main() {
  if (!TABLE_URL) { console.error("Set TABLE_URL in .env"); process.exit(1); }

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto(TABLE_URL, { waitUntil: "networkidle" });

  console.log("\n✅ Browser open.");
  console.log("   1. Click a 'Sit' button on any empty seat");
  console.log("   2. Let the dialog fully appear");
  console.log("\n⏳ Dumping in 15s (or press Enter)...\n");

  await Promise.race([
    new Promise<void>(r => setTimeout(r, 15000)),
    new Promise<void>(r => {
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdin.once("data", () => { process.stdin.setRawMode?.(false); r(); });
    }),
  ]);

  fs.writeFileSync("pokernow-dom-dump.html", await page.content());
  console.log("✅ Saved pokernow-dom-dump.html");
  await browser.close();
}

main().catch(console.error);
