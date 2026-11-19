import { legalActions, project, type PlayerView } from '@liars/engine';
import { asset, cardFaceAsset } from './data/assetPath';
import { AnimatePresence, motion } from 'framer-motion';
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { presentedTable } from './data/challengeReveal';
import { CardCounter } from './components/CardCounter';
import { CharacterSelect } from './components/CharacterSelect';
import { SettingsPanel } from './components/SettingsPanel';
import { RevealOverlay } from './components/RevealOverlay';
import { TimerRing } from './components/TimerRing';
import { handHitTargets } from './three/handLayout';
import { HUMAN_SEAT, TURN_MS, useGame } from './store';

/** 3D 栈按需加载：选角页不背 three 的下载体积 */
const TableCanvas = lazy(() => import('./three/TableCanvas'));

/** 右上角低频动作的统一长相：安静，hover 才亮 */
const HUD_LINK =
  'rounded px-1.5 py-0.5 text-[11px] leading-none text-amber-200/70 transition-colors hover:bg-white/5 hover:text-amber-100/90';

/** 窄屏专用：一行最近事件，让静音/外放不便的手机玩家也能看到对手说了什么 */

function MobileLogLine({ view }: { view: PlayerView }) {
  const last = view.log[view.log.length - 1];
  // 操作区已经持续展示这次出牌，手机上省去重复的声明。
  if (!last || (view.phase === 'turn' && view.pendingPlay && last.kind === 'play')) return null;
  return (
    <div
      className="pointer-events-none absolute inset-x-3 bottom-24 z-10 sm:hidden"
      aria-live="polite"
    >
      <div className="truncate rounded-md border border-amber-900/40 bg-black/55 px-2.5 py-1.5 text-[11px] leading-tight text-amber-100/60">
        {last.text}
      </div>
    </div>
  );
}

/** 把一张牌翻译成读屏能读的文本（3D canvas 里牌面只是贴图，读屏拿不到） */
function describeCard(card: { rank: string; suit: string }, index: number, selected: boolean): string {
  const SUIT: Record<string, string> = { S: '黑桃', H: '红桃', D: '方块', C: '梅花' };
  const face = card.rank === 'JOKER' ? '赖子' : `${SUIT[card.suit] ?? ''}${card.rank}`;
  return `第 ${index} 张：${face}${selected ? '（已选）' : ''}`;
}

/** 手牌按钮保留键盘与触屏操作，位置由当前正在绘制的真实牌面投影驱动。 */
function HandHitLayer({
  hand,
  selected,
  myTurn,
  onToggle,
  inputLocked,
}: {
  hand: { id: string; rank: string; suit: string }[];
  selected: string[];
  myTurn: boolean;
  inputLocked?: boolean;
  onToggle: (id: string) => void;
}) {
  // 移动浏览器会把狭窄牌角的点击吸附到邻近按钮，按指尖落点记下真实可见的牌。
  const touchedCard = useRef<string | undefined>(undefined);
  return (
    <div className="pointer-events-none absolute inset-0"
      onPointerDownCapture={event => {
        touchedCard.current = event.pointerType === 'touch'
          ? document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-card]')?.dataset.card
          : undefined;
      }}
      onPointerCancelCapture={() => { touchedCard.current = undefined; }}>
      {hand.map((card, index) => {
        const isSelected = selected.includes(card.id);
        return (
          <button
            key={card.id}
            type="button"
            data-testid="hand-card"
            data-card={card.id}
            aria-label={describeCard(card, index + 1, isSelected)}
            aria-pressed={isSelected}
            ref={button => {
              if (button) handHitTargets.set(card.id, button);
              else handHitTargets.delete(card.id);
            }}
            disabled={!myTurn || inputLocked}
            onClick={event => {
              // 保留浏览器对拖动取消点击的判断；键盘和读屏激活使用当前焦点牌。
              const id = event.detail > 0 ? touchedCard.current ?? card.id : card.id;
              touchedCard.current = undefined;
              onToggle(id);
            }}
            className="pointer-events-auto absolute left-0 top-0 h-[88px] w-[62px] origin-top-left touch-manipulation cursor-pointer rounded border border-transparent bg-transparent enabled:hover:border-amber-300/30 focus-visible:outline focus-visible:outline-brass-400 disabled:pointer-events-none"
            style={{ transform: 'var(--hand-pose, translate(-100vw, -100vh))' }}
          />
        );
      })}
    </div>
  );
}

function LogPanel({ view }: { view: PlayerView }) {
  // 默认收起：安静的时候不该占掉半张桌子的角落，想看历史再点标题
  const [expanded, setExpanded] = useState(false);
  // 桌面与移动记录共用按实际演出进度投影的公开日志。
  const entries = view.log.slice(-120).reverse();
  const tone: Record<string, string> = {
    round: 'text-brass-400',
    play: 'text-amber-100/70',
    challenge: 'text-orange-300',
    reveal: 'text-amber-200',
    shot: 'text-red-300',
    eliminate: 'text-red-400',
    end: 'text-emerald-300',
  };
  return (
    <div
      className={`panel flex w-44 flex-col overflow-hidden bg-black/45 transition-[max-height] duration-300 ${
        expanded ? 'max-h-[300px]' : 'max-h-[28px]'
      }`}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center justify-between px-2.5 py-1.5 text-[10px] uppercase tracking-[0.28em] text-amber-200/75 transition-colors hover:text-amber-200/70"
      >
        <span>记录</span>
        <span className="tracking-normal opacity-70">{expanded ? '收起' : `${entries.length} 条 ›`}</span>
      </button>
      {expanded && (
        <div className="flex-1 space-y-1 overflow-y-auto border-t border-amber-900/30 px-2.5 py-2 text-[11px] leading-relaxed">
          {entries.map((e) => (
            <div key={e.seq} className={tone[e.kind] ?? 'text-amber-100/60'}>
              <span className="mr-1 text-[10px] text-amber-200/25">#{e.round}</span>
              {e.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 竖屏提示：手机上桌子会被压窄、两侧的人看不见，
 * 与其硬改 3D 视角，不如老实说一句「横屏更宽敞」。
 * 8 秒后自己消失，不遮挡、不打断。
 */
function PortraitHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait) and (max-width: 767px)');
    let killed = false;
    const sync = () => setShow(mq.matches && !killed);
    sync();
    const timer = window.setTimeout(() => {
      killed = true;
      setShow(false);
    }, 8000);
    mq.addEventListener('change', sync);
    return () => {
      window.clearTimeout(timer);
      mq.removeEventListener('change', sync);
    };
  }, []);

  if (!show) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[62px] z-10 flex justify-center px-4">
      <div className="rounded-full border border-amber-900/45 bg-black/55 px-3 py-1 text-[11px] leading-none tracking-[0.04em] text-amber-200/55 backdrop-blur-sm">
        横屏更宽敞 · 按住画面拖动可转视角
      </div>
    </div>
  );
}

function TableScreen() {
  const game = useGame((s) => s.game);
  const characters = useGame((s) => s.characters);
  const selected = useGame((s) => s.selected);
  const toggleCard = useGame((s) => s.toggleCard);

  // 键盘操作：数字键选牌、Enter 出牌、C 质疑、Esc 取消
  // （之前整局只能用鼠标，键盘用户完全没法玩）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.defaultPrevented || e.isComposing || t?.closest('input, textarea, select') || t?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // 有任何模态面板开着（设置/关于/玩法说明/结算）就别让键盘漏到牌桌上
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      // 原生按钮与链接保留 Enter/空格的激活行为，长按快捷键也只执行一次。
      if (e.repeat) {
        if (['Enter', ' ', 'c', 'C', 'Escape', 'Backspace'].includes(e.key) || /^[1-9]$/.test(e.key)) e.preventDefault();
        return;
      }
      if ((e.key === 'Enter' || e.key === ' ') && t?.closest('button, a[href], [role="button"], [role="switch"]')) return;

      const st = useGame.getState();
      if (st.screen !== 'table') return;
      const hand = st.game?.players?.[st.game.players.findIndex((p) => !p.isBot)]?.hand ?? [];
      const myTurn = st.game?.phase === 'turn' && st.game.turnSeat === st.game.players.findIndex((p) => !p.isBot);

      if (e.key >= '1' && e.key <= '9') {
        const idx = Number(e.key) - 1;
        const card = hand[idx];
        if (card) {
          e.preventDefault();
          st.toggleCard(card.id);
        }
        return;
      }
      // 退格按选牌顺序撤回一张；Esc 保留原来的一次清空行为。
      if (e.key === 'Backspace' && myTurn && !st.inputLocked && st.selected.length) {
        e.preventDefault();
        st.toggleCard(st.selected[st.selected.length - 1]!);
        return;
      }
      if (e.key === 'Escape' && myTurn && !st.inputLocked) {
        e.preventDefault();
        useGame.setState({ selected: [], error: null });
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        if (!myTurn) return;
        e.preventDefault();
        st.playSelected();
        return;
      }
      if (e.key === 'c' || e.key === 'C') {
        if (!myTurn) return;
        e.preventDefault();
        st.challenge();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const deadline = useGame((s) => s.deadline);
  const thinkingSeat = useGame((s) => s.thinkingSeat);
  const voiceOn = useGame((s) => s.voiceOn);
  const toggleVoice = useGame((s) => s.toggleVoice);
  const volume = useGame((s) => s.volume);
  const setVolume = useGame((s) => s.setVolume);
  const restart = useGame((s) => s.restart);
  const backToSelect = useGame((s) => s.backToSelect);
  const error = useGame((s) => s.error);
  const playSelected = useGame((s) => s.playSelected);
  const challenge = useGame((s) => s.challenge);
  const passTurn = useGame((s) => s.passTurn);

  const [viewReset, setViewReset] = useState(0);
  /** 窄屏下右上角收成一个 ⋯：三个低频动作塞进菜单，别把 HUD 挤成竖排 */
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    // 转横屏后工具栏直接显示各操作，原窄屏菜单应同时释放快捷键。
    const desktop = window.matchMedia('(min-width: 640px)');
    const closeOnDesktop = () => { if (desktop.matches) setMenuOpen(false); };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, [menuOpen]);
  const projected = useMemo(() => project(game, HUMAN_SEAT), [game]);
  const challengeReveal = useGame(state => state.challengeReveal);
  const view = useMemo(() => presentedTable(projected, challengeReveal), [projected, challengeReveal]);
  const inputLocked = useGame((s) => s.inputLocked);
  // lead 期间（动画还在播）虽然状态已经是自己的回合，也不让点
  const rawActions = legalActions(game, HUMAN_SEAT);
  // 手牌打完等别人表态 —— 这段没有可做的操作
  const waitingOthers = view.me.hand.length === 0 && view.phase === 'turn';
  const actions = inputLocked || waitingOthers
    ? { canPlay: false, canChallenge: false, canPass: false }
    : rawActions;


  // 给浏览器自动化留的读口：座位数/阶段/回合，不暴露任何手牌
  useEffect(() => {
    (window as unknown as { __TABLE__?: unknown }).__TABLE__ = {
      seats: view.seats.length,
      phase: view.phase,
      punished: view.lastReveal?.punishedSeat ?? null,
      died: challengeReveal ? null : view.lastReveal?.died ?? null,
      round: view.round,
      turnSeat: view.turnSeat,
    };
  }, [view, challengeReveal]);

  useEffect(() => {
    (window as unknown as { __SEL__?: unknown }).__SEL__ = {
      selected,
      turnSeat: view.turnSeat,
      phase: view.phase,
      myTurn: view.phase === 'turn' && view.turnSeat === HUMAN_SEAT,
    };
  }, [selected, view]);
  // 声明只取玩家视图里的公开字段，选牌或撤回时仍对应桌上的同一手。
  const claim = view.phase === 'turn' ? view.pendingPlay : null;
  const claimName = claim?.seat === view.seat ? '你' : view.seats.find(seat => seat.seat === claim?.seat)?.name;
  const myTurn = game.phase === 'turn' && game.turnSeat === HUMAN_SEAT;
  const me = characters[HUMAN_SEAT];

  const hudActions = [
    { label: '回正', onClick: () => setViewReset((n) => n + 1) },
    { label: '重开', onClick: restart },
    { label: '换角色', onClick: backToSelect },
  ];

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-[#0b0603]">
      <div className="absolute inset-0 [&_canvas]:touch-none">
        <Suspense
          fallback={
            <div
              className="relative grid h-full place-items-center"
              style={{
                backgroundImage: `url(${asset('assets/scene/tavern.jpg')})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundBlendMode: 'multiply',
                backgroundColor: 'rgba(10,6,3,0.8)',
              }}
            >
              <LoadTimeout />
              <div className="flex flex-col items-center gap-3">
                {/* 三张牌依次翻动，比一行「加载中」更贴合这个游戏 */}
                <div className="flex gap-1.5">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-9 w-6 rounded-[3px] border border-amber-800/50 bg-amber-950/40"
                      style={{
                        animation: `loadingFan 1.1s ease-in-out ${i * 0.14}s infinite`,
                      }}
                    />
                  ))}
                </div>
                <div className="text-[12px] tracking-wide text-amber-200/45">正在铺桌子…</div>
              </div>
              <style>{`
                @keyframes loadingFan {
                  0%, 100% { transform: translateY(0) rotate(0deg); opacity: 0.5; }
                  50%      { transform: translateY(-6px) rotate(-4deg); opacity: 1; }
                }
              `}</style>
            </div>
          }
        >
          <TableCanvas
            view={view}
            characters={characters}
            selected={selected}
            onSelect={toggleCard}
            resetSignal={viewReset}
          />
        </Suspense>
        {/* 两侧的“还有别人”提示：一列竖排小字，不再用一条渐变遮住画面边缘 */}
        <div className="pointer-events-none absolute inset-y-0 left-2 hidden items-center lg:flex">
          <span className="text-[10px] tracking-[0.3em] text-amber-200/55 [writing-mode:vertical-rl]">
            拖动查看
          </span>
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-2 hidden items-center lg:flex">
          <span className="text-[10px] tracking-[0.3em] text-amber-200/55 [writing-mode:vertical-rl]">
            拖动查看
          </span>
        </div>
      </div>

      {/* 顶部 HUD：只留一个主数字（本轮点数）。身份/弹仓/名声退成同一行浅灰小字，
          牌堆这种低频信息只在快见底时冒出来，其余全塞进 title 里按需查看。
          手机（<sm）再砍一层：只剩「点数 / 手牌 / 弹仓」，右上角三个动作收进 ⋯ */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 p-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] sm:gap-3 sm:p-4">
        <div
          className="pointer-events-auto flex min-w-0 items-center gap-2 rounded-xl border border-amber-900/40 bg-black/75 py-1.5 pl-1.5 pr-2.5 backdrop-blur-sm sm:gap-2.5 sm:pl-2 sm:pr-3"
          title={`弹仓 ${view.bullets}/6 · 牌堆 ${view.deckCount}${view.myLies > 0 ? ` · 名声 ${view.myLies}` : ''} · 弃牌堆 ${view.discardCount}`}
        >
          {view.tableCard ? (
            <img
              src={cardFaceAsset(view.tableCard.rank, view.tableCard.suit, view.tableCard.id)}
              alt=""
              className="h-8 w-auto rounded-[3px] ring-1 ring-black/40 sm:h-9"
              style={{ boxShadow: '0 0 8px rgba(200,146,63,0.45)' }}
            />
          ) : (
            <div className="grid h-8 w-6 place-items-center rounded-[3px] font-display text-sm text-brass-400/60 ring-1 ring-amber-800/50 sm:h-9">
              ?
            </div>
          )}
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-baseline gap-1.5">
              {/* 点数换轮时做一个短促的翻入，别让数字硬生生跳变 */}
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={view.targetRank ?? 'none'}
                  className="font-display text-base leading-none text-brass-400 sm:text-lg"
                  initial={{ opacity: 0, y: -6, filter: 'blur(2px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, y: 6, filter: 'blur(2px)' }}
                  transition={{ duration: 0.22, ease: 'easeOut' }}
                >
                  {view.targetRank ?? '—'}
                </motion.span>
              </AnimatePresence>
              <span className="hidden text-[10px] leading-none text-amber-200/75 sm:inline">本轮点数</span>
            </div>
            {/* ≥sm：完整的一行浅灰小字 */}
            <div className="hidden items-baseline gap-1 whitespace-nowrap text-[10px] leading-none text-amber-200/75 sm:flex">
              <span className="text-amber-100/80">{me?.name ?? '你'}</span>
              <span className="text-amber-200/90">·</span>
              <span>第 {view.round} 轮</span>
              <span className="text-amber-200/90">·</span>
              <span className={view.bullets >= 4 ? 'text-red-400' : 'text-amber-100/95'}>
                弹仓 {view.bullets}/6
              </span>
              {view.myLies > 0 && (
                <>
                  <span className="text-amber-200/90">·</span>
                  <span className={view.myLies >= 3 ? 'text-red-400/80' : 'text-orange-300/70'}>
                    名声 {view.myLies}
                  </span>
                </>
              )}
              {view.deckCount > 0 && view.deckCount <= 3 && (
                <>
                  <span className="text-amber-200/90">·</span>
                  <span className="text-amber-200/70">牌堆 {view.deckCount}</span>
                </>
              )}
            </div>
            {/* <sm：只留手牌数与弹仓，名字/轮次让位给牌桌 */}
            <div className="flex items-baseline gap-1 whitespace-nowrap text-[10px] leading-none text-amber-200/45 sm:hidden">
              <span className="text-amber-100/65">手牌 {view.me.hand.length}</span>
              <span className="text-amber-200/90">·</span>
              <span className={view.bullets >= 4 ? 'text-red-400/80' : ''}>弹仓 {view.bullets}/6</span>
            </div>
          </div>
        </div>

        {/* 右上：语音留成图标开关；≥sm 另外三个低频动作并排成小字，<sm 收进 ⋯ */}
        <div className="pointer-events-auto flex shrink-0 items-center gap-1 rounded-lg border border-amber-900/25 bg-black/40 px-1.5 py-1 backdrop-blur-sm">
          <button
            type="button"
            onClick={toggleVoice}
            title={voiceOn ? '关闭语音播报' : '打开语音播报'}
            aria-label={voiceOn ? '语音' : '静音'}
            aria-pressed={voiceOn}
            className="grid h-6 w-6 place-items-center rounded transition-colors hover:bg-white/5 active:bg-white/10"
          >
            <img
              src={asset('assets/ui/ic-sound.png')}
              alt=""
              className="h-4 w-4"
              style={{ opacity: voiceOn ? 0.9 : 0.3 }}
            />
          </button>
          <SettingsPanel compact />
          <span className="mx-0.5 hidden h-4 w-px bg-amber-900/50 sm:block" />
          <div className="hidden items-center gap-1 sm:flex">
            {hudActions.map((a) => (
              <button key={a.label} type="button" className={HUD_LINK} onClick={a.onClick}>
                {a.label}
              </button>
            ))}
          </div>
          <div className="relative sm:hidden">
            <button
              type="button"
              ref={menuTrigger}
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="更多操作"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="relative z-40 grid h-6 w-7 place-items-center rounded text-[14px] leading-none text-amber-200/55 transition-colors active:bg-white/10"
            >
              ⋯
            </button>
            {menuOpen && (
              <>
                <button
                  type="button"
                  aria-hidden
                  tabIndex={-1}
                  className="fixed inset-0 z-30 cursor-default"
                  onClick={() => setMenuOpen(false)}
                />
                <div
                  ref={menu}
                  role="menu"
                  aria-label="更多操作"
                  onBlur={(e) => {
                    if (e.relatedTarget !== menuTrigger.current && !e.currentTarget.contains(e.relatedTarget)) setMenuOpen(false);
                  }}
                  onKeyDown={(e) => {
                    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
                    const i = items.indexOf(document.activeElement as HTMLButtonElement);
                    // Escape 返回入口，方向键在菜单中移动；Tab 沿页面焦点顺序正常退出。
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      menuTrigger.current?.focus();
                      setMenuOpen(false);
                    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
                      e.preventDefault();
                      const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
                        : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                      items[next]?.focus();
                    }
                  }}
                  className="absolute right-0 top-8 z-40 w-[116px] overflow-hidden rounded-lg border border-amber-900/50 bg-[#150c07]/95 p-1 shadow-[0_16px_36px_rgba(0,0,0,0.75)] backdrop-blur"
                >
                  {hudActions.map((a) => (
                    <button
                      key={a.label}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        menuTrigger.current?.focus();
                        setMenuOpen(false);
                        a.onClick();
                      }}
                      className="block w-full rounded px-2 py-1.5 text-left text-[12px] text-amber-100/70 transition-colors active:bg-white/10"
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <PortraitHint />

      {/* 记录 + 记牌：手机上让位给手牌和按钮，平板以上再出现 */}
      {/* 手机上记录面板是隐藏的，但对手说了什么不能只靠语音 —— 这里补一条最近事件 */}
      <MobileLogLine view={view} />

      <div className="pointer-events-none absolute bottom-32 left-4 hidden sm:block">
        <div className="pointer-events-auto">
          <CardCounter view={view} />
          <LogPanel view={view} />
        </div>
      </div>

      {/* 底部：计时 + 操作 */}
      {/* 自己把手牌打完了：官方规则下这是「等别人质疑还是放过」的阶段 */}
      {view.me.alive && view.me.hand.length === 0 && view.phase === 'turn' && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[104px] z-10 flex justify-center sm:bottom-28">
          <div className="rounded-full border border-brass-500/40 bg-black/75 px-4 py-1.5 text-[12px] tracking-[0.2em] text-brass-300 backdrop-blur-sm">
            手牌打完 · 等下一家表态
          </div>
        </div>
      )}

      {/* 玩家已出局：只观战，给出明确提示 */}
      {!view.me.alive && view.phase === 'turn' && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[104px] z-10 flex justify-center sm:bottom-28">
          <div className="flex items-center gap-2 rounded-full border border-amber-800/50 bg-black/70 px-4 py-1.5 text-[12px] tracking-[0.2em] text-amber-200/70 backdrop-blur-sm">
            <img src={asset('assets/ui/ic-ban.png')} alt="" className="h-4 w-4 opacity-80" />
            你已出局 · 观战中
            <button type="button" className="btn-ghost pointer-events-auto ml-2 px-2 py-1" onClick={restart}>再开一桌</button>
          </div>
        </div>
      )}

      {/* 操作栏：手机整条贴底铺满（拇指够得到），平板以上退回右下角的小方块 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-end sm:inset-x-auto sm:right-0 sm:p-2">
        <div
          data-mhud="actions"
          className="pointer-events-auto flex w-full flex-col gap-1.5 border-t border-amber-900/40 bg-black/70 px-2.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-sm sm:w-auto sm:flex-row sm:items-center sm:gap-1.5 sm:rounded-xl sm:border sm:px-2.5 sm:py-2"
        >
          <div className="flex items-center gap-1.5 sm:order-1">
            {myTurn && <TimerRing deadline={deadline} total={TURN_MS} size={46} />}
            {actions.canPass ? (
              <button
                type="button"
                className="btn-ghost min-w-0 flex-1 touch-manipulation px-3 py-1.5 text-[12px] sm:min-w-[84px] sm:flex-none"
                title="手里没牌，跳过这一手"
                onClick={passTurn}
              >
                过牌
              </button>
            ) : (
              <button
                type="button"
                className="btn-brass min-w-0 flex-1 touch-manipulation px-3 py-1.5 text-[12px] sm:min-w-[84px] sm:flex-none"
                disabled={!actions.canPlay || selected.length === 0}
                onClick={playSelected}
              >
                <Icon src={asset('assets/ui/ic-deck.png')} />
                出牌{selected.length > 0 ? `（${selected.length}）` : ''}
              </button>
            )}
            <button
              type="button"
              className="btn-danger min-w-0 flex-1 touch-manipulation px-3 py-1.5 text-[12px] sm:min-w-[80px] sm:flex-none"
              disabled={!actions.canChallenge}
              onClick={challenge}
            >
              <Icon src={asset('assets/ui/ic-warn.png')} />
              质疑！
            </button>
          </div>
          {/* 提示只留一句、只留当下要做的那个动作；手机上放到按钮上方一行 */}
          <div className="order-first flex min-h-7 items-center justify-center gap-2 text-center text-[11px] leading-snug text-amber-200/75 sm:order-2 sm:w-[104px] sm:flex-col sm:gap-0 sm:pl-0.5">
            {claim && (
              <span role="status" aria-atomic="true" data-testid="table-claim" className="text-amber-100">
                {claimName}声称出了 <strong className="whitespace-nowrap">{claim.count} 张 {view.targetRank}</strong>
              </span>
            )}
            {myTurn && !inputLocked && selected.length > 0 && (
              <button type="button" className="rounded px-2 py-1.5 text-amber-100 underline decoration-amber-500/50 underline-offset-4"
                title="撤回最近选中的一张牌（Backspace）"
                onClick={() => toggleCard(selected[selected.length - 1]!)}>
                撤回上一张
              </button>
            )}
            {error ? (
              <span className="text-red-400">{error}</span>
            ) : view.phase !== 'turn' || claim || (myTurn && selected.length > 0) ? null : myTurn ? (
              <>选 1–3 张</>
            ) : (
              <>{characters[game.turnSeat]?.name ?? '对手'} 思考中…</>
            )}
          </div>
        </div>
      </div>

      <HandHitLayer
        hand={view.me.hand}
        selected={selected}
        myTurn={myTurn}
        inputLocked={inputLocked}
        onToggle={toggleCard}
      />

      <RevealOverlay view={view} ready />
    </div>
  );
}

function Icon({ src, dim = false }: { src: string; dim?: boolean }) {
  return (
    <img
      src={src}
      alt=""
      className="mr-1.5 inline-block h-3.5 w-3.5 align-[-2px]"
      style={{ opacity: dim ? 0.4 : 0.9 }}
    />
  );
}


/**
 * 3D 包加载超时提示。
 * 之前 chunk 加载失败时 Suspense 会永远停在 fallback，
 * 玩家看着"正在铺桌子…"不知道出了什么事。
 */
function LoadTimeout() {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLate(true), 12000);
    return () => clearTimeout(t);
  }, []);
  if (!late) return null;
  return (
    <div className="absolute inset-x-4 bottom-8 mx-auto max-w-sm rounded-lg border border-amber-900/50 bg-black/70 p-3 text-center backdrop-blur-sm">
      <p className="mb-2 text-[11px] leading-relaxed text-amber-100/60">
        桌子铺得有点久。可能是网络慢，或者浏览器不支持 WebGL。
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-md border border-brass-500/50 bg-brass-500/15 px-3 py-1.5 text-[11px] text-brass-300 transition-colors hover:bg-brass-500/25"
      >
        刷新重试
      </button>
    </div>
  );
}

export default function App() {
  const screen = useGame((s) => s.screen);
  // 选角页 ↔ 牌桌之间做一次淡入，硬切会像页面刷新
  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={screen}
          className="absolute inset-0"
          initial={{ opacity: 0, scale: screen === 'table' ? 1.015 : 0.995 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: screen === 'table' ? 0.995 : 1.015 }}
          transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
        >
          {screen === 'select' ? <CharacterSelect /> : <TableScreen />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
