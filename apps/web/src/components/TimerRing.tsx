import { clearGameTimeout, gameNow, setGameTimeout, type GameTimer } from '../gameClock';
import { useEffect, useState } from 'react';
import { asset } from '../data/assetPath';

/** 回合计时环：剩余时间 + 危险色 */
export function TimerRing({
  deadline,
  total = 30_000,
  size = 56,
}: {
  deadline: number | null;
  total?: number;
  size?: number;
}) {
  const [now, setNow] = useState(() => gameNow());

  useEffect(() => {
    if (deadline === null) return;
    let timer: GameTimer | undefined;
    // 跟随对局时钟刷新，暂停期间保留余量，倒计时结束后停止调度。
    function tick() {
      const current = gameNow();
      setNow(current);
      const remaining = expiresAt - current;
      if (remaining > 0) timer = setGameTimeout(tick, Math.min(remaining, 100));
    }
    const expiresAt = deadline;
    tick();
    return () => { if (timer) clearGameTimeout(timer); };
  }, [deadline]);

  if (!deadline) return null;

  const remain = Math.max(0, deadline - now);
  const ratio = Math.max(0, Math.min(1, remain / total));
  const secs = Math.ceil(remain / 1000);
  const danger = remain <= 8000;
  const stroke = danger ? '#e2564a' : '#c8923f';
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      {/* 外圈金环（Codex 素材） */}
      <div
        className="pointer-events-none absolute inset-[-6px]"
        style={{
          backgroundImage: `url(${asset('assets/ui/ring-gold.png')})`,
          backgroundSize: 'contain',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'center',
          opacity: 0.9,
        }}
      />
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={4} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - ratio)}
          style={{ transition: 'stroke-dashoffset 120ms linear, stroke 300ms' }}
        />
      </svg>
      <img
        src={asset('assets/ui/ic-sand.png')}
        alt=""
        className="pointer-events-none absolute -top-1 h-3 w-3 opacity-50"
      />
      <span
        className="absolute font-display text-sm"
        style={{ color: danger ? '#ff8a7a' : '#e0b062' }}
      >
        {secs}
      </span>
    </div>
  );
}
