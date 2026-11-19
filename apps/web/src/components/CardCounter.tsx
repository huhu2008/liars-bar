import {
  COPIES_PER_RANK,
  JOKER_COPIES,
  JOKER_RANK,
  TABLE_RANKS,
  type PlayerView,
} from '@liars/engine';
import { useMemo, useState } from 'react';

/**
 * 记牌器。
 *
 * 骗子酒馆的牌堆是死的：Q×6 + K×6 + A×6 + 赖子×2 = 20 张。
 * 所以「这个点数还有几张没出现」是可以精确算出来的，不需要猜：
 *
 *   剩余 = 该点数总张数 − 我手上的 − 本轮已翻开的
 *
 * 用的是引擎公开口径（和 knowledge.rankRemainingFor 同一个公式）：
 * 只吃 publicCards 和自己的手牌，绝不读别家的手牌与未揭开的弃牌。
 *
 * 默认收起成一行，展开才铺开四行 —— 它是个查询工具，不是常驻 HUD。
 */
export interface CardCounterProps {
  view: PlayerView;
  /** 初始是否展开（默认收起，和「玩法说明」一致） */
  defaultOpen?: boolean;
  className?: string;
}

interface CountRow {
  key: string;
  /** 显示用：Q / K / A / 赖子 */
  label: string;
  total: number;
  /** 我手上的张数 */
  mine: number;
  /** 本轮被翻牌揭开的张数 */
  seen: number;
  /** 还可能藏在别人手里的张数 */
  remaining: number;
}

function buildRow(rank: string, total: number, view: PlayerView): CountRow {
  const hand = view.me?.hand ?? [];
  const pub = view.publicCards ?? [];
  const mine = hand.reduce((n, c) => (c.rank === rank ? n + 1 : n), 0);
  const seen = pub.reduce((n, c) => (c.rank === rank ? n + 1 : n), 0);
  return {
    key: rank,
    label: rank === JOKER_RANK ? '赖子' : rank,
    total,
    mine,
    seen,
    remaining: Math.max(0, total - mine - seen),
  };
}

export function CardCounter({ view, defaultOpen = false, className = '' }: CardCounterProps) {
  const [open, setOpen] = useState(defaultOpen);

  const rows = useMemo(() => {
    const three = TABLE_RANKS.map((r) => buildRow(r, COPIES_PER_RANK, view));
    return [...three, buildRow(JOKER_RANK, JOKER_COPIES, view)];
    // view.me / view.publicCards 引用变化时才重算；project() 每次返回新对象
  }, [view.me, view.publicCards]); // eslint-disable-line react-hooks/exhaustive-deps

  const target = rows.find((r) => r.key === view.targetRank);
  // 折叠时露出最关键的一个数：本轮点数还剩几张
  const headline = view.targetRank
    ? `${view.targetRank} · 剩 ${target?.remaining ?? view.rankRemaining ?? 0}`
    : '本轮未开牌';

  return (
    <div className={`text-[11px] ${className}`} data-testid="card-counter">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="card-counter-body"
        className="flex w-full items-center gap-2 rounded-full border border-amber-800/40 bg-black/40 px-3 py-1.5 tracking-[0.16em] text-amber-200/60 backdrop-blur-sm transition-colors hover:border-amber-600/60 hover:text-amber-100"
      >
        <span className="tracking-[0.2em]">记牌</span>
        <span className="hidden flex-1 truncate text-right text-[10px] tracking-normal text-brass-400/80 sm:block">
          {headline}
        </span>
        <span className="text-[10px] opacity-60">{open ? '收起' : '展开'}</span>
      </button>

      {open && (
        <div
          id="card-counter-body"
          className="velvet mt-2 w-full rounded-xl border border-brass-500/25 p-3 shadow-[0_0_30px_rgba(0,0,0,0.55)]"
        >
          <div className="space-y-1.5">
            {rows.map((row) => (
              <Row key={row.key} row={row} isTarget={row.key === view.targetRank} />
            ))}
          </div>

          <div className="mt-2.5 flex items-center gap-2.5 border-t border-brass-500/15 pt-2 text-[9px] tracking-[0.1em] text-amber-100/35">
            <Legend swatch="bg-brass-500/90" label="已翻" />
            <Legend swatch="bg-amber-100/30" label="我手上" />
            <Legend swatch="border border-dashed border-brass-500/35" label="未知" />
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ row, isTarget }: { row: CountRow; isTarget: boolean }) {
  return (
    <div
      className="flex items-center gap-2"
      data-testid="card-counter-row"
      data-rank={row.key}
      data-total={row.total}
      data-seen={row.seen}
      data-mine={row.mine}
      data-remaining={row.remaining}
    >
      <span
        className={`w-8 shrink-0 font-display text-[12px] tracking-[0.12em] ${
          isTarget ? 'text-brass-400' : 'text-amber-100/55'
        }`}
      >
        {row.label}
      </span>

      <span className="flex flex-1 items-center gap-[3px]" aria-hidden>
        {Array.from({ length: row.total }, (_, i) => {
          const state = i < row.seen ? 'seen' : i < row.seen + row.mine ? 'mine' : 'unknown';
          return (
            <span
              key={i}
              className={`h-2.5 w-[7px] rounded-[2px] ${
                state === 'seen'
                  ? 'bg-brass-500/90'
                  : state === 'mine'
                    ? 'bg-amber-100/30'
                    : 'border border-dashed border-brass-500/35'
              }`}
            />
          );
        })}
      </span>

      <span className="flex shrink-0 items-baseline gap-1 tabular-nums">
        <span
          className={`text-[12px] ${
            row.remaining === 0 ? 'text-amber-100/25' : 'text-amber-100/85'
          }`}
        >
          {row.remaining}
        </span>
        <span className="text-[9px] text-amber-200/30">/{row.total}</span>
      </span>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`h-1.5 w-1.5 rounded-[1px] ${swatch}`} />
      {label}
    </span>
  );
}
