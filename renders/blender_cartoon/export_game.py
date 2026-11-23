# render_game.py가 만든 game/ 폴더(PNG·GLB·meta.json)를 게임으로 옮긴다.
#   PNG → public/assets/<같은 경로>.webp (투명 유지)
#   GLB → public/assets/models/
#   meta.json → src/assets/sprites.json (게임이 import해 쓴다) — 그림마다 불투명한 영역의 상자(bbox)를 더한다
# 실행: python renders/blender_cartoon/export_game.py
import json, os, shutil, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SRC = os.path.join(HERE, 'game')
PUB = os.path.join(ROOT, 'public', 'assets')
META_OUT = os.path.join(ROOT, 'src', 'assets', 'sprites.json')

meta = json.load(open(os.path.join(SRC, 'meta.json'), encoding='utf-8'))
bbox = {}
n = 0
for dp, _, files in os.walk(SRC):
    for f in files:
        src = os.path.join(dp, f)
        rel = os.path.relpath(src, SRC).replace('\\', '/')
        if f.endswith('.png'):
            key = rel[:-4]
            im = Image.open(src).convert('RGBA')
            a = im.getchannel('A').point(lambda v: 255 if v > 24 else 0)
            b = a.getbbox()
            if b:
                W, H = im.size
                bbox[key] = [round(b[0] / W, 4), round(b[1] / H, 4), round(b[2] / W, 4), round(b[3] / H, 4)]
            out = os.path.join(PUB, key + '.webp')
            os.makedirs(os.path.dirname(out), exist_ok=True)
            im.save(out, 'WEBP', quality=84, method=6, alpha_quality=90)
            n += 1
        elif f.endswith('.glb'):
            out = os.path.join(PUB, rel)
            os.makedirs(os.path.dirname(out), exist_ok=True)
            shutil.copyfile(src, out)
            n += 1
meta['bbox'] = bbox
os.makedirs(os.path.dirname(META_OUT), exist_ok=True)
json.dump(meta, open(META_OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
total = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(PUB) for f in fs)
print(f'{n} files → public/assets ({total / 1e6:.1f} MB), meta → src/assets/sprites.json')
