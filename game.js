/* Word Fall — Step 3
   Adds word types (normal / bomb / bonus / twin / decoy / boss) + boss waves
   every 5th level. Visual identity from Steps 1 & 2 preserved. */

(() => {
'use strict';

// Surface any uncaught error to the console so we can actually debug
// "nothing works" reports instead of guessing.
window.addEventListener('error', (e) => {
    console.error('Word Fall uncaught error:', e.message, 'at', e.filename + ':' + e.lineno, e.error);
});
window.addEventListener('unhandledrejection', (e) => {
    console.error('Word Fall unhandled rejection:', e.reason);
});

// ╔══════════════════════════════════════════════════════════════╗
// ║  MODULE: Data — Word lists, boss vocabulary, achievements  ║
// ╚══════════════════════════════════════════════════════════════╝

// ---------- Word lists ----------
const WORDS = {
    tier1: ('the and you for are but not all can had has was one our out his her she him who why how new old now use way day man men two big bad red sun sky run cat dog fly jam ice tea pen ink art mix box top map key bus car egg cup bag fox owl bee ant cow pig').split(' '),
    tier2: ('time year work life hand part case week point fact game node hero star moon wave fire rain snow leaf rose lake river beach plant cloud light dream brave quick smart proud noisy quiet sharp brick stone metal glass pearl crown sword frost storm flame ember').split(' '),
    tier3: ('window forest planet rocket dragon castle silver galaxy thunder breeze stream meadow valley summit ridge crystal harbor temple wonder garden orchid wizard pirate phantom blossom whisper ranger archer falcon comet aurora cosmos legend').split(' '),
    tier4: ('mountain elephant dinosaur sunshine universe rainbow penguin octopus monarch volcano harvest mystery library journey horizon adventure paradise melody victory infinite gravity magnetic absolute hurricane wilderness lighthouse').split(' '),
    // Note: tier5 is regular-game vocabulary only — boss-reserved words
    // (kaleidoscope, thunderstorm, constellation, etc.) live exclusively in
    // BOSS_WORDS so they can't appear as regular falling words.
    tier5: ('astronaut revolutionary labyrinthine extraordinary independence bewildering philosophical antagonist illuminate accelerate distinguish fascinating championship controversial contemporary perspective artificial appropriate').split(' '),
};

function poolForLevel(level) {
    const idx = Math.min(level - 1, 8);
    const tiers = [];
    if (idx >= 0) tiers.push(WORDS.tier1, WORDS.tier2);
    if (idx >= 1) tiers.push(WORDS.tier3);
    if (idx >= 3) tiers.push(WORDS.tier4);
    if (idx >= 5) tiers.push(WORDS.tier5);
    if (idx >= 4) tiers.shift();
    return tiers.flat();
}

// ---------- Boss vocabulary (10–15 letters) ----------
const BOSS_WORDS = [
    'annihilation','obliteration','indestructible','electromagnetic','abomination',
    'deconstruct','kaleidoscope','thunderstorm','choreography','constellation',
    'metamorphosis','reverberation','incandescent','juxtaposition','perpendicular',
    'quicksilver','unfathomable','encyclopedia','hemisphere','catastrophe',
    'devastation','magnificent','microscopic','transcendent','phenomenal',
    'revolution','domination','deliverance','masterpiece','turbulence',
    'mischievous','paranormal','motivation','innovation',
];

// ╔══════════════════════════════════════════════════════════════╗
// ║  MODULE: DeepSeek — AI word generation (optional)          ║
// ╚══════════════════════════════════════════════════════════════╝

// ---------- DeepSeek integration (optional, per-user API key) ----------
// API key lives in localStorage — never in source. Two parallel pools:
//   game — regular falling words (4-12 letters, mid-difficulty prompt)
//   boss — boss vocabulary (10-22 letters, harder prompt scaled by level)
// Both refill independently in the background; each call site pulls from
// the appropriate pool with seamless fallback to local lists.
const DeepSeek = (() => {
    const KEY_STORAGE = LS_DEEPSEEK_KEY;
    const URL = 'https://api.deepseek.com/v1/chat/completions';
    const pools = { game: [], boss: [] };
    const fetching = { game: false, boss: false };
    // Targets above which we don't bother refilling.
    const POOL_CAPS = { game: 12, boss: 6 };
    // Refill threshold — drop below this and we kick a background refill.
    const POOL_LOW  = { game: 5,  boss: 3 };
    // Batch size per fetch.
    const BATCH     = { game: 10, boss: 6 };

    function getKey() {
        try { return (localStorage.getItem(KEY_STORAGE) || '').trim(); }
        catch (e) { return ''; }
    }
    function setKey(k) {
        try {
            if (k && k.trim()) localStorage.setItem(KEY_STORAGE, k.trim());
            else localStorage.removeItem(KEY_STORAGE);
        } catch (e) {}
        // Reset both pools on key change.
        pools.game = []; pools.boss = [];
    }
    function hasKey() { return !!getKey(); }
    function poolSize(which) { return which ? (pools[which] || []).length : pools.game.length + pools.boss.length; }

    function difficultyFor(which, level) {
        if (which === 'boss') {
            const minLen = Math.min(16, 10 + Math.floor((level - 5) / 2));
            const maxLen = Math.min(22, minLen + 5);
            const temp   = Math.min(1.0, 0.55 + level * 0.025);
            return { minLen, maxLen, temp };
        }
        // Regular gameplay words — grow with level but stay typeable.
        const minLen = Math.max(3, 3 + Math.floor(Math.max(0, level - 1) / 2));
        const maxLen = Math.min(11, Math.max(6, minLen + 4));
        const temp   = 0.7;
        return { minLen, maxLen, temp };
    }

    function promptFor(which, level, count, minLen, maxLen) {
        if (which === 'boss') {
            return `Return ${count} interesting, real, single-token English words, each ` +
                   `${minLen}–${maxLen} letters long, lowercase, no spaces, no hyphens, ` +
                   `no proper nouns, no offensive words. Words should feel suitable as ` +
                   `final-boss vocabulary in a typing game at difficulty ${level}/30.`;
        }
        return `Return ${count} varied, real, single-token English words, each ` +
               `${minLen}–${maxLen} letters long, lowercase, no spaces, no hyphens, ` +
               `no proper nouns, no offensive words. Mix everyday nouns, verbs, and ` +
               `descriptive adjectives. Words should feel suitable for typing in a ` +
               `casual word game at level ${level}.`;
    }

    async function fetchBatch(which, level, count) {
        const key = getKey();
        if (!key || fetching[which]) return null;
        fetching[which] = true;
        const { minLen, maxLen, temp } = difficultyFor(which, level);
        try {
            const res = await fetch(URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + key,
                },
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    messages: [
                        {
                            role: 'system',
                            content:
                                'You generate single English words for a typing game called Word Fall. ' +
                                'You respond with ONLY a valid JSON object {"words": [string, ...]} — ' +
                                'no markdown, no commentary, no code fences.',
                        },
                        { role: 'user', content: promptFor(which, level, count, minLen, maxLen) },
                    ],
                    response_format: { type: 'json_object' },
                    temperature: temp,
                    max_tokens: which === 'boss' ? 240 : 360,
                }),
            });
            if (!res.ok) {
                console.warn('Word Fall DeepSeek HTTP', res.status, await res.text().catch(() => ''));
                return null;
            }
            const data = await res.json();
            const content = data && data.choices && data.choices[0] && data.choices[0].message
                ? data.choices[0].message.content
                : null;
            if (!content) return null;
            let parsed;
            try { parsed = JSON.parse(content); }
            catch (e) {
                const m = content.match(/\{[\s\S]*\}/);
                if (!m) return null;
                parsed = JSON.parse(m[0]);
            }
            const words = Array.isArray(parsed.words) ? parsed.words : [];
            const clean = words
                .map(w => String(w || '').toLowerCase().trim())
                .filter(w => w.length >= minLen && w.length <= maxLen + 2)
                .filter(w => /^[a-z]+$/.test(w));
            return clean.length ? clean : null;
        } catch (e) {
            console.warn('Word Fall: DeepSeek ' + which + ' fetch failed', e);
            return null;
        } finally {
            fetching[which] = false;
        }
    }

    async function refill(level, which) {
        which = which || 'boss';
        if (!hasKey() || pools[which].length >= POOL_LOW[which] || fetching[which]) return;
        const fresh = await fetchBatch(which, level, BATCH[which]);
        if (fresh) {
            pools[which].push(...fresh);
            if (pools[which].length > POOL_CAPS[which]) pools[which].length = POOL_CAPS[which];
        }
    }
    function take(which) {
        which = which || 'boss';
        return pools[which].length ? pools[which].shift() : null;
    }

    // Warm both pools at once — boss aims at game.level (with a floor at 5
    // so the first boss has fitting vocab), game uses the same level.
    // Both refills short-circuit if the pool is already topped up.
    function warmAll(level) {
        const l = level || 1;
        refill(Math.max(5, l), 'boss').catch(() => {});
        refill(Math.max(1, l), 'game').catch(() => {});
    }

    return { getKey, setKey, hasKey, poolSize, refill, take, warmAll };
})();

// ---------- Word type spawn weights by level ----------
function typeWeightsForLevel(level) {
    if (level <= 2)  return { normal: 1.00 };
    if (level <= 4)  return { normal: 0.90, bonus: 0.10 };
    if (level <= 7)  return { normal: 0.75, bonus: 0.10, bomb: 0.10, decoy: 0.05 };
    if (level <= 10) return { normal: 0.60, bonus: 0.10, bomb: 0.15, twin: 0.10, decoy: 0.05 };
    return              { normal: 0.50, bonus: 0.10, bomb: 0.20, twin: 0.15, decoy: 0.05 };
}

function isBossLevel(level) { return level > 0 && level % 5 === 0; }

// ---------- Asset preloader ----------
const Assets = {
    logo: null, bgSkyline: null, cannon: null,
    sparkCyan: null, sparkMagenta: null,
    iconFreeze: null, iconBomb: null, iconShield: null,
    chainLink: null, bossWarning: null, shardNeon: null,
    shareCardBg: null,
    iconSettings: null,
};
const ASSET_MANIFEST = {
    logo:         'assets/img/logo-wordmark.png',
    bgSkyline:    'assets/img/bg-skyline.png',
    cannon:       'assets/img/cannon-typewriter.png',
    sparkCyan:    'assets/vfx/spark-cyan.png',
    sparkMagenta: 'assets/vfx/spark-magenta.png',
    iconFreeze:   'assets/icons/icon-freeze.png',
    iconBomb:     'assets/icons/icon-bomb.png',
    iconShield:   'assets/icons/icon-shield.png',
    chainLink:    'assets/vfx/chain-link.png',
    bossWarning:  'assets/img/boss-warning.png',
    shardNeon:    'assets/vfx/shard-neon.png',
    shareCardBg:  'assets/img/share-card-bg.png',
    iconSettings: 'assets/icons/icon-settings.png',
};
const PU_ICON = { freeze: 'iconFreeze', bomb: 'iconBomb', shield: 'iconShield' };

function preloadAssets(onComplete) {
    const keys = Object.keys(ASSET_MANIFEST);
    let done = 0;
    const tick = () => { if (++done >= keys.length) onComplete(); };
    keys.forEach(key => {
        const img = new Image();
        img.onload  = () => { Assets[key] = img; tick(); };
        img.onerror = () => {
            Assets[key] = null;
            console.warn('Word Fall: failed to load asset', key, '→', ASSET_MANIFEST[key]);
            tick();
        };
        img.src = ASSET_MANIFEST[key];
    });
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  MODULE: Audio — Procedural WebAudio sounds                ║
// ╚══════════════════════════════════════════════════════════════╝

// ---------- Audio (procedural) ----------
const Audio = (() => {
    let ctx = null, master = null, muted = false;
    function ensure() {
        if (ctx) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.35;
        master.connect(ctx.destination);
    }
    // Respect Settings toggles so procedural audio obeys the same
    // SFX On/Off and volume sliders as the sample-based AudioManager.
    function settingsSfxOff() {
        return typeof Settings !== 'undefined' && Settings.values && !Settings.values.sfxOn;
    }
    function settingsVolScale() {
        if (typeof Settings === 'undefined' || !Settings.values) return 1;
        return Settings.values.sfxVol / 100;
    }

    function tone(freq, dur, type = 'sine', vol = 0.3, sweepTo = null, startOfs = 0) {
        if (muted || settingsSfxOff()) return; ensure(); if (!ctx) return;
        vol *= settingsVolScale();
        const t0 = ctx.currentTime + startOfs;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, t0);
        if (sweepTo != null) o.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(vol, t0 + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g).connect(master);
        o.start(t0); o.stop(t0 + dur + 0.02);
    }
    function noise(dur, vol = 0.3, lp = 1000, startOfs = 0) {
        if (muted || settingsSfxOff()) return; ensure(); if (!ctx) return;
        vol *= settingsVolScale();
        const t0 = ctx.currentTime + startOfs;
        const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const filt = ctx.createBiquadFilter();
        filt.type = 'lowpass'; filt.frequency.value = lp;
        const g = ctx.createGain();
        g.gain.setValueAtTime(vol, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.connect(filt).connect(g).connect(master);
        src.start(t0); src.stop(t0 + dur);
    }
    return {
        resume() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
        keyHit(progress) { tone(520 + progress * 380, 0.06, 'square', 0.18); },
        wordComplete(combo) {
            const base = 660 + Math.min(combo, 20) * 12;
            tone(base, 0.18, 'triangle', 0.3, base * 1.8);
            tone(base * 1.5, 0.12, 'sine', 0.15, base * 2.4);
        },
        miss() { tone(220, 0.25, 'sawtooth', 0.3, 80); noise(0.18, 0.18, 600); },
        gameOver() {
            tone(440, 0.25, 'sawtooth', 0.3, 120);
            setTimeout(() => tone(330, 0.3, 'sawtooth', 0.3, 80), 120);
            setTimeout(() => tone(220, 0.45, 'sawtooth', 0.35, 50), 280);
        },
        levelUp() {
            [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.12, 'triangle', 0.25), i * 70));
        },
        powerup(type) {
            if (type === 'freeze') { tone(880, 0.4, 'sine', 0.25, 220); noise(0.3, 0.08, 400); }
            else if (type === 'bomb') { tone(120, 0.5, 'sawtooth', 0.4, 40); noise(0.4, 0.3, 2000); }
            else if (type === 'shield') { tone(440, 0.15, 'sine', 0.2); tone(660, 0.2, 'sine', 0.2); }
        },
        lockOn() { tone(880, 0.04, 'square', 0.12); },
        // --- Step 3 additions ---
        bombHit() {
            // Deeper / more aggressive than wordComplete
            tone(180, 0.22, 'sawtooth', 0.32, 70);
            tone(360, 0.18, 'square',   0.18, 120);
            noise(0.12, 0.22, 1200);
        },
        bombDetonate() {
            tone(80, 0.7, 'sawtooth', 0.45, 30);
            noise(0.65, 0.5, 2200);
            setTimeout(() => tone(50, 0.5, 'sawtooth', 0.3, 25), 80);
        },
        bonusComplete() {
            const seq = [880, 1175, 1568, 1976, 2349];
            seq.forEach((f, i) => setTimeout(() => tone(f, 0.10, 'sine', 0.22), i * 55));
        },
        twinFreeze() {
            tone(660, 0.18, 'sine', 0.22, 440);
            setTimeout(() => tone(440, 0.25, 'sine', 0.18, 330), 100);
            setTimeout(() => tone(330, 0.32, 'sine', 0.14, 220), 220);
        },
        bossWarning() {
            // 2-second descending warning tone
            tone(440, 0.45, 'sawtooth', 0.32, 110, 0.00);
            tone(330, 0.45, 'sawtooth', 0.32, 90,  0.50);
            tone(220, 0.45, 'sawtooth', 0.32, 70,  1.00);
            tone(165, 0.55, 'sawtooth', 0.34, 60,  1.50);
            noise(2.0, 0.10, 800);
        },
        bossLetterShatter() {
            noise(0.18, 0.28, 6000);
            tone(1800, 0.08, 'square', 0.12, 900);
            tone(2400, 0.06, 'square', 0.10, 1400);
        },
        bossDefeated() {
            const seq = [392, 494, 587, 740, 988, 1175, 1568];
            seq.forEach((f, i) => setTimeout(() => tone(f, 0.14, 'triangle', 0.3, f * 1.5), i * 70));
            setTimeout(() => tone(1976, 0.45, 'triangle', 0.32, 2640), seq.length * 70);
            noise(0.5, 0.18, 2500);
        },
        achievement() {
            // Bright triumphant chime for achievement unlocks
            tone(880, 0.10, 'triangle', 0.26, 1320);
            setTimeout(() => tone(1320, 0.10, 'triangle', 0.24, 1760), 70);
            setTimeout(() => tone(1760, 0.18, 'sine',     0.22, 2640), 140);
            setTimeout(() => tone(2349, 0.30, 'sine',     0.18, 3520), 260);
        },
    };
})();

// ╔══════════════════════════════════════════════════════════════╗
// ║  MODULE: AudioManager — Sample-based SFX & music           ║
// ╚══════════════════════════════════════════════════════════════╝

// ---------- Audio Manager (Step 5) ----------
// Wraps the procedural Audio module from Step 1. Loads sampled SFX + a music
// loop. If any file fails to load, that sound silently falls back to the
// procedural beep. Music waits for the first user interaction (autoplay rule).
const SFX_MANIFEST = {
    // Locally-synthesised typewriter click (see tools/synth-typewriter.py).
    // Shorter / sharper than the original MP3 so rapid typing doesn't smear.
    type:           'assets/audio/sfx-type.wav',
    lock:           'assets/audio/sfx-lock.mp3',
    destroy:        'assets/audio/sfx-destroy.mp3',
    combo:          'assets/audio/sfx-combo.mp3',
    powerup:        'assets/audio/sfx-powerup.mp3',
    bomb:           'assets/audio/sfx-bomb.mp3',
    'boss-warning': 'assets/audio/sfx-boss-warning.mp3',
    'boss-defeat':  'assets/audio/sfx-boss-defeat.mp3',
};
const MUSIC_PATH = 'assets/audio/music-main-loop.mp3';   // in-game
const MENU_MUSIC_PATH = 'assets/audio/music-menu-loop.wav'; // home/menu

const AudioManager = (() => {
    const pools = {};        // name → [Audio, Audio, Audio]
    const failed = {};       // name → true
    let nextIdx = {};
    // Two music beds: a calm 'menu' loop and the driving 'game' loop.
    const musicEls = { menu: null, game: null };
    const musicFailedMap = { menu: false, game: false };
    let activeMusic = 'menu';
    let musicStarted = false;
    let musicEnabled = true;
    let sfxEnabled = true;
    let musicVol = 0.4;      // current target volume
    let sfxVol = 0.6;
    let baseMusicVol = 0.4;  // pre-duck level
    let duckEndAt = 0;       // timestamp until which music is ducked
    let totalAssets = Object.keys(SFX_MANIFEST).length + 2; // sfx + 2 music beds
    let loadedAssets = 0;
    let onProgress = null;
    let onReady = null;

    function currentEl() { return musicEls[activeMusic]; }
    function currentFailed() { return musicFailedMap[activeMusic]; }

    function preload(opts = {}) {
        onProgress = opts.onProgress || null;
        onReady    = opts.onReady    || null;
        Object.keys(SFX_MANIFEST).forEach(name => {
            pools[name] = [];
            nextIdx[name] = 0;
            const src = SFX_MANIFEST[name];
            const probe = new window.Audio();
            probe.preload = 'auto';
            probe.src = src;
            let settled = false;
            const settle = (ok) => {
                if (settled) return;
                settled = true;
                if (ok) {
                    pools[name].push(probe);
                    for (let i = 1; i < 3; i++) {
                        const c = new window.Audio();
                        c.preload = 'auto';
                        c.src = src;
                        pools[name].push(c);
                    }
                } else {
                    failed[name] = true;
                    console.warn('Word Fall: SFX timed out / failed', name, src);
                }
                bumpAsset();
            };
            // Use loadeddata + canplay (more reliable than canplaythrough,
            // which Chrome often won't fire before audio context unlocks).
            probe.addEventListener('loadeddata', () => settle(true), { once: true });
            probe.addEventListener('canplay',    () => settle(true), { once: true });
            probe.addEventListener('error',      () => settle(false), { once: true });
            // Safety: if neither fires within 2.5s, assume the file is
            // reachable (browser is just being lazy) and move on. SFX still
            // plays when needed; we just stop blocking the boot bar.
            setTimeout(() => settle(true), 2500);
            try { probe.load(); } catch (e) { settle(false); }
        });
        // Two music beds (menu + game)
        const loadBed = (which, src) => {
            const el = new window.Audio();
            el.preload = 'auto';
            el.loop = true;
            el.src = src;
            el.volume = musicVol;
            musicEls[which] = el;
            let settled = false;
            const settle = (ok) => {
                if (settled) return;
                settled = true;
                if (!ok) { musicFailedMap[which] = true; console.warn('Word Fall: music failed', src); }
                bumpAsset();
            };
            el.addEventListener('loadeddata', () => settle(true), { once: true });
            el.addEventListener('canplay',    () => settle(true), { once: true });
            el.addEventListener('error',      () => settle(false), { once: true });
            setTimeout(() => settle(true), 3500);
            try { el.load(); } catch (e) { settle(false); }
        };
        loadBed('menu', MENU_MUSIC_PATH);
        loadBed('game', MUSIC_PATH);
    }

    function bumpAsset() {
        loadedAssets++;
        if (onProgress) onProgress(loadedAssets, totalAssets);
        if (loadedAssets >= totalAssets && onReady) {
            const cb = onReady; onReady = null; cb();
        }
    }

    function playSFX(name, fallbackFn, opts = {}) {
        if (!sfxEnabled) return;
        if (failed[name] || !pools[name] || !pools[name].length) {
            if (typeof fallbackFn === 'function') { try { fallbackFn(); } catch (e) {} }
            return;
        }
        const pool = pools[name];
        const a = pool[nextIdx[name]];
        nextIdx[name] = (nextIdx[name] + 1) % pool.length;
        try {
            a.pause();
            a.currentTime = 0;
            a.volume = sfxVol * (opts.volume != null ? opts.volume : 1);
            if (opts.playbackRate != null) a.playbackRate = opts.playbackRate;
            else a.playbackRate = 1;
            const p = a.play();
            if (p && p.catch) p.catch(() => {});
        } catch (e) { /* swallow */ }
    }

    function playMusic() {
        if (!musicEnabled) return;
        const el = currentEl();
        if (currentFailed() || !el) return;
        el.volume = duckEndAt > performance.now() ? baseMusicVol * 0.3 : baseMusicVol;
        const p = el.play();
        if (p && p.catch) p.catch(() => {});
        musicStarted = true;
    }
    function pauseMusic() {
        // Pause whichever beds may be playing.
        Object.values(musicEls).forEach(el => { if (el) { try { el.pause(); } catch (e) {} } });
    }
    function resumeMusic() {
        if (!musicEnabled) return;
        playMusic();
    }
    // Switch which bed is the active music. Pauses the other and (if music
    // has already been unlocked by a user gesture) starts the new one.
    function setActiveMusic(which) {
        if (which !== 'menu' && which !== 'game') return;
        if (which === activeMusic) {
            // Same bed — just make sure it's playing if it should be.
            if (musicStarted && musicEnabled) playMusic();
            return;
        }
        const prev = musicEls[activeMusic];
        if (prev) { try { prev.pause(); prev.currentTime = 0; } catch (e) {} }
        activeMusic = which;
        if (musicStarted && musicEnabled) playMusic();
    }
    function setMusicVolume(v) {
        musicVol = Math.max(0, Math.min(1, v));
        baseMusicVol = musicVol;
        const vol = duckEndAt > performance.now() ? musicVol * 0.3 : musicVol;
        Object.values(musicEls).forEach(el => { if (el) el.volume = vol; });
    }
    function setSFXVolume(v) {
        sfxVol = Math.max(0, Math.min(1, v));
    }
    function setMusicEnabled(on) {
        musicEnabled = !!on;
        if (!musicEnabled) pauseMusic();
        else if (musicStarted) resumeMusic();
    }
    function setSFXEnabled(on) {
        sfxEnabled = !!on;
    }
    function duck(ms = 2000, factor = 0.3) {
        duckEndAt = performance.now() + ms;
        const el = currentEl();
        if (el) el.volume = baseMusicVol * factor;
        setTimeout(() => {
            if (performance.now() >= duckEndAt - 16 && currentEl()) currentEl().volume = baseMusicVol;
        }, ms);
    }
    function isReady() { return loadedAssets >= totalAssets; }
    function progress() { return totalAssets > 0 ? loadedAssets / totalAssets : 0; }
    function musicAvailable() { return !currentFailed() && !!currentEl(); }

    return {
        preload,
        playSFX,
        playMusic, pauseMusic, resumeMusic, setActiveMusic,
        setMusicVolume, setSFXVolume,
        setMusicEnabled, setSFXEnabled,
        duck,
        isReady, progress,
        musicAvailable,
        _isStarted() { return musicStarted; },
    };
})();

// ---------- PRNG + daily seed ----------
let DAILY_RNG = null; // function () -> [0, 1); active only in daily mode

function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function cyrb53(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return ((h1 ^ h2) >>> 0);
}
function todayKey() {
    const d = new Date();
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}
function dailySeedToday() { return cyrb53('wordfall-daily-' + todayKey()); }

function rng() {
    return DAILY_RNG ? DAILY_RNG() : Math.random();
}
function rngInt(n) { return (rng() * n) | 0; }

// ---------- Lifetime stats ----------
const LIFETIME_DEFAULTS = {
    gamesPlayed: 0,
    totalWordsDestroyed: 0,
    totalBossesDefeated: 0,
    totalBombsDefused: 0,
    totalDailyCompleted: 0,
    totalTimePlayedSeconds: 0,
    bestScoreClassic: 0,
    bestScoreSprint: 0,
    bestScoreHardcore: 0,
    bestScoreDaily: 0,
    bestWPM: 0,
    bestCombo: 0,
};
function loadLifetime() {
    try {
        const raw = localStorage.getItem(LS_LIFETIME_STATS);
        if (!raw) return { ...LIFETIME_DEFAULTS };
        return Object.assign({ ...LIFETIME_DEFAULTS }, JSON.parse(raw));
    } catch (e) { return { ...LIFETIME_DEFAULTS }; }
}
function saveLifetime(stats) {
    try { localStorage.setItem(LS_LIFETIME_STATS, JSON.stringify(stats)); } catch (e) {}
}

// ---------- Achievements ----------
const ACHIEVEMENTS = [
    { id: 'first_word',  name: 'First Strike',   description: 'Destroy your first word.',         icon: '\u{1F947}' },
    { id: 'combo_25',    name: 'Combo King',     description: 'Reach 25-combo in a single run.',  icon: '\u{1F525}' },
    { id: 'score_10k',   name: 'Centurion',      description: 'Score 10,000 in one game.',        icon: '\u{1F4AF}' },
    { id: 'boss_slayer', name: 'Boss Slayer',    description: 'Defeat your first boss.',          icon: '\u{1F479}' },
    { id: 'bomb_10',     name: 'Bomb Defuser',   description: 'Type 10 bomb words successfully.', icon: '\u{1F4A3}' },
    { id: 'daily_7',     name: 'Daily Devotee',  description: 'Complete 7 daily challenges.',     icon: '\u{1F4C5}' },
    { id: 'wpm_60',      name: 'Speed Demon',    description: 'Hit 60+ WPM in a game.',           icon: '\u{26A1}' },
    { id: 'words_1000',  name: 'Word Master',    description: 'Destroy 1000 words lifetime.',     icon: '\u{1F3C6}' },
];
function loadAchievementsState() {
    try {
        const raw = localStorage.getItem(LS_ACHIEVEMENTS);
        if (!raw) return {};
        return JSON.parse(raw);
    } catch (e) { return {}; }
}
function saveAchievementsState(map) {
    try { localStorage.setItem(LS_ACHIEVEMENTS, JSON.stringify(map)); } catch (e) {}
}
const _achQueue = [];
function unlockAchievement(id) {
    const map = loadAchievementsState();
    if (map[id] && map[id].unlocked) return false;
    map[id] = { unlocked: true, unlockedAt: Date.now() };
    saveAchievementsState(map);
    const def = ACHIEVEMENTS.find(a => a.id === id);
    if (def) _achQueue.push(def);
    pumpAchievementToast();
    return true;
}
let _achToastActive = false;
function pumpAchievementToast() {
    if (_achToastActive) return;
    const next = _achQueue.shift();
    if (!next) return;
    _achToastActive = true;
    const el = document.getElementById('ach-toast');
    el.innerHTML =
        `<div class="ach-icon">${next.icon}</div>` +
        `<div class="ach-text">` +
        `<div class="ach-meta">Achievement Unlocked</div>` +
        `<div class="ach-name">${escapeHtml(next.name)}</div>` +
        `<div class="ach-desc">${escapeHtml(next.description)}</div>` +
        `</div>`;
    requestAnimationFrame(() => el.classList.add('show'));
    Audio.achievement();
    setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => { _achToastActive = false; pumpAchievementToast(); }, 350);
    }, 4000);
}

// ---------- Daily storage ----------
function dailyKey(dateStr) { return 'wordfall_daily_' + dateStr; }
function getDailyResult(dateStr = todayKey()) {
    try {
        const raw = localStorage.getItem(dailyKey(dateStr));
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (e) { return null; }
}
function saveDailyResult(result) {
    try { localStorage.setItem(dailyKey(result.date), JSON.stringify(result)); } catch (e) {}
}
function last7DailyScores() {
    const out = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
        const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
        const r = getDailyResult(k);
        out.push(r ? r.score : null);
    }
    return out;
}
function msUntilNextUTCMidnight() {
    const now = new Date();
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0);
    return Math.max(0, next - now.getTime());
}
function formatHMS(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(h)}h ${pad(m)}m ${pad(sec)}s`;
}

// ---------- Touch detection ----------
const IS_TOUCH = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
let DEBUG_FORCE_TOUCH = false; // set window.WORDFALL_FORCE_TOUCH = true to enable
const isTouchActive = () => IS_TOUCH || DEBUG_FORCE_TOUCH || window.WORDFALL_FORCE_TOUCH === true;

// ---------- Game state ----------
const TOP_HUD_H = 60;
const BOTTOM_HUD_H = 90;
const FLOOR_OFFSET_FROM_BOTTOM = 60;
const TOUCH_KB_H = 168;     // 3 rows × ~50 + gaps
const TOUCH_PU_H = 88;      // touch power-up row

// Effective offset from the canvas bottom to the "floor" word-crash line.
// In touch mode we lift the floor above the on-screen keyboard so falling
// words can't sit underneath the keys.
function floorOffset() {
    return FLOOR_OFFSET_FROM_BOTTOM + (isTouchActive() ? TOUCH_KB_H + TOUCH_PU_H : 0);
}
function floorY() { return game.h - floorOffset(); }
function mobileScale() {
    // Reduce in-game text sizes by 15% when on a touch device.
    return isTouchActive() ? 0.85 : 1;
}
const TWIN_CHAIN_MS = 2000;
// Power-up buff durations. Read by usePowerup (activation), update (decay),
// and the freeze tint formula in draw — single source of truth so toast
// strings and visuals can't drift apart.
const POWERUP_DURATIONS = {
    freeze: 18000,
    shield: 25000,
};

const game = {
    mode: 'classic',
    state: 'loading',  // loading | menu | playing | paused | gameover | detonated
    canvas: null, ctx: null,
    w: 0, h: 0, dpr: 1,
    words: [],
    bullets: [],
    particles: [],
    floaters: [],
    target: null,
    input: '',
    score: 0, level: 1, lives: 5,
    combo: 0, bestCombo: 0,
    multiplier: 1, comboTimer: 0,
    spawnCooldown: 0, spawnInterval: DEFAULT_SPAWN_MS,
    freezeTimer: 0, shieldTimer: 0,
    powerups: { freeze: 0, bomb: 0, shield: 0 },
    shake: 0, flash: 0, flashColor: '#ffffff',
    wordsCompleted: 0, charsTyped: 0,
    startTime: 0, elapsed: 0, sprintTimeLeft: 90000,
    last: 0,
    bgStars: [],
    cursorX: 0, cursorY: 0,
    high: null,
    fireT: 0,
    heartFx: [],
    loadT: 0,
    powerupRects: [],
    showHint: true,
    // Boss state
    bossState: 'none',  // none | warning | fighting
    bossWarnT: 0,
    bossActive: null,   // ref to the boss word in game.words
    detonateT: 0,       // ms countdown for DETONATED overlay
    bossDefeatedAtLevels: new Set(),
    // Per-run counters (Step 4)
    bombsTypedThisRun: 0,
    bossesDefeatedThisRun: 0,
    wordsSpawnedThisRun: 0,
    // Daily mode
    isDaily: false,
    dailyLimit: 100,
    // Touch UI
    touchKeys: [],         // {ch, x, y, w, h, flashT}
    touchPowerupRects: [], // {kind, x, y, w, h}
    pauseBtnRect: null,
    // Share card cache
    lastShareDataURL: null,
    lastShareBlob: null,
};

// ---------- Persistence ----------
function loadHigh() {
    try {
        const raw = localStorage.getItem(LS_HIGH_SCORES);
        if (!raw) return { score: 0, wpm: 0, combo: 0 };
        return JSON.parse(raw);
    } catch (e) { return { score: 0, wpm: 0, combo: 0 }; }
}
function saveHigh() {
    try { localStorage.setItem(LS_HIGH_SCORES, JSON.stringify(game.high)); } catch (e) {}
}

// ---------- Setup ----------
function init() {
    game.canvas = document.getElementById('game');
    game.ctx = game.canvas.getContext('2d');
    game.high = loadHigh();
    Settings.load();
    Settings.apply();
    refreshHighUI();
    resize();
    seedStars();
    window.addEventListener('resize', resize);
    document.addEventListener('keydown', onKey);
    // First user interaction unlocks WebAudio AND starts the music loop.
    const firstInteraction = () => {
        Audio.resume();
        if (Settings.values.musicOn) AudioManager.playMusic();
    };
    document.addEventListener('pointerdown', firstInteraction, { once: true });
    document.addEventListener('keydown',     firstInteraction, { once: true });
    document.addEventListener('mousemove', e => { game.cursorX = e.clientX; game.cursorY = e.clientY; });
    game.canvas.addEventListener('click', onCanvasClick);

    document.querySelectorAll('#mode-select .mode').forEach(el => {
        el.addEventListener('click', () => {
            document.querySelectorAll('#mode-select .mode').forEach(m => m.classList.remove('selected'));
            el.classList.add('selected');
            game.mode = el.dataset.mode;
        });
    });
    document.getElementById('play-btn').addEventListener('click', onPlayClicked);
    document.getElementById('again-btn').addEventListener('click', startGame);
    document.getElementById('menu-btn').addEventListener('click', toMenu);

    // Start the render loop early so the loading screen has motion.
    requestAnimationFrame(loop);

    // Boot progress bar: track image-asset load + audio asset load together.
    const bootBar = document.getElementById('boot-progress');
    if (bootBar) bootBar.classList.add('show');
    let imgDone = 0, imgTotal = Object.keys(ASSET_MANIFEST).length;
    let audioDone = 0, audioTotal = Object.keys(SFX_MANIFEST).length + 2;
    const updateBoot = () => {
        const total = imgTotal + audioTotal;
        const done  = imgDone + audioDone;
        const pct = total > 0 ? (done / total) * 100 : 0;
        const fill = bootBar && bootBar.firstElementChild;
        if (fill) fill.style.width = pct + '%';
    };
    // Wrap preloadAssets to track image progress
    preloadAssetsWithProgress(() => { imgDone++; updateBoot(); }, () => {
        applyLogoAssets();
        // Once images are done we can show the menu; audio finishes in background.
        game.state = 'menu';
        if (typeof AmbientLetters !== 'undefined') AmbientLetters.start();
    });

    // Kick off audio preload in parallel
    AudioManager.preload({
        onProgress: (done, total) => { audioDone = done; audioTotal = total; updateBoot(); },
        onReady: () => {
            audioTotal = audioTotal || 0;
            // hide boot bar once both audio + images are settled
            setTimeout(() => { if (bootBar) bootBar.classList.remove('show'); }, 300);
        },
    });
    // Unconditional fallback: hide the boot bar after 4s no matter what.
    setTimeout(() => {
        if (bootBar) bootBar.classList.remove('show');
    }, 4000);
}

// Same as preloadAssets but reports per-asset progress.
function preloadAssetsWithProgress(onEach, onComplete) {
    const keys = Object.keys(ASSET_MANIFEST);
    let done = 0;
    const tick = () => { if (++done >= keys.length) onComplete(); };
    keys.forEach(key => {
        const img = new Image();
        img.onload  = () => { Assets[key] = img; onEach && onEach(); tick(); };
        img.onerror = () => {
            Assets[key] = null;
            console.warn('Word Fall: failed to load asset', key, '→', ASSET_MANIFEST[key]);
            onEach && onEach();
            tick();
        };
        img.src = ASSET_MANIFEST[key];
    });
}

function applyLogoAssets() {
    const set = (id, img) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (img) { el.src = img.src; el.classList.add('loaded'); }
    };
    set('menu-logo', Assets.logo);
}

function resize() {
    game.dpr = Math.min(window.devicePixelRatio || 1, 2);
    game.w = window.innerWidth;
    game.h = window.innerHeight;
    game.canvas.width  = game.w * game.dpr;
    game.canvas.height = game.h * game.dpr;
    game.canvas.style.width  = game.w + 'px';
    game.canvas.style.height = game.h + 'px';
    game.ctx.setTransform(game.dpr, 0, 0, game.dpr, 0, 0);
    if (game.touchKeys) computeTouchKeyboardRects();
}

function seedStars() {
    game.bgStars = [];
    const count = 70;
    for (let i = 0; i < count; i++) {
        game.bgStars.push({
            x: Math.random() * game.w,
            y: Math.random() * game.h,
            z: 0.2 + Math.random() * 0.8,
            r: 0.4 + Math.random() * 1.4,
        });
    }
}

// ---------- Game flow ----------

// ---------- State factory ----------
// Returns a clean game-state object. Called by startGame() and init()
// to avoid stale-state bugs from missed resets.
function createFreshPlayState(mode) {
    return {
        score: 0,
        level: 1,
        lives: mode === 'hardcore' ? 1 : (mode === 'sprint' ? 3 : 5),
        words: [],
        bullets: [],
        particles: [],
        floaters: [],
        heartFx: [],
        target: null,
        input: '',
        combo: 0,
        multiplier: 1,
        comboTimer: 0,
        spawnCooldown: 0,
        spawnInterval: DEFAULT_SPAWN_MS,
        wordsForLevel: WORDS_PER_LEVEL,
        wordsCleared: 0,
        wordsSpawnedThisRun: 0,
        totalWordsThisRun: 0,
        totalBombsThisRun: 0,
        totalBossesThisRun: 0,
        fireT: 0,
        shake: 0,
        flash: 0,
        flashColor: '#FF1744',
        freezeTimer: 0,
        shieldTimer: 0,
        powerups: { freeze: 0, bomb: 0, shield: 0 },
        charsTyped: 0,
        longestCombo: 0,
        longestWord: '',
        sprintTimeLeft: mode === 'sprint' ? 90000 : 0,
        bossState: 'none',
        bossActive: null,
        bossWarnT: 0,
        act: 1,
    };
}

function startGame() {
    // Daily mode entry guard — if already played today, surface the daily-played modal.
    if (game.mode === 'daily') {
        const existing = getDailyResult();
        if (existing) {
            showDailyPlayedModal(existing);
            return;
        }
        // Seed deterministic PRNG for today.
        DAILY_RNG = mulberry32(dailySeedToday());
        game.isDaily = true;
    } else {
        DAILY_RNG = null;
        game.isDaily = false;
    }

    // Apply fresh state from factory
    Object.assign(game, createFreshPlayState(game.mode));
    game.state = 'playing';
    if (typeof AmbientLetters !== 'undefined') AmbientLetters.stop();
    AudioManager.setActiveMusic('game');
    game.words = []; game.bullets = []; game.particles = []; game.floaters = [];
    game.target = null; game.input = '';
    game.score = 0; game.level = 1;
    game.combo = 0; game.bestCombo = 0;
    game.multiplier = 1; game.comboTimer = 0;
    game.spawnCooldown = 600;
    game.freezeTimer = 0; game.shieldTimer = 0;
    game.shake = 0; game.flash = 0;
    game.wordsCompleted = 0; game.charsTyped = 0;
    game.startTime = performance.now();
    game.elapsed = 0; game.sprintTimeLeft = 90000;
    game.heartFx = [];
    game.fireT = 0;
    game.showHint = false;
    game.bossState = 'none';
    game.bossWarnT = 0;
    game.bossActive = null;
    game.detonateT = 0;
    game.bossDefeatedAtLevels = new Set();
    game.act = 1;
    game.pendingAct = 1;
    game.actBreakT = 0;
    game.bombsTypedThisRun = 0;
    game.bossesDefeatedThisRun = 0;
    game.wordsSpawnedThisRun = 0;
    game.longestWordTyped = '';

    if (game.mode === 'hardcore') { game.lives = 1; game.spawnInterval = 1200; }
    else if (game.mode === 'sprint') { game.lives = 3; game.spawnInterval = 1500; }
    else if (game.mode === 'daily') { game.lives = 5; game.spawnInterval = 1800; }
    else { game.lives = 5; game.spawnInterval = 1800; }
    game.powerups = { freeze: 0, bomb: 0, shield: 0 };

    hide('menu'); hide('gameover'); hide('daily-played'); hide('stats-modal');
    Audio.resume();

    // Warm up both DeepSeek pools in the background so the first boss has a
    // word ready and the regular stream gets AI flavour right away. Skipped
    // in daily mode (must stay deterministic).
    if (!game.isDaily && DeepSeek.hasKey()) {
        DeepSeek.warmAll(game.level);
    }
}

function toMenu() {
    game.state = 'menu';
    if (typeof AmbientLetters !== 'undefined') AmbientLetters.start();
    AudioManager.setActiveMusic('menu');
    show('menu'); hide('gameover');
    refreshHighUI();
    if (typeof refreshDailyCard === 'function') refreshDailyCard();
}

function gameOver(reason) {
    game.state = 'gameover';
    Audio.gameOver();
    game.shake = 30;
    game.flash = 0.6; game.flashColor = '#FF1744';

    const wpm = currentWPM();
    let isNew = false;
    if (game.score > game.high.score) { game.high.score = game.score; isNew = true; }
    if (wpm > game.high.wpm) game.high.wpm = wpm;
    if (game.bestCombo > game.high.combo) game.high.combo = game.bestCombo;
    saveHigh();

    // ---- Lifetime stats (Step 4) ----
    const lifetime = loadLifetime();
    lifetime.gamesPlayed += 1;
    lifetime.totalWordsDestroyed += game.wordsCompleted;
    lifetime.totalBossesDefeated += game.bossesDefeatedThisRun;
    lifetime.totalBombsDefused += game.bombsTypedThisRun;
    lifetime.totalTimePlayedSeconds += Math.floor(game.elapsed / 1000);
    if (wpm > lifetime.bestWPM) lifetime.bestWPM = wpm;
    if (game.bestCombo > lifetime.bestCombo) lifetime.bestCombo = game.bestCombo;
    const modeKey = ({
        classic: 'bestScoreClassic',
        sprint:  'bestScoreSprint',
        hardcore:'bestScoreHardcore',
        daily:   'bestScoreDaily',
    })[game.mode];
    if (modeKey && game.score > (lifetime[modeKey] || 0)) lifetime[modeKey] = game.score;

    // ---- Daily completion record ----
    if (game.isDaily) {
        const finished = {
            score: game.score,
            wpm,
            combo: game.bestCombo,
            completed: true,
            date: todayKey(),
            finishedAt: Date.now(),
            mode: 'daily',
        };
        if (!getDailyResult()) {
            saveDailyResult(finished);
            lifetime.totalDailyCompleted += 1;
        }
    }
    saveLifetime(lifetime);

    // ---- Achievement evaluation (game-end batch) ----
    if (game.bestCombo >= 25) unlockAchievement('combo_25');
    if (game.score >= 10000) unlockAchievement('score_10k');
    if (wpm >= 60) unlockAchievement('wpm_60');
    if (lifetime.totalBombsDefused >= 10) unlockAchievement('bomb_10');
    if (lifetime.totalDailyCompleted >= 7) unlockAchievement('daily_7');
    if (lifetime.totalWordsDestroyed >= 1000) unlockAchievement('words_1000');

    document.getElementById('go-title').textContent = reason || (game.mode === 'sprint' ? "TIME'S UP!" : 'GAME OVER');
    document.getElementById('go-sub').textContent = game.mode === 'sprint'
        ? 'You raced the clock.'
        : (reason === 'DETONATED' ? 'A bomb word slipped past you.' :
           reason === "DAILY COMPLETE" ? 'You finished today’s puzzle.' :
           'Words crashed through your defense.');
    document.getElementById('go-score').textContent = game.score;
    document.getElementById('go-wpm').textContent = wpm;
    document.getElementById('go-combo').textContent = game.bestCombo;
    document.getElementById('go-new').style.display = isNew ? '' : 'none';

    // Prepare the share card using current run stats.
    const cardStats = {
        score: game.score,
        wpm,
        longestCombo: game.bestCombo,
        longestWord: game.longestWordTyped || '—',
        mode: game.mode,
        level: game.level,
        date: new Date(),
    };
    try {
        const url = generateShareCard(cardStats);
        game.lastShareDataURL = url;
        // Defer blob creation to share/copy/download time
        const preview = document.getElementById('share-preview');
        if (preview) { preview.src = url; preview.classList.add('ready'); }
    } catch (e) {
        console.warn('Share card render failed', e);
    }

    setTimeout(() => show('gameover'), 1100);
}

function detonationGameOver() {
    // Phase 1: DETONATED overlay for 1s; phase 2: standard game over.
    game.state = 'detonated';
    game.detonateT = 1000;
    game.shake = 40;
    game.flash = 0.85; game.flashColor = '#FF1744';
    Audio.bombDetonate();
    AudioManager.playSFX('bomb', () => {}, { volume: 1 });
}

// ---------- Spawning ----------
function recentWordTexts() { return new Set(game.words.map(w => w.text)); }

// Boss words must never appear as regular falling words — a thin safety
// net in case the data ever drifts or DeepSeek hallucinates a boss word.
const BOSS_WORDS_SET = new Set(BOSS_WORDS);

// ---------- Named constants (extracted from magic numbers) ----------
const COMBO_TIMEOUT_MS      = 3200;   // ms before combo resets
const BULLET_TRAVEL_MS      = 140;    // bullet flight duration
const BOSS_REGROW_IDLE_MS   = 280;    // boss letter idle → regrow threshold (overridden per boss)
const FLASH_DECAY_RATE      = 0.003;  // per-ms flash alpha decay
const SHAKE_DECAY_RATE      = 0.05;   // per-ms shake decay
const HEART_FX_DURATION_MS  = 400;    // heart-loss animation length
const TOAST_DURATION_MS     = 1800;   // toast display time
const FIRE_ANIM_MS          = 100;    // cannon fire animation duration
const DEFAULT_SPAWN_MS      = 1800;   // base spawn interval
const WORDS_PER_LEVEL       = 10;     // words to clear per level
const MAX_MULTIPLIER        = 6.0;    // combo multiplier cap
const COMBO_PER_POWERUP     = 10;     // combo count that grants a power-up
const PARTICLE_GRAVITY      = 0.0002; // per-ms² downward acceleration for particles

// ---------- localStorage key constants ----------
const LS_HIGH_SCORES        = 'wordfall.high';
const LS_LIFETIME_STATS     = 'wordfall_lifetime_stats';
const LS_ACHIEVEMENTS       = 'wordfall_achievements';
const LS_SETTINGS           = 'wordfall_settings';
const LS_TUTORIAL_DONE      = 'wordfall_tutorial_completed';
const LS_DAILY_PREFIX       = 'wordfall_daily_';
const LS_DEEPSEEK_KEY       = 'wordfall_deepseek_key';

// localPool is pure of game.level — cache the filtered array per level so
// pickWord (called once per spawn) doesn't re-allocate on every word.
const _localPoolCache = Object.create(null);
function localPool(level) {
    if (!_localPoolCache[level]) {
        _localPoolCache[level] = poolForLevel(level).filter(w => !BOSS_WORDS_SET.has(w));
    }
    return _localPoolCache[level];
}

// How often regular falling words come from DeepSeek when a key is set.
// Boss + Versus consume from their pools 100% of the time; regular play
// mixes AI words in with the local pools so the cadence still feels
// familiar even when DeepSeek hits a rate limit.
const DEEPSEEK_GAME_RATE = 0.35;

function pickWord() {
    if (!game.isDaily && DeepSeek.hasKey()) {
        // Always kick a background refill so the pool stays warm.
        DeepSeek.refill(game.level, 'game').catch(() => {});
        if (Math.random() < DEEPSEEK_GAME_RATE) {
            const w = DeepSeek.take('game');
            if (w && !BOSS_WORDS_SET.has(w)) return w;
        }
    }
    const pool = localPool(game.level);
    const used = new Set(game.words.map(w => w.text[0]));
    const same = recentWordTexts();
    let candidates = pool.filter(w => !used.has(w[0]) && !same.has(w));
    if (candidates.length === 0) candidates = pool.filter(w => !same.has(w));
    if (candidates.length === 0) candidates = pool;
    return candidates[rngInt(candidates.length)];
}

function pickTwoDistinctWords() {
    const pool = localPool(game.level);   // boss-words stripped
    const same = recentWordTexts();
    const used = new Set(game.words.map(w => w.text[0]));
    let a = pickWord();
    let b = null;
    for (let i = 0; i < 20 && !b; i++) {
        const cand = pool[rngInt(pool.length)];
        if (cand !== a && !same.has(cand) && cand[0] !== a[0] && !used.has(cand[0])) b = cand;
    }
    if (!b) b = pool.find(w => w !== a && w[0] !== a[0]) || pool[0];
    return [a, b];
}

function pickWordType(level) {
    // Apply on-screen caps that the spec calls out.
    const weights = { ...typeWeightsForLevel(level) };
    const bombsOnScreen = game.words.filter(w => w.type === 'bomb').length;
    if (bombsOnScreen >= 2) delete weights.bomb;
    const twinPairOnScreen = game.words.some(w => w.type === 'twin');
    if (twinPairOnScreen) delete weights.twin;

    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    if (total <= 0) return 'normal';
    let r = rng() * total;
    for (const k of Object.keys(weights)) {
        r -= weights[k];
        if (r <= 0) return k;
    }
    return 'normal';
}

function fontSizeForText(text, scale = 1) {
    return Math.round(Math.max(18, Math.min(34, 30 - text.length * 0.4)) * 1.3 * scale * mobileScale());
}

function measureWordWidth(text, size) {
    game.ctx.font = `400 ${size}px 'VT323', monospace`;
    return game.ctx.measureText(text).width;
}

function baseFallSpeed() {
    // Per-level acceleration softened so act 2+ stays fun, not punishing.
    // (Was +0.0045/level — that compounded with the spawn-interval cut.)
    const jitter = (rng() - 0.5) * 0.012;
    return 0.020 + (game.level - 1) * 0.0032 + jitter;
}

function spawnNormal() {
    const text = pickWord();
    addWord({ text, type: 'normal' });
}

function spawnBomb() {
    const text = pickWord();
    addWord({ text, type: 'bomb', sizeScale: 1.15 });
}

function spawnBonus() {
    const text = pickWord();
    addWord({ text, type: 'bonus', sparkleT: 0 });
}

function spawnDecoy() {
    const text = pickWord();
    addWord({ text, type: 'decoy', speedScale: 0.55 });
}

function spawnTwinPair() {
    const [a, b] = pickTwoDistinctWords();
    const speed = baseFallSpeed();
    const sizeA = fontSizeForText(a);
    const sizeB = fontSizeForText(b);
    const wA = measureWordWidth(a, sizeA);
    const wB = measureWordWidth(b, sizeB);
    const pad = 60;
    // Separate by 200–400 px, both fit in viewport.
    const sep = 200 + rng() * 200;
    const leftCenterMin = pad + wA / 2;
    const rightCenterMax = game.w - pad - wB / 2;
    const minLeftX = leftCenterMin;
    const maxLeftX = rightCenterMax - sep;
    const leftX = Math.max(minLeftX, Math.min(maxLeftX, minLeftX + rng() * Math.max(0, maxLeftX - minLeftX)));
    const rightX = leftX + sep;
    const twinA = {
        text: a, typed: 0, x: leftX, y: -40, speed, size: sizeA, width: wA,
        hue: 150, wiggle: Math.random() * Math.PI * 2, spawnAt: performance.now(),
        type: 'twin', partner: null, frozen: false, chainTimer: 0,
        completed: false,
    };
    const twinB = {
        text: b, typed: 0, x: rightX, y: -40, speed, size: sizeB, width: wB,
        hue: 150, wiggle: Math.random() * Math.PI * 2, spawnAt: performance.now(),
        type: 'twin', partner: null, frozen: false, chainTimer: 0,
        completed: false,
    };
    twinA.partner = twinB; twinB.partner = twinA;
    game.words.push(twinA, twinB);
    game.wordsSpawnedThisRun += 2;
}

function addWord({ text, type, sizeScale = 1, speedScale = 1, sparkleT }) {
    const size = fontSizeForText(text, sizeScale);
    const width = measureWordWidth(text, size);
    const pad = 60;
    const speed = baseFallSpeed() * speedScale;
    const w = {
        text, typed: 0,
        x: pad + width / 2 + rng() * (game.w - width - pad * 2),
        y: -40,
        speed, size, width,
        hue: 180 + Math.random() * 180,
        wiggle: Math.random() * Math.PI * 2,
        spawnAt: performance.now(),
        type,
    };
    if (type === 'bonus') w.sparkleT = sparkleT || 0;
    game.words.push(w);
    game.wordsSpawnedThisRun += 1;
}

function spawnByType(t) {
    if (t === 'bomb')  return spawnBomb();
    if (t === 'bonus') return spawnBonus();
    if (t === 'twin')  return spawnTwinPair();
    if (t === 'decoy') return spawnDecoy();
    return spawnNormal();
}

// ---------- Boss ----------
function startBossWarning() {
    if (game.bossState !== 'none') return;
    game.bossState = 'warning';
    game.bossWarnT = 2000;
    Audio.bossWarning();
    AudioManager.playSFX('boss-warning', () => {}, { volume: 1 });
    AudioManager.duck(2000, 0.3);
    game.shake = Math.max(game.shake, 12);
    // Pause currently-falling words during warning.
    for (const w of game.words) w.pausedByBoss = true;
    // Drop any pending target.
    game.target = null; game.input = ''; renderInput();
}

function pickBossText() {
    // Prefer a DeepSeek boss word if one is queued (only used in non-daily
    // modes — daily must stay deterministic). Top up the boss pool in the
    // background for the next boss.
    if (!game.isDaily && DeepSeek.hasKey()) {
        DeepSeek.refill(game.level, 'boss').catch(() => {});
        const w = DeepSeek.take('boss');
        if (w) return w;
    }
    // Local fallback: bias toward longer words as level climbs so each
    // boss feels harder than the last.
    const minLen = Math.min(15, 10 + Math.floor((game.level - 5) / 2));
    let pool = BOSS_WORDS.filter(w => w.length >= minLen);
    if (pool.length === 0) pool = BOSS_WORDS;
    return pool[rngInt(pool.length)];
}

// ---------- Acts / environments ----------
// Each boss defeat advances the "act". With one skyline image we re-skin the
// environment per act using a canvas hue-rotate on the image plus a colour
// wash + star tint. No new art required — if we later want bespoke skylines
// per act this is the single place to swap them in.
const ACTS = [
    { name: 'NEON CITY',    hue: 0,   wash: 'rgba(10, 14, 26, 0.55)',  star: '#F0F4FF', accent: '#00F0FF' },
    { name: 'VIOLET DUSK',  hue: -45, wash: 'rgba(26, 10, 34, 0.52)',  star: '#FFC8F0', accent: '#FF2E97' },
    { name: 'EMBER WASTES', hue: 160, wash: 'rgba(32, 16, 6, 0.52)',   star: '#FFE3B0', accent: '#FF8A00' },
    { name: 'TOXIC GRID',   hue: 90,  wash: 'rgba(6, 26, 16, 0.52)',   star: '#C8FFE0', accent: '#00FF9F' },
    { name: 'CRIMSON CORE', hue: 300, wash: 'rgba(32, 6, 12, 0.56)',   star: '#FFC0CB', accent: '#FF1744' },
    { name: 'GLITCH VOID',  hue: 210, wash: 'rgba(8, 10, 30, 0.58)',   star: '#CFE2FF', accent: '#5AA0FF' },
];
function actConfig(actNum) {
    // act 1-based; cycles through ACTS, getting a touch darker each full cycle.
    const idx = (actNum - 1) % ACTS.length;
    return ACTS[idx];
}

// Boss tier: 0 at L5, 1 at L10, 2 at L15, … Drives every escalation knob.
function bossTier(level) { return Math.max(0, Math.floor((level - 5) / 5)); }

function bossSpeedForLevel(level) {
    // Softer ramp: 0.5× baseFallSpeed at L5 → capped at 1.2× by L40.
    // The countdown timer is the primary pressure; fall speed is the secondary.
    const tier = bossTier(level);
    return baseFallSpeed() * Math.min(1.2, 0.5 + tier * 0.09);
}

function bossSizeMultiplierForLevel(level) {
    // 2.5× at L5, growing modestly so later bosses feel more imposing.
    return Math.min(3.4, 2.5 + Math.max(0, level - 5) * 0.04);
}

// Milliseconds allowed per boss letter. Generous on the first boss and
// loosened overall — the descent moves bit by bit per tier so each stage
// only nudges the squeeze tighter.
//   L5: 1200 (≈14s on a 12-letter boss)
//   L10: 1100, L15: 1000, L20: 900, L25: 800, L30: 700
//   floor 650.
function bossPerLetterMs(level) {
    return Math.max(650, 1200 - bossTier(level) * 100);
}

// Idle window (ms) before an unfinished boss starts regrowing letters.
// Disabled below L10; loosened so the regrowth penalty is less twitchy.
function bossRegrowIdleMs(level) {
    return Math.max(1400, 2600 - bossTier(level) * 240);
}

function spawnBoss() {
    // Clear all non-boss words for a clean fight.
    game.words = game.words.filter(w => w.type === 'boss');
    const text = pickBossText();
    const sizeBase = fontSizeForText(text); // VT323 sized for length already
    const size = Math.round(sizeBase * bossSizeMultiplierForLevel(game.level));
    game.ctx.font = `400 ${size}px 'VT323', monospace`;
    const totalWidth = game.ctx.measureText(text).width;
    // Per-letter positions (so typed letters don't reflow remaining ones).
    const letters = [];
    let xCursor = 0;
    for (const ch of text) {
        const lw = game.ctx.measureText(ch).width;
        letters.push({ ch, cx: xCursor + lw / 2, w: lw, alive: true, shatterT: 0 });
        xCursor += lw;
    }
    const startX = game.w / 2 - totalWidth / 2;
    const timeLimit = text.length * bossPerLetterMs(game.level);
    const boss = {
        text, typed: 0, x: game.w / 2, y: -100,
        speed: bossSpeedForLevel(game.level),
        size, width: totalWidth,
        hue: 320,
        wiggle: 0, spawnAt: performance.now(),
        type: 'boss',
        letters, startX,
        // Step-4 difficulty: hard countdown + letter regrowth on stall.
        // timerArmed flips true only once the word clears the top cover.
        timeLimit, timeLeft: timeLimit,
        timerArmed: false,
        idleT: 0,
        regrowEnabled: game.level >= 10,
        regrowIdleMs: bossRegrowIdleMs(game.level),
    };
    game.words.push(boss);
    game.bossActive = boss;
    game.bossState = 'fighting';
}

function bossDefeated(boss) {
    // Big celebration.
    explodeAt(boss.x, boss.y, true, 200, 'mix');
    game.flash = 0.6; game.flashColor = '#00FF9F';
    game.shake = Math.max(game.shake, 25);
    setTimeout(() => game.shake = Math.max(game.shake, 12), 200);
    Audio.bossDefeated();
    AudioManager.playSFX('boss-defeat', () => {}, { volume: 1 });
    game.score += 1000;
    game.floaters.push({
        text: '+1000  BOSS DOWN', x: boss.x, y: boss.y, vy: -0.06,
        life: 1400, max: 1400, color: '#00FF9F', size: 38,
    });
    // Grant 2 random power-ups.
    for (let i = 0; i < 2; i++) {
        const kinds = ['freeze', 'bomb', 'shield'];
        const pick = kinds[rngInt(kinds.length)];
        game.powerups[pick]++;
    }
    game.bossDefeatedAtLevels.add(game.level);
    game.bossesDefeatedThisRun++;
    unlockAchievement('boss_slayer');
    game.bossState = 'none';
    game.bossActive = null;
    game.target = null; game.input = ''; renderInput();
    // Remove boss word
    game.words = game.words.filter(w => w !== boss);
    // Gate the next zone behind a BEGIN screen so players aren't caught off
    // guard, and switch the environment to the new act.
    enterActBreak();
}

// ---------- Act break (between-zone ready screen) ----------
function enterActBreak() {
    const cleared = game.act;
    game.pendingAct = game.act + 1;
    game.act = game.pendingAct;          // preview the new zone behind the screen
    game.state = 'actbreak';
    game.actBreakT = 9000;               // auto-begins after 9s as a soft-lock guard
    // Clear any stray words so the new zone starts clean.
    game.words = [];
    game.target = null; game.input = ''; renderInput();

    const next = actConfig(game.act);
    const setTxt = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    setTxt('act-cleared', `ACT ${cleared} CLEAR`);
    setTxt('act-next-name', next.name);
    setTxt('act-next-num', `ACT ${game.act}`);
    setTxt('act-reward', '+1000  ·  2 POWER-UPS EARNED');
    setTxt('act-countdown', '9');
    // Theme the BEGIN button + name glow to the new act's accent.
    const panel = document.getElementById('act-break');
    if (panel) panel.style.setProperty('--act-accent', next.accent);
    show('act-break');
}

function beginNextAct() {
    if (game.state !== 'actbreak') return;
    hide('act-break');
    game.state = 'playing';
    game.actBreakT = 0;
    game.spawnCooldown = 1200;           // generous grace so the act eases in
    // Refund a chunk of spawn interval — each act gets a breather instead of
    // stacking the previous act's tightest cadence on top of new bosses.
    game.spawnInterval = Math.min(1800, game.spawnInterval + 220);
    game.last = performance.now();       // avoid a dt spike after the pause
}

function updateActBreak(dt) {
    // Cosmetic-only update: let the celebration finish, run the countdown.
    for (const b of game.bullets) {
        b.life += dt;
        const t = Math.min(1, b.life / BULLET_TRAVEL_MS);
        b.x = lerp(game.w / 2, b.target ? b.target.x : b.tx, t);
        b.y = lerp(game.h - 90, b.target ? b.target.y : b.ty, t);
    }
    game.bullets = game.bullets.filter(b => b.life < b.max);
    updateParticles(dt);
    updateFloaters(dt);
    decayVisualState(dt);
    game.actBreakT -= dt;
    const cd = Math.ceil(Math.max(0, game.actBreakT) / 1000);
    const el = document.getElementById('act-countdown');
    if (el && el.textContent !== String(cd)) el.textContent = cd;
    if (game.actBreakT <= 0) beginNextAct();
}

function bossEscaped(boss) {
    // -2 lives, heavy red flash, scaled-up miss treatment.
    showToast('BOSS ESCAPED  -2', '#FF1744');
    game.combo = 0; game.multiplier = 1; game.comboTimer = 0;
    const lossCount = Math.min(2, game.lives);
    for (let i = 0; i < lossCount; i++) {
        game.heartFx.push({ idx: game.lives - 1 - i, life: 500 }  // Versus uses longer heart anim);
    }
    game.lives -= 2;
    game.shake = Math.max(game.shake, 28);
    game.flash = 0.75; game.flashColor = '#FF1744';
    Audio.miss();
    setTimeout(() => Audio.miss(), 100);
    game.words = game.words.filter(w => w !== boss);
    game.bossActive = null;
    game.bossState = 'none';
    game.target = null; game.input = ''; renderInput();
    if (game.lives <= 0) gameOver();
}

// ---------- Input ----------
function onKey(e) {
    // Act-break ready screen: Enter / Space / Escape all jump into the next act.
    if (game.state === 'actbreak') {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
            e.preventDefault();
            beginNextAct();
        }
        return;
    }
    if (e.key === 'Escape') {
        // If any overlay-modal is open, Esc closes the topmost one. We check
        // the confirm dialog first (deepest), then daily-played, then stats,
        // then settings. The tutorial deliberately doesn't close on Esc —
        // it has its own Skip button so first-time players don't dismiss it
        // by accident.
        const tryClose = (id) => {
            const el = document.getElementById(id);
            if (el && el.classList.contains('show')) { hide(id); return true; }
            return false;
        };
        if (tryClose('confirm-reset') || tryClose('daily-played')
            || tryClose('stats-modal') || tryClose('settings-modal')) {
            return;
        }
        if (game.state === 'playing') {
            game.state = 'paused';
            document.getElementById('pause-hint').classList.add('show');
            AudioManager.pauseMusic();
        }
        else if (game.state === 'paused') {
            game.state = 'playing';
            document.getElementById('pause-hint').classList.remove('show');
            if (Settings.values.musicOn) AudioManager.resumeMusic();
            game.last = performance.now();
        }
        return;
    }
    if (game.state !== 'playing') {
        if (e.key === 'Enter' || e.key === ' ') {
            if (game.state === 'menu' || game.state === 'gameover') startGame();
        }
        return;
    }
    if (e.key === 'Backspace') {
        if (game.target) { game.target = null; game.input = ''; renderInput(); }
        return;
    }
    // Power-up activation: Shift + F / B / S. A modifier removes the old
    // ambiguity with typing words that start with those letters, so plain
    // f / b / s are now always free for gameplay. Works any time during play.
    if (e.shiftKey && /^[fbs]$/i.test(e.key)) {
        const k = e.key.toLowerCase();
        if      (k === 'f' && game.powerups.freeze > 0) usePowerup('freeze');
        else if (k === 'b' && game.powerups.bomb   > 0) usePowerup('bomb');
        else if (k === 's' && game.powerups.shield > 0) usePowerup('shield');
        // Reserved gesture — swallow even when uncharged so the capital
        // letter never leaks into word typing.
        e.preventDefault();
        return;
    }

    if (e.key.length !== 1 || !/[a-zA-Z]/.test(e.key)) return;
    const ch = e.key.toLowerCase();

    if (!game.target) {
        const candidates = lockOnCandidates();
        // Prefer the lowest non-decoy match; only fall back to a decoy if no
        // real word starts with this letter.
        let best = null, bestDecoy = null;
        for (const w of candidates) {
            if (w.text[0] !== ch) continue;
            if (w.type === 'decoy') {
                if (!bestDecoy || w.y > bestDecoy.y) bestDecoy = w;
            } else {
                if (!best || w.y > best.y) best = w;
            }
        }
        if (!best) best = bestDecoy;
        if (best) {
            game.target = best;
            best.typed = 1;
            game.input = ch;
            game.charsTyped++;
            spawnBullet(best);
            Audio.lockOn();
            AudioManager.playSFX('lock', () => {}, { volume: 0.8 });
            Audio.keyHit(1 / best.text.length);
            AudioManager.playSFX('type', () => {}, {
                volume: 0.3,
                playbackRate: 0.92 + Math.random() * 0.16,
            });
            renderInput();
            // Twin lock-on triggers partner freeze.
            if (best.type === 'twin' && best.partner && !best.partner.completed) {
                best.partner.frozen = true;
                best.chainTimer = TWIN_CHAIN_MS;
                best.partner.chainTimer = TWIN_CHAIN_MS;
                Audio.twinFreeze();
            }
            if (best.typed === best.text.length) completeWord(best);
        } else {
            if (game.combo > 0) game.comboTimer = Math.max(0, game.comboTimer - 800);
        }
        return;
    }

    const expected = game.target.text[game.target.typed];
    if (ch === expected) {
        game.target.typed++;
        game.input = game.target.text.slice(0, game.target.typed);
        game.charsTyped++;
        // For boss: shatter the letter at this position.
        if (game.target.type === 'boss') {
            const li = game.target.letters[game.target.typed - 1];
            if (li) {
                li.alive = false;
                li.shatterT = 400;
                spawnLetterShatter(letterScreenX(game.target, li), game.target.y);
                Audio.bossLetterShatter();
                // Per-letter score reward
                game.score += Math.round(10 * 5 * game.multiplier);
            }
            game.target.idleT = 0; // progress made — reset the regrow clock
        } else {
            spawnBullet(game.target);
            Audio.keyHit(game.target.typed / game.target.text.length);
            AudioManager.playSFX('type', () => {}, {
                volume: 0.3,
                playbackRate: 0.92 + Math.random() * 0.16,
            });
        }
        renderInput();
        if (game.target.typed === game.target.text.length) completeWord(game.target);
    } else {
        if (game.combo > 2) game.combo = Math.max(0, game.combo - 1);
        game.shake = Math.max(game.shake, 4);
    }
}

function lockOnCandidates() {
    // Decoys excluded; boss takes priority during fight; non-boss excluded during boss.
    if (game.bossState === 'fighting' && game.bossActive) {
        return [game.bossActive];
    }
    if (game.bossState === 'warning') return [];
    // Decoys ARE lockable now (0-point combo-trap on completion). Lock-on
    // still PREFERS non-decoy candidates so they only catch sloppy typing —
    // see the picker in onKey.
    return game.words.filter(w => w.type !== 'boss');
}

function letterScreenX(boss, letter) {
    return boss.startX + letter.cx;
}

function renderInput() {
    const buf = document.getElementById('input-buffer');
    if (!game.target) { buf.innerHTML = ''; return; }
    const typed = game.target.text.slice(0, game.target.typed);
    const rest  = game.target.text.slice(game.target.typed);
    buf.innerHTML =
        `<span style="color: #FFD93D">${typed}</span>` +
        `<span style="color: #6B7299">${rest}</span>` +
        `<span class="cursor"></span>`;
}

function onCanvasClick(e) {
    if (game.state !== 'playing') return;
    const rect = game.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    for (const r of game.powerupRects) {
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
            usePowerup(r.kind);
            return;
        }
    }
}

// ---------- Word complete / miss ----------
function typeMultiplier(t) {
    if (t === 'bonus') return 3;
    if (t === 'twin')  return 1.5;
    if (t === 'bomb')  return 1;
    return 1; // normal, boss (boss handled separately)
}

function completeWord(w) {
    // Decoy: you typed a fake. 0 points, combo break, clear feedback so the
    // player learns the warning. No life loss — the visual strikethrough +
    // ghost-cyan glow was the warning.
    if (w.type === 'decoy') {
        game.combo = 0;
        game.multiplier = 1;
        game.comboTimer = 0;
        showToast('BAIT', '#FF8A00');
        game.flash = Math.max(game.flash, 0.35); game.flashColor = '#FF8A00';
        game.shake = Math.max(game.shake, 6);
        explodeAt(w.x, w.y, false, 12, 'cyan');
        game.words = game.words.filter(x => x !== w);
        game.target = null; game.input = ''; renderInput();
        return;
    }
    const base = 10 * w.text.length;
    const typeMul = typeMultiplier(w.type);
    let gained = Math.round(base * typeMul * game.multiplier);
    if (w.type === 'bomb') gained += 50;
    game.score += gained;
    game.wordsCompleted++;
    game.combo++;
    if (game.combo > game.bestCombo) game.bestCombo = game.combo;
    game.multiplier = 1 + Math.min(game.combo, 50) * 0.1;
    game.comboTimer = COMBO_TIMEOUT_MS;
    game.fireT = 100;

    // Per-run trackers (Step 4)
    if (w.type === 'bomb') game.bombsTypedThisRun++;
    if (w.text && w.text.length > (game.longestWordTyped || '').length) game.longestWordTyped = w.text;
    if (game.wordsCompleted === 1) unlockAchievement('first_word');
    if (game.bestCombo >= 25) unlockAchievement('combo_25');
    if (game.score >= 10000) unlockAchievement('score_10k');

    // Per-type audio + FX
    if (w.type === 'boss') {
        // Boss letters score is per-keystroke; final completion triggers defeat.
        bossDefeated(w);
        return;
    } else if (w.type === 'bomb') {
        Audio.bombHit();
        game.flash = 0.35; game.flashColor = '#00FF9F';
        explodeAt(w.x, w.y, true, 50, 'redmagenta');
    } else if (w.type === 'bonus') {
        Audio.bonusComplete();
        explodeAt(w.x, w.y, true, 60, 'gold');
        // Grant the power-up the player has fewest of.
        const counts = game.powerups;
        const kinds = ['freeze', 'bomb', 'shield'];
        let minK = kinds[0];
        for (const k of kinds) if (counts[k] < counts[minK]) minK = k;
        game.powerups[minK]++;
        showToast(`POWER-UP: ${minK.toUpperCase()}`, '#FFD93D');
    } else if (w.type === 'twin') {
        Audio.wordComplete(game.combo);
        explodeAt(w.x, w.y, true, 32, 'green');
        w.completed = true;
        if (w.partner && w.partner.completed) {
            // Pair bonus on second completion: +50% of combined reward.
            const partnerBase = 10 * w.partner.text.length;
            const combined = Math.round((base * 1.5 + partnerBase * 1.5) * game.multiplier);
            const bonus = Math.round(combined * 0.5);
            game.score += bonus;
            game.floaters.push({
                text: `+${bonus} PAIR`, x: w.x, y: w.y - 26, vy: -0.07,
                life: 1200, max: 1200, color: '#00FF9F', size: 26,
            });
        } else if (w.partner && !w.partner.completed) {
            // Partner becomes new auto-target, chain timer resets.
            w.partner.frozen = false;
            w.partner.chainTimer = TWIN_CHAIN_MS;
            game.target = w.partner;
            w.partner.typed = 0;
            renderInput();
            // Don't unset target — we just set it.
            game.floaters.push({
                text: `+${gained}`, x: w.x, y: w.y, vy: -0.06,
                life: 1000, max: 1000, color: '#00FF9F', size: 24 + Math.min(game.combo, 10),
            });
            game.words = game.words.filter(x => x !== w);
            comboMilestoneCheck();
            levelUpCheck();
            return; // skip default cleanup
        }
    } else {
        Audio.wordComplete(game.combo);
        AudioManager.playSFX('destroy', () => {}, { volume: 0.8 });
        explodeAt(w.x, w.y, true, 28, 'cyan');
    }

    if (w.type !== 'twin' || (w.partner && w.partner.completed)) {
        game.floaters.push({
            text: `+${gained}`,
            x: w.x, y: w.y, vy: -0.06,
            life: 1000, max: 1000,
            color: game.combo >= 5 ? '#FF2E97' : (w.type === 'bonus' ? '#FFD93D' : '#00FF9F'),
            size: 24 + Math.min(game.combo, 10),
        });
    }

    comboMilestoneCheck();

    game.words = game.words.filter(x => x !== w);
    game.target = null; game.input = ''; renderInput();

    levelUpCheck();
}

function comboMilestoneCheck() {
    if (game.combo > 0 && game.combo % 10 === 0) {
        const kinds = ['freeze', 'bomb', 'shield'];
        const kind = kinds[(game.combo / 10 - 1) % kinds.length];
        game.powerups[kind]++;
        showToast(`POWER-UP: ${kind.toUpperCase()}`, '#00F0FF');
        burstAtCannon(36, 'magenta');
        AudioManager.playSFX('combo', () => {}, { volume: 0.9 });
    }
}

function levelUpCheck() {
    const targetLevel = 1 + Math.floor(game.wordsCompleted / 12);
    if (targetLevel > game.level) {
        game.level = targetLevel;
        Audio.levelUp();
        showToast(`LEVEL ${game.level}`, '#FF2E97');
        // Gentler ramp + higher floor: keeps later acts playable.
        game.spawnInterval = Math.max(700, game.spawnInterval - 90);
        game.flash = 0.4; game.flashColor = '#00F0FF';
        // Boss every 5th level
        if (isBossLevel(game.level) && !game.bossDefeatedAtLevels.has(game.level)) {
            startBossWarning();
        }
    }
}

function missWord(w) {
    if (w.type === 'decoy') {
        // No penalty; just disappears.
        game.words = game.words.filter(x => x !== w);
        return;
    }
    if (w.type === 'bomb') {
        // Instant game over regardless of lives.
        game.words = game.words.filter(x => x !== w);
        if (game.target === w) { game.target = null; game.input = ''; renderInput(); }
        explodeAt(w.x, floorY(), true, 90, 'redmagenta');
        detonationGameOver();
        return;
    }
    if (w.type === 'boss') {
        bossEscaped(w);
        return;
    }
    if (w.type === 'twin') {
        // Pair crash if partner exists and isn't completed.
        const partner = w.partner;
        if (partner && !partner.completed && partner !== w) {
            // Both crash, 1 life only.
            applySingleLifeLoss('#FF1744');
            explodeAt(w.x, w.y, false, 24, 'green');
            explodeAt(partner.x, partner.y, false, 24, 'green');
            game.words = game.words.filter(x => x !== w && x !== partner);
            if (game.target === w || game.target === partner) {
                game.target = null; game.input = ''; renderInput();
            }
            if (game.lives <= 0) gameOver();
            return;
        }
        // Partner already completed — single miss
    }
    // Shield consumes the miss
    if (game.shieldTimer > 0) {
        game.shieldTimer = 0;
        showToast('SHIELD BROKE', '#FF8A00');
        game.flash = 0.5; game.flashColor = '#FF8A00';
        game.shake = Math.max(game.shake, 8);
        explodeAt(w.x, w.y, false, 24, 'cyan');
        game.words = game.words.filter(x => x !== w);
        if (game.target === w) { game.target = null; game.input = ''; renderInput(); }
        Audio.powerup('shield');
        return;
    }
    applySingleLifeLoss('#FF1744');
    explodeAt(w.x, w.y, false, 32, 'cyan');
    game.words = game.words.filter(x => x !== w);
    if (game.target === w) { game.target = null; game.input = ''; renderInput(); }
    if (game.lives <= 0) gameOver();
}

function applySingleLifeLoss(flashColor) {
    const lostIdx = game.lives - 1;
    game.lives--;
    game.heartFx.push({ idx: lostIdx, life: HEART_FX_DURATION_MS });
    game.combo = 0; game.multiplier = 1; game.comboTimer = 0;
    Audio.miss();
    game.shake = Math.max(game.shake, 18);
    game.flash = 0.55; game.flashColor = flashColor;
}

// ---------- Power-ups ----------
function usePowerup(kind) {
    if (game.state !== 'playing') return;
    if (game.powerups[kind] <= 0) return;
    game.powerups[kind]--;
    Audio.powerup(kind);
    AudioManager.playSFX('powerup', () => {}, { volume: 0.9 });

    if (kind === 'freeze') {
        game.freezeTimer = POWERUP_DURATIONS.freeze;
        showToast(`FREEZE  ${POWERUP_DURATIONS.freeze / 1000}s`, '#00F0FF');
        game.flash = 0.3; game.flashColor = '#00F0FF';
    } else if (kind === 'bomb') {
        const targets = game.words.filter(w => w.type !== 'boss');
        // Only real words contribute to the score + the toast count;
        // decoys are vapourised for free.
        let reward = 0;
        for (const w of targets) {
            explodeAt(w.x, w.y, false, 22, 'cyan');
            if (w.type !== 'decoy') {
                reward++;
                game.score += Math.round(5 * w.text.length * game.multiplier);
            }
        }
        game.words = game.words.filter(w => w.type === 'boss');
        // If the bomb-power-up killed a twin's partner, clean other twin's chain state.
        for (const w of game.words) {
            if (w.type === 'twin' && (!w.partner || !game.words.includes(w.partner))) {
                w.partner = null; w.frozen = false; w.chainTimer = 0;
            }
        }
        if (game.target && !game.words.includes(game.target)) {
            game.target = null; game.input = ''; renderInput();
        }
        game.shake = Math.max(game.shake, 14);
        game.flash = 0.5; game.flashColor = '#FF2E97';
        showToast(`BOMB x${reward}`, '#FF2E97');
    } else if (kind === 'shield') {
        // Timed buff. Also absorbs the next miss within the window (which
        // then drops the shield early via missWord).
        game.shieldTimer = POWERUP_DURATIONS.shield;
        showToast(`SHIELD UP  ${POWERUP_DURATIONS.shield / 1000}s`, '#00FF9F');
    }
}

// ---------- FX ----------
function pickSparkKind(palette) {
    // palette: 'cyan' | 'green' | 'gold' | 'redmagenta' | 'mix' | 'magenta'
    const r = Math.random();
    if (palette === 'cyan')         return r < 0.8 ? 'cyan' : 'magenta';
    if (palette === 'magenta')      return r < 0.85 ? 'magenta' : 'cyan';
    if (palette === 'green')        return 'green';
    if (palette === 'gold')         return 'gold';
    if (palette === 'redmagenta')   return r < 0.5 ? 'red' : 'magenta';
    if (palette === 'mix')          return r < 0.5 ? 'cyan' : 'magenta';
    return r < 0.6 ? 'cyan' : 'magenta';
}

function explodeAt(x, y, _locked, count = 28, palette = 'mix') {
    count = Math.max(1, Math.round(count * particleCountScale()));
    for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = 0.05 + Math.random() * 0.5;
        game.particles.push({
            kind: pickSparkKind(palette),
            x, y,
            vx: Math.cos(a) * s, vy: Math.sin(a) * s,
            life: 600 + Math.random() * 500,
            max: 1100,
            size: 22 + Math.random() * 18,
            rot: Math.random() * Math.PI * 2,
            spin: (Math.random() - 0.5) * 0.012,
        });
    }
}

function burstAtCannon(count, biasKind) {
    count = Math.max(1, Math.round(count * particleCountScale()));
    const cx = game.w / 2;
    const cy = game.h - 90;
    for (let i = 0; i < count; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI;
        const s = 0.15 + Math.random() * 0.35;
        game.particles.push({
            kind: biasKind === 'magenta'
                ? (Math.random() < 0.85 ? 'magenta' : 'cyan')
                : (Math.random() < 0.85 ? 'cyan' : 'magenta'),
            x: cx + (Math.random() - 0.5) * 30,
            y: cy,
            vx: Math.cos(a) * s, vy: Math.sin(a) * s,
            life: 700 + Math.random() * 400,
            max: 1100,
            size: 28 + Math.random() * 14,
            rot: Math.random() * Math.PI * 2,
            spin: (Math.random() - 0.5) * 0.02,
        });
    }
}

function spawnLetterShatter(x, y) {
    // Glass-shard particles for boss letter shatter.
    const n = Math.max(2, Math.round(18 * particleCountScale()));
    for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4;
        const s = 0.12 + Math.random() * 0.45;
        game.particles.push({
            kind: 'shard',
            x, y,
            vx: Math.cos(a) * s, vy: Math.sin(a) * s,
            life: 600 + Math.random() * 400,
            max: 1000,
            size: 18 + Math.random() * 14,
            rot: Math.random() * Math.PI * 2,
            spin: (Math.random() - 0.5) * 0.03,
        });
    }
}

function spawnBullet(w) {
    game.bullets.push({
        x: game.w / 2, y: game.h - 90,
        tx: w.x, ty: w.y, target: w,
        life: 0, max: 180,
    });
}

function emitBonusSparkle(w) {
    const a = Math.random() * Math.PI * 2;
    game.particles.push({
        kind: 'gold',
        x: w.x + Math.cos(a) * (w.width / 2 + 10),
        y: w.y + Math.sin(a) * (w.size / 2 + 6),
        vx: Math.cos(a) * 0.04,
        vy: Math.sin(a) * 0.04 + 0.02,
        life: 600, max: 700,
        size: 12 + Math.random() * 6,
        rot: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.04,
    });
}

function showToast(text, color) {
    const t = document.getElementById('toast');
    t.textContent = text;
    t.style.color = color;
    t.style.opacity = '0';
    t.style.transition = 'none';
    t.style.transform = 'translate(-50%, 0) scale(0.8)';
    requestAnimationFrame(() => {
        t.style.transition = 'opacity 0.25s, transform 0.25s';
        t.style.opacity = '1';
        t.style.transform = 'translate(-50%, 0) scale(1)';
        setTimeout(() => {
            t.style.opacity = '0';
            t.style.transform = 'translate(-50%, -20px) scale(0.9)';
        }, 700);
    });
}

function refreshHighUI() {
    document.getElementById('hs-score').textContent = game.high.score || 0;
    document.getElementById('hs-wpm').textContent   = game.high.wpm   || 0;
    document.getElementById('hs-combo').textContent = game.high.combo || 0;
}

function currentWPM() {
    const minutes = (game.elapsed || 1) / 60000;
    if (minutes <= 0) return 0;
    return Math.round((game.charsTyped / 5) / minutes);
}

// ---------- Loop ----------
function loop(now) {
    const dt = Math.min(64, now - (game.last || now));
    game.last = now;
    // FPS smoothing (Step 5)
    if (dt > 0) {
        const inst = 1000 / dt;
        game.fps = (game.fps == null) ? inst : (game.fps * 0.92 + inst * 0.08);
    }

    if (game.state === 'loading') {
        game.loadT += dt;
        drawLoadingScreen();
    } else if (game.state === 'detonated') {
        // Hold DETONATED overlay for ~1s before standard game-over.
        game.detonateT -= dt;
        draw(dt);
        drawDetonatedOverlay();
        if (game.detonateT <= 0) gameOver('DETONATED');
    } else if (game.state === 'actbreak') {
        updateActBreak(dt);
        draw(dt);
    } else {
        if (game.state === 'playing') update(dt);
        draw(dt);
        if (game.bossState === 'warning') drawBossWarningOverlay();
    }
    requestAnimationFrame(loop);
}

function update(dt) {
    game.elapsed = performance.now() - game.startTime;

    if (game.mode === 'sprint') {
        game.sprintTimeLeft -= dt;
        if (game.sprintTimeLeft <= 0) { gameOver("TIME'S UP!"); return; }
    }

    let ts = 1;
    if (game.freezeTimer > 0) { game.freezeTimer -= dt; ts = 0.25; }
    const sdt = dt * ts;
    // Shield timer (also drops on absorb in missWord).
    if (game.shieldTimer > 0) {
        game.shieldTimer -= dt;
        if (game.shieldTimer <= 0) {
            game.shieldTimer = 0;
            showToast('SHIELD DOWN', '#FF8A00');
        }
    }

    // Boss warning timer
    if (game.bossState === 'warning') {
        game.bossWarnT -= dt;
        if (game.bossWarnT <= 0) spawnBoss();
        // During warning: don't spawn; words bob in place.
        for (const w of game.words) {
            w.wiggle += dt * 0.005;
        }
        // Skip the rest of update (no spawn / no normal falling).
        for (const b of game.bullets) {
            b.life += dt;
            const t = Math.min(1, b.life / BULLET_TRAVEL_MS);
            b.x = lerp(game.w / 2, b.target ? b.target.x : b.tx, t);
            b.y = lerp(game.h - 90, b.target ? b.target.y : b.ty, t);
        }
        game.bullets = game.bullets.filter(b => b.life < b.max);
        updateParticles(dt);
        updateFloaters(dt);
        decayVisualState(dt);
        return;
    }

    // Boss fight: hard countdown + letter regrowth (you can't stall).
    // The countdown only ARMS once the boss has fully descended past the top
    // cover — burning the timer while the word is still hidden/entering isn't
    // fair. Both tick on scaled time, so a FREEZE power-up genuinely helps.
    if (game.bossState === 'fighting' && game.bossActive) {
        const boss = game.bossActive;
        if (!boss.timerArmed && boss.y >= TOP_HUD_H + boss.size / 2) {
            boss.timerArmed = true;
        }
        if (boss.timerArmed) {
            boss.timeLeft -= sdt;
            boss.idleT += sdt;
            if (boss.regrowEnabled && boss.typed > 0 && boss.typed < boss.text.length
                && boss.idleT >= boss.regrowIdleMs) {
                // Idling too long → the most recently shattered letter regrows.
                const li = boss.letters[boss.typed - 1];
                if (li) {
                    li.alive = true;
                    li.shatterT = 0;
                    li.regrowT = 280;
                    boss.typed--;
                    boss.idleT = 0;
                    game.flash = Math.max(game.flash, 0.22); game.flashColor = '#FF8A00';
                    game.shake = Math.max(game.shake, 5);
                    renderInput();
                }
            }
            if (boss.timeLeft <= 0) {
                bossEscaped(boss);
                return;
            }
        }
    }

    // Spawning
    game.spawnCooldown -= dt;
    const maxOnScreen = 4 + Math.min(6, Math.floor(game.level / 2));
    const bossActive = game.bossState === 'fighting';
    const dailyCapReached = game.isDaily && game.wordsSpawnedThisRun >= game.dailyLimit;
    if (!bossActive && !dailyCapReached && game.spawnCooldown <= 0 && game.words.length < maxOnScreen) {
        const t = pickWordType(game.level);
        spawnByType(t);
        game.spawnCooldown = game.spawnInterval * (0.7 + rng() * 0.6);
    }
    // Daily-mode end: once 100 spawned AND the field is clear, finish the run.
    if (game.isDaily && dailyCapReached && game.words.length === 0 && !bossActive && game.bossState !== 'warning') {
        gameOver('DAILY COMPLETE');
        return;
    }

    const floor = floorY();
    for (const w of game.words) {
        // Twin partner freeze, twin chain timer
        if (w.type === 'twin' && w.chainTimer > 0) {
            w.chainTimer -= dt;
            if (w.chainTimer <= 0) {
                // Active chain expired. If neither completed yet, both crash.
                const partner = w.partner;
                if (!w.completed && partner && !partner.completed) {
                    // Pair crash, 1 life.
                    applySingleLifeLoss('#FF1744');
                    explodeAt(w.x, w.y, false, 24, 'green');
                    explodeAt(partner.x, partner.y, false, 24, 'green');
                    game.words = game.words.filter(x => x !== w && x !== partner);
                    if (game.target === w || game.target === partner) {
                        game.target = null; game.input = ''; renderInput();
                    }
                    if (game.lives <= 0) gameOver();
                    return;
                } else {
                    w.frozen = false; // resume normal fall
                }
            }
        }

        // Falling — frozen words stay put; partner-frozen twins stay put
        const blocked = w.frozen || w.pausedByBoss || (bossActive && w.type !== 'boss');
        if (!blocked) {
            w.y += w.speed * sdt;
        }
        w.wiggle += sdt * 0.003;

        // Bonus sparkle emission
        if (w.type === 'bonus') {
            w.sparkleT += dt;
            if (w.sparkleT >= 100) { w.sparkleT = 0; emitBonusSparkle(w); }
        }

        if (w.y > floor) {
            missWord(w);
            return;
        }
    }

    for (const b of game.bullets) {
        b.life += dt;
        const t = Math.min(1, b.life / BULLET_TRAVEL_MS);
        b.x = lerp(game.w / 2, b.target ? b.target.x : b.tx, t);
        b.y = lerp(game.h - 90, b.target ? b.target.y : b.ty, t);
    }
    game.bullets = game.bullets.filter(b => b.life < b.max);

    updateParticles(dt);
    updateFloaters(dt);

    for (const fx of game.heartFx) fx.life -= dt;
    game.heartFx = game.heartFx.filter(fx => fx.life > 0);

    if (game.combo > 0) {
        game.comboTimer -= dt;
        if (game.comboTimer <= 0) { game.combo = 0; game.multiplier = 1; }
    }

    if (game.fireT > 0) game.fireT = Math.max(0, game.fireT - dt);

    decayVisualState(dt);
}

function updateParticles(dt) {
    for (const p of game.particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += PARTICLE_GRAVITY * dt;
        p.rot += p.spin * dt;
        p.life -= dt;
    }
    game.particles = game.particles.filter(p => p.life > 0);
}

function updateFloaters(dt) {
    for (const f of game.floaters) {
        f.y += f.vy * dt;
        f.life -= dt;
    }
    game.floaters = game.floaters.filter(f => f.life > 0);
}

function decayVisualState(dt) {
    game.shake = Math.max(0, game.shake - dt * SHAKE_DECAY_RATE);
    game.flash = Math.max(0, game.flash - dt * FLASH_DECAY_RATE);
}

function lerp(a, b, t) { return a + (b - a) * t; }


// ---------- Colorblind mode helpers ----------
function isColorblind() { return !!Settings.values.colorblind; }

// Returns a prefix icon/label for each word type in colorblind mode
function wordTypeIndicator(type) {
    if (!isColorblind()) return '';
    switch (type) {
        case 'bomb':  return '⚠ ';
        case 'bonus': return '★ ';
        case 'twin':  return '⇆ ';
        case 'decoy': return '~ ';
        case 'boss':  return '◆ ';
        default:      return '';
    }
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  MODULE: Rendering — Canvas draw functions                  ║
// ╚══════════════════════════════════════════════════════════════╝

// ---------- Draw ----------
function drawLoadingScreen() {
    const ctx = game.ctx, w = game.w, h = game.h;
    ctx.fillStyle = '#0A0E1A';
    ctx.fillRect(0, 0, w, h);

    ctx.font = "400 64px 'Monoton', Impact, sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#00F0FF';
    ctx.shadowColor = '#00F0FF';
    ctx.shadowBlur = 24;
    ctx.fillText('LOADING…', w / 2, h / 2 - 20);
    ctx.shadowBlur = 0;

    const dots = 5, gap = 18, dotR = 5;
    const totalW = (dots - 1) * gap;
    const baseX = w / 2 - totalW / 2;
    const baseY = h / 2 + 40;
    for (let i = 0; i < dots; i++) {
        const phase = (game.loadT / 200) - i * 0.35;
        const a = 0.35 + 0.5 * (0.5 + 0.5 * Math.sin(phase));
        ctx.globalAlpha = a;
        ctx.fillStyle = '#00F0FF';
        ctx.shadowColor = '#00F0FF';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(baseX + i * gap, baseY, dotR, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
}

function draw(dt) {
    const ctx = game.ctx;
    const w = game.w, h = game.h;
    ctx.save();
    const effShake = reduceMotion() ? 0 : game.shake;
    if (effShake > 0) {
        ctx.translate((Math.random() - 0.5) * effShake, (Math.random() - 0.5) * effShake);
    }

    drawBackground(ctx, w, h, dt);
    drawTwinChains(ctx);
    drawTargetingBeam(ctx, w, h);
    drawWords(ctx);
    drawBullets(ctx);
    drawParticles(ctx);
    drawFloaters(ctx);

    if (game.shieldTimer > 0) drawShieldAura(ctx, w, h);

    if (game.freezeTimer > 0) {
        const a = Math.min(0.25, game.freezeTimer / POWERUP_DURATIONS.freeze * 0.25);
        ctx.fillStyle = `rgba(0, 240, 255, ${a})`;
        ctx.fillRect(0, 0, w, h);
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, 'rgba(0, 240, 255, 0.35)');
        grad.addColorStop(0.5, 'rgba(0, 240, 255, 0)');
        grad.addColorStop(1, 'rgba(0, 240, 255, 0.35)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
    }

    if (game.flash > 0) {
        ctx.fillStyle = withAlpha(game.flashColor, game.flash * 0.5);
        ctx.fillRect(0, 0, w, h);
    }

    drawBottomHud(ctx, w, h);
    drawCannon(ctx, w, h);
    drawTopHud(ctx, w, h);

    if (game.mode === 'sprint' && game.state === 'playing') drawSprintTimer(ctx, w);

    // Step 4: touch overlays
    drawStep4Overlays(ctx);
    // Step 5: FPS counter
    if (Settings.values.showFPS) drawFPS(ctx);

    ctx.restore();
}

function drawBackground(ctx, w, h, dt) {
    const act = actConfig(game.act || 1);
    if (Assets.bgSkyline) {
        const img = Assets.bgSkyline;
        const ir = img.width / img.height;
        const cr = w / h;
        let dw, dh, dx, dy;
        if (ir > cr) { dh = h; dw = h * ir; dx = (w - dw) / 2; dy = 0; }
        else         { dw = w; dh = w / ir; dx = 0; dy = (h - dh) / 2; }
        // Re-skin the single skyline per act via a hue-rotate filter.
        if (act.hue) {
            ctx.save();
            ctx.filter = `hue-rotate(${act.hue}deg) saturate(1.15)`;
            ctx.drawImage(img, dx, dy, dw, dh);
            ctx.restore();
        } else {
            ctx.drawImage(img, dx, dy, dw, dh);
        }
        // Per-act colour wash for mood (predictable even if filter unsupported).
        ctx.fillStyle = act.wash;
        ctx.fillRect(0, 0, w, h);
    } else {
        const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
        grad.addColorStop(0, '#1A1B3A');
        grad.addColorStop(1, '#0A0E1A');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        // Tint the fallback grid with the act accent.
        ctx.strokeStyle = withAlpha(act.accent, 0.08);
        const gridSize = 60;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x < w; x += gridSize) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
        for (let y = 0; y < h; y += gridSize) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
        ctx.stroke();
        // A soft act-accent wash so even the fallback reads as a new zone.
        ctx.fillStyle = act.wash;
        ctx.fillRect(0, 0, w, h);
    }

    for (const s of game.bgStars) {
        s.y += 0.02 * s.z * dt * (game.freezeTimer > 0 ? 0.25 : 1);
        if (s.y > h) { s.y = -2; s.x = Math.random() * w; }
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = act.star;
        ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;
}

function cannonPos() { return { x: game.w / 2, y: game.h - 60 }; }
function cannonFireScale() {
    if (game.fireT <= 0) return 1;
    const t = 1 - game.fireT / FIRE_ANIM_MS;
    const tri = t < 0.5 ? t / 0.5 : (1 - t) / 0.5;
    return 1 + 0.08 * tri;
}

function drawCannon(ctx, w, h) {
    const { x: cx, y: cy } = cannonPos();
    const fireBoost = game.fireT > 0 ? 0.35 : 0;
    const baseAlpha = 0.45 + fireBoost;

    const r = 120;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(0, 240, 255, ${baseAlpha})`);
    g.addColorStop(1, 'rgba(0, 240, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

    if (Assets.cannon) {
        const targetW = 180;
        const img = Assets.cannon;
        const aspect = img.height / img.width;
        const scale = cannonFireScale();
        const dw = targetW * scale;
        const dh = targetW * aspect * scale;
        const dx = cx - dw / 2;
        const dy = h - 20 - dh;
        ctx.drawImage(img, dx, dy, dw, dh);
    } else {
        ctx.fillStyle = '#1A1B3A';
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 26, Math.PI, 0);
        ctx.lineTo(cx + 36, cy + 20);
        ctx.lineTo(cx - 36, cy + 20);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }
}

function drawTargetingBeam(ctx, w, h) {
    if (!game.target) return;
    const { x: cx, y: cy } = cannonPos();
    const tx = game.target.x;
    const ty = game.target.y;
    const wave = Math.sin(performance.now() * 0.008) * 2;

    ctx.save();
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#00F0FF';
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 10);
    const mx = (cx + tx) / 2 + wave;
    const my = (cy + ty) / 2;
    ctx.quadraticCurveTo(mx, my, tx, ty);
    ctx.stroke();
    ctx.restore();

    for (let i = 0; i < 4; i++) {
        const t = ((performance.now() / 400) + i * 0.25) % 1;
        const x = lerp(cx, tx, t) + Math.sin(performance.now() * 0.01 + i) * 2;
        const y = lerp(cy - 10, ty, t);
        ctx.globalAlpha = 0.7 * (1 - t);
        ctx.fillStyle = '#00F0FF';
        ctx.shadowColor = '#00F0FF';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
}

function drawTwinChains(ctx) {
    const seen = new Set();
    for (const w of game.words) {
        if (w.type !== 'twin' || !w.partner || w.completed || w.partner.completed) continue;
        if (seen.has(w.partner)) continue;
        seen.add(w);
        const p = w.partner;
        const x1 = Math.min(w.x, p.x);
        const x2 = Math.max(w.x, p.x);
        const y1 = w.y;
        const y2 = p.y;
        const t = performance.now();
        const wave = Math.sin(t * 0.005) * 3;
        const midY = (y1 + y2) / 2 + wave;
        if (Assets.chainLink) {
            // Tile-stretch chain link texture between the two centers.
            const img = Assets.chainLink;
            const linkH = 22;
            const len = Math.hypot(x2 - x1, y2 - y1);
            const ang = Math.atan2(y2 - y1, x2 - x1);
            ctx.save();
            ctx.translate(x1, y1);
            ctx.rotate(ang);
            ctx.globalAlpha = 0.85;
            // Tile the texture along the length
            const tileW = (img.width / img.height) * linkH;
            const tiles = Math.max(1, Math.ceil(len / tileW));
            for (let i = 0; i < tiles; i++) {
                ctx.drawImage(img, i * tileW, -linkH / 2, tileW + 1, linkH);
            }
            ctx.restore();
            ctx.globalAlpha = 1;
        } else {
            // Dashed glowing line fallback
            ctx.save();
            ctx.strokeStyle = 'rgba(0, 255, 159, 0.6)';
            ctx.lineWidth = 4;
            ctx.setLineDash([10, 6]);
            ctx.shadowColor = '#00FF9F';
            ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.quadraticCurveTo((x1 + x2) / 2, midY, x2, y2);
            ctx.stroke();
            ctx.restore();
        }
    }
}

function drawWords(ctx) {
    const t = performance.now();
    for (const w of game.words) {
        if (w.type === 'boss') { drawBossWord(ctx, w); continue; }
        const xOff = Math.sin(w.wiggle) * 2;
        const x = w.x + xOff;
        const y = w.y;
        const isTarget = (w === game.target);
        const proximity = Math.min(1, w.y / floorY());
        const inDanger = (w.y / game.h) > 0.8;

    // Colorblind indicator: draw a shape/label above non-normal words
    if (isColorblind() && w.type !== 'boss') {
        const indicator = wordTypeIndicator(w.type);
        if (indicator) {
            ctx.save();
            ctx.font = `${Math.round(w.size * 0.6)}px VT323, monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillStyle = '#F0F4FF';
            ctx.globalAlpha = 0.85;
            ctx.fillText(indicator.trim(), x, y - w.size * 0.55);
            ctx.globalAlpha = 1;
            ctx.restore();
        }
    }


        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';

        let fontSize = w.size;
        if (w.type === 'bomb') {
            // Pulse 1.0 → 1.08 → 1.0 on ~600ms cycle (spec: Math.sin(time / 100))
            const pulse = 1.04 + 0.04 * Math.sin(t / 100);
            fontSize = Math.round(w.size * pulse);
        }
        ctx.font = `${fontSize}px VT323, monospace`;

        if (w.type === 'decoy') {
            // Ghost-cyan + strikethrough = "do not type". If the player ignores
            // the warning and locks one, the typed prefix renders in WARNING
            // ORANGE (not gold like real words) so it reads as wrong-doing,
            // and a 'BAIT' toast fires on completion.
            const alpha = isTarget
                ? 0.95                                  // pin to full when locked, no pulse
                : 0.55 + 0.30 * (0.5 + 0.5 * Math.sin(t / 1500 * 2 * Math.PI));
            ctx.globalAlpha = alpha;
            if (isTarget && w.typed > 0) {
                const totalW = w.width;
                const startX = x - totalW / 2;
                ctx.textAlign = 'left';
                const typed = w.text.slice(0, w.typed);
                const rest  = w.text.slice(w.typed);
                const typedW = ctx.measureText(typed).width;
                drawWordSegment(ctx, typed, startX, y, '#FF8A00', '#FF8A00', 14, false);
                drawWordSegment(ctx, rest,  startX + typedW, y, '#9fb0d8', '#9fb0d8', 10, false);
                ctx.textAlign = 'center';
            } else {
                drawWordSegment(ctx, w.text, x, y, '#9fb0d8', '#9fb0d8', 10, /*centered*/true);
            }
            // Strikethrough hint. Reuses the spawn-time width on the word —
            // no per-frame measureText for layout.
            ctx.strokeStyle = isTarget ? 'rgba(255, 138, 0, 0.85)' : 'rgba(159, 176, 216, 0.7)';
            ctx.lineWidth = isTarget ? 2 : 1.5;
            ctx.beginPath();
            ctx.moveTo(x - w.width / 2, y);
            ctx.lineTo(x + w.width / 2, y);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.restore();
            continue;
        }

        if (w.type === 'bonus') {
            // Gentle oscillation -3° → +3° on 1200ms cycle
            const ang = 3 * Math.PI / 180 * Math.sin(t / 1200 * 2 * Math.PI);
            ctx.translate(x, y);
            ctx.rotate(ang);
            if (isTarget) {
                const totalW = ctx.measureText(w.text).width;
                const startX = -totalW / 2;
                ctx.textAlign = 'left';
                const typed = w.text.slice(0, w.typed);
                const rest = w.text.slice(w.typed);
                const typedW = ctx.measureText(typed).width;
                drawWordSegment(ctx, typed, startX, 0, '#FFD93D', '#FFD93D', 16, false);
                drawWordSegment(ctx, rest,  startX + typedW, 0, '#FFD93D', '#FFD93D', 12, false);
            } else {
                drawWordCentered(ctx, w.text, 0, 0, '#FFD93D', '#FFD93D', 14);
            }
            ctx.restore();
            continue;
        }

        if (w.type === 'bomb') {
            if (isTarget) {
                const totalW = ctx.measureText(w.text).width;
                const startX = x - totalW / 2;
                ctx.textAlign = 'left';
                const typed = w.text.slice(0, w.typed);
                const rest = w.text.slice(w.typed);
                const typedW = ctx.measureText(typed).width;
                drawWordSegment(ctx, typed, startX, y, '#FFD93D', '#FFD93D', 12, false);
                drawWordSegment(ctx, rest,  startX + typedW, y, '#FF1744', '#FF1744', 18, false);
            } else if (inDanger) {
                const pulse = 0.85 + 0.15 * (0.5 + 0.5 * Math.sin(t * 0.012));
                ctx.globalAlpha = pulse;
                drawWordCentered(ctx, w.text, x, y, '#FF1744', '#FF1744', 20);
                ctx.globalAlpha = 1;
            } else {
                drawWordCentered(ctx, w.text, x, y, '#FF1744', '#FF1744', 14);
            }
            ctx.restore();
            continue;
        }

        if (w.type === 'twin') {
            const baseColor = w.frozen ? '#00FF9F' : '#00FF9F';
            const baseGlow = w.frozen ? 20 : 12;
            const pulse = w.frozen ? (0.85 + 0.15 * (0.5 + 0.5 * Math.sin(t * 0.012))) : 1;
            ctx.globalAlpha = pulse;
            if (isTarget) {
                const totalW = ctx.measureText(w.text).width;
                const startX = x - totalW / 2;
                ctx.textAlign = 'left';
                const typed = w.text.slice(0, w.typed);
                const rest = w.text.slice(w.typed);
                const typedW = ctx.measureText(typed).width;
                drawWordSegment(ctx, typed, startX, y, '#FFD93D', '#FFD93D', 12, false);
                drawWordSegment(ctx, rest,  startX + typedW, y, baseColor, baseColor, baseGlow + 4, false);
            } else {
                drawWordCentered(ctx, w.text, x, y, baseColor, baseColor, baseGlow);
            }
            ctx.globalAlpha = 1;
            ctx.restore();
            continue;
        }

        // Normal word
        if (isTarget) {
            const totalW = ctx.measureText(w.text).width;
            const startX = x - totalW / 2;
            ctx.textAlign = 'left';
            const typed = w.text.slice(0, w.typed);
            const rest = w.text.slice(w.typed);
            const typedW = ctx.measureText(typed).width;
            drawWordSegment(ctx, typed, startX, y, '#FFD93D', '#FFD93D', 12, false);
            drawWordSegment(ctx, rest,  startX + typedW, y, '#00F0FF', '#00F0FF', 16, false);
        } else if (inDanger) {
            const pulse = 0.85 + 0.15 * (0.5 + 0.5 * Math.sin(t * 0.012));
            ctx.globalAlpha = pulse;
            drawWordCentered(ctx, w.text, x, y, '#FF8A00', '#FF8A00', 20);
            ctx.globalAlpha = 1;
        } else {
            drawWordCentered(ctx, w.text, x, y, '#F0F4FF', null, 0);
        }
        ctx.restore();
    }
}

function drawBossWord(ctx, boss) {
    const t = performance.now();
    ctx.save();
    ctx.font = `${boss.size}px VT323, monospace`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    const y = boss.y;
    // When the countdown is low, the whole boss pulses toward danger red.
    const frac = boss.timeLimit > 0 ? Math.max(0, Math.min(1, boss.timeLeft / boss.timeLimit)) : 1;
    const lowTime = frac < 0.25;
    for (const li of boss.letters) {
        if (!li.alive) continue;
        const x = boss.startX + li.cx - li.w / 2;
        let col = '#FF2E97', glowCol = '#FF2E97', glow = 30;
        if (li.regrowT && li.regrowT > 0) {
            // Just regrew — orange flash that fades back.
            col = '#FF8A00'; glowCol = '#FF8A00'; glow = 34;
        } else if (lowTime) {
            const pulse = 0.5 + 0.5 * Math.sin(t * 0.02);
            col = pulse > 0.5 ? '#FF1744' : '#FF2E97';
            glowCol = '#FF1744';
            glow = 36;
        }
        drawWordSegment(ctx, li.ch, x, y, col, glowCol, glow, false);
        if (li.regrowT && li.regrowT > 0) li.regrowT = Math.max(0, li.regrowT - 16);
    }
    ctx.restore();
}

// 3-pass: dark plate (double draw), dark stroke outline, then colored fill.
function drawWordSegment(ctx, str, x, y, fillColor, glowColor, glowBlur, _centered) {
    if (!str) return;
    ctx.save();
    ctx.shadowBlur = 24;
    ctx.shadowColor = '#0A0E1A';
    ctx.fillStyle = '#0A0E1A';
    ctx.fillText(str, x, y);
    ctx.fillText(str, x, y);
    ctx.restore();

    ctx.strokeStyle = '#0A0E1A';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeText(str, x, y);

    if (glowColor) { ctx.shadowBlur = glowBlur; ctx.shadowColor = glowColor; }
    else           { ctx.shadowBlur = 0; }
    ctx.fillStyle = fillColor;
    ctx.fillText(str, x, y);
    ctx.shadowBlur = 0;
}

function drawWordCentered(ctx, str, x, y, fillColor, glowColor, glowBlur) {
    drawWordSegment(ctx, str, x, y, fillColor, glowColor, glowBlur, true);
}

function drawBullets(ctx) {
    for (const b of game.bullets) {
        const t = b.life / b.max;
        ctx.globalAlpha = Math.max(0, 1 - t);
        ctx.fillStyle = '#00F0FF';
        ctx.shadowColor = '#00F0FF';
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
}

function drawParticles(ctx) {
    for (const p of game.particles) {
        const life01 = Math.max(0, p.life / p.max);
        const alpha = life01;
        const scale = 0.4 + life01 * 0.6;
        ctx.globalAlpha = alpha;
        if (p.kind === 'shard' && Assets.shardNeon) {
            const sz = p.size * scale;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.drawImage(Assets.shardNeon, -sz / 2, -sz / 2, sz, sz);
            ctx.restore();
            continue;
        }
        if (p.kind === 'shard') {
            // canvas fallback for shard: thin triangle
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.fillStyle = '#00F0FF';
            ctx.shadowColor = '#00F0FF'; ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.moveTo(0, -p.size * 0.4 * scale);
            ctx.lineTo(p.size * 0.2 * scale, p.size * 0.4 * scale);
            ctx.lineTo(-p.size * 0.2 * scale, p.size * 0.4 * scale);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
            continue;
        }
        const sprite = p.kind === 'magenta' ? Assets.sparkMagenta : Assets.sparkCyan;
        if (sprite && (p.kind === 'cyan' || p.kind === 'magenta')) {
            const sz = p.size * scale;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.drawImage(sprite, -sz / 2, -sz / 2, sz, sz);
            ctx.restore();
        } else {
            const col = ({
                magenta: '#FF2E97', cyan: '#00F0FF',
                gold: '#FFD93D', red: '#FF1744', green: '#00FF9F',
            })[p.kind] || '#00F0FF';
            ctx.fillStyle = col;
            ctx.fillRect(p.x - p.size * scale / 4, p.y - p.size * scale / 4, p.size * scale / 2, p.size * scale / 2);
        }
    }
    ctx.globalAlpha = 1;
}

function drawFloaters(ctx) {
    for (const f of game.floaters) {
        const a = Math.min(1, f.life / 400);
        ctx.globalAlpha = a;
        ctx.font = `400 ${Math.round(f.size * 1.1)}px 'Monoton', Impact, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = f.color;
        ctx.shadowColor = f.color;
        ctx.shadowBlur = 18;
        ctx.fillText(f.text, f.x, f.y);
        ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
}

function drawShieldAura(ctx, w, h) {
    const cx = w / 2, cy = h - 60;
    const r = 90 + 4 * Math.sin(performance.now() * 0.005);
    ctx.strokeStyle = 'rgba(0, 255, 159, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(0, 255, 159, 0.2)';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
}

// ---------- Canvas HUD ----------
function drawTopHud(ctx, w, h) {
    ctx.fillStyle = 'rgba(10, 14, 26, 0.75)';
    ctx.fillRect(0, 0, w, TOP_HUD_H);
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, TOP_HUD_H + 0.5); ctx.lineTo(w, TOP_HUD_H + 0.5); ctx.stroke();

    const padX = 24;
    const labelFont = "400 11px Inter, sans-serif";
    const valueBigFont = "400 28px 'Monoton', Impact, sans-serif";
    const valueFont    = "600 22px Inter, sans-serif";

    ctx.textBaseline = 'alphabetic';

    let x = padX, y = 22;
    ctx.font = labelFont; ctx.fillStyle = '#6B7299';
    ctx.textAlign = 'left'; ctx.fillText('SCORE', x, y);
    ctx.font = valueBigFont; ctx.fillStyle = '#F0F4FF';
    ctx.fillText(String(game.score), x, y + 28);

    x = padX + 180;
    ctx.font = labelFont; ctx.fillStyle = '#6B7299';
    ctx.fillText('LEVEL', x, y);
    ctx.font = valueBigFont; ctx.fillStyle = '#F0F4FF';
    ctx.fillText(String(game.level), x, y + 28);

    ctx.textAlign = 'center';
    ctx.font = labelFont; ctx.fillStyle = '#6B7299';
    ctx.fillText('MODE', w / 2, y);
    ctx.font = "400 22px 'Monoton', Impact, sans-serif"; ctx.fillStyle = '#00F0FF';
    ctx.shadowColor = '#00F0FF'; ctx.shadowBlur = 12;
    ctx.fillText(game.mode.toUpperCase(), w / 2, y + 24);
    ctx.shadowBlur = 0;

    ctx.textAlign = 'right';
    // Right side: hearts OR boss progress bar
    let rightConsumed = 0;
    if (game.bossState === 'fighting' && game.bossActive) {
        rightConsumed = drawBossProgressBar(ctx, w - padX, 14);
    } else {
        rightConsumed = drawHearts(ctx, w - padX, 30);
    }
    const wpmRight = w - padX - rightConsumed - 24;
    ctx.font = labelFont; ctx.fillStyle = '#6B7299';
    ctx.fillText('WPM', wpmRight, y);
    ctx.font = valueFont; ctx.fillStyle = '#F0F4FF';
    ctx.fillText(String(currentWPM()), wpmRight, y + 26);
}

function drawHearts(ctx, rightX, centerY) {
    const maxLives = game.mode === 'hardcore' ? 1 : (game.mode === 'sprint' ? 3 : 5);
    const spacing = 24, heartSize = 16;
    const totalW = (maxLives - 1) * spacing + heartSize;
    const startX = rightX - totalW + heartSize / 2;
    for (let i = 0; i < maxLives; i++) {
        const cx = startX + i * spacing;
        const cy = centerY;
        const lost = i >= game.lives;
        const fx = game.heartFx.find(h => h.idx === i);
        let scale = 1, color = '#FF2E97';
        if (fx) {
            const t = 1 - fx.life / HEART_FX_DURATION_MS;
            scale = 1 + 0.5 * Math.sin(t * Math.PI);
            color = '#F0F4FF';
        } else if (lost) {
            color = 'rgba(255, 46, 151, 0.18)';
        }
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);
        ctx.fillStyle = color;
        if (!lost || fx) { ctx.shadowColor = '#FF2E97'; ctx.shadowBlur = 8; }
        drawHeartPath(ctx, heartSize);
        ctx.fill();
        ctx.restore();
    }
    return totalW;
}

function drawHeartPath(ctx, size) {
    const s = size / 16;
    ctx.beginPath();
    ctx.moveTo(0, 5 * s);
    ctx.bezierCurveTo(0,   2 * s,  -3 * s,  -3 * s,  -6 * s, -3 * s);
    ctx.bezierCurveTo(-9 * s,  -3 * s, -9 * s,  3 * s,  -9 * s,  3 * s);
    ctx.bezierCurveTo(-9 * s,  6 * s,  -3 * s,  9 * s,   0,    11 * s);
    ctx.bezierCurveTo( 3 * s,  9 * s,   9 * s,  6 * s,   9 * s,  3 * s);
    ctx.bezierCurveTo( 9 * s,  3 * s,   9 * s, -3 * s,   6 * s, -3 * s);
    ctx.bezierCurveTo( 3 * s, -3 * s,   0,    2 * s,   0,    5 * s);
    ctx.closePath();
}

function drawBossProgressBar(ctx, rightX, topY) {
    const boss = game.bossActive;
    const remaining = boss.text.length - boss.typed;
    const barW = Math.round(game.w * 0.18);
    const x = rightX - barW;
    const t = performance.now();

    // --- Letters-typed progress bar (cyan) ---
    const pH = 8;
    let y = topY;
    ctx.fillStyle = '#0A0E1A';
    ctx.strokeStyle = '#FF2E97';
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, barW, pH, 3);
    ctx.fill();
    ctx.stroke();
    const filled = boss.typed / boss.text.length;
    if (filled > 0) {
        ctx.fillStyle = '#00F0FF';
        roundRect(ctx, x + 2, y + 2, (barW - 4) * filled, pH - 4, 2);
        ctx.fill();
    }

    // --- Countdown timer bar (cyan → gold → red as it drains) ---
    const tH = 6;
    y = topY + pH + 4;
    const frac = boss.timeLimit > 0 ? Math.max(0, Math.min(1, boss.timeLeft / boss.timeLimit)) : 0;
    const low = frac < 0.25;
    const timerCol = frac > 0.5 ? '#00F0FF' : (frac > 0.25 ? '#FFD93D' : '#FF1744');
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, barW, tH, 3);
    ctx.fill();
    ctx.stroke();
    if (frac > 0) {
        const pulse = low ? (0.6 + 0.4 * (0.5 + 0.5 * Math.sin(t * 0.02))) : 1;
        ctx.globalAlpha = pulse;
        ctx.fillStyle = timerCol;
        roundRect(ctx, x + 1, y + 1, (barW - 2) * frac, tH - 2, 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }

    // --- Label: letters left + seconds remaining ---
    const secs = Math.max(0, boss.timeLeft / 1000);
    ctx.font = "400 13px VT323, monospace";
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#F0F4FF';
    ctx.fillText(`BOSS · ${remaining} LEFT`, rightX, y + tH + 3);
    // seconds, colour-coded, on the left of the same line
    ctx.textAlign = 'left';
    ctx.fillStyle = timerCol;
    if (low) { ctx.shadowColor = '#FF1744'; ctx.shadowBlur = 8; }
    ctx.fillText(`${secs.toFixed(1)}s`, x, y + tH + 3);
    ctx.shadowBlur = 0;
    return barW;
}

function drawBottomHud(ctx, w, h) {
    const top = h - BOTTOM_HUD_H;
    ctx.fillStyle = 'rgba(10, 14, 26, 0.75)';
    ctx.fillRect(0, top, w, BOTTOM_HUD_H);
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, top + 0.5); ctx.lineTo(w, top + 0.5); ctx.stroke();

    drawPowerupSlots(ctx, 24, top + 17, w);
    drawComboReadout(ctx, w - 24, top + 22);
}

function drawPowerupSlots(ctx, x0, y0, totalW) {
    const slots = ['freeze', 'bomb', 'shield'];
    const hotkeys = { freeze: 'F', bomb: 'B', shield: 'S' };
    const sz = 56, gap = 6;
    game.powerupRects.length = 0;
    const t = performance.now();
    for (let i = 0; i < slots.length; i++) {
        const kind = slots[i];
        const x = x0 + i * (sz + gap);
        const y = y0;
        const has = game.powerups[kind] > 0;
        ctx.save();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.3)';
        ctx.lineWidth = 1;
        roundRect(ctx, x, y, sz, sz, 8);
        ctx.fill();
        ctx.stroke();
        if (has) {
            const pulse = 0.3 + 0.2 * (0.5 + 0.5 * Math.sin(t * 0.005));
            ctx.shadowColor = `rgba(0, 240, 255, ${pulse + 0.2})`;
            ctx.shadowBlur = 14;
            ctx.strokeStyle = `rgba(0, 240, 255, ${0.5 + pulse})`;
            ctx.lineWidth = 2;
            roundRect(ctx, x, y, sz, sz, 8);
            ctx.stroke();
            ctx.shadowBlur = 0;
        }
        ctx.restore();

        const iconAsset = Assets[PU_ICON[kind]];
        if (iconAsset) {
            ctx.globalAlpha = has ? 1 : 0.2;
            const iSz = 40;
            ctx.drawImage(iconAsset, x + (sz - iSz) / 2, y + (sz - iSz) / 2, iSz, iSz);
            ctx.globalAlpha = 1;
        } else {
            ctx.font = "400 26px 'Monoton', Impact, sans-serif";
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = has ? '#00F0FF' : 'rgba(240, 244, 255, 0.2)';
            if (has) { ctx.shadowColor = '#00F0FF'; ctx.shadowBlur = 10; }
            ctx.fillText(hotkeys[kind], x + sz / 2, y + sz / 2);
            ctx.shadowBlur = 0;
        }

        // Hotkey label now shows the Shift combo (⇧F / ⇧B / ⇧S).
        ctx.font = '14px VT323, monospace';
        ctx.fillStyle = '#9fb0d8';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('⇧' + hotkeys[kind], x + sz / 2, y + sz + 2);

        if (game.powerups[kind] > 1) {
            ctx.font = "700 12px Inter, sans-serif";
            ctx.fillStyle = '#FFD93D';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'top';
            ctx.fillText('×' + game.powerups[kind], x + sz - 4, y + 4);
        }

        game.powerupRects.push({ kind, x, y, w: sz, h: sz });
    }
}

function drawComboReadout(ctx, rightX, y0) {
    const barW = 220, barH = 6;
    const fill = Math.max(0, Math.min(1, game.comboTimer / COMBO_TIMEOUT_MS));
    const x = rightX - barW;

    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.font = "400 11px Inter, sans-serif";
    ctx.fillStyle = '#6B7299';
    ctx.fillText('COMBO  ·  MULT', rightX, y0);

    ctx.font = "400 28px 'Monoton', Impact, sans-serif";
    ctx.fillStyle = '#00F0FF';
    ctx.shadowColor = '#00F0FF'; ctx.shadowBlur = 14;
    ctx.fillText(`${game.combo}x`, rightX - 110, y0 + 28);
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#FF2E97';
    ctx.shadowColor = '#FF2E97'; ctx.shadowBlur = 14;
    ctx.fillText(`${game.multiplier.toFixed(1)}x`, rightX, y0 + 28);
    ctx.shadowBlur = 0;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    roundRect(ctx, x, y0 + 38, barW, barH, 3);
    ctx.fill();
    if (fill > 0) {
        const grad = ctx.createLinearGradient(x, 0, x + barW, 0);
        grad.addColorStop(0, '#00F0FF');
        grad.addColorStop(1, '#FF2E97');
        ctx.fillStyle = grad;
        roundRect(ctx, x, y0 + 38, barW * fill, barH, 3);
        ctx.fill();
    }
}

function drawSprintTimer(ctx, w) {
    const t = Math.max(0, game.sprintTimeLeft) / 1000;
    ctx.font = `400 36px 'Monoton', Impact, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = t < 10 ? '#FF1744' : '#F0F4FF';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 18;
    ctx.fillText(`${t.toFixed(1)}s`, w / 2, TOP_HUD_H + 50);
    ctx.shadowBlur = 0;
}

function drawBossWarningOverlay() {
    const ctx = game.ctx, w = game.w, h = game.h;
    const t = performance.now();
    // Red gradient backdrop (or use bossWarning asset if available)
    ctx.save();
    if (Assets.bossWarning) {
        const img = Assets.bossWarning;
        const targetH = Math.min(h * 0.45, 360);
        const aspect = img.width / img.height;
        const dh = targetH;
        const dw = Math.min(w, targetH * aspect);
        const dx = (w - dw) / 2;
        const dy = (h - dh) / 2;
        ctx.globalAlpha = 0.9;
        ctx.drawImage(img, dx, dy, dw, dh);
    } else {
        const grad = ctx.createLinearGradient(0, h / 2 - 120, 0, h / 2 + 120);
        grad.addColorStop(0, 'rgba(255, 23, 68, 0.0)');
        grad.addColorStop(0.5, 'rgba(255, 23, 68, 0.45)');
        grad.addColorStop(1, 'rgba(255, 23, 68, 0.0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, h / 2 - 120, w, 240);
        // Horizontal hazard stripes
        ctx.strokeStyle = 'rgba(255, 23, 68, 0.55)';
        ctx.lineWidth = 12;
        ctx.setLineDash([24, 24]);
        ctx.lineDashOffset = -(t * 0.05) % 48;
        ctx.beginPath();
        ctx.moveTo(0, h / 2 - 80); ctx.lineTo(w, h / 2 - 80);
        ctx.moveTo(0, h / 2 + 80); ctx.lineTo(w, h / 2 + 80);
        ctx.stroke();
        ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;

    // BOSS INCOMING text
    ctx.font = "400 64px 'Monoton', Impact, sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const pulse = 0.85 + 0.15 * (0.5 + 0.5 * Math.sin(t * 0.012));
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#FF1744';
    ctx.shadowColor = '#FF1744'; ctx.shadowBlur = 30;
    ctx.fillText('BOSS INCOMING', w / 2, h / 2);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    ctx.restore();
}

function drawDetonatedOverlay() {
    const ctx = game.ctx, w = game.w, h = game.h;
    ctx.save();
    ctx.fillStyle = 'rgba(255, 23, 68, 0.45)';
    ctx.fillRect(0, 0, w, h);
    ctx.font = "400 96px 'Monoton', Impact, sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#FF1744';
    ctx.shadowColor = '#FF1744'; ctx.shadowBlur = 40;
    ctx.fillText('DETONATED', w / 2, h / 2);
    ctx.shadowBlur = 0;
    ctx.restore();
}

// ---------- Helpers ----------
function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}
function withAlpha(hex, a) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16),
          g = parseInt(h.slice(2, 4), 16),
          b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}
function show(id) { document.getElementById(id).classList.add('show'); }
function hide(id) { document.getElementById(id).classList.remove('show'); }
function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

// ====================================================================
// Step 4 — Share cards
// ====================================================================
const SHARE_URL = 'passionetai.github.io/wordfall';

function formatShareDate(d) {
    const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function generateShareCard(stats) {
    const W = 1200, H = 630;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');

    // Background
    if (Assets.shareCardBg) {
        ctx.drawImage(Assets.shareCardBg, 0, 0, W, H);
        // Dim overlay so text stays legible regardless of art brightness.
        ctx.fillStyle = 'rgba(10, 14, 26, 0.55)';
        ctx.fillRect(0, 0, W, H);
    } else {
        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, '#0A0E1A');
        grad.addColorStop(1, '#1A1B3A');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
        // Faint neon decorative strokes
        ctx.save();
        ctx.lineWidth = 2;
        for (let i = 0; i < 5; i++) {
            ctx.strokeStyle = i % 2 ? 'rgba(255, 46, 151, 0.18)' : 'rgba(0, 240, 255, 0.16)';
            const y = 80 + i * 110 + (i * 13);
            ctx.beginPath();
            ctx.moveTo(40, y);
            ctx.bezierCurveTo(W * 0.35, y - 40, W * 0.65, y + 60, W - 40, y - 10);
            ctx.stroke();
        }
        ctx.restore();
    }

    // Logo (top-left)
    const LOGO_PAD = 40;
    if (Assets.logo) {
        const lw = 200;
        const aspect = Assets.logo.height / Assets.logo.width;
        ctx.drawImage(Assets.logo, LOGO_PAD, LOGO_PAD, lw, lw * aspect);
    } else {
        ctx.font = "400 56px 'Monoton', Impact, sans-serif";
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillStyle = '#00F0FF';
        ctx.shadowColor = '#00F0FF'; ctx.shadowBlur = 18;
        ctx.fillText('WORD', LOGO_PAD, LOGO_PAD);
        ctx.fillStyle = '#FF2E97';
        ctx.shadowColor = '#FF2E97';
        ctx.fillText('FALL', LOGO_PAD + 170, LOGO_PAD);
        ctx.shadowBlur = 0;
    }

    // Mode badge (top-right)
    const modeLabel = stats.mode === 'daily' ? 'DAILY CHALLENGE' : String(stats.mode || 'CLASSIC').toUpperCase();
    ctx.font = "700 18px Inter, sans-serif";
    const badgePadX = 16;
    const badgeH = 30;
    const bw = ctx.measureText(modeLabel).width + badgePadX * 2;
    const bx = W - LOGO_PAD - bw;
    const by = LOGO_PAD + 4;
    ctx.fillStyle = 'rgba(255, 46, 151, 0.2)';
    ctx.strokeStyle = '#FF2E97';
    ctx.lineWidth = 1;
    roundRect(ctx, bx, by, bw, badgeH, 999);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#FF2E97';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(modeLabel, bx + bw / 2, by + badgeH / 2 + 1);

    // FINAL SCORE label
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = "400 24px VT323, monospace";
    ctx.fillStyle = '#F0F4FF';
    ctx.fillText('FINAL SCORE', W / 2, 235);

    // Big score number with magenta drop-shadow
    const scoreStr = String(stats.score);
    ctx.font = "400 140px 'Monoton', Impact, sans-serif";
    // shadow pass
    ctx.fillStyle = '#FF2E97';
    ctx.fillText(scoreStr, W / 2 + 4, 360 + 4);
    // main pass
    ctx.fillStyle = '#00F0FF';
    ctx.shadowColor = '#00F0FF'; ctx.shadowBlur = 0;
    ctx.fillText(scoreStr, W / 2, 360);

    // Three stat plates
    const plates = [
        { label: 'WPM',           value: String(stats.wpm),          big: true  },
        { label: 'MAX COMBO',     value: String(stats.longestCombo), big: true  },
        { label: 'LONGEST WORD',  value: String(stats.longestWord || '—').toUpperCase(), big: false },
    ];
    const plateW = 240, plateH = 120, gap = 24;
    const platesTotalW = 3 * plateW + 2 * gap;
    const pStartX = (W - platesTotalW) / 2;
    const pY = 420;
    plates.forEach((p, i) => {
        const px = pStartX + i * (plateW + gap);
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.5)';
        ctx.lineWidth = 1;
        roundRect(ctx, px, pY, plateW, plateH, 12);
        ctx.fill(); ctx.stroke();
        // label
        ctx.font = "400 18px VT323, monospace";
        ctx.fillStyle = '#6B7299';
        ctx.textAlign = 'center';
        ctx.fillText(p.label, px + plateW / 2, pY + 30);
        // value
        ctx.fillStyle = '#00F0FF';
        if (p.big) {
            ctx.font = "400 48px 'Monoton', Impact, sans-serif";
            ctx.fillText(p.value, px + plateW / 2, pY + 86);
        } else {
            ctx.font = "400 36px 'Monoton', Impact, sans-serif";
            const val = fitText(ctx, p.value, plateW - 20);
            ctx.fillText(val, px + plateW / 2, pY + 86);
        }
        ctx.restore();
    });

    // Decorative dots
    for (let i = 0; i < 11; i++) {
        const dx = 40 + Math.floor(Math.random() * (W - 80));
        const dy = 560 + Math.floor(Math.random() * 50);
        ctx.globalAlpha = 0.3 + Math.random() * 0.3;
        ctx.fillStyle = i % 2 ? '#FF2E97' : '#00F0FF';
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(dx, dy, 3 + Math.random() * 3, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    // Site URL (bottom-left), Date (bottom-right)
    ctx.font = "400 16px Inter, sans-serif";
    ctx.fillStyle = '#6B7299';
    ctx.textAlign = 'left';  ctx.textBaseline = 'alphabetic';
    ctx.fillText(SHARE_URL, LOGO_PAD, H - LOGO_PAD);
    ctx.textAlign = 'right';
    ctx.fillText(formatShareDate(stats.date || new Date()), W - LOGO_PAD, H - LOGO_PAD);

    return c.toDataURL('image/png');
}

function fitText(ctx, str, maxW) {
    if (ctx.measureText(str).width <= maxW) return str;
    let s = str;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s + '…';
}

function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

// Convert a data URL to a Blob (no fetch, more reliable for offline pages)
function dataURLToBlob(dataURL) {
    const [meta, b64] = dataURL.split(',');
    const mime = (meta.match(/data:(.*?);base64/) || [])[1] || 'image/png';
    const bin = atob(b64);
    const len = bin.length;
    const buf = new Uint8Array(len);
    for (let i = 0; i < len; i++) buf[i] = bin.charCodeAt(i);
    return new Blob([buf], { type: mime });
}

function shareToast(msg) {
    const el = document.getElementById('share-toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(shareToast._t);
    shareToast._t = setTimeout(() => el.classList.remove('show'), 2000);
}

async function handleShare() {
    const dataURL = game.lastShareDataURL;
    if (!dataURL) { shareToast('Nothing to share yet'); return; }
    const blob = dataURLToBlob(dataURL);
    const filename = `wordfall-${game.mode || 'classic'}-${game.score}.png`;
    const text = game.isDaily
        ? `I scored ${game.score} on today's Word Fall Daily Challenge! \u{1F3AF} Try today's puzzle: ${SHARE_URL}`
        : `I scored ${game.score} on Word Fall! \u{1F3AE} Can you beat it? ${SHARE_URL}`;

    // 1) navigator.share with file
    try {
        if (navigator.canShare && navigator.share) {
            const file = new File([blob], filename, { type: 'image/png' });
            if (navigator.canShare({ files: [file] })) {
                await navigator.share({ files: [file], text, title: 'Word Fall' });
                return;
            }
        }
    } catch (e) { /* fall through */ }

    // 2) Clipboard image
    try {
        if (navigator.clipboard && window.ClipboardItem) {
            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blob }),
            ]);
            shareToast('Copied to clipboard!');
            return;
        }
    } catch (e) { /* fall through */ }

    // 3) Download
    triggerDownload(dataURL, filename);
    shareToast('Downloaded image');
}

function triggerDownload(dataURL, filename) {
    const a = document.createElement('a');
    a.href = dataURL;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

async function handleCopyScore() {
    const text = game.isDaily
        ? `I scored ${game.score} on today's Word Fall Daily Challenge! \u{1F3AF} Try today's puzzle: ${SHARE_URL}`
        : `I scored ${game.score} on Word Fall! \u{1F3AE} Can you beat it? ${SHARE_URL}`;
    try {
        await navigator.clipboard.writeText(text);
        shareToast('Copied!');
    } catch (e) {
        shareToast('Copy failed');
    }
}

function handleDownload() {
    if (!game.lastShareDataURL) return;
    triggerDownload(game.lastShareDataURL, `wordfall-${game.mode || 'classic'}-${game.score}.png`);
    shareToast('Downloaded image');
}

// ====================================================================
// Step 4 — Daily card / Daily-played modal / Stats modal
// ====================================================================
function refreshDailyCard() {
    const dateEl = document.getElementById('daily-date');
    const stateEl = document.getElementById('daily-state');
    const cdEl = document.getElementById('daily-countdown');
    const sparkCv = document.getElementById('daily-spark');
    if (!dateEl) return;
    dateEl.textContent = todayKey();
    const r = getDailyResult();
    if (r) {
        stateEl.textContent = `✓ Played · ${r.score}`;
        cdEl.textContent = `Next in ${formatHMS(msUntilNextUTCMidnight())}`;
    } else {
        stateEl.textContent = '';
        cdEl.textContent = '';
    }
    drawDailySparkline(sparkCv);
}
function drawDailySparkline(canvasEl) {
    if (!canvasEl) return;
    const scores = last7DailyScores();
    if (!scores.some(s => s != null)) {
        canvasEl.classList.remove('has-data');
        return;
    }
    canvasEl.classList.add('has-data');
    const ctx = canvasEl.getContext('2d');
    const w = canvasEl.width, h = canvasEl.height;
    ctx.clearRect(0, 0, w, h);
    const values = scores.map(s => s == null ? 0 : s);
    const max = Math.max(...values, 1);
    const stepX = w / (values.length - 1);
    ctx.strokeStyle = '#00F0FF';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = '#00F0FF';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    for (let i = 0; i < values.length; i++) {
        const x = i * stepX;
        const y = h - 2 - (values[i] / max) * (h - 4);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
}

let dailyCountdownTimer = null;
function startDailyCountdownTick() {
    stopDailyCountdownTick();
    dailyCountdownTimer = setInterval(() => {
        const cdEl = document.getElementById('daily-countdown');
        const r = getDailyResult();
        if (r && cdEl) cdEl.textContent = `Next in ${formatHMS(msUntilNextUTCMidnight())}`;
        const modalCd = document.getElementById('dp-countdown');
        if (modalCd) modalCd.textContent = formatHMS(msUntilNextUTCMidnight());
    }, 1000);
}
function stopDailyCountdownTick() {
    if (dailyCountdownTimer) clearInterval(dailyCountdownTimer);
    dailyCountdownTimer = null;
}

function showDailyPlayedModal(result) {
    document.getElementById('dp-score').textContent = result.score;
    document.getElementById('dp-wpm').textContent   = result.wpm   || 0;
    document.getElementById('dp-combo').textContent = result.combo || 0;
    document.getElementById('dp-countdown').textContent = formatHMS(msUntilNextUTCMidnight());
    show('daily-played');
}

function populateStatsModal() {
    const lifetime = loadLifetime();
    const ach = loadAchievementsState();
    const list = document.getElementById('lifetime-stats');
    const rows = [
        ['Games played',          lifetime.gamesPlayed],
        ['Words destroyed',       lifetime.totalWordsDestroyed],
        ['Bosses defeated',       lifetime.totalBossesDefeated],
        ['Bombs defused',         lifetime.totalBombsDefused],
        ['Daily completions',     lifetime.totalDailyCompleted],
        ['Time played',           formatPlaytime(lifetime.totalTimePlayedSeconds)],
        ['Best WPM',              lifetime.bestWPM],
        ['Best combo',            lifetime.bestCombo],
        ['Best — Classic',        lifetime.bestScoreClassic],
        ['Best — Sprint',         lifetime.bestScoreSprint],
        ['Best — Hardcore',       lifetime.bestScoreHardcore],
        ['Best — Daily',          lifetime.bestScoreDaily],
    ];
    list.innerHTML = rows.map(([k, v]) =>
        `<div class="row"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v)}</span></div>`
    ).join('');
    const grid = document.getElementById('ach-grid');
    grid.innerHTML = ACHIEVEMENTS.map(a => {
        const unlocked = !!(ach[a.id] && ach[a.id].unlocked);
        return `<div class="ach-cell ${unlocked ? 'unlocked' : 'locked'}" title="${escapeHtml(a.description)}">` +
               `<div class="icon">${a.icon}</div>` +
               `<div class="name">${escapeHtml(a.name)}</div>` +
               `</div>`;
    }).join('');
}

function formatPlaytime(seconds) {
    if (!seconds) return '0s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h) return `${h}h ${m}m`;
    return `${m}m ${seconds % 60}s`;
}

// ====================================================================
// Step 4 — Touch UI (keyboard, power-ups, pause button, tap-to-lock)
// ====================================================================
const KB_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

function computeTouchKeyboardRects() {
    game.touchKeys.length = 0;
    if (!isTouchActive()) return;
    const w = game.w, h = game.h;
    const kbTop = h - BOTTOM_HUD_H - TOUCH_KB_H;
    const rowH = 50;
    const rowGap = 6;
    const sidePad = 8;
    KB_ROWS.forEach((row, ri) => {
        const isLast = ri === KB_ROWS.length - 1;
        const cells = isLast ? row.length + 1 : row.length; // backspace key on last row
        const usable = w - sidePad * 2;
        const keyW = Math.floor((usable - (cells - 1) * 4) / cells);
        const startX = sidePad + (usable - (keyW * cells + (cells - 1) * 4)) / 2;
        const y = kbTop + ri * (rowH + rowGap);
        for (let i = 0; i < row.length; i++) {
            game.touchKeys.push({
                ch: row[i],
                x: startX + i * (keyW + 4),
                y, w: keyW, h: rowH,
                flashT: 0,
            });
        }
        if (isLast) {
            game.touchKeys.push({
                ch: 'BACKSPACE',
                x: startX + row.length * (keyW + 4),
                y, w: keyW, h: rowH,
                flashT: 0,
            });
        }
    });
}

function drawTouchKeyboard(ctx) {
    if (!isTouchActive()) return;
    if (!game.touchKeys.length) computeTouchKeyboardRects();
    for (const k of game.touchKeys) {
        const press = k.flashT > 0;
        const sc = press ? 0.95 : 1;
        const dx = k.x + (1 - sc) * k.w / 2;
        const dy = k.y + (1 - sc) * k.h / 2;
        const dw = k.w * sc, dh = k.h * sc;
        ctx.save();
        ctx.fillStyle = press ? 'rgba(0, 240, 255, 0.3)' : 'rgba(0, 0, 0, 0.6)';
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
        ctx.lineWidth = 1;
        roundRect(ctx, dx, dy, dw, dh, 6);
        ctx.fill(); ctx.stroke();
        ctx.font = '400 22px VT323, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#F0F4FF';
        ctx.shadowColor = '#00F0FF'; ctx.shadowBlur = 6;
        if (k.ch === 'BACKSPACE') {
            ctx.fillText('⌫', dx + dw / 2, dy + dh / 2 + 1);
        } else {
            ctx.fillText(k.ch.toUpperCase(), dx + dw / 2, dy + dh / 2 + 1);
        }
        ctx.shadowBlur = 0;
        ctx.restore();
        if (k.flashT > 0) k.flashT = Math.max(0, k.flashT - 16);
    }
}

function drawTouchPowerups(ctx) {
    if (!isTouchActive()) return;
    const w = game.w, h = game.h;
    const baseY = h - BOTTOM_HUD_H - TOUCH_KB_H - TOUCH_PU_H + 12;
    const size = 64, gap = 18;
    const slots = ['freeze', 'bomb', 'shield'];
    const totalW = slots.length * size + (slots.length - 1) * gap;
    const startX = (w - totalW) / 2;
    game.touchPowerupRects.length = 0;
    const t = performance.now();
    for (let i = 0; i < slots.length; i++) {
        const kind = slots[i];
        const has = game.powerups[kind] > 0;
        const x = startX + i * (size + gap);
        const y = baseY;
        // Halo
        if (has) {
            const r = size / 2 + 8 + 2 * Math.sin(t * 0.005);
            ctx.beginPath();
            ctx.arc(x + size / 2, y + size / 2, r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0, 240, 255, 0.18)';
            ctx.fill();
        }
        // Circle
        ctx.save();
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
        ctx.fillStyle = has ? 'rgba(0, 0, 0, 0.65)' : 'rgba(0, 0, 0, 0.45)';
        ctx.fill();
        ctx.strokeStyle = has ? '#00F0FF' : 'rgba(0, 240, 255, 0.3)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
        // Icon
        const asset = Assets[PU_ICON[kind]];
        if (asset) {
            ctx.globalAlpha = has ? 1 : 0.3;
            const iSz = 40;
            ctx.drawImage(asset, x + (size - iSz) / 2, y + (size - iSz) / 2, iSz, iSz);
            ctx.globalAlpha = 1;
        } else {
            ctx.font = "400 28px 'Monoton', Impact, sans-serif";
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = has ? '#00F0FF' : 'rgba(240, 244, 255, 0.3)';
            const letter = ({ freeze: 'F', bomb: 'B', shield: 'S' })[kind];
            ctx.fillText(letter, x + size / 2, y + size / 2);
        }
        // Count badge
        if (game.powerups[kind] > 1) {
            ctx.font = "700 14px Inter, sans-serif";
            ctx.fillStyle = '#FFD93D';
            ctx.textAlign = 'right'; ctx.textBaseline = 'top';
            ctx.fillText('×' + game.powerups[kind], x + size - 4, y + 2);
        }
        game.touchPowerupRects.push({ kind, x, y, w: size, h: size });
    }
}

function drawTouchPauseButton(ctx) {
    if (!isTouchActive()) return;
    const size = 48;
    const margin = 12;
    const x = game.w - size - margin;
    const y = margin;
    game.pauseBtnRect = { x, y, w: size, h: size };
    ctx.save();
    ctx.fillStyle = 'rgba(10, 14, 26, 0.7)';
    ctx.strokeStyle = '#00F0FF';
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, y, size, size, 8);
    ctx.fill(); ctx.stroke();
    ctx.shadowColor = '#00F0FF'; ctx.shadowBlur = 8;
    ctx.fillStyle = '#00F0FF';
    ctx.fillRect(x + 14, y + 12, 6, size - 24);
    ctx.fillRect(x + 28, y + 12, 6, size - 24);
    ctx.restore();
}

function hitTestTouchKeyboard(x, y) {
    for (const k of game.touchKeys) {
        if (x >= k.x && x <= k.x + k.w && y >= k.y && y <= k.y + k.h) return k;
    }
    return null;
}
function hitTestTouchPU(x, y) {
    for (const r of game.touchPowerupRects) {
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
    }
    return null;
}
function hitTestPauseBtn(x, y) {
    const r = game.pauseBtnRect;
    if (!r) return false;
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}
function hitTestWord(x, y) {
    // Pick the visually closest lockable word to the tap.
    let best = null, bestDist = Infinity;
    for (const w of game.words) {
        if (w.type === 'decoy' || w.type === 'boss' || w.completed) continue;
        const dx = x - w.x, dy = y - w.y;
        const d = Math.hypot(dx, dy);
        if (d < bestDist && d < 60 + w.width / 2) {
            best = w; bestDist = d;
        }
    }
    return best;
}

function simulateKeyPress(ch) {
    onKey({ key: ch, preventDefault() {} });
}

// ====================================================================
// Step 4 — Wire UI events for share, modals, mode, touch
// ====================================================================
function wireStep4DOM() {
    // Mode buttons already wired in init(); just refresh card and intercept
    // Daily taps when today is already locked in.
    document.querySelectorAll('#mode-select .mode').forEach(el => {
        el.addEventListener('click', () => {
            if (el.dataset.mode === 'daily') {
                refreshDailyCard();
                const r = getDailyResult();
                if (r) showDailyPlayedModal(r);
            }
        });
    });
    // Stats link (and the new nav icon variant)
    const openStats = () => { populateStatsModal(); show('stats-modal'); };
    const sLink = document.getElementById('stats-link');
    if (sLink) sLink.addEventListener('click', openStats);
    const sIcon = document.getElementById('stats-link-icon');
    if (sIcon) sIcon.addEventListener('click', openStats);
    document.getElementById('stats-close').addEventListener('click', () => hide('stats-modal'));
    // Daily-played modal
    document.getElementById('dp-close-btn').addEventListener('click', () => hide('daily-played'));
    const dpX = document.getElementById('dp-close-x');
    if (dpX) dpX.addEventListener('click', () => hide('daily-played'));
    const cfX = document.getElementById('confirm-close-x');
    if (cfX) cfX.addEventListener('click', () => hide('confirm-reset'));
    document.getElementById('dp-share-btn').addEventListener('click', () => {
        const r = getDailyResult();
        if (!r) return;
        // Build a share card from the saved daily result
        const cardStats = {
            score: r.score, wpm: r.wpm, longestCombo: r.combo,
            longestWord: '—', mode: 'daily', level: 0,
            date: new Date(),
        };
        try {
            const url = generateShareCard(cardStats);
            game.lastShareDataURL = url;
            game.score = r.score; game.isDaily = true; game.mode = 'daily';
            handleShare();
        } catch (e) { console.warn(e); }
    });
    // Share buttons on game-over
    document.getElementById('share-btn').addEventListener('click', handleShare);
    document.getElementById('copy-btn').addEventListener('click', handleCopyScore);
    document.getElementById('download-btn').addEventListener('click', handleDownload);
    // Initial daily card population
    refreshDailyCard();
    startDailyCountdownTick();
}

// Wire touch input events on canvas (in addition to existing click handler).
function wireTouchHandlers() {
    const cv = game.canvas;
    cv.addEventListener('pointerdown', (e) => {
        const rect = cv.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        // Touch pause toggle (works in both playing and paused states)
        if (isTouchActive() && hitTestPauseBtn(x, y)) {
            if (game.state === 'playing') {
                game.state = 'paused';
                document.getElementById('pause-hint').classList.add('show');
                AudioManager.pauseMusic();
            } else if (game.state === 'paused') {
                game.state = 'playing';
                document.getElementById('pause-hint').classList.remove('show');
                if (Settings.values.musicOn) AudioManager.resumeMusic();
                game.last = performance.now();
            }
            e.preventDefault();
            return;
        }
        if (game.state !== 'playing') return;
        // Touch power-ups
        const pu = hitTestTouchPU(x, y);
        if (pu) {
            usePowerup(pu.kind);
            e.preventDefault();
            return;
        }
        // Keyboard keys
        const key = hitTestTouchKeyboard(x, y);
        if (key) {
            key.flashT = 80;
            simulateKeyPress(key.ch === 'BACKSPACE' ? 'Backspace' : key.ch);
            e.preventDefault();
            return;
        }
        // Tap-to-lock on a word (touch mode only)
        if (isTouchActive()) {
            const w = hitTestWord(x, y);
            if (w) {
                if (game.target && game.target !== w) {
                    game.target = null; game.input = ''; renderInput();
                }
                if (!game.target) {
                    // Simulate locking on first letter
                    simulateKeyPress(w.text[0]);
                }
                e.preventDefault();
                return;
            }
            // Tap empty space cancels lock
            if (game.target) {
                game.target = null; game.input = ''; renderInput();
            }
        }
    });
}

// Hook canvas-drawn UI into the main draw pipeline (called from draw()).
function drawStep4Overlays(ctx) {
    drawTouchPowerups(ctx);
    drawTouchKeyboard(ctx);
    drawTouchPauseButton(ctx);
}

function drawFPS(ctx) {
    const fps = Math.round(game.fps || 0);
    ctx.save();
    ctx.font = "400 14px VT323, monospace";
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    const txt = `${fps} FPS`;
    const padX = 8;
    const w = ctx.measureText(txt).width + padX * 2;
    const h = 20;
    // Avoid overlapping the touch pause button (top-right 48px square).
    const yOff = isTouchActive() ? 64 + 8 : 64;
    const x = game.w - 12;
    const y = yOff;
    ctx.fillStyle = 'rgba(10, 14, 26, 0.7)';
    ctx.fillRect(x - w, y, w, h);
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
    ctx.strokeRect(x - w + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = fps < 30 ? '#FF8A00' : '#00F0FF';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 6;
    ctx.fillText(txt, x - padX, y + 3);
    ctx.shadowBlur = 0;
    ctx.restore();
}

// ====================================================================
// ╔══════════════════════════════════════════════════════════════╗
// ║  MODULE: Settings — User preferences persistence           ║
// ╚══════════════════════════════════════════════════════════════╝

// Step 5 — Settings module
// ====================================================================
const Settings = (() => {
    const KEY = LS_SETTINGS;
    const defaults = {
        musicVol: 40,
        sfxVol: 60,
        musicOn: true,
        sfxOn: true,
        reduceMotion: false,
        showFPS: false,
        colorblind: false,
    };
    const values = { ...defaults };

    function load() {
        try {
            const raw = localStorage.getItem(KEY);
            if (!raw) return;
            const data = JSON.parse(raw);
            Object.assign(values, data);
        } catch (e) {}
    }
    function save() {
        try { localStorage.setItem(KEY, JSON.stringify(values)); } catch (e) {}
    }
    function apply() {
        AudioManager.setMusicVolume(values.musicVol / 100);
        AudioManager.setSFXVolume(values.sfxVol / 100);
        AudioManager.setMusicEnabled(values.musicOn);
        AudioManager.setSFXEnabled(values.sfxOn);
    }
    function set(k, v) {
        values[k] = v;
        save();
        apply();
    }
    return { values, load, save, apply, set, defaults };
})();

function reduceMotion() { return !!Settings.values.reduceMotion; }
function shakeAllowed(amount) { return reduceMotion() ? 0 : amount; }
function particleCountScale() { return reduceMotion() ? 0.3 : 1; }

// ====================================================================
// Step 5 — Tutorial overlay
// ====================================================================
const Tutorial = (() => {
    let stepIdx = 0;
    let onDone = null;
    let demoT = 0;
    let raf = 0;
    const steps = [
        {
            title: 'TYPE TO TARGET',
            body: 'Type any letter to lock onto the lowest word starting with that letter.',
            draw: drawDemoType,
        },
        {
            title: 'BUILD COMBOS',
            body: 'Chain successful words to build your combo multiplier up to 6×. Every 10 combo grants a power-up.',
            draw: drawDemoCombo,
        },
        {
            title: 'USE POWER-UPS',
            body: 'Hold SHIFT + F to FREEZE time, SHIFT + B to BOMB the screen, SHIFT + S to SHIELD a miss. (On touch, tap the icons.)',
            draw: drawDemoPowerups,
        },
        {
            title: 'WATCH FOR DANGER',
            body: 'Red bombs end the run instantly. Gold bonuses grant power-ups. Green twins are linked — type both quickly. Every 5 levels: BOSS.',
            draw: drawDemoWordTypes,
        },
    ];

    function open(onCompleteCb) {
        onDone = (typeof onCompleteCb === 'function') ? onCompleteCb : null;
        stepIdx = 0;
        renderStep();
        // Hide the menu so its overlay can't intercept clicks meant for
        // the tutorial buttons (same z-index + backdrop-filter quirk).
        hide('menu');
        hide('gameover');
        show('tutorial');
        // Self-wire the action buttons every time we open. This makes the
        // tutorial bulletproof even if some earlier wire-up step threw.
        // Replacing the node via cloneNode also drops any stale listeners.
        bindAction('tut-next', () => Tutorial.next());
        bindAction('tut-prev', () => Tutorial.prev());
        bindAction('tut-skip', () => Tutorial.close(true));
        cancelAnimationFrame(raf);
        const tick = (t) => {
            demoT = t;
            renderCanvas();
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
    }
    function bindAction(id, fn) {
        const old = document.getElementById(id);
        if (!old) return;
        const fresh = old.cloneNode(true);
        old.parentNode.replaceChild(fresh, old);
        const handler = (e) => { e.preventDefault(); e.stopPropagation(); fn(); };
        fresh.addEventListener('click', handler);
        fresh.addEventListener('pointerup', handler);
        fresh.addEventListener('touchend', handler);
    }
    function close(skipped) {
        hide('tutorial');
        cancelAnimationFrame(raf); raf = 0;
        try { localStorage.setItem(LS_TUTORIAL_DONE, 'true'); } catch (e) {}
        const cb = onDone; onDone = null;
        if (cb) {
            cb(skipped);
        } else {
            // No callback (manual How-to-play) → return to menu.
            show('menu');
        }
    }
    function next() {
        if (stepIdx < steps.length - 1) {
            stepIdx++;
            renderStep();
        } else {
            close(false);
        }
    }
    function prev() {
        if (stepIdx > 0) { stepIdx--; renderStep(); }
    }
    function renderStep() {
        const s = steps[stepIdx];
        document.getElementById('tut-title').textContent = s.title;
        document.getElementById('tut-body').textContent = s.body;
        const dots = document.getElementById('tut-dots');
        dots.innerHTML = steps.map((_, i) =>
            `<span class="dot ${i === stepIdx ? 'active' : ''}"></span>`).join('');
        document.getElementById('tut-prev').style.visibility = stepIdx === 0 ? 'hidden' : 'visible';
        document.getElementById('tut-next').textContent = (stepIdx === steps.length - 1) ? 'Start Playing' : 'Next';
    }
    function renderCanvas() {
        const cv = document.getElementById('tut-canvas');
        if (!cv) return;
        const ctx = cv.getContext('2d');
        const w = cv.width, h = cv.height;
        ctx.clearRect(0, 0, w, h);
        // Subtle gradient background
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, '#0c1230');
        grad.addColorStop(1, '#0A0E1A');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        steps[stepIdx].draw(ctx, w, h, demoT);
    }

    function drawDemoType(ctx, w, h, t) {
        // Animated falling word with a target letter pulse
        const cycle = (t / 1600) % 1;
        const y = 30 + cycle * (h - 60);
        ctx.font = "26px VT323, monospace";
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.strokeStyle = '#0A0E1A'; ctx.lineWidth = 3;
        ctx.strokeText('rocket', w / 2, y);
        // typed prefix
        ctx.fillStyle = '#FFD93D';
        ctx.shadowColor = '#FFD93D'; ctx.shadowBlur = 10;
        ctx.fillText('r', w / 2 - 36, y);
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#00F0FF';
        ctx.shadowColor = '#00F0FF'; ctx.shadowBlur = 12;
        ctx.fillText('ocket', w / 2 + 8, y);
        ctx.shadowBlur = 0;
        // Cannon
        ctx.fillStyle = '#00F0FF';
        ctx.beginPath();
        ctx.arc(w / 2, h - 16, 8, 0, Math.PI * 2);
        ctx.fill();
        // Key hint
        ctx.font = "20px VT323, monospace";
        const pulse = 0.6 + 0.4 * Math.abs(Math.sin(t / 300));
        ctx.globalAlpha = pulse;
        ctx.fillStyle = '#FF2E97';
        ctx.shadowColor = '#FF2E97'; ctx.shadowBlur = 10;
        ctx.fillText('press R', w / 2, 20);
        ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    function drawDemoCombo(ctx, w, h, t) {
        const phase = (t / 1500) % 1;
        const combo = Math.floor(phase * 27);
        ctx.font = "400 64px 'Monoton', Impact, sans-serif";
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#00F0FF';
        ctx.shadowColor = '#00F0FF'; ctx.shadowBlur = 18;
        ctx.fillText(combo + 'x', w / 2, h / 2);
        ctx.shadowBlur = 0;
        ctx.font = "14px VT323, monospace";
        ctx.fillStyle = '#FFD93D';
        ctx.fillText('COMBO', w / 2, h / 2 + 50);
        // Bar
        const bw = w * 0.6;
        const bx = (w - bw) / 2;
        const by = h - 22;
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fillRect(bx, by, bw, 4);
        const grad2 = ctx.createLinearGradient(bx, 0, bx + bw, 0);
        grad2.addColorStop(0, '#00F0FF'); grad2.addColorStop(1, '#FF2E97');
        ctx.fillStyle = grad2;
        ctx.fillRect(bx, by, bw * phase, 4);
    }
    function drawDemoPowerups(ctx, w, h, t) {
        const labels = ['F', 'B', 'S'];
        const combos = ['SHIFT+F', 'SHIFT+B', 'SHIFT+S'];
        const names = ['FREEZE', 'BOMB', 'SHIELD'];
        const sz = 64;
        const gap = 30;
        const total = labels.length * sz + (labels.length - 1) * gap;
        const x0 = (w - total) / 2;
        const y0 = h / 2 - sz / 2 - 6;
        labels.forEach((ltr, i) => {
            const x = x0 + i * (sz + gap);
            const pulse = 0.7 + 0.3 * Math.sin(t / 400 + i);
            ctx.save();
            ctx.beginPath();
            ctx.arc(x + sz / 2, y0 + sz / 2, sz / 2 + 4, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(0,240,255,${0.15 * pulse})`;
            ctx.fill();
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.strokeStyle = '#00F0FF';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x + sz / 2, y0 + sz / 2, sz / 2, 0, Math.PI * 2);
            ctx.fill(); ctx.stroke();
            ctx.font = "400 32px 'Monoton', Impact, sans-serif";
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = '#00F0FF';
            ctx.shadowColor = '#00F0FF'; ctx.shadowBlur = 10;
            ctx.fillText(ltr, x + sz / 2, y0 + sz / 2 + 1);
            ctx.shadowBlur = 0;
            // Combo line (SHIFT+X) then power-up name.
            ctx.font = "13px VT323, monospace";
            ctx.fillStyle = '#00F0FF';
            ctx.fillText(combos[i], x + sz / 2, y0 + sz + 14);
            ctx.font = "11px VT323, monospace";
            ctx.fillStyle = '#6B7299';
            ctx.fillText(names[i], x + sz / 2, y0 + sz + 30);
            ctx.restore();
        });
    }
    function drawDemoWordTypes(ctx, w, h, t) {
        ctx.font = "20px VT323, monospace";
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        const samples = [
            { color: '#F0F4FF', glow: '#F0F4FF', text: 'rocket',  label: 'normal' },
            { color: '#FF1744', glow: '#FF1744', text: 'BOMB!',  label: 'bomb — instant lose' },
            { color: '#FFD93D', glow: '#FFD93D', text: 'BONUS',  label: 'bonus — grants power-up' },
            { color: '#00FF9F', glow: '#00FF9F', text: 'TWIN',   label: 'twin — chained pair' },
        ];
        const startX = 24;
        const stepY = 36;
        const pulse = 0.7 + 0.3 * Math.sin(t / 350);
        samples.forEach((s, i) => {
            const y = 28 + i * stepY;
            ctx.fillStyle = s.color;
            ctx.shadowColor = s.glow;
            ctx.shadowBlur = 12 * pulse;
            ctx.fillText(s.text, startX, y);
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#6B7299';
            ctx.font = "13px Inter, sans-serif";
            ctx.fillText(s.label, startX + 120, y);
            ctx.font = "20px VT323, monospace";
        });
    }

    return { open, close, next, prev };
})();

// ====================================================================
// Step 5 — Play button gating (tutorial on first launch)
// ====================================================================
function onPlayClicked() {
    // Versus is a separate mode — Play opens its tier picker instead of
    // dropping into the single-player loop.
    if (game.mode === 'versus') {
        Versus.openPicker();
        return;
    }
    const done = localStorage.getItem(LS_TUTORIAL_DONE) === 'true';
    if (!done) {
        Tutorial.open((skipped) => { startGame(); });
    } else {
        startGame();
    }
}

// ====================================================================
// Step 5+ — Ambient falling letters in the main menu background
// Lightweight DOM-based: spawns one letter on a metronome, lets CSS
// animate the fall, removes the node on animation end. Auto-pauses
// when the menu is not visible to save CPU.
// ====================================================================
const AmbientLetters = (() => {
    const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const MAX_CONCURRENT = 25;
    let host = null;
    let interval = null;
    let active = false;

    function ensureHost() {
        if (host) return host;
        host = document.getElementById('ambient-letters');
        return host;
    }
    function spawn() {
        if (!active || !host) return;
        // Skip during gameplay to avoid wasted work.
        if (game.state !== 'menu') return;
        // Hard cap on concurrent letters keeps the DOM lean even if the tab
        // is backgrounded then resumed (browsers throttle but never stop rAF).
        if (host.childElementCount >= MAX_CONCURRENT) return;
        const h = host.clientHeight || window.innerHeight;
        const w = host.clientWidth  || window.innerWidth;
        if (h < 100 || w < 100) return;

        const letter = document.createElement('span');
        letter.textContent = ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
        const size = 1 + Math.random() * 1.5;          // 1rem → 2.5rem
        const left = Math.random() * 100;              // viewport columns
        const dur  = 8 + Math.random() * 7;            // 8–15s fall
        const alpha = 0.08 + Math.random() * 0.28;     // gentle depth
        const blur = Math.random() * 2;                // 0–2px parallax blur
        // Magenta accent on ~25% of letters for palette variety
        const useMagenta = Math.random() < 0.25;
        letter.style.left = left + 'vw';
        letter.style.fontSize = size + 'rem';
        letter.style.filter = `blur(${blur.toFixed(2)}px)`;
        letter.style.setProperty('--alpha', alpha.toFixed(2));
        letter.style.animation = `amb-fall ${dur}s linear forwards`;
        if (useMagenta) {
            letter.style.color = 'var(--neon-magenta)';
            letter.style.textShadow = '0 0 8px var(--neon-magenta)';
        }
        host.appendChild(letter);
        letter.addEventListener('animationend', () => letter.remove(), { once: true });
    }
    function start() {
        ensureHost();
        if (!host || interval) return;
        active = true;
        // Ongoing stream — slightly under one per second so blur'd big letters
        // breathe properly.
        interval = setInterval(spawn, 1100);
        // Stagger the initial batch across the first 6 seconds so the screen
        // doesn't snap from empty → full all at once.
        for (let i = 0; i < MAX_CONCURRENT; i++) {
            setTimeout(spawn, Math.random() * 6000);
        }
    }
    function stop() {
        active = false;
        if (interval) { clearInterval(interval); interval = null; }
        if (host) host.innerHTML = '';
    }
    function refreshForState() {
        if (game.state === 'menu') start(); else stop();
    }
    return { start, stop, refreshForState };
})();

function wireStep5DOM() {
    const guard = (label, fn) => { try { fn(); } catch (e) { console.error('Word Fall wire failed:', label, e); } };

    guard('settings-gear', () => {
        const gearBtn = document.getElementById('settings-btn');
        if (!gearBtn) return;
        if (Assets.iconSettings) {
            gearBtn.innerHTML = '';
            const img = document.createElement('img');
            img.src = Assets.iconSettings.src;
            img.alt = '';
            gearBtn.appendChild(img);
        }
        gearBtn.addEventListener('click', () => {
            populateSettingsModal();
            show('settings-modal');
        });
    });

    guard('how-btn', () => {
        const howBtn = document.getElementById('how-btn');
        if (howBtn) howBtn.addEventListener('click', () => Tutorial.open(null));
    });

    guard('act-begin', () => {
        const b = document.getElementById('act-begin');
        if (b) b.addEventListener('click', () => beginNextAct());
    });

    guard('settings-close', () => {
        const sx = document.getElementById('settings-close');
        if (sx) sx.addEventListener('click', () => hide('settings-modal'));
    });

    guard('sliders', () => {
        const musicVol = document.getElementById('music-vol');
        const sfxVol   = document.getElementById('sfx-vol');
        const musicNum = document.getElementById('music-vol-num');
        const sfxNum   = document.getElementById('sfx-vol-num');
        const updateRangeFill = (input) => {
            const pct = ((+input.value - input.min) / (input.max - input.min)) * 100;
            input.style.backgroundSize = pct + '% 100%';
        };
        if (musicVol) {
            musicVol.value = Settings.values.musicVol;
            if (musicNum) musicNum.textContent = Settings.values.musicVol;
            updateRangeFill(musicVol);
            musicVol.addEventListener('input', () => {
                const v = +musicVol.value;
                Settings.set('musicVol', v);
                if (musicNum) musicNum.textContent = v;
                updateRangeFill(musicVol);
            });
        }
        if (sfxVol) {
            sfxVol.value = Settings.values.sfxVol;
            if (sfxNum) sfxNum.textContent = Settings.values.sfxVol;
            updateRangeFill(sfxVol);
            sfxVol.addEventListener('input', () => {
                const v = +sfxVol.value;
                Settings.set('sfxVol', v);
                if (sfxNum) sfxNum.textContent = v;
                updateRangeFill(sfxVol);
            });
        }
    });

    guard('toggles', () => {
        const bindToggle = (id, key) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.checked = !!Settings.values[key];
            el.addEventListener('change', () => Settings.set(key, el.checked));
        };
        bindToggle('music-on',      'musicOn');
        bindToggle('sfx-on',        'sfxOn');
        bindToggle('reduce-motion', 'reduceMotion');
        bindToggle('show-fps',      'showFPS');
        bindToggle('colorblind',    'colorblind');
    });

    guard('reset-stats', () => {
        const resetBtn = document.getElementById('reset-stats-btn');
        if (resetBtn) resetBtn.addEventListener('click', () => show('confirm-reset'));
        const cancelBtn = document.getElementById('confirm-cancel');
        if (cancelBtn) cancelBtn.addEventListener('click', () => hide('confirm-reset'));
        const confirmYes = document.getElementById('confirm-reset-yes');
        if (confirmYes) confirmYes.addEventListener('click', () => {
            try {
                localStorage.removeItem(LS_HIGH_SCORES);
                localStorage.removeItem(LS_LIFETIME_STATS);
                localStorage.removeItem(LS_ACHIEVEMENTS);
                const keysToDelete = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (k && k.startsWith(LS_DAILY_PREFIX)) keysToDelete.push(k);
                }
                keysToDelete.forEach(k => localStorage.removeItem(k));
            } catch (e) {}
            game.high = loadHigh();
            refreshHighUI();
            if (typeof refreshDailyCard === 'function') refreshDailyCard();
            hide('confirm-reset');
            hide('settings-modal');
            shareToast('Stats reset');
        });
    });

    guard('deepseek-key', () => {
        const input = document.getElementById('deepseek-key');
        const saveBtn = document.getElementById('deepseek-save');
        const clearBtn = document.getElementById('deepseek-clear');
        if (input && DeepSeek.hasKey()) {
            // Display a masked placeholder; we never re-expose the real key.
            input.placeholder = '••••••••  (saved)';
        }
        if (saveBtn) saveBtn.addEventListener('click', () => {
            const v = (input && input.value || '').trim();
            if (!v) { shareToast('Enter a key first'); return; }
            DeepSeek.setKey(v);
            input.value = '';
            input.placeholder = '••••••••  (saved)';
            shareToast('DeepSeek key saved');
            // Warm up both pools immediately.
            DeepSeek.warmAll(game.level || 1);
        });
        if (clearBtn) clearBtn.addEventListener('click', () => {
            DeepSeek.setKey('');
            if (input) { input.value = ''; input.placeholder = 'sk-…'; }
            shareToast('DeepSeek key cleared');
        });
    });

    // Note: tutorial Next/Prev/Skip are now wired inside Tutorial.open()
    // every time the overlay opens, so they always work even if anything
    // above failed.
}

function populateSettingsModal() {
    // Mirror current values into the inputs (in case anything changed externally).
    const map = {
        'music-vol': Settings.values.musicVol,
        'sfx-vol':   Settings.values.sfxVol,
    };
    Object.entries(map).forEach(([id, v]) => {
        const el = document.getElementById(id);
        if (el) {
            el.value = v;
            const pct = ((+v - el.min) / (el.max - el.min)) * 100;
            el.style.backgroundSize = pct + '% 100%';
        }
    });
    const numIds = { 'music-vol-num': Settings.values.musicVol, 'sfx-vol-num': Settings.values.sfxVol };
    Object.entries(numIds).forEach(([id, v]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = v;
    });
    const togs = {
        'music-on': Settings.values.musicOn,
        'sfx-on':   Settings.values.sfxOn,
        'reduce-motion': Settings.values.reduceMotion,
        'show-fps':      Settings.values.showFPS,
        'colorblind':    Settings.values.colorblind,
    };
    Object.entries(togs).forEach(([id, v]) => {
        const el = document.getElementById(id);
        if (el) el.checked = !!v;
    });
}

// ====================================================================
// ╔══════════════════════════════════════════════════════════════╗
// ║  MODULE: Versus — Player vs CPU bot mode                   ║
// ╚══════════════════════════════════════════════════════════════╝

// Versus mode — you vs CPU bot
//   Phase 1: bilateral defense duel. Words spawn on each side flying
//   toward that side's shield; both players type to defend; whoever
//   loses all hearts first loses the match. The bot 'types' at a
//   tier-controlled CPS. Phase 2 will add player-launched attack racks.
// ====================================================================
const Versus = (() => {
    // Per-tier knobs. Independent dials now:
    //   botCps         — bot 'types' at this characters/sec (defends bot side)
    //   travelMs       — how long a word takes edge-to-edge (player reading time)
    //   playerSpawnMs  — cadence between words spawned AT the player
    //   botSpawnMs     — cadence between words spawned AT the bot
    //   maxYouOnScreen — concurrency cap for incoming-at-you (set to 1 for
    //                    a TRUE rookie experience: one word at a time)
    //   maxCpuOnScreen — same for the bot side

    // Versus uses a fixed concatenated pool (tier1-tier4) regardless of
    // single-player level. Lifted to module scope so pickText doesn't
    // re-concat + re-filter on every word spawn. Boss-reserved words are
    // already absent (cleaned at the data source in WORDS.tier5).
    const VERSUS_LOCAL_POOL = WORDS.tier1
        .concat(WORDS.tier2, WORDS.tier3, WORDS.tier4)
        .filter(w => !BOSS_WORDS_SET.has(w));

    const TIERS = {
        rookie: {
            label: 'ROOKIE',  approxWpm: 20,
            botCps: 1.7,   travelMs: 7200, playerSpawnMs: 3200, botSpawnMs: 3000,
            maxYouOnScreen: 1, maxCpuOnScreen: 1,
            wordLenMin: 4, wordLenMax: 6,
            specialWeights: { normal: 0.92, bonus: 0.08 },
        },
        rival: {
            label: 'RIVAL',   approxWpm: 45,
            botCps: 3.8,   travelMs: 5500, playerSpawnMs: 2200, botSpawnMs: 2000,
            maxYouOnScreen: 2, maxCpuOnScreen: 2,
            wordLenMin: 5, wordLenMax: 8,
            specialWeights: { normal: 0.74, bonus: 0.10, bomb: 0.10, decoy: 0.06 },
        },
        nemesis: {
            label: 'NEMESIS', approxWpm: 80,
            botCps: 6.5,   travelMs: 4200, playerSpawnMs: 1500, botSpawnMs: 1400,
            maxYouOnScreen: 3, maxCpuOnScreen: 3,
            wordLenMin: 6, wordLenMax: 11,
            specialWeights: { normal: 0.55, bonus: 0.10, bomb: 0.20, twin: 0.10, decoy: 0.05 },
        },
    };
    const MAX_LIVES = 4;
    const PLAYER_SAFE_X_FRAC = 0.18;
    const BOT_SAFE_X_FRAC    = 0.82;
    const POWERUP_FREEZE_MS = 18000;
    const POWERUP_SHIELD_MS = 25000;

    const state = {
        active: false,
        tier: 'rookie',
        you: null, cpu: null,
        words: [],
        particles: [],
        floaters: [],
        spawnYou: 0,
        spawnCpu: 0,
        elapsed: 0,
        startedAt: 0,
        winner: null,
        endingT: 0,
        shake: 0, flash: 0, flashColor: '#ff5a6e',
    };

    function makeSide(which) {
        return {
            which,
            lives: MAX_LIVES,
            heartFx: [],
            target: null,
            input: '',
            combo: 0, combo_best: 0, multiplier: 1, comboTimer: 0,
            charsTyped: 0, wordsTyped: 0,
            freezeTimer: 0, shieldTimer: 0,
            powerups: { freeze: 0, shield: 0 },
        };
    }

    function shieldX(side) {
        return side.which === 'you'
            ? game.w * PLAYER_SAFE_X_FRAC
            : game.w * BOT_SAFE_X_FRAC;
    }

    function pickText(tier) {
        // Versus uses the game pool (mid-length conversational words).
        // Boss vocabulary lives in its own pool and never leaks here.
        if (DeepSeek && DeepSeek.hasKey && DeepSeek.hasKey()) {
            DeepSeek.refill && DeepSeek.refill(8, 'game').catch(() => {});
            const w = DeepSeek.take && DeepSeek.take('game');
            if (w && w.length >= tier.wordLenMin && w.length <= tier.wordLenMax + 2
                && !BOSS_WORDS_SET.has(w)) return w;
        }
        // Filter the pre-built static pool by tier length bounds.
        const pool = VERSUS_LOCAL_POOL.filter(
            w => w.length >= tier.wordLenMin && w.length <= tier.wordLenMax
        );
        if (pool.length === 0) return 'word';
        return pool[(Math.random() * pool.length) | 0];
    }

    function pickType(weights) {
        const total = Object.values(weights).reduce((a, b) => a + b, 0);
        let r = Math.random() * total;
        for (const k of Object.keys(weights)) {
            r -= weights[k];
            if (r <= 0) return k;
        }
        return 'normal';
    }

    function spawnWord(owner, tier) {
        const type = pickType(tier.specialWeights);
        const text = pickText(tier);
        const fontSize = 24 + Math.max(0, 12 - text.length) * 1.4;
        game.ctx.font = `400 ${fontSize}px 'VT323', monospace`;
        const width = game.ctx.measureText(text).width;
        const fromRight = owner === 'you';
        const x = fromRight ? game.w + width / 2 + 20 : -width / 2 - 20;
        const y = clampY(80 + Math.random() * (game.h - 240));
        const target = owner === 'you' ? state.you : state.cpu;
        const dist = Math.abs(shieldX(target) - x);
        // Travel duration is now an explicit per-tier knob (was derived from
        // botSpawnMs which conflated cadence with speed). Bombs and decoys
        // travel slightly faster / slower respectively for variety.
        const typeMul = w_type_dur_mul(type);
        const dur = tier.travelMs * typeMul;
        const vx = (fromRight ? -1 : 1) * (dist / dur);
        const w = {
            owner, type, text, typed: 0,
            x, y, vx, size: fontSize, width,
            hue: 200 + Math.random() * 160,
            wiggle: Math.random() * Math.PI * 2,
            spawnAt: performance.now(),
            bot: null,
        };
        if (owner === 'cpu') planBotCompletion(w, tier);
        state.words.push(w);
    }
    function clampY(y) { return Math.max(80, Math.min(game.h - 100, y)); }
    function w_type_dur_mul(type) {
        // Bombs are scarier when they're slightly faster; decoys saunter.
        if (type === 'bomb')  return 0.85;
        if (type === 'decoy') return 1.10;
        return 1;
    }

    function planBotCompletion(w, tier) {
        const lenFactor = 0.85 + (w.text.length / 8) * 0.5;
        const adj = tier.botCps * lenFactor * (w.type === 'decoy' ? 0.3 : 1);
        const fumble = Math.random() < 0.07 ? 0.6 : 0;
        const sec = (w.text.length / Math.max(1.2, adj)) + fumble;
        const startedAt = performance.now() + 280;
        w.bot = { cps: adj, startedAt, completionAt: startedAt + sec * 1000, fumbled: fumble > 0 };
    }

    function start(tier) {
        state.active = true;
        state.tier = tier;
        state.you = makeSide('you');
        state.cpu = makeSide('cpu');
        state.words = [];
        state.particles = [];
        state.floaters = [];
        // Brief breather before words start arriving so the player can read
        // hearts / shields / their input area. Scales with tier — rookie
        // gets the longest wind-up.
        const tierCfg = TIERS[state.tier];
        state.spawnYou = tierCfg.playerSpawnMs * 0.45;
        state.spawnCpu = tierCfg.botSpawnMs * 0.65;
        state.elapsed = 0;
        state.startedAt = performance.now();
        state.winner = null;
        state.endingT = 0;
        state.shake = 0; state.flash = 0;
        game.state = 'versus';
        if (typeof AmbientLetters !== 'undefined') AmbientLetters.stop();
        AudioManager.setActiveMusic('game');
        hide('menu'); hide('versus-setup'); hide('versus-over');
        Audio.resume();
        if (DeepSeek && DeepSeek.hasKey && DeepSeek.hasKey()) {
            DeepSeek.refill && DeepSeek.refill(8, 'game').catch(() => {});
        }
    }
    function end(winner) {
        if (state.winner) return;
        state.winner = winner;
        state.endingT = 1100;
        state.shake = 22; state.flash = 0.5;
        state.flashColor = winner === 'you' ? '#00FF9F' : '#FF1744';
        Audio.gameOver();
    }

    function update(dt) {
        if (!state.active) return;
        state.elapsed += dt;
        const tier = TIERS[state.tier];

        if (state.winner) {
            state.endingT -= dt;
            const ov = document.getElementById('versus-over');
            if (state.endingT <= 0 && ov && !ov.classList.contains('show')) showResult();
            for (const w of state.words) { w.x += w.vx * dt; w.wiggle += dt * 0.005; }
            updateParticlesAndFloaters(dt);
            state.shake = Math.max(0, state.shake - dt * SHAKE_DECAY_RATE);
            state.flash = Math.max(0, state.flash - dt * FLASH_DECAY_RATE);
            return;
        }

        state.spawnYou -= dt;
        state.spawnCpu -= dt;
        // Concurrency caps: keep ROOKIE to one word at a time so it feels
        // genuinely teaching-pace. Cap reached → cooldown stays at 0 and
        // next frame retries — spawn fires the moment a word is destroyed.
        const youOnScreen = state.words.reduce((n, w) => n + (w.owner === 'you' && !w._dead ? 1 : 0), 0);
        const cpuOnScreen = state.words.reduce((n, w) => n + (w.owner === 'cpu' && !w._dead ? 1 : 0), 0);
        if (state.spawnYou <= 0 && youOnScreen < tier.maxYouOnScreen) {
            spawnWord('you', tier);
            state.spawnYou = tier.playerSpawnMs * (0.85 + Math.random() * 0.3);
        }
        if (state.spawnCpu <= 0 && cpuOnScreen < tier.maxCpuOnScreen) {
            spawnWord('cpu', tier);
            state.spawnCpu = tier.botSpawnMs * (0.85 + Math.random() * 0.3);
        }

        for (const side of [state.you, state.cpu]) {
            if (side.freezeTimer > 0) side.freezeTimer = Math.max(0, side.freezeTimer - dt);
            if (side.shieldTimer > 0) {
                side.shieldTimer -= dt;
                if (side.shieldTimer <= 0) { side.shieldTimer = 0; showToast(side.which === 'you' ? 'SHIELD DOWN' : 'BOT SHIELD DOWN', '#FF8A00'); }
            }
            for (const fx of side.heartFx) fx.life -= dt;
            side.heartFx = side.heartFx.filter(fx => fx.life > 0);
            if (side.combo > 0) {
                side.comboTimer -= dt;
                if (side.comboTimer <= 0) { side.combo = 0; side.multiplier = 1; }
            }
        }

        const now = performance.now();
        for (const w of state.words) {
            const ownerSide = w.owner === 'you' ? state.you : state.cpu;
            const ts = ownerSide.freezeTimer > 0 ? 0.35 : 1;
            w.x += w.vx * dt * ts;
            w.wiggle += dt * 0.004;

            if (w.owner === 'cpu' && w.bot && !w.botDone) {
                const skipDecoy = w.type === 'decoy'
                    ? Math.random() < ({ rookie: 0.55, rival: 0.78, nemesis: 0.94 })[state.tier]
                    : false;
                if (!skipDecoy && now >= w.bot.completionAt) {
                    botDefend(w);
                }
            }

            const reachedShield = w.owner === 'you'
                ? (w.x <= shieldX(state.you) + 4)
                : (w.x >= shieldX(state.cpu) - 4);
            if (reachedShield) landHit(w);
        }
        state.words = state.words.filter(w => !w._dead);
        updateParticlesAndFloaters(dt);
        state.shake = Math.max(0, state.shake - dt * SHAKE_DECAY_RATE);
        state.flash = Math.max(0, state.flash - dt * FLASH_DECAY_RATE);
    }

    function updateParticlesAndFloaters(dt) {
        for (const p of state.particles) {
            p.x += p.vx * dt; p.y += p.vy * dt; p.vy += PARTICLE_GRAVITY * dt; p.life -= dt;
        }
        state.particles = state.particles.filter(p => p.life > 0);
        for (const f of state.floaters) {
            f.y += f.vy * dt; f.life -= dt;
        }
        state.floaters = state.floaters.filter(f => f.life > 0);
    }

    function botDefend(w) {
        w._dead = true; w.botDone = true;
        explodeAtVs(w.x, w.y, 'cyan', 20);
        state.cpu.charsTyped += w.text.length;
        state.cpu.wordsTyped++;
        if (w.type === 'bonus' && Math.random() < 0.5) {
            state.spawnYou = Math.max(300, state.spawnYou * 0.7);
        }
    }

    function landHit(w) {
        if (w._dead) return;
        w._dead = true;
        const defender = w.owner === 'you' ? state.you : state.cpu;
        const damage = w.type === 'bomb' ? 2 : 1;
        if (defender.shieldTimer > 0) {
            defender.shieldTimer = 0;
            showToast(defender.which === 'you' ? 'SHIELD BROKE' : 'BOT SHIELD BROKE', '#FF8A00');
            explodeAtVs(w.x, w.y, 'cyan', 14);
            return;
        }
        for (let i = 0; i < damage && defender.lives > 0; i++) {
            defender.lives--;
            defender.heartFx.push({ idx: defender.lives, life: 500 }  // Versus uses longer heart anim);
        }
        defender.combo = 0; defender.multiplier = 1; defender.comboTimer = 0;
        state.shake = Math.max(state.shake, defender.which === 'you' ? 16 : 12);
        state.flash = Math.max(state.flash, 0.4);
        state.flashColor = defender.which === 'you' ? '#FF1744' : '#00FF9F';
        explodeAtVs(w.x, w.y, w.type === 'bomb' ? 'redmagenta' : 'cyan', w.type === 'bomb' ? 60 : 24);
        Audio.miss();
        if (defender.lives <= 0) end(defender.which === 'you' ? 'cpu' : 'you');
    }

    function onKey(e) {
        if (!state.active || state.winner) return false;
        if (e.key === 'Escape') { end('cpu'); return true; }
        if (e.shiftKey && /^[fs]$/i.test(e.key)) {
            const k = e.key.toLowerCase();
            if (k === 'f' && state.you.powerups.freeze > 0) useVsPowerup('freeze');
            else if (k === 's' && state.you.powerups.shield > 0) useVsPowerup('shield');
            e.preventDefault();
            return true;
        }
        if (e.key === 'Backspace') {
            if (state.you.target) { state.you.target = null; state.you.input = ''; }
            return true;
        }
        if (e.key.length !== 1 || !/[a-zA-Z]/.test(e.key)) return false;
        const ch = e.key.toLowerCase();
        const candidates = state.words.filter(w => w.owner === 'you' && !w._dead);
        if (!state.you.target) {
            let best = null, bestDecoy = null;
            for (const w of candidates) {
                if (w.text[0] !== ch) continue;
                if (w.type === 'decoy') { if (!bestDecoy || bestDecoy.x > w.x) bestDecoy = w; }
                else { if (!best || best.x > w.x) best = w; }
            }
            if (!best) best = bestDecoy;
            if (!best) return true;
            state.you.target = best;
            best.typed = 1;
            state.you.input = ch;
            state.you.charsTyped++;
            AudioManager.playSFX('lock', () => {}, { volume: 0.8 });
            AudioManager.playSFX('type', () => {}, { volume: 0.3, playbackRate: 0.92 + Math.random() * 0.16 });
            if (best.typed === best.text.length) playerComplete(best);
            return true;
        }
        const expected = state.you.target.text[state.you.target.typed];
        if (ch === expected) {
            state.you.target.typed++;
            state.you.input = state.you.target.text.slice(0, state.you.target.typed);
            state.you.charsTyped++;
            AudioManager.playSFX('type', () => {}, { volume: 0.3, playbackRate: 0.92 + Math.random() * 0.16 });
            if (state.you.target.typed === state.you.target.text.length) playerComplete(state.you.target);
        } else {
            if (state.you.combo > 2) state.you.combo = Math.max(0, state.you.combo - 1);
        }
        return true;
    }

    function playerComplete(w) {
        if (w.type === 'decoy') {
            state.you.combo = 0; state.you.multiplier = 1; state.you.comboTimer = 0;
            showToast('BAIT', '#FF8A00');
            state.flash = Math.max(state.flash, 0.3); state.flashColor = '#FF8A00';
            explodeAtVs(w.x, w.y, 'cyan', 12);
            w._dead = true;
            state.you.target = null; state.you.input = '';
            return;
        }
        w._dead = true;
        state.you.target = null; state.you.input = '';
        state.you.wordsTyped++;
        state.you.combo++;
        if (state.you.combo > state.you.combo_best) state.you.combo_best = state.you.combo;
        state.you.multiplier = 1 + Math.min(state.you.combo, 50) * 0.1;
        state.you.comboTimer = 3200;
        if (w.type === 'bonus') {
            const counts = state.you.powerups;
            const kinds = ['freeze', 'shield'];
            let minK = kinds[0];
            for (const k of kinds) if (counts[k] < counts[minK]) minK = k;
            state.you.powerups[minK]++;
            showToast(`POWER-UP: ${minK.toUpperCase()}`, '#FFD93D');
            explodeAtVs(w.x, w.y, 'gold', 36);
        } else {
            explodeAtVs(w.x, w.y, 'cyan', 22);
        }
        AudioManager.playSFX('destroy', () => {}, { volume: 0.8 });
        if (w.type === 'bomb') {
            explodeAtVs(w.x, w.y, 'redmagenta', 30);
            showToast('BOMB DEFUSED', '#00FF9F');
        }
    }

    function useVsPowerup(kind) {
        state.you.powerups[kind]--;
        if (kind === 'freeze') {
            state.you.freezeTimer = POWERUP_FREEZE_MS;
            showToast(`FREEZE  ${POWERUP_FREEZE_MS / 1000}s`, '#00F0FF');
        } else if (kind === 'shield') {
            state.you.shieldTimer = POWERUP_SHIELD_MS;
            showToast(`SHIELD UP  ${POWERUP_SHIELD_MS / 1000}s`, '#00FF9F');
        }
        Audio.powerup(kind);
    }

    function showResult() {
        const tier = TIERS[state.tier];
        const winYou = state.winner === 'you';
        const mins = state.elapsed / 60000;
        const yourWpm = mins > 0 ? Math.round((state.you.charsTyped / 5) / mins) : 0;
        const botWpm  = mins > 0 ? Math.round((state.cpu.charsTyped / 5) / mins) : 0;
        const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
        set('vs-result-eyebrow', winYou ? 'YOU WIN' : 'YOU LOSE');
        set('vs-result-title', winYou ? 'VICTORY' : 'DEFEATED');
        set('vs-result-tier', tier.label);
        set('vs-result-wpm', String(yourWpm));
        set('vs-result-bot-wpm', String(botWpm));
        show('versus-over');
    }

    function draw(ctx) {
        if (!state.active) return;
        const w = game.w, h = game.h;
        ctx.save();
        if (state.shake > 0) ctx.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);

        if (Assets.bgSkyline) {
            const img = Assets.bgSkyline;
            const ir = img.width / img.height, cr = w / h;
            let dw, dh, dx, dy;
            if (ir > cr) { dh = h; dw = h * ir; dx = (w - dw) / 2; dy = 0; }
            else         { dw = w; dh = w / ir; dx = 0; dy = (h - dh) / 2; }
            ctx.drawImage(img, dx, dy, dw, dh);
            ctx.fillStyle = 'rgba(10, 14, 26, 0.6)';
            ctx.fillRect(0, 0, w, h);
        } else {
            ctx.fillStyle = '#0A0E1A'; ctx.fillRect(0, 0, w, h);
        }
        const halfGrad = ctx.createLinearGradient(0, 0, w, 0);
        halfGrad.addColorStop(0, 'rgba(0, 240, 255, 0.06)');
        halfGrad.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
        halfGrad.addColorStop(1, 'rgba(255, 46, 151, 0.06)');
        ctx.fillStyle = halfGrad;
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 8]);
        ctx.beginPath(); ctx.moveTo(w / 2, 60); ctx.lineTo(w / 2, h - 30); ctx.stroke();
        ctx.setLineDash([]);

        drawShield(ctx, state.you);
        drawShield(ctx, state.cpu);

        for (const word of state.words) drawVsWord(ctx, word);

        for (const p of state.particles) {
            const a = Math.max(0, p.life / p.max);
            ctx.globalAlpha = a;
            ctx.fillStyle = p.kind === 'gold' ? '#FFD93D' : (p.kind === 'magenta' ? '#FF2E97' : (p.kind === 'red' ? '#FF1744' : (p.kind === 'green' ? '#00FF9F' : '#00F0FF')));
            ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
        }
        ctx.globalAlpha = 1;

        drawVsHud(ctx);

        if (state.flash > 0) {
            ctx.fillStyle = withAlpha(state.flashColor, state.flash * 0.45);
            ctx.fillRect(0, 0, w, h);
        }
        if (state.winner) drawEndBanner(ctx);
        ctx.restore();
    }

    function drawShield(ctx, side) {
        const x = shieldX(side);
        const baseCol = side.which === 'you' ? '#00F0FF' : '#FF2E97';
        const t = performance.now();
        const g = ctx.createLinearGradient(x - 30, 0, x + 30, 0);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(0.5, baseCol + '40');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - 30, 60, 60, game.h - 100);
        ctx.strokeStyle = side.shieldTimer > 0
            ? `hsla(${(t * 0.3) % 360}, 90%, 70%, 0.85)`
            : baseCol;
        ctx.lineWidth = side.shieldTimer > 0 ? 4 : 2;
        ctx.beginPath();
        ctx.moveTo(x, 60);
        ctx.lineTo(x, game.h - 50);
        ctx.stroke();
        if (side.freezeTimer > 0) {
            ctx.fillStyle = `rgba(0, 240, 255, ${0.06 + 0.05 * Math.sin(t * 0.01)})`;
            const side_x = side.which === 'you' ? 0 : game.w / 2;
            ctx.fillRect(side_x, 0, game.w / 2, game.h);
        }
    }

    function drawVsWord(ctx, w) {
        const isTargeted = (state.you.target === w);
        ctx.save();
        ctx.font = `${w.size}px VT323, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';

        if (w.type === 'decoy') {
            const t = performance.now();
            const alpha = isTargeted ? 0.95 : 0.55 + 0.30 * (0.5 + 0.5 * Math.sin(t / 1500 * 2 * Math.PI));
            ctx.globalAlpha = alpha;
            if (isTargeted && w.typed > 0) {
                const totalW = w.width;
                const startX = w.x - totalW / 2;
                ctx.textAlign = 'left';
                const typed = w.text.slice(0, w.typed);
                const rest  = w.text.slice(w.typed);
                const typedW = ctx.measureText(typed).width;
                drawSeg(ctx, typed, startX, w.y, '#FF8A00', '#FF8A00', 14);
                drawSeg(ctx, rest,  startX + typedW, w.y, '#9fb0d8', '#9fb0d8', 10);
                ctx.textAlign = 'center';
            } else {
                drawSeg(ctx, w.text, w.x, w.y, '#9fb0d8', '#9fb0d8', 10);
            }
            ctx.strokeStyle = isTargeted ? 'rgba(255, 138, 0, 0.85)' : 'rgba(159, 176, 216, 0.7)';
            ctx.lineWidth = isTargeted ? 2 : 1.5;
            ctx.beginPath(); ctx.moveTo(w.x - w.width / 2, w.y); ctx.lineTo(w.x + w.width / 2, w.y); ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.restore();
            return;
        }

        const fillCol = w.type === 'bomb' ? '#FF1744'
            : w.type === 'bonus' ? '#FFD93D'
            : w.type === 'twin' ? '#00FF9F'
            : (w.owner === 'cpu' ? '#FF2E97' : '#F0F4FF');
        const glowCol = w.type === 'bomb' ? '#FF1744'
            : w.type === 'bonus' ? '#FFD93D'
            : w.type === 'twin' ? '#00FF9F'
            : (w.owner === 'cpu' ? '#FF2E97' : '#00F0FF');

        if (isTargeted && w.typed > 0) {
            const totalW = w.width;
            const startX = w.x - totalW / 2;
            ctx.textAlign = 'left';
            const typed = w.text.slice(0, w.typed);
            const rest  = w.text.slice(w.typed);
            const typedW = ctx.measureText(typed).width;
            drawSeg(ctx, typed, startX, w.y, '#FFD93D', '#FFD93D', 12);
            drawSeg(ctx, rest,  startX + typedW, w.y, fillCol, glowCol, 14);
            ctx.textAlign = 'center';
        } else {
            drawSeg(ctx, w.text, w.x, w.y, fillCol, glowCol, isTargeted ? 16 : 8);
        }
        ctx.restore();
    }

    function drawSeg(ctx, str, x, y, fillColor, glowColor, glowBlur) {
        if (!str) return;
        ctx.save();
        ctx.shadowBlur = 22; ctx.shadowColor = '#0A0E1A';
        ctx.fillStyle = '#0A0E1A';
        ctx.fillText(str, x, y); ctx.fillText(str, x, y);
        ctx.restore();
        ctx.strokeStyle = '#0A0E1A'; ctx.lineWidth = 3; ctx.strokeText(str, x, y);
        ctx.shadowBlur = glowBlur; ctx.shadowColor = glowColor;
        ctx.fillStyle = fillColor;
        ctx.fillText(str, x, y);
        ctx.shadowBlur = 0;
    }

    function drawVsHud(ctx) {
        const w = game.w;
        ctx.fillStyle = 'rgba(10, 14, 26, 0.75)';
        ctx.fillRect(0, 0, w, 56);
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
        ctx.beginPath(); ctx.moveTo(0, 56.5); ctx.lineTo(w, 56.5); ctx.stroke();

        ctx.font = "400 12px Inter, sans-serif";
        ctx.fillStyle = '#6B7299'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillText('YOU', 22, 22);
        drawHearts(ctx, state.you, 22, 32);

        ctx.textAlign = 'right';
        ctx.fillStyle = '#6B7299';
        ctx.fillText('CPU · ' + TIERS[state.tier].label, w - 22, 22);
        drawHearts(ctx, state.cpu, w - 22, 32);

        ctx.textAlign = 'center';
        ctx.font = "400 18px 'Monoton', Impact, sans-serif";
        ctx.fillStyle = '#00F0FF';
        ctx.shadowColor = '#00F0FF'; ctx.shadowBlur = 8;
        ctx.fillText('VERSUS', w / 2, 26);
        ctx.shadowBlur = 0;

        if (state.you.target) {
            ctx.font = '400 22px VT323, monospace';
            ctx.fillStyle = '#FFD93D';
            ctx.shadowColor = '#FFD93D'; ctx.shadowBlur = 8;
            ctx.textAlign = 'center';
            ctx.fillText(state.you.input + '_', w / 4, game.h - 28);
            ctx.shadowBlur = 0;
        }

        const pu = state.you.powerups;
        ctx.font = '400 14px VT323, monospace';
        ctx.textAlign = 'left';
        let px = 22; const py = game.h - 22;
        const drawPu = (label, n, ready) => {
            ctx.fillStyle = ready ? '#00F0FF' : '#6B7299';
            const txt = label + (n > 0 ? ' x' + n : '');
            ctx.fillText(txt, px, py);
            px += ctx.measureText(txt).width + 14;
        };
        drawPu('⇧F FREEZE', pu.freeze, pu.freeze > 0);
        drawPu('⇧S SHIELD', pu.shield, pu.shield > 0);
    }

    function drawHearts(ctx, side, anchorX, y) {
        const max = MAX_LIVES;
        const spacing = 18;
        const heartSize = 12;
        const totalW = (max - 1) * spacing + heartSize;
        const startX = side.which === 'you'
            ? anchorX + heartSize / 2
            : anchorX - totalW + heartSize / 2;
        for (let i = 0; i < max; i++) {
            const cx = startX + i * spacing;
            const lost = i >= side.lives;
            const fx = side.heartFx.find(h => h.idx === i);
            let scale = 1, color = side.which === 'you' ? '#00F0FF' : '#FF2E97';
            if (fx) {
                const t = 1 - fx.life / 500  /* Versus heart anim */;
                scale = 1 + 0.6 * Math.sin(t * Math.PI);
                color = '#F0F4FF';
            } else if (lost) {
                color = side.which === 'you' ? 'rgba(0, 240, 255, 0.18)' : 'rgba(255, 46, 151, 0.18)';
            }
            ctx.save();
            ctx.translate(cx, y);
            ctx.scale(scale, scale);
            ctx.fillStyle = color;
            ctx.shadowColor = color; ctx.shadowBlur = 8;
            const s = heartSize / 16;
            ctx.beginPath();
            ctx.moveTo(0, 5 * s);
            ctx.bezierCurveTo(0,   2 * s,  -3 * s,  -3 * s,  -6 * s, -3 * s);
            ctx.bezierCurveTo(-9 * s,  -3 * s, -9 * s,  3 * s,  -9 * s,  3 * s);
            ctx.bezierCurveTo(-9 * s,  6 * s,  -3 * s,  9 * s,   0,    11 * s);
            ctx.bezierCurveTo( 3 * s,  9 * s,   9 * s,  6 * s,   9 * s,  3 * s);
            ctx.bezierCurveTo( 9 * s,  3 * s,   9 * s, -3 * s,   6 * s, -3 * s);
            ctx.bezierCurveTo( 3 * s, -3 * s,   0,    2 * s,   0,    5 * s);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }
    }

    function drawEndBanner(ctx) {
        const w = game.w, h = game.h;
        const t = performance.now();
        const pulse = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * 0.01));
        const winYou = state.winner === 'you';
        ctx.font = "400 96px 'Monoton', Impact, sans-serif";
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = winYou ? '#00FF9F' : '#FF1744';
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 30;
        ctx.globalAlpha = pulse;
        ctx.fillText(winYou ? 'VICTORY' : 'DEFEATED', w / 2, h / 2);
        ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    }

    function explodeAtVs(x, y, palette, count) {
        const pickKind = () => {
            if (palette === 'cyan') return Math.random() < 0.8 ? 'cyan' : 'magenta';
            if (palette === 'gold') return 'gold';
            if (palette === 'magenta') return 'magenta';
            if (palette === 'redmagenta') return Math.random() < 0.5 ? 'red' : 'magenta';
            return 'cyan';
        };
        for (let i = 0; i < count; i++) {
            const a = Math.random() * Math.PI * 2;
            const s = 0.05 + Math.random() * 0.4;
            state.particles.push({
                x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
                life: 600 + Math.random() * 400, max: 1000, kind: pickKind(),
            });
        }
    }

    function openPicker() { show('versus-setup'); }
    function isActive() { return state.active; }
    function quitToMenu() {
        state.active = false;
        state.words = []; state.particles = []; state.floaters = [];
        hide('versus-over');
        toMenu();
    }

    return { TIERS, openPicker, start, update, draw, onKey, isActive, quitToMenu };
})();

// Route keystrokes to Versus when active (before single-player input).
(function wireVersusInput() {
    const origOnKey = onKey;
    onKey = function (e) {
        if (Versus.isActive()) {
            if (Versus.onKey(e)) return;
        }
        return origOnKey.call(this, e);
    };
})();

// Patch the main render loop to drive Versus when active.
(function wireVersusLoop() {
    const origLoop = loop;
    loop = function (now) {
        if (Versus.isActive()) {
            const dt = Math.min(64, now - (game.last || now));
            game.last = now;
            if (game.fps == null) game.fps = 60;
            else game.fps = game.fps * 0.92 + (1000 / Math.max(1, dt)) * 0.08;
            Versus.update(dt);
            Versus.draw(game.ctx);
            requestAnimationFrame(loop);
            return;
        }
        origLoop(now);
    };
})();

// Wire menu card click + tier picker + result buttons.
(function wireVersusMenu() {
    document.querySelectorAll('#mode-select .mode').forEach(el => {
        if (el.dataset.mode === 'versus') {
            el.addEventListener('click', () => Versus.openPicker());
        }
    });
    document.querySelectorAll('#vs-tiers .vs-tier').forEach(el => {
        el.addEventListener('click', () => Versus.start(el.dataset.tier));
    });
    const closeBtn = document.getElementById('versus-close');
    if (closeBtn) closeBtn.addEventListener('click', () => hide('versus-setup'));
    const rematch = document.getElementById('vs-rematch');
    if (rematch) rematch.addEventListener('click', () => { hide('versus-over'); Versus.openPicker(); });
    const vsMenu = document.getElementById('vs-to-menu');
    if (vsMenu) vsMenu.addEventListener('click', () => Versus.quitToMenu());
})();

init();
// Step 4 DOM wiring (defer until after init has cached canvas + listeners)
wireStep4DOM();
wireTouchHandlers();
wireStep5DOM();

})();
