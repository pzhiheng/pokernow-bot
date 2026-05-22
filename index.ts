import "dotenv/config";
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
    console.error("❌ Set TABLE_URL in .env");
    process.exit(1);
  }

  // DOM dump mode
  if (process.argv.includes("--dump")) {
    console.log("[dump] launching headless browser...");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    console.log(`[dump] navigating to ${TABLE_URL}`);
    await page.goto(TABLE_URL, { waitUntil: "networkidle" });
    const html = await dumpDom(page);
    fs.writeFileSync("pokernow-dom-dump.html", html);
    console.log("✅ Saved pokernow-dom-dump.html");
    await browser.close();
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ Set ANTHROPIC_API_KEY in .env");
    process.exit(1);
  }

  console.log("🚀 Starting PokerNow bot...");
  console.log(`   Table: ${TABLE_URL}`);
  console.log(`   Poll interval: ${POLL_MS}ms`);

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log("[bot] navigating to table...");
  await page.goto(TABLE_URL, { waitUntil: "networkidle" });
  console.log("[bot] ✅ page loaded — make sure you are seated and a hand is running");
  console.log("[bot] polling for your turn every 1.5s...\n");

  let playerReads = loadReads();
  let handNumber = 0;
  let lastHandNumber = -1;
  let handActionLog: string[] = [];
  let pollCount = 0;

  while (true) {
    await new Promise(r => setTimeout(r, POLL_MS));
    pollCount++;

    // Log a heartbeat every 20 polls (~30s) so you know it's alive
    if (pollCount % 20 === 0) {
      console.log(`[poll] ♥ still watching... (${pollCount} polls, hand #${handNumber})`);
    }

    const myTurn = await isMyTurn(page);
    if (!myTurn) continue;

    console.log("\n[bot] ===== MY TURN =====");
    console.log("[bot] scraping game state...");
    const state = await scrapeGameState(page, handNumber, playerReads);

    if (!state) {
      console.log("[bot] ⚠ scrape returned null — cards not visible or hand not in progress");
      continue;
    }

    // Detect new hand
    if (state.hand !== lastHandNumber) {
      if (lastHandNumber >= 0 && handActionLog.length > 0) {
        console.log(`\n[bot] hand #${lastHandNumber} ended — updating player reads...`);
        playerReads = await updatePlayerReads(playerReads, handActionLog.join("\n"));
        saveReads(playerReads);
        console.log("[bot] player reads saved");
        handActionLog = [];
      }
      handNumber++;
      state.hand = handNumber;
      lastHandNumber = handNumber;
      console.log(`[bot] new hand detected — hand #${handNumber}`);
    }

    console.log(`[bot] state: ${state.street} | hole=[${state.hole_cards.join(",")}] board=[${state.community.join(",") || "none"}] pot=${state.pot} to_call=${state.to_call} stack=${state.my_stack}`);
    console.log("[bot] asking Claude for decision...");

    const action = await decideAction(state);
    console.log(`[bot] Claude says: ${action.action}${action.amount ? ` ${action.amount}` : ""} — "${action.reasoning}"`);

    handActionLog.push(`Hand ${handNumber} | ${state.street} | ${action.action}${action.amount ? ` ${action.amount}` : ""}`);

    await executeAction(page, action);

    // Cooldown after acting — wait for UI to update before polling again
    console.log("[bot] waiting 3s for UI to update...");
    await new Promise(r => setTimeout(r, 3000));
    console.log("[bot] =====================\n");
  }
}

main().catch(err => {
  console.error("[bot] ❌ Fatal error:", err);
  process.exit(1);
});
