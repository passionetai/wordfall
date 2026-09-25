// End-to-end browser test for Word Fall (real Chromium via Playwright).
//
//   Run:  node tools/e2e.cjs [baseUrl] [screenshotDir]
//   Default baseUrl: http://localhost:8000   (serve the repo root first:
//                    python3 -m http.server 8000)
//
// Drives the real game: splash -> menu -> keyboard mode nav -> play ->
// types real words (read via the ?debug hook) -> combo announcer ->
// pause menu -> resume -> forced game over -> end screen. Fails on any
// page error or console error, and saves screenshots of each screen.

const path = require('path');
const { execSync } = require('child_process');

function loadPlaywright() {
    try { return require('playwright'); } catch (e) {}
    const globalRoot = execSync('npm root -g').toString().trim();
    return require(path.join(globalRoot, 'playwright'));
}

const BASE = process.argv[2] || 'http://localhost:8000';
const SHOTS = process.argv[3] || path.join(process.cwd(), 'e2e-shots');

(async () => {
    const { chromium } = loadPlaywright();
    require('fs').mkdirSync(SHOTS, { recursive: true });
    const browser = await chromium.launch({
        executablePath: process.env.PW_CHROMIUM || undefined,
        args: ['--autoplay-policy=no-user-gesture-required'],
    });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const t = m.text();
        // Missing optional assets / blocked fonts are expected in CI sandboxes.
        if (/Failed to load resource|net::ERR|fonts\.g/.test(t)) return;
        errors.push('console: ' + t);
    });
    // Skip the first-run tutorial so the test reaches gameplay directly.
    await page.addInitScript(() => {
        try { localStorage.setItem('wordfall_tutorial_completed', 'true'); } catch (e) {}
    });

    const step = (name) => console.log('•', name);
    const shot = (name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });

    step('load + splash');
    await page.goto(BASE + '/?debug', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    await shot('01-splash');

    step('menu reveals after splash');
    await page.waitForSelector('#menu.show', { timeout: 9000 });
    await page.waitForTimeout(600);
    await shot('02-menu');

    step('keyboard mode navigation');
    await page.keyboard.press('ArrowRight');
    let sel = await page.$eval('#mode-select .mode.selected', el => el.dataset.mode);
    if (sel !== 'sprint') throw new Error('ArrowRight should select sprint, got ' + sel);
    await page.keyboard.press('ArrowLeft');
    sel = await page.$eval('#mode-select .mode.selected', el => el.dataset.mode);
    if (sel !== 'classic') throw new Error('ArrowLeft should return to classic, got ' + sel);

    step('Enter starts a classic run');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__wf && window.__wf.state === 'playing', null, { timeout: 5000 });

    step('type real words to build a combo');
    const typed = await (async () => {
        let done = 0;
        const deadline = Date.now() + 25000;
        while (done < 7 && Date.now() < deadline) {
            const text = await page.evaluate(() => {
                const g = window.__wf;
                const ws = g.words.filter(w => w.type !== 'decoy' && w.type !== 'boss' && w.y > 0);
                if (!ws.length) return null;
                ws.sort((a, b) => b.y - a.y);
                return ws[0].text;
            });
            if (!text) { await page.waitForTimeout(250); continue; }
            await page.keyboard.type(text, { delay: 25 });
            done++;
            if (done === 5) { await page.waitForTimeout(120); await shot('03-combo-callout'); }
        }
        return done;
    })();
    const combo = await page.evaluate(() => window.__wf.bestCombo);
    console.log(`  typed ${typed} words, best combo ${combo}`);
    if (typed < 5 || combo < 5) throw new Error('expected to type 5+ words for the combo callout');

    step('pause menu');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#pause-hint.show', { timeout: 2000 });
    await shot('04-pause');
    await page.click('#pause-resume');
    await page.waitForFunction(() => window.__wf.state === 'playing', null, { timeout: 2000 });

    step('force game over (1 life, drop a word onto the floor)');
    // Level-1 words fall at ~20 px/s (~35s to the floor), so rather than
    // wait, set 1 life and teleport a normal word past the floor line —
    // the next update() runs the real missWord -> gameOver path.
    await page.waitForFunction(() => window.__wf.words.some(w => w.type === 'normal'), null, { timeout: 10000 });
    await page.evaluate(() => {
        const g = window.__wf;
        g.lives = 1;
        const w = g.words.find(x => x.type === 'normal');
        w.y = g.h + 50;
    });
    await page.waitForSelector('#gameover.show', { timeout: 8000 });
    await page.waitForTimeout(2300); // let score count-up + grade stamp finish
    await shot('05-gameover');
    const end = await page.evaluate(() => ({
        grade: document.getElementById('go-grade').textContent,
        acc: document.getElementById('go-acc').textContent,
        score: document.getElementById('go-score').textContent,
        realScore: window.__wf.score,
    }));
    console.log('  end screen:', JSON.stringify(end));
    if (String(end.realScore) !== end.score) throw new Error('score count-up did not land on the real score');
    if (!/^[SABCD]$/.test(end.grade)) throw new Error('bad grade: ' + end.grade);

    await browser.close();
    if (errors.length) {
        console.error('\nERRORS:\n' + errors.join('\n'));
        process.exit(1);
    }
    console.log('\nE2E OK — screenshots in ' + SHOTS);
})().catch((e) => { console.error('E2E FAIL —', e.message); process.exit(1); });
