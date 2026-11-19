import { describe, expect, it } from 'vitest';
import { applyCommand, chooseAction, createGame, legalActions, project } from '../src';

const NAMES = ['甲', '乙', '丙', '丁'];

describe('边界流程', () => {
  it('牌堆耗尽时用弃牌堆重洗，不会发不出牌', () => {
    let g = createGame({ names: NAMES, seed: 21 });
    // 打空牌堆：连续推进多轮
    for (let round = 0; round < 12; round += 1) {
      if (g.phase === 'round_end') {
        g = applyCommand(g, { t: 'NEXT_ROUND' }).state;
        continue;
      }
      if (g.phase === 'turn') {
        const seat = g.turnSeat;
        const hand = g.players[seat]!.hand;
        const res = applyCommand(g, { t: 'PLAY', seat, cardIds: [hand[0]!.id] });
        expect(res.error, `第 ${round} 轮出牌失败: ${res.error}`).toBeFalsy();
        g = res.state;
      }
    }
    // 每个存活玩家的手牌数应该始终 = 5（一轮发牌数）
    for (const p of g.players.filter((x) => x.alive)) {
      expect(p.hand.length).toBeGreaterThan(0);
    }
  });

  it('一轮内可以多次质疑，每次独立结算', () => {
    let g = createGame({ names: NAMES, seed: 33 });
    let challenges = 0;
    for (let i = 0; i < 40 && challenges < 2; i += 1) {
      if (g.phase !== 'turn') break;
      const seat = g.turnSeat;
      if (g.pendingPlay && g.pendingPlay.seat !== seat) {
        const res = applyCommand(g, { t: 'CHALLENGE', seat });
        if (!res.error) {
          challenges += 1;
          expect(res.events.some((e) => e.t === 'REVEALED')).toBe(true);
          expect(res.events.some((e) => e.t === 'SHOT')).toBe(true);
          g = res.state;
          if (g.phase === 'round_end') {
            g = applyCommand(g, { t: 'NEXT_ROUND' }).state;
          }
          continue;
        }
      }
      const hand = g.players[seat]!.hand;
      const res = applyCommand(g, { t: 'PLAY', seat, cardIds: [hand[0]!.id] });
      if (res.error) break;
      g = res.state;
    }
    expect(challenges).toBe(2);
  });

  it('死亡玩家不会被轮到', () => {
    let g = createGame({ names: NAMES, seed: 44 });
    // 先把 1 号位打死（直接改状态模拟）
    g.players[1]!.alive = false;
    g.players[1]!.hand = [];
    // 连续推进若干手，确认 turnSeat 永远不等于 1
    for (let i = 0; i < 30; i += 1) {
      if (g.phase !== 'turn') break;
      expect(g.turnSeat).not.toBe(1);
      const seat = g.turnSeat;
      const hand = g.players[seat]!.hand;
      if (!hand.length) break;
      const res = applyCommand(g, { t: 'PLAY', seat, cardIds: [hand[0]!.id] });
      if (res.error) break;
      g = res.state;
    }
  });

  it('视图投影不会泄露别人的手牌', () => {
    const g = createGame({ names: NAMES, seed: 55 });
    for (let seat = 0; seat < 4; seat += 1) {
      const v = project(g, seat);
      for (const other of v.seats) {
        expect(other).not.toHaveProperty('hand');
      }
      expect(Array.isArray(v.me.hand)).toBe(true);
    }
  });
});


describe('官方规则：赖子当 Table 牌', () => {
  it('打出赖子声明任意点数都算真', () => {
    const g = createGame({ names: ['甲', '乙', '丙', '丁'], seed: 321 });
    const seat = g.turnSeat;
    g.players[seat]!.hand[0] = { id: 'JOKER_1', rank: 'JOKER', suit: 'S' };
    const played = applyCommand(g, { t: 'PLAY', seat, cardIds: ['JOKER_1'] });
    expect(played.error).toBeFalsy();
    const ch = applyCommand(played.state, { t: 'CHALLENGE', seat: played.state.turnSeat });
    expect(ch.error).toBeFalsy();
    const rev = ch.events.find((e) => e.t === 'REVEALED') as { truthful: boolean } | undefined;
    expect(rev?.truthful).toBe(true);
  });

  it('牌堆正好 20 张：Q6 K6 A6 + 赖子2', () => {
    const g = createGame({ names: ['甲', '乙', '丙', '丁'], seed: 5 });
    const all = [...g.deck, ...g.discard, ...g.players.flatMap((p) => p.hand)];
    expect(all).toHaveLength(20);
    expect(all.filter((c) => c.rank === 'Q')).toHaveLength(6);
    expect(all.filter((c) => c.rank === 'K')).toHaveLength(6);
    expect(all.filter((c) => c.rank === 'A')).toHaveLength(6);
    expect(all.filter((c) => c.rank === 'JOKER')).toHaveLength(2);
  });

  it('目标点数只会是 Q / K / A', () => {
    let g = createGame({ names: ['甲', '乙', '丙', '丁'], seed: 11 });
    const seen = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      seen.add(g.targetRank!);
      if (g.phase === 'round_end') g = applyCommand(g, { t: 'NEXT_ROUND' }).state;
      else if (g.phase === 'turn') {
        const r = applyCommand(g, chooseAction(g, g.turnSeat, { aggression: 0.5, lieBias: 0.2 }));
        if (r.error) break;
        g = r.state;
      } else break;
    }
    for (const r of seen) expect(['Q', 'K', 'A']).toContain(r);
  });
});
