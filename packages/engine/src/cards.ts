import { JOKER_RANK, type Card } from './types';

/**
 * 官方牌堆：Q×6 + K×6 + A×6 + 赖子×2 = 20 张，4 人局每人 5 张正好发完。
 * 目标点数只从 Q/K/A 里抽（TABLE_RANKS），桌面牌是虚拟牌、不从牌堆里出。
 */
export const COPIES_PER_RANK = 6;
export const JOKER_COPIES = 2;
/** 牌堆总张数：所有守恒检查（deck + discard + hands + pendingPlay）的基准 */
export const DECK_SIZE = COPIES_PER_RANK * 3 + JOKER_COPIES;

export function createDeck(): Card[] {
  const deck: Card[] = [];
  const suits = ['S', 'H', 'D', 'C'] as const;
  for (const rank of ['Q', 'K', 'A'] as const) {
    for (let i = 0; i < COPIES_PER_RANK; i += 1) {
      // 第 5/6 张会重复花色，用下标后缀保证 id 唯一（id 是牌张守恒的唯一凭据）
      deck.push({ id: `${rank}${suits[i % 4]}${i < 4 ? '' : `_${i}`}`, rank, suit: suits[i % 4] });
    }
  }
  deck.push({ id: 'JOKER_1', rank: JOKER_RANK, suit: 'S' });
  deck.push({ id: 'JOKER_2', rank: JOKER_RANK, suit: 'H' });
  return deck;
}

export const RANK_LABEL: Record<string, string> = {
  A: 'A',
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
  '6': '6',
  '7': '7',
  '8': '8',
  '9': '9',
  '10': '10',
  J: 'J',
  Q: 'Q',
  K: 'K',
};

export const SUIT_GLYPH: Record<string, string> = {
  S: '♠',
  H: '♥',
  D: '♦',
  C: '♣',
};
