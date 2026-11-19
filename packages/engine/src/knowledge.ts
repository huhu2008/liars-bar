import { COPIES_PER_RANK, DECK_SIZE } from './cards';
import type { Card, GameState } from './types';

/**
 * 公开信息推理层。
 *
 * 设计约束：AI 只能吃「公开信息 + 自己的手牌」，所以这里只允许读
 *   - state.publicCards（本轮被翻牌揭示过的牌）
 *   - 自己的手牌
 *   - 张数类公开量（手牌数、牌堆数）
 * 绝不读别人的 hand、也不读 discard 里没被揭示过的牌（那是隐藏信息，
 * 旧版 seenCount 用 discard 计数等于让 AI 偷看未揭开的牌）。
 */

export const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

export function publicCardsOf(state: GameState): Card[] {
  return state.publicCards ?? [];
}

export function publicCountOfRank(state: GameState, rank: string): number {
  return publicCardsOf(state).filter((c) => c.rank === rank).length;
}

/**
 * 这个点数还有几张「可能藏在别人手里」。
 * 每个点数 6 张（旧实现按 4 张算，概率推理是错的），扣掉自己手里的和已经翻开的。
 */
export function rankRemainingFor(
  state: GameState,
  rank: string,
  hand: readonly Card[],
): number {
  const mine = hand.filter((c) => c.rank === rank).length;
  return Math.max(0, COPIES_PER_RANK - mine - publicCountOfRank(state, rank));
}

/** 全场还有多少张完全没人知道的牌（自己手牌与已公开牌之外的部分） */
export function unseenTotalFor(state: GameState, hand: readonly Card[]): number {
  return Math.max(1, DECK_SIZE - hand.length - publicCardsOf(state).length);
}

/** 超几何：从 pool 张里随机抽 n 张，全部落在 k 张里的概率 */
export function hypergeomAll(k: number, pool: number, n: number): number {
  if (n <= 0) return 1;
  if (n > pool || n > k) return 0;
  let p = 1;
  for (let i = 0; i < n; i += 1) p *= (k - i) / (pool - i);
  return clamp01(p);
}

export interface ClaimContext {
  claimCount: number;
  /** 该点数还没被定位的张数（见 rankRemainingFor） */
  remainingRank: number;
  /** 全场未知牌总数（见 unseenTotalFor） */
  unseenTotal: number;
  /** 出牌者的前科（liesBySeat） */
  history: number;
}

/**
 * 这一手「声明为真」的概率。
 * 先按随机发牌的几何分布给先验，再按出牌者前科和「一次出多张更像诈」下调。
 */
export function claimTruthProbability(ctx: ClaimContext): number {
  const prior = hypergeomAll(ctx.remainingRank, ctx.unseenTotal, ctx.claimCount);
  const liePrior = clamp01(
    0.1 + Math.max(0, ctx.history) * 0.16 + Math.max(0, ctx.claimCount - 1) * 0.09,
  );
  return clamp01(prior * (1 - liePrior));
}
