/**
 * 局外统计：把「一局」压成一条 MatchRecord，再把多条记录聚合成跨局战绩。
 *
 * 设计约束（与项目风格保持一致）：
 * - 纯函数：不读时钟、不读随机数、不写任何外部状态；
 * - 只读入参：不修改 GameState / records；
 * - 数据结构扁平，UI 拿来直接渲染，不做嵌套抽象；
 * - GameState 不新增字段：战绩靠外部累积（localStorage / 服务端都行）。
 */

import { JOKER_RANK, TABLE_RANKS, type GameState, type TableRank } from './types';

/* ------------------------------------------------------------------ */
/* 类型                                                                */
/* ------------------------------------------------------------------ */

/** 一局的摘要。所有字段都是「从 humanSeat 视角」看的。 */
export interface MatchRecord {
  /** 这局赢了没（活到最后的人就是 humanSeat） */
  won: boolean;
  /** 这局一共打了几轮（state.round） */
  rounds: number;
  /** 抓对几次：质疑成功、戳穿别人撒谎的次数 */
  correctChallenges: number;
  /** 被抓几次：自己撒谎被戳穿的次数 */
  timesCaught: number;
  /** 这局自己一共打出去多少张牌 */
  cardsPlayed: number;
  /**
   * 桌上被翻出是假牌的声称里，按「声明点数」统计的次数（不含自己被抓的那几手）。
   * 公开翻牌是全员可见信息，所以这个统计对 humanSeat 来说就是「我最常被骗的点数」。
   */
  liedRanks: Partial<Record<TableRank, number>>;
}

/** 跨局累计统计。空记录集时全部为 0 / null，不会出现 NaN。 */
export interface AggregateStats {
  /** 总场次 */
  matches: number;
  wins: number;
  losses: number;
  /** 胜率 0..1（matches 为 0 时是 0） */
  winRate: number;
  /** 最长连胜 */
  longestStreak: number;
  /** 当前连胜（连败中为 0） */
  currentStreak: number;
  /** 最长连败 */
  longestLossStreak: number;
  /** 当前连败（连胜中为 0） */
  currentLossStreak: number;
  /** 总轮数 */
  totalRounds: number;
  /** 平均每局轮数（matches 为 0 时是 0） */
  avgRounds: number;
  correctChallenges: number;
  timesCaught: number;
  cardsPlayed: number;
  /** 所有局合并后的点数统计 */
  liedRanks: Partial<Record<TableRank, number>>;
  /** 最常被骗的点数；没有撒谎记录时为 null。平手时按 Q → K → A 取靠前的 */
  mostLiedRank: TableRank | null;
}

/* ------------------------------------------------------------------ */
/* 日志解析                                                            */
/* ------------------------------------------------------------------ */

/** reducer 的出牌日志固定是「某某 打出 N 张，声明全是 X」 */
const PLAY_COUNT_RE = /打出\s*(\d+)\s*张/;
/** reducer 的开轮日志固定是「第 N 轮开始 · 目标点数 X」 */
const ROUND_RANK_RE = /目标点数\s*(Q|K|A)/;

/** 轮次 → 本轮目标点数。翻牌是否撒谎要靠它判断（结构信息，不解析真假文案）。 */
function roundRankMap(state: GameState): Map<number, TableRank> {
  const map = new Map<number, TableRank>();
  for (const entry of state.log) {
    if (entry.kind !== 'round') continue;
    const rank = ROUND_RANK_RE.exec(entry.text)?.[1];
    if (rank) map.set(entry.round, rank as TableRank);
  }
  return map;
}

function assertSeat(state: GameState, seat: number): number {
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.players.length) {
    throw new Error(`BAD_SEAT: 座位 ${seat} 不存在（0..${state.players.length - 1}）`);
  }
  return seat;
}

/* ------------------------------------------------------------------ */
/* 单局                                                                */
/* ------------------------------------------------------------------ */

/**
 * 从任意时刻的 GameState 生成一局的摘要。
 * 没打完也能调（那时 won 一定是 false），但正常用法是终局后调用。
 */
export function buildMatchRecord(state: GameState, humanSeat: number): MatchRecord {
  const seat = assertSeat(state, humanSeat);
  const targetRanks = roundRankMap(state);

  let cardsPlayed = 0;
  const liedRanks: Partial<Record<TableRank, number>> = {};

  for (const entry of state.log) {
    if (entry.kind === 'play' && entry.seat === seat) {
      const count = PLAY_COUNT_RE.exec(entry.text)?.[1];
      if (count) cardsPlayed += Number(count);
      continue;
    }
    if (entry.kind !== 'reveal') continue;
    // 只有「别人」的谎才算被骗；自己被抓属于 timesCaught
    if (entry.seat === seat) continue;
    const target = targetRanks.get(entry.round);
    if (!target || !entry.cards || entry.cards.length === 0) continue;
    // 与 reducer 的判定一致：赖子可以当目标点数，所以它不算撒谎
    const lied = entry.cards.some((c) => c.rank !== target && c.rank !== JOKER_RANK);
    if (lied) liedRanks[target] = (liedRanks[target] ?? 0) + 1;
  }

  return {
    won: state.winnerSeat === seat,
    rounds: state.round,
    correctChallenges: state.correctChallenges[seat] ?? 0,
    timesCaught: state.liesBySeat[seat] ?? 0,
    cardsPlayed,
    liedRanks,
  };
}

/**
 * 终局专用的薄封装：非 game_end 状态直接报错，避免把「还没打完」误记成一局。
 * 这是「reducer 旁边那个可选导出」：想记录战绩时调它，不记录就完全不碰。
 */
export function extractMatchRecord(state: GameState, humanSeat: number): MatchRecord {
  if (state.phase !== 'game_end') {
    throw new Error(`NOT_GAME_END: 当前阶段是 ${state.phase}，还没有终局`);
  }
  return buildMatchRecord(state, humanSeat);
}

/* ------------------------------------------------------------------ */
/* 跨局聚合                                                            */
/* ------------------------------------------------------------------ */

const EMPTY_LIED_RANKS = (): Partial<Record<TableRank, number>> => ({});

/** 跨局统计：总场次、胜率、最长连胜/连败、平均轮数、最常被骗的点数。 */
export function aggregateStats(records: readonly MatchRecord[]): AggregateStats {
  let matches = 0;
  let wins = 0;
  let longestStreak = 0;
  let currentStreak = 0;
  let longestLossStreak = 0;
  let currentLossStreak = 0;
  let totalRounds = 0;
  let correctChallenges = 0;
  let timesCaught = 0;
  let cardsPlayed = 0;
  const liedRanks = EMPTY_LIED_RANKS();

  for (const record of records) {
    matches += 1;
    totalRounds += record.rounds;
    correctChallenges += record.correctChallenges;
    timesCaught += record.timesCaught;
    cardsPlayed += record.cardsPlayed;

    if (record.won) {
      wins += 1;
      currentStreak += 1;
      currentLossStreak = 0;
    } else {
      currentLossStreak += 1;
      currentStreak = 0;
    }
    if (currentStreak > longestStreak) longestStreak = currentStreak;
    if (currentLossStreak > longestLossStreak) longestLossStreak = currentLossStreak;

    for (const rank of TABLE_RANKS) {
      const n = record.liedRanks[rank] ?? 0;
      if (n > 0) liedRanks[rank] = (liedRanks[rank] ?? 0) + n;
    }
  }

  let mostLiedRank: TableRank | null = null;
  let mostLiedCount = 0;
  for (const rank of TABLE_RANKS) {
    const n = liedRanks[rank] ?? 0;
    // 严格大于：平手时保留 TABLE_RANKS 里靠前的那个，结果稳定可测
    if (n > mostLiedCount) {
      mostLiedCount = n;
      mostLiedRank = rank;
    }
  }

  return {
    matches,
    wins,
    losses: matches - wins,
    winRate: matches === 0 ? 0 : wins / matches,
    longestStreak,
    currentStreak,
    longestLossStreak,
    currentLossStreak,
    totalRounds,
    avgRounds: matches === 0 ? 0 : totalRounds / matches,
    correctChallenges,
    timesCaught,
    cardsPlayed,
    liedRanks,
    mostLiedRank,
  };
}
