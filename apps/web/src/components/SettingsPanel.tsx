import { setTableSettingsOpen } from '../gameClock';
import { ModalDialog } from './ModalDialog';
import { useLayoutEffect, useState } from 'react';
import { audioSummary, VOICE_FILE_COUNT } from '../audio';
import { useGame } from '../store';

/**
 * 游戏设置面板：音量 / 语音播报 / 无障碍说明。
 * 入口在选角页和牌桌右上角都有，改动即时生效并持久化。
 */
export function SettingsPanel({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const volume = useGame((s) => s.volume);
  const setVolume = useGame((s) => s.setVolume);
  const voiceOn = useGame((s) => s.voiceOn);
  const toggleVoice = useGame((s) => s.toggleVoice);
  const pct = Math.round(volume * 100);

  // 只在牌桌弹出设置时冻结回合；关闭或离开牌桌都释放这次暂停。
  useLayoutEffect(() => {
    if (!compact || !open) return;
    setTableSettingsOpen(true);
    return () => setTableSettingsOpen(false);
  }, [compact, open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="设置"
        title="设置"
        className={
          compact
            ? 'grid h-6 w-6 place-items-center rounded text-amber-200/70 transition-colors hover:bg-white/5 hover:text-brass-400'
            : 'flex h-8 items-center gap-2 rounded-lg border border-amber-900/60 bg-black/55 px-3 text-[12px] text-amber-100/85 shadow-[0_2px_10px_rgba(0,0,0,0.45)] backdrop-blur-sm transition-all hover:border-brass-500/70 hover:bg-black/70 hover:text-brass-300'
        }
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4">
          <circle cx="10" cy="10" r="2.6" />
          <path
            strokeLinecap="round"
            d="M10 2.2v2M10 15.8v2M2.2 10h2M15.8 10h2M4.5 4.5l1.4 1.4M14.1 14.1l1.4 1.4M15.5 4.5l-1.4 1.4M5.9 14.1l-1.4 1.4"
          />
        </svg>
        {!compact && '设置'}
      </button>

      {open && (
        <ModalDialog label="游戏设置" className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4" onClose={() => setOpen(false)}>
          <div
            className="w-full max-w-sm rounded-xl border border-brass-500/25 bg-[#140b07] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="font-display text-lg text-brass-400">设置</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="关闭设置"
                className="text-[11px] text-amber-200/45 transition-colors hover:text-amber-200/80"
              >
                关闭
              </button>
            </div>

            {/* 音量 */}
            <div className="mb-4">
              <div className="mb-1.5 flex items-baseline justify-between">
                <label htmlFor="settings-volume" className="text-[11px] text-amber-200/60">
                  音量
                </label>
                <span className="text-[11px] tabular-nums text-amber-200/50">{pct}%</span>
              </div>
              <input
                id="settings-volume"
                type="range"
                min={0}
                max={100}
                step={5}
                value={pct}
                onChange={(e) => setVolume(Number(e.target.value) / 100)}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full focus:outline-none [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-brass-400 [&::-webkit-slider-thumb]:shadow-[0_0_6px_rgba(200,146,63,0.6)]"
                style={{
                  background: `linear-gradient(to right, rgb(200 146 63) ${pct}%, rgba(253,230,138,0.18) ${pct}%)`,
                }}
              />
            </div>

            {/* 语音播报 */}
            <div className="mb-4 flex items-center justify-between">
              <span className="text-[11px] text-amber-200/60">语音播报</span>
              <button
                type="button"
                onClick={toggleVoice}
                role="switch"
                aria-checked={voiceOn}
                aria-label="语音播报"
                className={`relative h-5 w-10 rounded-full transition-colors ${
                  voiceOn ? 'bg-brass-500/70' : 'bg-amber-900/50'
                }`}
              >
                <span
                  className={`absolute left-0 top-0.5 h-4 w-4 rounded-full bg-amber-50 shadow-sm transition-transform ${
                    voiceOn ? 'translate-x-[22px]' : 'translate-x-[2px]'
                  }`}
                />
              </button>
            </div>

            {/* 音频包：这一版一共装了哪些声音 */}
            <div className="mb-4 border-t border-brass-500/15 pt-3">
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="text-[11px] text-amber-200/60">音频包</span>
                <span className="text-[10px] text-amber-200/35">
                  语音 {VOICE_FILE_COUNT} 条
                </span>
              </div>
              <div className="space-y-1">
                {audioSummary().map((g) => (
                  <div key={g.key} className="flex items-baseline justify-between gap-2 text-[10px]">
                    <span className="text-amber-100/70">{g.label}</span>
                    <span className="truncate text-right text-amber-200/35">{g.note}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-brass-500/15 pt-3 text-[10px] leading-relaxed text-amber-200/35">
              牌桌可用键盘操作：数字键选牌、Enter 出牌、C 质疑、Esc 取消。
            </div>
          </div>
        </ModalDialog>
      )}
    </>
  );
}
