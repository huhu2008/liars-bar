import { describe, expect, it } from 'vitest';
import {
  aggregateStats,
  applyCommand,
  buildMatchRecord,
  createGame,
  extractMatchRecord,
  Rng,
  type Card,
  type GameState,
  type LogEntry,
  type MatchRecord,
  type TableRank,
} from '../src';

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function rec(patch: Partial<MatchRecord> = {}): MatchRecord {
  return {
    won: false,
    rounds: 1,
    correctChallenges: 0,
    timesCaught: 0,
    cardsPlayed: 0,
    liedRanks: {},
    ...patch,
  };
}

function pushLog(state: GameState, entry: Omit<LogEntry, 'seq'>): void {
  state.seq += 1;
  state.log.push({ seq: state.seq, ...entry });
}

/**
 * 随机合法动作把一局打完，并独立统计每个座位真正打出去的张数。
 * 这个计数与 buildMatchRecord 的日志解析互相对账，避免「用实现验证实现」。
 */
function playToGameEnd(
  names: string[],
  seed: number,
  actionSeed: number,
): { state: GameState; played: Map<number, number> } {
  let state = createGame({ names, seed });
  const rng = new Rng(actionSeed);
  const played = new Map<number, number>();

  for (let i = 0; i < 2000; i += 1) {
    if (state.phase === 'game_end') break;
    if (state.phase === 'round_end') {
      state = applyCommand(state, { t: 'NEXT_ROUND' }).state;
      continue;
    }
    const seat = state.turnSeat;
    const me = state.players[seat]!;
    const pending = state.pendingPlay;
    let res;
    if (pending && pending.seat !== seat && (me.hand.length === 0 || rng.int(10) < 3)) {
      res = applyCommand(state, { t: 'CHALLENGE', seat });
    } else if (me.hand.length > 0) {
      const ids = me.hand.slice(0, Math.min(me.hand.length, 1 + rng.int(3))).map((c) => c.id);
      res = applyCommand(state, { t: 'PLAY', seat, cardIds: ids });
      if (!res.error) played.set(seat, (played.get(seat) ?? 0) + ids.length);
    } else {
      res = applyCommand(state, { t: 'PASS', seat });
    }
    expect(res.error, `第 ${i} 步失败: ${res.error}`).toBeFalsy();
    state = res.state;
  }
  return { state, played };
}

function card(rank: Card['rank']): Card {
  return { id: `${rank}_${Math.random()}`, rank, suit: 'S' };
}

/* ------------------------------------------------------------------ */
/* 单局摘要                                                            */
/* ------------------------------------------------------------------ */

describe('buildMatchRecord：开局状态', () => {
  it('没终局时 won=false，其他字段来自当前 state 与空记忆', () => {
    const g = createGame({ names: ['甲', '乙'], seed: 1 });
    const r = buildMatchRecord(g, 0);
    expect(r).toEqual({
      won: false,
      rounds: 1,
      correctChallenges: 0,
      timesCaught: 0,
      cardsPlayed: 0,
      liedRanks: {},
    });
  });

  it('非法座位直接报错，不悄悄返回空记录', () => {
    const g = createGame({ names: ['甲', '乙'], seed: 1 });
    expect(() => buildMatchRecord(g, -1)).toThrow(/BAD_SEAT/);
    expect(() => buildMatchRecord(g, 2)).toThrow(/BAD_SEAT/);
    expect(() => buildMatchRecord(g, 0.5)).toThrow(/BAD_SEAT/);
  });
});

describe('buildMatchRecord：胜负与记忆字段', () => {
  it('赢家就是 humanSeat 时 won=true，否则 false', () => {
    const g = createGame({ names: ['甲', '乙', '丙'], seed: 5 });
    g.phase = 'game_end';
    g.winnerSeat = 1;
    expect(buildMatchRecord(g, 1).won).toBe(true);
    expect(buildMatchRecord(g, 0).won).toBe(false);
    expect(buildMatchRecord(g, 2).won).toBe(false);
  });

  it('抓对次数 / 被抓次数直接取 state 的记忆数组，缺项按 0 处理', () => {
    const g = createGame({ names: ['甲', '乙', '丙'], seed: 5 });
    g.correctChallenges[0] = 3;
    g.liesBySeat[0] = 2;
    g.correctChallenges[2] = 1;
    const me = buildMatchRecord(g, 0);
    expect(me.correctChallenges).toBe(3);
    expect(me.timesCaught).toBe(2);
    expect(buildMatchRecord(g, 1)).toMatchObject({ correctChallenges: 0, timesCaught: 0 });
    expect(buildMatchRecord(g, 2)).toMatchObject({ correctChallenges: 1, timesCaught: 0 });
  });
});

describe('buildMatchRecord：真实对局对账', () => {
  const { state, played } = playToGameEnd(['甲', '乙', '丙', '丁'], 2024, 9182);

  it('这一局确实打完了，rand 策略没有把状态卡死', () => {
    expect(state.phase).toBe('game_end');
  });

  it('rounds 等于终局的轮次，won 与 winnerSeat 一致', () => {
    for (let seat = 0; seat < state.players.length; seat += 1) {
      const r = buildMatchRecord(state, seat);
      expect(r.rounds).toBe(state.round);
      expect(r.won).toBe(state.winnerSeat === seat);
    }
  });

  it('cardsPlayed 与实际出牌张数逐座位一致', () => {
    for (let seat = 0; seat < state.players.length; seat += 1) {
      const r = buildMatchRecord(state, seat);
      expect(r.cardsPlayed).toBe(played.get(seat) ?? 0);
    }
    // 至少有人真的出过牌，否则这条断言是空转
    expect(buildMatchRecord(state, 0).cardsPlayed).toBeGreaterThan(0);
  });

  it('抓对 / 被抓次数与终局 state 的记忆一致', () => {
    for (let seat = 0; seat < state.players.length; seat += 1) {
      const r = buildMatchRecord(state, seat);
      expect(r.correctChallenges).toBe(state.correctChallenges[seat] ?? 0);
      expect(r.timesCaught).toBe(state.liesBySeat[seat] ?? 0);
    }
  });

  it('是纯函数：不修改传入的 state', () => {
    const snapshot = JSON.stringify(state);
    buildMatchRecord(state, 0);
    aggregateStats([buildMatchRecord(state, 0)]);
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

/* ------------------------------------------------------------------ */
/* 日志解析边界                                                        */
/* ------------------------------------------------------------------ */

describe('日志解析边界', () => {
  it('只累加自己的出牌张数，别人的出牌与我无关', () => {
    const g = createGame({ names: ['甲', '乙'], seed: 3 });
    pushLog(g, { round: 1, kind: 'play', text: '甲 打出 3 张，声明全是 Q', seat: 0 });
    pushLog(g, { round: 1, kind: 'play', text: '乙 打出 2 张，声明全是 Q', seat: 1 });
    pushLog(g, { round: 1, kind: 'play', text: '甲 打出 1 张，声明全是 A', seat: 0 });
    pushLog(g, { round: 1, kind: 'pass', text: '乙 手里没牌，过', seat: 1 });
    expect(buildMatchRecord(g, 0).cardsPlayed).toBe(4);
    expect(buildMatchRecord(g, 1).cardsPlayed).toBe(2);
  });

  it('撒谎点数：只统计别人的谎，赖子不算撒谎，真话不算', () => {
    const g = createGame({ names: ['甲', '乙'], seed: 3 });
    pushLog(g, { round: 1, kind: 'round', text: '第 1 轮开始 · 目标点数 Q' });
    pushLog(g, { round: 2, kind: 'round', text: '第 2 轮开始 · 目标点数 K' });
    // 乙在 Q 轮撒谎（J 既不是 Q 也不是赖子）
    pushLog(g, { round: 1, kind: 'reveal', text: '乙 撒谎了', seat: 1, cards: [card('J')] });
    // 乙在 Q 轮说的真话
    pushLog(g, { round: 1, kind: 'reveal', text: '乙 说的是真的', seat: 1, cards: [card('Q')] });
    // 乙拿赖子糊弄，按 reducer 规则算真话
    pushLog(g, { round: 2, kind: 'reveal', text: '乙 说的是真的', seat: 1, cards: [card('JOKER')] });
    // 甲自己在 K 轮撒谎：被抓的是我，属于 timesCaught，不是「我被骗」
    pushLog(g, { round: 2, kind: 'reveal', text: '甲 撒谎了', seat: 0, cards: [card('9')] });
    // 乙在 K 轮撒谎
    pushLog(g, { round: 2, kind: 'reveal', text: '乙 撒谎了', seat: 1, cards: [card('3')] });

    expect(buildMatchRecord(g, 0).liedRanks).toEqual({ Q: 1, K: 1 });
    expect(buildMatchRecord(g, 1).liedRanks).toEqual({ K: 1 });
  });

  it('没有目标点数映射的翻牌不猜点数，直接跳过', () => {
    const g = createGame({ names: ['甲', '乙'], seed: 3 });
    pushLog(g, { round: 99, kind: 'reveal', text: '乙 撒谎了', seat: 1, cards: [card('J')] });
    expect(buildMatchRecord(g, 0).liedRanks).toEqual({});
  });

  it('没有翻牌日志时 liedRanks 是空对象而不是 undefined', () => {
    const g = createGame({ names: ['甲', '乙'], seed: 3 });
    expect(buildMatchRecord(g, 0).liedRanks).toEqual({});
  });
});

/* ------------------------------------------------------------------ */
/* 终局提取                                                            */
/* ------------------------------------------------------------------ */

describe('extractMatchRecord：终局专用入口', () => {
  it('非 game_end 阶段报错，避免把半局记成一局', () => {
    const g = createGame({ names: ['甲', '乙'], seed: 1 });
    expect(() => extractMatchRecord(g, 0)).toThrow(/NOT_GAME_END/);
    g.phase = 'round_end';
    expect(() => extractMatchRecord(g, 0)).toThrow(/NOT_GAME_END/);
  });

  it('终局后与 buildMatchRecord 结果完全一致', () => {
    const { state } = playToGameEnd(['甲', '乙', '丙', '丁'], 2024, 9182);
    for (let seat = 0; seat < state.players.length; seat += 1) {
      expect(extractMatchRecord(state, seat)).toEqual(buildMatchRecord(state, seat));
    }
  });
});

/* ------------------------------------------------------------------ */
/* 跨局聚合                                                            */
/* ------------------------------------------------------------------ */

describe('aggregateStats：空输入', () => {
  it('没有任何记录时全部归零，不产生 NaN', () => {
    const stats = aggregateStats([]);
    expect(stats).toEqual({
      matches: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      longestStreak: 0,
      currentStreak: 0,
      longestLossStreak: 0,
      currentLossStreak: 0,
      totalRounds: 0,
      avgRounds: 0,
      correctChallenges: 0,
      timesCaught: 0,
      cardsPlayed: 0,
      liedRanks: {},
      mostLiedRank: null,
    });
    expect(Number.isNaN(stats.winRate)).toBe(false);
    expect(Number.isNaN(stats.avgRounds)).toBe(false);
  });
});

describe('aggregateStats：胜率与连胜', () => {
  const records = [
    rec({ won: true, rounds: 2, correctChallenges: 1, cardsPlayed: 4, liedRanks: { Q: 2 } }),
    rec({ won: true, rounds: 3, timesCaught: 1, cardsPlayed: 5, liedRanks: { K: 1 } }),
    rec({ won: false, rounds: 1, correctChallenges: 2, timesCaught: 2, cardsPlayed: 1, liedRanks: { Q: 1 } }),
    rec({ won: true, rounds: 4, cardsPlayed: 3 }),
    rec({ won: false, rounds: 2, correctChallenges: 1, timesCaught: 1, cardsPlayed: 2, liedRanks: { A: 2 } }),
    rec({ won: false, rounds: 1, timesCaught: 2, cardsPlayed: 2 }),
    rec({ won: false, rounds: 1, timesCaught: 1, cardsPlayed: 1 }),
  ];

  it('总场次 / 胜负 / 胜率', () => {
    const stats = aggregateStats(records);
    expect(stats.matches).toBe(7);
    expect(stats.wins).toBe(3);
    expect(stats.losses).toBe(4);
    expect(stats.winRate).toBeCloseTo(3 / 7, 10);
  });

  it('最长连胜取历史峰值，当前连胜按最后一局结算', () => {
    const stats = aggregateStats(records);
    expect(stats.longestStreak).toBe(2);
    expect(stats.currentStreak).toBe(0);
    expect(stats.longestLossStreak).toBe(3);
    expect(stats.currentLossStreak).toBe(3);
  });

  it('结尾是连胜时当前连胜等于尾部连胜长度', () => {
    const stats = aggregateStats([
      rec({ won: true }),
      rec({ won: false }),
      rec({ won: true }),
      rec({ won: true }),
      rec({ won: true }),
    ]);
    expect(stats.longestStreak).toBe(3);
    expect(stats.currentStreak).toBe(3);
    expect(stats.longestLossStreak).toBe(1);
    expect(stats.currentLossStreak).toBe(0);
  });

  it('全胜：胜率 1，连胜等于场次', () => {
    const stats = aggregateStats([rec({ won: true }), rec({ won: true }), rec({ won: true })]);
    expect(stats.winRate).toBe(1);
    expect(stats.longestStreak).toBe(3);
    expect(stats.currentStreak).toBe(3);
    expect(stats.losses).toBe(0);
  });
});

describe('aggregateStats：求和与平均轮数', () => {
  const records = [
    rec({ won: true, rounds: 2, correctChallenges: 1, cardsPlayed: 4 }),
    rec({ won: true, rounds: 3, timesCaught: 1, cardsPlayed: 5 }),
    rec({ won: false, rounds: 1, correctChallenges: 2, timesCaught: 2, cardsPlayed: 1 }),
    rec({ won: true, rounds: 4, cardsPlayed: 3 }),
    rec({ won: false, rounds: 2, correctChallenges: 1, timesCaught: 1, cardsPlayed: 2 }),
    rec({ won: false, rounds: 1, timesCaught: 2, cardsPlayed: 2 }),
    rec({ won: false, rounds: 1, timesCaught: 1, cardsPlayed: 1 }),
  ];

  it('各项计数器累加，平均轮数 = 总轮数 / 场次', () => {
    const stats = aggregateStats(records);
    expect(stats.totalRounds).toBe(14);
    expect(stats.avgRounds).toBeCloseTo(2, 10);
    expect(stats.correctChallenges).toBe(4);
    expect(stats.timesCaught).toBe(7);
    expect(stats.cardsPlayed).toBe(18);
  });

  it('不修改传入的数组和记录', () => {
    const snapshot = JSON.stringify(records);
    const stats = aggregateStats(records);
    expect(JSON.stringify(records)).toBe(snapshot);
    expect(records).toHaveLength(7);
    // 返回的对象与入参不共享引用：改返回值不会污染历史记录
    stats.liedRanks.Q = 99;
    expect(records[0]!.liedRanks.Q).toBeUndefined();
  });
});

describe('aggregateStats：最常被骗的点数', () => {
  it('合并各局的点数统计并选出最大值', () => {
    const stats = aggregateStats([
      rec({ liedRanks: { Q: 2 } }),
      rec({ liedRanks: { Q: 1, K: 1 } }),
      rec({ liedRanks: { A: 2 } }),
    ]);
    expect(stats.liedRanks).toEqual({ Q: 3, K: 1, A: 2 });
    expect(stats.mostLiedRank).toBe('Q');
  });

  it('平手时按 Q → K → A 的顺序取靠前的，结果稳定', () => {
    expect(aggregateStats([rec({ liedRanks: { A: 3, K: 3 } })]).mostLiedRank).toBe('K');
    expect(aggregateStats([rec({ liedRanks: { K: 1, Q: 1 } })]).mostLiedRank).toBe('Q');
  });

  it('没有任何撒谎记录时为 null', () => {
    expect(aggregateStats([rec(), rec({ won: true })]).mostLiedRank).toBeNull();
  });
});

describe('aggregateStats：接真实对局', () => {
  it('两局终局记录聚合后场次为 2，统计不越界', () => {
    const a = playToGameEnd(['甲', '乙', '丙', '丁'], 2024, 9182).state;
    const b = playToGameEnd(['甲', '乙', '丙', '丁'], 777, 31).state;
    expect(a.phase).toBe('game_end');
    expect(b.phase).toBe('game_end');

    const stats = aggregateStats([extractMatchRecord(a, 0), extractMatchRecord(b, 0)]);
    expect(stats.matches).toBe(2);
    expect(stats.wins + stats.losses).toBe(2);
    expect(stats.totalRounds).toBe(a.round + b.round);
    expect(stats.avgRounds).toBeCloseTo((a.round + b.round) / 2, 10);
    expect(stats.winRate).toBe(stats.wins / 2);
    const ranks: TableRank[] = ['Q', 'K', 'A'];
    if (stats.mostLiedRank !== null) expect(ranks).toContain(stats.mostLiedRank);
  });
});
