#!/usr/bin/env python3
"""Generates 1080x1920 slide PNGs from a JSON spec file.
Usage: make_slides.py <spec.json> <outdir>
spec.json: {"lines": ["...", ...], "footer": "..."}
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1920
FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
]
ACCENT = (240, 185, 11)
TEXT = (255, 255, 255)
MUTED = (165, 175, 195)


def load_font(size):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def wrap(draw, text, font, max_width):
    words = text.split()
    lines = []
    current = ""
    for word in words:
        candidate = (current + " " + word).strip()
        if draw.textlength(candidate, font=font) <= max_width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def main():
    spec_path, outdir = sys.argv[1], sys.argv[2]
    with open(spec_path, "r", encoding="utf-8") as fh:
        spec = json.load(fh)

    os.makedirs(outdir, exist_ok=True)
    paths = []

    for i, text in enumerate(spec["lines"]):
        img = Image.new("RGB", (W, H))
        draw = ImageDraw.Draw(img)

        top, bottom = (13, 20, 36), (5, 8, 16)
        for y in range(H):
            t = y / H
            color = tuple(int(top[c] + (bottom[c] - top[c]) * t) for c in range(3))
            draw.line([(0, y), (W, y)], fill=color)

        draw.rectangle([W // 2 - 90, int(H * 0.28), W // 2 + 90, int(H * 0.28) + 12], fill=ACCENT)

        is_first = i == 0
        body_font = load_font(88 if is_first else 72)
        footer_font = load_font(34)
        max_width = W - 150

        text_lines = wrap(draw, text, body_font, max_width)
        line_height = int(body_font.size * 1.4)
        block_height = len(text_lines) * line_height
        y = H * 0.44 - block_height / 2

        for line in text_lines:
            width = draw.textlength(line, font=body_font)
            draw.text(((W - width) / 2, y), line, font=body_font, fill=TEXT)
            y += line_height

        footer = spec.get("footer", "")
        if footer:
            fw = draw.textlength(footer, font=footer_font)
            draw.text(((W - fw) / 2, H - 150), footer, font=footer_font, fill=MUTED)

        path = os.path.join(outdir, f"slide{i}.png")
        img.save(path)
        paths.append(path)

    print(json.dumps(paths))


if __name__ == "__main__":
    main()
