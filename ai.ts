import Anthropic from "@anthropic-ai/sdk";
import { GameState, BotAction, PlayerReads } from "./types";

const client = new Anthropic();

const STRATEGY = process.env.STRATEGY ?? "Play tight-aggressive. Fold weak hands, raise strong hands for value, and occasionally bluff on good boards. Fold to heavy aggression without a strong hand.";

export async function decideAction(state: GameState): Promise<BotAction> {
  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 256,
    system: `You are a poker AI playing No-Limit Texas Hold'em on PokerNow.

Strategy: ${STRATEGY}

You will receive the current game state as JSON. Respond ONLY with a valid JSON object:
{"action": "fold"|"check"|"call"|"raise", "amount": <number if raise>, "reasoning": "<one line>"}

Rules:
- Only include "amount" when action is "raise"
- Raise amounts should be in chips, minimum 2x the current bet
- Be decisive and match the strategy described`,
    messages: [
      {
        role: "user",
        content: `Current game state:\n${JSON.stringify(state, null, 2)}\n\nWhat is your action?`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  try {
    const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    return parsed as BotAction;
  } catch {
    console.error("Failed to parse AI response:", text);
    return { action: "fold", reasoning: "parse error fallback" };
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
