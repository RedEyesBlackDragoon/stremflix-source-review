#!/usr/bin/env python3
"""Render the app's icons and TV banner from the wordmark (same look as the intro: red Bebas Neue
with a soft glow on a dark rounded tile).

usage: render_brand.py            (run from tools/, writes into app/images and tv/app/src/main/res)

Square icons carry the whole wordmark from 128 px up; smaller ones, where nine letters would be a
smudge, carry its first letter.
"""
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FONT = os.path.join(HERE, "fonts", "BebasNeue-Regular.ttf")
TEXT = "STREMFLIX"
ACCENT = (229, 9, 20)
SS = 4  # supersampling


def wordmark(text, width, height):
    """Red text with a glow, fitted inside width x height, on a transparent layer."""
    size = height
    font = ImageFont.truetype(FONT, size)
    while True:
        l, t, r, b = font.getbbox(text)
        if r - l <= width and b - t <= height:
            break
        size -= 2
        font = ImageFont.truetype(FONT, size)
    layer = Image.new("L", (r - l, b - t), 0)
    ImageDraw.Draw(layer).text((-l, -t), text, font=font, fill=255)
    return layer


def place(canvas, mask, cx, cy):
    w, h = canvas.size
    glow = Image.new("L", (w, h), 0)
    glow.paste(mask, (int(cx - mask.width / 2), int(cy - mask.height / 2)))
    halo = glow.filter(ImageFilter.GaussianBlur(max(2, mask.height * 0.12)))
    red = Image.new("RGBA", (w, h), ACCENT + (255,))
    canvas.paste(Image.new("RGBA", (w, h), ACCENT + (120,)), (0, 0), halo.point(lambda v: v * 0.55))
    canvas.paste(red, (0, 0), glow)


def tile(size, rounded=True):
    """Dark tile with a gentle top-to-bottom gradient, rounded like the old icon."""
    s = size * SS
    grad = Image.linear_gradient("L").resize((s, s)).point(lambda v: 38 - v * 18 // 255)
    base = Image.merge("RGBA", (grad, grad, grad, Image.new("L", (s, s), 255)))
    if rounded:
        inset = int(s * 0.055)
        mask = Image.new("L", (s, s), 0)
        ImageDraw.Draw(mask).rounded_rectangle((inset, inset, s - inset, s - inset), radius=int(s * 0.19), fill=255)
        base.putalpha(mask)
    return base


def icon(size):
    s = size * SS
    img = tile(size)
    text = TEXT if size >= 128 else TEXT[0]
    mark = wordmark(text, int(s * 0.74), int(s * (0.30 if len(text) > 1 else 0.62)))
    layer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    place(layer, mark, s / 2, s / 2)
    img.alpha_composite(Image.composite(layer, Image.new("RGBA", (s, s), (0, 0, 0, 0)), img.getchannel("A")))
    return img.resize((size, size), Image.LANCZOS)


def banner(w, h):
    s = (w * SS, h * SS)
    grad = Image.linear_gradient("L").resize(s).point(lambda v: 34 - v * 14 // 255)
    img = Image.merge("RGBA", (grad, grad, grad, Image.new("L", s, 255)))
    place(img, wordmark(TEXT, int(s[0] * 0.84), int(s[1] * 0.46)), s[0] / 2, s[1] / 2)
    return img.resize((w, h), Image.LANCZOS)


def main():
    images = os.path.join(ROOT, "app", "images")
    big = icon(1024)
    big.save(os.path.join(images, "icon.png"))
    icon(512).save(os.path.join(images, "icon-512.png"))
    icon(256).save(os.path.join(images, "icon-256.png"))
    icon(512).save(os.path.join(images, "presence", "logo.png"))
    # Windows: each size drawn at that size (small ones get the monogram)
    sizes = [16, 24, 32, 48, 64, 128, 256]
    icon(256).save(os.path.join(images, "icon.ico"), sizes=[(n, n) for n in sizes],
                   append_images=[icon(n) for n in sizes[:-1]])
    big.save(os.path.join(images, "icon.icns"))

    res = os.path.join(ROOT, "tv", "app", "src", "main", "res")
    banner(320, 180).save(os.path.join(res, "drawable", "banner.png"))
    for folder, n in {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}.items():
        icon(n).save(os.path.join(res, f"mipmap-{folder}", "ic_launcher.png"))
    print("brand images written")


if __name__ == "__main__":
    main()
