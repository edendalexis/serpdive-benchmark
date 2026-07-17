#!/usr/bin/env node
// STAGE 4 — the judge. Blind, pairwise, with an independent anchor.
//
//   node bin/4-judge.mjs runs/<date>              # the published judge, on everything
//   node bin/4-judge.mjs runs/<date> --model=X    # YOURS, on our payloads
//
// That last line is the heart of the matter: you do not have to believe us.
// Take our payloads, your key, your model, and redo the judging. That is our
// only guarantee against judge bias — not a second judge chosen by us, but
// yours.
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, need, askJson, pool } from '../lib/llm.mjs';
import { hashDir, seal, hashFile } from '../lib/chain.mjs';
import { forJudge } from '../lib/arms.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const runDir = process.argv[2];
if (!runDir) { console.error('usage: node bin/4-judge.mjs <runs/YYYY-MM-DD> [--model=…]'); process.exit(2); }
const override = process.argv.find((a) => a.startsWith('--model='))?.split('=')[1];

loadEnv(ROOT);
need('OPENROUTER_API_KEY');
const cfg = JSON.parse(readFileSync(join(ROOT, 'protocol/config.json'), 'utf8'));
const PROMPT = readFileSync(join(ROOT, 'protocol/prompts/judge.md'), 'utf8').match(/```\n([\s\S]*?)```/)[1];

const models = override ? [override] : [cfg.judging.primary.model];

const payDir = join(runDir, 'payloads');
const payHash = hashDir(payDir).hash;
const rows = readdirSync(payDir).filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(readFileSync(join(payDir, f), 'utf8')));

const subset = rows;

const anchorFor = async (query) => {
  // The anchor: a provider that is NEITHER us NOR the adversary. Cached by
  // day+question — never paid for twice, and identical for both arms, so it
  // cannot favor anyone.
  const cacheDir = join(runDir, 'anchors');
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
  const key = join(cacheDir, `${Buffer.from(query).toString('base64url').slice(0, 60)}.json`);
  if (existsSync(key)) return JSON.parse(readFileSync(key, 'utf8')).text;
  const r = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'x-api-key': need('EXA_API_KEY'), 'content-type': 'application/json' },
    body: JSON.stringify({ query, numResults: 5, contents: { text: { maxCharacters: 1200 } } }),
    signal: AbortSignal.timeout(30000),
  });
  const d = await r.json();
  const text = (d.results || []).map((x) => `[${x.url}] ${(x.text || '').slice(0, 900)}`).join('\n\n');
  writeFileSync(key, `${JSON.stringify({ query, text }, null, 2)}\n`);
  return text;
};

for (const model of models) {
  const slug = model.replace(/[^a-z0-9]+/gi, '-');
  const outDir = join(runDir, override ? `verdicts-${slug}` : 'verdicts');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  console.log(`\nStage 4 — judge ${model} over ${subset.length} questions\n`);
  let done = 0;

  await pool(subset, 6, async (row) => {
    const file = join(outDir, `${String(row.id).padStart(4, '0')}.json`);
    if (existsSync(file)) { done++; return; }

    // THE BLINDING. Mako sits in A every other question, mechanically. The
    // judge never sees a vendor name; `mako_is_a` exists only in the verdict
    // we write AFTERWARDS, and 5-score is what translates it into a winner.
    const makoIsA = row.id % 2 === 0;
    const mako = row.arms.mako;
    const rival = row.arms.tavily;
    const out = { id: row.id, query: row.query, topic: row.topic, judge: model, mako_is_a: makoIsA };

    if (!mako?.raw || !rival?.raw || mako.status !== 200 || rival.status !== 200) {
      out.error = `missing payload (mako ${mako?.status ?? '?'}, tavily ${rival?.status ?? '?'})`;
      writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
      done++;
      return;
    }

    try {
      const anchor = await anchorFor(row.query);
      const A = forJudge(makoIsA ? 'mako' : 'tavily', makoIsA ? mako.raw : rival.raw);
      const B = forJudge(makoIsA ? 'tavily' : 'mako', makoIsA ? rival.raw : mako.raw);
      const v = await askJson(model,
        PROMPT.replace('{{QUERY}}', row.query).replace('{{ANCHOR}}', anchor)
          .replace('{{A}}', A).replace('{{B}}', B),
        { temperature: 0 });
      Object.assign(out, {
        winner: v.winner, a_issues: v.a_issues, b_issues: v.b_issues, reasoning: v.reasoning,
      });
    } catch (e) {
      out.error = String(e).slice(0, 160);
    }
    writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
    if (++done % 25 === 0) console.log(`  ${done}/${subset.length}`);
  });

  const { hash, count } = hashDir(outDir);
  const name = `${outDir.replace(`${runDir}/`, '')}/`;
  if (!override) {
    seal(runDir, {
      stage: 'judge',
      tool: '4-judge.mjs',
      reads: { 'payloads/': payHash },
      writes: { [name]: hash },
      meta: { model, count, temperature: 0 },
    });
  }
  console.log(`\n✅ ${count} verdicts → ${outDir}\n   sealed ${hash.slice(0, 16)}…`);
}
void hashFile;
console.log();
