# Word Fall

An arcade typing game. Words rain down on a neon city. Type a word to lock
your cannon onto it and blast it before it hits the floor. Build combos,
earn power-ups, and survive a boss every five levels.

![Type. Lock. Blast.](https://img.shields.io/badge/built%20with-vanilla%20js-5af0ff)

## Game modes

Pick a mode on the menu with the arrow keys (or tap it) and press `Enter`.

| Mode         | Rules |
|--------------|-------|
| **Classic**  | 5 lives, endless. Difficulty ramps as you level up. |
| **Sprint**   | 90 seconds, 3 lives. Score as much as you can before the clock runs out. |
| **Hardcore** | One life. No mercy. |
| **Daily**    | One run per day. Everyone gets the same seeded word sequence for the date, so scores are comparable. Tracks your daily streak and recent results, and shows a countdown to the next daily. |
| **Versus**   | Duel a CPU bot. Choose **Rookie** (~20 WPM), **Rival** (~45 WPM) or **Nemesis** (~80 WPM). Defend by typing words before they hit your shield, and attack by typing words from your rack (bottom-left) to fling them at the bot. Each side has 4 lives; combos make your attacks fly faster. |

## How to play

- **Lock on**: type any letter and the cannon locks onto the lowest word that
  starts with it. Finish the word to destroy it. `Backspace` drops the lock.
- **Word types**:
  - **Normal**: the bread and butter.
  - **Bonus** (gold): worth 3x and grants a power-up.
  - **Twin** (green): a linked pair. Type both quickly for a pair bonus.
  - **Decoy** (struck through): bait. Typing it breaks your combo; letting it fall costs nothing.
  - **Bomb** (red): type it for +50, but if it reaches the floor the run ends instantly, whatever your lives.
  - **Boss**: every 5th level a boss word descends after a warning. Beat it
    for +1000 and two power-ups; if it escapes you lose 2 lives. Each boss clears
    an **act**, and the city re-skins (Neon City, Violet Dusk, Ember Wastes,
    Toxic Grid, Crimson Core, Glitch Void).
- **Achievements** unlock as you play, and lifetime stats are kept in the browser.

### Scoring

- Base points = `10 × word length`, times the word type's multiplier.
- Multiplied by your combo multiplier: `1 + combo × 0.1`, capped at **6x**.
- Letting a normal word hit the floor costs a life and resets the combo.

## Power-ups

You earn a power-up every **10 combo** (rotating Freeze, Bomb, Shield), and
from gold bonus words (one each) and boss kills (two each).

| Power-up   | Key         | Effect |
|------------|-------------|--------|
| **Freeze** | `Shift`+`F` | Slows falling words to quarter speed for 18 seconds. |
| **Bomb**   | `Shift`+`B` | Clears every word on screen (except a boss) and scores them. |
| **Shield** | `Shift`+`S` | 25-second shield that absorbs the next miss. |

Power-ups need `Shift` so plain `f`, `b` and `s` always go to typing. On touch
devices, tap the power-up icons instead. Versus uses Freeze and Shield only.

## Controls

| Input              | Action |
|--------------------|--------|
| `a`–`z`            | Type to lock onto and shoot words |
| `Backspace`        | Drop the current lock |
| `Shift`+`F` / `B` / `S` | Use Freeze / Bomb / Shield |
| `Esc`              | Pause menu (in Versus, forfeits the match) |
| `←` `→`            | Choose a mode on the menu |
| `Enter`            | Start / restart |

On phones and tablets the game shows its own on-screen keyboard and power-up
row, so it is fully playable by touch.

## Settings

The gear icon opens settings: music and SFX volume, music/SFX toggles,
Reduce Motion, Show FPS, Colorblind Mode, and a button to reset lifetime stats.

### Optional: AI word generation (DeepSeek key)

Out of the box the game uses its built-in word lists (484 words across five
difficulty tiers, plus a separate boss list). If you paste a
[DeepSeek API key](https://platform.deepseek.com/api_keys) into
**Settings → DeepSeek API Key**, DeepSeek also generates fresh words for
regular play, bosses and Versus, scaled to your level. Built-in words are
still mixed in, so the game keeps working if the API is slow or rate-limited.

- The key is stored only in your browser's localStorage and sent only to
  `api.deepseek.com`.
- **Daily mode ignores the key**, so every player gets the same words.

## Run it locally

No build step and no dependencies. It is plain HTML, CSS and JavaScript on a
canvas. Serve the repo root with any static server:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Use a server rather than opening `index.html` from disk, so the audio/image
assets and the service worker load properly.

The game is also an installable PWA: `manifest.json` and `sw.js` let you add it
to your home screen and play offline. When a new version is deployed, the page
shows an update toast.

## Project layout

```
index.html        Page markup: menu, overlays, settings
styles.css        All styling
game.js           The whole game (modes, words, bosses, Versus, audio, rendering)
manifest.json     PWA manifest
sw.js             Service worker (offline cache, network-first for code)
assets/
  audio/          Music loops and sound effects (mp3/wav)
  icons/          App icons and power-up icons
  img/            Skyline background, cannon, logo, boss warning, share card
  vfx/            Particle sprites (sparks, shards, chain link)
tools/            Tests and asset generators (see below)
```

If an audio file fails to load, the game falls back to synthesized WebAudio
sounds.

## Tests and tools

Everything in `tools/` runs with Node from the repo root.

| Command | What it checks |
|---------|----------------|
| `node tools/smoke.cjs` | Loads all of `game.js` against a fake browser and fails on any startup error (syntax errors, bad top-level code). Fast, no browser needed. |
| `node tools/check-words.mjs` | Word-list integrity: no duplicates, no overlap with boss words, every word the right length for its tier. |
| `node tools/e2e.cjs [baseUrl] [screenshotDir]` | Full browser run in Chromium via Playwright: splash, menu, mode navigation, typing real words, combo, pause, game over. Fails on any page or console error and saves screenshots. |

For the end-to-end test, start the local server first, and have Playwright
installed (`npm i -g playwright`):

```bash
python3 -m http.server 8000 &
node tools/e2e.cjs http://localhost:8000 ./e2e-shots
```

Set `PW_CHROMIUM=/path/to/chromium` to use a specific Chromium build. The test
opens the page with `?debug`, which exposes the game state as `window.__wf`.

Two Python scripts regenerate audio deterministically (standard library only):

- `python3 tools/synth-typewriter.py` creates the typewriter key click.
- `python3 tools/synth-menu-music.py` creates the menu music loop.

## License

MIT
