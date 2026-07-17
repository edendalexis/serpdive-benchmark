#!/usr/bin/env node
// STAGE 2 — the 1000 questions. Written by the panel, from the sealed topics.
//
// Two questions per model per topic (5 × 2 = 10). The panel order ROTATES from
// one topic to the next: without that, the same model would always be first to
// take the salient facts and the others would inherit the leftovers.
//
// Topics run in parallel; WITHIN a topic, the panel is sequential (each model
// sees the questions already written — the anti-duplicate rule).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, need, askJson, pool } from '../lib/llm.mjs';
import { writeCanonical, seal, hashFile } from '../lib/chain.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const runDir = process.argv[2];
if (!runDir) { console.error('usage: node bin/2-questions.mjs <runs/YYYY-MM-DD>'); process.exit(2); }

loadEnv(ROOT);
need('OPENROUTER_API_KEY');
const cfg = JSON.parse(readFileSync(join(ROOT, 'protocol/config.json'), 'utf8'));
const PROMPT = readFileSync(join(ROOT, 'protocol/prompts/questions.md'), 'utf8').match(/```\n([\s\S]*?)```/)[1];
const { panel, questions_per_model_per_topic: PER } = cfg.generation;

// The chain: we READ topics.json and declare its hash. If anyone touched it
// since it was sealed, `seal` refuses and everything stops here.
const topicsPath = join(runDir, 'topics.json');
const topicsHash = hashFile(topicsPath);
const { topics } = JSON.parse(readFileSync(topicsPath, 'utf8'));

console.log(`\nStage 2 — ${topics.length} topics × ${panel.length} models × ${PER} questions\n`);

let done = 0;
const perTopic = await pool(topics, 6, async (t) => {
  const taken = [];
  const rows = [];
  // The order rotates: topic i starts with model i.
  for (let k = 0; k < panel.length; k++) {
    const model = panel[(t.id + k) % panel.length];
    try {
      const { queries } = await askJson(model,
        PROMPT.replace('{{TOPIC}}', t.topic).replace('{{BRIEF}}', t.brief)
          .replace('{{N}}', String(PER))
          .replace('{{TAKEN}}', taken.length ? taken.join('\n') : '(none — you are the first)'),
        { temperature: 1 });
      for (const q of (queries || []).slice(0, PER)) {
        if (!q || typeof q !== 'string') continue;
        taken.push(q);
        rows.push({ query: q.trim(), topic: t.topic, topic_id: t.id, written_by: model });
      }
    } catch (e) { console.log(`  ! ${t.topic.slice(0, 30)} / ${model} — ${String(e).slice(0, 50)}`); }
  }
  console.log(`  ${String(++done).padStart(3)}/${topics.length}  ${t.topic.slice(0, 48).padEnd(48)} ${rows.length} questions`);
  return rows;
});

// The final order is the topics' order, not network arrival order: the file
// must be identical regardless of parallelism jitter, or the hash dances.
const questions = perTopic.flat().map((q, i) => ({ id: i, ...q }));

const path = join(runDir, 'questions.json');
const hash = writeCanonical(path, { protocol: cfg.version, panel, questions });
seal(runDir, {
  stage: 'questions',
  tool: '2-questions.mjs',
  reads: { 'topics.json': topicsHash },
  writes: { 'questions.json': hash },
  meta: { count: questions.length },
});

const byModel = {};
for (const q of questions) byModel[q.written_by] = (byModel[q.written_by] || 0) + 1;
console.log(`\n✅ ${questions.length} questions → ${path}\n   sealed ${hash.slice(0, 16)}…\n`);
for (const [m, n] of Object.entries(byModel).sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}  ${m}`);
console.log(`\n   COMMIT AND PUSH NOW, before any collection whatsoever.`);
console.log(`   That commit is what proves the questions predate the results.\n`);
