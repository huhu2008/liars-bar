/**
 * 音频模块的统一出口。
 *
 * 全游戏只有这一个地方管声音：
 *   - `manifest`  资源清单（有什么、在哪）
 *   - `sfx`       短音效 + 环境底噪
 *   - `voice`     角色台词与旁白
 *
 * 外部只 import 这个文件，不要直接摸子模块 —— 这样以后换实现（比如改成
 * 一个 AudioWorklet 混音器）时，调用方一行都不用动。
 */

export {
  SFX,
  AMBIENCE,
  VOICE_IDS,
  VOICE_NODES,
  NARRATOR_ID,
  RANK_VARIANT_NODES,
  voicePath,
  audioSummary,
  audioGroupCount,
  VOICE_FILE_COUNT,
  allSfxPaths,
  allAmbiencePaths,
  type SfxName,
  type AmbienceName,
  type VoiceId,
  type VoiceNode,
  type AudioGroup,
} from './manifest';

export {
  sfx,
  setSfxEnabled,
  setMasterVolume,
  startAmbience,
  stopAmbience,
  holdAmbience,
  releaseAmbience,
} from './sfx';

export {
  voice,
  NARRATOR,
  setVoiceMasterVolume,
  type Speaker,
} from './voice';

/* ------------------------------------------------------------------ */
/* 预加载                                                              */
/* ------------------------------------------------------------------ */

import { asset } from '../data/assetPath';
import { allAmbiencePaths, allSfxPaths } from './manifest';

/**
 * 预加载全部短音效与环境音（语音太多，按需加载）。
 *
 * 目的：进牌桌前把几百 KB 的短音塞进 HTTP 缓存，
 * 避免第一次发牌/开枪时因为下载而延迟。
 */
export function preloadAudio(): void {
  if (typeof window === 'undefined') return;
  const paths = [...allSfxPaths(), ...allAmbiencePaths()];
  for (const p of paths) {
    const el = new Audio();
    el.preload = 'auto';
    el.src = asset(p);
    // 触发下载即可，不需要播放
    el.load();
  }
}
