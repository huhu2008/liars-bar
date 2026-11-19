import { JOKER_RANK, type Card, type PlayerView } from '@liars/engine';

/** 翻牌演出沿用可暂停的游戏时钟，记录玩家已经看清的张数。 */
export interface ChallengeReveal {
  before: PlayerView;
  startedAt: number | null;
  turned: number;
  reducedMotion: boolean;
}

export const FLIP_DURATION_MS = 420;
export const FLIP_INTERVAL_MS = 150;

/** 赖子可代替目标点数，第一张不合点数的普通牌才足以证伪。 */
export function firstMismatch(cards: readonly Card[], targetRank: PlayerView['targetRank']): number {
  return cards.findIndex(card => card.rank !== JOKER_RANK && card.rank !== targetRank);
}

/** 日志、角色反应与记牌器只看到演出已经公开的内容；枪响之前保留质疑前的座位状态。 */
export function presentedTable(view: PlayerView, stage: ChallengeReveal | null): PlayerView {
  const reveal = view.lastReveal;
  if (!stage || !reveal) return view;
  const mismatch = firstMismatch(reveal.cards, view.targetRank);
  const verdictKnown = stage.turned >= (mismatch < 0 ? reveal.cards.length : mismatch + 1);
  const publicCards = stage.before.publicCards.concat(reveal.cards.slice(0, stage.turned));
  const lastSeq = stage.before.log.at(-1)?.seq ?? -1;
  return {
    ...stage.before,
    phase: 'round_end',
    pendingPlay: null,
    lastReveal: verdictKnown ? reveal : null,
    publicCards,
    rankRemaining: stage.before.rankRemaining - reveal.cards.slice(0, stage.turned).filter(card => card.rank === view.targetRank).length,
    log: view.log.filter(entry => entry.seq <= lastSeq || entry.kind === 'challenge' || (entry.kind === 'reveal' && verdictKnown)),
  };
}
