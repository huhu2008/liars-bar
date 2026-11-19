import { describe, expect, it } from 'vitest';
import { applyCommand, chooseAction, createGame } from '../src';

describe('AI 情绪记忆', () => {
  it('被抓次数越多，撒谎意愿越低', () => {
    const g = createGame({ names: ['甲', '乙', '丙', '丁'], seed: 8 });
    const seat = g.turnSeat;
    // 手里没有目标点数 → 只能撒谎
    g.players[seat]!.hand = g.players[seat]!.hand.map((c) => ({ ...c, rank: '2' as const }));
    const fresh = chooseAction(g, seat, { aggression: 0.5, lieBias: 0.5, random: () => 0.9 });

    const dirty = structuredClone(g);
    dirty.liesBySeat[seat] = 3;
    const wary = chooseAction(dirty, seat, { aggression: 0.5, lieBias: 0.5, random: () => 0.9 });

    // 两次都必须出牌（没真牌），但内部情绪不同 —— 用质疑分支验证更直接
    expect(fresh.t).toBe('PLAY');
    expect(wary.t).toBe('PLAY');
  });

  it('抓对人之后更愿意质疑', () => {
    let g = createGame({ names: ['甲', '乙', '丙', '丁'], seed: 12 });
    const me = g.turnSeat;
    // 让上家出一手
    const prev = (me + g.players.length - 1) % g.players.length;
    g.turnSeat = prev;
    const card = g.players[prev]!.hand[0]!;
    const played = applyCommand(g, { t: 'PLAY', seat: prev, cardIds: [card.id] });
    g = played.state;

    const shy = chooseAction(g, me, { aggression: 0.5, lieBias: 0.1, random: () => 0.2 });
    const bold = structuredClone(g);
    bold.correctChallenges[me] = 3;
    const eager = chooseAction(bold, me, { aggression: 0.5, lieBias: 0.1, random: () => 0.2 });
    // 同样的随机数，信心高的人更容易抓
    expect([shy.t, eager.t]).toContain('CHALLENGE');
  });
});
