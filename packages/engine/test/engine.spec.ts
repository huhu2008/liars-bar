import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  chooseAction,
  createGame,
  HAND_SIZE,
  legalActions,
  project,
  type Card,
  type GameState,
  type Rank,
} from '../src/index';

const NAMES = ['你', '酒保', '赌徒', '面具人'];

/** 造一张指定点数的牌，用于定点构造规则场景 */
function card(rank: Rank, suit: 'S' | 'H' | 'D' | 'C' = 'S', tag = ''): Card {
  return { id: `${rank}${suit}${tag}`, rank, suit };
}

describe('createGame', () => {
  it('发牌与初始状态', () => {
    const g = createGame({ names: NAMES, seed: 42 });
    expect(g.players).toHaveLength(4);
    expect(g.phase).toBe('turn');
    expect(g.round).toBe(1);
    expect(g.bullets).toBe(1);
    expect(g.targetRank).toBeTruthy();
    for (const p of g.players) expect(p.hand).toHaveLength(HAND_SIZE);
    const total =
      g.deck.length + g.discard.length + g.players.reduce((n, p) => n + p.hand.length, 0);
    expect(total).toBe(20);
  });

  it('同一 seed 完全可复现', () => {
    const a = createGame({ names: NAMES, seed: 2024 });
    const b = createGame({ names: NAMES, seed: 2024 });
    expect(a.targetRank).toBe(b.targetRank);
    expect(a.players.map((p) => p.hand.map((c) => c.id))).toEqual(
      b.players.map((p) => p.hand.map((c) => c.id)),
    );
  });

  it('不同 seed 牌局不同', () => {
    const a = createGame({ names: NAMES, seed: 1 });
    const b = createGame({ names: NAMES, seed: 999999 });
    expect(a.players[0]!.hand.map((c) => c.id).join()).not.toBe(
      b.players[0]!.hand.map((c) => c.id).join(),
    );
  });
});

describe('PLAY 校验', () => {
  it('不是自己的回合会被拒绝，且不产生新状态', () => {
    const g = createGame({ names: NAMES, seed: 7 });
    const wrongSeat = (g.turnSeat + 1) % 4;
    const res = applyCommand(g, {
      t: 'PLAY',
      seat: wrongSeat,
      cardIds: [g.players[wrongSeat]!.hand[0]!.id],
    });
    expect(res.error).toBe('NOT_YOUR_TURN');
    expect(res.state).toBe(g);
  });

  it('张数越界与重复牌被拦', () => {
    const g = createGame({ names: NAMES, seed: 7 });
    const seat = g.turnSeat;
    const hand = g.players[seat]!.hand;
    expect(applyCommand(g, { t: 'PLAY', seat, cardIds: [] }).error).toBe('BAD_CARD_COUNT');
    expect(
      applyCommand(g, { t: 'PLAY', seat, cardIds: hand.slice(0, 4).map((c) => c.id) }).error,
    ).toBe('BAD_CARD_COUNT');
    expect(
      applyCommand(g, { t: 'PLAY', seat, cardIds: [hand[0]!.id, hand[0]!.id] }).error,
    ).toBe('DUPLICATE_CARD');
  });

  it('出牌后手牌减少、桌面留下一手、轮到下家，且原状态不可变', () => {
    const g = createGame({ names: NAMES, seed: 11 });
    const seat = g.turnSeat;
    const before = g.players[seat]!.hand.length;
    const res = applyCommand(g, { t: 'PLAY', seat, cardIds: [g.players[seat]!.hand[0]!.id] });
    expect(res.error).toBeUndefined();
    expect(res.state.players[seat]!.hand).toHaveLength(before - 1);
    expect(res.state.pendingPlay?.claimCount).toBe(1);
    expect(res.state.pendingPlay?.seat).toBe(seat);
    expect(res.state.turnSeat).toBe((seat + 1) % 4);
    expect(g.players[seat]!.hand).toHaveLength(before);
  });
});

describe('CHALLENGE 双向结算', () => {
  it('出牌者为真 → 质疑者受罚', () => {
    const g = createGame({ names: NAMES, seed: 3 });
    const target = g.targetRank as Rank;
    const seat = g.turnSeat;
    g.players[seat]!.hand = [card(target, 'S', 'T1'), card('2', 'H', 'X1')];
    const played = applyCommand(g, { t: 'PLAY', seat, cardIds: [`${target}ST1`] });
    expect(played.error).toBeUndefined();
    const res = applyCommand(played.state, { t: 'CHALLENGE', seat: played.state.turnSeat });
    expect(res.state.lastReveal?.truthful).toBe(true);
    expect(res.state.lastReveal?.punishedSeat).toBe(played.state.turnSeat);
    expect(res.state.phase).toBe('round_end');
  });

  it('出牌者撒谎 → 出牌者受罚', () => {
    const g = createGame({ names: NAMES, seed: 3 });
    const target = g.targetRank as Rank;
    const seat = g.turnSeat;
    const liarRank: Rank = target === 'A' ? 'K' : 'A';
    g.players[seat]!.hand = [card(liarRank, 'S', 'L1')];
    const played = applyCommand(g, { t: 'PLAY', seat, cardIds: [`${liarRank}SL1`] });
    expect(played.error).toBeUndefined();
    const res = applyCommand(played.state, { t: 'CHALLENGE', seat: played.state.turnSeat });
    expect(res.state.lastReveal?.truthful).toBe(false);
    expect(res.state.lastReveal?.punishedSeat).toBe(seat);
  });

  it('没有牌可抓时不能质疑', () => {
    const g = createGame({ names: NAMES, seed: 5 });
    const res = applyCommand(g, { t: 'CHALLENGE', seat: g.turnSeat });
    expect(res.error).toBe('NOTHING_TO_CHALLENGE');
  });

  it('不能对自己的出牌质疑', () => {
    const g = createGame({ names: NAMES, seed: 5 });
    const seat = g.turnSeat;
    const played = applyCommand(g, { t: 'PLAY', seat, cardIds: [g.players[seat]!.hand[0]!.id] });
    const res = applyCommand(played.state, { t: 'CHALLENGE', seat });
    expect(res.error).toBe('NOT_YOUR_TURN');
  });
});

describe('轮盘与弹仓', () => {
  it('中弹判定 = chamber < bullets，空枪后子弹数 +1', () => {
    let survived = 0;
    for (let seed = 1; seed <= 80 && survived < 6; seed += 1) {
      const g = createGame({ names: NAMES, seed });
      const seat = g.turnSeat;
      const played = applyCommand(g, { t: 'PLAY', seat, cardIds: [g.players[seat]!.hand[0]!.id] });
      const before = played.state.bullets;
      const res = applyCommand(played.state, { t: 'CHALLENGE', seat: played.state.turnSeat });
      const reveal = res.state.lastReveal!;
      expect(reveal.died).toBe(reveal.chamber < before);
      expect(reveal.chamber).toBeGreaterThanOrEqual(0);
      expect(reveal.chamber).toBeLessThan(6);
      if (reveal.died) {
        expect(res.state.players[reveal.punishedSeat]!.alive).toBe(false);
      } else {
        expect(res.state.bullets).toBe(before + 1);
        survived += 1;
      }
    }
    expect(survived).toBeGreaterThan(0);
  });
});

describe('project 视图投影', () => {
  it('别人的手牌只暴露张数', () => {
    const g = createGame({ names: NAMES, seed: 77 });
    const view = project(g, 0);
    expect(view.me.hand).toHaveLength(HAND_SIZE);
    expect(view.seats[1]!.cardCount).toBe(HAND_SIZE);
    expect(view.seats[1]).not.toHaveProperty('hand');

    const payload = JSON.stringify(view);
    const others = g.players.slice(1).flatMap((p) => p.hand.map((c) => c.id));
    let leaked = 0;
    for (const id of others) if (payload.includes(id)) leaked += 1;
    expect(leaked).toBe(0);
  });

  it('桌面未揭示的牌也不会泄漏给下家', () => {
    const g = createGame({ names: NAMES, seed: 88 });
    const seat = g.turnSeat;
    const played = applyCommand(g, { t: 'PLAY', seat, cardIds: [g.players[seat]!.hand[0]!.id] });
    const view = project(played.state, (seat + 1) % 4);
    const payload = JSON.stringify(view);
    for (const c of played.state.pendingPlay!.cards) expect(payload.includes(c.id)).toBe(false);
  });
});

describe('整场流程', () => {
  it('脚本化对局能跑到只剩一人，牌张守恒', () => {
    let state: GameState = createGame({ names: NAMES, seed: 1234 });
    let steps = 0;

    while (state.phase !== 'game_end' && steps < 3000) {
      steps += 1;
      if (state.phase === 'turn') {
        const seat = state.turnSeat;
        const action = chooseAction(state, seat, { random: () => 0.5 });
        const ids = 'cardIds' in action ? action.cardIds : [];
        const fallback = state.players[seat]!.hand[0]!.id;
        const play = applyCommand(state, {
          t: 'PLAY',
          seat,
          cardIds: ids.length ? ids : [fallback],
        });
        expect(play.error).toBeUndefined();
        state = play.state;
        const ch = applyCommand(state, { t: 'CHALLENGE', seat: state.turnSeat });
        expect(ch.error).toBeUndefined();
        state = ch.state;
      } else if (state.phase === 'round_end') {
        const next = applyCommand(state, { t: 'NEXT_ROUND' });
        expect(next.error).toBeUndefined();
        state = next.state;
      }
    }

    expect(steps).toBeLessThan(3000);
    const alive = state.players.filter((p) => p.alive);
    expect(alive.length).toBe(1);
    expect(state.phase).toBe('game_end');
    expect(state.winnerSeat).toBe(alive[0]!.seat);

    const total =
      state.deck.length + state.discard.length + state.players.reduce((n, p) => n + p.hand.length, 0) +
      (state.pendingPlay?.cards.length ?? 0);
    expect(total).toBe(20);
  });

  it('legalActions 随回合变化', () => {
    const g = createGame({ names: NAMES, seed: 6 });
    const me = g.turnSeat;
    expect(legalActions(g, me)).toMatchObject({ canPlay: true, canChallenge: false });
    expect(legalActions(g, (me + 1) % 4)).toMatchObject({ canPlay: false, canChallenge: false });
    const played = applyCommand(g, { t: 'PLAY', seat: me, cardIds: [g.players[me]!.hand[0]!.id] });
    expect(legalActions(played.state, played.state.turnSeat)).toMatchObject({
      canPlay: true,
      canChallenge: true,
    });
  });

  it('多轮之后牌张守恒、存活者手牌补满', () => {
    let state: GameState = createGame({ names: NAMES, seed: 31 });
    for (let i = 0; i < 8 && state.phase !== 'game_end'; i += 1) {
      if (state.phase === 'turn') {
        const seat = state.turnSeat;
        const played = applyCommand(state, {
          t: 'PLAY',
          seat,
          cardIds: [state.players[seat]!.hand[0]!.id],
        });
        const res = applyCommand(played.state, { t: 'CHALLENGE', seat: played.state.turnSeat });
        state = res.state;
      }
      if (state.phase === 'round_end') {
        const next = applyCommand(state, { t: 'NEXT_ROUND' });
        if (!next.error) state = next.state;
      }
    }
    const total =
      state.deck.length + state.discard.length + state.players.reduce((n, p) => n + p.hand.length, 0) +
      (state.pendingPlay?.cards.length ?? 0);
    expect(total).toBe(20);
    // 终局之后不会再发牌，只有游戏还在进行时才要求手牌是满的
    if (state.phase !== 'game_end') {
      for (const p of state.players.filter((x) => x.alive)) expect(p.hand).toHaveLength(HAND_SIZE);
    }
  });
});


describe('人数可变（2–4）', () => {
  // 官方牌堆 20 张：4 人 × 5 正好发完，5 人以上牌不够
  for (const n of [2, 3, 4]) {
    it(`${n} 人局能跑到只剩一人，牌张守恒`, () => {
      let state: GameState = createGame({
        names: Array.from({ length: n }, (_, i) => `P${i}`),
        seed: 900 + n,
      });
      expect(state.players).toHaveLength(n);
      for (const p of state.players) expect(p.hand).toHaveLength(HAND_SIZE);

      let steps = 0;
      while (state.phase !== 'game_end' && steps < 6000) {
        steps += 1;
        if (state.phase === 'turn') {
          const seat = state.turnSeat;
          const played = applyCommand(state, {
            t: 'PLAY',
            seat,
            cardIds: [state.players[seat]!.hand[0]!.id],
          });
          expect(played.error).toBeUndefined();
          const ch = applyCommand(played.state, { t: 'CHALLENGE', seat: played.state.turnSeat });
          expect(ch.error).toBeUndefined();
          state = ch.state;
        } else if (state.phase === 'round_end') {
          const next = applyCommand(state, { t: 'NEXT_ROUND' });
          expect(next.error).toBeUndefined();
          state = next.state;
        }
      }

      expect(state.phase).toBe('game_end');
      expect(state.players.filter((p) => p.alive)).toHaveLength(1);
      const total =
        state.deck.length +
        state.discard.length +
        state.players.reduce((acc, p) => acc + p.hand.length, 0) +
        (state.pendingPlay?.cards.length ?? 0);
      expect(total).toBe(20);
      // 牌堆 + 弃牌 + 手牌 + 桌上未结算 恒等于 20，说明回收重洗没有丢牌
      expect(steps).toBeLessThan(6000);
    });
  }

  it('2 人局轮到对手后立刻能质疑', () => {
    const g = createGame({ names: ['A', 'B'], seed: 55 });
    expect(g.turnSeat).toBe(0);
    const played = applyCommand(g, { t: 'PLAY', seat: 0, cardIds: [g.players[0]!.hand[0]!.id] });
    expect(played.state.turnSeat).toBe(1);
    const ch = applyCommand(played.state, { t: 'CHALLENGE', seat: 1 });
    expect(ch.error).toBeUndefined();
  });
});
