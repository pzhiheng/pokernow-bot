import "dotenv/config";
import { chromium } from "playwright";
import fs from "fs";
import { scrapeGameState, scrapeGameLog, isMyTurn, joinTable, dumpDom } from "./scraper";
import { decideAction, updatePlayerReads } from "./ai";
import { executeAction } from "./executor";
import { PlayerReads } from "./types";

const TABLE_URL = process.env.TABLE_URL ?? "";
const BOT_NAME  = process.env.BOT_NAME  ?? "PokerBot";
const STACK     = parseInt(process.env.STACK ?? "1000");
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

  if (process.argv.includes("--dump")) {
    console.log("[dump] launching headless browser...");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(TABLE_URL, { waitUntil: "networkidle" });
    fs.writeFileSync("pokernow-dom-dump.html", await dumpDom(page));
    console.log("✅ Saved pokernow-dom-dump.html");
    await browser.close();
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ Set ANTHROPIC_API_KEY in .env");
    process.exit(1);
  }

  console.log("🚀 Starting PokerNow bot...");
  console.log(`   Table:    ${TABLE_URL}`);
  console.log(`   Name:     ${BOT_NAME}`);
  console.log(`   Stack:    ${STACK}`);
  console.log(`   Poll:     ${POLL_MS}ms`);

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log("[bot] navigating to table...");
  await page.goto(TABLE_URL, { waitUntil: "networkidle" });
  console.log("[bot] ✅ page loaded");

  // Automatically sit down and request the intended stack
  await joinTable(page, BOT_NAME, STACK);
  console.log("[bot] polling every 1.5s...\n");

  let playerReads = loadReads();
  let handNumber = 0;
  let pollCount = 0;

  // --- Hand tracking ---
  let lastHoleCards = "";        // detect new hand when hole cards change
  let handActionLog: string[] = []; // all observed actions this hand

  // --- Game log dedup ---
  // We keep a count of log lines already processed so we only add new ones each poll
  let seenLogCount = 0;

  while (true) {
    await new Promise(r => setTimeout(r, POLL_MS));
    pollCount++;

    // Heartbeat every 30s
    if (pollCount % 20 === 0) {
      console.log(`[poll] ♥ alive — poll #${pollCount}, hand #${handNumber}, reads: ${Object.keys(playerReads).length} players`);
    }

    // --- Poll game log every tick (not just our turn) to capture ALL player actions ---
    const allLogLines = await scrapeGameLog(page);
    const newLines = allLogLines.slice(seenLogCount);
    if (newLines.length > 0) {
      seenLogCount = allLogLines.length;
      newLines.forEach(line => {
        handActionLog.push(line);
        console.log(`[log] ${line}`);
      });
    }

    // --- Only proceed with AI decision when it's our turn ---
    const myTurn = await isMyTurn(page);
    if (!myTurn) continue;

    console.log("\n[bot] ===== MY TURN =====");
    console.log("[bot] scraping game state...");
    const state = await scrapeGameState(page, handNumber, playerReads);

    if (!state) {
      console.log("[bot] ⚠ scrape returned null — cards not visible or hand not in progress");
      continue;
    }

    // --- Detect new hand by watching hole cards change ---
    const holeCardKey = state.hole_cards.join(",");
    if (holeCardKey !== lastHoleCards) {
      if (lastHoleCards !== "" && handActionLog.length > 0) {
        // Previous hand ended — update player reads from what we observed
        handNumber++;
        console.log(`\n[bot] 🃏 new hand detected (#${handNumber}) — updating player reads from ${handActionLog.length} actions...`);
        const handSummary = `Hand #${handNumber}, ${state.num_players} players at table\n${handActionLog.join("\n")}`;
        playerReads = await updatePlayerReads(playerReads, handSummary);
        saveReads(playerReads);
        console.log(`[bot] ✅ player reads updated (${Object.keys(playerReads).length} players tracked)`);
        if (Object.keys(playerReads).length > 0) {
          Object.entries(playerReads).forEach(([seat, read]) => {
            console.log(`[reads]   ${seat}: ${(read as any).tendencies}`);
          });
        }
        handActionLog = [];
        seenLogCount = 0; // reset log tracking for new hand
      } else if (lastHoleCards === "") {
        handNumber = 1;
      }
      lastHoleCards = holeCardKey;
    }

    // Inject the rolling action log into the state (last 20 lines to cap tokens)
    state.action_history_this_hand = handActionLog.slice(-20);
    state.hand = handNumber;

    console.log(`[bot] hand #${handNumber} | ${state.street} | hole=[${state.hole_cards.join(",")}] board=[${state.community.join(",") || "none"}] pot=${state.pot} to_call=${state.to_call} stack=${state.my_stack} pos=${state.position}`);
    console.log(`[bot] action history (${state.action_history_this_hand.length} lines): ${state.action_history_this_hand.slice(-3).join(" | ") || "none yet"}`);
    console.log("[bot] asking Claude for decision...");

    const action = await decideAction(state);
    console.log(`[bot] Claude says: ${action.action}${action.amount ? ` ${action.amount}` : ""} — "${action.reasoning}"`);

    await executeAction(page, action);

    // Wait for UI to update before polling again
    console.log("[bot] waiting 3s for UI to update...");
    await new Promise(r => setTimeout(r, 3000));
    console.log("[bot] =====================\n");
  }
}

main().catch(err => {
  console.error("[bot] ❌ Fatal error:", err);
  process.exit(1);
});
