# -*- coding: utf-8 -*-
"""
把原版整块界面做成游戏底板
------------------------------------------------------------------
· 棋盘区域铺上抠出来的空格底纹（方块由 canvas 画在上面）
· 所有会变的数字（得分、目标、等级、计数、道具数量、任务）用
  左右插值擦掉，露出干净的面板，数值由 HTML 叠在原位置上
"""
import os, warnings
warnings.filterwarnings("ignore")
from PIL import Image

SRC = "/home/user/duidui/assets/art/original"
OUT = "/home/user/duidui/assets/stage"
os.makedirs(OUT, exist_ok=True)

stage = Image.open(f"{SRC}/stage-full.png").convert("RGB")
W, H = stage.size
print(f"底板 {W}×{H}")

# ── 1. 棋盘区铺空格底纹
BOARD = (7, 130, 400, 400)          # x, y, w, h
CELL = 40
empty = Image.open(f"{SRC}/raw-empty.png").convert("RGB")
bx, by, bw, bh = BOARD
for r in range(bh // CELL):
    for c in range(bw // CELL):
        stage.paste(empty, (bx + c * CELL, by + r * CELL))
print("棋盘区已铺空格底纹")

def col_stretch(box, src_x):
    """
    用一列干净像素横向铺满目标区域。
    比左右插值好：每一行保留自己的颜色，面板的纵向渐变和上下描边都不会被拉花。
    """
    x0, y0, x1, y1 = box
    px = stage.load()
    for y in range(y0, y1):
        c = px[src_x, y]
        for x in range(x0, x1):
            px[x, y] = c

def copy_patch(box, src_xy):
    """从别处整块搬一片干净的背景过来"""
    x0, y0, x1, y1 = box
    patch = stage.crop((src_xy[0], src_xy[1], src_xy[0] + (x1 - x0), src_xy[1] + (y1 - y0)))
    stage.paste(patch, (x0, y0))

def row_stretch(box, src_y):
    """用某一行干净的像素纵向铺满目标区域，保留横向的色彩变化"""
    px = stage.load()
    x0, y0, x1, y1 = box
    for x in range(x0, x1):
        c = px[x, src_y]
        for y in range(y0, y1):
            px[x, y] = c

def fill_rect(box, src_xy):
    """用某一点的颜色平铺一块区域"""
    px = stage.load()
    c = px[src_xy[0], src_xy[1]]
    x0, y0, x1, y1 = box
    for y in range(y0, y1):
        for x in range(x0, x1):
            px[x, y] = c

# ── 2. 擦掉所有会变的数字（坐标由带网格的放大图量出）
#     每一项都指定一列「这一行上干净的像素」，横向铺过去
ERASE = [
    ("目前得分的数字",     (460, 130, 648, 180), 452),
    ("过关目标分数的数字", (460, 210, 648, 260), 452),
    ("等级数字",           (542, 20,  656, 100), 662),
    ("任务奖励分",         (452, 460, 640, 512), 448),
    ("计数条的五组数字",   (26,  86,  412, 120), 22),
    ("删除道具的数量",     (476, 338, 502, 368), 472),
    ("变换道具的数量",     (561, 338, 587, 368), 557),
    ("任务图标与数量",     (412, 422, 606, 460), 610),
]
for name, box, src_x in ERASE:
    col_stretch(box, src_x)
    print(f"  已擦除：{name} {box}")

# B 站的水印压在标题铭牌左上角。铭牌内部是横向延展的深绿底 + 上边框，
# 所以从铭牌内一列干净像素横向铺过去，边框刚好能接上；
# 铭牌之外那一小截单独用背景色铺掉。
# 水印横跨 x 10~80，这个 x 区间里找不到干净的取样列，所以分两段处理：
#   上半是铭牌的横向上边框 —— 从 logo 上方一段干净的位置横向取样接上；
#   下半是铭牌内部的深绿底 —— 直接用内部色平铺（顶多少一颗星星，看不出来）。
col_stretch((18, 22, 92, 36), 150)      # 铭牌上边框
fill_rect((18, 36, 92, 68), (150, 78))  # 铭牌内部
row_stretch((0, 16, 18, 74), 13)        # 铭牌左侧：用上方一行干净像素纵向铺下来
print("  已盖掉：录屏平台水印")
stage.save(f"{OUT}/stage-bg.png")
print(f"\n底板已输出 → assets/stage/stage-bg.png")

# ── 3. 道具那两个角色图标单独抠出来（原版自带，比自绘的更贴）
stage_raw = Image.open(f"{SRC}/stage-full.png").convert("RGB")
stage_raw.crop((475, 276, 548, 344)).resize((146, 136), Image.LANCZOS).save(f"{OUT}/tool-delete.png")
stage_raw.crop((560, 276, 633, 344)).resize((146, 136), Image.LANCZOS).save(f"{OUT}/tool-transform.png")
print("道具图标已抠出：tool-delete.png / tool-transform.png")
