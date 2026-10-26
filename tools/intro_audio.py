#!/usr/bin/env python3
"""Score for the dx.bi intro, synced to render_intro.py's timeline. Writes 48 kHz stereo WAV.

usage: intro_audio.py OUT.wav
"""
import sys
import wave

import numpy as np

SR = 48000
DURATION = 4.2
LETTERS = 9  # len(TEXT) in render_intro.py
T_LETTERS, T_LETTER_STEP = 0.22, 0.30 / (LETTERS - 1)
T_HIT1, T_HIT2 = 1.02, 1.42
T_DIVE, T_DIVE_END, T_END = 1.62, 3.45, 4.0

n = int(DURATION * SR)
t = np.arange(n) / SR
L = np.zeros(n)
R = np.zeros(n)
rng = np.random.default_rng(21)


def add(sig, at, pan=0.0, gain=1.0):
    i = int(at * SR)
    if i >= n:
        return
    sig = sig[: n - i] * gain
    l = np.cos((pan + 1) * np.pi / 4)
    r = np.sin((pan + 1) * np.pi / 4)
    L[i:i + len(sig)] += sig * l
    R[i:i + len(sig)] += sig * r


def env(length, attack, decay):
    tt = np.arange(int(length * SR)) / SR
    return (1 - np.exp(-tt / max(attack, 1e-4))) * np.exp(-tt / decay)


def sweep_sine(length, f0, f1, k):
    tt = np.arange(int(length * SR)) / SR
    f = f1 + (f0 - f1) * np.exp(-tt * k)
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def onepole_lp(x, fc):
    a = np.exp(-2 * np.pi * fc / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


def bandnoise(length, f_lo, f_hi):
    """Noise band-limited with an FFT mask (cheap and clean)."""
    m = int(length * SR)
    spec = np.fft.rfft(rng.standard_normal(m))
    freqs = np.fft.rfftfreq(m, 1 / SR)
    spec[(freqs < f_lo) | (freqs > f_hi)] = 0
    out = np.fft.irfft(spec, m)
    return out / (np.abs(out).max() + 1e-9)


# 1) letters landing: a tiny, soft "tk" tick per letter rising slightly in pitch, panned across the stereo field
for i in range(LETTERS):
    at = T_LETTERS + i * T_LETTER_STEP + 0.06
    tick = sweep_sine(0.05, 2600 + i * 60, 1700 + i * 45, 90) * env(0.05, 0.0008, 0.012)
    tick += bandnoise(0.05, 3000, 9000) * env(0.05, 0.0005, 0.004) * 0.35
    add(tick, at, pan=-0.5 + i / (LETTERS - 1), gain=0.07)

# 2) "ta" — tight, punchy
ta = sweep_sine(0.6, 190, 92, 26) * env(0.6, 0.002, 0.16)
ta += 0.5 * sweep_sine(0.6, 380, 184, 26) * env(0.6, 0.002, 0.07)
ta += bandnoise(0.6, 900, 5000) * env(0.6, 0.0008, 0.018) * 0.45
add(ta, T_HIT1, gain=0.55)

# 3) "dum" — deep body + sub + a little air
dum = sweep_sine(2.4, 130, 52, 14) * env(2.4, 0.003, 0.75)
dum += 0.45 * sweep_sine(2.4, 260, 104, 14) * env(2.4, 0.003, 0.35)
dum += 0.35 * np.sin(2 * np.pi * 41 * np.arange(int(2.4 * SR)) / SR) * env(2.4, 0.02, 0.9)
dum += bandnoise(2.4, 700, 4500) * env(2.4, 0.001, 0.03) * 0.4
add(dum, T_HIT2, gain=0.85)

# 4) a warm chord blooming out of the "dum" (A minor add9), slightly detuned for width
chord = [110.0, 164.81, 220.0, 261.63, 329.63, 493.88]
pad_len = DURATION - T_HIT2
tt = np.arange(int(pad_len * SR)) / SR
pad_env = (1 - np.exp(-tt / 0.35)) * np.exp(-tt / 1.6)
for j, f in enumerate(chord):
    for det, pan in ((-0.0035, -0.6), (0.0035, 0.6)):
        ff = f * (1 + det)
        v = np.sin(2 * np.pi * ff * tt) + 0.25 * np.sin(2 * np.pi * 2 * ff * tt + j)
        add(v * pad_env, T_HIT2 + 0.02, pan=pan, gain=0.035 / (1 + j * 0.25))

# 5) the dive: a rising, widening whoosh that peaks as we pass through the ribbons
dive_len = T_END - T_DIVE
m = int(dive_len * SR)
u = np.arange(m) / m
for side, pan in ((0, -0.7), (1, 0.7)):
    raw = rng.standard_normal(m)
    # time-varying lowpass: cutoff rises from 400 Hz to 9 kHz
    y = np.empty(m)
    acc = 0.0
    fc = 400 * (9000 / 400) ** (np.clip(u / 0.85, 0, 1) ** 1.6)
    a = np.exp(-2 * np.pi * fc / SR)
    for i in range(m):
        acc = (1 - a[i]) * raw[i] + a[i] * acc
        y[i] = acc
    hp = y - onepole_lp(y, 180)
    shape = np.clip(u / 0.8, 0, 1) ** 2.2 * (1 - np.clip((u - 0.8) / 0.2, 0, 1)) ** 1.5
    add(hp * shape, T_DIVE, pan=pan, gain=0.34)

# shimmer: high, soft sparkle under the peak of the dive
sh_len = 1.6
tt = np.arange(int(sh_len * SR)) / SR
sh = sum(np.sin(2 * np.pi * f * tt) for f in (1318.5, 1975.5, 2637.0)) / 3
sh *= np.sin(np.pi * np.clip(tt / sh_len, 0, 1)) ** 2 * (0.6 + 0.4 * np.sin(2 * np.pi * 7 * tt))
add(sh, T_DIVE + 0.7, pan=0.0, gain=0.025)

# 6) room: short stereo reverb so it sounds like a space, not a synth
ir_len = int(SR * 1.4)
ir_t = np.arange(ir_len) / SR
irL = rng.standard_normal(ir_len) * np.exp(-ir_t / 0.38)
irR = rng.standard_normal(ir_len) * np.exp(-ir_t / 0.38)
irL = onepole_lp(irL, 5000)
irR = onepole_lp(irR, 5000)
from numpy.fft import irfft, rfft
N = 1 << int(np.ceil(np.log2(n + ir_len)))
wetL = irfft(rfft(L, N) * rfft(irL, N), N)[:n]
wetR = irfft(rfft(R, N) * rfft(irR, N), N)[:n]
wetL /= np.abs(wetL).max() + 1e-9
wetR /= np.abs(wetR).max() + 1e-9
dry_peak = max(np.abs(L).max(), np.abs(R).max())
L = L + wetL * dry_peak * 0.16
R = R + wetR * dry_peak * 0.16

# fade the tail with the picture and master to -1.5 dBFS peak
fade = 1 - np.clip((t - (T_END - 0.3)) / 0.5, 0, 1)
L *= fade
R *= fade
peak = max(np.abs(L).max(), np.abs(R).max())
g = 10 ** (-1.5 / 20) / peak
L *= g
R *= g
rms_db = 20 * np.log10(np.sqrt(np.mean((L ** 2 + R ** 2) / 2)) + 1e-12)
print(f"peak -1.5 dBFS, rms {rms_db:.1f} dBFS")

pcm = (np.stack([L, R], axis=1) * 32767).astype(np.int16)
with wave.open(sys.argv[1], "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
