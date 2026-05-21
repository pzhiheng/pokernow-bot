export type Card = string; // e.g. "Ah", "Kd", "2c"

export type ActionType = "fold" | "check" | "call" | "raise";

export interface BotAction {
  action: ActionType;
  amount?: number; // only for raise
  reasoning?: string;
}

export interface PlayerState {
  seat: number;
  stack: number;
  last_action: string | null;
  is_active: boolean;
}

export interface PlayerRead {
  seat: number;
  hands_observed: number;
  vpip: number; // % voluntarily put money in pot
  pfr: number;  // % preflop raise
  tendencies: string; // AI-generated short description
}

export interface PlayerReads {
  [seatKey: string]: PlayerRead;
}

export interface GameState {
  hand: number;
  street: "preflop" | "flop" | "turn" | "river";
  position: string; // "BTN", "SB", "BB", "UTG", "CO", "MP"
  hole_cards: [Card, Card];
  community: Card[];
  pot: number;
  to_call: number;
  my_stack: number;
  available_actions: ActionType[]; // exactly what buttons are clickable right now
  players: PlayerState[];
  action_history_this_hand: string[];
  player_reads: PlayerReads;
}

export interface HandResult {
  hand_number: number;
  won: boolean;
  profit: number;
  showdown: boolean;
  final_board: Card[];
  players_at_showdown: Array<{ seat: number; cards: Card[] }>;
}
