/**
 * 角色 = 人物 + 性格。
 * 性格不是装饰：personality.aggression / lieBias 会喂给 AI 的 chooseAction，
 * 直接改变这个角色的打牌风格（多疑 = 更爱抓，狡诈 = 有真牌也敢撒谎）。
 */

import type { AiOptions } from '@liars/engine';
import type { ModelKey } from '../three/models';
import { voicePath } from '../audio/manifest';
import { asset } from './assetPath';

export type Species = ModelKey;

export interface Palette {
  fur: string;
  muzzle: string;
  accent: string;
}

export interface Personality {
  /** 0–1：多疑程度，越高越爱质疑 */
  aggression: number;
  /** 0–1：狡诈程度，越高越倾向撒谎 */
  lieBias: number;
  /** 角色在特定牌局中的决策习惯，由规则引擎执行。 */
  tactic?: AiOptions['tactic'];
  label: string;
  traits: { name: string; value: number }[];
}

export type LineNode =
  | 'signature'
  | 'round'
  | 'play'
  | 'challenge'
  | 'truth'
  | 'lie'
  | 'empty'
  | 'bang'
  | 'win'
  /** 手里只剩最后一张牌 */
  | 'lastCard'
  /** 被质疑且手牌不多，背水一战 */
  | 'cornered'
  /** 被抓过不止一次，开始记仇 */
  | 'grudge'
  /** 亲眼看着别人被枪毙时的反应 */
  | 'witness'
  /** 开局第一句（第一轮开始，一人只说一次） */
  | 'opening'
  /** 有人快走完了，桌上其他人的反应 */
  | 'tension'
  /** 只剩两个人，最后的对峙 */
  | 'duel';

export interface Character {
  /** 撒谎/紧张时的可观察破绽（bio 里承诺过，得真的做出来） */
  tell?: { part: 'ear' | 'tail'; amp: number };
  id: string;
  name: string;
  title: string;
  species: Species;
  palette: Palette;
  glyph: string;
  bio: string;
  personality: Personality;
  voice: { pitch: number; rate: number };
  lines: Record<LineNode, string[]>;
}

export const CHARACTERS: Character[] = [
  {
    id: 'fox',
    tell: { part: 'ear', amp: 1 },
    name: '狡狐·维克斯',
    title: '天生的骗子',
    species: 'fox',
    palette: { fur: '#d9772f', muzzle: '#f3e3cd', accent: '#8a3f12' },
    glyph: '狐',
    bio: '它的尾巴比嘴诚实——可惜没人看得懂尾巴。它撒谎时耳朵会抖，但它自己不知道。',
    personality: {
      aggression: 0.62,
      lieBias: 0.45,
      tactic: 'reserveTruth',
      label: '奸诈',
      traits: [
        { name: '狡诈', value: 92 },
        { name: '多疑', value: 58 },
        { name: '胆量', value: 74 },
      ],
    },
    voice: { pitch: 1.05, rate: 1.02 },
    lines: {
      signature: ['看我的爪子，多干净。'],
      round: ['{rank}。巧了，我最喜欢这个数。', '这轮 {rank}，都别急着表态。'],
      play: ['这些当然是 {rank}，我发誓。', '这几张 {rank}，我的爪子很干净。', '看我的眼睛，像撒谎吗？'],
      challenge: ['骗子。别装了。', '你耳朵在抖，伙计。', '开！'],
      truth: ['我说实话的时候反而没人信。', '看见没，货真价实。'],
      lie: ['好吧好吧，被你逮到一次。', '这局牌太滑了，没抓住。'],
      empty: ['咔——狐狸命大。', '空枪。继续玩？'],
      bang: ['……尾巴，收好。'],
      win: ['赢家请客，输家买单。'],
      lastCard: ['最后一张了。你们猜它是什么？', '就这一张，赌不赌？'],
      cornered: ['行吧，看牌。', '翻吧，反正我也没退路了。'],
      grudge: ['又盯上我了？行啊。', '我今天是不是太显眼了。'],
      witness: ['啧……下一个是谁呢。', '这桌的椅子又空了一把。'],
      opening: ['晚上好。今晚我会很诚实——大概吧。'],
      tension: ['他快走完了。你们就那么看着？'],
      duel: ['就剩我们俩了。你还打算装多久？', '桌子清空了。现在轮到真话了。'],
    },
  },
  {
    id: 'raven',
    tell: { part: 'ear', amp: 0.4 },
    name: '鸦先生',
    title: '从不摘礼帽',
    species: 'raven',
    palette: { fur: '#37404f', muzzle: '#cfd6e0', accent: '#8a6a3f' },
    glyph: '鸦',
    bio: '没人见过他摘帽子。他说话像在念讣告，输牌的人通常也很快用得上。',
    personality: {
      aggression: 0.48,
      lieBias: 0.52,
      tactic: 'doubtTriple',
      label: '阴森',
      traits: [
        { name: '狡诈', value: 84 },
        { name: '多疑', value: 46 },
        { name: '耐心', value: 90 },
      ],
    },
    voice: { pitch: 0.93, rate: 0.94 },
    lines: {
      signature: ['帽子不摘，失礼了。'],
      round: ['{rank}。', '目标：{rank}。开始吧。'],
      play: ['{rank}。', '都在这里。'],
      challenge: ['开。', '不。'],
      truth: ['事实。', '我没有理由骗你。'],
      lie: ['……值得一试。', '被看见了。'],
      empty: ['（沉默）', '还没到时候。'],
      bang: ['（礼帽落地）'],
      win: ['（他把筹码推到你面前，转身离开）'],
      lastCard: ['最后一张。像一具没盖盖子的棺材。', '就剩它了。你们最好祈祷它是真的。'],
      cornered: ['翻开吧。反正结局都一样。', '看。看清楚了。'],
      grudge: ['你们记住我的次数，比我记住你们的多。', '记性太好，是种病。'],
      witness: ['……少了一个。位置会变冷的。', '我记下了。这个位置，空着。'],
      opening: ['诸位。今晚谁先开口，谁先死。'],
      tension: ['快结束了。总会有人先沉不住气。'],
      duel: ['两个人。一把枪。你先。', '现在没人能替你撒谎了。'],
    },
  },
  {
    id: 'boar',
    tell: { part: 'ear', amp: 0.3 },
    name: '屠夫·大壮',
    title: '憨得可疑',
    species: 'boar',
    palette: { fur: '#7a5a42', muzzle: '#d8c4a8', accent: '#4a6b3a' },
    glyph: '猪',
    bio: '他从来不说谎，所以他赢的时候，没人相信他真的没撒谎。',
    personality: {
      aggression: 0.24,
      lieBias: 0.06,
      label: '憨直',
      traits: [
        { name: '狡诈', value: 8 },
        { name: '多疑', value: 24 },
        { name: '胆量', value: 66 },
      ],
    },
    voice: { pitch: 0.95, rate: 0.96 },
    lines: {
      signature: ['拍胸脯！俺说话算数。'],
      round: ['{rank}！俺记性不好，只说一遍啊。', '这轮 {rank}，谁也别欺负俺。'],
      play: ['都是 {rank}，俺不骗人。', '{rank}，真的，俺发誓。'],
      challenge: ['你、你骗人！', '俺不信！翻！'],
      truth: ['看吧！俺没骗人！', '俺早说了。'],
      lie: ['俺、俺记错了……', '对不起对不起，俺不是故意的。'],
      empty: ['咔！俺还活着！', '空空的，继续继续。'],
      bang: ['……俺娘说别玩这个。'],
      win: ['赢了？俺赢了？！'],
      lastCard: ['就剩这一张了，俺不骗人。', '最后一张，真的！'],
      cornered: ['翻吧翻吧，俺没撒谎！', '哎呀，你们咋就不信俺呢。'],
      grudge: ['俺咋老被你们抓呢。', '又是俺？俺今天招谁惹谁了。'],
      witness: ['哎呀妈呀……真响。', '这、这就没了？'],
      opening: ['俺就说一句：俺不骗人。真的。'],
      tension: ['他快没牌了……俺是不是该抓他？'],
      duel: ['就咱俩了？俺、俺有点紧张。', '兄弟，俺真不想跟你抢这个。'],
    },
  },
  {
    id: 'cat',
    tell: { part: 'tail', amp: 0.6 },
    name: '小猫·米拉',
    title: '看着最无害',
    species: 'cat',
    palette: { fur: '#8a7358', muzzle: '#f0e4d0', accent: '#c99b3f' },
    glyph: '猫',
    bio: '她的兜帽是自己缝的，裙子上的补丁是别人输给她的。别被那双眼睛骗了。',
    personality: {
      aggression: 0.58,
      lieBias: 0.4,
      label: '机灵',
      traits: [
        { name: '狡诈', value: 78 },
        { name: '多疑', value: 66 },
        { name: '手速', value: 82 },
      ],
    },
    voice: { pitch: 1.12, rate: 1.04 },
    lines: {
      signature: ['我就偷瞄一眼，喵。'],
      round: ['{rank} 呀……好巧，我正好有几张。', '这轮是 {rank} 呢。'],
      play: ['{rank}，我保证哦。', '都是 {rank}，你看看嘛。'],
      challenge: ['你在骗人。我看得出来。', '喵——翻开。'],
      truth: ['我真的没有撒谎。', '看嘛，是真的。'],
      lie: ['哎呀，被你发现了。', '下次我会更小心哦。'],
      empty: ['咔，还活着。', '轮到你啦。'],
      bang: ['……兜帽，留给下一个人。'],
      win: ['谢谢款待！'],
      lastCard: ['最后一张啦，要不要猜猜？', '就剩一张了，紧张吗？'],
      cornered: ['翻就翻嘛，凶什么凶。', '哼，看就看。'],
      grudge: ['怎么老是我呀。', '你们是不是针对我。'],
      witness: ['喵……别看我，我什么都没说。', '唔，好可怕。'],
      opening: ['开始啦？那我先看看你们的表情。'],
      tension: ['他要走啦。你们都不着急吗？'],
      duel: ['只剩你和我啦。要不要聊点别的？', '别紧张嘛，我很好猜的——才怪。'],
    },
  },
  {
    id: 'mage',
    name: '老法师·奥登',
    title: '手总有火花',
    species: 'mage',
    palette: { fur: '#5a4a8a', muzzle: '#e8e0f5', accent: '#b48cff' },
    glyph: '法',
    bio: '他自称能看穿谎言，但每次说完都要先给自己倒一杯。袍子上的烧洞比赢过的局还多。',
    personality: {
      aggression: 0.44,
      lieBias: 0.38,
      label: '莫测',
      traits: [
        { name: '狡诈', value: 76 },
        { name: '多疑', value: 62 },
        { name: '耐心', value: 80 },
      ],
    },
    voice: { pitch: 0.96, rate: 0.95 },
    lines: {
      signature: ['小小火花……哎，我的胡子！'],
      round: ['{rank}。让我看看……有点意思。', '这一轮是 {rank}。牌会说谎，火焰不会。'],
      play: ['这几张 {rank}，以我的胡子起誓。', '看好了，{rank}。', '我从不作弊——那是低级手段。'],
      challenge: ['你在抖。我看得见。', '牌不会骗人，人会。', '让我验证一下。'],
      truth: ['我说真话的时候，你们反而更怕。', '看吧。老骨头还没糊涂。'],
      lie: ['……哦。手滑了。', '这个法术有点失灵。'],
      empty: ['空枪。运气站在我这边。', '咔。老天还不想收我。'],
      bang: ['……原来，是这一发。'],
      win: ['经验这东西，赢起来很无聊。'],
      lastCard: ['最后一张。要我施个咒吗？', '就这一张了，你们要不要赌一把。'],
      cornered: ['翻吧。反正我活得够久了。', '看牌？好。'],
      grudge: ['你们为什么总盯着老人家。', '记性太好，是修行的一部分。'],
      witness: ['……愿他安息。轮到谁了？', '生命短暂，牌局漫长。'],
      opening: ['我活了两百年，就为了这局牌。'],
      tension: ['他快走了。我闻到味道了。'],
      duel: ['只剩你我。像一场古老的仪式。', '年轻人，让老人家先。'],
    },
  },
  {
    id: 'rogue',
    name: '浪人·希拉',
    title: '手比眼睛快',
    species: 'rogue',
    palette: { fur: '#4a5a4a', muzzle: '#d8e0d0', accent: '#7fa06a' },
    glyph: '浪',
    bio: '没人知道她从哪来。她的袖子里能掏出任何东西——包括你没打出的那张牌。',
    personality: {
      aggression: 0.68,
      lieBias: 0.52,
      label: '野性',
      traits: [
        { name: '狡诈', value: 84 },
        { name: '多疑', value: 40 },
        { name: '胆量', value: 82 },
      ],
    },
    voice: { pitch: 1.02, rate: 1.06 },
    lines: {
      signature: ['找这张？晚了。'],
      round: ['{rank}。行吧，来。', '这轮 {rank}，别磨蹭。'],
      play: ['{rank}，拿去。', '这几张 {rank}，信不信随你。', '快点，我手痒。'],
      challenge: ['少来这套。', '你的手在动。', '抓你。'],
      truth: ['看清楚了？', '真话比谎话难说，但我说了。'],
      lie: ['行，这手算你的。', '啧。被抓到了。'],
      empty: ['空枪。还以为今天要交代了。', '咔。走运。'],
      bang: ['……真不该坐下。'],
      win: ['钱我收了，酒留给你们。'],
      lastCard: ['最后一张。想看？', '就这一张，你敢赌吗。'],
      cornered: ['翻！少废话。', '来啊。'],
      grudge: ['又是抓我。你们有完没完。', '记着这笔账。'],
      witness: ['又一个。这桌不吉利。', '……下一个别是我。'],
      opening: ['别问我来路，我也不问你筹码哪来的。'],
      tension: ['他要走完了。有人动手吗？'],
      duel: ['一对一。这次没有借口了。', '你和我。牌在中间。'],
    },
  },
];

export function findCharacter(id: string): Character {
  return CHARACTERS.find((c) => c.id === id) ?? (CHARACTERS[0] as Character);
}

export function pickLine(
  character: Character,
  node: LineNode,
  rank?: string | null,
  count?: number,
): string {
  return pickLineCue(character, node, rank, count).text;
}

/**
 * 同 pickLine，但同时给出预生成音频的路径。
 * 配音文件由 scripts/gen-vo-qwen.py 用 Qwen Audio 3.1 Flash 生成（带缓存）：
 * /vo-qwen/<角色>_<节点>_<序号>[_<点数>].mp3
 */
/** 这些句子只在打 2–3 张时说得通，打 1 张时要跳过 */
const PLURAL_MARKERS = ['这些', '这几张', '都是', '都在这里'];

export function pickLineCue(
  character: Character,
  node: LineNode,
  rank?: string | null,
  count?: number,
): { text: string; audio: string | null } {
  const all = character.lines[node] ?? [];
  if (all.length === 0) return { text: '', audio: null };

  // 只打 1 张时，滤掉带复数词的句子；滤空了就退回全部（宁可句子不贴切，也不能没台词）
  let indices = all.map((_, i) => i);
  if (count === 1) {
    const singular = indices.filter((i) => !PLURAL_MARKERS.some((m) => (all[i] ?? '').includes(m)));
    if (singular.length > 0) indices = singular;
  }

  const i = indices[Math.floor(Math.random() * indices.length)] ?? 0;
  const raw = all[i] ?? '';

  const useRank = !!rank && raw.includes('{rank}');
  const text = rank ? raw.replace(/\{rank\}/g, rank) : raw.replace(/\{rank\}/g, '这几点');

  // 含 {rank} 的句子按点数分包；不含的直接用
  const audio = useRank
    ? asset(voicePath(character.id, node, i, rank))
    : asset(voicePath(character.id, node, i));
  return { text, audio };
}

/**
 * 给定一句已经排好的台词，反查它对应的音频路径。
 * 用于「排期和播放分开」的场景（排期决定说哪句，播放时按同一句取音频）。
 */
export function findAudioFor(character: Character, text: string, rank?: string | null): string | null {
  const nodes = Object.keys(character.lines) as LineNode[];
  for (const node of nodes) {
    const pool = character.lines[node];
    for (let i = 0; i < pool.length; i += 1) {
      const raw = pool[i] ?? '';
      const rendered = rank ? raw.replace(/\{rank\}/g, rank) : raw.replace(/\{rank\}/g, '这几点');
      if (rendered !== text) continue;
      return raw.includes('{rank}')
        ? asset(voicePath(character.id, node, i, rank))
        : asset(voicePath(character.id, node, i));
    }
  }
  return null;
}
