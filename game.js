/* Word Fall — Neon Keys (Step 2)
   Multi-word lock-on, combos, power-ups, particle FX, procedural audio.
   Visual layer integrates skyline / typewriter cannon / sprite particles
   / canvas HUD. Mechanics unchanged from Step 1. */

(() => {
'use strict';

// ---------- Word lists ----------
const WORDS = {
    tier1: ('the and you for are but not all can had has was one our out his her she him who why how new old now use way day man men two big bad red sun sky run cat dog fly jam ice tea pen ink art mix box top map key bus car egg cup bag fox owl bee ant cow pig').split(' '),
    tier2: ('time year work life hand part case week point fact game node hero star moon wave fire rain snow leaf rose lake river beach plant cloud light dream brave quick smart proud noisy quiet sharp brick stone metal glass pearl crown sword frost storm flame ember').split(' '),
    tier3: ('window forest planet rocket dragon castle silver galaxy thunder breeze stream meadow valley summit ridge crystal harbor temple wonder garden orchid wizard pirate phantom blossom whisper ranger archer falcon comet aurora cosmos legend').split(' '),
    tier4: ('mountain elephant dinosaur sunshine universe rainbow penguin octopus monarch volcano harvest mystery library journey horizon adventure paradise melody victory infinite gravity magnetic absolute hurricane wilderness lighthouse').split(' '),
    tier5: ('astronaut quicksilver kaleidoscope encyclopedia revolutionary phenomenal labyrinthine extraordinary independence constellation choreography metamorphosis perpendicular unfathomable thunderstorm reverberation incandescent juxtaposition').split(' '),
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

// ---------- Asset preloader ----------
const Assets = {
    logo: null, bgSkyline: null, cannon: null,
    sparkCyan: null, sparkMagenta: null,
    iconFreeze: null, iconBomb: null, iconShield: null,
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
    function tone(freq, dur, type = 'sine', vol = 0.3, sweepTo = null) {
        if (muted) return; ensure(); if (!ctx) return;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type;
        o.frequency.value = freq;
        if (sweepTo != null) o.frequency.exponentialRampToValueAtTime(sweepTo, ctx.currentTime + dur);
        g.gain.value = 0.0001;
        g.gain.exponentialRampToValueAtTime(vol, ctx.currentTime + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
        o.connect(g).connect(master);
        o.start(); o.stop(ctx.currentTime + dur + 0.02);
    }
    function noise(dur, vol = 0.3, lp = 1000) {
        if (muted) return; ensure(); if (!ctx) return;
        const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const filt = ctx.createBiquadFilter();
        filt.type = 'lowpass'; filt.frequency.value = lp;
        const g = ctx.createGain();
        g.gain.value = vol;
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
        src.connect(filt).connect(g).connect(master);
        src.start(); src.stop(ctx.currentTime + dur);
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
    };
})();

// ---------- Game state ----------
const TOP_HUD_H = 60;
const BOTTOM_HUD_H = 90;
const FLOOR_OFFSET_FROM_BOTTOM = 60; // unchanged: missWord triggers at h - 60

const game = {
    mode: 'classic',
    state: 'loading',  // loading | menu | playing | paused | gameover
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
    spawnCooldown: 0, spawnInterval: 1800,
    freezeTimer: 0, shield: false,
    powerups: { freeze: 0, bomb: 0, shield: 0 },
    shake: 0, flash: 0, flashColor: '#ffffff',
    wordsCompleted: 0, charsTyped: 0,
    startTime: 0, elapsed: 0, sprintTimeLeft: 90000,
    last: 0,
    bgStars: [],
    cursorX: 0, cursorY: 0,
    high: null,
    fireT: 0,                          // cannon fire-punch timer (ms remaining)
    heartFx: [],                        // {idx, life} for heart-loss flash
    loadT: 0,                          // loading screen anim time
    powerupRects: [],                  // current draw rects for click hit-testing
    showHint: true,
};

// ---------- Persistence ----------
function loadHigh() {
    try {
        const raw = localStorage.getItem('wordfall.high');
        if (!raw) return { score: 0, wpm: 0, combo: 0 };
        return JSON.parse(raw);
    } catch (e) { return { score: 0, wpm: 0, combo: 0 }; }
}
function saveHigh() {
    try { localStorage.setItem('wordfall.high', JSON.stringify(game.high)); } catch (e) {}
}

// ---------- Setup ----------
function init() {
    game.canvas = document.getElementById('game');
    game.ctx = game.canvas.getContext('2d');
    game.high = loadHigh();
    refreshHighUI();
    resize();
    seedStars();
    window.addEventListener('resize', resize);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', () => Audio.resume(), { once: true });
    document.addEventListener('mousemove', e => { game.cursorX = e.clientX; game.cursorY = e.clientY; });
    game.canvas.addEventListener('click', onCanvasClick);

    // Mode buttons
    document.querySelectorAll('#mode-select .mode').forEach(el => {
        el.addEventListener('click', () => {
            document.querySelectorAll('#mode-select .mode').forEach(m => m.classList.remove('selected'));
            el.classList.add('selected');
            game.mode = el.dataset.mode;
        });
    });
    document.getElementById('play-btn').addEventListener('click', startGame);
    document.getElementById('again-btn').addEventListener('click', startGame);
    document.getElementById('menu-btn').addEventListener('click', toMenu);

    // Begin render loop in 'loading' state, then preload, then go to menu.
    requestAnimationFrame(loop);
    preloadAssets(() => {
        applyLogoAssets();
        game.state = 'menu';
    });
}

function applyLogoAssets() {
    const set = (id, img) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (img) { el.src = img.src; el.classList.add('loaded'); }
    };
    set('menu-logo', Assets.logo);
    set('go-logo',  Assets.logo);
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
}

function seedStars() {
    // Reduced density (per spec: half) — these are foreground sparkle now.
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
function startGame() {
    game.state = 'playing';
    game.words = []; game.bullets = []; game.particles = []; game.floaters = [];
    game.target = null; game.input = '';
    game.score = 0; game.level = 1;
    game.combo = 0; game.bestCombo = 0;
    game.multiplier = 1; game.comboTimer = 0;
    game.spawnCooldown = 600;
    game.freezeTimer = 0; game.shield = false;
    game.shake = 0; game.flash = 0;
    game.wordsCompleted = 0; game.charsTyped = 0;
    game.startTime = performance.now();
    game.elapsed = 0; game.sprintTimeLeft = 90000;
    game.heartFx = [];
    game.fireT = 0;
    game.showHint = false;

    if (game.mode === 'hardcore') { game.lives = 1; game.spawnInterval = 1200; }
    else if (game.mode === 'sprint') { game.lives = 3; game.spawnInterval = 1500; }
    else { game.lives = 5; game.spawnInterval = 1800; }
    game.powerups = { freeze: 0, bomb: 0, shield: 0 };

    hide('menu'); hide('gameover');
    Audio.resume();
}

function toMenu() {
    game.state = 'menu';
    show('menu'); hide('gameover');
    refreshHighUI();
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

    document.getElementById('go-title').textContent = reason || (game.mode === 'sprint' ? "TIME'S UP!" : 'GAME OVER');
    document.getElementById('go-sub').textContent = game.mode === 'sprint'
        ? 'You raced the clock.'
        : 'Words crashed through your defense.';
    document.getElementById('go-score').textContent = game.score;
    document.getElementById('go-wpm').textContent = wpm;
    document.getElementById('go-combo').textContent = game.bestCombo;
    document.getElementById('go-new').style.display = isNew ? '' : 'none';
    setTimeout(() => show('gameover'), 1100);
}

// ---------- Spawning ----------
function pickWord() {
    const pool = poolForLevel(game.level);
    const used = new Set(game.words.map(w => w.text[0]));
    const sameTextSet = new Set(game.words.map(w => w.text));
    let candidates = pool.filter(w => !used.has(w[0]) && !sameTextSet.has(w));
    if (candidates.length === 0) candidates = pool.filter(w => !sameTextSet.has(w));
    if (candidates.length === 0) candidates = pool;
    return candidates[(Math.random() * candidates.length) | 0];
}

function spawnWord() {
    const text = pickWord();
    const fontSize = Math.round(Math.max(18, Math.min(34, 30 - text.length * 0.4)) * 1.3);
    game.ctx.font = `400 ${fontSize}px 'VT323', monospace`;
    const tw = game.ctx.measureText(text).width;
    const pad = 60;
    const baseSpeed = 0.020 + (game.level - 1) * 0.0045;
    const jitter = (Math.random() - 0.5) * 0.012;
    game.words.push({
        text, typed: 0,
        x: pad + tw / 2 + Math.random() * (game.w - tw - pad * 2),
        y: -40,
        speed: baseSpeed + jitter,
        size: fontSize,
        width: tw,
        hue: 180 + Math.random() * 180,
        wiggle: Math.random() * Math.PI * 2,
        spawnAt: performance.now(),
    });
}

// ---------- Input ----------
function onKey(e) {
    if (e.key === 'Escape') {
        if (game.state === 'playing') { game.state = 'paused'; document.getElementById('pause-hint').style.display = 'block'; }
        else if (game.state === 'paused') { game.state = 'playing'; document.getElementById('pause-hint').style.display = 'none'; game.last = performance.now(); }
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
    if (e.key.length !== 1 || !/[a-zA-Z]/.test(e.key)) return;
    const ch = e.key.toLowerCase();

    if (!game.target) {
        const hasCandidate = game.words.some(wd => wd.text[0] === ch);
        if (!hasCandidate) {
            if (ch === 'f' && game.powerups.freeze > 0) { usePowerup('freeze'); return; }
            if (ch === 'b' && game.powerups.bomb   > 0) { usePowerup('bomb');   return; }
            if (ch === 's' && game.powerups.shield > 0) { usePowerup('shield'); return; }
        }
    }

    if (!game.target) {
        let best = null;
        for (const w of game.words) {
            if (w.text[0] === ch) {
                if (!best || w.y > best.y) best = w;
            }
        }
        if (best) {
            game.target = best;
            best.typed = 1;
            game.input = ch;
            game.charsTyped++;
            spawnBullet(best);
            Audio.lockOn();
            Audio.keyHit(1 / best.text.length);
            renderInput();
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
        spawnBullet(game.target);
        Audio.keyHit(game.target.typed / game.target.text.length);
        renderInput();
        if (game.target.typed === game.target.text.length) completeWord(game.target);
    } else {
        if (game.combo > 2) game.combo = Math.max(0, game.combo - 1);
        game.shake = Math.max(game.shake, 4);
    }
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
function completeWord(w) {
    const base = 10 * w.text.length;
    const gained = Math.round(base * game.multiplier);
    game.score += gained;
    game.wordsCompleted++;
    game.combo++;
    if (game.combo > game.bestCombo) game.bestCombo = game.combo;
    game.multiplier = 1 + Math.min(game.combo, 50) * 0.1;
    game.comboTimer = 3200;
    Audio.wordComplete(game.combo);
    game.fireT = 100;

    game.floaters.push({
        text: `+${gained}`, x: w.x, y: w.y, vy: -0.06, life: 1000, max: 1000,
        color: game.combo >= 5 ? '#FF2E97' : '#00FF9F',
        size: 24 + Math.min(game.combo, 10),
    });

    if (game.combo > 0 && game.combo % 10 === 0) {
        const kinds = ['freeze', 'bomb', 'shield'];
        const kind = kinds[(game.combo / 10 - 1) % kinds.length];
        game.powerups[kind]++;
        showToast(`POWER-UP: ${kind.toUpperCase()}`, '#00F0FF');
        // Burst at the cannon for milestone celebration.
        burstAtCannon(36, 'magenta');
    }

    explodeAt(w.x, w.y, true /*lockedDestroy*/);

    game.words = game.words.filter(x => x !== w);
    game.target = null; game.input = ''; renderInput();

    const targetLevel = 1 + Math.floor(game.wordsCompleted / 12);
    if (targetLevel > game.level) {
        game.level = targetLevel;
        Audio.levelUp();
        showToast(`LEVEL ${game.level}`, '#FF2E97');
        game.spawnInterval = Math.max(550, game.spawnInterval - 130);
        game.flash = 0.4; game.flashColor = '#00F0FF';
    }
}

function missWord(w) {
    if (game.shield) {
        game.shield = false;
        showToast('SHIELD BROKE', '#FF8A00');
        game.flash = 0.5; game.flashColor = '#FF8A00';
        game.shake = Math.max(game.shake, 8);
        explodeAt(w.x, w.y, false);
        game.words = game.words.filter(x => x !== w);
        if (game.target === w) { game.target = null; game.input = ''; renderInput(); }
        Audio.powerup('shield');
        return;
    }
    const lostIdx = game.lives - 1;
    game.lives--;
    game.heartFx.push({ idx: lostIdx, life: 400 });
    game.combo = 0; game.multiplier = 1; game.comboTimer = 0;
    Audio.miss();
    game.shake = Math.max(game.shake, 18);
    game.flash = 0.55; game.flashColor = '#FF1744';
    explodeAt(w.x, w.y, false);
    game.words = game.words.filter(x => x !== w);
    if (game.target === w) { game.target = null; game.input = ''; renderInput(); }
    if (game.lives <= 0) gameOver();
}

// ---------- Power-ups ----------
function usePowerup(kind) {
    if (game.state !== 'playing') return;
    if (game.powerups[kind] <= 0) return;
    game.powerups[kind]--;
    Audio.powerup(kind);

    if (kind === 'freeze') {
        game.freezeTimer = 4500;
        showToast('FREEZE', '#00F0FF');
        game.flash = 0.3; game.flashColor = '#00F0FF';
    } else if (kind === 'bomb') {
        const reward = game.words.length;
        for (const w of game.words) {
            explodeAt(w.x, w.y, false);
            game.score += Math.round(5 * w.text.length * game.multiplier);
        }
        game.words = [];
        game.target = null; game.input = ''; renderInput();
        game.shake = Math.max(game.shake, 14);
        game.flash = 0.5; game.flashColor = '#FF2E97';
        showToast(`BOMB x${reward}`, '#FF2E97');
    } else if (kind === 'shield') {
        game.shield = true;
        showToast('SHIELD UP', '#00FF9F');
    }
}

// ---------- FX ----------
function explodeAt(x, y, lockedDestroy) {
    // Spec: locked-word destruction → 80% cyan / 20% magenta.
    //       general → 60% cyan / 40% magenta.
    const count = 28;
    const cyanShare = lockedDestroy ? 0.8 : 0.6;
    for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = 0.05 + Math.random() * 0.45;
        game.particles.push({
            kind: Math.random() < cyanShare ? 'cyan' : 'magenta',
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
    const cx = game.w / 2;
    const cy = game.h - 90; // top of cannon area
    for (let i = 0; i < count; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI;
        const s = 0.15 + Math.random() * 0.35;
        game.particles.push({
            kind: biasKind === 'magenta'
                ? (Math.random() < 0.85 ? 'magenta' : 'cyan')
                : (Math.random() < 0.85 ? 'cyan' : 'magenta'),
            x: cx + (Math.random() - 0.5) * 30,
            y: cy,
            vx: Math.cos(a) * s,
            vy: Math.sin(a) * s,
            life: 700 + Math.random() * 400,
            max: 1100,
            size: 28 + Math.random() * 14,
            rot: Math.random() * Math.PI * 2,
            spin: (Math.random() - 0.5) * 0.02,
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

    if (game.state === 'loading') {
        game.loadT += dt;
        drawLoadingScreen();
    } else {
        if (game.state === 'playing') update(dt);
        draw(dt);
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

    game.spawnCooldown -= dt;
    const maxOnScreen = 4 + Math.min(6, Math.floor(game.level / 2));
    if (game.spawnCooldown <= 0 && game.words.length < maxOnScreen) {
        spawnWord();
        game.spawnCooldown = game.spawnInterval * (0.7 + Math.random() * 0.6);
    }

    const floor = game.h - FLOOR_OFFSET_FROM_BOTTOM;
    for (const w of game.words) {
        w.y += w.speed * sdt;
        w.wiggle += sdt * 0.003;
        if (w.y > floor) { missWord(w); return; }
    }

    for (const b of game.bullets) {
        b.life += dt;
        const t = Math.min(1, b.life / 140);
        b.x = lerp(game.w / 2, b.target ? b.target.x : b.tx, t);
        b.y = lerp(game.h - 90, b.target ? b.target.y : b.ty, t);
    }
    game.bullets = game.bullets.filter(b => b.life < b.max);

    for (const p of game.particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 0.0002 * dt;
        p.rot += p.spin * dt;
        p.life -= dt;
    }
    game.particles = game.particles.filter(p => p.life > 0);

    for (const f of game.floaters) {
        f.y += f.vy * dt;
        f.life -= dt;
    }
    game.floaters = game.floaters.filter(f => f.life > 0);

    for (const fx of game.heartFx) fx.life -= dt;
    game.heartFx = game.heartFx.filter(fx => fx.life > 0);

    if (game.combo > 0) {
        game.comboTimer -= dt;
        if (game.comboTimer <= 0) { game.combo = 0; game.multiplier = 1; }
    }

    if (game.fireT > 0) game.fireT = Math.max(0, game.fireT - dt);

    game.shake = Math.max(0, game.shake - dt * 0.05);
    game.flash = Math.max(0, game.flash - dt * 0.003);
}

function lerp(a, b, t) { return a + (b - a) * t; }

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

    // Animated dot row
    const dots = 5;
    const gap = 18;
    const totalW = (dots - 1) * gap;
    const dotR = 5;
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
    if (game.shake > 0) {
        ctx.translate((Math.random() - 0.5) * game.shake, (Math.random() - 0.5) * game.shake);
    }

    drawBackground(ctx, w, h, dt);
    drawTargetingBeam(ctx, w, h);
    drawWords(ctx);
    drawBullets(ctx);
    drawParticles(ctx);
    drawFloaters(ctx);

    if (game.shield) drawShieldAura(ctx, w, h);

    if (game.freezeTimer > 0) {
        const a = Math.min(0.25, game.freezeTimer / 4500 * 0.25);
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

    ctx.restore();
}

function drawBackground(ctx, w, h, dt) {
    if (Assets.bgSkyline) {
        // Cover (crop to fill, no stretch).
        const img = Assets.bgSkyline;
        const ir = img.width / img.height;
        const cr = w / h;
        let dw, dh, dx, dy;
        if (ir > cr) { dh = h; dw = h * ir; dx = (w - dw) / 2; dy = 0; }
        else         { dw = w; dh = w / ir; dx = 0; dy = (h - dh) / 2; }
        ctx.drawImage(img, dx, dy, dw, dh);
        // Frosted glass dim overlay.
        ctx.fillStyle = 'rgba(10, 14, 26, 0.55)';
        ctx.fillRect(0, 0, w, h);
    } else {
        // Fallback: deep gradient + subtle grid (faded).
        const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
        grad.addColorStop(0, '#1A1B3A');
        grad.addColorStop(1, '#0A0E1A');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        const gridSize = 60;
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x < w; x += gridSize) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
        for (let y = 0; y < h; y += gridSize) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
        ctx.stroke();
    }

    // Foreground sparkle stars (low alpha).
    for (const s of game.bgStars) {
        s.y += 0.02 * s.z * dt * (game.freezeTimer > 0 ? 0.25 : 1);
        if (s.y > h) { s.y = -2; s.x = Math.random() * w; }
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = '#F0F4FF';
        ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;
}

// Cannon position helpers
function cannonPos() { return { x: game.w / 2, y: game.h - 60 }; }
function cannonFireScale() {
    if (game.fireT <= 0) return 1;
    // 1.0 → 1.08 → 1.0 over 100ms
    const t = 1 - game.fireT / 100;
    const tri = t < 0.5 ? t / 0.5 : (1 - t) / 0.5;
    return 1 + 0.08 * tri;
}

function drawCannon(ctx, w, h) {
    const { x: cx, y: cy } = cannonPos();
    const fireBoost = game.fireT > 0 ? 0.35 : 0;
    const baseAlpha = 0.45 + fireBoost;

    // Soft cyan halo
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
        const dy = h - 20 - dh; // base ~20px from bottom
        ctx.drawImage(img, dx, dy, dw, dh);
    } else {
        // Fallback primitive base
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
    // Curve via midpoint with waver
    const mx = (cx + tx) / 2 + wave;
    const my = (cy + ty) / 2;
    ctx.quadraticCurveTo(mx, my, tx, ty);
    ctx.stroke();
    ctx.restore();

    // Trailing sparks along the beam
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

function drawWords(ctx) {
    for (const w of game.words) {
        const isTarget = (w === game.target);
        const xOff = Math.sin(w.wiggle) * 2;
        const x = w.x + xOff;
        const y = w.y;
        const proximity = Math.min(1, w.y / (game.h - FLOOR_OFFSET_FROM_BOTTOM));
        const inDanger = (w.y / game.h) > 0.8;

        ctx.save();
        ctx.font = `${w.size}px VT323, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';

        if (isTarget) {
            // Locked: draw typed prefix in gold + rest in cyan, each with full 3-pass.
            const totalW = ctx.measureText(w.text).width;
            const startX = x - totalW / 2;
            ctx.textAlign = 'left';
            const typed = w.text.slice(0, w.typed);
            const rest  = w.text.slice(w.typed);
            const typedW = ctx.measureText(typed).width;
            drawWordSegment(ctx, typed, startX, y, '#FFD93D', '#FFD93D', 12);
            drawWordSegment(ctx, rest,  startX + typedW, y, '#00F0FF', '#00F0FF', 16);
        } else if (inDanger) {
            const pulse = 0.85 + 0.15 * (0.5 + 0.5 * Math.sin(performance.now() * 0.012));
            ctx.globalAlpha = pulse;
            drawWordCentered(ctx, w.text, x, y, '#FF8A00', '#FF8A00', 20);
            ctx.globalAlpha = 1;
        } else {
            drawWordCentered(ctx, w.text, x, y, '#F0F4FF', null, 0);
        }
        ctx.restore();
    }
}

// 3-pass: dark plate (double draw), dark stroke outline, then colored fill.
function drawWordSegment(ctx, str, x, y, fillColor, glowColor, glowBlur) {
    if (!str) return;
    // Pass A: dark shadow plate
    ctx.save();
    ctx.shadowBlur = 24;
    ctx.shadowColor = '#0A0E1A';
    ctx.fillStyle = '#0A0E1A';
    ctx.fillText(str, x, y);
    ctx.fillText(str, x, y);
    ctx.restore();

    // Pass B: dark stroke outline
    ctx.strokeStyle = '#0A0E1A';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeText(str, x, y);

    // Pass C: colored fill (with optional neon glow)
    if (glowColor) { ctx.shadowBlur = glowBlur; ctx.shadowColor = glowColor; }
    else           { ctx.shadowBlur = 0; }
    ctx.fillStyle = fillColor;
    ctx.fillText(str, x, y);
    ctx.shadowBlur = 0;
}

function drawWordCentered(ctx, str, x, y, fillColor, glowColor, glowBlur) {
    drawWordSegment(ctx, str, x, y, fillColor, glowColor, glowBlur);
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
        const sprite = p.kind === 'magenta' ? Assets.sparkMagenta : Assets.sparkCyan;
        ctx.globalAlpha = alpha;
        if (sprite) {
            const sz = p.size * scale;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.drawImage(sprite, -sz / 2, -sz / 2, sz, sz);
            ctx.restore();
        } else {
            // Fallback colored circle
            ctx.fillStyle = p.kind === 'magenta' ? '#FF2E97' : '#00F0FF';
            ctx.fillRect(p.x - p.size * scale / 4, p.y - p.size * scale / 4, p.size * scale / 2, p.size * scale / 2);
        }
    }
    ctx.globalAlpha = 1;
}

function drawFloaters(ctx) {
    for (const f of game.floaters) {
        const a = Math.min(1, f.life / 400);
        ctx.globalAlpha = a;
        // Big juicy numbers → Monoton
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
    // Strip background
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

    // Score
    let x = padX, y = 22;
    ctx.font = labelFont; ctx.fillStyle = '#6B7299';
    ctx.textAlign = 'left'; ctx.fillText('SCORE', x, y);
    ctx.font = valueBigFont; ctx.fillStyle = '#F0F4FF';
    ctx.shadowBlur = 0;
    ctx.fillText(String(game.score), x, y + 28);

    // Level
    x = padX + 180;
    ctx.font = labelFont; ctx.fillStyle = '#6B7299';
    ctx.fillText('LEVEL', x, y);
    ctx.font = valueBigFont; ctx.fillStyle = '#F0F4FF';
    ctx.fillText(String(game.level), x, y + 28);

    // Mode label (center)
    ctx.textAlign = 'center';
    ctx.font = labelFont; ctx.fillStyle = '#6B7299';
    ctx.fillText('MODE', w / 2, y);
    ctx.font = "400 22px 'Monoton', Impact, sans-serif"; ctx.fillStyle = '#00F0FF';
    ctx.shadowColor = '#00F0FF'; ctx.shadowBlur = 12;
    ctx.fillText(game.mode.toUpperCase(), w / 2, y + 24);
    ctx.shadowBlur = 0;

    // WPM (right side, before hearts)
    ctx.textAlign = 'right';
    const heartArea = drawHearts(ctx, w - padX, 30);
    const wpmRight = w - padX - heartArea - 24;
    ctx.font = labelFont; ctx.fillStyle = '#6B7299';
    ctx.fillText('WPM', wpmRight, y);
    ctx.font = valueFont; ctx.fillStyle = '#F0F4FF';
    ctx.fillText(String(currentWPM()), wpmRight, y + 26);
}

// Returns total width consumed by hearts.
function drawHearts(ctx, rightX, centerY) {
    const maxLives = game.mode === 'hardcore' ? 1 : (game.mode === 'sprint' ? 3 : 5);
    const spacing = 24;
    const heartSize = 16;
    const totalW = (maxLives - 1) * spacing + heartSize;
    const startX = rightX - totalW + heartSize / 2; // first heart center
    for (let i = 0; i < maxLives; i++) {
        const cx = startX + i * spacing;
        const cy = centerY;
        const lost = i >= game.lives;
        const fx = game.heartFx.find(h => h.idx === i);
        let scale = 1, color = '#FF2E97';
        if (fx) {
            // 1.0 → 1.5 over first half, then back
            const t = 1 - fx.life / 400;
            scale = 1 + 0.5 * Math.sin(t * Math.PI);
            color = '#F0F4FF';
        } else if (lost) {
            color = 'rgba(255, 46, 151, 0.18)';
        }
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);
        ctx.fillStyle = color;
        if (!lost || fx) {
            ctx.shadowColor = '#FF2E97';
            ctx.shadowBlur = 8;
        }
        drawHeartPath(ctx, heartSize);
        ctx.fill();
        ctx.restore();
    }
    return totalW;
}

function drawHeartPath(ctx, size) {
    // Draw a filled heart centered at (0,0) sized to fit `size`
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

function drawBottomHud(ctx, w, h) {
    const top = h - BOTTOM_HUD_H;
    ctx.fillStyle = 'rgba(10, 14, 26, 0.75)';
    ctx.fillRect(0, top, w, BOTTOM_HUD_H);
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, top + 0.5); ctx.lineTo(w, top + 0.5); ctx.stroke();

    // Power-up slots (left)
    drawPowerupSlots(ctx, 24, top + 17, w);

    // Combo bar + multiplier (right)
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
        // Slot background
        ctx.save();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.3)';
        ctx.lineWidth = 1;
        roundRect(ctx, x, y, sz, sz, 8);
        ctx.fill();
        ctx.stroke();
        // Pulsing glow when available
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
            // Fallback: letter
            ctx.font = "400 26px 'Monoton', Impact, sans-serif";
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = has ? '#00F0FF' : 'rgba(240, 244, 255, 0.2)';
            if (has) { ctx.shadowColor = '#00F0FF'; ctx.shadowBlur = 10; }
            ctx.fillText(hotkeys[kind], x + sz / 2, y + sz / 2);
            ctx.shadowBlur = 0;
        }

        // Hotkey label below
        ctx.font = '14px VT323, monospace';
        ctx.fillStyle = '#F0F4FF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(hotkeys[kind], x + sz / 2, y + sz + 2);

        // Count badge
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
    const fill = Math.max(0, Math.min(1, game.comboTimer / 3200));
    const x = rightX - barW;

    // Combo number + label (right-aligned, big Monoton)
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

    // Combo bar
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

// ---------- Helpers ----------
function roundRect(ctx, x, y, w, h, r) {
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

init();

})();
