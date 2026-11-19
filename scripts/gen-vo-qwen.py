#!/usr/bin/env python3
"""
用 Qwen Audio 3.1 Flash 生成全部角色配音（带缓存）。

    python3 scripts/gen-vo-qwen.py [--force] [--only fox,cat]

缓存策略：
  - 目标 mp3 已存在 → 直接跳过，不发请求
  - 生成记录写在 public/vo-qwen/manifest.json（含 voice / rate / instruction / 时间）
  - --force 无视缓存全部重录

Key 从 .env.local 读（DASHSCOPE_API_KEY），不写进代码。
"""
import argparse
import asyncio
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time
import uuid
import wave

import websockets

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'apps/web/public/vo-qwen'
MANIFEST = OUT / 'manifest.json'
URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference'
MODEL = 'qwen-audio-3.1-tts-flash'
SAMPLE_RATE = 24000

# 角色 → 音色 / 语速 / 语气指令
# 目标：四个角色一开口就能听出是谁，靠 voice + rate + instruction 三层拉开
VOICE_MAP = {
    # 狡狐：年轻男声，快、油滑、带笑，尾音上扬
    'fox': {
        'voice': 'huozhuoshi_v3.1',
        'rate': 1.1,
        'instruction': '请用年轻、油滑、带笑意的语气说，像在跟人打趣耍滑头，句尾语气略微上扬。',
    },
    # 鸦先生：低沉男声，慢、冷，几乎没有起伏
    'raven': {
        'voice': 'anmingyuan_v3.1',
        'rate': 0.84,
        'instruction': '请用低沉、冷淡、几乎没有感情的语气说，语速缓慢，每句话结尾往下沉，句间停顿明显。',
    },
    # 屠夫：男声 + 东北话，憨厚直白
    'boar': {
        'voice': 'xunanchuan_v3.1',
        'rate': 0.96,
        'instruction': '请用朴实、憨厚、有点笨拙的语气说，像老实巴交的人。请用东北话表达。',
    },
    # 小猫：明亮女声，快、俏、撒娇
    'cat': {
        'voice': 'qiaoxiaojiao_v3.1',
        'rate': 1.16,
        'instruction': '请用明亮、俏皮、略带撒娇的语气说，像小女孩在耍小聪明，语调活泼。',
    },
    # 老法师：慢、沙、带点戏谑的老头
    'mage': {
        # libai（李白 / 古代诗仙男）：本身的音色就偏苍老古风，不用靠语速装
        # instruction 同样写短，理由见上面 rogue
        'voice': 'libai_v3.1',
        'rate': 1.2,
        'instruction': '苍老男性，平淡。',
    },
    # 浪人：女声，江湖气，短促不拖泥带水
    'rogue': {
        # longxiaobai（龙小白）：磁性、质感 —— 低音御姐
        # instruction 刻意写短：之前写 60 多字的详细指令，TTS 逐条照做反而拖沓生硬，
        # 实测同一句话 4.22s vs 3.33s，长指令慢了 27%。
        'voice': 'longxiaobai_v3.1',
        'rate': 1.0,
        'instruction': '成熟女性，低沉，随意。',
    },
    # 旁白：稳，讲故事。但不同场景要换语气，否则一整局都是同一个调子
    'narrator': {
        'voice': 'wenhuaizhi_v3.1',
        'rate': 0.98,
        'instruction': '请用自然生动的讲故事语气表达，注意句间停顿和语调变化。',
    },
}

# 旁白按场景细分语气：轮次/报点/揭穿/开枪/胜负 各不一样
NARRATOR_SCENES = {
    'round':    {'rate': 0.95, 'instruction': '请用平静、缓慢的语气铺陈，像在数夜里的时辰，不疾不徐。'},
    'rank':     {'rate': 1.02, 'instruction': '请简短干脆地报出这个点数，不加修饰。'},
    'lie':      {'rate': 1.05, 'instruction': '请用带一点揭穿意味的语气说，尾音下沉，像当场抓住了把柄。'},
    'truth':    {'rate': 0.95, 'instruction': '请用略带意外、语气放轻的方式说，像发现自己错怪了人。'},
    'bang':     {'rate': 1.2,  'instruction': '请短促有力地喊出来，像被这一声巨响吓到。'},
    'empty':    {'rate': 0.94, 'instruction': '请用松了口气的语气说，带一点气声。'},
    'timeout':  {'rate': 1.0,  'instruction': '请用中性提示的语气说，不催促也不责备。'},
    'win':      {'rate': 0.88, 'instruction': '请用郑重、低缓的语气收尾，像在给这一夜盖棺。'},
    'seat':     {'rate': 0.95, 'instruction': '请用平缓的开场语气说，像招呼人坐下。'},
    'voice_on': {'rate': 1.0,  'instruction': '请用简短的系统提示语气说。'},
    'voice_off':{'rate': 1.0,  'instruction': '请用简短的系统提示语气说。'},
}

# 场景情绪：同一角色在不同时刻该有不同的语气和语速。
# rate_mult 乘在角色的基础 rate 上；instruction 刻意写短 —— 长指令会让 TTS
# 逐条执行反而生硬（实测慢 27%）。
SCENE_MOOD = {
    # 开场：从容介绍自己，不急
    'opening':  {'rate_mult': 0.95, 'instruction': '从容，随意。'},
    # 轮次开始：报点数，平铺直叙
    'round':    {'rate_mult': 1.0,  'instruction': '平淡，陈述。'},
    # 出牌声明：这句是表演，要显得真诚（哪怕是谎话）
    'play':     {'rate_mult': 1.0,  'instruction': '笃定，像在陈述事实。'},
    # 质疑别人：短促、带攻击性
    'challenge':{'rate_mult': 1.14, 'instruction': '短促，质问。'},
    # 被验证说了真话：松一口气，略带得意
    'truth':    {'rate_mult': 0.95, 'instruction': '松弛，略带得意。'},
    # 撒谎被抓：恼火，有点尴尬
    'lie':      {'rate_mult': 1.08, 'instruction': '懊恼，带情绪。'},
    # 空枪幸存：虚惊一场
    'empty':    {'rate_mult': 0.9,  'instruction': '松一口气，带喘息。'},
    # 中枪：临终
    'bang':     {'rate_mult': 1.0,  'instruction': '虚弱，气声。'},
    # 胜利：收尾
    'win':      {'rate_mult': 0.88, 'instruction': '疲惫，低沉。'},
    # 只剩最后一张：紧张里挑衅
    'lastCard': {'rate_mult': 1.05, 'instruction': '压低声音，挑衅。'},
    # 被逼到墙角：硬撑
    'cornered': {'rate_mult': 1.1,  'instruction': '硬撑，逞强。'},
    # 记仇：阴冷
    'grudge':   {'rate_mult': 0.92, 'instruction': '阴沉，缓慢。'},
    # 目睹别人被枪毙：倒抽一口气
    'witness':  {'rate_mult': 0.95, 'instruction': '压低，克制。'},
    # 催促局势：有点急
    'tension':  {'rate_mult': 1.08, 'instruction': '催促，提高音量。'},
    # 一对一决斗：摊牌
    'duel':     {'rate_mult': 0.9,  'instruction': '严肃，放慢。'},
}

RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']
MAX_ROUNDS = 20

# 旁白台词：固定句 + 变量域（变量句拆成小片段，播放时依次排队）
NARRATOR_FIXED = {
    'truth': '是真的。',
    'lie': '他撒谎了。',
    'bang': '砰！',
    'empty': '空枪。',
    'timeout_challenge': '超时，自动质疑。',
    'timeout_play': '超时，自动出牌。',
    'timeout_skip': '手里没牌了，过。',
    'seat': '坐下吧。牌已经洗好了。',
    'voice_on': '语音已开启。',
    'voice_off': '语音已关闭。',
}
WINNERS = {'fox': '狡狐·维克斯', 'raven': '鸦先生', 'boar': '屠夫·大壮', 'cat': '小猫·米拉', 'someone': '有人'}


def read_key() -> str:
    env = ROOT / '.env.local'
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith('DASHSCOPE_API_KEY='):
                return line.split('=', 1)[1].strip()
    key = os.environ.get('DASHSCOPE_API_KEY')
    if not key:
        sys.exit('缺少 DASHSCOPE_API_KEY（写入 .env.local 或环境变量）')
    return key


def load_lines() -> dict:
    """从 characters.ts 里抠出台词表"""
    import re

    src = (ROOT / 'apps/web/src/data/characters.ts').read_text()
    out = {}
    for m in re.finditer(r"id: '(\w+)',([\s\S]*?)lines: \{([\s\S]*?)\n    \},", src):
        cid, body = m.group(1), m.group(3)
        entry = {}
        for lm in re.finditer(r'(\w+): \[([\s\S]*?)\]', body):
            texts = re.findall(r"'([^']*)'", lm.group(2))
            if texts:
                entry[lm.group(1)] = texts
        out[cid] = entry
    return out


def clean(text: str) -> str:
    import re

    t = re.sub(r'[（(][^）)]{0,12}[）)]', '', text)
    t = t.replace('……', '，').replace('——', '，').replace('，——', '，')
    return t.strip(' ，。') or '嗯'


async def synth(key: str, text: str, cfg: dict) -> bytes:
    """一轮完整合成，返回 PCM"""
    tid = str(uuid.uuid4())
    params = {
        'text_type': 'PlainText',
        'voice': cfg['voice'],
        'format': 'pcm',
        'sample_rate': SAMPLE_RATE,
        'rate': cfg['rate'],
    }
    if cfg.get('instruction'):
        params['instruction'] = cfg['instruction']

    async with websockets.connect(
        URL, extra_headers={'Authorization': f'Bearer {key}'}, max_size=None
    ) as ws:
        await ws.send(json.dumps({
            'header': {'action': 'run-task', 'task_id': tid, 'streaming': 'duplex'},
            'payload': {
                'task_group': 'audio', 'task': 'tts', 'function': 'SpeechSynthesizer',
                'model': MODEL, 'parameters': params, 'input': {},
            },
        }))

        audio = bytearray()
        started = False
        while True:
            msg = await asyncio.wait_for(ws.recv(), timeout=40)
            if isinstance(msg, bytes):
                audio.extend(msg)
                continue
            ev = json.loads(msg)
            name = ev.get('header', {}).get('event')
            if name == 'task-failed':
                raise RuntimeError(ev.get('header', {}).get('error_message', 'task failed'))
            if name == 'task-started' and not started:
                started = True
                await ws.send(json.dumps({
                    'header': {'action': 'continue-task', 'task_id': tid, 'streaming': 'duplex'},
                    'payload': {'input': {'text': text}},
                }))
                await ws.send(json.dumps({
                    'header': {'action': 'finish-task', 'task_id': tid, 'streaming': 'duplex'},
                    'payload': {'input': {}},
                }))
            if name == 'task-finished':
                break
        return bytes(audio)


def pcm_to_mp3(pcm: bytes, dst: pathlib.Path) -> None:
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
        tmp = f.name
        with wave.open(tmp, 'wb') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SAMPLE_RATE)
            w.writeframes(pcm)
    subprocess.run(
        ['ffmpeg', '-y', '-loglevel', 'error', '-i', tmp, '-ac', '1', '-ar', '22050',
         '-b:a', '48k', str(dst)],
        check=True, capture_output=True,
    )
    pathlib.Path(tmp).unlink(missing_ok=True)


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--force', action='store_true', help='无视缓存全部重录')
    ap.add_argument('--only', default='', help='只做这些角色，逗号分隔')
    ap.add_argument('--scene', help='只生成指定场景，例如 signature')
    args = ap.parse_args()

    key = read_key()
    lines = load_lines()
    only = {s.strip() for s in args.only.split(',') if s.strip()}

    OUT.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}

    jobs = []

    # ── 旁白 ──
    if not only or 'narrator' in only:
        for node, text in NARRATOR_FIXED.items():
            jobs.append(('narrator', node, 0, None, text))
        for n in range(1, MAX_ROUNDS + 1):
            jobs.append(('narrator', 'round', n, None, f'第 {n} 轮。'))
        for r in RANKS:
            jobs.append(('narrator', 'rank', 0, r, f'点数 {r}。'))
        for wid, wname in WINNERS.items():
            jobs.append(('narrator', 'win', 0, wid, f'{wname}，是最后一个活着的人。'))

    for cid, entry in lines.items():
        if only and cid not in only:
            continue
        for node, texts in entry.items():
            for i, t in enumerate(texts):
                if '{rank}' in t:
                    for r in RANKS:
                        jobs.append((cid, node, i, r, t.replace('{rank}', r)))
                else:
                    jobs.append((cid, node, i, None, t))

    # 单独录制新招牌台词时，避免触发其他场景录音。
    if args.scene:
        jobs = [job for job in jobs if job[1] == args.scene]
    total = len(jobs)
    made = skipped = failed = 0
    t0 = time.time()

    for n, (cid, node, i, rank, text) in enumerate(jobs, 1):
        name = f'{cid}_{node}_{i}' + (f'_{rank}' if rank else '')
        dst = OUT / f'{name}.mp3'

        if dst.exists() and not args.force and name in manifest:
            skipped += 1
            continue

        cfg = dict(VOICE_MAP.get(cid, VOICE_MAP['narrator']))
        # 旁白按场景换语气：narrator_lie_fox → 场景 lie
        if cid == 'narrator':
            parts = name.split('_')
            scene = parts[1] if len(parts) > 1 else ''
            if scene in NARRATOR_SCENES:
                cfg.update(NARRATOR_SCENES[scene])
        elif node in SCENE_MOOD:
            # 角色台词也按场景变语气：同一角色在「质疑」和「中枪」时该是两种声音
            mood = SCENE_MOOD[node]
            cfg['rate'] = round(cfg['rate'] * mood['rate_mult'], 3)
            cfg['instruction'] = mood['instruction']
        pcm = None
        for attempt in range(3):
            try:
                pcm = await synth(key, clean(text), cfg)
                if len(pcm) < 2000:
                    raise RuntimeError(f'音频过短 {len(pcm)}B')
                break
            except Exception as e:
                msg = str(e)
                if attempt == 2:
                    failed += 1
                    print(f'[{n}/{total}] {name}  失败: {msg[:100]}')
                    break
                # 401/限流一律退避重试
                wait = 3.0 * (attempt + 1) if '401' in msg else 1.0
                print(f'[{n}/{total}] {name}  重试 {attempt+1}（{msg[:40]}）等 {wait:.0f}s')
                await asyncio.sleep(wait)
        if pcm is None:
            continue
        try:
            pcm_to_mp3(pcm, dst)
            manifest[name] = {
                'voice': cfg['voice'], 'rate': cfg['rate'],
                'instruction': cfg.get('instruction', ''),
                'chars': len(text), 'bytes': dst.stat().st_size,
                'at': time.strftime('%Y-%m-%d %H:%M:%S'),
            }
            made += 1
            print(f'[{n}/{total}] {name}  {dst.stat().st_size//1024}KB  ({len(pcm)/2/SAMPLE_RATE:.1f}s)')
        except Exception as e:
            failed += 1
            print(f'[{n}/{total}] {name}  转码失败: {str(e)[:100]}')
            continue

        # 限速，别把接口打爆
        await asyncio.sleep(0.35)

    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
    print(f'\n完成: 新录 {made} · 命中缓存 {skipped} · 失败 {failed} · 用时 {time.time()-t0:.0f}s')


if __name__ == '__main__':
    asyncio.run(main())
