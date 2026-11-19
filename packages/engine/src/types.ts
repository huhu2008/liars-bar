/** 牌面与对局的基础类型：单一事实源，前后端共用。 */

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export type Rank = (typeof RANKS)[number];

/**
 * 骗子酒馆只玩三张牌：Q / K / A。
 * 每轮的目标点数从这里抽一张，不是整副 13 个点数。
 */
export const TABLE_RANKS = ['Q', 'K', 'A'] as const;
export type TableRank = (typeof TABLE_RANKS)[number];

/** 王牌：翻牌时可以充当本轮目标点数。 */
export const JOKER_RANK = 'JOKER' as const;
export type JokerRank = typeof JOKER_RANK;

export const SUITS = ['S', 'H', 'D', 'C'] as const;
export type Suit = (typeof SUITS)[number];

export interface Card {
  id: string;
  rank: Rank | JokerRank;
  suit: Suit;
}

export interface Player {
  id: string;
  name: string;
  seat: number;
  hand: Card[];
  alive: boolean;
  isBot: boolean;
}

/** turn: 轮到自己行动；round_end: 本轮结算完（等下一轮）；game_end: 只剩一人 */
export type Phase = 'turn' | 'round_end' | 'game_end';

export type LogKind =
  | 'round'
  | 'deal'
  | 'play'
  | 'challenge'
  | 'reveal'
  | 'shot'
  | 'eliminate'
  | 'pass'
  | 'end';

export interface LogEntry {
  seq: number;
  round: number;
  kind: LogKind;
  text: string;
  seat?: number;
  cards?: Card[];
}

/** 桌面上待结算的一手牌：cards 只允许服务端与投影层看到 */
export interface PendingPlay {
  seat: number;
  cards: Card[];
  claimCount: number;
}

export interface LastReveal {
  playSeat: number;
  challengerSeat: number;
  cards: Card[];
  truthful: boolean;
  punishedSeat: number;
  chamber: number;
  died: boolean;
  bullets: number;
}

export interface GameState {
  seed: number;
  /** 随机数游标：写回状态，保证任何时刻可复现/可重放 */
  rng: number;
  round: number;
  phase: Phase;
  deck: Card[];
  discard: Card[];
  targetRank: TableRank | null;
  /** 每轮翻出的桌面牌：它的点数就是本轮目标点数（主流玩法） */
  tableCard: Card | null;
  players: Player[];
  turnSeat: number;
  pendingPlay: PendingPlay | null;
  /** 当前弹仓里几颗子弹（1..6），空枪后 +1 */
  bullets: number;
  lastReveal: LastReveal | null;
  winnerSeat: number | null;
  /** 本轮打完手牌的人（官方：除非下家质疑，否则他赢下这一轮） */
  roundWinnerSeat: number | null;
  /** 每家被抓到撒谎的次数：AI 靠它判断「这家伙有前科」 */
  liesBySeat: number[];
  /** 每家质疑成功的次数：抓对人会让 AI 更有底气 */
  correctChallenges: number[];
  /**
   * 本轮被翻牌揭开的牌（公开信息，每轮清空）。
   * 这是 AI 概率推理与 UI「已见牌」的唯一合法来源：
   * discard 里混着没人看见过的牌，不能拿来当已知信息。
   */
  publicCards: Card[];
  log: LogEntry[];
  seq: number;
}

export type Command =
  | { t: 'PLAY'; seat: number; cardIds: string[] }
  | { t: 'CHALLENGE'; seat: number }
  /** 手里没牌也没人可质疑时跳过自己（避免全场空手死锁） */
  | { t: 'PASS'; seat: number }
  | { t: 'NEXT_ROUND' };

export type GameEvent =
  | { t: 'ROUND_START'; round: number; targetRank: Rank; turnSeat: number }
  | { t: 'DEALT'; seat: number; count: number }
  | { t: 'PLAYED'; seat: number; count: number; claim: Rank }
  | { t: 'CHALLENGED'; seat: number; targetSeat: number }
  | { t: 'REVEALED'; playSeat: number; challengerSeat: number; cards: Card[]; truthful: boolean }
  | { t: 'SHOT'; seat: number; died: boolean; chamber: number; bullets: number }
  | { t: 'ELIMINATED'; seat: number }
  /**
   * winnerSeat 是本轮的赢家：打完手牌、并且没人抓到他撒谎的那个人。
   * 本轮作废（所有人空手）或赢家被质疑翻车时为 null。
   */
  | { t: 'ROUND_END'; winnerSeat: number | null }
  | { t: 'GAME_END'; winnerSeat: number };

export interface CommandResult {
  state: GameState;
  events: GameEvent[];
  error?: string;
}

/** 玩家视角：别人的手牌永远只以张数出现 */
export interface SeatView {
  seat: number;
  name: string;
  alive: boolean;
  cardCount: number;
  isBot: boolean;
}

export interface PlayerView {
  seat: number;
  round: number;
  phase: Phase;
  targetRank: TableRank | null;
  /** 每轮翻出的桌面牌：它的点数就是本轮目标点数（主流玩法） */
  tableCard: Card | null;
  me: { seat: number; name: string; hand: Card[]; alive: boolean };
  seats: SeatView[];
  turnSeat: number;
  bullets: number;
  deckCount: number;
  discardCount: number;
  /** 自己被抓到撒谎的次数（别人的前科是隐藏信息） */
  myLies: number;
  /** 本轮已经翻开的牌（公开信息）：UI 可以拿来算「这个点数还剩几张」 */
  publicCards: Card[];
  /**
   * 从这个座位看，目标点数还有几张可能藏在别人手里（0..6）。
   * 只手牌 + 已公开牌推算，不含任何隐藏信息。
   */
  rankRemaining: number;
  pendingPlay: { seat: number; count: number } | null;
  lastReveal: LastReveal | null;
  winnerSeat: number | null;
  /** 本轮打完手牌的人（官方：除非下家质疑，否则他赢下这一轮） */
  roundWinnerSeat: number | null;
  log: LogEntry[];
}
