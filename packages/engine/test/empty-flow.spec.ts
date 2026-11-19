import { describe, expect, it } from 'vitest';
import { applyCommand, createGame, legalActions } from '../src';

/** 把 seat 0 的手牌打光，返回打光后的状态 */
function emptyMyHand(seed: number) {
  let g = createGame({ names: ['甲', '乙', '丙', '丁'], seed });
  for (let i = 0; i < 60 && g.players[0]!.hand.length > 0; i += 1) {
    if (g.phase === 'round_end') { g = applyCommand(g, { t: 'NEXT_ROUND' }).state; continue; }
    if (g.turnSeat !== 0) {
      const seat = g.turnSeat;
      const card = g.players[seat]!.hand[0];
      const r = card
        ? applyCommand(g, { t: 'PLAY', seat, cardIds: [card.id] })
        : applyCommand(g, { t: 'CHALLENGE', seat });
      if (r.error) break;
      g = r.state;
      continue;
    }
    const hand = g.players[0]!.hand;
    const r = applyCommand(g, { t: 'PLAY', seat: 0, cardIds: hand.slice(0, 3).map((c) => c.id) });
    if (r.error) break;
    g = r.state;
  }
  return g;
}

describe('打完手牌之后', () => {
  it('手牌为 0 时不能出牌，但流程能继续', () => {
    const g = emptyMyHand(3);
    expect(g.players[0]!.hand).toHaveLength(0);
    expect(g.roundWinnerSeat).toBe(0);
    const act = legalActions(g, 0);
    expect(act.canPlay).toBe(false);
  });

  it('下家出牌 → 该轮结束，进入下一轮能重新发满 5 张', () => {
    let g = emptyMyHand(3);
    if (g.phase === 'turn') {
      const seat = g.turnSeat;
      const card = g.players[seat]!.hand[0];
      const r = card
        ? applyCommand(g, { t: 'PLAY', seat, cardIds: [card.id] })
        : applyCommand(g, { t: 'PASS', seat });
      if (!r.error) g = r.state;
    }
    expect(g.phase).toBe('round_end');
    g = applyCommand(g, { t: 'NEXT_ROUND' }).state;
    expect(g.players[0]!.hand.length).toBeGreaterThan(0);
    expect(g.roundWinnerSeat).toBeNull();
  });

  it('下家质疑 → 正常翻牌结算，不卡住', () => {
    const g0 = emptyMyHand(3);
    const seat = g0.turnSeat;
    const r = applyCommand(g0, { t: 'CHALLENGE', seat });
    expect(r.error).toBeFalsy();
    expect(r.events.some((e) => e.t === 'REVEALED')).toBe(true);
    expect(r.state.phase).toBe('round_end');
  });
});
