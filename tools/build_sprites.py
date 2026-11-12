#!/usr/bin/env python3
"""Derive the game's native-resolution pixel sprites from the source art.

The source images in assets/source/ are upscaled pixel art (~6px per pixel).
This script downsamples them back to native resolution and traces the derived
sprites the game needs (separate flame frames, logs, embers, ash pile and a
night-tinted forest backdrop).

Usage:  python3 tools/build_sprites.py
Requires: Pillow, numpy
"""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "source"
OUT = ROOT / "assets" / "sprites"
BLOCK = 6


def downsample(path, offset_y=0):
    a = np.array(Image.open(path).convert("RGBA")).astype(float)
    sub = a[offset_y:]
    h = (sub.shape[0] // BLOCK) * BLOCK
    w = (sub.shape[1] // BLOCK) * BLOCK
    blk = sub[:h, :w].reshape(h // BLOCK, BLOCK, w // BLOCK, BLOCK, 4)
    blk = blk.transpose(0, 2, 1, 3, 4).reshape(h // BLOCK, w // BLOCK, BLOCK * BLOCK, 4)
    m = np.median(blk, axis=2)
    m[..., 3] = np.where(m[..., 3] > 110, 255, 0)
    m[m[..., 3] == 0] = 0
    return m.astype(np.uint8)


def save(arr, name):
    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray(arr.astype(np.uint8), "RGBA").save(OUT / name)
    print("wrote", name, arr.shape[1], "x", arr.shape[0])


def column_groups(alpha):
    cols = np.where(alpha.any(0))[0]
    groups, start, prev = [], cols[0], cols[0]
    for c in cols[1:]:
        if c > prev + 1:
            groups.append((start, prev))
            start = c
        prev = c
    groups.append((start, prev))
    return groups


def is_flame(px):
    r, g, b, a = px
    return a > 0 and g > 110


def build_campfire():
    fire = downsample(SRC / "campfire.webp")
    alpha = fire[..., 3] > 0
    rows = np.where(alpha.any(1))[0]
    top, bottom = rows.min(), rows.max()
    groups = column_groups(alpha)
    FW, FH = 40, bottom - top + 1
    flames, logs_ref = [], None
    for (x0, x1) in groups:
        crop = fire[top:bottom + 1, x0:x1 + 1]
        # anchor each frame on the log pile (lowest rows) so frames line up
        log_rows = crop[-8:]
        lc = np.where((log_rows[..., 3] > 0).any(0))[0]
        center = (lc.min() + lc.max()) // 2
        frame = np.zeros((FH, FW, 4), np.uint8)
        off = FW // 2 - center
        for y in range(crop.shape[0]):
            for x in range(crop.shape[1]):
                tx = x + off
                if 0 <= tx < FW and crop[y, x, 3]:
                    frame[y, tx] = crop[y, x]
        flame = np.zeros_like(frame)
        logs = np.zeros_like(frame)
        for y in range(FH):
            for x in range(FW):
                if frame[y, x, 3] == 0:
                    continue
                if is_flame(frame[y, x]):
                    flame[y, x] = frame[y, x]
                else:
                    logs[y, x] = frame[y, x]
        # reddish ember pixels above the log pile belong to the flame body
        log_top = FH - 14
        for y in range(log_top):
            flame[y][logs[y, :, 3] > 0] = logs[y][logs[y, :, 3] > 0]
            logs[y] = 0
        flames.append(flame)
        if logs_ref is None:
            logs_ref = logs
    save(np.concatenate(flames, axis=1), "flames.png")

    # logs: fill any holes the flame left with charred wood colour
    logs = logs_ref.copy()
    save(logs, "logs.png")

    # embers: logs with glowing seams and a low red glow on top
    embers = logs.copy().astype(int)
    rng = np.random.default_rng(7)
    for y in range(FH):
        for x in range(FW):
            if embers[y, x, 3] == 0:
                continue
            r, g, b, _ = embers[y, x]
            if r > 150 and g < 90:  # existing red ember seams -> brighter
                embers[y, x, :3] = (240, 96, 40)
            elif rng.random() < 0.06 and y < FH - 4:
                embers[y, x, :3] = (170, 52, 30)
    save(np.clip(embers, 0, 255), "embers.png")

    # charred logs: darkened, desaturated
    charred = logs.copy().astype(float)
    lum = charred[..., :3].mean(axis=2, keepdims=True)
    charred[..., :3] = (lum * 0.55 + charred[..., :3] * 0.15) * np.array([1.0, 0.95, 0.92])
    charred = np.clip(charred, 0, 255)
    save(charred, "charred.png")

    # ash pile traced over the charred logs
    ash = charred.copy()
    cx, base = FW // 2, FH - 7
    pal = [(70, 66, 64), (98, 93, 89), (128, 122, 116), (160, 154, 147), (190, 184, 176)]
    for x in range(FW):
        dx = (x - cx) / 14.5
        if abs(dx) >= 1:
            continue
        h = 9.5 * (1 - dx * dx) ** 0.75
        for y in range(int(base - h), base + 3):
            if y < 0 or y >= FH:
                continue
            t = (base - y) / max(h, 1)  # 0 at bottom, 1 at the crest
            shade = 1.2 + 2.2 * t - 1.2 * max(0.0, dx) + 0.6 * max(0.0, -dx)
            idx = int(np.clip(round(shade + (rng.random() - 0.5) * 1.1), 0, 4))
            ash[y, x] = (*pal[idx], 255)
    # a few dim embers left in the ash
    for _ in range(6):
        x = cx + int(rng.integers(-9, 10))
        y = base - int(rng.integers(0, 3))
        if ash[y, x, 3]:
            ash[y, x, :3] = (190, 70, 40)
    save(ash, "ashpile.png")


def build_forest():
    forest = downsample(SRC / "forest.webp", offset_y=2).astype(float)
    # night grade: darken, cool the shadows, keep a hint of the greens
    rgb = forest[..., :3]
    lum = rgb.mean(axis=2, keepdims=True)
    night = (rgb * 0.55 + lum * 0.45) * np.array([0.34, 0.40, 0.52])
    forest[..., :3] = np.clip(night, 0, 255)
    save(forest, "forest_night.png")


def build_hatchet():
    """Isolate the hatchet from its white background, rotate it 90 degrees clockwise,
    and save it at full and half size (the half-size one is used in the scene)."""
    b, ox, oy = 6.55, 2.1833, 1.0917  # pixel grid of assets/source/hatchet.png
    a = np.array(Image.open(SRC / "hatchet.png").convert("RGB")).astype(float)
    h, w, _ = a.shape
    nx, ny = int((w - ox) / b), int((h - oy) / b)
    out = np.zeros((ny, nx, 4), np.uint8)
    for j in range(ny):
        for i in range(nx):
            x0, x1 = int(ox + i * b + 1), int(ox + (i + 1) * b - 1)
            y0, y1 = int(oy + j * b + 1), int(oy + (j + 1) * b - 1)
            m = np.median(a[y0:y1 + 1, x0:x1 + 1].reshape(-1, 3), axis=0)
            if m.sum() > 600:  # white background and pale anti-aliasing -> transparent
                continue
            out[j, i, :3] = m.round()
            out[j, i, 3] = 255
    im = Image.fromarray(out, "RGBA")
    im = im.crop(im.getbbox()).transpose(Image.Transpose.ROTATE_270)  # 90 degrees clockwise
    save(np.array(im), "hatchet_full.png")
    # half size: each 2x2 block becomes its darkest opaque pixel if at least two are opaque,
    # which keeps the thin handle and the dark outline intact
    A = np.array(im)
    H2, W2 = (A.shape[0] + 1) // 2, (A.shape[1] + 1) // 2
    half = np.zeros((H2, W2, 4), np.uint8)
    for y in range(H2):
        for x in range(W2):
            blk = A[y * 2:y * 2 + 2, x * 2:x * 2 + 2].reshape(-1, 4)
            opaque = blk[blk[:, 3] > 0]
            if len(opaque) >= 2:
                half[y, x] = opaque[np.argsort(opaque[:, :3].sum(1))[len(opaque) // 2]]
    save(half, "hatchet.png")


if __name__ == "__main__":
    build_campfire()
    build_forest()
    build_hatchet()
