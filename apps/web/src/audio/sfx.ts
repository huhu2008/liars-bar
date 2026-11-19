/**
 * 音效层：合成出来的短音（public/assets/sfx）+ 一条会呼吸的酒馆底噪。
 *
 * 有了落点音，动画之间才有咬合感——人耳对声画同步极敏感，
 * 缺了它，动作再顺也会显得松。
 *
 * 混音重做（task-6）：从「每一步都响一下」改成有主次的层次。
 *   1. 音量分层：枪声是唯一的事件级音量，翻牌／勾选退到近乎背景
 *   2. 发牌合并：一次发 5 张只出 2 声（起手「唰」+ 落定「嗒」）
 *   3. 环境音有呼吸：目标值慢速随机游走 + 事件压低（duck），
 *      枪响／输局的瞬间底噪会先沉一下再浮回来
 *   4. 混响按类型区分：枪声湿声最多（酒馆回声），牌类基本干声
 */

import { asset } from '../data/assetPath';
import { AMBIENCE, SFX, type SfxName } from './manifest';

export type { SfxName };

/**
 * 音量档位：不是响度表，是「谁在说话」的等级表。
 * 0.90 事件 / 0.55–0.72 回合节拍 / 0.22–0.40 动作 / 0.08–0.16 背景。
 * 跨度 21dB 左右，才有前后层次。
 */
const VOLUME: Record<SfxName, number> = {
  'gun-shot': 0.9,
  lose: 0.72,
  challenge: 0.66,
  win: 0.55,
  'gun-empty': 0.4,
  'card-play': 0.38,
  'card-deal': 0.22,
  'card-flip': 0.16,
  'card-tick': 0.14,
  'card-untick': 0.1,
  tick: 0.08,
};

/* ------------------------------------------------------------------ */
/* 空间：每条音效按类型挂不同的混响（干声太「贴脸」了）                  */
/* ------------------------------------------------------------------ */

type SpaceName = 'dry' | 'room' | 'hall' | 'gun';

interface SpacePreset {
  /** impulse 长度（秒） */
  seconds: number;
  /** 衰减指数，越大尾巴掉得越快 */
  decay: number;
  /** 湿声总线增益 */
  wet: number;
  /** 湿声低通截止：越远越暗 */
  tone: number;
}

const SPACE_PRESET: Record<Exclude<SpaceName, 'dry'>, SpacePreset> = {
  room: { seconds: 0.8, decay: 3.0, wet: 0.2, tone: 5400 },
  hall: { seconds: 2.0, decay: 1.9, wet: 0.32, tone: 3600 },
  gun: { seconds: 1.7, decay: 2.2, wet: 0.5, tone: 4200 },
};

/** 音效 → 空间。牌类刻意干声：牌的质感在瞬态，混响会把它糊掉。 */
const SPACE_OF: Record<SfxName, SpaceName> = {
  'gun-shot': 'gun',
  'gun-empty': 'room',
  challenge: 'room',
  win: 'hall',
  lose: 'hall',
  'card-play': 'dry',
  'card-flip': 'dry',
  'card-deal': 'dry',
  'card-tick': 'dry',
  'card-untick': 'dry',
  tick: 'dry',
};

/** 需要空间感的音效（保留旧名字，便于和之前的探查脚本对照） */
const SPACED: ReadonlySet<string> = new Set(
  (Object.keys(SPACE_OF) as SfxName[]).filter((k) => SPACE_OF[k] !== 'dry'),
);

/** 事件级音效把底噪压低一点，让画面里的「那一刻」真的静下来 */
const DUCK: Partial<Record<SfxName, { ratio: number; hold: number }>> = {
  'gun-shot': { ratio: 0.3, hold: 900 },
  lose: { ratio: 0.55, hold: 700 },
  challenge: { ratio: 0.7, hold: 420 },
  win: { ratio: 0.75, hold: 500 },
};

let enabled = true;
/** 应用内主音量（0–1），由 UI 调节 */
let masterVolume = 1;
/** 主音量立即应用到正在播放的音效与底噪。 */
export function setMasterVolume(v: number): void {
  masterVolume = Math.min(1, Math.max(0, v));
  for (const [el, gain] of activeGains) el.volume = clamp01(gain * masterVolume);
  if (ambience && !ambience.paused) {
    if (ambGain && ctx) ambGain.gain.cancelScheduledValues(ctx.currentTime);
    applyAmbience(0.015);
  }
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem('liars-bar:volume', String(masterVolume));
    } catch {
      /* 隐私模式忽略 */
    }
  }
}
// 跟踪实际播放中的元素，调节主音量时保留每个音效的相对响度。
const activeGains = new Map<HTMLAudioElement, number>();
const pool = new Map<SfxName, HTMLAudioElement[]>();

let ambience: HTMLAudioElement | null = null;

/* ------------------------------------------------------------------ */
/* 音频图                                                             */
/* ------------------------------------------------------------------ */

let ctx: AudioContext | null = null;
/** 每个空间一条湿声总线 */
const wetBuses = new Map<Exclude<SpaceName, 'dry'>, GainNode>();
/** 每个空间一个 convolver（接源节点要用） */
const convs = new Map<Exclude<SpaceName, 'dry'>, ConvolverNode>();
/** 已经接过混响的元素（MediaElementSource 只能建一次） */
const routed = new WeakSet<HTMLAudioElement>();

/** 代码生成一段衰减噪声当 impulse response，模拟小酒馆的短混响 */
function makeImpulse(context: AudioContext, seconds = 1.1, decay = 2.6): AudioBuffer {
  const rate = context.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = context.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch += 1) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i += 1) {
      // 前 30ms 更密（早期反射），之后按指数衰减
      const t = i / len;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  return buf;
}

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
    // 自动化探针：确认混响链真的建起来了
    (window as unknown as { __AUDIO_CTX__?: AudioContext }).__AUDIO_CTX__ = ctx;
  }
  return ctx;
}

/** 手势之后把被自动播放策略挂起的 context 拉起来（幂等） */
function ensureCtxRunning(): void {
  const context = ensureCtx();
  if (!context || context.state !== 'suspended') return;
  void context.resume().catch(() => {});
}

function ensureReverb(space: Exclude<SpaceName, 'dry'>): GainNode | null {
  const context = ensureCtx();
  if (!context) return null;
  const existing = wetBuses.get(space);
  if (existing) return existing;
  const preset = SPACE_PRESET[space];
  const conv = context.createConvolver();
  conv.buffer = makeImpulse(context, preset.seconds, preset.decay);
  const tone = context.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = preset.tone;
  const wet = context.createGain();
  wet.gain.value = preset.wet;
  conv.connect(tone);
  tone.connect(wet);
  wet.connect(context.destination);
  wetBuses.set(space, wet);
  convs.set(space, conv);
  return wet;
}

/** 把某个音效元素接进它对应的混响（幂等，只接一次） */
function routeThroughReverb(name: SfxName, el: HTMLAudioElement): void {
  if (!SPACED.has(name) || routed.has(el)) return;
  const space = SPACE_OF[name];
  if (space === 'dry') return;
  const bus = ensureReverb(space);
  const conv = convs.get(space);
  const context = ctx;
  if (!bus || !conv || !context) return;
  try {
    const src = context.createMediaElementSource(el);
    src.connect(context.destination); // 干声
    src.connect(conv); // 湿声
    routed.add(el);
  } catch {
    /* 已经接过的元素会抛，忽略 */
  }
}

/* ------------------------------------------------------------------ */
/* 发牌合并：5 张牌不该响 5 次                                          */
/* ------------------------------------------------------------------ */

/** 落点间隔小于它，视为同一批发牌 */
const BURST_WINDOW = 420;
/** 最后一张落定之后多久补一个「收势」音 */
const BURST_TAIL = 150;

interface BurstState {
  last: number;
  count: number;
  scale: number;
  tail: ReturnType<typeof setTimeout> | null;
}

const dealBurst: BurstState = { last: 0, count: 0, scale: 1, tail: null };

/**
 * 一批发牌 = 起手一声 + 落定一声，与张数无关。
 * 只有一张时（收牌、单张补牌）就只留起手那一声。
 */
function fireDeal(volumeScale: number): void {
  const now = Date.now();
  const sameBurst = dealBurst.count > 0 && now - dealBurst.last < BURST_WINDOW;
  dealBurst.last = now;
  dealBurst.count = sameBurst ? dealBurst.count + 1 : 1;
  dealBurst.scale = volumeScale;

  if (!sameBurst) {
    // 起手：整摞牌离堆的「唰」，略慢一点更沉
    playRaw('card-deal', volumeScale * 0.9, 0.94);
  }

  if (dealBurst.tail) clearTimeout(dealBurst.tail);
  dealBurst.tail = setTimeout(() => {
    dealBurst.tail = null;
    const n = dealBurst.count;
    const scale = dealBurst.scale;
    dealBurst.count = 0;
    if (n < 2) return; // 单张：起手那声就够了
    // 落定：最后一张牌拍到桌上的「嗒」，轻、亮、短
    playRaw('card-deal', scale * 0.5, 1.1);
  }, BURST_TAIL);
}

/* ------------------------------------------------------------------ */
/* 播放                                                               */
/* ------------------------------------------------------------------ */

function playRaw(name: SfxName, volumeScale = 1, rate = 1): void {
  // 主音量在这里统一乘一次，探针记录的就是实际送达元素的音量
  record(name, volumeScale * masterVolume);
  // 复用元素避免同一音效叠太多次时堆内存
  let list = pool.get(name);
  if (!list) {
    list = [];
    pool.set(name, list);
  }
  const el = list.find((a) => a.paused || a.ended) ?? new Audio(asset(SFX[name]));
  if (!list.includes(el)) {
    el.preload = 'auto';
    list.push(el);
    if (list.length > 4) list.shift();
  }

  routeThroughReverb(name, el);
  const gain = VOLUME[name] * volumeScale;
  activeGains.set(el, gain);
  el.onended = el.onerror = () => { activeGains.delete(el); };
  el.volume = clamp01(gain * masterVolume);
  el.playbackRate = clamp(rate, 0.8, 1.25);
  try {
    el.currentTime = 0;
  } catch {
    /* 尚未可播时忽略 */
  }
  void el.play().catch(() => { if (el.paused) activeGains.delete(el); });
}

export function sfx(name: SfxName, volumeScale = 1): void {
  if (!enabled || typeof window === 'undefined') return;
  ensureCtxRunning();
  if (name === 'card-deal') {
    fireDeal(volumeScale);
    return;
  }

  const duck = DUCK[name];
  if (duck) duckAmbience(duck.ratio, duck.hold);
  playRaw(name, volumeScale);
}

interface SndProbe {
  at: number;
  name: string;
  vol: number;
  space: string;
}

function record(name: SfxName, volumeScale: number): void {
  const w = window as unknown as { __SND__?: SndProbe[] };
  const entry: SndProbe = {
    at: Date.now(),
    name,
    // 实际送达元素前的目标音量，方便核对层次
    vol: Number(clamp01(VOLUME[name] * volumeScale).toFixed(3)),
    space: SPACE_OF[name],
  };
  w.__SND__ = [...(w.__SND__ ?? []).slice(-120), entry];
}

/* ------------------------------------------------------------------ */
/* 环境底噪：循环播放，音量随时间轻微起伏                                 */
/* ------------------------------------------------------------------ */

/** 基础音量 */
const AMB_BASE = 0.15;
/** 随机游走幅度 */
const AMB_DRIFT = 0.035;
/** 淡入时间常数（秒） */
const AMB_FADE = 1.6;

/** 有人在说话时底噪压到这个比例，语音才听得清 */
const HOLD_RATIO = 0.55;

let ambSrc: MediaElementAudioSourceNode | null = null;
let ambGain: GainNode | null = null;
let ambBaseNow = AMB_BASE;
let ambDrift: ReturnType<typeof setInterval> | null = null;
let ambDuckTimer: ReturnType<typeof setTimeout> | null = null;
/** 无 Web Audio 时的降级淡入 */
let ambLegacyFade: ReturnType<typeof setInterval> | null = null;
/** 语音正在播报：底噪整体让位，不再叠加随机游走的抬高 */
let ambHeld = false;

/** 底噪走一条低通 → 增益 → 主输出，另分一点湿声进 room，听着像在屋子里 */
function ensureAmbienceGraph(): void {
  if (ambGain || !ambience) return;
  const context = ensureCtx();
  if (!context) return;
  try {
    ambSrc = context.createMediaElementSource(ambience);
    const tone = context.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3200;
    ambGain = context.createGain();
    ambGain.gain.value = 0;
    ambSrc.connect(tone);
    tone.connect(ambGain);
    ambGain.connect(context.destination);
    const room = ensureReverb('room');
    const conv = convs.get('room');
    if (room && conv) {
      const send = context.createGain();
      send.gain.value = 0.5; // 底噪只借一点房间感，别糊成一片
      ambGain.connect(send);
      send.connect(conv);
    }
    // 自动化探针：底噪当前增益／是否被语音让位
    (window as unknown as { __AMB__?: unknown }).__AMB__ = {
      gain: ambGain,
      el: ambience,
      held: () => ambHeld,
    };
  } catch {
    // 建图失败就退回元素音量控制
    ambGain = null;
    ambSrc = null;
  }
}

/** 当前底噪的目标音量：随机游走 × 是否让位给语音 */
function ambienceTarget(): number {
  return masterVolume * Math.max(0.01, ambBaseNow * (ambHeld ? HOLD_RATIO : 1));
}

function applyAmbience(smooth: number): void {
  if (ambGain && ctx) ambGain.gain.setTargetAtTime(ambienceTarget(), ctx.currentTime, smooth);
  else if (ambience) ambience.volume = ambienceTarget();
}

/** 目标值慢速随机游走：酒馆里的人声忽远忽近 */
function startDrift(): void {
  if (ambDrift) return;
  ambDrift = setInterval(() => {
    ambBaseNow = clamp(
      AMB_BASE + (Math.random() * 2 - 1) * AMB_DRIFT,
      AMB_BASE - AMB_DRIFT,
      AMB_BASE + AMB_DRIFT,
    );
    applyAmbience(AMB_FADE);
  }, 2200);
}

function stopDrift(): void {
  if (ambDrift) clearInterval(ambDrift);
  ambDrift = null;
}

/** 事件级音效落下时把底噪压一下，再浮回来：轮末的起伏就来自这里 */
function duckAmbience(ratio: number, hold: number): void {
  if (!ambience) return;
  if (ambGain && ctx) {
    const t = ctx.currentTime;
    ambGain.gain.cancelScheduledValues(t);
    ambGain.gain.setTargetAtTime(ambienceTarget() * ratio, t, 0.05);
    ambGain.gain.setTargetAtTime(ambienceTarget(), t + hold / 1000, Math.max(0.2, hold / 900));
    return;
  }
  // 降级：直接动元素音量
  ambience.volume = ambienceTarget() * ratio;
  if (ambDuckTimer) clearTimeout(ambDuckTimer);
  ambDuckTimer = setTimeout(() => {
    ambDuckTimer = null;
    if (ambience && !ambGain) ambience.volume = ambienceTarget();
  }, hold);
}

/** 语音开始：底噪让位（台词优先） */
export function holdAmbience(): void {
  ambHeld = true;
  applyAmbience(0.12);
}

/** 语音结束：底噪回到自己的呼吸节奏 */
export function releaseAmbience(): void {
  if (!ambHeld) return;
  ambHeld = false;
  applyAmbience(0.5);
}

export function startAmbience(): void {
  if (typeof window === 'undefined') return;
  if (!ambience) {
    ambience = new Audio(asset(AMBIENCE.tavern));
    ambience.loop = true;
    ambience.preload = 'auto';
    // 元素音量必须满：MediaElementSource 是接在元素音量之后的，
    // 这里压到 0 等于把整条链掐掉。淡入淡出全部交给增益节点。
    ambience.volume = 1;
  }
  if (!enabled) return;
  void ambience.play().catch(() => {});
  ensureCtxRunning();
  ensureAmbienceGraph();

  if (ambGain && ctx) {
    // 缓慢淡入，别一开门就吵
    ambGain.gain.cancelScheduledValues(ctx.currentTime);
    applyAmbience(AMB_FADE);
  } else if (ambience) {
    // 降级路径：没有 Web Audio，就回到元素音量上淡入
    if (ambLegacyFade) clearInterval(ambLegacyFade);
    let v = 0;
    ambience.volume = 0;
    ambLegacyFade = setInterval(() => {
      const cap = ambienceTarget();
      v = Math.min(cap, v + 0.02);
      if (ambience) ambience.volume = v;
      if (v >= cap && ambLegacyFade) {
        clearInterval(ambLegacyFade);
        ambLegacyFade = null;
      }
    }, 120);
  }
  startDrift();
}

export function stopAmbience(): void {
  stopDrift();
  ambHeld = false;
  if (ambLegacyFade) {
    clearInterval(ambLegacyFade);
    ambLegacyFade = null;
  }
  if (ambDuckTimer) {
    clearTimeout(ambDuckTimer);
    ambDuckTimer = null;
  }
  if (ambGain && ctx) {
    // 图内淡出，元素音量保持满
    ambGain.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
  } else if (ambience) {
    ambience.volume = 0;
  }
  if (ambience) ambience.pause();
}

export function setSfxEnabled(on: boolean): void {
  enabled = on;
  if (!on) stopAmbience();
  else startAmbience();
}

/* ------------------------------------------------------------------ */

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}
