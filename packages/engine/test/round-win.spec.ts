import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  CHAMBERS,
  createGame,
  DECK_SIZE,
  HAND_SIZE,
  legalActions,
  MAX_SEATS,
  Rng,
  type Card,
  type GameState,
  type TableRank,
} from '../src';

const NAMES = ['甲', '乙', '丙', '丁'];

function total(s: GameState): number {
  return (
    s.deck.length +
    s.discard.length +
    s.players.reduce((n, p) => n + p.hand.length, 0) +
    (s.pendingPlay?.cards.length ?? 0)
  );
}

/** 把 rng 拨到一个「第几发子弹」可控的位置：枪响是唯一用随机数的地方 */
function forceChamber(state: GameState, bullets: number, wantDeath: boolean): void {
  for (let r = 1; r < 100000; r += 1) {
    const chamber = new Rng(r).int(CHAMBERS);
    if (chamber < bullets === wantDeath) {
      state.rng = r;
      state.bullets = bullets;
      return;
    }
  }
  throw new Error('找不到合适的 rng');
}

/**
 * 让某个座位只剩 1 张指定条件的牌，其余牌退回弃牌堆（保证牌张守恒不被测试破坏）。
 */
function keepOnlyOne(
  state: GameState,
  seat: number,
  pick: (c: Card) => boolean,
): Card | null {
  const hand = state.players[seat]!.hand;
  const index = hand.findIndex(pick);
  if (index < 0) return null;
  const kept = hand[index] as Card;
  const rest = hand.filter((_, i) => i !== index);
  state.discard.push(...rest);
  state.players[seat]!.hand = [kept];
  return kept;
}

describe('打完手牌：两条路径的边界', () => {
  it('路径 A：下家出牌放行 → 本轮结束，ROUND_END 带上真正的赢家', () => {
    const g = createGame({ names: NAMES, seed: 42 });
    const seat = g.turnSeat;
    const hand = g.players[seat]!.hand;
    const cards = hand.slice(0, 2).map((c) => c.id);
    g.discard.push(...hand.slice(2));
    g.players[seat]!.hand = hand.slice(0, 2);

    const played = applyCommand(g, { t: 'PLAY', seat, cardIds: cards });
    expect(played.error).toBeFalsy();
    expect(played.state.players[seat]!.hand).toHaveLength(0);
    expect(played.state.roundWinnerSeat).toBe(seat);
    // 还没结束：下家仍然可以选择质疑
    expect(played.state.phase).toBe('turn');

    const next = played.state.turnSeat;
    expect(legalActions(played.state, next).lastChance).toBe(true);

    const pass = applyCommand(played.state, {
      t: 'PLAY',
      seat: next,
      cardIds: [played.state.players[next]!.hand[0]!.id],
    });
    expect(pass.error).toBeFalsy();
    expect(pass.state.phase).toBe('round_end');
    const end = pass.events.find((e) => e.t === 'ROUND_END');
    expect(end).toEqual({ t: 'ROUND_END', winnerSeat: seat });
    // 桌上那手牌被回收，牌张一张不少
    expect(pass.state.pendingPlay).toBeNull();
    expect(total(pass.state)).toBe(DECK_SIZE);
  });

  it('路径 B：下家质疑且打空的人说的是真话 → 他依然赢下这一轮', () => {
    const g = createGame({ names: NAMES, seed: 7 });
    const seat = g.turnSeat;
    const hold = keepOnlyOne(g, seat, (c) => c.rank !== 'JOKER');
    expect(hold).toBeTruthy();
    g.targetRank = hold!.rank as TableRank;
    g.tableCard = { id: `TABLE_${hold!.rank}`, rank: hold!.rank, suit: 'S' } as Card;

    const played = applyCommand(g, { t: 'PLAY', seat, cardIds: [hold!.id] });
    expect(played.error).toBeFalsy();
    expect(played.state.roundWinnerSeat).toBe(seat);

    forceChamber(played.state, 1, false); // 让这一枪是空枪，方便断言
    const res = applyCommand(played.state, {
      t: 'CHALLENGE',
      seat: played.state.turnSeat,
    });
    expect(res.error).toBeFalsy();
    expect(res.state.lastReveal?.truthful).toBe(true);
    expect(res.state.lastReveal?.died).toBe(false);
    expect(res.state.phase).toBe('round_end');
    expect(res.state.roundWinnerSeat).toBe(seat);
    const end = res.events.find((e) => e.t === 'ROUND_END');
    expect(end).toEqual({ t: 'ROUND_END', winnerSeat: seat });
    expect(total(res.state)).toBe(DECK_SIZE);
  });

  it('路径 B：下家质疑且打空的人撒谎 → 本轮赢面作废', () => {
    const g = createGame({ names: NAMES, seed: 9 });
    const seat = g.turnSeat;
    const hold = keepOnlyOne(g, seat, (c) => c.rank !== 'JOKER');
    expect(hold).toBeTruthy();
    const other: TableRank = hold!.rank === 'Q' ? 'K' : 'Q';
    g.targetRank = other;
    g.tableCard = { id: `TABLE_${other}`, rank: other, suit: 'S' } as Card;

    const played = applyCommand(g, { t: 'PLAY', seat, cardIds: [hold!.id] });
    expect(played.state.roundWinnerSeat).toBe(seat);

    forceChamber(played.state, 1, false);
    const res = applyCommand(played.state, {
      t: 'CHALLENGE',
      seat: played.state.turnSeat,
    });
    expect(res.state.lastReveal?.truthful).toBe(false);
    expect(res.state.roundWinnerSeat).toBeNull();
    const end = res.events.find((e) => e.t === 'ROUND_END');
    expect(end).toEqual({ t: 'ROUND_END', winnerSeat: null });
    expect(total(res.state)).toBe(DECK_SIZE);
  });

  it('路径 B 之后进入下一轮：赢家标记被清空、重新发满 5 张', () => {
    const g = createGame({ names: NAMES, seed: 7 });
    const seat = g.turnSeat;
    const hold = keepOnlyOne(g, seat, (c) => c.rank !== 'JOKER');
    g.targetRank = hold!.rank as TableRank;
    g.tableCard = { id: `TABLE_${hold!.rank}`, rank: hold!.rank, suit: 'S' } as Card;
    const played = applyCommand(g, { t: 'PLAY', seat, cardIds: [hold!.id] });
    forceChamber(played.state, 1, false);
    const res = applyCommand(played.state, { t: 'CHALLENGE', seat: played.state.turnSeat });
    const next = applyCommand(res.state, { t: 'NEXT_ROUND' });
    expect(next.error).toBeFalsy();
    expect(next.state.roundWinnerSeat).toBeNull();
    expect(next.state.round).toBe(res.state.round + 1);
    for (const p of next.state.players.filter((x) => x.alive)) {
      expect(p.hand).toHaveLength(HAND_SIZE);
    }
    expect(total(next.state)).toBe(DECK_SIZE);
    expect(next.state.publicCards).toHaveLength(0);
  });

  it('不是当前回合的人不能借「放行」通道替别人结束本轮', () => {
    const g = createGame({ names: NAMES, seed: 42 });
    const seat = g.turnSeat;
    const hand = g.players[seat]!.hand;
    g.discard.push(...hand.slice(2));
    g.players[seat]!.hand = hand.slice(0, 2);
    const played = applyCommand(g, {
      t: 'PLAY',
      seat,
      cardIds: hand.slice(0, 2).map((c) => c.id),
    });
    const next = played.state.turnSeat;
    const wrong = (next + 1) % g.players.length;
    const res = applyCommand(played.state, {
      t: 'PLAY',
      seat: wrong,
      cardIds: [played.state.players[wrong]!.hand[0]!.id],
    });
    expect(res.error).toBe('NOT_YOUR_TURN');
    expect(res.state).toBe(played.state); // 失败不得产生新状态
  });
});

describe('翻开的牌是本轮唯一公开信息', () => {
  it('质疑后把牌记进 publicCards，下一轮清空', () => {
    const g = createGame({ names: NAMES, seed: 77 });
    const seat = g.turnSeat;
    const played = applyCommand(g, { t: 'PLAY', seat, cardIds: [g.players[seat]!.hand[0]!.id] });
    expect(played.state.publicCards).toHaveLength(0); // 桌上未揭示的牌不算公开

    forceChamber(played.state, 1, false);
    const res = applyCommand(played.state, { t: 'CHALLENGE', seat: played.state.turnSeat });
    expect(res.state.publicCards).toHaveLength(1);
    expect(res.state.publicCards[0]!.id).toBe(played.state.pendingPlay!.cards[0]!.id);

    const next = applyCommand(res.state, { t: 'NEXT_ROUND' });
    expect(next.state.publicCards).toHaveLength(0);
  });
});

describe('发牌与人数边界', () => {
  it('最多 4 人：牌堆 20 张 / 每人 5 张', () => {
    expect(MAX_SEATS).toBe(4);
    expect(() => createGame({ names: ['a', 'b', 'c', 'd', 'e'], seed: 1 })).toThrow(
      /TOO_MANY_PLAYERS/,
    );
    expect(() => createGame({ names: ['a'], seed: 1 })).toThrow(/NOT_ENOUGH_PLAYERS/);
  });

  it('牌不够时全场一起少发，不会让某个座位饿死', () => {
    const g = createGame({ names: ['甲', '乙'], seed: 3 });
    const all = [...g.deck, ...g.discard, ...g.players.flatMap((p) => p.hand)];
    // 人为制造「牌全在弃牌堆附近、总量只剩 7 张」的极端局面
    g.deck = all.slice(0, 7);
    g.discard = [];
    for (const p of g.players) p.hand = [];
    g.pendingPlay = null;
    g.phase = 'round_end';

    const res = applyCommand(g, { t: 'NEXT_ROUND' });
    expect(res.error).toBeFalsy();
    const hands = res.state.players.map((p) => p.hand.length);
    // floor(7 / 2) = 3：两边一样多，而不是「先轮到的发 5 张、后者发 2 张」
    expect(hands).toEqual([3, 3]);
    expect(total(res.state)).toBe(7);
  });

  it('牌全在弃牌堆时重洗，牌张不增不减', () => {
    const g = createGame({ names: NAMES, seed: 21 });
    // 第 1 轮发完牌堆为 0，把所有人的手牌塞回弃牌堆模拟极端局面
    for (const p of g.players) {
      g.discard.push(...p.hand);
      p.hand = [];
    }
    g.pendingPlay = null;
    g.phase = 'round_end';
    expect(g.deck).toHaveLength(0);
    const res = applyCommand(g, { t: 'NEXT_ROUND' });
    expect(res.error).toBeFalsy();
    for (const p of res.state.players) expect(p.hand).toHaveLength(HAND_SIZE);
    expect(total(res.state)).toBe(DECK_SIZE);
  });
});

describe('随机策略对局的守恒不变量', () => {
  it('AI 自由出牌 400 步，每一步之后都是 20 张', () => {
    let g = createGame({ names: NAMES, seed: 2024 });
    const rng = new Rng(9182);
    const random = () => rng.next();
    let steps = 0;
    for (let i = 0; i < 400; i += 1) {
      if (g.phase === 'round_end') {
        g = applyCommand(g, { t: 'NEXT_ROUND' }).state;
      } else if (g.phase === 'turn') {
        const seat = g.turnSeat;
        // 这里不用 chooseAction：AI 已经由 ai-depth.spec 覆盖，
        // 本用例只要一条「随机的合法动作流」，专门验证守恒。
        const me = g.players[seat]!;
        const decided = rng.int(10);
        const pending = g.pendingPlay;
        let res;
        if (pending && pending.seat !== seat && decided < 3) {
          res = applyCommand(g, { t: 'CHALLENGE', seat });
        } else if (me.hand.length > 0) {
          const count = Math.min(me.hand.length, 1 + rng.int(3));
          res = applyCommand(g, {
            t: 'PLAY',
            seat,
            cardIds: me.hand.slice(0, count).map((c) => c.id),
          });
        } else {
          res = applyCommand(g, { t: 'PASS', seat });
        }
        expect(res.error, `第 ${i} 步失败: ${res.error}`).toBeFalsy();
        g = res.state;
        steps += 1;
      } else break;
      expect(total(g)).toBe(DECK_SIZE);
    }
    // 走到终局：每一手都没出过错、牌数一次也没变
    expect(g.phase).toBe('game_end');
    expect(steps).toBeGreaterThan(10);
    expect(total(g)).toBe(DECK_SIZE);
  });
});
