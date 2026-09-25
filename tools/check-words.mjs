// Word-list integrity check for Word Fall.
// Run: node tools/check-words.mjs
// Verifies: no duplicates within/across tiers, no tier word appears in
// BOSS_WORDS, and every word sits in a sane length window for its tier.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'game.js'), 'utf8');

function extractTier(name) {
    // Matches: tierN: ('...' + '...').split(' ')  or  tierN: ('...').split(' ')
    const re = new RegExp(name + String.raw`:\s*\(((?:'[^']*'\s*\+?\s*)+)\)\.split`);
    const m = src.match(re);
    if (!m) throw new Error('could not extract ' + name);
    return [...m[1].matchAll(/'([^']*)'/g)].map(x => x[1]).join('').split(/\s+/).filter(Boolean);
}
function extractBoss() {
    const m = src.match(/const BOSS_WORDS = \[([\s\S]*?)\];/);
    if (!m) throw new Error('could not extract BOSS_WORDS');
    return [...m[1].matchAll(/'([a-z]+)'/g)].map(x => x[1]);
}

const tiers = Object.fromEntries(
    ['tier1', 'tier2', 'tier3', 'tier4', 'tier5'].map(t => [t, extractTier(t)])
);
const boss = extractBoss();
// Length windows: [min, max] per tier.
const windows = { tier1: [3, 4], tier2: [4, 6], tier3: [5, 7], tier4: [6, 10], tier5: [9, 14] };

let fail = 0;
const seen = new Map();
for (const [t, words] of Object.entries(tiers)) {
    for (const w of words) {
        if (seen.has(w)) { console.error(`DUP: '${w}' in ${t} and ${seen.get(w)}`); fail++; }
        seen.set(w, t);
        const [lo, hi] = windows[t];
        if (w.length < lo || w.length > hi) { console.error(`LEN: '${w}' (${w.length}) outside ${t} window ${lo}-${hi}`); fail++; }
        if (!/^[a-z]+$/.test(w)) { console.error(`CHARS: '${w}' in ${t}`); fail++; }
    }
}
const bossSet = new Set();
for (const w of boss) {
    if (bossSet.has(w)) { console.error(`DUP in BOSS_WORDS: '${w}'`); fail++; }
    bossSet.add(w);
    if (seen.has(w)) { console.error(`OVERLAP: boss word '${w}' also in ${seen.get(w)}`); fail++; }
    if (w.length < 10 || w.length > 16) { console.error(`LEN: boss '${w}' (${w.length}) outside 10-16`); fail++; }
}

const counts = Object.entries(tiers).map(([t, ws]) => `${t}:${ws.length}`).join(' ');
console.log(`${counts} boss:${boss.length} total:${seen.size + bossSet.size}`);
if (fail) { console.error(`${fail} problem(s)`); process.exit(1); }
console.log('WORD LISTS OK');
