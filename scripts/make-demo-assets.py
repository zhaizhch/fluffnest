#!/usr/bin/env python3
"""Generate README demo GIF / hero PNG from real pet spritesheets.

Usage (repo root):
  python3 scripts/make-demo-assets.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

CELL_W, CELL_H = 192, 208
IDLE_FRAMES = 6
SCALE = 1.32
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "assets"

PETS = [
    ("butter-bear", "糯糯"),
    ("blue-boba-axolotl", "波波"),
    ("pearl-idol", "珍珠偶像"),
    ("veemon", "Ｖ仔兽"),
]


def load_idle_frames(pack: str) -> list[Image.Image]:
    sheet = Image.open(ROOT / "public" / "pets" / pack / "spritesheet.webp").convert(
        "RGBA"
    )
    frames = []
    for i in range(IDLE_FRAMES):
        x = (i % 8) * CELL_W
        cell = sheet.crop((x, 0, x + CELL_W, CELL_H))
        cell = cell.resize(
            (int(CELL_W * SCALE), int(CELL_H * SCALE)), Image.Resampling.NEAREST
        )
        frames.append(cell)
    return frames


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    all_frames = [load_idle_frames(p) for p, _ in PETS]

    w, h = 960, 540
    base = Image.new("RGBA", (w, h), (246, 241, 234, 255))
    draw = ImageDraw.Draw(base)
    for y in range(h):
        t = y / h
        draw.line(
            [(0, y), (w, y)],
            fill=(
                int(246 - 20 * t),
                int(241 - 28 * t),
                int(234 - 12 * t),
                255,
            ),
        )

    for cx, cy, rad, col in [
        (120, 80, 160, (239, 226, 212, 90)),
        (820, 100, 180, (228, 234, 242, 100)),
        (500, 420, 220, (232, 220, 210, 70)),
    ]:
        overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        ImageDraw.Draw(overlay).ellipse(
            [cx - rad, cy - rad, cx + rad, cy + rad], fill=col
        )
        base = Image.alpha_composite(base, overlay)

    draw = ImageDraw.Draw(base)
    draw.rectangle([0, 0, w, 30], fill=(255, 252, 247, 235))
    draw.rectangle([0, 30, w, 31], fill=(232, 221, 208, 255))
    for i, c in enumerate([(255, 95, 87), (255, 189, 46), (40, 200, 64)]):
        draw.ellipse([14 + i * 18, 9, 26 + i * 18, 21], fill=c + (255,))

    draw.rounded_rectangle(
        [40, 56, w - 40, h - 40],
        radius=20,
        fill=(255, 252, 247, 248),
        outline=(232, 221, 208, 255),
        width=2,
    )

    font_path = "/Library/Fonts/Arial Unicode.ttf"
    font_lg = ImageFont.truetype(font_path, 40)
    font_sm = ImageFont.truetype(font_path, 18)
    font_xs = ImageFont.truetype(font_path, 15)

    draw.text((68, 76), "绒窝 FluffNest", fill=(61, 50, 41, 255), font=font_lg)
    draw.text(
        (70, 126),
        "桌边有个软软的小窝  ·  免费开源的 macOS 桌面宠物",
        fill=(138, 116, 104, 255),
        font=font_sm,
    )

    positions = [(70, 250), (280, 270), (500, 245), (700, 265)]
    for px, py in positions:
        draw.ellipse(
            [
                px + 40,
                py + int(CELL_H * SCALE) - 16,
                px + int(CELL_W * SCALE) - 40,
                py + int(CELL_H * SCALE) + 8,
            ],
            fill=(200, 180, 160, 55),
        )

    bobs = [0, -3, -6, -3, 0, 2]
    anim: list[Image.Image] = []
    for fi in range(IDLE_FRAMES):
        frame = base.copy()
        for pi, _ in enumerate(PETS):
            px, py = positions[pi]
            frame.alpha_composite(all_frames[pi][fi], (px, py + bobs[fi]))
        d = ImageDraw.Draw(frame)
        d.rounded_rectangle(
            [60, h - 98, w - 60, h - 52],
            radius=12,
            fill=(255, 255, 255, 220),
        )
        d.text(
            (78, h - 88),
            "点击互动 · 图鉴收集 · 喝水提醒 · 金币解锁更多伙伴",
            fill=(61, 50, 41, 255),
            font=font_xs,
        )
        anim.append(frame)

    hero = anim[0].convert("RGB")
    hero.save(OUT / "hero.png", "PNG", optimize=True)

    gif_frames = [
        fr.convert("RGB").quantize(colors=220, method=Image.Quantize.MEDIANCUT)
        for fr in anim
    ]
    gif_frames[0].save(
        OUT / "demo.gif",
        save_all=True,
        append_images=gif_frames[1:],
        duration=150,
        loop=0,
        optimize=False,
        disposal=2,
    )

    hero.resize((800, 450), Image.Resampling.LANCZOS).save(
        OUT / "social.png", "PNG", optimize=True
    )
    print(f"wrote {OUT / 'demo.gif'}")
    print(f"wrote {OUT / 'hero.png'}")
    print(f"wrote {OUT / 'social.png'}")

    write_warp_gif(
        "broom-witch",
        "扫帚魔女 · 空间跳跃",
        "demo-broomwitch-warp.gif",
        (168, 130, 220),
        1,
    )
    write_warp_gif(
        "kaka-5",
        "暖卡卡 · 空间跳跃",
        "demo-kaka5-warp.gif",
        (255, 168, 118),
        7,
    )


def load_row_frames(pack: str, row: int, n: int, scale: float = 1.55) -> list[Image.Image]:
    sheet = Image.open(ROOT / "public" / "pets" / pack / "spritesheet.webp").convert(
        "RGBA"
    )
    frames = []
    for i in range(n):
        x = (i % 8) * CELL_W
        y = row * CELL_H
        cell = sheet.crop((x, y, x + CELL_W, y + CELL_H))
        cell = cell.resize(
            (int(CELL_W * scale), int(CELL_H * scale)), Image.Resampling.NEAREST
        )
        frames.append(cell)
    return frames


def write_warp_gif(
    pack: str,
    title: str,
    outfile: str,
    tint: tuple[int, int, int],
    seed: int,
) -> None:
    """A → B space jump: idle at A, vanish, travel streak, appear at B."""
    import math
    import random

    jump = load_row_frames(pack, 4, 5)
    idle = load_row_frames(pack, 0, 4)
    pw, ph = jump[0].size
    w, h = 640, 400
    font_path = "/Library/Fonts/Arial Unicode.ttf"
    font_lg = ImageFont.truetype(font_path, 24)
    font_sm = ImageFont.truetype(font_path, 14)
    font_tiny = ImageFont.truetype(font_path, 13)

    left_x = 48
    right_x = w - pw - 48
    base_y = (h - ph) // 2 + 20
    left_cx = left_x + pw // 2
    right_cx = right_x + pw // 2
    foot_y = base_y + ph - 8

    def make_bg() -> Image.Image:
        im = Image.new("RGBA", (w, h), (24, 22, 38, 255))
        d = ImageDraw.Draw(im)
        rng = random.Random(42 + seed)
        for _ in range(100):
            x, y = rng.randint(0, w - 1), rng.randint(0, h - 1)
            r = rng.randint(1, 2)
            d.ellipse(
                [x - r, y - r, x + r, y + r],
                fill=(255, 255, 255, rng.randint(90, 220)),
            )
        for cx, cy, rad, a in [
            (w * 0.2, h * 0.35, 110, 45),
            (w * 0.8, h * 0.55, 130, 40),
        ]:
            ov = Image.new("RGBA", (w, h), (0, 0, 0, 0))
            ImageDraw.Draw(ov).ellipse(
                [cx - rad, cy - rad, cx + rad, cy + rad], fill=(*tint, a)
            )
            im = Image.alpha_composite(im, ov)
        return im

    def ring(d: ImageDraw.ImageDraw, cx: int, cy: int, r: int, color, width=3):
        if r > 0:
            d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=color, width=width)

    def place_pads(fr: Image.Image) -> None:
        d = ImageDraw.Draw(fr)
        for t in range(12):
            x0 = left_cx + 30 + t * ((right_cx - left_cx - 60) / 11)
            y0 = foot_y + 4
            if t % 2 == 0:
                d.ellipse([x0 - 2, y0 - 2, x0 + 2, y0 + 2], fill=(*tint, 100))
        mx = (left_cx + right_cx) // 2
        d.polygon(
            [
                (mx - 14, foot_y),
                (mx + 14, foot_y),
                (mx + 14, foot_y - 1),
                (mx + 22, foot_y + 4),
                (mx + 14, foot_y + 9),
                (mx + 14, foot_y + 8),
                (mx - 14, foot_y + 8),
            ],
            fill=(*tint, 160),
        )
        for cx, label, name in [
            (left_cx, "A", "起点"),
            (right_cx, "B", "终点"),
        ]:
            d.ellipse([cx - 18, foot_y + 1, cx + 18, foot_y + 11], fill=(255, 255, 255, 40))
            d.text((cx - 10, foot_y + 14), label, fill=(255, 240, 230, 220), font=font_tiny)
            d.text((cx - 16, foot_y + 28), name, fill=(200, 190, 210, 200), font=font_tiny)

    def stamp(fr: Image.Image, subtitle: str) -> Image.Image:
        d = ImageDraw.Draw(fr)
        d.rounded_rectangle([16, 12, w - 16, 52], radius=10, fill=(255, 252, 247, 235))
        d.text((28, 20), title, fill=(61, 50, 41, 255), font=font_lg)
        d.text((28, h - 32), subtitle, fill=(230, 220, 240, 230), font=font_sm)
        return fr

    timeline: list[Image.Image] = []

    for i in range(5):
        fr = make_bg()
        place_pads(fr)
        fr.alpha_composite(idle[i % len(idle)], (left_x, base_y + [0, -2, -4, -2, 0][i]))
        timeline.append(stamp(fr, "在起点蓄力…"))

    for i, jf in enumerate(jump):
        fr = make_bg()
        place_pads(fr)
        lift = -i * 14
        fr.alpha_composite(jf, (left_x, base_y + lift))
        if i >= 2:
            d = ImageDraw.Draw(fr)
            ring(d, left_cx, base_y + ph // 2 + lift, 24 + i * 16, (*tint, 200), 2)
            ring(d, left_cx, base_y + ph // 2 + lift, 12 + i * 8, (255, 255, 255, 180), 2)
        timeline.append(stamp(fr, "空间门打开…"))

    for i in range(4):
        fr = make_bg()
        place_pads(fr)
        d = ImageDraw.Draw(fr)
        r = 20 + i * 26
        ring(d, left_cx, base_y + ph // 2 - 20, r, (255, 255, 255, 210 - i * 40), 3)
        ring(d, left_cx, base_y + ph // 2 - 20, max(6, r // 2), (*tint, 230), 2)
        for a in range(10):
            ang = a * math.pi / 5 + i * 0.4
            sx = left_cx + int(math.cos(ang) * (30 + i * 24))
            sy = base_y + ph // 2 - 20 + int(math.sin(ang) * (30 + i * 24))
            d.ellipse([sx - 2, sy - 2, sx + 2, sy + 2], fill=(255, 255, 255, 230))
        if i == 0:
            after = jump[-1].copy()
            after.putalpha(after.split()[-1].point(lambda a: int(a * 0.35)))
            fr.alpha_composite(after, (left_x, base_y - 50))
        timeline.append(stamp(fr, "咻——离开起点"))

    for i in range(6):
        fr = make_bg()
        place_pads(fr)
        d = ImageDraw.Draw(fr)
        t = i / 5.0
        cx = int(left_cx + (right_cx - left_cx) * t)
        cy = base_y + ph // 2 - 10 - int(math.sin(t * math.pi) * 40)
        for k in range(8):
            bx = cx - k * 14
            ba = 200 - k * 22
            if ba > 0:
                d.ellipse([bx - 6, cy - 4, bx + 6, cy + 4], fill=(*tint, ba))
        ring(d, cx, cy, 16, (255, 255, 255, 200), 2)
        if 0.15 < t < 0.85:
            ghost = idle[0].copy()
            ghost.putalpha(ghost.split()[-1].point(lambda a: int(a * 0.18)))
            fr.alpha_composite(ghost, (cx - pw // 2, cy - ph // 2))
        timeline.append(stamp(fr, f"穿越空间  {i + 1}/6"))

    for i in range(3):
        fr = make_bg()
        place_pads(fr)
        d = ImageDraw.Draw(fr)
        r = 70 - i * 18
        ring(d, right_cx, base_y + ph // 2, r, (255, 255, 255, 200 - i * 30), 3)
        ring(d, right_cx, base_y + ph // 2, max(10, r // 2), (*tint, 220), 2)
        if i >= 1:
            alpha = jump[min(i, len(jump) - 1)].copy()
            alpha.putalpha(alpha.split()[-1].point(lambda a: int(a * (0.45 + i * 0.2))))
            fr.alpha_composite(alpha, (right_x, base_y - 40 + i * 12))
        timeline.append(stamp(fr, "抵达终点！"))

    for i in range(6):
        fr = make_bg()
        place_pads(fr)
        fr.alpha_composite(
            idle[i % len(idle)], (right_x, base_y + [0, -2, -4, -2, 0, -1][i])
        )
        d = ImageDraw.Draw(fr)
        ring(d, right_cx, foot_y + 6, 22, (*tint, 120), 2)
        timeline.append(stamp(fr, "到另一个地点啦"))

    n = len(timeline)
    durations = []
    for i in range(n):
        if i < 5:
            durations.append(110)
        elif i < 10:
            durations.append(90)
        elif i < 14:
            durations.append(70)
        elif i < 20:
            durations.append(65)
        elif i < 23:
            durations.append(85)
        else:
            durations.append(120)

    gifs = [
        fr.convert("RGB").quantize(colors=230, method=Image.Quantize.MEDIANCUT)
        for fr in timeline
    ]
    path = OUT / outfile
    gifs[0].save(
        path,
        save_all=True,
        append_images=gifs[1:],
        duration=durations,
        loop=0,
        optimize=False,
        disposal=2,
    )
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
