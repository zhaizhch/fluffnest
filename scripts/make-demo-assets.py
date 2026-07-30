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


if __name__ == "__main__":
    main()
