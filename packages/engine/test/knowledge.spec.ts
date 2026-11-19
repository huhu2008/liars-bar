import { describe, expect, it } from 'vitest';
import {
  claimTruthProbability,
  COPIES_PER_RANK,
  DECK_SIZE,
  hypergeomAll,
  publicCountOfRank,
  rankRemainingFor,
  unseenTotalFor,
  type Card,
  type GameState,
} from '../src';
import { createGame } from '../src';

function card(rank: Card['rank'], suit: Card['suit'] = 'S', tag = ''): Card {
  return { id: `${rank}${suit}${tag}`, rank, suit };
}

const NAMES = ['甲', '乙', '丙', '丁'];

function base(): GameState {
  return createGame({ names: NAMES, seed: 42 });
}

describe('公开信息推理：张数与概率', () => {
  it('每个点数 6 张、牌堆 20 张', () => {
    expect(COPIES_PER_RANK).toBe(6);
    expect(DECK_SIZE).toBe(20);
    const g = base();
    const all = [...g.deck, ...g.discard, ...g.players.flatMap((p) => p.hand)];
    expect(all).toHaveLength(DECK_SIZE);
  });

  it('剩余张数 = 6 − 我手上 − 已公开（不是按 4 张算）', () => {
    const g = base();
    const target = g.targetRank as 'Q' | 'K' | 'A';
    const other = (['Q', 'K', 'A'] as const).find((r) => r !== target)!;

    // 用别的点数当「我的牌」，保证不会意外多算
    const hand = [other, other, other, other, other].map((r, i) => card(r, 'S', `h${i}`));
    expect(rankRemainingFor(g, target, hand)).toBe(COPIES_PER_RANK);
    expect(rankRemainingFor(g, other, hand)).toBe(COPIES_PER_RANK - 5);

    // 再公开两张目标点数
    g.publicCards = [card(target, 'H', 'p1'), card(target, 'D', 'p2')];
    expect(publicCountOfRank(g, target)).toBe(2);
    expect(rankRemainingFor(g, target, hand)).toBe(COPIES_PER_RANK - 2);
  });

  it('弃牌堆不是已知信息：AI 不许拿它数牌', () => {
    const g = base();
    const target = g.targetRank as 'Q' | 'K' | 'A';
    const hand = g.players[g.turnSeat]!.hand.filter((c) => c.rank !== target);
    const before = rankRemainingFor(g, target, hand);
    // 把 6 张目标点数全塞进弃牌堆 —— 但它们从没被翻开过
    g.discard = Array.from({ length: 6 }, (_, i) => card(target, 'C', `d${i}`));
    expect(rankRemainingFor(g, target, hand)).toBe(before);
    expect(before).toBeGreaterThan(0);
  });

  it('全场未知牌数扣掉自己手牌与已公开牌', () => {
    const g = base();
    const hand = g.players[g.turnSeat]!.hand;
    expect(unseenTotalFor(g, hand)).toBe(DECK_SIZE - hand.length);
    g.publicCards = [card('Q', 'S', 'p1'), card('Q', 'H', 'p2')];
    expect(unseenTotalFor(g, hand)).toBe(DECK_SIZE - hand.length - 2);
  });

  it('超几何分布：声明张数越多越不可信，超出剩余张数直接为 0', () => {
    expect(hypergeomAll(6, 15, 1)).toBeCloseTo(0.4, 6);
    expect(hypergeomAll(6, 15, 2)).toBeCloseTo((6 / 15) * (5 / 14), 6);
    expect(hypergeomAll(6, 15, 3)).toBeLessThan(hypergeomAll(6, 15, 2));
    expect(hypergeomAll(2, 15, 3)).toBe(0);
    expect(hypergeomAll(6, 15, 0)).toBe(1);
  });

  it('真话概率随前科与声明张数下降', () => {
    const clean = claimTruthProbability({
      claimCount: 1,
      remainingRank: 6,
      unseenTotal: 15,
      history: 0,
    });
    expect(clean).toBeCloseTo(0.36, 6);

    const repeat = claimTruthProbability({
      claimCount: 1,
      remainingRank: 6,
      unseenTotal: 15,
      history: 2,
    });
    expect(repeat).toBeLessThan(clean);

    const bulk = claimTruthProbability({
      claimCount: 3,
      remainingRank: 6,
      unseenTotal: 15,
      history: 0,
    });
    expect(bulk).toBeLessThan(clean);
    expect(bulk).toBeGreaterThan(0);
  });

  it('牌就在自己手上 → 剩余为 0，任何声明都是假的', () => {
    const g = base();
    const target = g.targetRank as 'Q' | 'K' | 'A';
    const hand = Array.from({ length: 6 }, (_, i) => card(target, 'S', `m${i}`));
    expect(rankRemainingFor(g, target, hand)).toBe(0);
    expect(
      claimTruthProbability({ claimCount: 1, remainingRank: 0, unseenTotal: 14, history: 0 }),
    ).toBe(0);
  });
});
