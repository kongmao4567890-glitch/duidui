# -*- coding: utf-8 -*-
"""
从原版录屏里提取方块素材
------------------------------------------------------------------
思路：
  1. 把棋盘每一格切成 40×40 小图
  2. 先用 8×8 指纹做「细聚类」，得到很多小簇
  3. 每个小簇取中位图（干净、无压缩噪点），再拿中位图两两归并成大类
     —— 直接拿带噪点的单帧去聚类会分不开相近的颜色，先去噪再归并就稳了
  4. 每个大类再做一次中位数叠加，放大并轻锐化输出
"""
import os, colorsys, warnings
warnings.filterwarnings("ignore")
import av
from PIL import Image, ImageFilter

SRC = "/root/.claude/uploads/88f2173c-36c4-5410-bedd-01da5e976d0d/917ef787-Screenrecorder-2026-09-20-07-39-53-567.mp4"
OUT = "/home/user/duidui/assets/art/original"
os.makedirs(OUT, exist_ok=True)

X0, Y0, CELL, COLS, ROWS = 327, 220, 40, 10, 10
LEFT, TOP = X0 - CELL // 2, Y0 - CELL // 2

frames = [f.to_image().convert("RGB") for f in av.open(SRC).decode(video=0)]
print(f"解码 {len(frames)} 帧")

def box(c, r): return (LEFT + c*CELL, TOP + r*CELL, LEFT + (c+1)*CELL, TOP + (r+1)*CELL)
def fp(img, n=8): return list(img.resize((n, n), Image.BILINEAR).getdata())
def d2(a, b): return sum((p[0]-q[0])**2+(p[1]-q[1])**2+(p[2]-q[2])**2 for p, q in zip(a, b))/len(a)
def is_empty(img):
    px = list(img.resize((4, 4), Image.BILINEAR).getdata())
    return sum(max(p) for p in px)/len(px) < 86

def median(imgs, limit=500):
    imgs = imgs[:limit]
    datas = [list(i.getdata()) for i in imgs]
    mid = len(datas)//2
    w, h = imgs[0].size
    out = Image.new("RGB", (w, h))
    out.putdata([(sorted(d[i][0] for d in datas)[mid],
                  sorted(d[i][1] for d in datas)[mid],
                  sorted(d[i][2] for d in datas)[mid]) for i in range(w*h)])
    return out

def hue_of(img):
    px = [p for p in img.resize((10, 10), Image.BILINEAR).getdata() if max(p) > 80]
    if not px: return 0
    r = sum(p[0] for p in px)/len(px); g = sum(p[1] for p in px)/len(px); b = sum(p[2] for p in px)/len(px)
    return colorsys.rgb_to_hsv(r/255, g/255, b/255)[0]*360

# ── 采样
samples, empties = [], []
for im in frames:
    for r in range(ROWS):
        for c in range(COLS):
            crop = im.crop(box(c, r))
            (empties if is_empty(crop) else samples).append(crop)
print(f"方块样本 {len(samples)}，空格样本 {len(empties)}")

# ── 细聚类
fine = []
for img in samples:
    f = fp(img)
    hit = None
    for cl in fine:
        if d2(f, cl['fp']) < 700: hit = cl; break
    if hit: hit['imgs'].append(img)
    else:   fine.append({'fp': f, 'imgs': [img]})
fine = [c for c in fine if len(c['imgs']) >= 20]
for cl in fine:
    cl['med'] = median(cl['imgs'], 200)
    cl['mfp'] = fp(cl['med'], 12)
print(f"细聚类 {len(fine)} 簇")

# ── 用干净的中位图归并
groups = []
for cl in sorted(fine, key=lambda c: -len(c['imgs'])):
    hit = None
    for g in groups:
        if d2(cl['mfp'], g['mfp']) < 2600: hit = g; break
    if hit:
        hit['imgs'].extend(cl['imgs'])
    else:
        groups.append({'mfp': cl['mfp'], 'imgs': list(cl['imgs']), 'med': cl['med']})
groups.sort(key=lambda g: -len(g['imgs']))
print(f"归并成 {len(groups)} 类：" + "  ".join(f"{round(hue_of(g['med']))}°/{len(g['imgs'])}" for g in groups))

def upscale(img, k=6):
    big = img.resize((img.width*k, img.height*k), Image.LANCZOS)
    return big.filter(ImageFilter.UnsharpMask(radius=3, percent=72, threshold=2))

for i, g in enumerate(groups[:10]):
    med = median(g['imgs'])
    med.save(f"{OUT}/raw-block-{i}.png")
    upscale(med).save(f"{OUT}/block-{i}.png")
    print(f"  block-{i}.png  色相{round(hue_of(med)):>3}°  {len(g['imgs'])} 个样本")

med = median(empties)
med.save(f"{OUT}/raw-empty.png"); upscale(med).save(f"{OUT}/empty.png")
frames[2].crop((300, 70, 980, 650)).save(f"{OUT}/stage-full.png")
frames[2].crop((715, 90, 980, 600)).save(f"{OUT}/panel.png")
frames[2].crop((305, 95, 730, 195)).save(f"{OUT}/logo-plate.png")
# 计数条上的 5 个类型图标（原版顶部那条）
frames[2].crop((333, 160, 610, 186)).resize((277*3, 26*3), Image.LANCZOS).save(f"{OUT}/counter-icons.png")
print("空格底纹、背景、面板、计数条图标已导出")
