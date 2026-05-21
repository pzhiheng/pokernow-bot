import { Page } from "playwright";
import { GameState, PlayerState, Card } from "./types";

// Selectors verified against live PokerNow DOM dump
const SEL = {
  holeCards: ".you-player .table-player-cards .card",       // your face-up cards
  communityCards: ".table-cards .card",                     // board cards
  pot: ".table-pot-size .main-value .normal-value",
  potTotal: ".table-pot-size .add-on .normal-value",        // total pot incl. side pots
  myStack: ".you-player .table-player-stack .normal-value",
  myBet: ".you-player .table-player-bet-value .normal-value",
  playerSeats: ".table-player",
  playerStack: ".table-player-stack .normal-value",
  playerBet: ".table-player-bet-value .normal-value",
  playerName: ".table-player-name span a",
  isMyTurn: ".action-signal",                               // "Your Turn" text
  callBtn: ".action-buttons button.call",
  raiseBtn: ".action-buttons button.raise",
  checkBtn: ".action-buttons button.check",
  foldBtn: ".action-buttons button.fold",
  raiseInput: ".action-buttons input",
  raiseConfirm: ".action-buttons button.raise",
  communityCardContainer: ".table-cards.run-1",
};

function parseCard(el: Element): Card {
  const rank = el.querySelector(".value")?.textContent?.trim() ?? "";
  const suits = el.querySelectorAll(".suit:not(.sub-suit)");
  const suit = suits[suits.length - 1]?.textContent?.trim() ?? "";
  return `${rank}${suit}`;
}

function parseAmount(text: string | null | undefined): number {
  if (!text) return 0;
  return parseFloat(text.replace(/[^0-9.]/g, "")) || 0;
}

export async function scrapeGameState(page: Page, handNumber: number, playerReads: any): Promise<GameState | null> {
  try {
    // --- Hole cards ---
    const holeCardEls = await page.$$(SEL.holeCards);
    console.log(`  [scrape] hole card elements found: ${holeCardEls.length}`);
    if (holeCardEls.length < 2) {
      console.log("  [scrape] < 2 hole cards — hand not started yet, skipping");
      return null;
    }
    const holeCards = (await Promise.all(holeCardEls.map(el => el.evaluate(parseCard)))) as [Card, Card];
    console.log(`  [scrape] hole cards: ${holeCards.join(", ")}`);

    // --- Community cards ---
    const communityEls = await page.$$(SEL.communityCards);
    const community = await Promise.all(communityEls.map(el => el.evaluate(parseCard)));
    const streetMap: Record<number, GameState["street"]> = { 0: "preflop", 3: "flop", 4: "turn", 5: "river" };
    const street = streetMap[community.length] ?? "preflop";
    console.log(`  [scrape] street: ${street} | board: [${community.join(", ") || "none"}]`);

    // --- Pot ---
    const potText = await page.$eval(SEL.pot, el => el.textContent).catch(() => "0");
    const potTotalText = await page.$eval(SEL.potTotal, el => el.textContent).catch(() => null);
    const pot = parseAmount(potTotalText ?? potText);
    console.log(`  [scrape] pot: ${pot} (main: ${potText}, total: ${potTotalText ?? "n/a"})`);

    // --- My stack ---
    const myStackText = await page.$eval(SEL.myStack, el => el.textContent).catch(() => "0");
    console.log(`  [scrape] my stack: ${myStackText}`);

    // --- Call amount from button text e.g. "Call 10" ---
    const callBtnText = await page.$eval(SEL.callBtn, el => el.textContent).catch(() => "");
    const toCall = parseAmount(callBtnText.replace(/call/i, "").trim());
    console.log(`  [scrape] call button text: "${callBtnText}" → to_call: ${toCall}`);

    // --- Visible action buttons ---
    const btns = await page.$$eval(".action-buttons button", els =>
      els.map(el => `${el.textContent?.trim()} [disabled=${el.hasAttribute("disabled")}]`)
    );
    console.log(`  [scrape] action buttons: ${btns.join(" | ")}`);

    // --- Players ---
    const playerEls = await page.$$(SEL.playerSeats);
    const players: PlayerState[] = (await Promise.all(
      playerEls.map(async (el, i) => {
        const stackText = await el.$eval(SEL.playerStack, n => n.textContent).catch(() => null);
        if (!stackText) return null; // empty seat
        const betText = await el.$eval(SEL.playerBet, n => n.textContent).catch(() => "0");
        const isActive = !(await el.evaluate(n => n.classList.contains("fold-player")));
        const name = await el.$eval(SEL.playerName, n => n.textContent?.trim() ?? "").catch(() => "");
        console.log(`  [scrape]   seat ${i + 1}: ${name || "?"} stack=${parseAmount(stackText)} bet=${parseAmount(betText)} active=${isActive}`);
        return {
          seat: i + 1,
          stack: parseAmount(stackText),
          last_action: betText ? `bet ${parseAmount(betText)}` : null,
          is_active: isActive,
        } as PlayerState;
      })
    )).filter(Boolean) as PlayerState[];

    // --- Position ---
    const position = await page.evaluate(() => {
      const you = document.querySelector(".you-player");
      const dealer = document.querySelector(".dealer-button-ctn");
      if (!you || !dealer) return "unknown";
      const youClass = [...you.classList].find(c => c.startsWith("table-player-") && /\d/.test(c));
      const dealerClass = [...dealer.classList].find(c => c.startsWith("dealer-position-"));
      return `seat-${youClass?.replace("table-player-", "") ?? "?"} dealer-${dealerClass?.replace("dealer-position-", "") ?? "?"}`;
    }).catch(() => "unknown");
    console.log(`  [scrape] position info: ${position}`);

    const state: GameState = {
      hand: handNumber,
      street,
      position,
      hole_cards: holeCards,
      community,
      pot,
      to_call: toCall,
      my_stack: parseAmount(myStackText),
      players,
      action_history_this_hand: [],
      player_reads: playerReads,
    };
    console.log(`  [scrape] ✅ state built successfully`);
    return state;

  } catch (err) {
    console.error("  [scrape] ❌ error:", err);
    return null;
  }
}

export async function isMyTurn(page: Page): Promise<boolean> {
  const signal = await page.$(SEL.isMyTurn);
  if (!signal) return false;
  const text = await signal.textContent();
  const result = text?.toLowerCase().includes("your turn") ?? false;
  if (result) console.log(`[poll] 🎯 detected "Your Turn" — action-signal text: "${text?.trim()}"`);
  return result;
}

export async function dumpDom(page: Page): Promise<string> {
  return page.content();
}
