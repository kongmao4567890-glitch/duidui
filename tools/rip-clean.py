# -*- coding: utf-8 -*-
"""
从无水印原版截图里提取高清方块贴图
------------------------------------------------------------------
这张截图的方块是 77px，比录屏的 40px 清晰近一倍。
虽然只有一帧，但同一种方块在棋盘上有二十来个实例，
对它们做中位数叠加同样能压掉 JPEG 噪点。

做法：切出 100 个格子 → 指纹细聚类 → 用去噪后的中位图归并成大类
      → 每类再叠一次 → 放大锐化输出。
"""
import os, colorsys, warnings
warnings.filterwarnings("ignore")
from PIL import Image, ImageFilter

SRC = "/home/user/duidui/assets/art/original/clean-stage.png"
OUT = "/home/user/duidui/assets/art/original"
BOARD_X, BOARD_Y, CELL, COLS, ROWS = 10, 231, 77.4, 10, 10

im = Image.open(SRC).convert("RGB")
cells = []
for r in range(ROWS):
    for c in range(COLS):
        x0 = BOARD_X + int(round(c * CELL)); y0 = BOARD_Y + int(round(r * CELL))
        cells.append(im.crop((x0, y0, x0 + int(round(CELL)), y0 + int(round(CELL)))))
print(f"切出 {len(cells)} 个格子，每个 {cells[0].size[0]}×{cells[0].size[1]}")

def fp(img, n=8): return list(img.resize((n, n), Image.BILINEAR).getdata())
def d2(a, b): return sum((p[0]-q[0])**2+(p[1]-q[1])**2+(p[2]-q[2])**2 for p, q in zip(a, b))/len(a)

def median(imgs):
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

# 细聚类
fine = []
for img in cells:
    f = fp(img); hit = None
    for cl in fine:
        if d2(f, cl['fp']) < 900: hit = cl; break
    if hit: hit['imgs'].append(img)
    else:   fine.append({'fp': f, 'imgs': [img]})
for cl in fine:
    cl['med'] = median(cl['imgs']) if len(cl['imgs']) > 2 else cl['imgs'][0]
    cl['mfp'] = fp(cl['med'], 12)

# 用干净的中位图归并
groups = []
for cl in sorted(fine, key=lambda c: -len(c['imgs'])):
    hit = None
    for g in groups:
        if d2(cl['mfp'], g['mfp']) < 2600: hit = g; break
    if hit: hit['imgs'].extend(cl['imgs'])
    else:   groups.append({'mfp': cl['mfp'], 'imgs': list(cl['imgs']), 'med': cl['med']})
groups.sort(key=lambda g: -len(g['imgs']))
print("归并成 " + str(len(groups)) + " 类：" +
      "  ".join(f"{round(hue_of(g['med']))}°/{len(g['imgs'])}个" for g in groups))

def upscale(img, k=2):
    big = img.resize((img.width*k, img.height*k), Image.LANCZOS)
    return big.filter(ImageFilter.UnsharpMask(radius=2, percent=55, threshold=3))

for i, g in enumerate(groups[:14]):
    med = median(g['imgs'])
    med.save(f"{OUT}/hd-block-{i}.png")
    print(f"  hd-block-{i}.png  色相{round(hue_of(med)):>3}°  {len(g['imgs'])} 个样本")
