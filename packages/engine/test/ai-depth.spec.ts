import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  chooseAction,
  choosePlayCount,
  createGame,
  MAX_PLAY,
  pickCards,
  Rng,
  shouldChallenge,
  type AiOptions,
  type Card,
  type GameState,
} from '../src';

const NAMES = ['甲', '乙', '丙', '丁'];

function card(rank: Card['rank'], suit: Card['suit'] = 'S', tag = ''): Card {
  return { id: `${rank}${suit}${tag}`, rank, suit };
}

function base(seed = 42): GameState {
  return createGame({ names: NAMES, seed });
}

/** 固定随机数：测试里所有策略分支都要可复现 */
const constant = (v: number) => () => v;

function idsOf(cmd: ReturnType<typeof chooseAction>): string[] {
  return 'cardIds' in cmd ? cmd.cardIds : [];
}

describe('出牌张数策略', () => {
  it('整手都是真牌 → 一把出满（清空手牌即赢这一轮）', () => {
    const g = base();
    const seat = g.turnSeat;
    const target = g.targetRank as Card['rank'];
    g.players[seat]!.hand = Array.from({ length: 4 }, (_, i) => card(target, 'S', `t${i}`));

    const cmd = chooseAction(g, seat, { random: constant(0.5), aggression: 0.5 });
    expect(cmd.t).toBe('PLAY');
    expect(idsOf(cmd)).toHaveLength(MAX_PLAY);
    for (const id of idsOf(cmd)) expect(id.startsWith(target)).toBe(true);
  });

  it('只剩 2 张真牌 → 两张一起出，直接打空', () => {
    const g = base(11);
    const seat = g.turnSeat;
    const target = g.targetRank as Card['rank'];
    g.players[seat]!.hand = [card(target, 'S', 'a'), card(target, 'H', 'b')];

    const cmd = chooseAction(g, seat, { random: constant(0.5), aggression: 0.5 });
    expect(idsOf(cmd)).toHaveLength(2);
    expect(cmd.t).toBe('PLAY');
  });

  it('敢不敢一把清空由胆量决定（同样随机数下结果不同）', () => {
    const mk = () => {
      const g = base(12);
      const seat = g.turnSeat;
      const target = g.targetRank as Card['rank'];
      const lie = (['Q', 'K', 'A'] as const).find((r) => r !== target)!;
      g.players[seat]!.hand = [card(target, 'S', 'a'), card(lie, 'H', 'b')];
      return { g, seat };
    };
    const bold = mk();
    const timid = mk();
    expect(
      idsOf(chooseAction(bold.g, bold.seat, { random: constant(0.5), aggression: 0.95 })),
    ).toHaveLength(2);
    expect(
      idsOf(chooseAction(timid.g, timid.seat, { random: constant(0.5), aggression: 0.1 })),
    ).toHaveLength(1);
  });

  it('手牌还多时，两张真牌就出两张施压', () => {
    const g = base(13);
    const seat = g.turnSeat;
    const target = g.targetRank as Card['rank'];
    const lie = (['Q', 'K', 'A'] as const).find((r) => r !== target)!;
    g.players[seat]!.hand = [
      card(target, 'S', 'a'),
      card(target, 'H', 'b'),
      card(lie, 'S', 'c'),
      card(lie, 'H', 'd'),
      card(lie, 'D', 'e'),
    ];
    expect(idsOf(chooseAction(g, seat, { random: constant(0.2), aggression: 0.5 }))).toHaveLength(2);
    // 随机数不利时退回 1 张（别把牌一次性摊在桌上）
    expect(idsOf(chooseAction(g, seat, { random: constant(0.9), aggression: 0.5 }))).toHaveLength(1);
  });

  it('choosePlayCount 永远落在 1..min(3, 手牌数)', () => {
    for (let handSize = 0; handSize <= 6; handSize += 1) {
      for (let truthful = 0; truthful <= handSize; truthful += 1) {
        for (const r of [0, 0.05, 0.2, 0.5, 0.8, 0.99]) {
          for (const aggression of [0, 0.5, 1]) {
            const n = choosePlayCount({ handSize, truthful, aggression, random: constant(r) });
            if (handSize === 0) expect(n).toBe(0);
            else {
              expect(n).toBeGreaterThanOrEqual(1);
              expect(n).toBeLessThanOrEqual(Math.min(MAX_PLAY, handSize));
            }
          }
        }
      }
    }
  });

  it('只能撒谎时默认只出 1 张，手牌多时偶尔虚张声势', () => {
    expect(choosePlayCount({ handSize: 5, truthful: 0, aggression: 0.5, random: constant(0.5) })).toBe(1);
    expect(choosePlayCount({ handSize: 5, truthful: 0, aggression: 0.5, random: constant(0.05) })).toBe(2);
  });
});

describe('选牌：先花真牌，赖子留后手', () => {
  const target = 'Q' as const;

  it('只出 1 张时优先花真目标点数，不动赖子', () => {
    const hand = [card('JOKER', 'S', '1'), card('Q', 'S', 'a'), card('K', 'H', 'b')];
    expect(pickCards(hand, target, 1, true)[0]!.id).toBe('QSa');
  });

  it('要多张时真点数在前、赖子在后', () => {
    const hand = [card('JOKER', 'S', '1'), card('Q', 'S', 'a'), card('K', 'H', 'b')];
    const picked = pickCards(hand, target, 2, true).map((c) => c.id);
    expect(picked).toEqual(['QSa', 'JOKERS1']);
  });

  it('诈牌路线先丢假牌', () => {
    const hand = [card('Q', 'S', 'a'), card('JOKER', 'S', '1'), card('K', 'H', 'b')];
    const picked = pickCards(hand, target, 1, false).map((c) => c.id);
    expect(picked).toEqual(['KHb']);
  });
});

describe('质疑：概率推理', () => {
  const base_input = {
    remainingRank: 6,
    unseenTotal: 15,
    claimCount: 1,
    history: 0,
    lastChance: false,
    aggression: 0.9,
  };

  it('不可能是真的 → 必抓，与随机数无关', () => {
    expect(shouldChallenge({ ...base_input, remainingRank: 0, random: constant(0.999) })).toBe(true);
    expect(
      shouldChallenge({ ...base_input, remainingRank: 2, claimCount: 3, random: constant(0.999) }),
    ).toBe(true);
  });

  it('可能为真时按概率决定（同一随机数，前科越多越敢抓）', () => {
    expect(shouldChallenge({ ...base_input, aggression: 0.9, random: constant(0.3) })).toBe(true);
    expect(shouldChallenge({ ...base_input, aggression: 0.9, random: constant(0.4) })).toBe(false);
    expect(
      shouldChallenge({ ...base_input, history: 3, aggression: 0.9, random: constant(0.5) }),
    ).toBe(true);
    expect(shouldChallenge({ ...base_input, aggression: 0.9, random: constant(0.5) })).toBe(false);
  });

  it('对手刚打空手牌 → 最后机会，阈值放宽', () => {
    const notLast = shouldChallenge({ ...base_input, aggression: 0.9, random: constant(0.4) });
    const last = shouldChallenge({
      ...base_input,
      aggression: 0.9,
      lastChance: true,
      random: constant(0.4),
    });
    expect(notLast).toBe(false);
    expect(last).toBe(true);
  });

  it('多疑的 AI 抓得更勤（逐档上调胆量，抓的意愿单调上升）', () => {
    const at = (aggression: number, claimCount = 1) =>
      shouldChallenge({ ...base_input, claimCount, aggression, random: constant(0.2) });
    // 声明 1 张：先验真话概率 0.36 → 敢抓度 ≈ aggression × 0.55 × 0.64
    expect(at(0.1)).toBe(false); // 0.035
    expect(at(0.95)).toBe(true); // 0.334
    // 声明 2 张更可疑，同样的胆量就该抓
    expect(at(0.1, 2)).toBe(false); // 0.049
    expect(at(0.95, 2)).toBe(true); // 0.462
  });
});

describe('AI 在边界状态下不会出非法手', () => {
  it('手里没牌但桌上有牌 → 强制质疑，而不是出空牌卡死', () => {
    const g = base(21);
    const seat = g.turnSeat;
    const other = (seat + 1) % g.players.length;
    const cards = g.players[other]!.hand.slice(0, 1);
    g.players[other]!.hand = g.players[other]!.hand.slice(1);
    g.players[seat]!.hand = [];
    g.pendingPlay = { seat: other, cards, claimCount: 1 };

    const cmd = chooseAction(g, seat, { random: constant(0.999) });
    expect(cmd.t).toBe('CHALLENGE');
  });

  it('自己手里攥着大半目标点数 → 对方声明张数超限，必抓', () => {
    const g = base(22);
    const seat = g.turnSeat;
    const other = (seat + 1) % g.players.length;
    const target = g.targetRank as Card['rank'];
    const lie = (['Q', 'K', 'A'] as const).find((r) => r !== target)!;
    g.players[seat]!.hand = [
      card(target, 'S', 'm1'),
      card(target, 'H', 'm2'),
      card(target, 'D', 'm3'),
      card(target, 'C', 'm4'),
      card(lie, 'S', 'm5'),
    ];
    const cards = g.players[other]!.hand.slice(0, 3);
    g.players[other]!.hand = g.players[other]!.hand.slice(3);
    g.pendingPlay = { seat: other, cards, claimCount: 3 };

    expect(chooseAction(g, seat, { random: constant(0.999) }).t).toBe('CHALLENGE');
  });
});

describe('AI 自对弈（只用公开信息的策略跑完整局）', () => {
  it('能自己打到终局，中途会出多张、也会抓人', () => {
    let g = createGame({ names: NAMES, seed: 4242 });
    const rng = new Rng(31337);
    const random = () => rng.next();
    let steps = 0;
    let multi = 0;
    let challenges = 0;
    let maxPlayed = 0;

    for (let i = 0; i < 4000 && g.phase !== 'game_end'; i += 1) {
      if (g.phase === 'round_end') {
        g = applyCommand(g, { t: 'NEXT_ROUND' }).state;
        continue;
      }
      const seat = g.turnSeat;
      const cmd = chooseAction(g, seat, { random });
      const res = applyCommand(g, cmd);
      expect(res.error, `AI 出了非法指令 ${cmd.t}: ${res.error}`).toBeFalsy();
      if (cmd.t === 'PLAY') {
        if (cmd.cardIds.length > 1) multi += 1;
        maxPlayed = Math.max(maxPlayed, cmd.cardIds.length);
      }
      if (cmd.t === 'CHALLENGE') challenges += 1;
      g = res.state;
      steps += 1;
    }

    expect(g.phase).toBe('game_end');
    expect(steps).toBeLessThan(4000);
    expect(g.players.filter((p) => p.alive)).toHaveLength(1);
    // 「出多张施压」这条策略在真实对局里确实会出现，而不是永远 1 张
    expect(multi).toBeGreaterThan(0);
    expect(maxPlayed).toBeLessThanOrEqual(MAX_PLAY);
    expect(challenges).toBeGreaterThan(0);
  });
});

/** 用相同的 256 个种子重放同一决策，只改变要对比的性格参数。 */
function sampleDecisions(game: GameState, options: AiOptions) {
  return Array.from({ length: 256 }, (_, seed) => {
    const rng = new Rng(seed);
    return chooseAction(game, game.turnSeat, { ...options, random: () => rng.next() });
  });
}

describe('狐狸与乌鸦的局面倾向', () => {
  it.each(['Q', 'JOKER'] as const)('狐狸在一真一假时更常单出假牌，保留 %s', (truth) => {
    const game = base();
    game.targetRank = 'Q';
    const hand = [card(truth), card('K')];
    game.players[game.turnSeat]!.hand = hand;
    const options = { aggression: 0.62, lieBias: 0.45 };
    const before = sampleDecisions(game, options);
    const after = sampleDecisions(game, { ...options, tactic: 'reserveTruth' });
    // 只数单独打出 K 的次数，避免把一次清空两张也计入「留真出假」。
    const singleLie = (cmd: ReturnType<typeof chooseAction>) => idsOf(cmd).join() === 'KS';
    expect(after.filter(singleLie).length).toBeGreaterThan(before.filter(singleLie).length + 50);
    expect(after.some(cmd => idsOf(cmd).join() === hand[0]!.id)).toBe(true);
    hand.push(card('A'));
    expect(sampleDecisions(game, { ...options, tactic: 'reserveTruth' })).toEqual(sampleDecisions(game, options));
  });

  it('乌鸦对三张更常质疑，也会跟牌；一张和两张声明沿用基础性格', () => {
    const game = base();
    game.targetRank = 'Q';
    const seat = game.turnSeat;
    game.players[seat]!.hand = [card('Q'), card('K')];
    const options = { aggression: 0.48, lieBias: 0.52 };
    for (const count of [1, 2, 3]) {
      game.pendingPlay = { seat: (seat + 1) % 4, cards: game.players[(seat + 1) % 4]!.hand.slice(0, count), claimCount: count };
      const before = sampleDecisions(game, options);
      const after = sampleDecisions(game, { ...options, tactic: 'doubtTriple' });
      if (count < 3) {
        expect(after).toEqual(before);
      } else {
        const challenges = after.filter(cmd => cmd.t === 'CHALLENGE').length;
        expect(challenges).toBeGreaterThan(before.filter(cmd => cmd.t === 'CHALLENGE').length + 20);
        expect(after.some(cmd => cmd.t === 'PLAY')).toBe(true);
        // 偷换对手暗牌，公开局面不动，AI 的每一次决定都应该保持一致。
        game.pendingPlay.cards = [card('K'), card('Q'), card('A')];
        expect(sampleDecisions(game, { ...options, tactic: 'doubtTriple' })).toEqual(after);
      }
    }
  });
});
