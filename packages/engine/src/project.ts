import { rankRemainingFor } from './knowledge';
import type { GameState, PlayerView, SeatView } from './types';

/**
 * 完整状态 → 某个座位能看到的视图。
 * 这是防作弊的唯一闸门：服务端只允许把 project() 的结果下发客户端。
 */
export function project(state: GameState, seat: number): PlayerView {
  const me = state.players[seat];
  if (!me) throw new Error(`seat ${seat} not found`);

  const seats: SeatView[] = state.players.map((p) => ({
    seat: p.seat,
    name: p.name,
    alive: p.alive,
    cardCount: p.hand.length,
    isBot: p.isBot,
  }));

  return {
    seat,
    round: state.round,
    phase: state.phase,
    targetRank: state.targetRank,
    tableCard: state.tableCard,
    me: { seat: me.seat, name: me.name, hand: me.hand.map((c) => ({ ...c })), alive: me.alive },
    seats,
    turnSeat: state.turnSeat,
    bullets: state.bullets,
    deckCount: state.deck.length,
    discardCount: state.discard.length,
    pendingPlay: state.pendingPlay
      ? { seat: state.pendingPlay.seat, count: state.pendingPlay.claimCount }
      : null,
    lastReveal: state.lastReveal,
    winnerSeat: state.winnerSeat,
    roundWinnerSeat: state.roundWinnerSeat,
    myLies: state.liesBySeat[seat] ?? 0,
    // 公开信息：本轮翻开过的牌 + 由「我的手牌 + 已公开牌」推出的目标点数剩余张数
    publicCards: state.publicCards.map((c) => ({ ...c })),
    rankRemaining: state.targetRank
      ? rankRemainingFor(state, state.targetRank, me.hand)
      : 0,
    log: state.log,
  };
}
