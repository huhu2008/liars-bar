import { SUIT_GLYPH, type Card } from '@liars/engine';
import { asset, cardFaceAsset } from '../data/assetPath';
import clsx from 'clsx';

const isRed = (suit: string) => suit === 'H' || suit === 'D';

export function CardBack({ className }: { className?: string }) {
  return (
    <div
      className={clsx(
        'h-[86px] w-[62px] shrink-0 rounded-lg ring-1 ring-amber-700/50 shadow-card',
        className,
      )}
      style={{
        backgroundImage: `url(${asset('assets/cards/back-tankard.webp')})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    />
  );
}

export function CardFace({
  card,
  selected = false,
  disabled = false,
  onClick,
  className,
}: {
  card: Card;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const red = isRed(card.suit);
  // 使用与桌上翻牌相同的点数、花色和赖子插画。
  const image = cardFaceAsset(card.rank, card.suit, card.id);
  if (image) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || !onClick}
        className={clsx(
          'relative h-[86px] w-[62px] shrink-0 select-none overflow-hidden rounded-lg shadow-card transition-transform duration-150',
          onClick && !disabled && 'cursor-pointer hover:-translate-y-2',
          selected ? '-translate-y-3 ring-2 ring-brass-400' : 'ring-1 ring-black/20',
          className,
        )}
      >
        <img src={image} alt={card.rank === 'JOKER' ? '赖子' : `${SUIT_GLYPH[card.suit]}${card.rank}`} className="h-full w-full" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || !onClick}
      className={clsx(
        'relative h-[86px] w-[62px] shrink-0 select-none rounded-lg bg-[#f7f1e5] shadow-card transition-transform duration-150',
        onClick && !disabled && 'cursor-pointer hover:-translate-y-2',
        selected ? '-translate-y-3 ring-2 ring-brass-400' : 'ring-1 ring-black/20',
        className,
      )}
    >
      <span
        className={clsx(
          'absolute left-1.5 top-1 text-[13px] font-bold leading-none',
          red ? 'text-[#b3261e]' : 'text-[#1b1310]',
        )}
      >
        {card.rank}
      </span>
      <span
        className={clsx(
          'absolute inset-0 grid place-items-center text-[26px]',
          red ? 'text-[#b3261e]' : 'text-[#1b1310]',
        )}
      >
        {SUIT_GLYPH[card.suit]}
      </span>
      <span
        className={clsx(
          'absolute bottom-1 right-1.5 rotate-180 text-[13px] font-bold leading-none',
          red ? 'text-[#b3261e]' : 'text-[#1b1310]',
        )}
      >
        {card.rank}
      </span>
    </button>
  );
}

export function RankBadge({ rank, size = 'md' }: { rank: string; size?: 'md' | 'lg' }) {
  return (
    <div
      className={clsx(
        'grid place-items-center rounded-xl border border-brass-400/60 bg-brass-500/15 font-display font-bold text-brass-400',
        size === 'lg' ? 'h-20 w-16 text-4xl' : 'h-10 w-8 text-lg',
      )}
    >
      {rank}
    </div>
  );
}
