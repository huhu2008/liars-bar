import { clearGameTimeout, gameNow, setGameTimeout } from '../gameClock';
import type { PlayerView } from '@liars/engine';
import { asset } from '../data/assetPath';
import { firstMismatch } from '../data/challengeReveal';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { CardFace } from './Cards';
import { aggregateStats } from '@liars/engine';
import { awaitingSpectatorChoice, useGame } from '../store';

export function RevealOverlay({ view, ready = true }: { view: PlayerView; ready?: boolean }) {
  const records = useGame((s) => s.records);
  const stats = aggregateStats(records);
  const nextRound = useGame((s) => s.nextRound);
  const restart = useGame((s) => s.restart);
  const reveal = view.lastReveal;
  const mismatch = reveal ? firstMismatch(reveal.cards, view.targetRank) : -1;
  const reducedMotion = useReducedMotion();
  const inReveal = ready && (view.phase === 'round_end' || view.phase === 'game_end') && !!reveal;

  // 演出（质疑 → 翻牌 → 举枪 → 开枪）全部播完后，store 会给出一个时刻；
  // 到点才弹面板，不再靠布尔标志对齐。
  const revealAt = useGame((st) => st.revealAt);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!inReveal || revealAt === null) {
      setShown(false);
      return;
    }
    // 结算只在演出确实排定后出现，慢速语音和后台切换都不能提前揭晓。
    const wait = Math.max(0, revealAt - gameNow());
    const t = setGameTimeout(() => setShown(true), wait);
    return () => clearGameTimeout(t);
  }, [inReveal, revealAt, view.round]);

  const open = inReveal && shown;

  const nameOf = (seat: number) => view.seats.find((s) => s.seat === seat)?.name ?? '???';

  return (
    <AnimatePresence>
      {open && reveal && (
        <motion.div
          key={`${view.round}-${reveal.punishedSeat}`}
          className="fixed inset-0 z-30 grid place-items-center bg-black/75 p-2 backdrop-blur-sm sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="本轮结算"
          initial={reducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: reducedMotion ? 1 : 0 }}
        >
          <motion.div
            className="panel-art relative max-h-[calc(100dvh-1rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-brass-500/40 p-4 shadow-[0_0_60px_rgba(0,0,0,0.8)] sm:max-h-[92dvh] sm:p-6"
            style={{
              // 用牌桌素材做底纹：和「翻牌」呼应，压暗后不抢内容
              backgroundImage: `url(${asset('assets/table/felt-panel.jpg')})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundColor: '#1a0f08',
            }}
            initial={reducedMotion ? false : { y: 24, scale: 0.96 }}
            animate={{ y: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 220, damping: 22 }}
          >
            <div className="mb-1 text-center text-[11px] uppercase tracking-[0.35em] text-amber-200/40">
              第 {view.round} 轮结算
            </div>
            <img
              src={reveal.died ? asset('assets/ui/badge-alert.png') : asset('assets/ui/star.png')}
              alt=""
              className="mx-auto mb-2 h-10 w-10 opacity-90"
            />
            <h2 className="mb-3 text-center font-display text-xl text-brass-400 sm:mb-4 sm:text-2xl">
              {reveal.truthful ? `${nameOf(reveal.playSeat)} 说的是实话` : `${nameOf(reveal.playSeat)} 撒谎了`}
            </h2>

            {/* 只展示实际揭开的牌，避免背景牌影干扰张数判断。 */}
            <div className="mb-3 flex justify-center gap-2">
              {reveal.cards.map((c, i) => (
                <div key={c.id} className="flex flex-col items-center gap-1">
                  <CardFace card={c} className={mismatch === i ? 'outline outline-2 outline-red-400' : mismatch < 0 ? 'outline outline-1 outline-amber-400' : ''} />
                  {mismatch === i && <span className="text-[10px] font-semibold text-red-200">与声明不符</span>}
                </div>
              ))}
            </div>

            {/* 把「为什么」写清楚：声称什么、实际是什么 */}
            <div className="mb-4 text-center text-[12px] leading-relaxed text-amber-100/70">
              {(() => {
                const claimed = reveal.cards.length;
                const actual = reveal.cards.map(card => card.rank === 'JOKER' ? '赖子' : card.rank).join('、');
                if (reveal.truthful) {
                  return <>声明属实。{reveal.cards.some(card => card.rank === 'JOKER')
                    ? <>翻开的是 {actual}，赖子可以当作 {view.targetRank}。</>
                    : <>翻开的 {claimed} 张都是 {view.targetRank}。</>}</>;
                }
                return (
                  <>
                    {nameOf(reveal.playSeat)} 声称这 {claimed} 张全是{' '}
                    <b className="text-brass-400">{view.targetRank}</b>，翻开是{' '}
                    <b className="text-red-300">{actual}</b>。
                  </>
                );
              })()}
            </div>

            {/* 各家的剩余手牌，一眼看出谁快出完了 */}
            <div className="mb-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px]">
              {view.seats.map((s) => (
                <span key={s.seat} className={s.alive ? 'text-amber-100/60' : 'text-amber-100/25 line-through'}>
                  {s.name}
                  <b className="ml-1 font-medium text-brass-400">{s.cardCount}</b>
                </span>
              ))}
            </div>

            <div className="mb-4 flex items-center justify-center gap-3 text-[12px]">
              <span className="text-amber-200/60">目标点数</span>
              <span className="rounded bg-brass-500/20 px-2 py-0.5 font-bold text-brass-400">
                {view.targetRank}
              </span>
              <span className="text-amber-200/60">受罚</span>
              <span className="font-medium text-amber-50">{nameOf(reveal.punishedSeat)}</span>
            </div>

            <div
              className={`mb-5 rounded-lg border px-4 py-3 text-center text-[12px] ${
                reveal.died
                  ? 'border-red-800/60 bg-red-950/40 text-red-200'
                  : 'border-emerald-800/50 bg-emerald-950/30 text-emerald-200'
              }`}
            >
              {reveal.died ? (
                <>
                  第 {reveal.chamber + 1} 号弹仓有子弹 —— {nameOf(reveal.punishedSeat)} 出局
                </>
              ) : (
                <>
                  空枪！活下来了，弹仓里现在 {Math.min(6, reveal.bullets + 1)} / 6 发
                </>
              )}
            </div>

            {/* 跨局战绩：让「再来一局」有累积感 */}
            {stats.matches > 0 && (
              <div className="mb-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-amber-100/45">
                <span>
                  战绩 <b className="text-brass-400">{stats.wins}</b> 胜{' '}
                  <b className="text-amber-100/60">{stats.losses}</b> 负
                </span>
                {stats.longestStreak > 1 && (
                  <span>
                    最长连胜 <b className="text-brass-400">{stats.longestStreak}</b>
                  </span>
                )}
                <span>
                  胜率 <b className="text-amber-100/60">{Math.round(stats.winRate * 100)}%</b>
                </span>
                {stats.mostLiedRank && (
                  <span>
                    最常被骗 <b className="text-red-300/80">{stats.mostLiedRank}</b>
                  </span>
                )}
              </div>
            )}

            {view.phase === 'game_end' ? (
              <div className="flex flex-col items-center gap-3">
                <div className="text-center font-display text-xl text-brass-400">
                  {view.winnerSeat !== null ? `${nameOf(view.winnerSeat)} 活着离开了酒馆` : '酒馆空了'}
                </div>
                <button type="button" className="btn-brass w-full" onClick={restart}>
                  再来一局
                </button>
              </div>
            ) : awaitingSpectatorChoice(view) ? (
              <div className="grid grid-cols-2 gap-3">
                <button type="button" className="btn-ghost" onClick={nextRound}>继续观战</button>
                <button type="button" className="btn-brass" onClick={restart}>再开一桌</button>
              </div>
            ) : (
              <button
                type="button"
                className="btn-ghost relative w-full overflow-hidden"
                onClick={nextRound}
              >
                {/* 自动继续的倒计时：2.2 秒后自己进下一轮，让人知道在等什么 */}
                {!reducedMotion && <motion.span
                  className="pointer-events-none absolute inset-y-0 left-0 bg-brass-500/25"
                  initial={{ width: '0%' }}
                  animate={{ width: '100%' }}
                  transition={{ duration: 2.2, ease: 'linear' }}
                />}
                <span className="relative">继续下一轮</span>
              </button>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
