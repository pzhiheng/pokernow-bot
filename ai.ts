import Anthropic from "@anthropic-ai/sdk";
import { GameState, BotAction, PlayerReads } from "./types";

const client = new Anthropic();

const STRATEGY = process.env.STRATEGY ?? "Play tight-aggressive. Fold weak hands, raise strong hands for value, and occasionally bluff on good boards. Fold to heavy aggression without a strong hand.";

export async function decideAction(state: GameState): Promise<BotAction> {
  const available = state.available_actions;

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 256,
    system: `You are a poker AI playing No-Limit Texas Hold'em on PokerNow.

Strategy: ${STRATEGY}

You will receive the current game state as JSON. Respond ONLY with a valid JSON object:
{"action": "fold"|"check"|"call"|"raise", "amount": <number if raise>, "reasoning": "<one line>"}

CRITICAL RULES — follow these exactly:
- You MUST only choose an action from the "available_actions" list in the game state
- If "check" is available and to_call is 0, NEVER fold — check instead (it's free)
- If "check" is not available but "call" is, you must decide between call, raise, or fold
- Only include "amount" when action is "raise"
- Raise amount must be at least 2x the to_call amount
- position "BB" = big blind, "SB" = small blind, "BTN" = dealer/button`,
    messages: [
      {
        role: "user",
        content: `Current game state:\n${JSON.stringify(state, null, 2)}\n\nAvailable actions: [${available.join(", ")}]\n\nWhat is your action?`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  try {
    const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as BotAction;

    // Safety guard: if Claude picks an unavailable action, fallback to safest available
    if (available.length > 0 && !available.includes(parsed.action)) {
      console.warn(`[ai] ⚠ Claude chose "${parsed.action}" but it's not available: [${available.join(", ")}] — using check/call fallback`);
      parsed.action = available.includes("check") ? "check" : available.includes("call") ? "call" : "fold";
      parsed.reasoning = `(forced fallback: original action unavailable)`;
    }

    return parsed;
  } catch {
    console.error("[ai] Failed to parse AI response:", text);
    const fallback = available.includes("check") ? "check" : available.includes("call") ? "call" : "fold";
    return { action: fallback, reasoning: "parse error fallback" };
  }
}

export async function updatePlayerReads(
  existing: PlayerReads,
  handSummary: string
): Promise<PlayerReads> {
  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 512,
    system: `You are analyzing a poker hand to update player tendency notes.
Given existing reads and a hand summary, return an updated JSON object of player reads.
Format: {"seat_N": {"seat": N, "hands_observed": <int>, "vpip": <0-100>, "pfr": <0-100>, "tendencies": "<short string>"}}
Only include seats that appeared in the hand. Merge with existing data.`,
    messages: [
      {
        role: "user",
        content: `Existing reads:\n${JSON.stringify(existing, null, 2)}\n\nHand summary:\n${handSummary}\n\nReturn updated reads JSON:`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  try {
    const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    return { ...existing, ...parsed };
  } catch {
    return existing;
  }
}
