# Word Fall

An arcade typing game. Words rain down — type the word you want to target,
and your cannon locks on and blasts it. Build combos, earn power-ups, and
push your WPM to the limit.

![Type. Lock. Blast.](https://img.shields.io/badge/built%20with-vanilla%20js-5af0ff)

## Features

- **Multi-word lock-on**: Press any letter — the cannon locks onto the lowest word that starts with it. Mistypes don't cost lives, only combo.
- **Combo & multiplier system**: Chain words for up to 6x score. Every 10-combo grants a random power-up.
- **Three game modes**:
  - **Classic** — Steady ramp, 5 lives. Go forever.
  - **Sprint** — 90 seconds, 3 lives. Max points per second.
  - **Hardcore** — One life. No mercy.
- **Power-ups**: Freeze (slow time), Bomb (clear the screen), Shield (absorb one miss). Hotkeys `F` `B` `S`.
- **Persistent high scores** (high score, best WPM, best combo) — saved to localStorage.
- **Procedural audio** — no external assets, everything is synthesized via WebAudio.
- **Juicy feedback** — particle bursts, screen shake, color flashes, danger pulses on words about to crash.
- **Difficulty curve** — Longer/harder words unlock as you level up; spawn rate ramps; per-word fall speed scales.
- **Adaptive HUD** — Live score, level, combo, multiplier, WPM, lives.

## Controls

| Key            | Action                                       |
|----------------|----------------------------------------------|
| `a`–`z`        | Type to lock and shoot words                 |
| `Backspace`    | Drop current lock (re-target)                |
| `F` / `B` / `S`| Use Freeze / Bomb / Shield power-up          |
| `Esc`          | Pause / Resume                               |
| `Enter`        | Start / Restart from menu or game over       |

## Run it

No build step — pure HTML/JS/Canvas.

```bash
# any static server works
python3 -m http.server 8000
# then open http://localhost:8000
```

Or just open `index.html` directly in a modern browser.

## How scoring works

- Base = `10 × word length`
- Multiplied by `1 + combo × 0.1` (capped at 6x)
- Miss → combo resets to 0
- Mistype → small combo penalty, no life lost
- Every 10 combo → random power-up (`freeze` → `bomb` → `shield`, rotating)

## Tech

Pure HTML5 Canvas 2D + vanilla JS. No frameworks, no dependencies, no asset
files. ~600 lines of game code.

## License

MIT
