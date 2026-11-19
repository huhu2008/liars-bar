import './CharacterSelect.css';
import clsx from 'clsx';
import { preloadAudio, voice } from '../audio';
import { asset } from '../data/assetPath';
import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AboutPanel } from './AboutPanel';
import { AudioLibrary } from './AudioLibrary';
import { SettingsPanel } from './SettingsPanel';
import { RulesPanel } from './RulesPanel';
import { PracticeTable } from './PracticeTable';
import { CHARACTERS, pickLineCue, type Character } from '../data/characters';
import { MAX_PLAYERS, MIN_PLAYERS, clearSave, loadSave, useGame } from '../store';
// 预览与牌桌各自按需加载，让选角交互先于 WebGL 可用。
// 由 Vite 为模型头像生成内容指纹，更新后浏览器会请求对应的新图片。
const rosterPortraits = import.meta.glob<string>('../assets/roster/*.webp', { eager: true, import: 'default' });

const AnimalPreview = lazy(() => import('../three/AnimalPreview'));

/** WebGL 或模型加载失败时保留当前立绘，切换角色后重新尝试。 */
class PreviewBoundary extends Component<{ characterId: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  /** 将预览错误限制在画布内，旁边的选角按钮仍然可用。 */
  static getDerivedStateFromError() { return { failed: true }; }

  /** 另一名角色的资源可以独立加载。 */
  componentDidUpdate(previous: Readonly<{ characterId: string }>) {
    if (this.state.failed && previous.characterId !== this.props.characterId) this.setState({ failed: false });
  }

  /** 错误时露出画布下面的对应立绘。 */
  render() { return this.state.failed ? null : this.props.children; }
}


/** 原声集入口：和设置/关于同一排，但它是「内容」不是配置 */
function AudioLibraryButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-8 items-center gap-2 rounded-lg border border-amber-900/60 bg-black/55 px-3 text-[12px] text-amber-100/85 shadow-[0_2px_10px_rgba(0,0,0,0.45)] backdrop-blur-sm transition-all hover:border-brass-500/70 hover:bg-black/70 hover:text-brass-300"
      aria-label="原声集"
    >
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4">
        <circle cx="10" cy="10" r="7.2" />
        <circle cx="10" cy="10" r="1.6" fill="currentColor" stroke="none" />
      </svg>
      原声集
    </button>
  );
}

/** 角色选择、存档入口及当前角色的站姿预览。 */
export function CharacterSelect() {
  const [loadPreview, setLoadPreview] = useState(false);
  const [replay, setReplay] = useState(0);
  const [visibleModel, setVisibleModel] = useState<string | null>(null);

  // 留出一次浏览器绘制机会；快速入座或离开时取消尚未启动的预览。
  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setLoadPreview(true));
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const currentId = useGame((s) => s.characterId);
  const chooseCharacter = useGame((s) => s.chooseCharacter);
  // 名册只锁定能实际恢复的对局，并以存档中的人数和角色展示续局信息。
  const [saved, setSaved] = useState(loadSave);
  const [picked, setPicked] = useState(saved?.characterId ?? currentId);
  const newPlayerCount = useGame((s) => s.playerCount);
  const playerCount = saved?.playerCount ?? newPlayerCount;
  const resumeSaved = useGame((s) => s.resumeSaved);
  const saveInfo = saved && { name: CHARACTERS.find(c => c.id === saved.characterId)!.name, round: saved.game.round };
  const hasSave = !!saveInfo;
  const [saveError, setSaveError] = useState<string | null>(null);
  const [ostOpen, setOstOpen] = useState(false);
  const [practiceOpen, setPracticeOpen] = useState(false);
  const setPlayerCount = useGame((s) => s.setPlayerCount);

  // 选角页一进来就把音效塞进 HTTP 缓存，避免第一次发牌/开枪时因为下载而延迟
  useEffect(() => {
    preloadAudio();
  }, []);

  const pickedCharacter = CHARACTERS.find((c) => c.id === picked) ?? CHARACTERS[0]!;
  const accent = pickedCharacter.palette.accent;

  const selectedId = useRef(picked);

  /** 主动点选才播放角色的招牌台词，再点当前角色时同步重演动作。 */
  const selectCharacter = (character: Character) => {
    if (hasSave && selectedId.current !== character.id) return;
    // 同一会话负责音量、静音和中断；入座或续局时 store 会先清空这句试听。
    voice.stop();
    const cue = pickLineCue(character, 'signature');
    void voice.speakAudio(cue.text, { name: character.name, ...character.voice }, cue.audio);
    if (selectedId.current === character.id) {
      setReplay(value => value + 1);
      return;
    }
    // 换人期间保留新角色立绘，旧模型的迟到通知由 markPreviewReady 过滤。
    selectedId.current = character.id;
    setVisibleModel(null);
    setPicked(character.id);
  };

  /** 只接收当前选择的就绪通知，保持选角与入座按钮指向同一角色。 */
  const markPreviewReady = useCallback((id: string) => {
    if (id === selectedId.current) setVisibleModel(id);
  }, []);

  /** 桌面与手机共享续局入口，存档失败时在当前操作位置显示原因。 */
  const continueGame = () => {
    if (!resumeSaved()) {
      // 页面停留期间存档也可能过期；立即解锁开局操作。
      setSaved(null);
      setSaveError('这局存档已失效，可以选择角色开始新局。');
    }
  };

  return (
    <div className="roster-screen">
      <div className="roster-backdrop" aria-hidden="true" style={{ backgroundImage: `url(${asset('assets/scene/tavern-wide.jpg')})` }} />
      <div className="roster-shell">
        <header className="roster-header">
          <div className="roster-brand">
            <span className="roster-brand-mark" aria-hidden="true">♠</span>
            <div><p lang="en">LIAR’S BAR</p><h1>骗子酒馆</h1></div>
          </div>
          <div className="roster-tools">
            <AudioLibraryButton onOpen={() => { voice.stop(); setOstOpen(true); }} />
            <SettingsPanel />
            <AboutPanel />
          </div>
        </header>

        {practiceOpen && <PracticeTable onClose={() => setPracticeOpen(false)} />}
        {ostOpen && <AudioLibrary onClose={() => setOstOpen(false)} />}

        <main className="roster-layout">
          <section className="roster-list" aria-label="选择角色">
            <h2 className="roster-list-title">选择角色</h2>
            <div className="roster-cards">
              {CHARACTERS.map((c) => {
                const active = c.id === picked;
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={active}
                    aria-label={`${c.glyph} · ${c.name} · ${c.personality.label}`}
                    disabled={hasSave && !active}
                    onClick={() => selectCharacter(c)}
                    className="roster-card"
                  >
                    <div className="roster-card-picture">
                      <img src={rosterPortraits[`../assets/roster/${c.species}.webp`]} alt="" />
                      {active && <span className="roster-selected">✓ 已选</span>}
                    </div>
                    <div className="roster-card-caption">
                      <span className="roster-card-name">{c.name}</span>
                      <span className="roster-card-trait">{c.personality.label}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 预览 + 性格面板 */}
          <aside className="roster-detail">
            <div className="roster-detail-panel">
              <div className="roster-stage">
                <div className="roster-stage-label"><strong>{pickedCharacter.name}</strong><span>{pickedCharacter.title}</span></div>
                <div className="roster-stage-model">
                  <img className="absolute inset-0 h-full w-full object-contain p-2"
                    src={rosterPortraits[`../assets/roster/${pickedCharacter.species}-standing.webp`]} alt={pickedCharacter.name} />
                  {loadPreview && (
                    <PreviewBoundary characterId={pickedCharacter.id}>
                      <Suspense fallback={null}>
                        <div className="absolute inset-0" style={{ opacity: visibleModel === pickedCharacter.id ? 1 : 0 }}>
                          <AnimalPreview character={pickedCharacter} replay={replay} onReady={markPreviewReady} />
                        </div>
                      </Suspense>
                    </PreviewBoundary>
                  )}
                </div>
              </div>

              <div className="roster-profile">
                <div className="flex items-baseline gap-2">
                  <h2 className="roster-profile-name">{pickedCharacter.name}</h2>
                  <span className="text-[10px]" style={{ color: `color-mix(in srgb, ${accent} 45%, #f1d5ad)` }}>
                    {pickedCharacter.title}
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-amber-100/45">
                  {pickedCharacter.bio}
                </p>

                <div className="mt-3 space-y-1.5">
                  {pickedCharacter.personality.traits.map((t) => (
                    <div key={t.name} className="flex items-center gap-2">
                      <span className="w-8 shrink-0 text-[10px] text-amber-200/45">{t.name}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{ width: `${t.value}%`, background: accent }}
                        />
                      </div>
                      <span className="w-6 shrink-0 text-right text-[10px] text-amber-200/35">
                        {t.value}
                      </span>
                    </div>
                  ))}
                </div>

                <p className="mt-3 text-[11px] italic" style={{ color: `color-mix(in srgb, ${accent} 45%, #f1d5ad)` }}>
                  「{pickedCharacter.lines.signature[0]}」
                </p>

                <div className="mt-4">
                  <div className="mb-1.5 flex items-center justify-between text-[10px] text-amber-200/40">
                    <span>桌上人数</span>
                    <span>
                      {playerCount} 人 · 你 + {playerCount - 1} 个对手
                    </span>
                  </div>
                  <div className="grid grid-flow-col auto-cols-fr gap-1">
                    {Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }).map((_, i) => {
                      const n = MIN_PLAYERS + i;
                      const active = n === playerCount;
                      return (
                        <button
                          key={n}
                          type="button"
                          disabled={hasSave}
                          onClick={() => setPlayerCount(n)}
                          className={clsx(
                            'rounded-md py-1.5 text-[12px] transition-colors',
                            active
                              ? 'bg-brass-500 font-medium text-[#201207]'
                              : 'border border-amber-900/50 bg-black/25 text-amber-100/70 hover:border-amber-700/70',
                          )}
                        >
                          {n}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-1.5 text-[10px] leading-snug text-amber-200/30">
                    座位随人数重排，牌数不变（每人 5 张），人越多桌越挤、轮得越慢。
                  </p>
                </div>

                <button type="button" className="mt-3 w-full rounded-lg border border-brass-500/45 bg-brass-500/10 py-2 text-sm text-brass-300" onClick={() => { voice.stop(); setPracticeOpen(true); }}>
                  两分钟练习桌
                </button>
                <RulesPanel />
                {saveError && <p role="alert" className="hidden text-xs text-amber-200 lg:block">{saveError}</p>}
                {saveInfo && (
                  <div className="rounded-lg border border-brass-500/30 bg-brass-500/8 p-3">
                    <div className="mb-0.5 text-[10px] uppercase tracking-[0.2em] text-amber-200/45">
                      未完成的对局
                    </div>
                    <div className="mb-2 text-[12px] text-amber-100/80">
                      {saveInfo.name} · 第 {saveInfo.round} 轮
                    </div>
                    <button
                      type="button"
                      className="hidden lg:block w-full rounded-lg border border-brass-500/50 bg-brass-500/15 px-4 py-2 text-[12px] text-brass-300 transition-colors hover:bg-brass-500/25"
                      onClick={continueGame}
                    >
                      接着打这一局
                    </button>
                    <p className="mt-2 text-[10px] leading-snug text-amber-200/35">
                      这局用的是「{saveInfo.name}」。想换角色请先放弃，再开新局。
                    </p>

                  </div>
                )}

              </div>

              {/* 主 CTA 固定在面板底部，永远在视口里（内容再长也不会被顶出去） */}
              <div className="sticky bottom-0 z-10 border-t border-brass-500/15 bg-[#0d0805]/95 px-4 py-3 backdrop-blur-sm">
                {hasSave ? (
                  <button
                    type="button"
                    className="w-full rounded-lg border border-amber-900/50 bg-black/30 px-4 py-2 text-[11px] text-amber-200/40 transition-colors hover:border-red-900/50 hover:text-red-300/70"
                    onClick={() => {
                      clearSave?.();
                      window.location.reload();
                    }}
                  >
                    放弃这局，重新开始
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-brass hidden w-full py-2.5 lg:block"
                    onClick={() => chooseCharacter(pickedCharacter.id, playerCount)}
                  >
                    以「{pickedCharacter.name}」入座
                  </button>
                )}
              </div>
            </div>
          </aside>
        </main>
      </div>

      {/* 手机入座和续局按钮常驻底部，执行与桌面相同的操作。 */}
      <div className="roster-dock">
        {saveError && <p role="alert">{saveError}</p>}
        <button
          type="button"
          className="btn-brass w-full py-2.5 text-[14px]"
          onClick={hasSave ? continueGame : () => chooseCharacter(pickedCharacter.id, playerCount)}
        >
          {hasSave ? `接着打这一局 · ${pickedCharacter.name}` : `以「${pickedCharacter.name}」入座 · ${playerCount} 人`}
        </button>
      </div>
    </div>
  );
}
