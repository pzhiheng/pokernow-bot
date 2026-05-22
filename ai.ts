import Anthropic from "@anthropic-ai/sdk";
import { GameState, BotAction, PlayerReads } from "./types";

const client = new Anthropic();

const STRATEGY = process.env.STRATEGY ?? "Play GTO (Game Theory Optimal) poker.";

export async function decideAction(state: GameState): Promise<BotAction> {
  const available = state.available_actions;

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 512,
    system: `You are a GTO (Game Theory Optimal) No-Limit Texas Hold'em poker player.

Play a balanced, unexploitable strategy: mix value bets and bluffs at correct frequencies, use position, apply correct preflop ranges, size bets appropriately, and make pot-odds-correct decisions.

Respond ONLY with a valid JSON object: {"action": "fold"|"check"|"call"|"raise", "amount": <chips if raise>, "reasoning": "<one line>"}

Hard rules:
- ONLY pick from available_actions
- NEVER fold when "check" is available
- amount only when raising`,
    messages: [
      {
        role: "user",
        content: `Game state:\n${JSON.stringify(state, null, 2)}\n\nAvailable actions: [${available.join(", ")}]\n\nWhat is your action? Think briefly about hand strength, position, and pot odds, then respond with JSON only.`,
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
