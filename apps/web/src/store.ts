import { clearGameTimeout, gameNow, setGameTimeout, type GameTimer } from './gameClock';
import {
  applyCommand,
  chooseAction,
  createGame,
  buildMatchRecord,
  project,
  type Card,
  type Command,
  type GameEvent,
  type GameState,
  type MatchRecord,
  type PlayerView,
} from '@liars/engine';
import { create } from 'zustand';
import { CHARACTERS, findAudioFor, findCharacter, pickLine, pickLineCue, type Character } from './data/characters';
import { NARRATOR_CUES, REVEAL_CUES, rankCue, roundCue, winnerCue } from './data/narrator';
import { NARRATOR, setVoiceMasterVolume, voice, type Speaker } from './audio/voice';
import { setMasterVolume, sfx, startAmbience, stopAmbience } from './audio/sfx';

import { firstMismatch, FLIP_DURATION_MS, FLIP_INTERVAL_MS, type ChallengeReveal } from './data/challengeReveal';

export const HUMAN_SEAT = 0;

/** 回合计时：人类玩家 30 秒不出手就自动托管。?turn=4000 可缩短，便于验证超时链路。 */
function readTurnMs(): number {
  if (typeof window === 'undefined') return 30_000;
  const raw = Number(new URLSearchParams(window.location.search).get('turn'));
  // 下限放宽到 600ms：调试和自动化需要短回合，别静默忽略参数
  return Number.isFinite(raw) && raw >= 600 ? raw : 30_000;
}

export const TURN_MS = readTurnMs();

function speakerOf(character: Character): Speaker {
  return { name: character.name, pitch: character.voice.pitch, rate: character.voice.rate };
}

const RECORDS_KEY = 'liars-bar:records';
const MAX_RECORDS = 50;
type SavedRecord = MatchRecord & { matchId?: string };

/** 新桌使用独立标识；刷新后沿用存档中的标识来避免重复记账。 */
function newMatchId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `table-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** 本轮真人刚出局且仍有机器人在场，暂停自动续轮，让玩家选择去留。 */
export function awaitingSpectatorChoice(game: Pick<GameState, 'phase' | 'lastReveal'>): boolean {
  return game.phase === 'round_end' && game.lastReveal?.punishedSeat === HUMAN_SEAT && game.lastReveal.died;
}

/** 从 localStorage 读历史战绩（坏数据一律当空） */
function loadRecords(): SavedRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECORDS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.slice(-MAX_RECORDS) : [];
  } catch {
    return [];
  }
}

/** 将最近五十场个人战绩一次性保存。 */
function saveRecords(list: SavedRecord[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RECORDS_KEY, JSON.stringify(list.slice(-MAX_RECORDS)));
  } catch {
    /* 隐私模式下写不了，忽略 */
  }
}

/** 玩家结果落定就记账；重复续局和其余电脑之后的终局共用同一条记录。 */
function recordPlayerResult(game: GameState, matchId: string, current: SavedRecord[]): SavedRecord[] {
  if (game.phase !== 'game_end' && game.players[HUMAN_SEAT]?.alive) return current;
  if (current.some(record => record.matchId === matchId)) return current;
  const persisted = loadRecords();
  if (persisted.some(record => record.matchId === matchId)) return persisted;
  const recent = persisted.length ? persisted : current;
  const records = [...recent, { ...buildMatchRecord(game, HUMAN_SEAT), matchId }].slice(-MAX_RECORDS);
  saveRecords(records);
  return records;
}

/** 正式开始演出时才记入当前牌局快照，刷新、换模型或暂停都不会重复播放同一段。 */
export function consumeTableReaction(seq: number): boolean {
  const state = useGame.getState();
  if (state.screen !== 'table' || seq <= state.lastReactionSeq) return false;
  useGame.setState({ lastReactionSeq: seq });
  saveGame();
  return true;
}

const SAVE_KEY = 'liars-bar:save';

/** 存档：只存纯数据（GameState 完全可序列化），刷新后能接着打 */
function saveGame(): void {
  if (typeof window === 'undefined') return;
  try {
    const st = useGame.getState();
    if (st.screen !== 'table' || !st.game) return;
    const payload = {
      game: st.game,
      matchId: st.matchId,
      lastReactionSeq: st.lastReactionSeq,
      characterId: st.characterId,
      playerCount: st.playerCount,
      at: Date.now(),
      // 结算中被打断时，把面板出现的时刻也存下来
      pendingReveal: st.game.phase === 'round_end' || st.game.phase === 'game_end',
    };
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
  } catch {
    /* 存不下就放弃，不影响当前这局 */
  }
}

/** 校验牌组中的每张牌，避免残缺数据在发牌、翻牌时才导致白屏。 */
function validCards(cards: unknown): cards is Card[] {
  return Array.isArray(cards) && cards.every(card => card && typeof card.id === 'string'
    && typeof card.rank === 'string' && typeof card.suit === 'string');
}

/** 名册和续局入口共用同一份校验；旧存档缺少公开牌记录时按空记录读取。 */
export function loadSave(): { matchId: string; lastReactionSeq: number; game: GameState; characterId: string; playerCount: number } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!Number.isFinite(saved?.at) || Date.now() - saved.at > 12 * 3600_000) return null;
    if (!CHARACTERS.some(c => c.id === saved.characterId)) return null;
    const g: GameState = saved.game;
    if (!g || (g.phase !== 'turn' && g.phase !== 'round_end') || !Array.isArray(g.players)) return null;
    const count = g.players.length;
    if (count < MIN_PLAYERS || count > MAX_PLAYERS || !Number.isInteger(g.round) || g.round < 1) return null;
    // 座位同时用于引擎数组索引和角色绑定；缺失或乱序的座位不能安全恢复。
    const validSeat = (seat: number) => Number.isInteger(seat) && seat >= 0 && seat < count;
    if (!validSeat(g.turnSeat) || !g.players.every((v, i) => v && v.seat === i && typeof v.name === 'string'
      && typeof v.alive === 'boolean' && typeof v.isBot === 'boolean' && validCards(v.hand))) return null;
    if (!validCards(g.deck) || !validCards(g.discard) || !validCards(g.publicCards ?? [])) return null;
    if (!Array.isArray(g.log) || !g.log.every(e => e && typeof e.text === 'string')
      || !Array.isArray(g.liesBySeat) || !Array.isArray(g.correctChallenges)) return null;
    if (g.pendingPlay && (!validSeat(g.pendingPlay.seat) || !validCards(g.pendingPlay.cards)
      || g.pendingPlay.claimCount !== g.pendingPlay.cards.length)) return null;
    if (g.lastReveal && (!validCards(g.lastReveal.cards) || !validSeat(g.lastReveal.playSeat)
      || !validSeat(g.lastReveal.challengerSeat) || !validSeat(g.lastReveal.punishedSeat))) return null;
    // 旧快照用已有稳定字段生成标识，同一份旧档多次恢复也只记录一次。
    const matchId = typeof saved.matchId === 'string' && saved.matchId
      ? saved.matchId : `legacy-${saved.at}-${g.seed}`;
    // 旧档没有展示游标，从尚未处理的公开事件继续；异常游标不会屏蔽未来反应。
    const lastReactionSeq = Number.isInteger(saved.lastReactionSeq) && saved.lastReactionSeq >= 0
      && saved.lastReactionSeq <= g.seq ? saved.lastReactionSeq : -1;
    return { matchId, lastReactionSeq, game: { ...g, publicCards: g.publicCards ?? [] }, characterId: saved.characterId, playerCount: count };
  } catch {
    return null;
  }
}

/** 放弃对局时清除本地快照。 */
export function clearSave(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

const VOICE_ENABLED_KEY = 'liars-bar:voice-enabled';

/** 在开场音频入队前读取语音偏好，首次使用及无法读取时默认开启。 */
function loadVoiceEnabled(): boolean {
  try {
    return typeof window === 'undefined' || window.localStorage.getItem(VOICE_ENABLED_KEY) !== 'false';
  } catch {
    return true;
  }
}

/** 从本地设置读取主音量。 */
function loadVolume(): number {
  if (typeof window === 'undefined') return 0.8;
  try {
    const raw = window.localStorage.getItem('liars-bar:volume');
    const v = raw === null ? 0.8 : Number(raw);
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.8;
  } catch {
    return 0.8;
  }
}

export const MIN_PLAYERS = 2;
// 官方牌堆 20 张（Q6 K6 A6 + 赖子2）：4 人 × 5 张正好发完，5 人以上发不出
export const MAX_PLAYERS = 4;

/**
 * 建局：人数决定座位数，座位数决定发牌、轮转、视角。
 * 真人固定坐 0 号位（永远在镜头正前方），其余座位按角色顺序填入机器人。
 */
/**
 * 从存档里的玩家名反推角色数组（按 seat 顺序）。
 *
 * 存档只存了 game（含玩家名），没有存 characters。之前恢复时调用 buildMatch
 * 重新随机抽了一套角色 —— 玩家名是旧的、角色是新的，座位上就出现了
 * 「屠夫的名字坐着浪人」这种错位。
 */
function charactersFromGame(game: GameState): Character[] {
  return game.players.map((p) => CHARACTERS.find((c) => c.name === p.name) ?? CHARACTERS[0]!);
}

export function buildMatch(
  characterId: string,
  playerCount = 4,
): { game: GameState; characters: Character[] } {
  const total = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.round(playerCount)));
  const picked = findCharacter(characterId);
  // 对手要随机抽：之前是「按数组顺序取前几个」，
  // 排在后面的角色（法师、浪人）永远上不了场。
  const others = CHARACTERS.filter((c) => c.id !== picked.id);
  const shuffled = [...others];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  const seats = [picked, ...shuffled].slice(0, total);
  const game = createGame({
    names: seats.map((c) => c.name),
    seed: ((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) || 1,
    botSeats: seats.map((_, i) => i).filter((i) => i !== 0),
  });
  return { game, characters: seats };
}

/** 事件 → 语音节点 */
/**
 * 高亮「谁在说话」。
 * 不依赖音频播放回调（headless/被拦截时不触发），按台词长度估一个时长。
 */
let speakTimer: GameTimer | null = null;
function markSpeaking(seat: number, text: string): void {
  if (speakTimer) clearGameTimeout(speakTimer);
  useGame.setState({ speakingSeat: seat });
  const dur = Math.min(3600, Math.max(1100, text.length * 230));
  speakTimer = setGameTimeout(() => {
    useGame.setState({ speakingSeat: null });
    speakTimer = null;
  }, dur);
}

/** 兜底用的估算时长：真实环境靠 onended 回调，估算只在回调没来时接手 */
function speechMs(text: string): number {
  return Math.min(5200, 900 + text.length * 240);
}

/**
 * 播放一句并等它**真正念完**。
 * 主路径是音频的 onended 回调；回调因静音/浏览器策略没触发时，用估算时长兜底。
 */
function speakAndWait(text: string, speaker: Speaker, src: string | null): Promise<void> {
  if (!text) return Promise.resolve();
  const gen = generation;
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled || gen !== generation) return;
      settled = true;
      clearGameTimeout(guard);
      pendingTimers.delete(guard);
      later(resolve, 0);
    };
    // 兜底：音频没播（被拦截/静音）就不要死等，1.2 倍语气估算就放行
    const guard = setGameTimeout(() => {
      pendingTimers.delete(guard);
      finish();
    }, speechMs(text) * 1.15 + 500);
    pendingTimers.add(guard);
    void voice.speakAudio(text, speaker, src, { onEnd: finish });
  });
}

/**
 * 一批事件按节拍串行播放。
 * 同一批里常见的组合是 CHALLENGED → REVEALED → SHOT → ROUND_END，
 * 它们必须依次发生：先拍桌、再翻牌、最后才举枪。全部同时触发就会「乱」。
 */
function speakEvents(events: GameEvent[], characters: Character[]): void {
  // 先为每个事件定好「要说哪句」，排期才知道每句多长
  const planned = events.map((event) => ({ event, cue: cueOf(event, characters) }));

  // 串行演出：一句说完再做下一件，靠音频 onended 回调推进
  // 先兜一层 catch：任何一轮演出抛异常都不能把整条链掐断，
  // 否则后续事件（包括终局结算和胜负音）全都不会执行
  const gen = generation;
  eventChain = eventChain.catch(() => {}).then(async () => {
    for (const { event, cue } of planned) {
      // 重开/换角色后这条链已经过期，立刻退出，别再动新局
      if (gen !== generation) return;
      await playOne(event, characters, gen, cue);
      if (gen !== generation) return;
    }
    if (gen !== generation) return;
    // 这一批（质疑→翻牌→开枪→结算）全部演完，才开始给面板计时
    const st = useGame.getState();
    if ((st.game.phase === 'round_end' || st.game.phase === 'game_end') && st.revealAt === null) {
      // 没有开枪的结算（比如手牌出完）：直接给 900ms
      useGame.setState({ revealAt: gameNow() + 900 });
    }
  });
}

/** 这个事件要说的话（排期和播放共用，避免两次随机到不同台词） */
function cueOf(event: GameEvent, characters: Character[]): string {
  switch (event.t) {
    case 'ROUND_START':
      return `第 ${event.round} 轮。点数 ${event.targetRank}。`;
    case 'PLAYED': {
      const c = characters[event.seat];
      if (!c) return '';
      const g = useGame.getState().game;

      // ── 特定时刻优先 ──
      // 1) 手上只剩最后一张：这时候说什么都比"我出 X"有戏
      const remaining = g?.players?.[event.seat]?.hand.length ?? 99;
      if (remaining === 1 && Math.random() > 0.35) {
        return pickLine(c, 'lastCard');
      }
      // 2) 被抓过不止一次：开始在话里带刺
      const caught = g?.liesBySeat?.[event.seat] ?? 0;
      if (caught >= 2 && Math.random() > 0.55) {
        return pickLine(c, 'grudge');
      }
      // 3) 平常：偶尔沉默更像真人
      if (Math.random() < 0.28) return '';
      return pickLine(c, 'play', event.claim, event.count);
    }
    case 'CHALLENGED': {
      const c = characters[event.seat];
      return c ? pickLine(c, 'challenge') : '';
    }
    case 'REVEALED': {
      const c = characters[event.playSeat];
      // 结论用「谁撒谎了」，别用「他」——玩家未必记得上一手是谁出的牌
      const verdict = c ? REVEAL_CUES[c.id]?.[event.truthful ? 'truth' : 'lie'] : null;
      return (verdict?.text ?? (event.truthful ? '是真的。' : '他撒谎了。'));
    }
    case 'SHOT': {
      const c = characters[event.seat];
      const who = c ? pickLine(c, event.died ? 'bang' : 'empty') : '';
      return (event.died ? '砰！' : '空枪。') + who;
    }
    case 'GAME_END': {
      const c = characters[event.winnerSeat];
      return c ? pickLine(c, 'win') : '';
    }
    default:
      return '';
  }
}

/** 上一批事件里「台词」占用的总时长（仅用于结算停留的兜底） */
/** 演出串行链：保证上一批没演完，下一批不插队 */
let eventChain: Promise<void> = Promise.resolve();

async function playOne(event: GameEvent, characters: Character[], gen: number, plannedCue?: string): Promise<void> {
  {
    switch (event.t) {
      case 'ROUND_START': {
        if (gen === generation) { useGame.setState({ shotSeat: null, revealAt: null }); }
        {
          const r = roundCue(event.round);
          await speakAndWait(r.text, NARRATOR, r.audio);
          const k = rankCue(event.targetRank);
          await speakAndWait(k.text, NARRATOR, k.audio);

          // 开局第一句：只在第一轮，随机挑一个对手说（都说会太拖）
          if (event.round === 1) {
            const g = useGame.getState().game;
            const alive = characters
              .map((c, i) => ({ c, seat: i }))
              .filter(({ seat }) => g?.players?.[seat]?.alive);
            if (alive.length > 0) {
              const pickOne = alive[Math.floor(Math.random() * alive.length)]!;
              const op = pickLineCue(pickOne.c, 'opening');
              if (op.text) {
                await new Promise<void>((res) => later(res, 420 / SPEED));
                markSpeaking(pickOne.seat, op.text);
                await speakAndWait(op.text, speakerOf(pickOne.c), op.audio);
              }
            }
          }
        }
        break;
      }
      case 'PLAYED': {
        sfx('card-play');
        // 有人出完这手只剩一张牌 → 桌上其他人会有反应（低概率，别每次都触发）
        {
          const g0 = useGame.getState().game;
          if (g0?.players?.[event.seat]?.hand.length === 1 && Math.random() < 0.45) {
            const alive = characters
              .map((x, i) => ({ c: x, seat: i }))
              .filter(({ seat }) => seat !== event.seat && g0?.players?.[seat]?.alive);
            if (alive.length > 0) {
              const other = alive[Math.floor(Math.random() * alive.length)]!;
              const ten = pickLineCue(other.c, 'tension');
              if (ten.text) {
                await new Promise<void>((res) => later(res, 340 / SPEED));
                markSpeaking(other.seat, ten.text);
                await speakAndWait(ten.text, speakerOf(other.c), ten.audio);
              }
            }
          }
        }
        const c = characters[event.seat];
        // plannedCue === '' 表示这一手刻意沉默
        if (c && plannedCue !== '') {
          const cue = plannedCue
            ? { text: plannedCue, audio: findAudioFor(c, plannedCue, event.claim) }
            : pickLineCue(c, 'play', event.claim, event.count);
          markSpeaking(event.seat, cue.text);
          await speakAndWait(cue.text, speakerOf(c), cue.audio);
        }
        break;
      }
      case 'CHALLENGED': {
        sfx('challenge');
        // 质疑声和转头同时开始；静音或短台词也给玩家留出看清反应的时间。
        const reactionStart = gameNow();
        const c = characters[event.seat];
        if (c) {
          const cue = plannedCue ? { text: plannedCue, audio: pickLineCue(c, 'challenge').audio } : pickLineCue(c, 'challenge');
          markSpeaking(event.seat, cue.text);
          await speakAndWait(cue.text, speakerOf(c), cue.audio);
        }
        const remaining = 680 / SPEED - (gameNow() - reactionStart);
        if (remaining > 0) await new Promise<void>(resolve => later(resolve, remaining));
        if (gen !== generation) return;
        break;
      }
      case 'REVEALED': {
        // 与翻牌声同步揭开桌上暗牌，质疑台词期间保留牌背。
        const stage = useGame.getState().challengeReveal;
        if (stage) {
          useGame.setState({ awaitingCardFlip: false, challengeReveal: { ...stage, startedAt: gameNow() } });
        }
        sfx('card-flip');
        // 正常等渲染器确认决定性牌面已经可见再说出台词；无三维画面时让二维记录接手。
        const mismatch = firstMismatch(event.cards, useGame.getState().game.targetRank);
        const needed = mismatch < 0 ? event.cards.length : mismatch + 1;
        if (stage) await waitForVisibleCards(needed, event.cards.length, gen);
        if (gen !== generation) return;
        const c = characters[event.playSeat];
        if (c) {
          const cue = pickLineCue(c, event.truthful ? 'truth' : 'lie');
          markSpeaking(event.playSeat, cue.text);
          await speakAndWait(cue.text, speakerOf(c), cue.audio);
        }
        {
          const pc = characters[event.playSeat];
          const named = pc ? REVEAL_CUES[pc.id]?.[event.truthful ? 'truth' : 'lie'] : null;
          const c = named ?? (event.truthful ? NARRATOR_CUES.truth : NARRATOR_CUES.lie);
          await speakAndWait(c.text, NARRATOR, c.audio);
        }
        break;
      }
      case 'SHOT': {
        if (gen === generation) { useGame.setState({ shotSeat: event.seat }); }
        // 举枪动画在 0.75s 才走到开火帧、枪声也是那时响的。
        // 旁白必须等这一下，否则「空枪」会比枪声早 0.75 秒报出来。
        await new Promise<void>((resolve) => later(resolve, 840 / SPEED));
        if (gen !== generation) return;
        // 枪声已出现，才同步座位生死、剩余弹仓和开枪记录。
        useGame.setState({ challengeReveal: null });
        {
          const c = event.died ? NARRATOR_CUES.bang : NARRATOR_CUES.empty;
          await speakAndWait(c.text, NARRATOR, c.audio);
        }
        const c = characters[event.seat];
        if (c) {
          const cue = pickLineCue(c, event.died ? 'bang' : 'empty');
          markSpeaking(event.seat, cue.text);
          await speakAndWait(cue.text, speakerOf(c), cue.audio);
        }

        // 有人真的死了：剩下的人会有反应
        // 只剩两个人时改说「最后的对峙」，比旁观台词更有分量
        if (event.died) {
          const g = useGame.getState().game;
          const survivors = characters
            .map((x, i) => ({ c: x, seat: i }))
            .filter(({ seat }) => seat !== event.seat && (g?.players?.[seat]?.alive ?? false));
          // 剩最后两个人（第 3 个人刚倒下）：由其中一个开口，气氛拉满
          if (survivors.length === 2) {
            const speaker = survivors[Math.floor(Math.random() * survivors.length)]!;
            const duel = pickLineCue(speaker.c, 'duel');
            if (duel.text) {
              await new Promise<void>((r) => later(r, 520 / SPEED));
              markSpeaking(speaker.seat, duel.text);
              await speakAndWait(duel.text, speakerOf(speaker.c), duel.audio);
            }
          } else if (survivors.length > 2) {
            const pickOne = survivors[Math.floor(Math.random() * survivors.length)]!;
            const wit = pickLineCue(pickOne.c, 'witness');
            if (wit.text) {
              await new Promise<void>((r) => later(r, 260 / SPEED));
              markSpeaking(pickOne.seat, wit.text);
              await speakAndWait(wit.text, speakerOf(pickOne.c), wit.audio);
            }
          }
        }

        // 枪演完（抬枪 0.55s + 扣扳机 + 放下）再给面板留 1.1s 缓冲
        if (gen === generation) { useGame.setState({ revealAt: gameNow() + 1100 }); }
        break;
      }
      case 'ROUND_END': {
        // 结算落定：此刻枪已经放回，面板可以出来了
        break;
      }
      case 'GAME_END': {
        // 你活到最后 = 胜利音；否则是旁人赢了
        if (gen === generation) { sfx(event.winnerSeat === 0 ? 'win' : 'lose'); }
        const c = characters[event.winnerSeat];
        {
          const w = winnerCue(c?.id ?? null, c?.name ?? '有人');
          await speakAndWait(w.text, NARRATOR, w.audio);
        }
        if (c) {
          const cue = pickLineCue(c, 'win');
          await speakAndWait(cue.text, speakerOf(c), cue.audio);
        }
        // 一局结束，存档失效（旧链不能删掉新局的存档）
        if (gen === generation) clearSave();
        // 终局要弹结算，但如果 SHOT 已经排过面板时间点就别覆盖（会重排计时）
        if (useGame.getState().revealAt === null) {
          useGame.setState({ revealAt: gameNow() + 900 });
        }
        break;
      }
      default:
        break;
    }
  }
  return Promise.resolve();
}

interface Store {
  screen: 'select' | 'table';
  matchId: string;
  lastReactionSeq: number;
  characterId: string;
  playerCount: number;
  characters: Character[];
  game: GameState;
  selected: string[];
  error: string | null;
  thinkingSeat: number | null;
  /** 只剩一两张牌、正在思考的座位。紧张程度只反映公开手牌数。 */
  tenseSeat: number | null;
  /** 跨局战绩（localStorage 累积） */
  records: SavedRecord[];
  /** 应用内音量 0–1 */
  volume: number;
  setVolume: (v: number) => void;
  /** 正在说话的人（用于高亮）；null = 旁白或没人 */
  speakingSeat: number | null;
  /** 正在举枪的人（由 SHOT 事件驱动，不是结算一开始就举） */
  shotSeat: number | null;
  /** 规则已结算，但演出仍停留在质疑台词阶段。 */
  awaitingCardFlip: boolean;
  /** 质疑时的公开快照与已翻张数，仅存在于本次演出，不写进存档。 */
  challengeReveal: ChallengeReveal | null;
  /** 发牌信号：旁白念完才递增，手牌动画据此启动 */
  dealSignal: number;
  /** 收牌后到发牌前，手牌不渲染。收进 store 是为了让各入口能原子重置，
   *  之前它是组件内 useState，重开时没人清就会整轮看不到牌。 */
  handHidden: boolean;
  /** 这一轮的全部演出（含开枪）播完了，结算面板可以出现 */
  /** 结算面板最早出现的时刻（演出全部播完 + 余量）；null = 还没排 */
  revealAt: number | null;
  /** 收手牌信号：一轮结束后，手里的牌先飞走，再进下一轮 */
  collectHand: number;
  /** 人类回合的截止时间戳（ms）；null 表示当前不需要计时 */
  deadline: number | null;
  /** lead 期间锁住操作：动画没播完不该能点 */
  inputLocked: boolean;
  voiceOn: boolean;

  view: () => PlayerView;
  dispatch: (cmd: Command) => void;
  toggleCard: (id: string) => void;
  playSelected: () => void;
  challenge: () => void;
  passTurn: () => void;
  nextRound: () => void;
  timeoutAction: () => void;
  restart: () => void;
  resumeSaved: () => boolean;
  chooseCharacter: (id: string, playerCount?: number) => void;
  setPlayerCount: (n: number) => void;
  backToSelect: () => void;
  toggleVoice: () => void;
}

/**
 * 世代号：每次 clearTimers（重开/换角色/回选角）自增。
 * 旧局的事件链每 await 一步就比对一次，过期立即退出 ——
 * 否则旧链会往新局里 setState / clearSave / 写战绩。
 */
let generation = 0;

let botTimer: GameTimer | null = null;
let turnTimer: GameTimer | null = null;

/** 所有一次性定时器都登记在这里，重开/退出时一起清掉，避免残留污染新局 */
const pendingTimers = new Set<GameTimer>();
function later(fn: () => void, ms: number): void {
  const id = setGameTimeout(() => {
    pendingTimers.delete(id);
    fn();
  }, ms);
  pendingTimers.add(id);
}

/** 订阅真实翻面进度；无 WebGL 或渲染长时间未就绪时，由二维入口按同一顺序揭晓。 */
function waitForVisibleCards(needed: number, total: number, gen: number): Promise<void> {
  return new Promise(resolve => {
    const fallback = setGameTimeout(() => {
      const stage = useGame.getState().challengeReveal;
      if (stage && gen === generation) useGame.setState({ challengeReveal: { ...stage, turned: total } });
    }, (FLIP_DURATION_MS + (total - 1) * FLIP_INTERVAL_MS) / SPEED + 1200);
    const unsubscribe = useGame.subscribe(({ challengeReveal }) => {
      if (gen === generation && challengeReveal && challengeReveal.turned < needed) return;
      unsubscribe();
      clearGameTimeout(fallback);
      resolve();
    });
  });
}

/** 只清回合调度用的计时器（schedule 每次重排都会调，不能误伤别的一次性定时器） */
function clearRoundTimers(): void {
  if (botTimer) clearGameTimeout(botTimer);
  if (turnTimer) clearGameTimeout(turnTimer);
  if (speakTimer) clearGameTimeout(speakTimer);
  botTimer = null;
  turnTimer = null;
  speakTimer = null;
}

/** 全局清理：重开 / 换角色 / 退出时用，连同排期中的一次性定时器和音频 */
/** 一局/一个界面之间会被复用的 UI 状态；
 *  任何一个入口忘了清，就会出现「手牌不渲染 / 举枪姿势残留 / 面板不出」这类怪状。
 *  统一走这里，别再各写各的。 */
const IDLE_UI = {
  lastReactionSeq: -1,
  selected: [] as string[],
  error: null as string | null,
  deadline: null as number | null,
  thinkingSeat: null as number | null,
  tenseSeat: null as number | null,
  speakingSeat: null as number | null,
  shotSeat: null as number | null,
  awaitingCardFlip: false,
  challengeReveal: null as ChallengeReveal | null,
  revealAt: null as number | null,
  collectHand: 0,
  inputLocked: false,
  handHidden: false,
};

function clearTimers(): void {
  generation += 1;
  eventChain = Promise.resolve();
  clearRoundTimers();
  for (const id of pendingTimers) clearGameTimeout(id);
  pendingTimers.clear();
  if (speakTimer) {
    clearGameTimeout(speakTimer);
    speakTimer = null;
  }
  // 定时器没了，高亮和紧张姿态也不能继续挂着
  useGame.setState({ speakingSeat: null, tenseSeat: null });
  voice.stop();
}

const initial = buildMatch(CHARACTERS[0]!.id, 4);

// 音量要在 store 建起来的那一刻就同步给音频层：
// 只恢复 UI 数值的话，滑块显示 30% 但声音仍是满的（刷新后必现）。
const INITIAL_VOLUME = loadVolume();
const INITIAL_VOICE_ENABLED = loadVoiceEnabled();
voice.setEnabled(INITIAL_VOICE_ENABLED);
setMasterVolume(INITIAL_VOLUME);
setVoiceMasterVolume(INITIAL_VOLUME);

export const useGame = create<Store>((set, get) => ({
  screen: 'select',
  matchId: newMatchId(),
  lastReactionSeq: -1,
  characterId: CHARACTERS[0]!.id,
  playerCount: 4,
  characters: initial.characters,
  game: initial.game,
  selected: [],
  error: null,
  thinkingSeat: null,
  tenseSeat: null,
  records: loadRecords(),
  volume: INITIAL_VOLUME,
  speakingSeat: null,
  shotSeat: null,
  awaitingCardFlip: false,
  challengeReveal: null,
  dealSignal: -1,
  handHidden: false,
  revealAt: null,
  collectHand: 0,
  deadline: null,
  inputLocked: false,
  voiceOn: INITIAL_VOICE_ENABLED,

  view: () => project(get().game, HUMAN_SEAT),

  dispatch: (cmd) => {
    const result = applyCommand(get().game, cmd);
    if (result.error) {
      // 非法命令不该打断正在播的演出：只报错，不动定时器和事件链
      set({ error: result.error });
      return;
    }
    clearTimers();
    // 出牌/质疑发生在这一瞬间，思考状态立刻结束（后面是演出时间）
    // 关键：如果新状态正好轮到人类，立刻先锁上。
    // 否则从这次 dispatch 到 schedule() 执行之间（旁白要念 1 秒多），
    // 会出现「是我的回合、能点、却没有倒计时」的空窗。
    const nextMine = result.state.phase === 'turn' && result.state.turnSeat === HUMAN_SEAT;
    set({
      game: result.state,
      awaitingCardFlip: cmd.t === 'CHALLENGE',
      challengeReveal: cmd.t === 'CHALLENGE' ? {
        before: project(get().game, HUMAN_SEAT), startedAt: null, turned: 0,
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      } : null,
      records: recordPlayerResult(result.state, get().matchId, get().records),
      selected: [],
      error: null,
      thinkingSeat: null,
      deadline: null,
      inputLocked: nextMine,
    });
    // 给自动化留一个状态探针（只读，不影响逻辑）
    (window as unknown as { __GAME__?: unknown }).__GAME__ = result.state;
    {
      const w = window as unknown as { __EVENTS__?: unknown[] };
      w.__EVENTS__ = [
        ...(w.__EVENTS__ ?? []).slice(-200),
        ...result.events.map((e) => ({ at: Date.now(), ...e })),
      ];
    }
    // 每次有效操作同步写入小型快照，立即刷新也保留最后一步。
    saveGame();
    speakEvents(result.events, get().characters);
    // 演出全部结束后状态机才推进
    const gen = generation;
    void eventChain.then(() => { if (generation === gen) schedule(); });
  },

  toggleCard: (id) => {
    const st = get();
    // 选牌同样要守门：别人的回合、演出期间都不该能改选择
    if (st.inputLocked || st.game.phase !== 'turn' || st.game.turnSeat !== HUMAN_SEAT) return;
    const { selected } = st;
    if (selected.includes(id)) {
      sfx('card-untick');
      set({ selected: selected.filter((x) => x !== id), error: null });
      return;
    }
    if (selected.length >= 3) {
      set({ error: '一手最多 3 张' });
      return;
    }
    sfx('card-tick');
    set({ selected: [...selected, id], error: null });
  },

  playSelected: () => {
    const st = get();
    // 防连点：演出期间（inputLocked）或不是自己的回合，点击一律忽略。
    // 之前没有这层判断，连点会把整手牌一口气全打出去。
    if (st.inputLocked || st.game.phase !== 'turn' || st.game.turnSeat !== HUMAN_SEAT) return;
    if (st.selected.length === 0) {
      set({ error: '先选 1–3 张牌' });
      return;
    }
    // 以扇形中的左右顺序交牌，翻开与结算时每张牌仍在原来的桌面位置。
    const cardIds = st.game.players[HUMAN_SEAT]!.hand.filter(card => st.selected.includes(card.id)).map(card => card.id);
    get().dispatch({ t: 'PLAY', seat: HUMAN_SEAT, cardIds });
  },

  challenge: () => {
    const st = get();
    if (st.inputLocked || st.game.phase !== 'turn' || st.game.turnSeat !== HUMAN_SEAT) return;
    get().dispatch({ t: 'CHALLENGE', seat: HUMAN_SEAT });
  },

  passTurn: () => {
    const st = get();
    if (st.inputLocked || st.game.phase !== 'turn' || st.game.turnSeat !== HUMAN_SEAT) return;
    get().dispatch({ t: 'PASS', seat: HUMAN_SEAT });
  },

  nextRound: () => {
    const st = get();
    if (st.game.phase !== 'round_end') return;
    // 收牌声 + 发牌动画要跟着「进入下一轮」这个动作走，
    // 不管是玩家点按钮还是计时器自动推进，路径都一样。
    set({ collectHand: st.collectHand + 1 });
    get().dispatch({ t: 'NEXT_ROUND' });
    later(() => {
      useGame.setState((prev) => ({ dealSignal: prev.dealSignal + 1 }));
    }, ROUND_CALL);
  },

  /** 超时托管：有牌在桌上就抓，否则出一张 */
  timeoutAction: () => {
    const st = get();
    const { game } = st;
    if (st.inputLocked || game.phase !== 'turn' || game.turnSeat !== HUMAN_SEAT) return;
    if (game.pendingPlay) {
      voice.speakAudio(NARRATOR_CUES.timeoutChallenge.text, NARRATOR, NARRATOR_CUES.timeoutChallenge.audio);
      get().dispatch({ t: 'CHALLENGE', seat: HUMAN_SEAT });
      return;
    }
    const me = game.players[HUMAN_SEAT];
    if (!me) return;
    // 前面已经处理了「桌上有牌可质疑」的情况，走到这里说明没得抓
    if (me.hand.length === 0) {
      voice.speakAudio(NARRATOR_CUES.timeoutSkip.text, NARRATOR, NARRATOR_CUES.timeoutSkip.audio);
      get().dispatch({ t: 'PASS', seat: HUMAN_SEAT });
      return;
    }
    const card = me.hand[0];
    if (!card) return;
    voice.speakAudio(NARRATOR_CUES.timeoutPlay.text, NARRATOR, NARRATOR_CUES.timeoutPlay.audio);
    get().dispatch({ t: 'PLAY', seat: HUMAN_SEAT, cardIds: [card.id] });
  },

  restart: () => {
    clearTimers();
    lastRound = -1;
    const match = buildMatch(get().characterId, get().playerCount);
    set({
      ...IDLE_UI,
      dealSignal: get().dealSignal + 1,
      game: match.game,
      matchId: newMatchId(),
      characters: match.characters,
      screen: 'table',
    });
    saveGame();
    schedule();
  },

  setPlayerCount: (n) => {
    const total = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.round(n)));
    set({ playerCount: total });
  },

  /** 从存档接着打（刷新页面后点「继续上一局」） */
  resumeSaved: () => {
    const saved = loadSave();
    if (!saved) return false;
    clearTimers();
    // 角色必须从存档的玩家名还原，不能重新随机 —— 否则名字和模型对不上
    set({
      ...IDLE_UI,
      dealSignal: get().dealSignal + 1,
      characterId: saved.characterId,
      playerCount: saved.playerCount,
      game: saved.game,
      matchId: saved.matchId,
      lastReactionSeq: saved.lastReactionSeq,
      records: recordPlayerResult(saved.game, saved.matchId, get().records),
      characters: charactersFromGame(saved.game),
      screen: 'table',
    });
    startAmbience();
    // 结算中被打断：演出早已结束，直接把面板叫出来，别让玩家干等 25 秒
    const g = saved.game;
    saveGame();
    if (g.phase === 'round_end' || g.phase === 'game_end') {
      useGame.setState({ revealAt: gameNow() + 300 });
      schedule();
    } else {
      schedule();
    }
    return true;
  },

  chooseCharacter: (id, playerCount) => {
    clearTimers();
    const total = playerCount ?? get().playerCount;
    const match = buildMatch(id, total);
    set({
      ...IDLE_UI,
      // 注意：这里不加 dealSignal —— 下面 later(2200ms) 会触发一次，
      // 两处都加会导致开局发牌动画播两遍。
      characterId: id,
      playerCount: total,
      game: match.game,
      matchId: newMatchId(),
      characters: match.characters,
      screen: 'table',
    });
    // 在开场演出之前保存初始牌局，保证第一次操作前就可以续局。
    saveGame();
    voice.speakAudio(NARRATOR_CUES.seat.text, NARRATOR, NARRATOR_CUES.seat.audio);
    startAmbience();
    // 开局没有 ROUND_START 事件（初始状态由 createGame 生成），这里手动排一次发牌
    later(() => {
      useGame.setState((st) => ({ dealSignal: st.dealSignal + 1 }));
    }, 2200 / SPEED);

    // 开局第一句：随机挑一个对手开口，先立住人物
    const gen0 = generation;
    later(() => {
      if (gen0 !== generation) return;
      const alive = match.characters
        .map((c, i) => ({ c, seat: i }))
        .filter(({ seat }) => match.game.players[seat]?.alive);
      if (alive.length === 0) return;
      const pickOne = alive[Math.floor(Math.random() * alive.length)]!;
      const op = pickLineCue(pickOne.c, 'opening');
      if (!op.text) return;
      markSpeaking(pickOne.seat, op.text);
      void speakAndWait(op.text, speakerOf(pickOne.c), op.audio);
    }, 3400 / SPEED);

    schedule();
  },

  backToSelect: () => {
    clearTimers();
    lastRound = -1;
    stopAmbience();
    // revealAt 残留 = 新局 inReveal 恒真 = 手牌整层不渲染（审计发现的两个入口之一）
    set({
      screen: 'select',
      challengeReveal: null,
      deadline: null,
      thinkingSeat: null,
      tenseSeat: null,
      inputLocked: false,
      revealAt: null,
          shotSeat: null,
      collectHand: 0,
    });
    clearSave();
  },

  setVolume: (v) => {
    const clamped = Math.min(1, Math.max(0, v));
    setMasterVolume(clamped);
    setVoiceMasterVolume(clamped);
    set({ volume: clamped });
  },

  toggleVoice: () => {
    const on = !get().voiceOn;
    voice.setEnabled(on);
    // 语音开关只影响角色和旁白，牌桌音效、环境声由主音量控制。
    try {
      window.localStorage.setItem(VOICE_ENABLED_KEY, String(on));
    } catch {
      /* 隐私模式下仍将设置应用于本次会话。 */
    }
    set({ voiceOn: on });
    if (on) voice.speakAudio(NARRATOR_CUES.voiceOn.text, NARRATOR, NARRATOR_CUES.voiceOn.audio);
  },
}));

/** 上一轮看到第几轮，用来判断「是不是刚发完牌」 */
let lastRound = -1;

/**
 * 统一驱动：机器人思考、结算停留、人类回合计时。
 *
 * 关键：每一步都留出动画缓冲，状态机不抢在动画前面跑。
 *   新一轮 → 等发牌飞完（DEAL_LEAD）
 *   出牌后 → 等牌落到桌上（PLAY_LEAD）
 *   结算   → 等举枪演完再进下一轮（REVEAL_HOLD）
 */
/** 全局节奏倍率：?speed=1.5 整体加速 50%，?speed=0.8 放慢。默认 1 */
export const SPEED = (() => {
  if (typeof window === 'undefined') return 1;
  const v = Number(new URLSearchParams(window.location.search).get('speed'));
  return Number.isFinite(v) && v > 0.2 && v < 4 ? v : 1;
})();

/** 旁白「第 X 轮。点数 Y。」的时长——发牌要等这句话念完 */
const ROUND_CALL = 2700 / SPEED;
voice.setSpeed(SPEED);

const DEAL_LEAD = 820 / SPEED;   // 发牌动画 0.74s + 余量
const PLAY_LEAD = 320 / SPEED;   // 出牌落桌
const BOT_THINK = 720 / SPEED;   // 机器人「思考」固定时长，节奏才匀
const REVEAL_HOLD = 4400 / SPEED;

function schedule(): void {
  clearRoundTimers();
  const state = useGame.getState();
  const { game } = state;

  if (game.phase === 'game_end') {
    useGame.setState({ thinkingSeat: null, deadline: null, inputLocked: false });
    return;
  }

  if (game.phase === 'round_end') {
    // 结算期间没有输入可做，顺手解锁，免得残留 true 卡住下一轮
    useGame.setState({ thinkingSeat: null, deadline: null, inputLocked: false });

    /**
     * 关键：等这一轮的演出（质疑 → 翻牌 → 举枪 → 开枪）**真正播完**再进下一轮。
     * 判据是 revealAt —— 它在事件链跑完时由 SHOT / ROUND_END / GAME_END 排定。
     * 以前这里直接按固定 4.4s 计时，事件链还在播下一轮就开始了，开枪会跨轮。
     */
    // 真人刚出局时由结算面板明确选择继续观战或重开。
    if (awaitingSpectatorChoice(game)) return;
    let waited = 0;
    const waitShowDone = () => {
      const st = useGame.getState();
      const cur = st.game;
      if (cur.phase !== 'round_end') return;      // 已经推进了

      if (st.revealAt === null) {
        waited += 250;
        // 兜底：等太久（事件链异常）就强制推进，别让整局停死
        if (waited > 30000) {
          useGame.getState().nextRound();
          return;
        }
        botTimer = setGameTimeout(waitShowDone, 250);
        return;
      }

      // 演出播完 → 面板出现（revealAt）→ 再留 2.2s 给人看结果
      const remain = Math.max(800, st.revealAt + 2200 - gameNow());
      botTimer = setGameTimeout(() => {
        const now = useGame.getState();
        if (now.game.phase !== 'round_end') return;
        now.nextRound();
      }, remain);
    };
    waitShowDone();
    return;
  }

  // 事件队列本身是串行 await 的（eventChain），走到 schedule 时已经播完，
  // 这里只需要一个很短的动作余量，让"出牌动画"落定后状态再推进。
  let lead = PLAY_LEAD;
  if (game.round !== lastRound) {
    lastRound = game.round;
    lead = Math.max(lead, ROUND_CALL + DEAL_LEAD);
  }

  const seat = game.turnSeat;
  if (game.players[seat]?.isBot) {
    useGame.setState({ thinkingSeat: seat, deadline: null, inputLocked: false });

    // 思考时长按性格来：胆大/急躁的人拍板快，多疑的人磨蹭
    const who = useGame.getState().characters[seat];
    const aggression = who?.personality.aggression ?? 0.5;
    const patience = 1.4 - aggression;              // 0.78 ~ 1.16
    const jitter = 0.92 + Math.random() * 0.16;      // 手动随机抖动，别像机器
    // 决策仍由规则引擎处理；思考姿势和时长只由公开局势与性格决定。
    const currentGame = useGame.getState().game;
    const decision = chooseAction(currentGame, seat, who?.personality);
    const think = BOT_THINK * (0.75 + patience * 0.55) * jitter;
    const count = currentGame.players[seat]!.hand.length;
    useGame.setState({ tenseSeat: count > 0 && count <= 2 ? seat : null });

    botTimer = setGameTimeout(() => {
      const current = useGame.getState().game;
      if (current.phase === 'turn' && current.turnSeat === seat) {
        useGame.getState().dispatch(decision);
      }
    }, lead + think);
    return;
  }

  // 人类回合：30 秒倒计时，超时自动托管
  // 发牌/出牌动画期间不显示计时环，动画结束才开始倒计时
  // 演出还没播完：先锁住操作，避免「按钮能点、却没有倒计时」的混乱
  useGame.setState({ thinkingSeat: null, deadline: null, inputLocked: true });
  turnTimer = setGameTimeout(() => {
    const current = useGame.getState();
    if (current.game.phase !== 'turn' || current.game.turnSeat !== HUMAN_SEAT) return;
    // 动画放完，正式起表并解锁
    useGame.setState({ deadline: gameNow() + TURN_MS, inputLocked: false });
    turnTimer = setGameTimeout(() => {
      const now = useGame.getState();
      if (now.game.phase === 'turn' && now.game.turnSeat === HUMAN_SEAT) now.timeoutAction();
    }, TURN_MS);
  }, lead);
}

// 自动化探针
if (typeof window !== 'undefined') {
  (window as unknown as { __STORE__?: unknown }).__STORE__ = useGame;
}
