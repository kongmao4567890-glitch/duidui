# -*- coding: utf-8 -*-
"""
用干净的原版截图做舞台底板
------------------------------------------------------------------
素材来源是一张不带任何水印的原版画面（1318×1079，比录屏清晰一倍），
所以不需要任何修补，只要：
  · 把棋盘区铺上空格底纹（方块由 canvas 画在上面）
  · 把会变的数字与图标擦掉，数值由 HTML 叠在原坐标上

所有坐标都在这张底图的原生像素系里，舞台不缩放地照搬，
再由前端整体等比缩放，所以能做到逐像素对位。
"""
import os, warnings
warnings.filterwarnings("ignore")
from PIL import Image

SRC = "/home/user/duidui/assets/art/original"
OUT = "/home/user/duidui/assets/stage"
os.makedirs(OUT, exist_ok=True)

stage = Image.open(f"{SRC}/clean-stage.png").convert("RGB")
W, H = stage.size
print(f"底板 {W}×{H}")

# ── 棋盘几何
# 沿棋盘中线扫描亮块之间的暗缝，取缝心做最小二乘，得到格距 ≈77.4px、
# 左上角 (10,231)。注意首尾两条「缝」其实是棋盘边框，不能当内部缝用，
# 否则会把格距算小 1%。
BOARD_X, BOARD_Y, CELL, COLS, ROWS = 10, 231, 77.4, 10, 10
BOARD_W = int(round(CELL * COLS))
BOARD_H = int(round(CELL * ROWS))
print(f"棋盘区 ({BOARD_X},{BOARD_Y}) {BOARD_W}×{BOARD_H}，格距 {CELL}")

# 空格底纹取自录屏（干净截图里棋盘是满的，看不到空格），放大到本图的格距
empty = Image.open(f"{SRC}/raw-empty.png").convert("RGB").resize(
    (int(round(CELL)) + 2, int(round(CELL)) + 2), Image.LANCZOS)
for r in range(ROWS):
    for c in range(COLS):
        stage.paste(empty, (BOARD_X + int(round(c * CELL)), BOARD_Y + int(round(r * CELL))))
print("棋盘区已铺空格底纹")

px = stage.load()

def col_stretch(box, src_x):
    """用一列干净像素横向铺满目标区域，保留纵向渐变与上下描边"""
    x0, y0, x1, y1 = box
    for y in range(y0, y1):
        c = px[src_x, y]
        for x in range(x0, x1):
            px[x, y] = c

# ── 擦掉所有会变的数字与图标
ERASE = [
    ("等级数字",        (1050, 24, 1250, 180), 1262),
    ("目前得分的数字",  (866, 246, 1212, 330),  860),
    ("过关目标的数字",  (866, 398, 1212, 482),  860),
    ("计数条",          (60, 156, 590, 220),     52),
    ("删除道具的数量",  (920, 646, 962, 688),   915),
    ("变换道具的数量",  (1086, 646, 1128, 688), 1081),
    ("任务图标与数量",  (795, 790, 1215, 870),  790),
    ("任务奖励分",      (900, 878, 1212, 962),  894),
]
for name, box, src_x in ERASE:
    col_stretch(box, src_x)
    print(f"  已擦除：{name} {box}")

stage.save(f"{OUT}/stage-bg.png")
sz = os.path.getsize(f"{OUT}/stage-bg.png") / 1024
print(f"\n底板已输出 → assets/stage/stage-bg.png（{sz:.0f} KB）")

# 体积太大就再存一份 JPEG（底板不需要透明）
if sz > 400:
    stage.save(f"{OUT}/stage-bg.jpg", quality=88, optimize=True)
    print(f"  另存 JPEG：{os.path.getsize(f'{OUT}/stage-bg.jpg')/1024:.0f} KB")

# ── 道具图标单独抠出来（原版自带，比自绘的贴）
raw = Image.open(f"{SRC}/clean-stage.png").convert("RGB")
raw.crop((912, 500, 1054, 642)).save(f"{OUT}/tool-delete.png")
raw.crop((1088, 500, 1210, 642)).save(f"{OUT}/tool-transform.png")
print("道具图标已抠出")
