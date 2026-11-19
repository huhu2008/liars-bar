import pathlib, re

ROOT = pathlib.Path('apps/web')
ASSETS = ROOT/'public/assets'
SRC = list((ROOT/'src').rglob('*.ts')) + list((ROOT/'src').rglob('*.tsx')) + [ROOT/'index.html']
CSS = [ROOT/'src/index.css']

# 收集源码里所有 /assets/... 字符串（含模板拼接的前缀）
refs = set()
text = ''
for f in SRC + CSS:
    if f.exists():
        text += f.read_text(errors='ignore')
for m in re.finditer(r"/assets/[A-Za-z0-9_./\-]+", text):
    refs.add(m.group(0))

# 也收集动态前缀（如 `url(/assets/props/${x}.png)` 里的目录）
for m in re.finditer(r"/assets/([a-z0-9]+)/", text):
    refs.add(f"/assets/{m.group(1)}/*")

def used(path):
    rel = '/assets/' + str(path.relative_to(ASSETS))
    if rel in refs:
        return True
    d = '/assets/' + str(path.parent.relative_to(ASSETS)) + '/*'
    # 目录级动态引用（如 props/*）也算用到
    return d in refs

all_files = sorted(p for p in ASSETS.rglob('*') if p.is_file())
unused = [p for p in all_files if not used(p)]

print(f'素材总数: {len(all_files)}')
print(f'未被引用: {len(unused)}')
for p in unused:
    kb = p.stat().st_size // 1024
    print(f'  {str(p.relative_to(ASSETS)):34s} {kb:5d} KB')
