"""Generate a percussive typewriter-click SFX as a 16-bit PCM mono WAV.

The sound is built from three layered components, each with its own envelope:
  1. A high-frequency noise burst — the sharp paper/typebar impact (5–15ms).
  2. A damped sine at ~2.4kHz — the metallic typebar resonance (~30ms).
  3. A low damped sine at ~320Hz — the mechanical body thud (~30ms).

The total length is ~120ms, which is short enough not to smear during
rapid typing but long enough to feel weighty.
"""

import math
import random
import struct
import wave
from pathlib import Path

SR = 22050           # 22.05 kHz is plenty for a short click
DURATION = 0.12      # 120 ms
N = int(SR * DURATION)

random.seed(2026)    # deterministic so a re-run produces the same file

samples = [0.0] * N

for i in range(N):
    t = i / SR

    # --- 1) Sharp click: bandpassed-ish noise burst
    # Attack ramps in over 0.5ms (avoid DAC click), then 8ms exponential decay.
    if t < 0.0005:
        env_click = t / 0.0005
    else:
        env_click = math.exp(-(t - 0.0005) / 0.008)
    # Bias the noise toward high frequencies by mixing with a quick differentiator.
    # Trick: pick noise that alternates sign more often by sampling two values.
    n1 = random.random() * 2 - 1
    n2 = random.random() * 2 - 1
    noise_hi = (n1 - n2) * 0.5  # crude high-pass
    click = noise_hi * env_click * 0.85

    # --- 2) Metallic resonance: damped sine ~2400Hz, 4ms post-attack
    if t > 0.004:
        env_res = math.exp(-(t - 0.004) / 0.025)
        res = math.sin(2 * math.pi * 2400 * (t - 0.004)) * env_res * 0.38
    else:
        res = 0.0

    # --- 3) Body thud: short low damped sine for weight
    env_body = math.exp(-t / 0.030)
    body = math.sin(2 * math.pi * 320 * t) * env_body * 0.22

    samples[i] = click + res + body

# Normalize peak so we sit just under clipping, leaving a tiny bit of headroom.
peak = max(abs(s) for s in samples)
if peak > 0:
    gain = 0.88 / peak
    samples = [s * gain for s in samples]

# Soft 12ms fade-out so the cut at the end can't pop.
fade_n = int(SR * 0.012)
for i in range(fade_n):
    f = 1.0 - (i / fade_n)
    samples[N - fade_n + i] *= f

out = Path(__file__).resolve().parent.parent / 'assets' / 'audio' / 'sfx-type.wav'
with wave.open(str(out), 'wb') as w:
    w.setnchannels(1)
    w.setsampwidth(2)        # 16-bit
    w.setframerate(SR)
    for s in samples:
        v = int(max(-32767, min(32767, round(s * 32767))))
        w.writeframesraw(struct.pack('<h', v))

print(f'wrote {out}  ({N} samples, {N * 2} bytes audio)')
