// Browser check for the render paths the main e2e doesn't reach:
// boss warning + boss wave, bomb DETONATED hold, and a Versus match.
//
//   Run:  node tools/e2e-paths.cjs [baseUrl] [screenshotDir] [WxH]
//   Default baseUrl: http://localhost:8000, viewport 1366x768.
//
//   THREE_JS=/path/to/three.min.js  serves that file in place of the cdnjs
//   URL (for sandboxes without CDN access; use npm three@0.128.0's
//   build/three.min.js). EXPECT_3D=1 fails the run if the 3D layer
//   doesn't start. GFX=high|low presets the Graphics setting.
//
// Fails on any page error / console error. Saves a screenshot per path.

const path = require('path');
const { execSync } = require('child_process');

function loadPlaywright() {
    try { return require('playwright'); } catch (e) {}
    const globalRoot = execSync('npm root -g').toString().trim();
    return require(path.join(globalRoot, 'playwright'));
}

const BASE = process.argv[2] || 'http://localhost:8000';
const SHOTS = process.argv[3] || path.join(process.cwd(), 'e2e-shots');
const [VW, VH] = (process.argv[4] || '1366x768').split('x').map(Number);

(async () => {
    const { chromium } = loadPlaywright();
    require('fs').mkdirSync(SHOTS, { recursive: true });
    const browser = await chromium.launch({
        executablePath: process.env.PW_CHROMIUM || undefined,
        args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'],
    });
    const page = await browser.newPage({ viewport: { width: VW, height: VH } });
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const t = m.text();
        if (/Failed to load resource|net::ERR|fonts\.g/.test(t)) return;
        errors.push('console: ' + t);
    });
    await page.addInitScript(() => {
        try { localStorage.setItem('wordfall_tutorial_completed', 'true'); } catch (e) {}
    });
    if (process.env.THREE_JS) {
        const body = require('fs').readFileSync(process.env.THREE_JS);
        await page.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\//, (route) =>
            route.fulfill({ status: 200, contentType: 'application/javascript', body,
                headers: { 'Access-Control-Allow-Origin': '*' } }));
    }
    const step = (name) => console.log('•', name);
    const tag = `${VW}x${VH}`;
    const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${tag}-${name}.png`) });

    await page.goto(BASE + '/?debug', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#menu.show', { timeout: 9000 });
    if (process.env.EXPECT_3D) {
        await page.waitForFunction(() => window.WordfallBG3D && window.WordfallBG3D.ready === true, null, { timeout: 10000 })
            .catch(() => { throw new Error('3D background layer did not start'); });
    }
    const has3D = await page.evaluate(() => !!(window.WordfallBG3D && window.WordfallBG3D.ready));
    console.log('  3D layer:', has3D ? 'on' : 'off (2D fallback)');
    await page.waitForTimeout(1000);
    await shot('menu');

    step('boss warning -> boss wave');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__wf && window.__wf.state === 'playing', null, { timeout: 5000 });
    // One word short of level 5 (a boss level); typing one word levels up.
    await page.evaluate(() => { const g = window.__wf; g.level = 4; g.wordsCompleted = 12 * 4 - 1; });
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        const st = await page.evaluate(() => window.__wf.bossState);
        if (st !== 'none') break;
        const text = await page.evaluate(() => {
            const ws = window.__wf.words.filter(w => w.type !== 'decoy' && w.type !== 'boss' && w.y > 0);
            ws.sort((a, b) => b.y - a.y);
            return ws.length ? ws[0].text : null;
        });
        if (text) await page.keyboard.type(text, { delay: 20 });
        else await page.waitForTimeout(200);
    }
    await page.waitForTimeout(500);
    await shot('boss-warning');
    // The boss spawns above the screen and drifts in; wait until it's visible.
    await page.waitForFunction(() => window.__wf.words.some(w => w.type === 'boss' && w.y > 40), null, { timeout: 60000 });
    await shot('boss-wave');

    step('life lost');
    await page.evaluate(() => {
        const g = window.__wf;
        g.lives = 3;
        const w = g.words.find(x => x.type !== 'boss' && x.type !== 'decoy' && x.type !== 'bomb');
        if (w) w.y = g.h + 50;
    });
    await page.waitForTimeout(300);
    await shot('life-lost');

    step('bomb -> DETONATED hold -> game over');
    await page.evaluate(() => {
        const g = window.__wf;
        const w = g.words.find(x => x.type !== 'boss') || g.words[0];
        w.type = 'bomb';
        w.pausedByBoss = false;
        w.y = g.h + 50;
    });
    await page.waitForFunction(() => window.__wf.state === 'detonated', null, { timeout: 4000 });
    await page.waitForTimeout(300);
    await shot('detonated');
    await page.waitForSelector('#gameover.show', { timeout: 6000 });

    step('versus match');
    await page.click('#menu-btn');
    await page.waitForSelector('#menu.show', { timeout: 4000 });
    await page.click('#mode-select .mode[data-mode="versus"]');
    await page.waitForSelector('#vs-tiers .vs-tier', { state: 'visible', timeout: 3000 });
    await page.click('#vs-tiers .vs-tier[data-tier="rookie"]');
    await page.waitForTimeout(3500);
    await shot('versus');

    const fps = await page.evaluate(() => Math.round(window.__wf.fps || 0));
    console.log('  fps (headless, software GL):', fps);

    await browser.close();
    if (errors.length) {
        console.error('\nERRORS:\n' + errors.join('\n'));
        process.exit(1);
    }
    console.log('\nPATHS OK — screenshots in ' + SHOTS);
})().catch((e) => { console.error('PATHS FAIL —', e.message); process.exit(1); });
