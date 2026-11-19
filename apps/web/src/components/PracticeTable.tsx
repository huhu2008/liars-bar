import { useState } from 'react';
import { applyCommand, createGame, project } from '@liars/engine';
import { CardBack, CardFace, RankBadge } from './Cards';
import { ModalDialog } from './ModalDialog';

/** 固定种子按正式规则发牌：目标 Q，玩家持 K，鸦先生持有一张王牌。 */
function dealPractice() {
  return createGame({ names: ['你', '鸦先生'], botSeats: [1], seed: 2 });
}

/** 练习桌只持有本组件的牌局；退出、重新发牌和揭牌均不触发正式对局调度。 */
export function PracticeTable({ onClose }: { onClose: () => void }) {
  const [game, setGame] = useState(dealPractice);
  const [selected, setSelected] = useState<string | null>(null);
  const view = project(game, 0);
  const reveal = view.lastReveal;
  const pending = view.pendingPlay;
  const rank = view.targetRank!;
  const selectedCard = view.me.hand.find(card => card.id === selected);

  /** 玩家主动诈唬后，对手放过这张 K，用规则引擎打出提前安排的盖牌。 */
  function bluff() {
    if (selectedCard?.rank !== 'K') return;
    const human = applyCommand(game, { t: 'PLAY', seat: 0, cardIds: [selectedCard.id] });
    if (human.error) return;
    const joker = human.state.players[1]!.hand.find(card => card.rank === 'JOKER')!;
    const opponent = applyCommand(human.state, { t: 'PLAY', seat: 1, cardIds: [joker.id] });
    if (opponent.error) return;
    setGame(opponent.state);
    setSelected(null);
  }

  /** 和正式牌桌使用同一条质疑命令，让引擎决定谁受罚。 */
  function challenge() {
    const result = applyCommand(game, { t: 'CHALLENGE', seat: 0 });
    if (!result.error) setGame(result.state);
  }

  /** 从同一副牌重新开始，便于重复对照盖牌和翻牌结果。 */
  function replay() {
    setSelected(null);
    setGame(dealPractice());
  }

  return (
    <ModalDialog label="两分钟练习桌" onClose={onClose} className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/85 p-3 backdrop-blur-sm">
      <section className="w-full max-w-md rounded-xl border border-brass-500/40 bg-[#19100c] p-4 text-amber-100 shadow-2xl sm:p-6">
        <header className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl text-brass-300">两分钟练习桌</h2>
          <button type="button" className="rounded border border-amber-900 px-3 py-2 text-xs" onClick={onClose}>退出练习</button>
        </header>
        <div className="flex items-center gap-2 border-b border-brass-500/20 pb-3 text-sm">
          本轮声明点数 <RankBadge rank={rank} />
        </div>
        <div aria-live="polite" className="my-4 text-sm leading-relaxed">
          {reveal ? (
            <>
              <h3 className="mb-1 font-semibold text-brass-300">练习完成 · {reveal.truthful ? '他说的是真话' : '你抓到了谎言'}</h3>
              <p>翻开的是王牌，可以当作本轮的 {rank}。{view.seats[reveal.punishedSeat]?.name}质疑失误，需要受罚。</p>
            </>
          ) : pending ? (
            <>
              <h3 className="mb-1 font-semibold text-brass-300">轮到你质疑</h3>
              <p>鸦先生放过了你的 K，又扣下 {pending.count} 张，说是 {rank}。点「质疑」翻开他的牌。</p>
            </>
          ) : (
            <>
              <h3 className="mb-1 font-semibold text-brass-300">试一次诈唬</h3>
              <p>从手里选一张 K，扣到桌上，却告诉鸦先生你出的是 {rank}。对手只能看到你出了几张。</p>
            </>
          )}
        </div>
        {reveal ? (
          <div className="mb-5 flex justify-center">{reveal.cards.map(card => <CardFace key={card.id} card={card} />)}</div>
        ) : pending ? (
          <div className="mb-5 flex justify-center"><CardBack /></div>
        ) : (
          <div aria-label="你的手牌" className="mb-4 flex flex-wrap justify-center gap-1 pt-3">
            {view.me.hand.map(card => <CardFace key={card.id} card={card} selected={selected === card.id} disabled={card.rank !== 'K'} onClick={() => setSelected(card.id)} />)}
          </div>
        )}
        {reveal ? (
          <div className="flex gap-2">
            <button type="button" className="flex-1 rounded border border-brass-500/50 py-2" onClick={replay}>再练一次</button>
            <button type="button" className="btn-brass flex-1 py-2" onClick={onClose}>返回选角</button>
          </div>
        ) : pending ? (
          <button type="button" className="btn-brass w-full py-2" onClick={challenge}>质疑鸦先生</button>
        ) : (
          <button type="button" className="btn-brass w-full py-2 disabled:opacity-40" disabled={!selectedCard} onClick={bluff}>出牌，声称是 {rank}</button>
        )}
      </section>
    </ModalDialog>
  );
}
