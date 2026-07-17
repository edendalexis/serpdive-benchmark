#!/usr/bin/env node
// STAGE 3 — the collection. Both APIs, the same day, no cache.
//
// The HTTP response is written VERBATIM (`await r.text()`). Nothing is rebuilt,
// nothing is removed, no field of the adversary is discarded. This file is what
// goes to the judge, and it is what tokens are counted on.
//
// Errors are KEPT and counted. A bench that silently replays its failures, or
// drops them from the denominator, is a rigged bench.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, need } from '../lib/llm.mjs';
import { hashDir, seal, hashFile } from '../lib/chain.mjs';
import { ARMS, tokensOf } from '../lib/arms.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const runDir = process.argv[2];
if (!runDir) { console.error('usage: node bin/3-collect.mjs <runs/YYYY-MM-DD> [--arms=mako,tavily]'); process.exit(2); }
const armNames = (process.argv.find((a) => a.startsWith('--arms='))?.split('=')[1] || 'mako,tavily').split(',');

loadEnv(ROOT);
const keys = Object.fromEntries(armNames.map((a) => {
  if (!ARMS[a]) { console.error(`unknown arm: ${a}`); process.exit(2); }
  return [a, need(ARMS[a].envKey)];
}));

const qPath = join(runDir, 'questions.json');
const qHash = hashFile(qPath);
const { questions } = JSON.parse(readFileSync(qPath, 'utf8'));

const outDir = join(runDir, 'payloads');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

console.log(`\nStage 3 — ${questions.length} questions × ${armNames.length} arms (${armNames.join(', ')})\n`);
const stats = Object.fromEntries(armNames.map((a) => [a, { ok: 0, err: 0, tok: 0, ms: 0 }]));
let done = 0;

// SEQUENTIAL collection, paced by a timer: a single question in flight, a
// fixed pause between each. The timer SPREADS the requests over time — sending
// requests at the same moment would make our own calls compete with each other
// and skew the measurements (latency, speed). Each request is therefore
// measured alone on the wire, under the same conditions for both arms.
const PACE_MS = 1000;
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
for (const q of questions) {
  const file = join(outDir, `${String(q.id).padStart(4, '0')}.json`);
  // Resume: a 1000-question run must not restart from zero on a flaky
  // network — but an already-written payload is NEVER redrawn, or we would be
  // choosing our own answers.
  if (existsSync(file)) { done++; continue; }

  const row = { id: q.id, query: q.query, topic: q.topic, topic_id: q.topic_id, collected_at: new Date().toISOString(), arms: {} };
  for (const a of armNames) {
    try {
      const { status, raw, latency_ms } = await ARMS[a].call(q.query, keys[a]);
      row.arms[a] = { status, latency_ms, tokens: tokensOf(raw), raw };
      if (status === 200) { stats[a].ok++; stats[a].tok += tokensOf(raw); stats[a].ms += latency_ms; }
      else stats[a].err++;
    } catch (e) {
      row.arms[a] = { status: 0, error: String(e).slice(0, 120) };
      stats[a].err++;
    }
  }
  writeFileSync(file, `${JSON.stringify(row, null, 2)}\n`);
  if (++done % 25 === 0) console.log(`  ${done}/${questions.length}`);
  await sleep(PACE_MS);
}

const { hash, count } = hashDir(outDir);
seal(runDir, {
  stage: 'collect',
  tool: '3-collect.mjs',
  reads: { 'questions.json': qHash },
  writes: { 'payloads/': hash },
  meta: { arms: armNames, count, collected_on: new Date().toISOString().slice(0, 10) },
});

console.log(`\n✅ ${count} payloads → ${outDir}\n   sealed ${hash.slice(0, 16)}…\n`);
for (const a of armNames) {
  const s = stats[a];
  const n = s.ok || 1;
  console.log(`   ${a.padEnd(8)} ${String(s.ok).padStart(4)} ok, ${s.err} errors  |  ${Math.round(s.tok / n).toLocaleString()} tokens/req  |  ${Math.round(s.ms / n)} ms`);
}
console.log();
