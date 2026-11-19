import { createDeck, DECK_SIZE } from './cards';
import { Rng } from './rng';
import {
  RANKS,
  type Card,
  type Command,
  type CommandResult,
  type GameEvent,
  type GameState,
  type LogEntry,
  type LogKind,
  type Player,
  type Rank,
  TABLE_RANKS,
  type TableRank,
  JOKER_RANK,
} from './types';

export const HAND_SIZE = 5;
export const CHAMBERS = 6;
export const MIN_PLAY = 1;
export const MAX_PLAY = 3;
/** 20 张牌只够 4 人各 5 张：多一个座位就有人的手牌发不满 */
export const MAX_SEATS = Math.floor(DECK_SIZE / HAND_SIZE);
export const MIN_SEATS = 2;

export interface CreateOptions {
  names: string[];
  seed?: number;
  botSeats?: number[];
}

/* ------------------------------------------------------------------ */
/* 内部工具                                                            */
/* ------------------------------------------------------------------ */

function log(state: GameState, kind: LogKind, text: string, extra?: Partial<LogEntry>): void {
  state.seq += 1;
  state.log.push({ seq: state.seq, round: state.round, kind, text, ...extra });
}

function alivePlayers(state: GameState): Player[] {
  return state.players.filter((p) => p.alive);
}

function nextAliveSeat(state: GameState, from: number): number {
  const n = state.players.length;
  for (let i = 1; i <= n; i += 1) {
    const seat = (from + i) % n;
    if (state.players[seat]?.alive) return seat;
  }
  return from;
}

function draw(state: GameState, rng: Rng): Card | null {
  if (state.deck.length === 0) {
    if (state.discard.length === 0) return null;
    state.deck = rng.shuffle(state.discard);
    state.discard = [];
  }
  return state.deck.pop() ?? null;
}

function startRound(state: GameState, events: GameEvent[]): void {
  const rng = new Rng(state.rng);

  // 回收手牌与桌面残牌，牌堆不够时用弃牌堆重洗
  for (const p of state.players) {
    state.discard.push(...p.hand);
    p.hand = [];
  }
  if (state.pendingPlay) {
    state.discard.push(...state.pendingPlay.cards);
    state.pendingPlay = null;
  }
  // 注意：桌面牌现在是虚拟牌（id 形如 TABLE_K），本身不在牌堆里，
  // 回收它等于每轮凭空造一张牌 —— 所以这里不能 push。
  state.tableCard = null;

  state.round += 1;
  state.phase = 'turn';
  state.lastReveal = null;
  // 新一轮：上一轮的「打完手牌的人」标记必须清掉，否则会一直卡在赢家状态
  state.roundWinnerSeat = null;
  // 公开信息只对本轮有效：翻开的牌进弃牌堆后就不再是「已知剩几张」的依据
  state.publicCards = [];

  const alive = alivePlayers(state);

  // 牌堆不够这一轮用的（每人 5 张）就先重洗：
  // 牌全在弃牌堆时（deck 空）也必须重洗，否则这一轮一张都发不出来。
  const needed = alive.length * HAND_SIZE;
  if (state.deck.length < needed && state.discard.length > 0) {
    state.deck = rng.shuffle([...state.deck, ...state.discard]);
    state.discard = [];
  }

  // 发牌张数 = min(每人 5 张, 总数 ÷ 人数)：
  // 牌确实不够时全场一起少发，而不是「先轮到的座位发满、后面的座位饿着」，
  // 这样任何异常回收都不会让某个座位一开局就没牌。
  const available = state.deck.length + state.discard.length;
  const handSize = Math.min(
    HAND_SIZE,
    Math.max(0, Math.floor(available / Math.max(1, alive.length))),
  );
  if (handSize < HAND_SIZE) {
    log(state, 'deal', `这一轮牌不够，每人只发 ${handSize} 张`);
  }

  // 官方算法：牌堆 20 张全部发完（4 人 × 5），Table 牌是另外指定的，
  // 不从牌堆里抽 —— 所以这里只挑点数，不消耗牌。
  const tableRank = TABLE_RANKS[rng.int(TABLE_RANKS.length)] as TableRank;
  const tableSuits = ['S', 'H', 'D', 'C'] as const;
  state.tableCard = {
    id: `TABLE_${tableRank}`,
    rank: tableRank,
    suit: tableSuits[rng.int(tableSuits.length)] as (typeof tableSuits)[number],
  };
  state.targetRank = tableRank;

  for (const p of alive) {
    for (let i = 0; i < handSize; i += 1) {
      const card = draw(state, rng);
      if (card) p.hand.push(card);
    }
    events.push({ t: 'DEALT', seat: p.seat, count: p.hand.length });
  }

  const starter = alive[(state.round - 1) % alive.length] as Player;
  state.turnSeat = starter.seat;
  state.rng = rng.state;

  log(state, 'round', `第 ${state.round} 轮开始 · 目标点数 ${state.targetRank}`);
  events.push({
    t: 'ROUND_START',
    round: state.round,
    targetRank: state.targetRank,
    turnSeat: state.turnSeat,
  });
}

/* ------------------------------------------------------------------ */
/* 建局                                                                */
/* ------------------------------------------------------------------ */

export function createGame(options: CreateOptions): GameState {
  if (options.names.length < MIN_SEATS) {
    throw new Error(`NOT_ENOUGH_PLAYERS: 至少 ${MIN_SEATS} 人才能开桌`);
  }
  if (options.names.length > MAX_SEATS) {
    throw new Error(
      `TOO_MANY_PLAYERS: 牌堆 ${DECK_SIZE} 张、每人 ${HAND_SIZE} 张，最多 ${MAX_SEATS} 人`,
    );
  }
  const seed = (options.seed ?? Date.now()) >>> 0;
  const bots = new Set(options.botSeats ?? []);
  const players: Player[] = options.names.map((name, seat) => ({
    id: `p${seat}`,
    name,
    seat,
    hand: [],
    alive: true,
    isBot: bots.has(seat),
  }));

  const rng = new Rng(seed);
  const deck = rng.shuffle(createDeck());

  const state: GameState = {
    seed,
    rng: rng.state,
    round: 0,
    phase: 'turn',
    deck,
    discard: [],
    targetRank: null,
    tableCard: null,
    players,
    turnSeat: 0,
    pendingPlay: null,
    bullets: 1,
    lastReveal: null,
    winnerSeat: null,
    roundWinnerSeat: null,
    liesBySeat: [],
    correctChallenges: [],
    publicCards: [],
    log: [],
    seq: 0,
  };

  const events: GameEvent[] = [];
  startRound(state, events);
  return state;
}

/* ------------------------------------------------------------------ */
/* 命令归约：唯一的状态变更入口                                          */
/* ------------------------------------------------------------------ */

export function applyCommand(previous: GameState, command: Command): CommandResult {
  const state: GameState = structuredClone(previous);
  const events: GameEvent[] = [];
  const fail = (error: string): CommandResult => ({ state: previous, events: [], error });

  if (state.phase === 'game_end' && command.t !== 'NEXT_ROUND') {
    return fail('GAME_OVER');
  }

  if (command.t === 'PLAY') {
    if (state.phase !== 'turn') return fail('BAD_PHASE');

    // 上一手有人打空了手牌：下家选择「出牌」而不是「质疑」，等于放过他 ——
    // 按官方规则，他赢下这一轮，本轮直接结束（路径 A）。
    // 这条通道同样要走回合校验，否则任何座位都能替别人结束一轮。
    if (state.roundWinnerSeat !== null) {
      const actor = state.players[command.seat];
      if (!actor || !actor.alive) return fail('NOT_A_PLAYER');
      if (state.turnSeat !== command.seat) return fail('NOT_YOUR_TURN');
      const winner = state.roundWinnerSeat;
      state.phase = 'round_end';
      // 桌上那手牌要回收，直接置空会凭空少几张
      if (state.pendingPlay) {
        state.discard.push(...state.pendingPlay.cards);
        state.pendingPlay = null;
      }
      log(
        state,
        'end',
        `${state.players[winner]?.name} 打完了手牌，没人质疑，赢下这一轮`,
        { seat: winner },
      );
      events.push({ t: 'ROUND_END', winnerSeat: winner });
      return { state, events };
    }
    const player = state.players[command.seat];
    if (!player || !player.alive) return fail('NOT_A_PLAYER');
    if (state.turnSeat !== command.seat) return fail('NOT_YOUR_TURN');

    const ids = command.cardIds ?? [];
    if (ids.length < MIN_PLAY || ids.length > MAX_PLAY) return fail('BAD_CARD_COUNT');
    if (new Set(ids).size !== ids.length) return fail('DUPLICATE_CARD');

    const cards: Card[] = [];
    for (const id of ids) {
      const index = player.hand.findIndex((c) => c.id === id);
      if (index < 0) return fail('CARD_NOT_IN_HAND');
      cards.push(player.hand[index] as Card);
    }
    for (const id of ids) {
      const index = player.hand.findIndex((c) => c.id === id);
      player.hand.splice(index, 1);
    }

    // 声明点数固定为本轮目标点数，不做自由声明（规则简化，见 README）
    const claim = state.targetRank as Rank;
    // 上一手没被质疑就被新手覆盖 —— 那些牌要进弃牌堆，
    // 否则每出一次牌就凭空少几张（牌堆会越打越薄）
    if (state.pendingPlay) {
      state.discard.push(...state.pendingPlay.cards);
    }
    state.pendingPlay = { seat: command.seat, cards, claimCount: cards.length };
    state.turnSeat = nextAliveSeat(state, command.seat);

    log(state, 'play', `${player.name} 打出 ${cards.length} 张，声明全是 ${claim}`, {
      seat: player.seat,
    });
    events.push({ t: 'PLAYED', seat: player.seat, count: cards.length, claim });

    // 官方规则：手牌出完的人成为本轮赢家（下家还能质疑，这里先标记出来，
    // 交给质疑逻辑处理；没人质疑就按赢家结算）
    if (player.hand.length === 0) {
      state.roundWinnerSeat = player.seat;
      log(state, 'end', `${player.name} 打完了手牌`, { seat: player.seat });
    }

    return { state, events };
  }

  if (command.t === 'PASS') {
    if (state.phase !== 'turn') return fail('BAD_PHASE');
    if (state.turnSeat !== command.seat) return fail('NOT_YOUR_TURN');
    const me = state.players[command.seat];
    if (!me?.alive) return fail('NOT_A_PLAYER');
    // 只有真的没法出牌、也没法质疑时才允许跳过
    if (me.hand.length > 0) return fail('HAS_CARDS');
    if (state.pendingPlay && state.pendingPlay.seat !== command.seat) return fail('CAN_CHALLENGE');

    const next = nextAliveSeat(state, command.seat);
    // 一圈下来没人能出牌 → 这轮作废，重新发牌
    const anyoneCanAct = state.players.some(
      (p) => p.alive && (p.hand.length > 0 || (state.pendingPlay && state.pendingPlay.seat !== p.seat)),
    );
    if (!anyoneCanAct) {
      state.phase = 'round_end';
      // 桌上那手没人结算的牌必须回收：直接置空等于凭空销毁几张牌
      if (state.pendingPlay) {
        state.discard.push(...state.pendingPlay.cards);
        state.pendingPlay = null;
      }
      state.roundWinnerSeat = null;
      log(state, 'end', '所有人都打空了手牌，这一轮作废');
      events.push({ t: 'ROUND_END', winnerSeat: null });
      return { state, events };
    }
    state.turnSeat = next;
    log(state, 'pass', `${me.name} 手里没牌，过`, { seat: command.seat });
    return { state, events };
  }

  if (command.t === 'CHALLENGE') {
    if (state.phase !== 'turn') return fail('BAD_PHASE');
    const pending = state.pendingPlay;
    if (!pending) return fail('NOTHING_TO_CHALLENGE');
    if (state.turnSeat !== command.seat) return fail('NOT_YOUR_TURN');
    if (pending.seat === command.seat) return fail('SELF_CHALLENGE');

    const challenger = state.players[command.seat] as Player;
    const player = state.players[pending.seat] as Player;

    // 官方规则：赖子可以当作 Table 牌，所以有它就算说真话
    const truthful = pending.cards.every(
      (c) => c.rank === state.targetRank || c.rank === JOKER_RANK,
    );
    // 被抓到就累计「前科」，AI 之后会更愿意抓同一个人
    if (!truthful) {
      state.liesBySeat[pending.seat] = (state.liesBySeat[pending.seat] ?? 0) + 1;
      // 质疑者抓对了，信心 +1
      state.correctChallenges[command.seat] = (state.correctChallenges[command.seat] ?? 0) + 1;
    }
    const punishedSeat = truthful ? challenger.seat : player.seat;
    const punished = state.players[punishedSeat] as Player;

    state.discard.push(...pending.cards);
    // 翻开的牌是本轮唯一合法的「已见牌」，同时进弃牌堆参与重洗
    state.publicCards.push(...pending.cards);
    state.pendingPlay = null;

    log(state, 'challenge', `${challenger.name} 质疑 ${player.name}`, { seat: challenger.seat });
    events.push({ t: 'CHALLENGED', seat: challenger.seat, targetSeat: player.seat });
    events.push({
      t: 'REVEALED',
      playSeat: player.seat,
      challengerSeat: challenger.seat,
      cards: pending.cards,
      truthful,
    });
    log(
      state,
      'reveal',
      truthful ? `${player.name} 说的是真的` : `${player.name} 撒谎了`,
      { cards: pending.cards, seat: player.seat },
    );

    const rng = new Rng(state.rng);
    const chamber = rng.int(CHAMBERS);
    state.rng = rng.state;
    const bulletsBefore = state.bullets;
    const died = chamber < bulletsBefore;

    if (died) {
      punished.alive = false;
      state.discard.push(...punished.hand);
      punished.hand = [];
    } else {
      state.bullets = Math.min(CHAMBERS, state.bullets + 1);
    }

    state.lastReveal = {
      playSeat: player.seat,
      challengerSeat: challenger.seat,
      cards: pending.cards,
      truthful,
      punishedSeat,
      chamber,
      died,
      bullets: bulletsBefore,
    };

    log(
      state,
      'shot',
      died
        ? `${punished.name} 扣下扳机 —— 第 ${chamber + 1} 号弹仓有子弹，出局`
        : `${punished.name} 扣下扳机 —— 空枪，弹仓加到 ${state.bullets}/6`,
      { seat: punished.seat },
    );
    events.push({
      t: 'SHOT',
      seat: punished.seat,
      died,
      chamber,
      bullets: bulletsBefore,
    });

    if (died) {
      events.push({ t: 'ELIMINATED', seat: punished.seat });
      log(state, 'eliminate', `${punished.name} 被抬出酒馆`, { seat: punished.seat });
    }

    // 路径 B：质疑打空手牌的人。他说真话且活下来才算赢下这一轮；
    // 撒谎（或者真话却被一枪打死的情况不存在，受罚的是质疑者）就得把赢面交出去。
    if (state.roundWinnerSeat === pending.seat) {
      const finisherAlive = punishedSeat === pending.seat ? !died : true;
      if (truthful && finisherAlive) {
        log(state, 'end', `${player.name} 说的是真的，赢下这一轮`, { seat: player.seat });
      } else {
        state.roundWinnerSeat = null;
        log(
          state,
          'end',
          truthful ? `${player.name} 的手牌已经打完，但这一轮作废` : `${player.name} 撒谎被抓住，本轮赢面作废`,
          { seat: player.seat },
        );
      }
    }

    state.phase = 'round_end';
    const alive = alivePlayers(state);
    const winner = alive.length <= 1 ? (alive[0]?.seat ?? punished.seat) : null;
    if (winner !== null) {
      state.winnerSeat = winner;
      state.roundWinnerSeat = null;
      state.phase = 'game_end';
      log(state, 'end', `${state.players[winner]?.name} 是活到最后的人`, { seat: winner });
      events.push({ t: 'ROUND_END', winnerSeat: winner });
      events.push({ t: 'GAME_END', winnerSeat: winner });
    } else {
      events.push({ t: 'ROUND_END', winnerSeat: state.roundWinnerSeat });
    }
    return { state, events };
  }

  // NEXT_ROUND
  if (state.phase !== 'round_end') return fail('BAD_PHASE');
  if (alivePlayers(state).length <= 1) return fail('GAME_OVER');
  startRound(state, events);
  return { state, events };
}

/* ------------------------------------------------------------------ */
/* 只读查询                                                            */
/* ------------------------------------------------------------------ */

export function aliveCount(state: GameState): number {
  return alivePlayers(state).length;
}

/** 这个座位现在能做什么（UI 用，便于禁用按钮） */
export function legalActions(state: GameState, seat: number): {
  canPlay: boolean;
  canChallenge: boolean;
  canPass: boolean;
  /**
   * 桌上是「刚打空手牌的人」留下的牌：这是抓他的最后机会。
   * 不抓（选择出牌）等于放他赢下这一轮，UI 应该把这句话说出来。
   */
  lastChance: boolean;
} {
  if (state.phase !== 'turn' || state.turnSeat !== seat) {
    return { canPlay: false, canChallenge: false, canPass: false, lastChance: false };
  }
  const me = state.players[seat];
  if (!me?.alive) return { canPlay: false, canChallenge: false, canPass: false, lastChance: false };
  const canPlay = me.hand.length > 0;
  const canChallenge = !!state.pendingPlay && state.pendingPlay.seat !== seat;
  const lastChance = canChallenge && state.roundWinnerSeat === state.pendingPlay?.seat;
  return { canPlay, canChallenge, canPass: !canPlay && !canChallenge, lastChance };
}

/* ------------------------------------------------------------------ */
/* 局外统计（可选导出）：想让战绩跟着 reducer 走时从这里取               */
/* ------------------------------------------------------------------ */

export {
  aggregateStats,
  buildMatchRecord,
  extractMatchRecord,
  type AggregateStats,
  type MatchRecord,
} from './stats';
