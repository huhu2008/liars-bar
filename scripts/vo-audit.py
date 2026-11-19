import re, json, pathlib

SRC = pathlib.Path('apps/web/src/data')
VO = pathlib.Path('apps/web/public/vo-qwen')

# ---- 解析 characters.ts ----
txt = (SRC/'characters.ts').read_text()
RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K']

# 找每个角色的 id 和 lines 块
chars = []
for m in re.finditer(r"id:\s*'(\w+)'", txt):
    cid = m.group(1)
    # 该 id 之后最近的 lines: { ... }
    seg = txt[m.end(): m.end()+4000]
    lm = re.search(r"lines:\s*\{(.*?)\n    \},", seg, re.S)
    if not lm: continue
    body = lm.group(1)
    nodes = {}
    for nm in re.finditer(r"(\w+):\s*\[(.*?)\]", body, re.S):
        node, arr = nm.group(1), nm.group(2)
        lines = re.findall(r"'([^']*)'", arr)
        if lines: nodes[node] = lines
    chars.append((cid, nodes))

# ---- 解析 narrator.ts ----
ntxt = (SRC/'narrator.ts').read_text()
narr = {}
for nm in re.finditer(r"(\w+):\s*\{\s*text:\s*'([^']*)'", ntxt):
    narr[nm.group(1)] = nm.group(2)

def expected():
    out = []
    for cid, nodes in chars:
        for node, lines in nodes.items():
            for i, line in enumerate(lines):
                if '{rank}' in line:
                    for r in RANKS:
                        out.append(f"{cid}_{node}_{i}_{r}")
                else:
                    out.append(f"{cid}_{node}_{i}")
    # 旁白
    for k in narr:
        out.append(f"narrator_{k}")
    return out

exp = expected()
have = {p.stem for p in VO.glob('*.mp3')}
missing = [e for e in exp if e not in have]
extra = [h for h in have if h not in exp]

print(f'角色数: {len(chars)}')
print(f'代码需要: {len(exp)} 条')
print(f'实际有  : {len(have)} 条')
print(f'缺失    : {len(missing)} 条')
print(f'多余    : {len(extra)} 条')
if missing:
    byc = {}
    for m in missing:
        byc.setdefault(m.split('_')[0] + '_' + m.split('_')[1], []).append(m)
    print('\n缺失分布:')
    for k, v in sorted(byc.items())[:20]:
        print(f'  {k}: {len(v)} 条  例: {v[0]}')
if extra:
    print('\n多余样例:', extra[:5])
