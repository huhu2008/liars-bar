import { ModalDialog } from './ModalDialog';
import { useEffect, useMemo, useRef, useState } from 'react';
import { asset } from '../data/assetPath';
import { CHARACTERS, type LineNode } from '../data/characters';
import { NARRATOR_CUES } from '../data/narrator';
import { AMBIENCE, SFX, VOICE_IDS, VOICE_NODES, voicePath } from '../audio';
import { useGame } from '../store';
import durations from '../audio/durations.json';

/**
 * 原声集：按 OST 的样子摊开整个音频包。
 *
 * 分类做成「Disc」的概念（一张碟一组），每条带编号、时长；
 * 底部固定播放条，显示当前播放和进度。
 */

type Disc = 'sfx' | 'voice' | 'narrator';

const DUR: Record<string, number> = durations.sfx as Record<string, number>;
const VO_DUR: Record<string, number> = durations.voice as Record<string, number>;

const DISC_META: Record<Disc, { no: string; title: string; sub: string }> = {
  sfx: { no: 'DISC 1', title: '牌桌与枪', sub: '动作音效与环境' },
  voice: { no: 'DISC 2', title: '酒馆里的六位牌客', sub: '角色台词' },
  narrator: { no: 'DISC 3', title: '旁观者', sub: '旁白与播报' },
};

const NODE_LABEL: Record<string, string> = {
  signature: '招牌动作', round: '轮次开始', play: '出牌声明', challenge: '质疑', truth: '被质疑（真话）',
  lie: '被质疑（撒谎）', empty: '空枪', bang: '中弹', win: '赢下整局',
  lastCard: '只剩一张', cornered: '被逼墙角', grudge: '记仇',
  witness: '目睹死亡', opening: '开局第一句', tension: '有人快走完', duel: '两人对峙',
};

const SFX_LABEL: Record<string, string> = {
  'card-deal': '发牌', 'card-play': '出牌', 'card-flip': '翻牌',
  'card-tick': '选中', 'card-untick': '取消选中', challenge: '质疑',
  'gun-shot': '开枪 · 实弹', 'gun-empty': '开枪 · 空枪',
  tick: '倒计时', win: '胜利', lose: '失败',
};

interface Track {
  key: string;
  title: string;
  sub: string;
  src: string;
  dur: number;
}

function fmt(sec: number): string {
  // 一秒以内显示毫秒：音效最短只有 50ms，按「0:00」显示会像没数据
  if (sec < 1) return `${Math.round(sec * 1000)}ms`;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function AudioLibrary({ onClose }: { onClose: () => void }) {
  const masterVolume = useGame(s => s.volume);
  const [disc, setDisc] = useState<Disc>('sfx');
  const [character, setCharacter] = useState<string>(VOICE_IDS[0] ?? 'fox');
  const [playing, setPlaying] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const raf = useRef(0);

  useEffect(
    () => () => {
      if (audio.current) audio.current.pause();
      audio.current = null;
      if (raf.current) cancelAnimationFrame(raf.current);
    },
    [],
  );

  // 试听过程中也跟随主音量变化。
  useEffect(() => {
    if (audio.current) audio.current.volume = 0.9 * masterVolume;
  }, [masterVolume]);

  const tracks = useMemo<Track[]>(() => {
    if (disc === 'sfx') {
      return [
        ...Object.entries(SFX).map(([k, p]) => ({
          key: k,
          title: SFX_LABEL[k] ?? k,
          sub: '音效',
          src: p,
          dur: DUR[k] ?? 0,
        })),
        ...Object.entries(AMBIENCE).map(([k, p]) => ({
          key: `amb-${k}`,
          title: '酒馆底噪',
          sub: '环境 · 循环',
          src: p,
          dur: DUR[k] ?? 24,
        })),
      ];
    }

    if (disc === 'narrator') {
      return (Object.entries(NARRATOR_CUES) as [string, { text: string; audio: string | null }][])
        .filter(([, c]) => c.audio)
        .map(([k, c], i) => ({
          key: k,
          title: c.text,
          sub: `旁白 ${i + 1}`,
          src: c.audio!.replace(/^\//, ''),
          dur: VO_DUR[`narrator_${k}`] ?? VO_DUR[c.audio!.split('/').pop()!.replace('.mp3', '')] ?? 0,
        }));
    }

    const ch = CHARACTERS.find((c) => c.id === character) ?? CHARACTERS[0]!;
    const out: Track[] = [];
    for (const node of VOICE_NODES) {
      const pool = ch.lines[node as LineNode] ?? [];
      pool.forEach((raw, i) => {
        if (raw.includes('{rank}')) {
          for (const rank of ['Q', 'K', 'A']) {
            const stem = `${ch.id}_${node}_${i}_${rank}`;
            out.push({
              key: stem,
              title: raw.replace(/\{rank\}/g, rank),
              sub: `${NODE_LABEL[node] ?? node} · ${rank}`,
              src: voicePath(ch.id, node, i, rank),
              dur: VO_DUR[stem] ?? 0,
            });
          }
        } else {
          const stem = `${ch.id}_${node}_${i}`;
          out.push({
            key: stem,
            title: raw,
            sub: NODE_LABEL[node] ?? node,
            src: voicePath(ch.id, node, i),
            dur: VO_DUR[stem] ?? 0,
          });
        }
      });
    }
    return out;
  }, [disc, character]);

  const total = useMemo(() => tracks.reduce((n, t) => n + t.dur, 0), [tracks]);

  const play = (t: Track) => {
    if (audio.current) {
      audio.current.pause();
      audio.current = null;
    }
    if (raf.current) cancelAnimationFrame(raf.current);
    if (playing === t.key) {
      setPlaying(null);
      setProgress(0);
      return;
    }
    const el = new Audio(asset(t.src));
    // 试听继承主音量，主音量为零时同样保持静音。
    el.volume = 0.9 * masterVolume;
    // 只收尾当前曲目，防止上一首迟到的回调清空新曲目的播放状态。
    const finish = () => {
      if (audio.current !== el) return;
      audio.current = null;
      cancelAnimationFrame(raf.current);
      setPlaying(null);
      setProgress(0);
    };
    el.onended = el.onerror = finish;
    audio.current = el;
    void el.play().catch(finish);
    setPlaying(t.key);
    setProgress(0);

    const tick = () => {
      if (!audio.current) return;
      const d = audio.current.duration;
      if (Number.isFinite(d) && d > 0) setProgress(audio.current.currentTime / d);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  const current = tracks.find((t) => t.key === playing);

  return (
    <ModalDialog label="原声集 曲目列表" className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-3 backdrop-blur-sm" onClose={onClose}>
      <div
        className="flex h-[min(84vh,700px)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-brass-500/25 bg-[#120a06]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 封面区 */}
        <div className="relative shrink-0 overflow-hidden border-b border-brass-500/20 px-5 py-5">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.14]"
            style={{
              backgroundImage: `url(${asset('assets/scene/roster.jpg')})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center 30%',
              filter: 'saturate(0.7)',
            }}
          />
          <div className="relative flex items-end justify-between gap-4">
            <div>
              <div className="mb-1 font-display text-xl tracking-wide text-brass-400">骗子酒馆 原声集</div>
              <div className="text-[11px] uppercase tracking-[0.32em] text-amber-200/40">
                Liar&apos;s Bar · Original Soundtrack
              </div>
              <div className="mt-2 text-[10px] text-amber-200/35">
                3 张碟 · {Object.keys(SFX).length + Object.keys(AMBIENCE).length} 段音效 ·
                342 条台词 · 总时长约 {fmt(total + 24 + 342 * 2.16)}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-md border border-amber-900/50 px-2.5 py-1 text-[11px] text-amber-200/50 transition-colors hover:border-brass-500/50 hover:text-brass-300"
            >
              关闭
            </button>
          </div>
        </div>

        {/* 碟选择 */}
        <div className="flex shrink-0 gap-1 border-b border-brass-500/15 px-3 py-2">
          {(Object.keys(DISC_META) as Disc[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDisc(d)}
              className={`flex-1 rounded-lg border px-3 py-1.5 text-left transition-colors ${
                disc === d
                  ? 'border-brass-500/40 bg-brass-500/10'
                  : 'border-transparent hover:border-amber-900/40 hover:bg-white/[0.03]'
              }`}
            >
              <div className={`text-[9px] tracking-[0.24em] ${disc === d ? 'text-brass-400/80' : 'text-amber-200/30'}`}>
                {DISC_META[d].no}
              </div>
              <div className={`truncate text-[12px] ${disc === d ? 'text-amber-100/85' : 'text-amber-200/50'}`}>
                {DISC_META[d].title}
              </div>
              <div className="truncate text-[9px] text-amber-200/25">{DISC_META[d].sub}</div>
            </button>
          ))}
        </div>

        {/* 角色切换（第二张碟） */}
        {disc === 'voice' && (
          <div className="flex shrink-0 gap-1 border-b border-brass-500/10 px-3 py-2">
            {CHARACTERS.filter((c) => VOICE_IDS.includes(c.id as never)).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCharacter(c.id)}
                className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                  character === c.id ? 'bg-brass-500/20 text-brass-300' : 'text-amber-200/50 hover:text-amber-200/80'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}

        {/* 曲目表 */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tracks.length === 0 && (
            <div className="p-8 text-center text-[11px] text-amber-200/30">这一碟还没有录音</div>
          )}
          {tracks.map((t, i) => {
            const active = playing === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => play(t)}
                className={`group flex w-full items-center gap-3 border-b border-white/[0.03] px-4 py-2 text-left transition-colors ${
                  active ? 'bg-brass-500/[0.12]' : 'hover:bg-white/[0.035]'
                }`}
              >
                <span
                  className={`w-7 shrink-0 text-right font-mono text-[10px] tabular-nums ${
                    active ? 'text-brass-400' : 'text-amber-200/25'
                  }`}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[8px] ${
                    active ? 'border-brass-500/60 text-brass-300' : 'border-amber-900/40 text-amber-200/40'
                  }`}
                >
                  {active ? '❚❚' : '▶'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-[12px] ${active ? 'text-amber-50' : 'text-amber-100/75'}`}>
                    {t.title}
                  </span>
                  <span className="block truncate text-[10px] text-amber-200/30">{t.sub}</span>
                </span>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-amber-200/30">
                  {t.dur > 0 ? fmt(t.dur) : '--:--'}
                </span>
              </button>
            );
          })}
        </div>

        {/* 播放条 */}
        <div className="shrink-0 border-t border-brass-500/20 bg-black/40 px-4 py-2.5">
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-[11px] text-amber-100/70">
              {current ? current.title : '未在播放'}
            </span>
            <span className="shrink-0 text-[10px] text-amber-200/30">
              {tracks.length} 轨 · 共 {fmt(total)}
            </span>
          </div>
          <div className="h-0.5 overflow-hidden rounded-full bg-amber-200/10">
            <div
              className="h-full rounded-full bg-brass-400 transition-[width] duration-100"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        </div>
      </div>
    </ModalDialog>
  );
}
