from PIL import Image, ImageDraw
import math

BG    = (20, 23, 29, 255)      # #14171d
DARK  = (11, 13, 16, 255)      # #0b0d10
AMBER = (245, 165, 36, 255)    # #f5a524
AMBER2= (255, 206, 107, 255)   # #ffce6b

S = 512
SS = 4  # supersampling
W = S * SS

def draw_art(d, cx, cy, scale):
    """메트로놈 본체 + 진자. cx,cy 중심, scale 배율 (기준 512 캔버스, SS 적용 전 좌표계)"""
    def P(x, y):
        return (cx + x * scale, cy + y * scale)
    # 본체 (사다리꼴): 폭 상단 150, 하단 300, 높이 300 (중심 기준 -150..150)
    body = [P(-75, -150), P(75, -150), P(150, 150), P(-150, 150)]
    d.polygon(body, fill=AMBER)
    # 중앙 슬롯
    slot = [P(-14, -118), P(14, -118), P(24, 108), P(-24, 108)]
    d.polygon(slot, fill=DARK)
    # 진자 (아래 피벗에서 오른쪽으로 기울어진 막대)
    pivot = P(0, 108)
    ang = math.radians(-72)  # 오른쪽 위로
    L = 205 * scale
    tip = (pivot[0] + L * math.cos(ang), pivot[1] + L * math.sin(ang))
    d.line([pivot, tip], fill=AMBER2, width=int(16 * scale))
    # 추 (막대 위쪽 1/3 지점)
    wx = pivot[0] + L * 0.62 * math.cos(ang)
    wy = pivot[1] + L * 0.62 * math.sin(ang)
    r = 34 * scale
    d.ellipse([wx - r, wy - r, wx + r, wy + r], fill=AMBER2, outline=DARK, width=int(8 * scale))
    # 피벗 점
    pr = 12 * scale
    d.ellipse([pivot[0] - pr, pivot[1] - pr, pivot[0] + pr, pivot[1] + pr], fill=DARK)
    # 받침대
    base = [P(-165, 150), P(165, 150), P(165, 186), P(-165, 186)]
    d.polygon(base, fill=(196, 127, 19, 255))

# ---- icon-512 (any): 둥근 사각 배경 + 아트 ----
img = Image.new('RGBA', (W, W), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle([0, 0, W, W], radius=int(96 * SS), fill=BG)
draw_art(d, W / 2, W / 2 - 18 * SS, SS)
icon512 = img.resize((512, 512), Image.LANCZOS)
icon512.save('./icon-512.png')
icon512.resize((192, 192), Image.LANCZOS).save('./icon-192.png')

# ---- maskable: 풀블리드 배경, 아트는 안전영역(중앙 80%) 안에 ----
img = Image.new('RGBA', (W, W), BG)
d = ImageDraw.Draw(img)
draw_art(d, W / 2, W / 2 - 12 * SS, SS * 0.72)
img.resize((512, 512), Image.LANCZOS).save('./icon-maskable-512.png')

print('icons ok')
