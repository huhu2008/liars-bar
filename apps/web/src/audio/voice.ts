/**
 * 语音会话层：把「游戏节点」翻译成「谁说哪一句」。
 * - 默认走浏览器原生 speechSynthesis（零素材、离线可用）
 * - 每个角色有独立音色参数（pitch/rate），同一角色音色保持一致
 * - 所有播报都会写进 history，并挂到 window.__VOICE__ 供自动化核对
 */

import { clearGameTimeout, onGameVisibility, setGameTimeout, type GameTimer } from '../gameClock';
import { holdAmbience, releaseAmbience } from './sfx';

const RATE_BOOST = 1.1;

/**
 * 音量层次：旁白只做「叙述」，压低一点让位；角色台词站在最前面。
 * 台词一起，环境底噪自动让位（holdAmbience），说完再浮回来。
 */
function lineGain(name: string): number {
  return name === '旁白' ? 0.86 : 0.96;
}

export interface Speaker {
  name: string;
  pitch: number;
  rate: number;
}

export const NARRATOR: Speaker = { name: '旁白', pitch: 0.98, rate: 1.02 };

export interface VoiceRecord {
  text: string;
  speaker: string;
  at: number;
  spoken: boolean;
}

let masterVolume = 1;
/** 立即更新正在播放及随后排队的角色配音音量。 */
export function setVoiceMasterVolume(v: number): void {
  masterVolume = Math.min(1, Math.max(0, v));
  voice.refreshVolume();
  // 自动化探针：确认刷新后持久化音量真的传到了语音层
  if (typeof window !== 'undefined') {
    (window as unknown as { __VOICE_VOL__?: number }).__VOICE_VOL__ = masterVolume;
  }
}

class VoiceSession {
  enabled = true;
  /** 全局语速倍率（跟随 ?speed 参数） */
  speed = 1;
  history: VoiceRecord[] = [];
  private currentHooks: { onEnd?: () => void } | null = null;
  private queue: {
    text: string;
    sp: Speaker;
    src?: string;
    hooks?: { onStart?: () => void; onEnd?: () => void };
    volume?: number;
  }[] = [];
  private audio: HTMLAudioElement | null = null;
  private currentGain = 1;
  private utterance: SpeechSynthesisUtterance | null = null;
  private busy = false;
  private hidden = false;
  private watchdog: GameTimer | null = null;
  private voice: SpeechSynthesisVoice | null = null;

  constructor() {
    // 配音与回合使用同一暂停点，继续时保留当前音轨的播放位置。
    const unsubscribe = onGameVisibility((hidden) => {
      this.hidden = hidden;
      if (hidden) {
        this.audio?.pause();
        if (this.busy && !this.audio && this.supported) window.speechSynthesis.pause();
      } else {
        const current = this.audio;
        if (current) void current.play().catch(() => {
          // 快速来回切页会主动暂停尚未完成的 play()，不要误判为文件失效。
          if (!this.hidden && this.audio === current) current.onerror?.(new Event('error'));
        });
        if (this.supported && window.speechSynthesis.paused) window.speechSynthesis.resume();
        this.pump();
      }
    });
    import.meta.hot?.dispose(unsubscribe);
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const load = () => {
        const voices = window.speechSynthesis.getVoices();
        // 优先自然度高的普通话音色；排掉 macOS 的“趣味音”（Grandma/Rocko 之类）
        const PREFER = ['Tingting', 'Meijia', 'Shelley', 'Sandy', 'Flo'];
        const NOVELTY = /grandma|grandpa|rocko|eddy|reed|bells|jester|organ|trinoids|whisper|boing|bubbles|cellos|zarvox/i;
        const zh = voices.filter((v) => /^zh/i.test(v.lang ?? ''));
        const scored = zh
          .filter((v) => !NOVELTY.test(v.name))
          .sort((a, b) => {
            const ai = PREFER.findIndex((n) => a.name.includes(n));
            const bi = PREFER.findIndex((n) => b.name.includes(n));
            const as = ai === -1 ? 99 : ai;
            const bs = bi === -1 ? 99 : bi;
            if (as !== bs) return as - bs;
            // 普通话优先于台湾/粤语
            return (a.lang === 'zh-CN' ? 0 : 1) - (b.lang === 'zh-CN' ? 0 : 1);
          });
        this.voice = scored[0] ?? zh[0] ?? null;
      };
      load();
      window.speechSynthesis.addEventListener?.('voiceschanged', load);
    }
  }

  get supported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  /** 更新当前配音元素，后续曲目在启动时读取同一个主音量。 */
  refreshVolume(): void {
    if (this.audio) this.audio.volume = masterVolume * this.currentGain;
    if (this.utterance) this.utterance.volume = masterVolume * this.currentGain;
  }

  /** 关闭播报时释放正在等待配音结束的流程，避免静音后仍等待数秒。 */
  setEnabled(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    if (!on) this.stop();
  }

  /** 播放预生成配音；没有对应文件时退回 TTS。hooks 用来做「谁在说话」的高亮 */
  speakAudio(
    text: string,
    speaker: Speaker,
    src: string | null,
    hooks?: { onStart?: () => void; onEnd?: () => void },
    volume = 1,
  ): Promise<void> {
    const clean = sanitize(text);
    if (!clean) {
      hooks?.onEnd?.();
      return Promise.resolve();
    }

    this.history.push({ text: clean, speaker: speaker.name, at: Date.now(), spoken: this.enabled });
    if (this.history.length > 60) this.history.shift();
    (window as unknown as { __VOICE__?: VoiceRecord[] }).__VOICE__ = this.history;

    // 静音/不支持时立刻放行，别让调用方干等
    if (!this.enabled || (!this.supported && !src)) {
      hooks?.onEnd?.();
      return Promise.resolve();
    }

    return new Promise<void>((done) => {
      const wrapped = {
        onStart: hooks?.onStart,
        onEnd: () => {
          hooks?.onEnd?.();
          done();
        },
      };
      if (src) {
        this.queue.push({ text: clean, sp: speaker, src, hooks: wrapped, volume });
      } else {
        this.queue.push({ text: clean, sp: speaker, hooks: wrapped, volume });
      }
      this.pump();
    });
  }

  setSpeed(v: number): void {
    this.speed = Number.isFinite(v) && v > 0 ? v : 1;
  }

  /** 立刻停掉正在播的和排队的（重开 / 退出时用） */
  stop(): void {
    // 队列里被丢弃的台词必须回调 onEnd，否则 speakAndWait 只能等 guard 定时器
    // （最长约 6.5 秒/句）—— 重开后演出会整体滞后。
    for (const item of this.queue) item.hooks?.onEnd?.();
    this.queue.length = 0;
    // 正在播的那句也一样：pause() 不会触发 onended
    this.currentHooks?.onEnd?.();
    this.currentHooks = null;
    this.busy = false;
    releaseAmbience();
    if (this.watchdog) {
      clearGameTimeout(this.watchdog);
      this.watchdog = null;
    }
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio = null;
    }
    this.utterance = null;
    if (this.supported) window.speechSynthesis.cancel();
  }

  speak(text: string, speaker: Speaker = NARRATOR): void {
    const clean = sanitize(text);
    if (!clean) return;

    this.history.push({ text: clean, speaker: speaker.name, at: Date.now(), spoken: this.enabled });
    if (this.history.length > 60) this.history.shift();
    (window as unknown as { __VOICE__?: VoiceRecord[] }).__VOICE__ = this.history;

    if (!this.enabled || !this.supported) return;
    // 排队上限放宽到 6：宁可稍微滞后，也不要让台词说到一半被切掉
    if (this.queue.length >= 6) this.queue.shift()?.hooks?.onEnd?.();
    this.queue.push({ text: clean, sp: speaker });
    this.pump();
  }

  private pump(): void {
    if (!this.enabled || this.hidden || this.busy || this.queue.length === 0) return;
    const synth = window.speechSynthesis;
    const item = this.queue.shift();
    if (!item) return;

    // ① 有预生成配音就直接播，音色由录制时决定
    this.currentHooks = item.hooks ?? null;
    this.currentGain = lineGain(item.sp.name) * Math.min(1, Math.max(0.2, item.volume ?? 1));
    if (item.src) {
      this.busy = true;
      const el = new Audio(item.src);
      this.audio = el;
      el.volume = masterVolume * this.currentGain;
      // 轻微加速：台词更紧凑，1.1 倍对音色影响很小
      el.playbackRate = clamp(RATE_BOOST * this.speed, 0.8, 1.6);
      item.hooks?.onStart?.();
      holdAmbience();
      const done = () => {
        if (this.audio !== el) return;
        releaseAmbience();
        this.currentHooks = null;
        item.hooks?.onEnd?.();
        this.busy = false;
        this.audio = null;
        this.pump();
      };
      el.onended = done;
      // 切后台引起的 play() 中断保留当前音轨；真正加载失败才交给 TTS。
      const fallback = () => {
        if (this.audio !== el) return;
        releaseAmbience();
        this.busy = false;
        this.audio = null;
        this.queue.unshift({ ...item, src: undefined });
        this.pump();
      };
      el.onerror = fallback;
      void el.play().catch(() => { if (!this.hidden) fallback(); });
      return;
    }

    if (!this.supported) {
      this.currentHooks = null;
      item.hooks?.onEnd?.();
      this.pump();
      return;
    }
    const utter = new SpeechSynthesisUtterance(item.text);
    utter.lang = 'zh-CN';
    // 收敛到自然区间：pitch/rate 拉太开会立刻变成“机器人”
    utter.pitch = clamp(item.sp.pitch, 0.85, 1.15);
    utter.rate = clamp(item.sp.rate, 0.9, 1.08);
    this.utterance = utter;
    utter.volume = masterVolume * this.currentGain;
    if (this.voice) utter.voice = this.voice;

    // 取消或超时后的迟到事件不可干扰下一句，也只结算一次回调。
    const release = () => {
      if (this.utterance !== utter) return;
      this.utterance = null;
      this.currentHooks = null;
      item.hooks?.onEnd?.();
      releaseAmbience();
      if (this.watchdog) {
        clearGameTimeout(this.watchdog);
        this.watchdog = null;
      }
      this.busy = false;
      this.pump();
    };

    this.busy = true;
    utter.onend = release;
    utter.onerror = release;
    item.hooks?.onStart?.();
    holdAmbience();
    // headless / 无语音包时 onend 可能永远不来，兜底放行
    this.watchdog = setGameTimeout(release, 900 + item.text.length * 220);
    synth.speak(utter);
  }
}

/** 台词里给人看的符号，念出来会变成噪音，先清掉 */
function sanitize(text: string): string {
  return (text ?? '')
    .replace(/[（(][^）)]{0,12}[）)]/g, '') // （沉默）这类舞台提示
    .replace(/[…]+/g, '，')                  // 省略号 → 停顿
    .replace(/[—–-]{2,}/g, '，')
    .replace(/["“”]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[，。]+/, '')
    .trim();
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export const voice = new VoiceSession();
