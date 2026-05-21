import { chromium } from "playwright";
import fs from "fs";
import { scrapeGameState, isMyTurn, dumpDom } from "./scraper";
import { decideAction, updatePlayerReads } from "./ai";
import { executeAction } from "./executor";
import { PlayerReads } from "./types";

const TABLE_URL = process.env.TABLE_URL ?? "";
const READS_FILE = "player_reads.json";
const POLL_MS = 1500;

function loadReads(): PlayerReads {
  if (fs.existsSync(READS_FILE)) {
    return JSON.parse(fs.readFileSync(READS_FILE, "utf8"));
  }
  return {};
}

function saveReads(reads: PlayerReads): void {
  fs.writeFileSync(READS_FILE, JSON.stringify(reads, null, 2));
}

async function main() {
  if (!TABLE_URL) {
    console.error("Set TABLE_URL env var to your PokerNow game URL");
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Set ANTHROPIC_API_KEY env var");
    process.exit(1);
  }

  // DOM dump mode — run with: npm run dump
  if (process.argv.includes("--dump")) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(TABLE_URL, { waitUntil: "networkidle" });
    const html = await dumpDom(page);
    fs.writeFileSync("pokernow-dom-dump.html", html);
    console.log("Saved pokernow-dom-dump.html — open it and update selectors in scraper.ts");
    await browser.close();
    return;
  }

  const browser = await chromium.launch({ headless: false }); // headed so you can watch
  const page = await browser.newPage();
  await page.goto(TABLE_URL, { waitUntil: "networkidle" });
  console.log(`[bot] Joined table: ${TABLE_URL}`);

  let playerReads = loadReads();
  let handNumber = 0;
  let lastHandNumber = -1;
  let handActionLog: string[] = [];

  while (true) {
    await new Promise(r => setTimeout(r, POLL_MS));

    const myTurn = await isMyTurn(page);
    if (!myTurn) continue;

    const state = await scrapeGameState(page, handNumber, playerReads);
    if (!state) continue;

    // detect new hand
    if (state.hand !== lastHandNumber) {
      if (lastHandNumber >= 0 && handActionLog.length > 0) {
        console.log("[bot] Hand ended, updating player reads...");
        playerReads = await updatePlayerReads(playerReads, handActionLog.join("\n"));
        saveReads(playerReads);
        handActionLog = [];
      }
      handNumber = state.hand;
      lastHandNumber = state.hand;
    }

    const action = await decideAction(state);
    handActionLog.push(`Hand ${handNumber} | ${state.street} | ${action.action}${action.amount ? ` ${action.amount}` : ""}`);

    await executeAction(page, action);
  }
}

main().catch(err => {
  console.error("[bot] Fatal error:", err);
  process.exit(1);
});
