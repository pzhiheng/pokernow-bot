import { Page } from "playwright";
import { GameState, PlayerState, Card } from "./types";

// Update these selectors after running `npm run dump` and inspecting pokernow-dom-dump.html
const SEL = {
  holeCards: ".player-cards .card-container",
  communityCards: ".community-cards .card-container",
  pot: ".pot-value",
  toCall: ".call-button .call-value",
  myStack: ".my-player .stack-value",
  playerSeats: ".table-player",
  playerStack: ".stack-value",
  playerLastAction: ".action-text",
  actionHistory: ".game-log-entry",
  foldBtn: ".fold-button",
  checkBtn: ".check-button",
  callBtn: ".call-button",
  raiseBtn: ".raise-button",
  raiseInput: ".raise-input",
  isMyTurn: ".action-buttons:not(.hidden)",
  handNumber: ".hand-number",
  street: ".street-indicator",
};

function parseCard(el: Element): Card {
  const rank = el.querySelector(".rank")?.textContent?.trim() ?? "";
  const suit = el.querySelector(".suit")?.textContent?.trim() ?? "";
  const suitMap: Record<string, string> = { "♠": "s", "♥": "h", "♦": "d", "♣": "c" };
  return `${rank}${suitMap[suit] ?? suit}`;
}

function parseAmount(text: string | null | undefined): number {
  if (!text) return 0;
  return parseFloat(text.replace(/[^0-9.]/g, "")) || 0;
}

export async function scrapeGameState(page: Page, handNumber: number, playerReads: any): Promise<GameState | null> {
  try {
    const holeCardEls = await page.$$(SEL.holeCards);
    if (holeCardEls.length < 2) return null; // hand not started

    const holeCards = (await Promise.all(holeCardEls.map(el => el.evaluate(parseCard)))) as [Card, Card];

    const communityEls = await page.$$(SEL.communityCards);
    const community = await Promise.all(communityEls.map(el => el.evaluate(parseCard)));

    const potText = await page.$eval(SEL.pot, el => el.textContent).catch(() => "0");
    const callText = await page.$eval(SEL.toCall, el => el.textContent).catch(() => "0");
    const myStackText = await page.$eval(SEL.myStack, el => el.textContent).catch(() => "0");

    const playerEls = await page.$$(SEL.playerSeats);
    const players: PlayerState[] = await Promise.all(
      playerEls.map(async (el, i) => {
        const stackText = await el.$eval(SEL.playerStack, n => n.textContent).catch(() => "0");
        const actionText = await el.$eval(SEL.playerLastAction, n => n.textContent).catch(() => null);
        const isActive = !(await el.evaluate(n => n.classList.contains("fold")));
        return {
          seat: i + 1,
          stack: parseAmount(stackText),
          last_action: actionText?.trim() ?? null,
          is_active: isActive,
        };
      })
    );

    const logEls = await page.$$(SEL.actionHistory);
    const actionHistory = (
      await Promise.all(logEls.slice(-10).map(el => el.evaluate(n => n.textContent?.trim() ?? "")))
    ).filter(Boolean);

    const streetText = await page.$eval(SEL.street, el => el.textContent?.trim().toLowerCase()).catch(() => "preflop");
    const street = (["preflop", "flop", "turn", "river"].includes(streetText ?? "")
      ? streetText
      : "preflop") as GameState["street"];

    return {
      hand: handNumber,
      street,
      position: "BTN", // TODO: detect position from DOM
      hole_cards: holeCards,
      community,
      pot: parseAmount(potText),
      to_call: parseAmount(callText),
      my_stack: parseAmount(myStackText),
      players,
      action_history_this_hand: actionHistory,
      player_reads: playerReads,
    };
  } catch (err) {
    console.error("Scrape error:", err);
    return null;
  }
}

export async function isMyTurn(page: Page): Promise<boolean> {
  const btn = await page.$(SEL.isMyTurn);
  return btn !== null;
}

export async function dumpDom(page: Page): Promise<string> {
  return page.content();
}
