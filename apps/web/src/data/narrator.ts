/**
 * 旁白配音表（Qwen Audio 3.1 Flash，音色：闻怀之，讲故事语气）。
 * 由 scripts/gen-vo-qwen.py 生成，缺文件时 voice 层会自动退回 TTS。
 */

import { asset } from './assetPath';

const VO = asset('vo-qwen');
const MAX_ROUND = 20;

export interface Cue {
  text: string;
  audio: string | null;
}

function cue(text: string, audio: string | null): Cue {
  return { text, audio };
}

/** 轮次播报：超过预录范围就只给文本，交给 TTS */
export function roundCue(n: number): Cue {
  return n >= 1 && n <= MAX_ROUND
    ? cue(`第 ${n} 轮。`, `${VO}/narrator_round_${n}.mp3`)
    : cue(`第 ${n} 轮。`, null);
}

export function rankCue(rank: string): Cue {
  const ok = /^([2-9]|10|J|Q|K|A)$/.test(rank);
  return ok ? cue(`点数 ${rank}。`, `${VO}/narrator_rank_0_${rank}.mp3`) : cue(`点数 ${rank}。`, null);
}

export const NARRATOR_CUES = {
  truth: cue('是真的。', `${VO}/narrator_truth_0.mp3`),
  lie: cue('他撒谎了。', `${VO}/narrator_lie_0.mp3`),

  bang: cue('砰！', `${VO}/narrator_bang_0.mp3`),
  empty: cue('空枪。', `${VO}/narrator_empty_0.mp3`),
  timeoutChallenge: cue('超时，自动质疑。', `${VO}/narrator_timeout_challenge_0.mp3`),
  timeoutPlay: cue('超时，自动出牌。', `${VO}/narrator_timeout_play_0.mp3`),
  timeoutSkip: cue('手里没牌了，过。', `${VO}/narrator_timeout_skip_0.mp3`),
  seat: cue('坐下吧。牌已经洗好了。', `${VO}/narrator_seat_0.mp3`),
  voiceOn: cue('语音已开启。', `${VO}/narrator_voice_on_0.mp3`),
  voiceOff: cue('语音已关闭。', `${VO}/narrator_voice_off_0.mp3`),
};

/** 赢家播报：4 个角色名 + 「有人」 */
export function winnerCue(id: string | null, name: string): Cue {
  const key = id && ['fox', 'raven', 'boar', 'cat'].includes(id) ? id : 'someone';
  return cue(`${name}，是最后一个活着的人。`, `${VO}/narrator_win_0_${key}.mp3`);
}

/** 翻牌结算的旁白：直接报出出牌人的名字，不用「他」指代 */
export const REVEAL_CUES: Record<string, { lie: Cue; truth: Cue }> = {
  fox: {
    lie: cue('狡狐·维克斯撒谎了。', `${VO}/narrator_lie_fox.mp3`),
    truth: cue('狡狐·维克斯说的是真的。', `${VO}/narrator_truth_fox.mp3`),
  },
  raven: {
    lie: cue('鸦先生撒谎了。', `${VO}/narrator_lie_raven.mp3`),
    truth: cue('鸦先生说的是真的。', `${VO}/narrator_truth_raven.mp3`),
  },
  boar: {
    lie: cue('屠夫·大壮撒谎了。', `${VO}/narrator_lie_boar.mp3`),
    truth: cue('屠夫·大壮说的是真的。', `${VO}/narrator_truth_boar.mp3`),
  },
  cat: {
    lie: cue('小猫·米拉撒谎了。', `${VO}/narrator_lie_cat.mp3`),
    truth: cue('小猫·米拉说的是真的。', `${VO}/narrator_truth_cat.mp3`),
  },
};
