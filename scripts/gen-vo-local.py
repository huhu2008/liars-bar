#!/usr/bin/env python3
"""
用 macOS 内置语音生成配音（Qwen API 故障时的备选）。

    python3 scripts/gen-vo-local.py --only mage,rogue [--force]

音色来自 `say -v ?`，只挑贴合角色的：
  mage  → Grandpa（老年男声）
  rogue → Flo（成熟女声）
产物和 Qwen 版同名同路径，游戏代码不用改。
"""
import argparse, json, pathlib, re, subprocess, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'apps/web/public/vo-qwen'
MANIFEST = OUT / 'manifest.json'

# 角色 → say 音色 / 语速
VOICE_MAP = {
    'mage':  {'voice': 'Grandpa (中文（中国大陆）)', 'rate': 155},
    'rogue': {'voice': 'Flo (中文（中国大陆）)',     'rate': 175},
}

RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A']


def load_lines() -> dict:
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
    t = re.sub(r'[（(][^）)]{0,12}[）)]', '', text)
    t = t.replace('……', '，').replace('——', '，').replace('，——', '，')
    return t.strip(' ，。') or '嗯'


def synth(voice: str, rate: int, text: str, dst: pathlib.Path) -> bool:
    with tempfile.NamedTemporaryFile(suffix='.aiff', delete=False) as tf:
        aiff = tf.name
    try:
        subprocess.run(['say', '-v', voice, '-r', str(rate), '-o', aiff, text],
                       check=True, capture_output=True)
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', aiff,
                        '-codec:a', 'libmp3lame', '-b:a', '96k', str(dst)],
                       check=True, capture_output=True)
        return dst.exists() and dst.stat().st_size > 2000
    except Exception as e:
        print('  失败:', e)
        return False
    finally:
        pathlib.Path(aiff).unlink(missing_ok=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    ap.add_argument('--force', action='store_true')
    args = ap.parse_args()

    lines = load_lines()
    only = {s.strip() for s in args.only.split(',') if s.strip()}
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}

    jobs = []
    for cid, entry in lines.items():
        if only and cid not in only:
            continue
        if cid not in VOICE_MAP:
            continue
        for node, texts in entry.items():
            for i, t in enumerate(texts):
                if '{rank}' in t:
                    for r in RANKS:
                        jobs.append((cid, node, i, r, t.replace('{rank}', r)))
                else:
                    jobs.append((cid, node, i, None, t))

    made = skipped = failed = 0
    for n, (cid, node, i, rank, text) in enumerate(jobs, 1):
        name = f'{cid}_{node}_{i}' + (f'_{rank}' if rank else '')
        dst = OUT / f'{name}.mp3'
        if dst.exists() and not args.force:
            skipped += 1
            continue
        cfg = VOICE_MAP[cid]
        ok = synth(cfg['voice'], cfg['rate'], clean(text), dst)
        if ok:
            manifest[name] = {'voice': cfg['voice'], 'rate': cfg['rate'],
                              'bytes': dst.stat().st_size, 'engine': 'macos-say'}
            made += 1
            print(f'[{n}/{len(jobs)}] {name}')
        else:
            failed += 1

    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
    print(f'\n完成: 新录 {made} · 跳过 {skipped} · 失败 {failed}')


if __name__ == '__main__':
    main()
