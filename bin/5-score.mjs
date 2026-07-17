#!/usr/bin/env node
// STAGE 5 — the score. Arithmetic, and nothing else.
//
// No judgment call is made here, no question is discarded, no number is
// rounded in one direction. `verify.mjs` recomputes all of this on the
// reader's machine, without us: it is the only stage where we could lie, so it
// is the one we make as dumb as possible.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashDir, writeCanonical, seal } from '../lib/chain.mjs';
import { tally } from '../lib/score.mjs';
import { ARMS } from '../lib/arms.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
void ROOT;
const runDir = process.argv[2];
if (!runDir) { console.error('usage: node bin/5-score.mjs <runs/YYYY-MM-DD>'); process.exit(2); }

const verdictsDir = join(runDir, 'verdicts');
const vHash = hashDir(verdictsDir).hash;
const r = tally(verdictsDir);

// Tokens and latency: on the ENTIRE JSON, not on the `content` field.
const payDir = join(runDir, 'payloads');
const pays = readdirSync(payDir).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(payDir, f), 'utf8')));
// Two latencies, side by side. `wall`: clocked by us around the HTTP call —
// same machine, same moment for both arms, but it includes the network of the
// collecting machine. `server`: the time each vendor reports ITSELF inside its
// payload (response_time_ms / response_time) — network excluded, and without
// us ever clocking the adversary. Extracted from the verbatim `raw`, hence
// recomputable by anyone from the published payloads.
const median = (xs) => xs.sort((x, y) => x - y)[Math.floor(xs.length / 2)] ?? null;
const cost = {};
for (const a of ['mako', 'tavily']) {
  const ok = pays.map((p) => p.arms[a]).filter((x) => x && x.status === 200);
  const server = ok.map((x) => { try { return ARMS[a].serverMs(JSON.parse(x.raw)); } catch { return null; } })
    .filter((v) => typeof v === 'number');
  cost[a] = {
    tokens_per_query: Math.round(ok.reduce((s, x) => s + x.tokens, 0) / (ok.length || 1)),
    latency_wall_ms_median: median(ok.map((x) => x.latency_ms)),
    latency_server_ms_median: median(server),
    latency_server_reported: server.length,
    responses_ok: ok.length,
  };
}

// Inter-judge agreement — computed ONLY if a second judging exists, i.e. if
// someone replayed `4-judge.mjs --model=X` (a `verdicts-<slug>` directory).
// Our published run has none; this number appears on the reader's machine when
// they verify us.
const agreement = {};
for (const d of readdirSync(runDir).filter((x) => x.startsWith('verdicts-'))) {
  const other = tally(join(runDir, d));
  const mine = readdirSync(join(runDir, d)).filter((f) => f.endsWith('.json'));
  let same = 0, both = 0;
  for (const f of mine) {
    const a = JSON.parse(readFileSync(join(verdictsDir, f), 'utf8'));
    const b = JSON.parse(readFileSync(join(runDir, d, f), 'utf8'));
    if (a.error || b.error) continue;
    both++;
    if (a.winner === b.winner) same++;
  }
  agreement[d.replace('verdicts-', '')] = {
    n: both,
    agreement_pct: both ? +((same / both) * 100).toFixed(1) : null,
    their_win_rate: other.win_rate,
  };
}

const results = {
  run: runDir.split('/').pop(),
  headline: r.headline,
  win_rate: r.win_rate,
  ci95: r.ci95,
  cost,
  by_topic: r.by_topic,
  judge_agreement: agreement,
};

const path = join(runDir, 'results.json');
const hash = writeCanonical(path, results);
seal(runDir, {
  stage: 'score',
  tool: '5-score.mjs',
  reads: { 'verdicts/': vHash },
  writes: { 'results.json': hash },
});

const h = r.headline;
console.log(`\n${'═'.repeat(58)}`);
console.log(`  MAKO ${h.mako}   TAVILY ${h.tavily}   ties ${h.tie}   errors ${h.error}`);
console.log(`  win rate ${r.win_rate} %   (95% CI: ${r.ci95[0]}–${r.ci95[1]})`);
console.log(`${'═'.repeat(58)}`);
console.log(`  tokens/req   mako ${cost.mako.tokens_per_query.toLocaleString()}   tavily ${cost.tavily.tokens_per_query.toLocaleString()}`);
console.log(`  median latency (wall)   mako ${cost.mako.latency_wall_ms_median} ms   tavily ${cost.tavily.latency_wall_ms_median} ms`);
console.log(`  median latency (server) mako ${cost.mako.latency_server_ms_median} ms   tavily ${cost.tavily.latency_server_ms_median} ms`);
if (Object.keys(agreement).length) {
  console.log(`\n  inter-judge agreement:`);
  for (const [m, a] of Object.entries(agreement)) console.log(`    ${m.padEnd(30)} ${a.agreement_pct} % over ${a.n}   (their win rate: ${a.their_win_rate} %)`);
}

// The topics where we lose — printed first, and published. This is what makes
// the rest credible: whoever publishes their defeats is believed on their wins.
const losses = Object.entries(r.by_topic).filter(([, v]) => v.tavily > v.mako)
  .sort((a, b) => (b[1].tavily - b[1].mako) - (a[1].tavily - a[1].mako));
if (losses.length) {
  console.log(`\n  our ${losses.length} losing topics:`);
  for (const [t, v] of losses.slice(0, 10)) console.log(`    ${t.slice(0, 44).padEnd(44)} ${v.mako}-${v.tavily}`);
}
console.log(`\n✅ ${path}  ${hash.slice(0, 16)}…`);
console.log(`\n   node bin/verify.mjs ${runDir}\n`);
void existsSync;
