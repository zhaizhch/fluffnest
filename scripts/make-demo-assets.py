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


def load_row_frames(pack: str, row: int, n: int) -> list[Image.Image]:
    sheet = Image.open(ROOT / "public" / "pets" / pack / "spritesheet.webp").convert(
        "RGBA"
    )
    frames = []
    for i in range(n):
        x = (i % 8) * CELL_W
        y = row * CELL_H
        cell = sheet.crop((x, y, x + CELL_W, y + CELL_H))
        cell = cell.resize(
            (int(CELL_W * 2.0), int(CELL_H * 2.0)), Image.Resampling.NEAREST
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
    import math
    import random

    jump = load_row_frames(pack, 4, 5)
    idle = load_row_frames(pack, 0, 4)
    pw, ph = jump[0].size
    w, h = 520, 420
    font_path = "/Library/Fonts/Arial Unicode.ttf"
    font_lg = ImageFont.truetype(font_path, 26)
    font_sm = ImageFont.truetype(font_path, 14)
    left_x, right_x = 36, w - pw - 36
    base_y = (h - ph) // 2 + 16

    def make_bg() -> Image.Image:
        im = Image.new("RGBA", (w, h), (22, 20, 36, 255))
        d = ImageDraw.Draw(im)
        rng = random.Random(42 + seed)
        for _ in range(90):
            x, y = rng.randint(0, w - 1), rng.randint(0, h - 1)
            r = rng.randint(1, 2)
            d.ellipse(
                [x - r, y - r, x + r, y + r],
                fill=(255, 255, 255, rng.randint(100, 230)),
            )
        for cx, cy, rad in [(w * 0.25, h * 0.3, 120), (w * 0.75, h * 0.55, 140)]:
            ov = Image.new("RGBA", (w, h), (0, 0, 0, 0))
            ImageDraw.Draw(ov).ellipse(
                [cx - rad, cy - rad, cx + rad, cy + rad], fill=(*tint, 50)
            )
            im = Image.alpha_composite(im, ov)
        return im

    def ring(d: ImageDraw.ImageDraw, cx: int, cy: int, r: int, color, width=3):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=color, width=width)

    def stamp(fr: Image.Image) -> Image.Image:
        d = ImageDraw.Draw(fr)
        d.rounded_rectangle(
            [16, 14, w - 16, 56], radius=10, fill=(255, 252, 247, 235)
        )
        d.text((28, 22), title, fill=(61, 50, 41, 255), font=font_lg)
        d.text((28, h - 36), "空间跳跃 · warp", fill=(230, 220, 240, 230), font=font_sm)
        return fr

    timeline: list[Image.Image] = []
    for i in range(4):
        fr = make_bg()
        fr.alpha_composite(idle[i % len(idle)], (left_x, base_y + [0, -3, -5, -2][i]))
        timeline.append(stamp(fr))
    for i, jf in enumerate(jump):
        fr = make_bg()
        lift = -i * 12
        ghost = jf.copy()
        ghost.putalpha(ghost.split()[-1].point(lambda a: int(a * 0.3)))
        fr.alpha_composite(ghost, (left_x + i * 6, base_y + lift + 10))
        fr.alpha_composite(jf, (left_x + i * 10, base_y + lift))
        if i >= 2:
            d = ImageDraw.Draw(fr)
            ring(
                d,
                left_x + pw // 2 + i * 10,
                base_y + ph // 2 + lift,
                28 + i * 14,
                (*tint, 190),
                2,
            )
        timeline.append(stamp(fr))
    for i in range(3):
        fr = make_bg()
        d = ImageDraw.Draw(fr)
        cx, cy = left_x + pw // 2 + 40, base_y + ph // 2 - 24
        r = 18 + i * 30
        ring(d, cx, cy, r, (255, 255, 255, 200 - i * 45), 3)
        ring(d, cx, cy, max(8, r // 2), (*tint, 230), 2)
        for a in range(8):
            ang = a * math.pi / 4 + i * 0.35
            sx = cx + int(math.cos(ang) * (36 + i * 22))
            sy = cy + int(math.sin(ang) * (36 + i * 22))
            d.ellipse([sx - 2, sy - 2, sx + 2, sy + 2], fill=(255, 255, 255, 230))
        if i == 0:
            after = jump[-1].copy()
            after.putalpha(after.split()[-1].point(lambda a: int(a * 0.4)))
            fr.alpha_composite(after, (left_x + 44, base_y - 44))
        timeline.append(stamp(fr))
    for i in range(3):
        fr = make_bg()
        d = ImageDraw.Draw(fr)
        for t in range(6):
            x = left_x + 90 + i * 55 + t * 32
            y = base_y + ph // 2 - 8 + (t % 2) * 8
            d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=(*tint, 170 - t * 18))
        timeline.append(stamp(fr))
    for i, jf in enumerate(jump):
        fr = make_bg()
        if i < 2:
            d = ImageDraw.Draw(fr)
            ring(d, right_x + pw // 2, base_y + ph // 2, 72 - i * 22, (255, 255, 255, 190), 3)
            ring(d, right_x + pw // 2, base_y + ph // 2, 42 - i * 12, (*tint, 210), 2)
        alpha = jf.copy()
        if i == 0:
            alpha.putalpha(alpha.split()[-1].point(lambda a: int(a * 0.75)))
        fr.alpha_composite(alpha, (right_x, base_y - 28 + i * 8))
        timeline.append(stamp(fr))
    for i in range(4):
        fr = make_bg()
        fr.alpha_composite(idle[i % len(idle)], (right_x, base_y + [0, -3, -5, -2][i]))
        timeline.append(stamp(fr))

    n = len(timeline)
    durations = [
        130 if (i < 4 or i >= n - 4) else (75 if 9 <= i <= 14 else 95)
        for i in range(n)
    ]
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
