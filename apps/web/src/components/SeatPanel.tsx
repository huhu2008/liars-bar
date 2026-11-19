import type { SeatView } from '@liars/engine';
import clsx from 'clsx';
import { CardBack } from './Cards';

export function SeatPanel({
  seat,
  isTurn,
  thinking,
  pending,
}: {
  seat: SeatView;
  isTurn: boolean;
  thinking: boolean;
  pending: boolean;
}) {
  return (
    <div
      className={clsx(
        'relative flex flex-col items-center gap-2 rounded-xl border px-3 py-3 transition-colors',
        isTurn
          ? 'border-brass-400/70 bg-brass-500/10 shadow-seat'
          : 'border-amber-900/30 bg-black/25',
        !seat.alive && 'opacity-40 grayscale',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-amber-50/90">{seat.name}</span>
        {thinking && isTurn && (
          <span className="rounded bg-brass-500/20 px-1.5 py-0.5 text-[10px] text-brass-400">
            思考中
          </span>
        )}
        {!seat.alive && <span className="text-[10px] text-red-400/80">出局</span>}
      </div>

      <div className="flex h-[52px] items-center justify-center gap-0.5">
        {Array.from({ length: Math.min(seat.cardCount, 5) }).map((_, i) => (
          <CardBack
            key={i}
            className="h-[52px] w-[38px]"
          />
        ))}
        {seat.cardCount === 0 && seat.alive && (
          <span className="text-[11px] text-amber-200/30">无牌</span>
        )}
      </div>

      <div className="text-[11px] text-amber-200/45">{seat.cardCount} 张</div>

      {pending && (
        <span className="absolute -bottom-2 rounded-full bg-brass-500 px-2 py-0.5 text-[10px] font-medium text-[#201207]">
          桌上有牌
        </span>
      )}
    </div>
  );
}
