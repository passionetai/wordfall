/* Word Fall — arcade typing game
   Multi-word lock-on, combos, power-ups, particle FX, procedural audio. */

(() => {
'use strict';

// ---------- Word lists ----------
// Tiered by length / difficulty. The active pool grows with level.
const WORDS = {
    tier1: ('the and you for are but not all can had has was one our out his her she him who why how new old now use way day man men two big bad red sun sky run cat dog fly jam ice tea pen ink art mix box top map key bus car egg cup bag fox owl bee ant cow pig').split(' '),
    tier2: ('time year work life hand part case week point fact game node hero star moon wave fire rain snow leaf rose lake river beach plant cloud light dream brave quick smart proud noisy quiet sharp brick stone metal glass pearl crown sword frost storm flame ember').split(' '),
    tier3: ('window forest planet rocket dragon castle silver galaxy thunder breeze stream meadow valley summit ridge crystal harbor temple wonder garden orchid wizard pirate phantom blossom whisper ranger archer falcon comet aurora cosmos legend').split(' '),
    tier4: ('mountain elephant dinosaur sunshine universe rainbow penguin octopus monarch volcano harvest mystery library journey horizon adventure paradise melody victory infinite gravity magnetic absolute hurricane wilderness lighthouse').split(' '),
    tier5: ('astronaut quicksilver kaleidoscope encyclopedia revolutionary phenomenal labyrinthine extraordinary independence constellation choreography metamorphosis perpendicular unfathomable thunderstorm reverberation incandescent juxtaposition').split(' '),
};

const TIERS = ['tier1', 'tier2', 'tier3', 'tier4', 'tier5'];

function poolForLevel(level) {
    // Level 1: just tier1+tier2; widens as we climb.
    const idx = Math.min(level - 1, 8);
    const tiers = [];
    if (idx >= 0) tiers.push(WORDS.tier1, WORDS.tier2);
    if (idx >= 1) tiers.push(WORDS.tier3);
    if (idx >= 3) tiers.push(WORDS.tier4);
    if (idx >= 5) tiers.push(WORDS.tier5);
    // Drop the tiniest tier at later levels for less filler.
    if (idx >= 4) tiers.shift();
    const flat = tiers.flat();
    return flat;
}

// ---------- Audio (procedural, no assets) ----------
const Audio = (() => {
    let ctx = null;
    let master = null;
    let muted = false;
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
        o.start();
        o.stop(ctx.currentTime + dur + 0.02);
    }
    function noise(dur, vol = 0.3, lp = 1000) {
        if (muted) return; ensure(); if (!ctx) return;
        const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const filt = ctx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.value = lp;
        const g = ctx.createGain();
        g.gain.value = vol;
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
        src.connect(filt).connect(g).connect(master);
        src.start();
        src.stop(ctx.currentTime + dur);
    }
    return {
        resume() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
        keyHit(progress) {
            const base = 520 + progress * 380;
            tone(base, 0.06, 'square', 0.18);
        },
        wordComplete(combo) {
            const base = 660 + Math.min(combo, 20) * 12;
            tone(base, 0.18, 'triangle', 0.3, base * 1.8);
            tone(base * 1.5, 0.12, 'sine', 0.15, base * 2.4);
        },
        miss() {
            tone(220, 0.25, 'sawtooth', 0.3, 80);
            noise(0.18, 0.18, 600);
        },
        gameOver() {
            tone(440, 0.25, 'sawtooth', 0.3, 120);
            setTimeout(() => tone(330, 0.3, 'sawtooth', 0.3, 80), 120);
            setTimeout(() => tone(220, 0.45, 'sawtooth', 0.35, 50), 280);
        },
        levelUp() {
            const seq = [523, 659, 784, 1047];
            seq.forEach((f, i) => setTimeout(() => tone(f, 0.12, 'triangle', 0.25), i * 70));
        },
        powerup(type) {
            if (type === 'freeze') { tone(880, 0.4, 'sine', 0.25, 220); noise(0.3, 0.08, 400); }
            else if (type === 'bomb') { tone(120, 0.5, 'sawtooth', 0.4, 40); noise(0.4, 0.3, 2000); }
            else if (type === 'shield') { tone(440, 0.15, 'sine', 0.2); tone(660, 0.2, 'sine', 0.2); }
        },
        lockOn() { tone(880, 0.04, 'square', 0.12); },
        toggle() { muted = !muted; return muted; },
    };
})();

// ---------- Game state ----------
const game = {
    mode: 'classic',
    state: 'menu',     // menu | playing | paused | gameover
    canvas: null, ctx: null,
    w: 0, h: 0, dpr: 1,
    words: [],         // active falling words
    bullets: [],       // visual projectiles
    particles: [],
    floaters: [],      // floating score text
    target: null,      // locked word
    input: '',
    score: 0,
    level: 1,
    lives: 5,
    combo: 0,
    bestCombo: 0,
    multiplier: 1,
    comboTimer: 0,
    spawnCooldown: 0,
    spawnInterval: 1800,
    timeScale: 1,
    freezeTimer: 0,
    shield: false,
    powerups: { freeze: 0, bomb: 0, shield: 0 },
    shake: 0,
    flash: 0,
    flashColor: '#ffffff',
    wordsCompleted: 0,
    charsTyped: 0,
    startTime: 0,
    elapsed: 0,
    sprintTimeLeft: 90000,
    last: 0,
    bgStars: [],
    bgGrid: 0,
    cursorX: 0, cursorY: 0,
    high: null,
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

    // Power-up clicks
    document.querySelectorAll('#powerups .pu').forEach(el => {
        el.addEventListener('click', () => usePowerup(el.dataset.pu));
    });

    requestAnimationFrame(loop);
}

function resize() {
    game.dpr = Math.min(window.devicePixelRatio || 1, 2);
    game.w = window.innerWidth;
    game.h = window.innerHeight;
    game.canvas.width = game.w * game.dpr;
    game.canvas.height = game.h * game.dpr;
    game.canvas.style.width = game.w + 'px';
    game.canvas.style.height = game.h + 'px';
    game.ctx.setTransform(game.dpr, 0, 0, game.dpr, 0, 0);
}

function seedStars() {
    game.bgStars = [];
    const count = 140;
    for (let i = 0; i < count; i++) {
        game.bgStars.push({
            x: Math.random() * game.w,
            y: Math.random() * game.h,
            z: 0.2 + Math.random() * 0.8,
            r: 0.4 + Math.random() * 1.6,
        });
    }
}

// ---------- Game flow ----------
function startGame() {
    game.state = 'playing';
    game.words = [];
    game.bullets = [];
    game.particles = [];
    game.floaters = [];
    game.target = null;
    game.input = '';
    game.score = 0;
    game.level = 1;
    game.combo = 0;
    game.bestCombo = 0;
    game.multiplier = 1;
    game.comboTimer = 0;
    game.spawnCooldown = 600;
    game.timeScale = 1;
    game.freezeTimer = 0;
    game.shield = false;
    game.shake = 0;
    game.flash = 0;
    game.wordsCompleted = 0;
    game.charsTyped = 0;
    game.startTime = performance.now();
    game.elapsed = 0;
    game.sprintTimeLeft = 90000;

    if (game.mode === 'hardcore') {
        game.lives = 1;
        game.spawnInterval = 1200;
    } else if (game.mode === 'sprint') {
        game.lives = 3;
        game.spawnInterval = 1500;
    } else {
        game.lives = 5;
        game.spawnInterval = 1800;
    }
    game.powerups = { freeze: 0, bomb: 0, shield: 0 };

    hide('menu'); hide('gameover');
    Audio.resume();
    refreshHUD();
    refreshPowerups();
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

    document.getElementById('go-title').textContent = reason || (game.mode === 'sprint' ? "Time's Up!" : 'Game Over');
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
    // Avoid words that start with a letter already covering an active word's first letter
    // (so first-letter lock-on stays unambiguous).
    const used = new Set(game.words.map(w => w.text[0]));
    const sameTextSet = new Set(game.words.map(w => w.text));
    let candidates = pool.filter(w => !used.has(w[0]) && !sameTextSet.has(w));
    if (candidates.length === 0) {
        candidates = pool.filter(w => !sameTextSet.has(w));
    }
    if (candidates.length === 0) candidates = pool;
    return candidates[(Math.random() * candidates.length) | 0];
}

function spawnWord() {
    const text = pickWord();
    // VT323 reads ~30% smaller per pixel than sans-serif; bump the size accordingly.
    const fontSize = Math.round(Math.max(18, Math.min(34, 30 - text.length * 0.4)) * 1.3);
    // Measure width with the actual draw font (numeric font size matches drawWords).
    game.ctx.font = `400 ${fontSize}px 'VT323', monospace`;
    const tw = game.ctx.measureText(text).width;
    const pad = 60;
    const baseSpeed = 0.020 + (game.level - 1) * 0.0045;
    const jitter = (Math.random() - 0.5) * 0.012;
    game.words.push({
        text,
        typed: 0,
        x: pad + tw / 2 + Math.random() * (game.w - tw - pad * 2),
        y: -40,
        speed: baseSpeed + jitter,    // pixels per ms (logical px, before timeScale)
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
        // Drop current lock — useful if you committed to a hard word.
        if (game.target) { game.target = null; game.input = ''; renderInput(); }
        return;
    }
    if (e.key.length !== 1 || !/[a-zA-Z]/.test(e.key)) return;
    const ch = e.key.toLowerCase();

    // Power-up hotkeys fire only if no target AND no word starts with that letter.
    // Otherwise the letter is reserved for typing/locking.
    if (!game.target) {
        const hasCandidate = game.words.some(wd => wd.text[0] === ch);
        if (!hasCandidate) {
            if (ch === 'f' && game.powerups.freeze > 0) { usePowerup('freeze'); return; }
            if (ch === 'b' && game.powerups.bomb   > 0) { usePowerup('bomb');   return; }
            if (ch === 's' && game.powerups.shield > 0) { usePowerup('shield'); return; }
        }
    }

    if (!game.target) {
        // Lock onto the lowest matching word (most urgent).
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
            // Whiff — small combo penalty.
            if (game.combo > 0) {
                game.comboTimer = Math.max(0, game.comboTimer - 800);
            }
        }
        return;
    }

    // Have a target — must match next char or it's a miss-stroke.
    const expected = game.target.text[game.target.typed];
    if (ch === expected) {
        game.target.typed++;
        game.input = game.target.text.slice(0, game.target.typed);
        game.charsTyped++;
        spawnBullet(game.target);
        Audio.keyHit(game.target.typed / game.target.text.length);
        renderInput();
        if (game.target.typed === game.target.text.length) {
            completeWord(game.target);
        }
    } else {
        // Mistype — small combo decay but no life lost.
        if (game.combo > 2) game.combo = Math.max(0, game.combo - 1);
        game.shake = Math.max(game.shake, 4);
    }
}

function renderInput() {
    const buf = document.getElementById('input-buffer');
    if (!game.target) { buf.innerHTML = ''; return; }
    const typed = game.target.text.slice(0, game.target.typed);
    const rest = game.target.text.slice(game.target.typed);
    buf.innerHTML = `<span style="color: var(--good)">${typed}</span>` +
                    `<span style="color: var(--muted)">${rest}</span>` +
                    `<span class="cursor"></span>`;
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

    // Floater
    game.floaters.push({
        text: `+${gained}`, x: w.x, y: w.y, vy: -0.06, life: 1000, max: 1000,
        color: game.combo >= 5 ? '#FF2E97' : '#00FF9F',
        size: 24 + Math.min(game.combo, 10),
    });

    // Combo milestone bonuses
    if (game.combo > 0 && game.combo % 10 === 0) {
        const kinds = ['freeze', 'bomb', 'shield'];
        const kind = kinds[(game.combo / 10 - 1) % kinds.length];
        game.powerups[kind]++;
        showToast(`POWER-UP: ${kind.toUpperCase()}`, '#00F0FF');
        refreshPowerups();
    }

    // Particle burst
    explode(w.x, w.y, w.hue, 24 + w.text.length * 2);

    // Remove word
    game.words = game.words.filter(x => x !== w);
    game.target = null;
    game.input = '';
    renderInput();

    // Level up: based on words completed
    const targetLevel = 1 + Math.floor(game.wordsCompleted / 12);
    if (targetLevel > game.level) {
        game.level = targetLevel;
        Audio.levelUp();
        showToast(`LEVEL ${game.level}`, '#FF2E97');
        game.spawnInterval = Math.max(550, game.spawnInterval - 130);
        game.flash = 0.4; game.flashColor = '#00F0FF';
    }

    refreshHUD();
}

function missWord(w) {
    if (game.shield) {
        game.shield = false;
        showToast('SHIELD BROKE', '#FF8A00');
        game.flash = 0.5; game.flashColor = '#FF8A00';
        game.shake = Math.max(game.shake, 8);
        explode(w.x, w.y, 30, 20);
        game.words = game.words.filter(x => x !== w);
        if (game.target === w) { game.target = null; game.input = ''; renderInput(); }
        Audio.powerup('shield');
        refreshPowerups();
        return;
    }
    game.lives--;
    game.combo = 0;
    game.multiplier = 1;
    game.comboTimer = 0;
    Audio.miss();
    game.shake = Math.max(game.shake, 18);
    game.flash = 0.55; game.flashColor = '#FF1744';
    explode(w.x, w.y, 0, 40);
    game.words = game.words.filter(x => x !== w);
    if (game.target === w) { game.target = null; game.input = ''; renderInput(); }
    refreshHUD();
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
        // Clear all words, partial score per word.
        const reward = game.words.length;
        for (const w of game.words) {
            explode(w.x, w.y, w.hue, 16);
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
    refreshPowerups();
    refreshHUD();
}

// ---------- FX ----------
function explode(x, y, hue, count) {
    for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = 0.05 + Math.random() * 0.4;
        game.particles.push({
            x, y,
            vx: Math.cos(a) * s,
            vy: Math.sin(a) * s,
            life: 600 + Math.random() * 400,
            max: 1000,
            size: 1 + Math.random() * 2.5,
            hue: hue + (Math.random() - 0.5) * 40,
        });
    }
}

function spawnBullet(w) {
    game.bullets.push({
        x: game.w / 2,
        y: game.h - 90,
        tx: w.x, ty: w.y,
        target: w,
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

// ---------- HUD ----------
function refreshHUD() {
    document.getElementById('score').textContent = game.score;
    document.getElementById('level').textContent = game.level;
    document.getElementById('combo').textContent = game.combo;
    document.getElementById('mult').textContent = game.multiplier.toFixed(1);
    document.getElementById('wpm').textContent = currentWPM();
    const livesEl = document.getElementById('lives-icons');
    const maxLives = game.mode === 'hardcore' ? 1 : (game.mode === 'sprint' ? 3 : 5);
    if (livesEl.childElementCount !== maxLives) {
        livesEl.innerHTML = '';
        for (let i = 0; i < maxLives; i++) {
            const d = document.createElement('div');
            d.className = 'heart';
            livesEl.appendChild(d);
        }
    }
    [...livesEl.children].forEach((el, i) => {
        el.classList.toggle('lost', i >= game.lives);
    });
}

function refreshPowerups() {
    document.querySelectorAll('#powerups .pu').forEach(el => {
        const kind = el.dataset.pu;
        const n = game.powerups[kind];
        el.classList.toggle('ready', n > 0);
        const label = kind.toUpperCase();
        el.querySelector('div:last-child').textContent = n > 0 ? `${label} ×${n}` : label;
    });
}

function refreshHighUI() {
    document.getElementById('hs-score').textContent = game.high.score || 0;
    document.getElementById('hs-wpm').textContent = game.high.wpm || 0;
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

    if (game.state === 'playing') update(dt);
    draw(dt);
    requestAnimationFrame(loop);
}

function update(dt) {
    game.elapsed = performance.now() - game.startTime;

    if (game.mode === 'sprint') {
        game.sprintTimeLeft -= dt;
        if (game.sprintTimeLeft <= 0) {
            gameOver("Time's Up!");
            return;
        }
    }

    // Time scale (freeze power-up)
    let ts = 1;
    if (game.freezeTimer > 0) {
        game.freezeTimer -= dt;
        ts = 0.25;
    }
    const sdt = dt * ts;

    // Spawning
    game.spawnCooldown -= dt;
    const maxOnScreen = 4 + Math.min(6, Math.floor(game.level / 2));
    if (game.spawnCooldown <= 0 && game.words.length < maxOnScreen) {
        spawnWord();
        game.spawnCooldown = game.spawnInterval * (0.7 + Math.random() * 0.6);
    }

    // Words
    const floor = game.h - 60;
    for (const w of game.words) {
        w.y += w.speed * sdt;
        w.wiggle += sdt * 0.003;
        if (w.y > floor) {
            missWord(w);
            return; // skip rest of loop, words array mutated
        }
    }

    // Bullets
    for (const b of game.bullets) {
        b.life += dt;
        const t = Math.min(1, b.life / 140);
        b.x = lerp(game.w / 2, b.target ? b.target.x : b.tx, t);
        b.y = lerp(game.h - 90, b.target ? b.target.y : b.ty, t);
    }
    game.bullets = game.bullets.filter(b => b.life < b.max);

    // Particles
    for (const p of game.particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 0.0002 * dt;
        p.life -= dt;
    }
    game.particles = game.particles.filter(p => p.life > 0);

    // Floaters
    for (const f of game.floaters) {
        f.y += f.vy * dt;
        f.life -= dt;
    }
    game.floaters = game.floaters.filter(f => f.life > 0);

    // Combo timer decay
    if (game.combo > 0) {
        game.comboTimer -= dt;
        if (game.comboTimer <= 0) {
            game.combo = 0;
            game.multiplier = 1;
        }
    }
    const bar = document.getElementById('combo-bar-fill');
    bar.style.width = `${Math.max(0, Math.min(100, (game.comboTimer / 3200) * 100))}%`;

    // Visual decay
    game.shake = Math.max(0, game.shake - dt * 0.05);
    game.flash = Math.max(0, game.flash - dt * 0.003);
    game.bgGrid += dt * 0.02;

    // Light HUD refresh (cheap fields)
    document.getElementById('score').textContent = game.score;
    document.getElementById('combo').textContent = game.combo;
    document.getElementById('mult').textContent = game.multiplier.toFixed(1);
    document.getElementById('wpm').textContent = currentWPM();
}

function lerp(a, b, t) { return a + (b - a) * t; }

// ---------- Draw ----------
function draw(dt) {
    const ctx = game.ctx;
    const w = game.w, h = game.h;
    ctx.save();

    // Screen shake
    if (game.shake > 0) {
        ctx.translate((Math.random() - 0.5) * game.shake, (Math.random() - 0.5) * game.shake);
    }

    // Background
    drawBackground(ctx, w, h, dt);

    // Cannon / player base
    drawCannon(ctx, w, h);

    // Falling words
    drawWords(ctx);

    // Bullets
    drawBullets(ctx);

    // Particles
    drawParticles(ctx);

    // Floaters
    drawFloaters(ctx);

    // Shield aura
    if (game.shield) drawShieldAura(ctx, w, h);

    // Freeze tint
    if (game.freezeTimer > 0) {
        const a = Math.min(0.25, game.freezeTimer / 4500 * 0.25);
        ctx.fillStyle = `rgba(0, 240, 255, ${a})`;
        ctx.fillRect(0, 0, w, h);
        // ice frame
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, 'rgba(0, 240, 255, 0.35)');
        grad.addColorStop(0.5, 'rgba(0, 240, 255, 0)');
        grad.addColorStop(1, 'rgba(0, 240, 255, 0.35)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
    }

    // Flash
    if (game.flash > 0) {
        ctx.fillStyle = withAlpha(game.flashColor, game.flash * 0.5);
        ctx.fillRect(0, 0, w, h);
    }

    // Floor warning band
    drawFloor(ctx, w, h);

    // Sprint timer
    if (game.mode === 'sprint' && game.state === 'playing') {
        drawSprintTimer(ctx, w);
    }

    ctx.restore();
}

function drawBackground(ctx, w, h, dt) {
    // Deep gradient — Neon Keys palette
    const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
    grad.addColorStop(0, '#1A1B3A');
    grad.addColorStop(1, '#0A0E1A');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Parallax grid
    const gridSize = 60;
    const ofs = (game.bgGrid % gridSize);
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = -ofs; x < w; x += gridSize) {
        ctx.moveTo(x, 0); ctx.lineTo(x, h);
    }
    for (let y = -ofs; y < h; y += gridSize) {
        ctx.moveTo(0, y); ctx.lineTo(w, y);
    }
    ctx.stroke();

    // Stars (low-alpha bright text color)
    for (const s of game.bgStars) {
        s.y += 0.02 * s.z * dt * (game.freezeTimer > 0 ? 0.25 : 1);
        if (s.y > h) { s.y = -2; s.x = Math.random() * w; }
        ctx.globalAlpha = 0.3 + s.z * 0.3;
        ctx.fillStyle = '#F0F4FF';
        ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;
}

function drawCannon(ctx, w, h) {
    const cx = w / 2, cy = h - 60;
    // Glow
    const r = 80;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(0, 240, 255, 0.35)');
    g.addColorStop(1, 'rgba(0, 240, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

    // Base
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

    // Aim line to target
    if (game.target) {
        ctx.save();
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
        ctx.setLineDash([6, 8]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy - 10);
        ctx.lineTo(game.target.x, game.target.y);
        ctx.stroke();
        ctx.restore();
    }
}

function drawWords(ctx) {
    for (const w of game.words) {
        const isTarget = (w === game.target);
        const xOff = Math.sin(w.wiggle) * 2;
        const x = w.x + xOff;
        const y = w.y;

        ctx.font = `400 ${w.size}px 'VT323', monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Glow ring (intensifies as it falls)
        const proximity = Math.min(1, w.y / (game.h - 60));
        const glow = isTarget ? 0.9 : 0.3 + proximity * 0.4;
        ctx.shadowColor = isTarget ? '#00F0FF' : `hsl(${w.hue}, 70%, 65%)`;
        ctx.shadowBlur = 20 * glow;

        // Capsule background for legibility
        const padX = 14, padY = 8;
        const bgW = w.width + padX * 2;
        const bgH = w.size + padY * 2;
        ctx.shadowBlur = 0;
        ctx.fillStyle = isTarget ? 'rgba(0, 240, 255, 0.14)' : 'rgba(240, 244, 255, 0.04)';
        ctx.strokeStyle = isTarget ? '#00F0FF' : `hsla(${w.hue}, 70%, 65%, ${0.25 + proximity * 0.5})`;
        ctx.lineWidth = isTarget ? 2 : 1.2;
        roundRect(ctx, x - bgW / 2, y - bgH / 2, bgW, bgH, 10);
        ctx.fill();
        ctx.stroke();

        // Re-enable text glow — locked word gets full neon treatment
        ctx.shadowColor = isTarget ? '#00F0FF' : `hsla(${w.hue}, 80%, 70%, 0.6)`;
        ctx.shadowBlur = isTarget ? 20 : 6;

        // Typed prefix (success green)
        if (w.typed > 0) {
            const typed = w.text.slice(0, w.typed);
            const rest = w.text.slice(w.typed);
            // measure both
            const totalW = ctx.measureText(w.text).width;
            const typedW = ctx.measureText(typed).width;
            const restW = ctx.measureText(rest).width;
            const startX = x - totalW / 2;
            ctx.textAlign = 'left';
            ctx.fillStyle = '#00FF9F';
            ctx.fillText(typed, startX, y);
            ctx.fillStyle = isTarget ? '#F0F4FF' : `hsl(${w.hue}, 80%, 78%)`;
            ctx.fillText(rest, startX + typedW, y);
            ctx.textAlign = 'center';
        } else {
            ctx.fillStyle = isTarget ? '#F0F4FF' : `hsl(${w.hue}, 80%, 78%)`;
            ctx.fillText(w.text, x, y);
        }
        ctx.shadowBlur = 0;

        // Danger pulse when low
        if (proximity > 0.75) {
            const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.015);
            ctx.strokeStyle = `rgba(255, 23, 68, ${0.4 + 0.5 * pulse})`;
            ctx.lineWidth = 2;
            roundRect(ctx, x - bgW / 2 - 2, y - bgH / 2 - 2, bgW + 4, bgH + 4, 12);
            ctx.stroke();
        }
    }
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
        const a = Math.max(0, p.life / p.max);
        ctx.globalAlpha = a;
        ctx.fillStyle = `hsl(${p.hue}, 80%, 65%)`;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
}

function drawFloaters(ctx) {
    for (const f of game.floaters) {
        const a = Math.min(1, f.life / 400);
        ctx.globalAlpha = a;
        // Score popups feel like neon signage.
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
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0, 255, 159, 0.2)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
}

function drawFloor(ctx, w, h) {
    // Danger zone gradient
    const g = ctx.createLinearGradient(0, h - 80, 0, h);
    g.addColorStop(0, 'rgba(255, 23, 68, 0)');
    g.addColorStop(1, 'rgba(255, 23, 68, 0.25)');
    ctx.fillStyle = g;
    ctx.fillRect(0, h - 80, w, 80);
    ctx.strokeStyle = 'rgba(255, 23, 68, 0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(0, h - 60); ctx.lineTo(w, h - 60);
    ctx.stroke();
    ctx.setLineDash([]);
}

function drawSprintTimer(ctx, w) {
    const t = Math.max(0, game.sprintTimeLeft) / 1000;
    const tx = `${t.toFixed(1)}s`;
    ctx.font = `400 36px 'Monoton', Impact, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = t < 10 ? '#FF1744' : '#F0F4FF';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 18;
    ctx.fillText(tx, w / 2, 80);
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
    const r = parseInt(h.slice(0,2), 16), g = parseInt(h.slice(2,4), 16), b = parseInt(h.slice(4,6), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}
function show(id) { document.getElementById(id).classList.add('show'); }
function hide(id) { document.getElementById(id).classList.remove('show'); }

// Kick off
init();

})();
