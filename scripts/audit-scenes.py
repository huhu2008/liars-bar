#!/usr/bin/env python3
"""检查同一角色在不同场景下的语气区分度。

判定：每个场景的「字/秒」应该分布在不同档位，
否则说明场景情绪没有生效（所有场景一个调）。
"""
import json, pathlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
VO = ROOT / 'apps/web/public/vo-qwen'
MAN = VO / 'manifest.json'

# 每个场景取一条代表台词及其字数
SAMPLES = {
    'opening':   ('opening_0', 13),
    'round':     ('round_0', 13),
    'challenge': ('challenge_0', 3),
    'lie':       ('lie_0', 9),
    'grudge':    ('grudge_0', 10),
    'duel':      ('duel_0', 12),
    'tension':   ('tension_0', 12),
}

def dur(p):
    r = subprocess.run(['ffprobe','-v','quiet','-show_entries','format=duration','-of','csv=p=0',str(p)],
                       capture_output=True, text=True)
    try: return float(r.stdout.strip())
    except ValueError: return None

man = json.loads(MAN.read_text()) if MAN.exists() else {}
rows = []
for cid in ['fox','raven','boar','cat','mage','rogue']:
    rates = {}
    for scene, (suffix, chars) in SAMPLES.items():
        p = VO / f'{cid}_{suffix}.mp3'
        d = dur(p)
        if d: rates[scene] = round(chars / d, 1)
    if not rates: continue
    vals = list(rates.values())
    spread = max(vals) - min(vals)
    rows.append((cid, rates, spread))

print('=== 各角色场景语速（字/秒）===')
ok = True
for cid, rates, spread in rows:
    line = '  '.join(f'{k}:{v}' for k, v in rates.items())
    mark = '✅' if spread >= 1.5 else '❌ 区分度不足'
    if spread < 1.5: ok = False
    print(f'{cid:6} {line}')
    print(f'       跨度 {spread:.1f} 字/秒  {mark}')

print(f'\n{"全部通过" if ok else "有角色场景区分度不足"}')
sys.exit(0 if ok else 1)
