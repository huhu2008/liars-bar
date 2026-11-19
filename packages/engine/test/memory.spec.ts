import { describe, expect, it } from 'vitest';
import { applyCommand, createGame } from '../src';

describe('AI 记得谁撒过谎', () => {
  it('被抓到撒谎会累计前科', () => {
    let g = createGame({ names: ['甲', '乙', '丙', '丁'], seed: 44 });
    const seat = g.turnSeat;
    // 故意打一张和目标点数不同的牌
    const bad = g.players[seat]!.hand.find((c) => c.rank !== g.targetRank && c.rank !== 'JOKER');
    expect(bad).toBeTruthy();
    const played = applyCommand(g, { t: 'PLAY', seat, cardIds: [bad!.id] });
    expect(played.error).toBeFalsy();
    const ch = applyCommand(played.state, { t: 'CHALLENGE', seat: played.state.turnSeat });
    expect(ch.error).toBeFalsy();
    expect(ch.state.liesBySeat[seat]).toBe(1);
    // 再骗一次 → 2
    g = ch.state;
    if (g.phase === 'round_end') g = applyCommand(g, { t: 'NEXT_ROUND' }).state;
    const seat2 = g.turnSeat;
    const bad2 = g.players[seat2]!.hand.find((c) => c.rank !== g.targetRank && c.rank !== 'JOKER');
    if (bad2) {
      const p2 = applyCommand(g, { t: 'PLAY', seat: seat2, cardIds: [bad2.id] });
      const c2 = applyCommand(p2.state, { t: 'CHALLENGE', seat: p2.state.turnSeat });
      expect(c2.state.liesBySeat[seat2]).toBeGreaterThanOrEqual(1);
    }
  });

  it('说真话不累计', () => {
    let g = createGame({ names: ['甲', '乙', '丙', '丁'], seed: 55 });
    const seat = g.turnSeat;
    const good = g.players[seat]!.hand.find((c) => c.rank === g.targetRank);
    if (good) {
      const played = applyCommand(g, { t: 'PLAY', seat, cardIds: [good.id] });
      const ch = applyCommand(played.state, { t: 'CHALLENGE', seat: played.state.turnSeat });
      expect(ch.state.liesBySeat[seat] ?? 0).toBe(0);
    }
  });
});
