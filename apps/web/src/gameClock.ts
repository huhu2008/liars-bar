// 对局只消费页面可见时的时间；存档等后台任务继续使用浏览器原生时钟。
const epoch = Date.now() - performance.now();
let pausedAt = typeof document !== 'undefined' && document.hidden ? performance.now() : null;
let pausedDuration = 0;

export interface GameTimer {
  readonly due: number;
  readonly callback: () => void;
  handle?: ReturnType<typeof setTimeout>;
}

const timers = new Set<GameTimer>();
const listeners = new Set<(hidden: boolean) => void>();

/** 返回冻结后台时长后的时间戳，供回合截止和结算面板共同使用。 */
export function gameNow(): number {
  return epoch + (pausedAt ?? performance.now()) - pausedDuration;
}

/** 在当前可见时间轴上安排一次回调；后台时只保留剩余时长。 */
export function setGameTimeout(callback: () => void, ms: number): GameTimer {
  const timer = { callback, due: gameNow() + ms };
  timers.add(timer);
  if (pausedAt === null) arm(timer);
  return timer;
}

/** 将剩余时间挂到浏览器，触发前先移除登记，允许回调重新调度。 */
function arm(timer: GameTimer): void {
  timer.handle = setTimeout(() => {
    if (timers.delete(timer)) timer.callback();
  }, Math.max(0, timer.due - gameNow()));
}

/** 同时取消已安排和正在后台挂起的回调。 */
export function clearGameTimeout(timer: GameTimer): void {
  clearTimeout(timer.handle);
  timers.delete(timer);
}

/** 注册语音、三维动画等需要在页面切换时同步冻结的资源。 */
export function onGameVisibility(listener: (hidden: boolean) => void): () => void {
  listeners.add(listener);
  listener(pausedAt !== null);
  return () => { listeners.delete(listener); };
}

let settingsOpen = false;

/** 设置占用玩家输入时暂停单人局；关闭面板后仍要尊重后台暂停。 */
export function setTableSettingsOpen(open: boolean): void {
  settingsOpen = open;
  syncPause();
}

/** 合并后台和弹窗的暂停状态，避免关闭其中一个时提前恢复。 */
function syncPause(): void {
  const hidden = document.hidden || settingsOpen;
  if (hidden === (pausedAt !== null)) return;
  if (hidden) {
    pausedAt = performance.now();
    for (const timer of timers) clearTimeout(timer.handle);
  } else {
    pausedDuration += performance.now() - pausedAt!;
    pausedAt = null;
    for (const timer of timers) arm(timer);
  }
  for (const listener of listeners) listener(hidden);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', syncPause);
  import.meta.hot?.dispose(() => {
    document.removeEventListener('visibilitychange', syncPause);
    for (const timer of timers) clearGameTimeout(timer);
    listeners.clear();
  });
}
