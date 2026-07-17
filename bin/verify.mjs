#!/usr/bin/env node
// THE ONLY SCRIPT THAT MATTERS TO THE READER.
//
// It touches no network, asks for no key, costs nothing. It rereads the
// published artifacts, recomputes every hash, and confirms — or refutes — that
// the published score is indeed the arithmetic of the verdicts, that the
// verdicts are indeed about these payloads, and that these payloads indeed
// answer these questions.
//
//   node bin/verify.mjs runs/2026-07-20
//
// It ALSO recomputes the score from the verdicts, without trusting
// results.json — that is the point: if we had rounded a number our way, this
// line would call it out.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { hashFile, hashDir, loadManifest, STAGES } from '../lib/chain.mjs';
import { tally } from '../lib/score.mjs';

const runDir = process.argv[2];
if (!runDir) { console.error('usage: node bin/verify.mjs <runs/YYYY-MM-DD>'); process.exit(2); }

const m = loadManifest(runDir);
if (!m.links.length) { console.error(`no MANIFEST in ${runDir}`); process.exit(2); }

let bad = 0;
const ok = (s, d = '') => console.log(`  \x1b[32m✓\x1b[0m ${s}${d ? `  ${d}` : ''}`);
const ko = (s, d = '') => { bad++; console.log(`  \x1b[31m✗\x1b[0m ${s}${d ? `  ${d}` : ''}`); };

console.log(`\n\x1b[1mSERPdive bench — verifying ${runDir}\x1b[0m\n`);
console.log(`run          ${m.run}`);
console.log(`protocol     ${m.protocol_sha || '(not sealed)'}`);
console.log(`\n\x1b[1m1. Are the artifacts the ones that were sealed?\x1b[0m`);

for (const stage of STAGES) {
  const link = m.links.find((l) => l.stage === stage);
  if (!link) { console.log(`  · ${stage} — not played yet`); continue; }
  for (const [name, sealed] of Object.entries(link.writes || {})) {
    const p = join(runDir, name);
    if (!existsSync(p)) { ko(`${stage} → ${name}`, 'MISSING'); continue; }
    const actual = name.endsWith('/') ? hashDir(p).hash : hashFile(p);
    if (actual === sealed) ok(`${stage} → ${name}`, `${sealed.slice(0, 12)}…`);
    else ko(`${stage} → ${name}`, `MODIFIED since sealing\n      sealed ${sealed}\n      actual ${actual}`);
  }
}

console.log(`\n\x1b[1m2. Do the links chain together?\x1b[0m`);
for (const link of m.links) {
  for (const [name, expected] of Object.entries(link.reads || {})) {
    const producer = m.links.find((l) => l.writes && l.writes[name]);
    if (!producer) { ko(`${link.stage} reads ${name}`, 'produced by nobody'); continue; }
    if (producer.writes[name] === expected) ok(`${link.stage} reads the ${name} sealed by ${producer.stage}`);
    else ko(`${link.stage} reads ${name}`, 'does NOT match what the previous stage sealed');
  }
}

console.log(`\n\x1b[1m3. Is the published score the arithmetic of the verdicts?\x1b[0m`);
const verdictsDir = join(runDir, 'verdicts');
const resultsPath = join(runDir, 'results.json');
if (existsSync(verdictsDir) && existsSync(resultsPath)) {
  const published = JSON.parse(readFileSync(resultsPath, 'utf8'));
  const recomputed = tally(verdictsDir);
  // Compare VALUES, not key order: `writeCanonical` sorts the published file's
  // keys, `tally` returns them in insertion order. Comparing two raw
  // `JSON.stringify` outputs would fail a perfectly honest run — and a
  // verifier that cries wolf is not believed when it cries for real.
  const canon = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
  const same = canon(recomputed.headline) === canon(published.headline);
  if (same) {
    const h = recomputed.headline;
    ok('recomputed from verdicts/ — identical to published',
      `${h.mako} / ${h.tavily} / ${h.tie} of ${h.n}`);
  } else {
    ko('THE PUBLISHED SCORE DOES NOT MATCH THE VERDICTS');
    console.log('    published  ', JSON.stringify(published.headline));
    console.log('    recomputed ', JSON.stringify(recomputed.headline));
  }
} else {
  console.log('  · no verdicts/results yet — stage not played');
}

console.log(`\n${'─'.repeat(64)}`);
if (bad === 0) {
  console.log('\x1b[32m\x1b[1mCHAIN INTACT.\x1b[0m The score is the arithmetic consequence of the payloads.');
  console.log('\nWhat this does not prove: that the payloads are authentic. No hash can');
  console.log('prove that. For that: the questions were pushed to GitHub BEFORE the');
  console.log('first payload (see the history), and you can replay `3-collect.mjs`');
  console.log('yourself with your own Tavily key.');
} else {
  console.log(`\x1b[31m\x1b[1m${bad} BREAK(S).\x1b[0m This run is not trustworthy.`);
}
process.exit(bad ? 1 : 0);
