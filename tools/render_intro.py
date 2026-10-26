#!/usr/bin/env python3
"""Render the dx.bi intro as a PNG sequence + WAV.

usage: render_intro.py OUT_DIR [--frames 0,60,120] [--w 1920 --h 1080 --fps 60]
"""
import argparse
import math
import os
import wave

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(HERE, "fonts", "BebasNeue-Regular.ttf")

ap = argparse.ArgumentParser()
ap.add_argument("out")
ap.add_argument("--frames", default="")
ap.add_argument("--w", type=int, default=1920)
ap.add_argument("--h", type=int, default=1080)
ap.add_argument("--fps", type=int, default=60)
ap.add_argument("--sub", type=int, default=5, help="motion-blur subframes")
args = ap.parse_args()

W, H, FPS = args.w, args.h, args.fps
DURATION = 4.2
N = int(DURATION * FPS)
os.makedirs(args.out, exist_ok=True)

ACCENT = np.array([229, 9, 20], np.float32) / 255.0
TEXT = "STREMFLIX"

# Timeline (seconds)
T_LETTERS = 0.22      # first letter starts
T_LETTER_STEP = 0.30 / (len(TEXT) - 1)  # the last letter always starts 0.3 s after the first
T_LETTER_DUR = 0.55
T_HIT1 = 1.02         # "ta"
T_HIT2 = 1.42         # "dum"
T_DIVE = 1.62         # camera starts diving into the logo
T_DIVE_END = 3.45
T_END = 4.0          # fully black


def smooth(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


def ease_out(x):
    x = min(max(x, 0.0), 1.0)
    return 1 - (1 - x) ** 3


# ---------------------------------------------------------------- logo masks
# Render each letter as its own high-res alpha mask (white on black) so letters can animate.
LOGO_PX = int(H * 0.30)                 # cap height on screen at scale 1
SS = 3                                  # supersampling for the masters
font = ImageFont.truetype(FONT, LOGO_PX * SS)
spacing = int(LOGO_PX * SS * 0.02)
glyphs = []
x = 0
for ch in TEXT:
    bbox = font.getbbox(ch)
    gw = bbox[2] - bbox[0]
    glyphs.append((ch, x - bbox[0], gw))
    x += gw + spacing
total_w = x - spacing
asc, desc = font.getmetrics()
master_h = asc + desc
letter_masks = []
for ch, ox, gw in glyphs:
    m = Image.new("L", (total_w, master_h), 0)
    ImageDraw.Draw(m).text((ox, 0), ch, font=font, fill=255)
    letter_masks.append(m)
full_mask = Image.new("L", (total_w, master_h), 0)
for m in letter_masks:
    full_mask = Image.fromarray(np.maximum(np.asarray(full_mask), np.asarray(m)))
bb = full_mask.getbbox()
letter_masks = [m.crop(bb) for m in letter_masks]
full_mask = full_mask.crop(bb)
MW, MH = full_mask.size  # master size (supersampled)
base_scale = 1.0 / SS     # master px -> screen px at zoom 1
CX, CY = W / 2, H / 2


CAM_END = 1.0  # camera reaches the logo plane (depth 1) when the dive ends


def cam_at(t):
    """Camera travel towards the logo plane (0 → 1), accelerating like a dolly push."""
    if t <= T_DIVE:
        return 0.0
    u = min((t - T_DIVE) / (T_DIVE_END - T_DIVE), 1.0)
    return 0.985 * (u ** 2.4)


def zoom_at(t):
    """Screen scale of the logo plane: gentle push during the hold, then perspective dive."""
    push = 1.0 + 0.055 * smooth((t - 0.9) / (T_DIVE - 0.9))
    return push / max(1.0 - cam_at(t), 0.015)


def logo_layer(t):
    """Return float32 HxW coverage of the logo at time t (letters animate in)."""
    z = zoom_at(t)
    s = base_scale * z
    # visible window of the master
    vw, vh = W / s, H / s
    x0 = MW / 2 - vw / 2
    y0 = MH / 2 - vh / 2
    out = np.zeros((H, W), np.float32)
    for i, m in enumerate(letter_masks):
        start = T_LETTERS + i * T_LETTER_STEP
        p = (t - start) / T_LETTER_DUR
        if p <= 0:
            continue
        e = ease_out(p)
        alpha = smooth(p * 1.6)
        # letters rise into place and settle from a vertical stretch
        dy = (1 - e) * 0.22 * MH
        sy = 1 + (1 - e) * 0.35
        crop_box = (x0, y0 - dy, x0 + vw, y0 - dy + vh)
        # emulate vertical stretch by sampling a shorter source window around the letter centre
        if sy != 1:
            cyc = y0 - dy + vh / 2
            hh = vh / sy
            crop_box = (x0, cyc - hh / 2, x0 + vw, cyc + hh / 2)
        img = m.transform((W, H), Image.EXTENT, crop_box, resample=Image.BILINEAR)
        a = np.asarray(img, np.float32) / 255.0
        if p < 1:
            blur = (1 - e) * 10
            if blur > 0.4:
                a = np.asarray(img.filter(ImageFilter.GaussianBlur(blur)), np.float32) / 255.0
        out = np.maximum(out, a * alpha)
    return out


# ---------------------------------------------------------------- ribbons
# A tunnel of vertical light ribbons. Each ribbon lives at a depth Z (logo plane = 1, further = larger).
# The camera flies forward, so ribbons sweep outward, widen and rush past — continuous, with dark gaps.
rng = np.random.default_rng(11)
col_cov = np.asarray(full_mask, np.float32).sum(axis=0)
col_cov /= col_cov.sum()
palette = np.array([
    [229, 9, 20], [229, 9, 20], [229, 9, 20], [190, 4, 16], [255, 32, 52], [140, 0, 18],
    [255, 64, 96], [205, 16, 110], [110, 8, 54], [255, 110, 50], [255, 200, 110], [70, 110, 255],
], np.float32) / 255.0
pal_p = np.array([6, 6, 6, 4, 3, 3, 2, 2, 1.5, 1, 0.6, 0.5])
pal_p /= pal_p.sum()

NR_LOGO = 70   # born on the letter strokes
NR_DEEP = 160  # further down the tunnel
NR = NR_LOGO + NR_DEEP
push_end = 1.055
s_logo = base_scale * push_end
seed_x = (rng.choice(MW, size=NR_LOGO, p=col_cov) - MW / 2) * s_logo
deep_x = rng.normal(0, W * 0.16, NR_DEEP)
R_X = np.concatenate([seed_x, deep_x]).astype(np.float32)          # lateral position (px at depth 1)
R_Z = np.concatenate([np.ones(NR_LOGO), rng.uniform(1.05, 3.2, NR_DEEP)]).astype(np.float32)
R_w = rng.uniform(1.0, 6.5, NR).astype(np.float32)                 # width (px at depth 1)
R_w[rng.random(NR) < 0.2] *= 0.3
R_col = palette[rng.choice(len(palette), size=NR, p=pal_p)]
R_gain = rng.uniform(0.35, 0.8, NR).astype(np.float32)
R_gain[NR_LOGO:] *= 0.85
R_halfh = (LOGO_PX * 0.5 * push_end) * rng.uniform(0.85, 1.15, NR)  # ribbon half-height at depth 1

xs = np.arange(W, dtype=np.float32)
ys = np.arange(H, dtype=np.float32)


def ribbons(t):
    """Additive RGB of the light ribbons."""
    if t < T_DIVE:
        return None
    cam = cam_at(t)
    u = (t - T_DIVE) / (T_DIVE_END - T_DIVE)
    reveal = smooth(u / 0.16)
    tail = 1 - smooth((u - 0.8) / 0.2)
    img = np.zeros((H, W, 3), np.float32)
    for i in range(NR):
        d = R_Z[i] - cam * (1.0 + 2.6 * u)  # deep ribbons approach faster as we accelerate
        if d <= 0.02:
            continue
        x = CX + R_X[i] / d
        w = max(R_w[i] / d, 0.7)
        if x + 4 * w < 0 or x - 4 * w > W:
            continue
        fog = np.clip((3.4 - d) / 2.2, 0, 1)
        near = np.clip((d - 0.02) / 0.22, 0, 1)
        amp = R_gain[i] * fog * near * reveal * tail
        if amp < 0.004:
            continue
        lo, hi = int(max(0, x - 5 * w)), int(min(W, x + 5 * w + 1))
        dx = (xs[lo:hi] - x) / w
        prof = 0.55 * np.exp(-0.5 * dx * dx) + 0.9 * np.exp(-0.5 * (dx * 2.8) ** 2)
        hh = R_halfh[i] / d
        # straight bands with softly feathered ends
        e = np.clip((hh - np.abs(ys - CY)) / max(hh * 0.22, 1.0), 0, 1)
        vy = e * e * (3 - 2 * e)
        img[:, lo:hi, :] += (vy[:, None] * prof[None, :])[:, :, None] * (R_col[i] * amp)[None, None, :]
    return img


# ---------------------------------------------------------------- compositing
def bloom(rgb, radius, strength):
    small = Image.fromarray(np.clip(rgb * 255, 0, 255).astype(np.uint8)).resize((W // 4, H // 4), Image.BILINEAR)
    small = small.filter(ImageFilter.GaussianBlur(radius / 4))
    big = np.asarray(small.resize((W, H), Image.BILINEAR), np.float32) / 255.0
    return rgb + big * strength


def frame_at(t):
    rgb = np.zeros((H, W, 3), np.float32)
    hit = math.exp(-((t - T_HIT1) / 0.12) ** 2) * 0.5 + math.exp(-((t - T_HIT2) / 0.18) ** 2)
    u = max(0.0, (t - T_DIVE) / (T_DIVE_END - T_DIVE))
    if t < T_DIVE_END:
        logo_alpha = 1 - smooth((u - 0.15) / 0.45)
        if logo_alpha > 0:
            a = logo_layer(t)
            rgb += a[:, :, None] * ACCENT[None, None, :] * logo_alpha * (1.0 + 0.3 * hit)
    r = ribbons(t)
    if r is not None:
        rgb += r
    # the light floods the screen as we pass through, then fades to black
    wash = smooth((t - (T_DIVE_END - 0.35)) / 0.3) * (1 - smooth((t - T_DIVE_END) / (T_END - T_DIVE_END)))
    if wash > 0:
        yy, xx = np.ogrid[:H, :W]
        rad = np.sqrt(((xx - CX) / (W * 0.6)) ** 2 + ((yy - CY) / (H * 0.6)) ** 2)
        rgb += (np.clip(1 - rad, 0, 1) ** 1.6)[:, :, None] * ACCENT[None, None, :] * (0.55 * wash)
    out_fade = 1 - smooth((t - (T_END - 0.45)) / 0.45)
    rgb *= out_fade
    glow = 0.45 + 0.55 * hit + 0.15 * smooth(u / 0.3) * (1 - smooth((u - 0.7) / 0.3))
    rgb = bloom(rgb, 40, glow)
    rgb = bloom(rgb, 8, 0.25)
    # tone map on luminance so bright overlaps roll off without washing out to white/pink
    lum = rgb.max(axis=2, keepdims=True)
    mapped = 1 - np.exp(-lum * 1.25)
    rgb = rgb * (mapped / np.maximum(lum, 1e-5))
    return rgb


def render(i):
    t0 = i / FPS
    acc = np.zeros((H, W, 3), np.float32)
    # temporal supersampling = motion blur (only needed while things move fast)
    sub = args.sub if t0 > T_DIVE - 0.1 else 2
    for k in range(sub):
        acc += frame_at(t0 + (k / sub) / FPS)
    acc /= sub
    # tiny dither to avoid banding in the gradients
    acc += (np.random.default_rng(i).random((H, W, 1), np.float32) - 0.5) / 255.0
    img = Image.fromarray(np.clip(acc * 255 + 0.5, 0, 255).astype(np.uint8))
    img.save(os.path.join(args.out, f"f{i:04d}.png"), compress_level=1)


# ---------------------------------------------------------------- audio
def write_audio(path, sr=48000):
    n = int(DURATION * sr)
    t = np.arange(n) / sr
    out = np.zeros(n, np.float32)

    def hit(at, f0, f1, decay, level, noise=0.0):
        mask = t >= at
        tt = t[mask] - at
        f = f1 + (f0 - f1) * np.exp(-tt * 18)
        phase = 2 * np.pi * np.cumsum(f) / sr
        env = (1 - np.exp(-tt * 400)) * np.exp(-tt / decay)
        sig = (np.sin(phase) + 0.35 * np.sin(2 * phase) + 0.12 * np.sin(3 * phase)) * env
        if noise:
            sig += np.random.default_rng(3).standard_normal(mask.sum()).astype(np.float32) * np.exp(-tt * 60) * noise
        out[mask] += sig.astype(np.float32) * level

    hit(T_HIT1, 150, 62, 0.22, 0.7, noise=0.25)
    hit(T_HIT2, 120, 49, 1.1, 1.0, noise=0.3)
    hit(T_HIT2, 240, 98, 0.6, 0.25)
    # soft swell under the dive
    sw = np.clip((t - T_DIVE) / 0.6, 0, 1) * np.clip((T_END - t) / 0.8, 0, 1)
    swell = np.random.default_rng(5).standard_normal(n).astype(np.float32)
    # crude low-pass by moving average
    k = 220
    swell = np.convolve(swell, np.ones(k) / k, mode="same") * 6
    out += swell * sw * 0.18
    # simple room reverb
    ir_len = int(sr * 0.9)
    ir = np.random.default_rng(9).standard_normal(ir_len).astype(np.float32) * np.exp(-np.arange(ir_len) / (sr * 0.25))
    wet = np.convolve(out, ir, mode="full")[:n] * 0.015
    out = out + wet
    out /= max(1e-6, np.abs(out).max()) / 0.85
    pcm = (out * 32767).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


if __name__ == "__main__":
    frames = [int(x) for x in args.frames.split(",") if x] or list(range(N))
    if not args.frames:
        write_audio(os.path.join(args.out, "audio.wav"))
    from concurrent.futures import ProcessPoolExecutor
    with ProcessPoolExecutor(max_workers=max(1, (os.cpu_count() or 4) - 2)) as ex:
        list(ex.map(render, frames))
    print("rendered", len(frames), "frames")
