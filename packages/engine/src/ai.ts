import {
  claimTruthProbability,
  rankRemainingFor,
  unseenTotalFor,
} from './knowledge';
import { MAX_PLAY } from './reducer';
import { JOKER_RANK, type Card, type Command, type GameState, type Rank } from './types';

/**
 * 机器人：只用「公开信息 + 自己的手牌」做决策，不偷看别人的牌。
 * 真实联机时这段跑在服务端，输入与 project() 等价。
 */
export interface AiOptions {
  random?: () => number;
  /** 特定局面的选择倾向；省略时沿用基础性格。 */
  tactic?: 'reserveTruth' | 'doubtTriple';
  /** 0 = 从不质疑，1 = 见牌就质疑（「多疑」） */
  aggression?: number;
  /** 0 = 有真牌必出真牌，1 = 有真牌也倾向撒谎（「狡诈」） */
  lieBias?: number;
}

/* ------------------------------------------------------------------ */
/* 质疑：概率推理                                                      */
/* ------------------------------------------------------------------ */

export interface ChallengeInput {
  /** 该点数还没被定位的张数（自己手上 + 已公开之外的部分） */
  remainingRank: number;
  /** 全场未知牌总数 */
  unseenTotal: number;
  /** 对手声明的张数 */
  claimCount: number;
  /** 对手前科（被抓到撒谎的次数） */
  history: number;
  /** 0..1，越大越敢抓 */
  aggression: number;
  /** 对手刚刚打空了手牌：这是抓他的最后机会，阈值要放低 */
  lastChance: boolean;
  random: () => number;
}

/**
 * 该不该抓这一手。返回 true 表示质疑。
 *
 * 三层判断，从硬到软：
 *   1. 数学上不可能（声明张数 > 该点数剩余张数）→ 无条件抓，不看随机数；
 *   2. 几何先验 + 前科修正 → 得到「他说真话的概率」；
 *   3. 敢不敢抓由 aggression（多疑/胆量）与最后机会加成决定。
 */
export function shouldChallenge(input: ChallengeInput): boolean {
  if (input.claimCount <= 0) return false;
  // 硬规则：就算全场所有剩余该点数都塞给他，也凑不出声明张数
  if (input.claimCount > input.remainingRank) return true;

  const truth = claimTruthProbability({
    claimCount: input.claimCount,
    remainingRank: input.remainingRank,
    unseenTotal: input.unseenTotal,
    history: input.history,
  });
  let chance = (1 - truth) * 0.55 * Math.max(0, input.aggression);
  chance *= 1 + Math.min(Math.max(0, input.history), 3) * 0.25;
  if (input.lastChance) chance *= 1.4;
  return input.random() < Math.min(0.95, chance);
}

/* ------------------------------------------------------------------ */
/* 出牌：张数策略                                                      */
/* ------------------------------------------------------------------ */

export interface PlayCountInput {
  handSize: number;
  /** 手上能当真的张数（目标点数 + 赖子） */
  truthful: number;
  /** 0..1：胆量/狡诈，越高越敢一次出多张、越敢一把清空 */
  aggression: number;
  random: () => number;
}

/**
 * 出几张（1..min(MAX_PLAY, handSize)，手牌为空时返回 0）。
 *
 * 博弈逻辑：
 *   1. 整手都能当真牌打 → 一把出满。出完手牌立刻进入「赢这一轮」的状态，
 *      下家只有「抓」和「放」两条路，而抓是必输的 —— 这是稳赢线。
 *   2. 只剩 ≤3 张且手里有真牌 → 高概率赌一把清空（把「赢这一轮」摆到台面上）。
 *   3. 手里还多牌：真牌 ≥2 时出 2 张施压（加速出完，也让对手更难算牌）。
 *   4. 只能撒谎 → 默认 1 张（多张撒谎被抓的代价太高），偶尔虚张声势。
 */
export function choosePlayCount(input: PlayCountInput): number {
  const handSize = Math.max(0, Math.floor(input.handSize));
  if (handSize === 0) return 0;
  const cap = Math.min(MAX_PLAY, handSize);
  const truthful = Math.max(0, Math.min(handSize, Math.floor(input.truthful)));
  const aggression = Math.max(0, Math.min(1, input.aggression));

  // 1) 全真：一把清空，没有比这更稳的赢面
  if (truthful >= handSize) return cap;

  // 2) 快出完了：清空手牌的收益（直接进入赢这一轮）值得冒一次险
  if (handSize <= cap) {
    const bold = 0.25 + 0.5 * aggression;
    if (input.random() < bold) return cap;
    return Math.max(1, Math.min(truthful, cap));
  }

  // 3) 真牌够多 → 两张一起出，施压并压缩对手的算牌空间
  if (truthful >= 2 && input.random() < 0.3 + 0.35 * aggression) return 2;

  // 4) 偶尔用多张虚张声势（手牌多的时候才有本钱）
  if (truthful === 0 && handSize >= 4 && input.random() < 0.1) return 2;

  return 1;
}

/* ------------------------------------------------------------------ */
/* 选牌：先花真牌，赖子留后手                                          */
/* ------------------------------------------------------------------ */

const RANK_ORDER = 'A2345678910JQK';

/** 等价牌之间保持稳定顺序：只为了让 AI 的行为可复现（同一 seed 同一决策） */
function byRank(a: Card, b: Card): number {
  return RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank) || (a.id < b.id ? -1 : 1);
}

/**
 * 挑 count 张牌。
 * truthfulFirst = 走真牌路线：真目标点数优先，赖子垫后（它是「随便当什么点数都算真」
 * 的保险，留着它后面几手都还有一条退路）。
 * truthfulFirst = false 走诈牌路线：先丢假牌，假牌不够才动用真牌/赖子。
 */
export function pickCards(hand: Card[], target: Rank, count: number, truthfulFirst: boolean): Card[] {
  const real = hand.filter((c) => c.rank === target);
  const jokers = hand.filter((c) => c.rank === JOKER_RANK);
  const lies = [...hand.filter((c) => c.rank !== target && c.rank !== JOKER_RANK)].sort(byRank);
  const pick: Card[] = [];
  const primary = truthfulFirst ? [...real, ...jokers] : lies;
  for (const c of primary) {
    if (pick.length >= count) break;
    pick.push(c);
  }
  if (pick.length < count) {
    // 真牌不够时才撒谎；诈牌路线则是假牌不够才动真牌
    const secondary = truthfulFirst ? lies : [...real, ...jokers];
    for (const c of secondary) {
      if (pick.length >= count) break;
      if (!pick.includes(c)) pick.push(c);
    }
  }
  return pick;
}

/* ------------------------------------------------------------------ */
/* 主入口                                                              */
/* ------------------------------------------------------------------ */

export function chooseAction(state: GameState, seat: number, options: AiOptions = {}): Command {
  const random = options.random ?? Math.random;
  const baseAggression = options.aggression ?? 0.5;
  const baseLieBias = options.lieBias ?? 0.12;

  // ── 情绪记忆：AI 会记住自己被抓过几次，也会记住自己抓对过几次 ──
  //   被抓多了 → 缩起来（少撒谎、少冒进）
  //   抓对多了 → 更有底气（更敢质疑）
  const myCaught = state.liesBySeat[seat] ?? 0;
  const shrink = Math.max(0.35, 1 - myCaught * 0.22); // 最低降到 35%
  const confidence = 1 + Math.min(state.correctChallenges[seat] ?? 0, 3) * 0.15;
  const lieBias = baseLieBias * shrink;
  const aggression = Math.min(0.95, baseAggression * confidence);
  const me = state.players[seat];
  const target = state.targetRank;

  if (!me || !me.alive || !target || state.turnSeat !== seat) {
    return { t: 'PLAY', seat, cardIds: [] }; // 不该发生；调用方应校验 legalActions
  }

  const pending = state.pendingPlay;
  const canChallenge = !!pending && pending.seat !== seat;

  // 手里没牌：只剩「抓」和「过」两条法律通路，别出空牌把自己卡死
  if (me.hand.length === 0) {
    return canChallenge ? { t: 'CHALLENGE', seat } : { t: 'PASS', seat };
  }

  if (pending && canChallenge) {
    // 对手刚打空手牌：这是最后一次抓他的机会（他不被抓住就赢下这一轮）
    const lastChance = state.roundWinnerSeat === pending.seat;
    if (
      shouldChallenge({
        remainingRank: rankRemainingFor(state, target, me.hand),
        unseenTotal: unseenTotalFor(state, me.hand),
        claimCount: pending.claimCount,
        history: state.liesBySeat[pending.seat] ?? 0,
        // 乌鸦对三张声明特别敏感；只读取公开张数，不读取扣牌内容。
        aggression: options.tactic === 'doubtTriple' && pending.claimCount === 3
          ? Math.min(1, aggression + 0.32)
          : aggression,
        lastChance,
        random,
      })
    ) {
      return { t: 'CHALLENGE', seat };
    }
  }

  // 出牌：有真牌就出真牌（偶尔诈一次），没真牌必须撒谎
  // 赖子可以当 Table 牌，算真牌
  const truthful = me.hand.filter((c) => c.rank === target || c.rank === JOKER_RANK);
  // 狐狸的一真一假残局：想诈时只丢假牌，把真牌（含赖子）留到下一手。
  const reserveTruth = options.tactic === 'reserveTruth' && me.hand.length === 2 && truthful.length === 1;
  const bluffOnly = truthful.length === 0 || random() <= (reserveTruth ? Math.min(0.9, lieBias * 1.45) : lieBias);
  const handSize = me.hand.length;
  const count = reserveTruth && bluffOnly ? 1 : choosePlayCount({
    handSize,
    truthful: bluffOnly ? 0 : truthful.length,
    aggression: bluffOnly ? aggression * 0.6 : aggression,
    random,
  });
  const picked = pickCards(me.hand, target, Math.max(1, Math.min(count, handSize)), !bluffOnly);
  if (picked.length > 0) return { t: 'PLAY', seat, cardIds: picked.map((c) => c.id) };

  const fallback = me.hand[0];
  return fallback ? { t: 'PLAY', seat, cardIds: [fallback.id] } : { t: 'PASS', seat };
}
