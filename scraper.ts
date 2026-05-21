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
  raiseConfirm: ".action-buttons button.raise",             // same button confirms
  communityCardContainer: ".table-cards.run-1",             // count children for street
};

function parseCard(el: Element): Card {
  // PokerNow structure: <span class="value">5</span><span class="suit sub-suit">d</span><span class="suit">d</span>
  const rank = el.querySelector(".value")?.textContent?.trim() ?? "";
  // pick the last .suit (not .sub-suit) for the suit letter
  const suits = el.querySelectorAll(".suit:not(.sub-suit)");
  const suit = suits[suits.length - 1]?.textContent?.trim() ?? "";
  return `${rank}${suit}`; // e.g. "5d", "Ts", "Ah"
}

function parseAmount(text: string | null | undefined): number {
  if (!text) return 0;
  return parseFloat(text.replace(/[^0-9.]/g, "")) || 0;
}

export async function scrapeGameState(page: Page, handNumber: number, playerReads: any): Promise<GameState | null> {
  try {
    // Hole cards — only visible on your seat (.you-player)
    const holeCardEls = await page.$$(SEL.holeCards);
    if (holeCardEls.length < 2) return null; // hand not started or cards not dealt yet

    const holeCards = (await Promise.all(holeCardEls.map(el => el.evaluate(parseCard)))) as [Card, Card];

    // Community cards
    const communityEls = await page.$$(SEL.communityCards);
    const community = await Promise.all(communityEls.map(el => el.evaluate(parseCard)));

    // Street from community card count
    const streetMap: Record<number, GameState["street"]> = { 0: "preflop", 3: "flop", 4: "turn", 5: "river" };
    const street = streetMap[community.length] ?? "preflop";

    // Pot
    const potText = await page.$eval(SEL.pot, el => el.textContent).catch(() => "0");
    const potTotalText = await page.$eval(SEL.potTotal, el => el.textContent).catch(() => null);

    // My stack and current bet
    const myStackText = await page.$eval(SEL.myStack, el => el.textContent).catch(() => "0");
    const myBetText = await page.$eval(SEL.myBet, el => el.textContent).catch(() => "0");

    // Call amount — read from call button text e.g. "Call 10"
    const callBtnText = await page.$eval(SEL.callBtn, el => el.textContent).catch(() => "0");
    const toCall = parseAmount(callBtnText.replace(/call/i, "").trim());

    // All players
    const playerEls = await page.$$(SEL.playerSeats);
    const players: PlayerState[] = (await Promise.all(
      playerEls.map(async (el, i) => {
        const stackText = await el.$eval(SEL.playerStack, n => n.textContent).catch(() => null);
        if (!stackText) return null; // empty seat
        const betText = await el.$eval(SEL.playerBet, n => n.textContent).catch(() => "0");
        const isActive = !(await el.evaluate(n => n.classList.contains("fold-player")));
        const name = await el.$eval(SEL.playerName, n => n.textContent?.trim() ?? "").catch(() => "");
        return {
          seat: i + 1,
          stack: parseAmount(stackText),
          last_action: betText ? `bet ${parseAmount(betText)}` : null,
          is_active: isActive,
        } as PlayerState;
      })
    )).filter(Boolean) as PlayerState[];

    // Position — detect from dealer button position relative to you-player seat
    const position = await page.evaluate(() => {
      const you = document.querySelector(".you-player");
      const dealer = document.querySelector(".dealer-button-ctn");
      if (!you || !dealer) return "unknown";
      // rough position from class names
      const youClass = [...you.classList].find(c => c.startsWith("table-player-") && /\d/.test(c));
      const dealerClass = [...dealer.classList].find(c => c.startsWith("dealer-position-"));
      return `seat-${youClass?.replace("table-player-", "") ?? "?"} dealer-${dealerClass?.replace("dealer-position-", "") ?? "?"}`;
    }).catch(() => "unknown");

    return {
      hand: handNumber,
      street,
      position,
      hole_cards: holeCards,
      community,
      pot: parseAmount(potTotalText ?? potText),
      to_call: toCall,
      my_stack: parseAmount(myStackText),
      players,
      action_history_this_hand: [],
      player_reads: playerReads,
    };
  } catch (err) {
    console.error("Scrape error:", err);
    return null;
  }
}

export async function isMyTurn(page: Page): Promise<boolean> {
  // "Your Turn" signal appears in .action-signal when it's your move
  const signal = await page.$(SEL.isMyTurn);
  if (!signal) return false;
  const text = await signal.textContent();
  return text?.toLowerCase().includes("your turn") ?? false;
}

export async function dumpDom(page: Page): Promise<string> {
  return page.content();
}
