#!/usr/bin/env node
// THE SECOND JUDGE — read-only.
//
//   node bin/compare-judges.mjs runs/<date>
//
// Compares the published judge (`verdicts/`) against every re-judging present
// in the run, produced by `4-judge.mjs --model=X`. It looks in two places:
// `verdicts-<slug>/` where that command drops its output, and `annex/` where
// OUR published re-judging lives.
//
// Why ours sits in `annex/`: `5-score.mjs` treats any directory named
// `verdicts-*` as a reason to recompute `judge_agreement`, which rewrites
// `results.json` and re-seals the score stage. A published run's sealed
// artifacts must stay byte-identical forever — including on your machine, when
// you replay us. Moving the directory out of that prefix is what guarantees
// nobody's scoring stage is ever tempted to rewrite a sealed file.
//
// This script writes NOTHING, ever.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const runDir = process.argv[2];
if (!runDir) { console.error('usage: node bin/compare-judges.mjs <runs/YYYY-MM-DD>'); process.exit(2); }

const baseDir = join(runDir, 'verdicts');
if (!existsSync(baseDir)) { console.error(`no verdicts/ in ${runDir}`); process.exit(2); }
const annexDir = join(runDir, 'annex');
const others = [
  ...readdirSync(runDir).filter((d) => d.startsWith('verdicts-')),
  ...(existsSync(annexDir) ? readdirSync(annexDir).filter((d) => d.startsWith('verdicts-')).map((d) => join('annex', d)) : []),
];
if (!others.length) {
  console.error(`\n  No re-judging found in ${runDir}.`);
  console.error(`  Produce one:  node bin/4-judge.mjs ${runDir} --model=<your model>\n`);
  process.exit(2);
}

const files = readdirSync(baseDir).filter((f) => f.endsWith('.json')).sort();
const read = (dir, f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));

// Same arithmetic as lib/score.mjs: a verdict says "A" or "B", and `mako_is_a`
// — written by 4-judge, never seen by the judge — is what turns it into a
// winner. Reimplementing it here would be a second place to make a mistake, so
// this is a copy of one line, not a second scoring policy.
const outcome = (r) => (r.error ? 'error'
  : r.winner === 'tie' ? 'tie'
    : (r.winner === 'A') === r.mako_is_a ? 'mako' : 'tavily');

const ci = (k, n) => {
  const p = k / n;
  const se = Math.sqrt((p * (1 - p)) / n);
  return [+((p - 1.96 * se) * 100).toFixed(1), +((p + 1.96 * se) * 100).toFixed(1)];
};

const tally = (dir) => {
  const h = { mako: 0, tavily: 0, tie: 0, error: 0 };
  const topics = {};
  for (const f of files) {
    const r = read(dir, f);
    const o = outcome(r);
    h[o]++;
    const t = r.topic || 'unknown';
    topics[t] = topics[t] || { mako: 0, tavily: 0 };
    if (o === 'mako' || o === 'tavily') topics[t][o]++;
  }
  const judged = h.mako + h.tavily + h.tie;
  const decided = h.mako + h.tavily;
  return {
    ...h,
    judged,
    decided,
    win: +((h.mako / judged) * 100).toFixed(1),
    ci: ci(h.mako, judged),
    // Win rate over DECIDED duels — ties excluded. Judges do not share the same
    // appetite for ties, so this is the figure that survives changing judge.
    winD: +((h.mako / decided) * 100).toFixed(1),
    ciD: ci(h.mako, decided),
    topics,
  };
};

const pad = (s, w) => String(s).padEnd(w);
const bar = (w = 76) => console.log('─'.repeat(w));
const base = tally(baseDir);
const baseModel = read(baseDir, files[0]).judge;

console.log(`\n\x1b[1m${runDir} — ${files.length} blind duels, ${1 + others.length} judges\x1b[0m\n`);
console.log(`  ${pad('judge', 32)} ${pad('mako', 6)} ${pad('tavily', 7)} ${pad('tie', 5)} ${pad('err', 4)} ${pad('win%', 6)} 95% CI`);
bar();
const rowOf = (name, t) => `  ${pad(name, 32)} ${pad(t.mako, 6)} ${pad(t.tavily, 7)} ${pad(t.tie, 5)} ${pad(t.error, 4)} ${pad(t.win, 6)} [${t.ci[0]}–${t.ci[1]}]`;
console.log(rowOf(`${baseModel} (published)`, base));
const tallies = others.map((d) => [d, tally(join(runDir, d))]);
for (const [d, t] of tallies) console.log(rowOf(read(join(runDir, d), files[0]).judge, t));

console.log(`\n  Win rate over DECIDED duels (ties excluded):`);
bar();
console.log(`  ${pad(`${baseModel} (published)`, 32)} ${pad(`${base.winD} %`, 8)} [${base.ciD[0]}–${base.ciD[1]}]   ${base.mako}/${base.decided}`);
for (const [d, t] of tallies) {
  console.log(`  ${pad(read(join(runDir, d), files[0]).judge, 32)} ${pad(`${t.winD} %`, 8)} [${t.ciD[0]}–${t.ciD[1]}]   ${t.mako}/${t.decided}`);
}

for (const [d, t] of tallies) {
  const dir = join(runDir, d);
  const model = read(dir, files[0]).judge;
  console.log(`\n\x1b[1m  ${baseModel}  vs  ${model}\x1b[0m`);
  bar();

  const cell = {};
  let same = 0;
  for (const f of files) {
    const a = outcome(read(baseDir, f));
    const b = outcome(read(dir, f));
    cell[`${a}>${b}`] = (cell[`${a}>${b}`] || 0) + 1;
    if (a === b) same++;
  }
  const c = (k) => cell[k] || 0;

  // Three agreement figures, because only publishing the flattering one would
  // be exactly the kind of framing this benchmark exists to refuse. Raw
  // agreement is dragged down by the tie boundary — judges disagree on whether
  // a duel is close, far more often than on who won it.
  const bothDecided = c('mako>mako') + c('tavily>tavily') + c('mako>tavily') + c('tavily>mako');
  const agreeDecided = c('mako>mako') + c('tavily>tavily');
  const reversals = c('mako>tavily') + c('tavily>mako');
  console.log(`  raw agreement            ${same}/${files.length}  (${(same / files.length * 100).toFixed(1)} %)`);
  console.log(`  agreement where BOTH decided  ${agreeDecided}/${bothDecided}  (${(agreeDecided / bothDecided * 100).toFixed(1)} %)`);
  console.log(`  outright reversals       ${reversals}/${files.length}  (${(reversals / files.length * 100).toFixed(1)} %)`);

  console.log(`\n  transition matrix (${baseModel} → ${model}):`);
  for (const [k, v] of Object.entries(cell).sort((x, y) => y[1] - x[1])) {
    console.log(`    ${pad(k.replace('>', ' → '), 22)} ${String(v).padStart(4)}`);
  }

  // The question a second judge exists to answer: when it breaks ties the
  // published judge left open, does it break them OUR way? A significant skew
  // here would mean the extra decisiveness is a preference, not a temperament.
  const tm = c('tie>mako');
  const tt = c('tie>tavily');
  if (tm + tt > 0) {
    const n = tm + tt;
    const z = (tm - n / 2) / Math.sqrt(n * 0.25);
    console.log(`\n  ties broken: ${n} of ${base.tie}  →  mako ${tm}, tavily ${tt}  (${(tm / n * 100).toFixed(1)} % our way)`);
    console.log(`    z = ${z.toFixed(2)} against 50/50 — ${Math.abs(z) > 1.96 ? 'SIGNIFICANT skew' : 'no significant skew'}`);
  }

  // McNemar on outright reversals: is the disagreement symmetric, or does one
  // judge systematically lean one way?
  if (reversals > 0) {
    const chi2 = ((Math.abs(c('mako>tavily') - c('tavily>mako')) - 1) ** 2) / reversals;
    console.log(`\n  McNemar on reversals: ${c('mako>tavily')} vs ${c('tavily>mako')}, chi2 = ${chi2.toFixed(2)}`);
    console.log(`    ${chi2 > 3.84 ? 'SIGNIFICANT judge effect (p<0.05)' : 'symmetric — no detectable judge effect'}`);
  }

  const winnerOf = (x) => (x.mako > x.tavily ? 'mako' : x.mako < x.tavily ? 'tavily' : 'tie');
  let stable = 0;
  for (const topic of Object.keys(base.topics)) {
    if (winnerOf(base.topics[topic]) === winnerOf(t.topics[topic])) stable++;
  }
  console.log(`\n  same winner on ${stable}/${Object.keys(base.topics).length} topics\n`);
}
