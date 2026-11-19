/**
 * 音频清单：游戏里**所有**音频资源的唯一出处。
 *
 * 以前音效路径散在 sfx.ts，语音路径靠 `vo-qwen/<角色>_<节点>_<索引>.mp3`
 * 的命名约定现拼，想知道"这游戏一共多少音频"得去数文件。
 * 现在集中在这里：加音频只改这个文件，找音频也只来这儿找。
 */

/** 音效类（短音，一次性播放） */
export const SFX = {
  'card-deal': 'assets/sfx/card-deal.mp3',
  'card-play': 'assets/sfx/card-play.mp3',
  'card-flip': 'assets/sfx/card-flip.mp3',
  'card-tick': 'assets/sfx/card-tick.mp3',
  'card-untick': 'assets/sfx/card-untick.mp3',
  challenge: 'assets/sfx/challenge.mp3',
  'gun-shot': 'assets/sfx/gun-shot.mp3',
  'gun-empty': 'assets/sfx/gun-empty.mp3',
  tick: 'assets/sfx/tick.mp3',
  win: 'assets/sfx/win.mp3',
  lose: 'assets/sfx/lose.mp3',
} as const;

export type SfxName = keyof typeof SFX;

/** 环境类（循环播放，音量会呼吸） */
export const AMBIENCE = {
  tavern: 'assets/sfx/ambience.mp3',
} as const;

export type AmbienceName = keyof typeof AMBIENCE;

/* ------------------------------------------------------------------ */
/* 语音：<角色>_<节点>_<序号>[_<点数>].mp3                              */
/* ------------------------------------------------------------------ */

/** 语音的角色代号（与 characters.ts 的 id 对应） */
export const VOICE_IDS = ['fox', 'raven', 'boar', 'cat', 'mage', 'rogue'] as const;
export type VoiceId = (typeof VOICE_IDS)[number];

/** 旁白单独一个音色，不属于四个角色 */
export const NARRATOR_ID = 'narrator';

/**
 * 语音节点的完整清单。
 * 顺序不重要，但**新增节点必须加进来**，否则 `auditVoice()` 会报未登记。
 */
export const VOICE_NODES = [
  // 主动选角时的招牌台词，也可在原声集单独试听。
  'signature',
  // 基础
  'round',
  'play',
  'challenge',
  'truth',
  'lie',
  'empty',
  'bang',
  'win',
  // 特定时刻
  'lastCard',
  'cornered',
  'grudge',
  'witness',
  'opening',
  'tension',
  'duel',
] as const;

export type VoiceNode = (typeof VOICE_NODES)[number];

/** 带 {rank} 占位的节点：文件按点数分包（`fox_play_0_K.mp3`） */
export const RANK_VARIANT_NODES: readonly VoiceNode[] = ['round', 'play'];

const VOICE_ROOT = 'vo-qwen';

/** 拼一条语音的路径 */
export function voicePath(id: string, node: string, index: number, rank?: string | null): string {
  const base = `${VOICE_ROOT}/${id}_${node}_${index}`;
  return rank ? `${base}_${rank}.mp3` : `${base}.mp3`;
}

/* ------------------------------------------------------------------ */
/* 分组：给"音乐包"视图用                                               */
/* ------------------------------------------------------------------ */

export interface AudioGroup {
  key: string;
  label: string;
  /** 数量（语音按角色分，音效按类别分） */
  count: number;
  note: string;
}

/** 概要：用来在设置/关于里显示"这个音频包有什么" */
export function audioSummary(): AudioGroup[] {
  return [
    { key: 'sfx', label: '音效', count: Object.keys(SFX).length, note: '发牌 / 开枪 / 质疑' },
    { key: 'ambience', label: '环境', count: Object.keys(AMBIENCE).length, note: '酒馆底噪（循环）' },
    { key: 'voice', label: '角色语音', count: VOICE_IDS.length, note: `${VOICE_IDS.length} 个角色 × ${VOICE_NODES.length} 个场景` },
    { key: 'narrator', label: '旁白', count: 1, note: '回合 / 点数 / 结算' },
  ];
}

/**
 * 这个音频包有多少「组」内容。
 * 语音每组的实际文件数取决于台词条数 + 点数变体（实际 300+ 个 mp3），
 * 这里只统计结构规模，数字由 `VOICE_FILE_COUNT` 单独说明。
 */
export function audioGroupCount(): number {
  return Object.keys(SFX).length + Object.keys(AMBIENCE).length + VOICE_IDS.length * VOICE_NODES.length + 1;
}

/** 语音文件的实际总数（生成时统计，改台词后要同步这个数） */
export const VOICE_FILE_COUNT = 494;

/** 所有音效路径（预加载用） */
export function allSfxPaths(): string[] {
  return Object.values(SFX);
}

/** 所有环境音路径 */
export function allAmbiencePaths(): string[] {
  return Object.values(AMBIENCE);
}
