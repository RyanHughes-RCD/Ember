#!/usr/bin/env python3
"""Build the app icons from the game's own sprites.

Draws a 64x64 pixel-art scene (night sky, forest edge, firelight, campfire) and
scales it up with nearest-neighbour so it stays crisp.

Usage:  python3 tools/build_icon.py
Requires: Pillow
"""
import math
import random
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SPR = ROOT / "assets" / "sprites"
OUT = ROOT / "assets" / "icons"
N = 64


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def scene(fire_scale=1.0):
    """fire_scale < 1 leaves a wider margin (for maskable icons, which get cropped)."""
    img = Image.new("RGBA", (N, N), (0, 0, 0, 255))
    px = img.load()
    horizon = 40
    # sky to ground
    for y in range(N):
        if y < horizon:
            c = lerp((7, 9, 22), (20, 22, 40), y / horizon)
        else:
            c = lerp((24, 17, 11), (10, 7, 5), (y - horizon) / (N - horizon))
        for x in range(N):
            px[x, y] = (*c, 255)
    # stars
    rng = random.Random(11)
    for _ in range(26):
        x, y = rng.randrange(N), rng.randrange(horizon - 12)
        px[x, y] = (207, 214, 255, 255) if rng.random() < 0.4 else (90, 96, 128, 255)

    # forest edge: the middle of the night forest, squeezed to fit
    forest = Image.open(SPR / "forest_night.png").convert("RGBA")
    band = forest.crop((24, 8, 104, 62)).resize((N, 36), Image.NEAREST)
    img.alpha_composite(band, (0, horizon - 30))

    # firelight: stepped (banded) glow so it reads as pixel art
    cx, cy = N / 2, 44
    px = img.load()
    for y in range(N):
        for x in range(N):
            d = math.hypot(x + 0.5 - cx, (y + 0.5 - cy) * 1.15) / 30
            k = max(0.0, 1 - d)
            k = math.floor(k * 6) / 6  # bands
            if k <= 0:
                continue
            r, g, b, _ = px[x, y]
            a = 0.62 * k
            px[x, y] = (min(255, int(r + 255 * a)), min(255, int(g + 140 * a * 0.9)), min(255, int(b + 50 * a * 0.6)), 255)

    # campfire (logs + first flame frame)
    logs = Image.open(SPR / "logs.png").convert("RGBA")
    flame = Image.open(SPR / "flames.png").convert("RGBA").crop((0, 0, 40, 50))
    fire = Image.new("RGBA", (40, 50), (0, 0, 0, 0))
    fire.alpha_composite(logs)
    fire.alpha_composite(flame)
    fire = fire.crop(fire.getbbox())
    if fire_scale != 1.0:
        fire = fire.resize((round(fire.width * fire_scale), round(fire.height * fire_scale)), Image.NEAREST)
    img.alpha_composite(fire, ((N - fire.width) // 2, 56 - fire.height + (0 if fire_scale == 1.0 else -3)))

    # soft vignette
    px = img.load()
    for y in range(N):
        for x in range(N):
            d = math.hypot(x + 0.5 - N / 2, y + 0.5 - N / 2) / (N * 0.72)
            k = max(0.0, d - 0.55) * 1.3
            if k > 0:
                r, g, b, _ = px[x, y]
                px[x, y] = (int(r * (1 - k)), int(g * (1 - k)), int(b * (1 - k)), 255)
    return img.convert("RGB")


def save(img, name, size):
    OUT.mkdir(parents=True, exist_ok=True)
    img.resize((size, size), Image.NEAREST).save(OUT / name)
    print("wrote", name)


if __name__ == "__main__":
    icon = scene()
    for size in (1024, 512, 192, 180, 32):
        save(icon, f"icon-{size}.png", size)
    save(scene(fire_scale=0.8), "icon-maskable-512.png", 512)
    icon.resize((64, 64), Image.NEAREST).save(OUT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    print("wrote favicon.ico")
