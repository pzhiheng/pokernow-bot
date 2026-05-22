import Anthropic from "@anthropic-ai/sdk";
import { GameState, BotAction, PlayerReads } from "./types";

const client = new Anthropic();

const STRATEGY = process.env.STRATEGY ?? "Play tight-aggressive. Fold weak hands, raise strong hands for value, and occasionally bluff on good boards. Fold to heavy aggression without a strong hand.";

export async function decideAction(state: GameState): Promise<BotAction> {
  const available = state.available_actions;

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 512,
    system: `You are an experienced No-Limit Texas Hold'em poker player. Play smart, aggressive, winning poker.

OVERALL STYLE: ${STRATEGY}

PREFLOP HAND STRENGTH (use this to guide decisions):
- Premium (raise/re-raise always): AA, KK, QQ, JJ, AKs, AKo
- Strong (raise for value): TT, 99, AQs, AQo, AJs, KQs
- Playable (raise from position, call from BB): 88-22, ATo+, KJs+, QJs, JTs, T9s
- Weak (fold unless BB check): everything else — offsuit connectors, low cards, 7-2 type hands

POSITION RULES:
- BTN/CO (late position): raise wide (top 30% of hands), steal blinds aggressively
- SB: raise or fold, rarely just call
- BB: defend against single raises with any pair, suited connectors, broadway cards. Check weak hands, don't fold for free

POSTFLOP RULES:
- Bet/raise when you have top pair+, flush draw + overcards, or strong draws
- Check/call with middle pair, weak draws, pot odds permitting
- Fold to big bets with nothing or weak gutshots

POT ODDS — if to_call / (pot + to_call) < your equity, call or raise:
- Flush draw ~35% equity, open-ended straight draw ~32%, gutshot ~17%

SIZING:
- Open raise: 2.5x the big blind
- Continuation bet: 50-66% of pot
- Value raise: 3x opponent's bet

RULES — follow exactly:
- ONLY choose from available_actions list
- NEVER fold when "check" is available (it costs nothing)
- Include "amount" (in chips) only when action is "raise"
- Raise amount must be reasonable — at least 2x to_call, max your stack`,
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
