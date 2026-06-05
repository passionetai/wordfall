"""Generate a calm, loopable menu-music track for Word Fall.

Distinct from the driving in-game loop: a slow neon chord pad (vi-IV-I-V in
A minor) with a gentle arpeggio sparkle on top. Each chord fades in/out
within its slot so the loop seam (and every chord change) sits at near-zero
amplitude — no clicks, seamless repeat.

16-bit PCM mono WAV at 22.05 kHz. ~8 s loop. Pure Python stdlib, seeded,
so re-running produces a byte-identical file.
"""

import math
import struct
import wave
from pathlib import Path

SR = 22050
CHORD_SECS = 2.0
# vi - IV - I - V in A minor, voiced in a warm mid register.
# Each chord: (bass_freq, [pad tone freqs])
CHORDS = [
    (110.00, [220.00, 261.63, 329.63]),   # Am  (A, C, E)
    (87.31,  [174.61, 220.00, 261.63]),   # F   (F, A, C)
    (130.81, [196.00, 261.63, 329.63]),   # C   (G, C, E voicing)
    (98.00,  [196.00, 246.94, 293.66]),   # G   (G, B, D)
]
TOTAL_SECS = CHORD_SECS * len(CHORDS)
N = int(SR * TOTAL_SECS)

samples = [0.0] * N


def chord_env(t_local):
    """Per-chord fade so slot boundaries (and the loop seam) are near zero."""
    a, r = 0.40, 0.55          # attack, release within the 2 s slot
    if t_local < a:
        return t_local / a
    if t_local > CHORD_SECS - r:
        return max(0.0, (CHORD_SECS - t_local) / r)
    return 1.0


def voice(freq, t):
    """Warm pad voice: fundamental + soft 2nd harmonic + tiny detune beat."""
    base = math.sin(2 * math.pi * freq * t)
    harm = 0.25 * math.sin(2 * math.pi * freq * 2 * t)
    detune = 0.18 * math.sin(2 * math.pi * (freq * 1.005) * t)
    return base + harm + detune


for i in range(N):
    t = i / SR
    slot = int(t // CHORD_SECS) % len(CHORDS)
    t_local = t - slot * CHORD_SECS
    bass_f, tones = CHORDS[slot]
    env = chord_env(t_local)

    # Pad: bass + chord tones
    s = 0.55 * math.sin(2 * math.pi * bass_f * t)        # sub
    for f in tones:
        s += 0.30 * voice(f, t)
    s *= env

    # Arpeggio sparkle: pluck one chord tone (octave up) every 0.5 s.
    step = 0.5
    idx = int(t_local // step)
    pluck_start = idx * step
    pt = t_local - pluck_start
    if idx < len(tones):
        decay = math.exp(-pt / 0.18)
        arp_f = tones[idx % len(tones)] * 2.0
        s += 0.16 * math.sin(2 * math.pi * arp_f * pt) * decay * env

    samples[i] = s

# Normalize to a gentle peak (menu music sits quietly; AudioManager
# applies its own volume on top).
peak = max(abs(s) for s in samples)
if peak > 0:
    gain = 0.55 / peak
    samples = [s * gain for s in samples]

out = Path(__file__).resolve().parent.parent / 'assets' / 'audio' / 'music-menu-loop.wav'
with wave.open(str(out), 'wb') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    for s in samples:
        v = int(max(-32767, min(32767, round(s * 32767))))
        w.writeframesraw(struct.pack('<h', v))

print(f'wrote {out}  ({N} samples, {N * 2} bytes audio, {TOTAL_SECS:.0f}s loop)')
