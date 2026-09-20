# -*- coding: utf-8 -*-
"""
把 rip.py 聚出来的类整理成游戏真正用的素材，并反推出每种颜色的配色表。
原版只有 5 种普通方块，这里额外用色相旋转补两种备用色，
以便配置里把颜色数调到 6~7 时引擎仍然有图可用。
"""
import os, colorsys, json, warnings
warnings.filterwarnings("ignore")
from PIL import Image, ImageFilter

SRC = "/home/user/duidui/assets/art/original"
OUT = "/home/user/duidui/assets/blocks"
os.makedirs(OUT, exist_ok=True)

# rip.py 的输出顺序：0紫 1蓝 2橙 3粉 4绿，5 是绿色小人（魔术方块）
PICK = [
    ("purple", "raw-block-0.png", "紫"),
    ("blue",   "raw-block-1.png", "蓝"),
    ("orange", "raw-block-2.png", "橙"),
    ("pink",   "raw-block-3.png", "粉"),
    ("green",  "raw-block-4.png", "绿"),
]
MAGIC = "raw-block-5.png"

def upscale(img, k=4):
    big = img.resize((img.width*k, img.height*k), Image.LANCZOS)
    return big.filter(ImageFilter.UnsharpMask(radius=2, percent=65, threshold=2))

def rotate_hue(img, deg):
    out = Image.new("RGB", img.size)
    px = []
    for r, g, b in img.getdata():
        h, s, v = colorsys.rgb_to_hsv(r/255, g/255, b/255)
        h = (h + deg/360.0) % 1.0
        rr, gg, bb = colorsys.hsv_to_rgb(h, s, v)
        px.append((int(rr*255), int(gg*255), int(bb*255)))
    out.putdata(px)
    return out

def palette(img):
    """从素材里反推 main / light / dark / glow，让 UI 配色和方块完全一致"""
    px = [p for p in img.getdata()]
    lit = sorted([p for p in px if max(p) > 60], key=lambda p: -(p[0]+p[1]+p[2]))
    if not lit: lit = px
    n = len(lit)
    def avg(sub):
        return (sum(p[0] for p in sub)//len(sub), sum(p[1] for p in sub)//len(sub), sum(p[2] for p in sub)//len(sub))
    light = avg(lit[:max(1, n//12)])
    main  = avg(lit[n//3: n//3 + max(1, n//6)])
    dark  = avg(lit[-max(1, n//8):])
    hexf = lambda c: '#%02x%02x%02x' % c
    # glow：把 main 提亮提艳，用于选中发光与粒子
    h, s, v = colorsys.rgb_to_hsv(*[c/255 for c in main])
    gr, gg, gb = colorsys.hsv_to_rgb(h, min(1, s*1.15), min(1, v*1.25))
    return {
        'main': hexf(main), 'light': hexf(light), 'dark': hexf(dark),
        'glow': hexf((int(gr*255), int(gg*255), int(bb) if False else int(gb*255)))
    }

entries = []
for i, (key, fn, cn) in enumerate(PICK):
    raw = Image.open(os.path.join(SRC, fn)).convert("RGB")
    upscale(raw).save(f"{OUT}/{i}.png")
    p = palette(raw)
    p.update(key=key, name=cn)
    entries.append(p)
    print(f"  {i}.png  {cn}  main={p['main']}  light={p['light']}  dark={p['dark']}")

# 备用色：由橙旋转出朱红、由绿旋转出青
base_orange = Image.open(os.path.join(SRC, "raw-block-2.png")).convert("RGB")
base_green  = Image.open(os.path.join(SRC, "raw-block-4.png")).convert("RGB")
for i, (key, cn, base, deg) in enumerate([
    ("red",  "红", base_orange, -32),
    ("cyan", "青", base_green,   82),
], start=len(PICK)):
    img = rotate_hue(base, deg)
    upscale(img).save(f"{OUT}/{i}.png")
    p = palette(img); p.update(key=key, name=cn)
    entries.append(p)
    print(f"  {i}.png  {cn}（由原版素材旋转色相 {deg}° 生成）  main={p['main']}")

# 魔术方块与空格底纹
upscale(Image.open(os.path.join(SRC, MAGIC)).convert("RGB")).save(f"{OUT}/magic.png")
upscale(Image.open(os.path.join(SRC, "raw-empty.png")).convert("RGB")).save(f"{OUT}/empty.png")
print("  magic.png / empty.png 已输出")

with open(f"{OUT}/palette.json", "w", encoding="utf-8") as f:
    json.dump(entries, f, ensure_ascii=False, indent=2)
print("\n配色表：")
print(json.dumps(entries, ensure_ascii=False))
