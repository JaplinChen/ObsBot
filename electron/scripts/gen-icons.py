#!/usr/bin/env python3
"""
ObsBot 圖示產生器
產生 tray 圖示（32×32）、App 圖示（128/256/512）、.icns、.ico

用法: python3 electron/scripts/gen-icons.py
"""
import struct, zlib, math, sys
from pathlib import Path

# Windows 預設 cp1252，強制 UTF-8 輸出
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ASSETS = Path(__file__).parent.parent / 'assets'
ASSETS.mkdir(exist_ok=True)

# ── 顏色 ─────────────────────────────────────────────────────────────────
PURPLE = (124, 106, 255)  # #7C6AFF — 主色 / 運行中
GREY   = (100, 100, 110)  # #64646E — 已停止
RED    = (239,  68,  68)  # #EF4444 — 錯誤

# ── PNG 底層 ──────────────────────────────────────────────────────────────
def _chunk(t: bytes, d: bytes) -> bytes:
    return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)

def make_png(w: int, h: int, get_rgba) -> bytes:
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        for x in range(w):
            raw += bytes([max(0, min(255, int(v))) for v in get_rgba(x, y)])
    return (b'\x89PNG\r\n\x1a\n'
            + _chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + _chunk(b'IDAT', zlib.compress(bytes(raw), 9))
            + _chunk(b'IEND', b''))

# ── SDF 繪圖 ──────────────────────────────────────────────────────────────
def d_circle(x, y, cx, cy, r):
    return math.sqrt((x - cx) ** 2 + (y - cy) ** 2) - r

def d_rrect(x, y, cx, cy, hw, hh, cr):
    qx = abs(x - cx) - hw + cr
    qy = abs(y - cy) - hh + cr
    return math.sqrt(max(qx, 0) ** 2 + max(qy, 0) ** 2) + min(max(qx, qy), 0) - cr

def aa(d, w=0.75):
    return max(0.0, min(1.0, 0.5 - d / w))

def over(bg, fr, fg, fb, fa):
    """Porter-Duff over。bg=(r,g,b,a) 0-255；fg=float 0-1。"""
    br, bg_, bb, ba = bg[0]/255, bg[1]/255, bg[2]/255, bg[3]/255
    oa = fa + ba * (1 - fa)
    if oa < 1e-4: return (0, 0, 0, 0)
    return (
        int((fr*fa + br*ba*(1-fa))/oa * 255),
        int((fg*fa + bg_*ba*(1-fa))/oa * 255),
        int((fb*fa + bb*ba*(1-fa))/oa * 255),
        int(oa * 255),
    )

# ── 機器人渲染 ────────────────────────────────────────────────────────────
def render_robot(size: int, color: tuple) -> bytes:
    """
    以 32px 為基準設計，等比縮放至任意尺寸。

    32px 設計（正 y 向下，原點在中心）：
      頭部   圓角矩形  center=(0, 1)  hw=9.5  hh=8.5  cr=2.5
      左眼   圓形      center=(-4,-1) r=2
      右眼   圓形      center=(+4,-1) r=2
      嘴巴   圓角矩形  center=(0, 5.5) hw=4  hh=1  cr=1
      天線柱 圓角矩形  center=(0,-11) hw=1  hh=2  cr=1
      天線頂 圓形      center=(0,-14) r=1.5
    """
    w = h = size
    s = size / 32.0
    cr, cg, cb = color[0]/255, color[1]/255, color[2]/255

    def px(x, y):
        fx = x - w/2 + 0.5
        fy = y - h/2 + 0.5
        p = (0, 0, 0, 0)

        # 頭部
        d = d_rrect(fx, fy, 0, 1.0*s, 9.5*s, 8.5*s, 2.5*s)
        if d < 1.5: p = over(p, cr, cg, cb, aa(d))

        # 眼睛
        for ex in (-4.0*s, 4.0*s):
            d = d_circle(fx, fy, ex, -1.0*s, 2.0*s)
            if d < 1.5: p = over(p, 1, 1, 1, aa(d))

        # 嘴巴
        d = d_rrect(fx, fy, 0, 5.5*s, 4.0*s, 1.0*s, 1.0*s)
        if d < 1.5: p = over(p, 1, 1, 1, aa(d) * 0.85)

        # 天線柱（與頭頂相接）
        d = d_rrect(fx, fy, 0, -11.0*s, 1.0*s, 2.0*s, 1.0*s)
        if d < 1.5: p = over(p, cr, cg, cb, aa(d))

        # 天線頂（白點）
        d = d_circle(fx, fy, 0, -14.0*s, 1.5*s)
        if d < 1.5: p = over(p, 1, 1, 1, aa(d))

        return p

    return make_png(w, h, px)

# ── ICO（Windows）────────────────────────────────────────────────────────
def make_ico(png_256: bytes) -> bytes:
    """把 256×256 PNG 打包成 Windows ICO。"""
    count  = 1
    offset = 6 + 16 * count
    header = struct.pack('<HHH', 0, 1, count)
    entry  = struct.pack('<BBBBHHII', 0, 0, 0, 0, 1, 32, len(png_256), offset)
    return header + entry + png_256

# ── ICNS（macOS）─────────────────────────────────────────────────────────
def make_icns(png_128: bytes, png_256: bytes, png_512: bytes) -> bytes:
    """把多個 PNG 打包成 macOS ICNS（ic07/ic08/ic09）。"""
    def icns_chunk(t: bytes, d: bytes) -> bytes:
        return t + struct.pack('>I', 8 + len(d)) + d

    body = (icns_chunk(b'ic07', png_128)
          + icns_chunk(b'ic08', png_256)
          + icns_chunk(b'ic09', png_512))
    return b'icns' + struct.pack('>I', 8 + len(body)) + body

# ── 主程式 ────────────────────────────────────────────────────────────────
def main():
    print('產生 ObsBot 圖示…\n')

    # Tray 圖示（32×32）
    tray = {
        'icon.png':         PURPLE,
        'icon-running.png': PURPLE,
        'icon-stopped.png': GREY,
        'icon-error.png':   RED,
    }
    for name, color in tray.items():
        (ASSETS / name).write_bytes(render_robot(32, color))
        print(f'  ✓ {name}')

    # App 圖示（多尺寸）
    print()
    sizes = {128: None, 256: None, 512: None}
    for sz in sizes:
        sizes[sz] = render_robot(sz, PURPLE)
        (ASSETS / f'icon-{sz}.png').write_bytes(sizes[sz])
        print(f'  ✓ icon-{sz}.png')

    # Windows .ico
    (ASSETS / 'icon.ico').write_bytes(make_ico(sizes[256]))
    print('  ✓ icon.ico')

    # macOS .icns
    (ASSETS / 'icon.icns').write_bytes(make_icns(sizes[128], sizes[256], sizes[512]))
    print('  ✓ icon.icns')

    print(f'\n✅ 完成！圖示已存入 {ASSETS}')

if __name__ == '__main__':
    main()
