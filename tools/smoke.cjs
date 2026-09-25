// Headless smoke test for Word Fall.
// Run: node tools/smoke.cjs
//
// Evaluates the entire game.js against a permissive DOM/browser shim and
// reports any error thrown at module-evaluation time (syntax errors, TDZ
// ReferenceErrors from misordered consts, bad top-level calls). This is
// much stronger than `node --check`, which only catches syntax errors —
// it's what caught the TDZ crashes after the June refactor.

const path = require('path');

const handler = {
    get: (t, p) => {
        if (p === Symbol.toPrimitive || p === 'toString') return () => '';
        if (!(p in t)) t[p] = mkStub();
        return t[p];
    },
    set: () => true,
    apply: () => mkStub(),
};
function mkStub() {
    const f = function () { return mkStub(); };
    f.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
    f.style = new Proxy({}, { get: () => '', set: () => true });
    f.dataset = {};
    return new Proxy(f, handler);
}

global.window = new Proxy({
    addEventListener() {}, innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
    location: { href: 'http://localhost/' }, AudioContext: function () { return mkStub(); },
}, handler);
global.document = new Proxy({
    getElementById: () => mkStub(),
    querySelectorAll: () => [],
    querySelector: () => mkStub(),
    createElement: () => mkStub(),
    addEventListener() {},
    body: mkStub(),
}, handler);
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
global.navigator = { maxTouchPoints: 0 };
global.performance = { now: () => 0 };
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};
global.fetch = () => Promise.resolve({ ok: false });
global.Image = function () { return { addEventListener() {}, set src(v) {} }; };
global.Audio = function () { return { addEventListener() {}, load() {}, play: () => Promise.resolve(), pause() {} }; };
global.atob = (s) => Buffer.from(s, 'base64').toString('binary');
global.Blob = function () {};
global.File = function () {};

try {
    require(path.join(__dirname, '..', 'game.js'));
    console.log('SMOKE OK — game.js evaluated end-to-end without throwing');
    process.exit(0);
} catch (e) {
    console.error('SMOKE FAIL —', e.constructor.name + ':', e.message);
    console.error(((e.stack || '').split('\n')[1] || '').trim());
    process.exit(1);
}
