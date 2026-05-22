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

ADJUST YOUR STRATEGY BASED ON num_players IN THE GAME STATE:
- 2 players (Heads-Up): Play extremely wide (top 70%+ of hands). Raise almost any two cards on BTN/SB. Defend BB very wide. Bluff frequently.
- 3 players: Play wide. Open 50%+ from BTN. Steal aggressively. 3-bet light.
- 4 players: Open 40%+ from BTN/CO. Tighter from early positions. Semi-aggressive.
- 5-6 players (6-max): Standard 6-max ranges. Open 25-35% from BTN, 18-22% from CO, 12-15% from UTG. 3-bet value+blends.
- 7+ players (Full ring): Tightest ranges. Open 18-22% BTN, 14% CO, 10% UTG. Only 3-bet strong value hands from early position.

Core GTO principles:
- Balance value bets with bluffs at correct frequencies for each street
- Always use position — play wider IP, tighter OOP
- Size bets based on board texture: 33% on dry boards, 66% on wet boards, pot on very wet/multi-way
- Make pot-odds-correct decisions on draws
- Mix raises and calls with strong hands to stay balanced

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
