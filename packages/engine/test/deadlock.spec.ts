import { describe, expect, it } from 'vitest';
import { applyCommand, createGame, legalActions, project } from '../src';

describe('空手牌边界', () => {
  it('所有人手牌空时不应该死锁（可以 PASS）', () => {
    let state = createGame({ names: ['甲', '乙', '丙'], seed: 7 });
    for (const p of state.players) {
      state.discard.push(...p.hand);
      p.hand = [];
    }
    const seat = state.turnSeat;
    const before = legalActions(state, seat);
    expect(before.canPlay).toBe(false);

    // PASS 应该能推进回合
    const res = applyCommand(state, { t: 'PASS', seat });
    expect(res.error).toBeFalsy();
    expect(res.events.some((e) => e.t === 'ROUND_END')).toBe(true);
    void project;
  });

  it('手里有牌时不允许 PASS', () => {
    const state = createGame({ names: ['甲', '乙', '丙'], seed: 8 });
    const seat = state.turnSeat;
    const res = applyCommand(state, { t: 'PASS', seat });
    expect(res.error).toBe('HAS_CARDS');
  });
});
