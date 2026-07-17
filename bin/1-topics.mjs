#!/usr/bin/env node
// STAGE 1 — the topics. Written by five AIs from five vendors, never by us.
//
// Each model produces, in ONE call and without seeing the others, a list of
// candidates — no domain instruction, no list of taken topics: nothing. The
// five lists are published (candidates.json), then the harness DRAWS 20 topics
// per list at random. The seed of the draw is the SHA-256 of the candidates
// file itself: we can neither choose the seed nor touch a list without
// changing it. Anyone replaying the draw lands on the same topics.
//
// Why not sequential picking? Measured: with the anti-duplicate list in
// context, models pick "next to" the topics already taken and everything
// converges on a single domain; without it, each isolated call returns the
// same obvious entities (a third exact duplicates). Over-generation is the
// only tested variant where diversity emerges WITHOUT any instruction.
//
// A drawn candidate then passes two mechanical, published gates:
//   - duplicate check by normalization (case, accents, token inclusion);
//   - the NEWS GATE: sonar summarizes the entity's recent news; if nothing
//     recent about the entity ITSELF, the candidate is skipped. This is not
//     steering: a news-search API must be tested on news.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { loadEnv, need, ask, askJson, pool } from '../lib/llm.mjs';
import { writeCanonical, seal, ensureRun, hashFile } from '../lib/chain.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const runDir = process.argv[2];
if (!runDir) { console.error('usage: node bin/1-topics.mjs <runs/YYYY-MM-DD>'); process.exit(2); }

loadEnv(ROOT);
need('OPENROUTER_API_KEY');
const cfg = JSON.parse(readFileSync(join(ROOT, 'protocol/config.json'), 'utf8'));
const PROMPT = readFileSync(join(ROOT, 'protocol/prompts/topics.md'), 'utf8').match(/```\n([\s\S]*?)```/)[1];
const { panel, news_gate: GATE, candidates_per_model: K, picks_per_model: PICKS } = cfg.generation;
const N = cfg.scale.topics;

ensureRun(runDir);

// ── 1. The candidates: five independent calls, no shared context. ─────────────
// Resume: if candidates.json already exists for this run, it is reused as is —
// same file, same seed, same draw. Already-sealed candidates are NEVER redrawn.
console.log(`\nStage 1 — ${K} candidates × ${panel.length} vendors, then a draw of ${PICKS} per list\n`);
const candPath = join(runDir, 'candidates.json');
let candidates;
if (existsSync(candPath)) {
  candidates = JSON.parse(readFileSync(candPath, 'utf8')).candidates;
  console.log('  resume: existing candidates.json reused (seed and draw unchanged)');
} else {
  candidates = {};
  await pool(panel, panel.length, async (model) => {
    const { topics } = await askJson(model, PROMPT.replace('{{K}}', String(K)), { temperature: 1 });
    candidates[model] = (topics || [])
      .filter((t) => t && typeof t.topic === 'string' && t.topic.trim())
      .slice(0, K)
      .map((t) => ({ topic: t.topic.trim(), why_recent: String(t.why_recent || '') }));
    console.log(`  ${model.padEnd(32)} ${candidates[model].length} candidates`);
  });
  writeCanonical(candPath, { protocol: cfg.version, panel, candidates });
}

// Published BEFORE the draw: the seed depends on this file, byte for byte.
const candHash = hashFile(candPath);
console.log(`\n  candidates sealed ${candHash.slice(0, 16)}… — the seed of the draw\n`);

// ── 2. The draw. Seed = hash of the candidates; nobody chose it. ──────────────
let s = parseInt(candHash.slice(0, 8), 16);
const rnd = () => {
  s |= 0; s = (s + 0x6D2B79F5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
// Shuffle order follows the panel order in config.json: deterministic.
const decks = panel.map((m) => ({ model: m, deck: shuffle(candidates[m]) }));

// Mechanical duplicate rule: same normalized form, or one side's tokens fully
// included in the other's ("Starship" vs "SpaceX Starship"). It misses
// cross-language duplicates — accepted: the rule must stay dumb and verifiable.
const norm = (x) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const isDup = (a, b) => {
  if (norm(a) === norm(b)) return true;
  const A = new Set(norm(a).split(' ')), B = new Set(norm(b).split(' '));
  const sub = (X, Y) => [...X].every((t) => Y.has(t));
  return sub(A, B) || sub(B, A);
};

// Sonar briefs are cached on disk (like the Exa anchors): a crash or a rerun
// never pays twice for a verdict already rendered.
const briefDir = join(runDir, 'briefs');
if (!existsSync(briefDir)) mkdirSync(briefDir, { recursive: true });
async function brief(topic) {
  const key = join(briefDir, `${Buffer.from(topic).toString('base64url').slice(0, 60)}.json`);
  if (existsSync(key)) return JSON.parse(readFileSync(key, 'utf8')).brief;
  // 90 s × 3 attempts max: a frozen upstream costs ~5 min, then the candidate
  // is skipped (gate_error verdict, published) — it can no longer stall the
  // run. The failure is NOT cached: a rerun will retry this candidate.
  const text = await ask(GATE,
    `Summarize in 6 to 10 bullet points the RECENT, verifiable developments concerning "${topic}".`
    + ` If you find no recent development about this entity itself, reply exactly: NO RECENT NEWS.`,
    { temperature: 0.2, timeoutMs: 90000, retries: 2 });
  const b = /NO RECENT NEWS/i.test(text) ? null : text;
  writeFileSync(key, `${JSON.stringify({ topic, brief: b }, null, 2)}\n`);
  return b;
}

// ── 3. The selection: round-robin, every rejection logged and replaced. ───────
// Sequential on purpose: the order of duplicate checks is part of the draw and
// must be identical for anyone replaying it.
// If a list runs dry before its 20 (duplicates + gate), the others fill in
// beyond their quota, in the same round-robin order: a mechanical rule, not a
// choice — any imbalance is visible in topics.json.
const topics = [];
const gateLog = []; // every tested candidate → verdict. Published: the selection replays.
const perModel = Object.fromEntries(panel.map((m) => [m, 0]));

async function refill() {
  for (let pass = 0; pass < 2 && topics.length < N; pass++) {
    // Anti-stall guard: if a full round CONSUMES no candidate (the only
    // remaining decks belong to models at quota), move to the next pass
    // instead of spinning forever.
    for (let consumed = -1; consumed !== 0 && topics.length < N;) {
      consumed = 0;
      for (const { model, deck } of decks) {
        if (topics.length >= N || (pass === 0 && perModel[model] >= PICKS)) continue;
        while (deck.length) {
          consumed++;
          const cand = deck.shift();
          if (topics.some((t) => isDup(t.topic, cand.topic))) {
            gateLog.push({ topic: cand.topic, from: model, verdict: 'rule_duplicate' });
            console.log(`  ✗ ${model.padEnd(28)} "${cand.topic}" — duplicate (rule), next`);
            continue;
          }
          let b;
          try {
            b = await brief(cand.topic);
          } catch (e) {
            gateLog.push({ topic: cand.topic, from: model, verdict: 'gate_error', error: String(e).slice(0, 100) });
            console.log(`  ✗ ${model.padEnd(28)} "${cand.topic}" — gate error (${String(e).slice(0, 50)}), next`);
            continue;
          }
          if (!b) {
            gateLog.push({ topic: cand.topic, from: model, verdict: 'no_recent_news' });
            console.log(`  ✗ ${model.padEnd(28)} "${cand.topic}" — no recent news, next`);
            continue;
          }
          gateLog.push({ topic: cand.topic, from: model, verdict: 'ok' });
          topics.push({ topic: cand.topic, why_recent: cand.why_recent, picked_by: model, brief: b });
          perModel[model]++;
          console.log(`  ${String(topics.length).padStart(3)}. ${cand.topic.slice(0, 58).padEnd(58)} ${model.split('/')[0]}`);
          break;
        }
      }
    }
    console.log(`  — end of pass ${pass}: ${topics.length}/${N} topics, deck remainders: ${decks.map((d) => d.deck.length).join(' / ')}`);
  }
}

await refill();

// ── 4. Final duplicate check: ONE call, one numbered list. ────────────────────
// The mechanical rule misses cross-language duplicates ("Paris 2024 Olympics" /
// "JO Paris 2024"). A large model rereads the list; it can only FLAG numbers —
// replacements come from the draw, like everything else. Its verdicts are
// published in gate.json alongside the gate's.
const DEDUP = cfg.generation.dedup_check;
async function dedupCycle(tag) {
  for (let iter = 0; iter < 3; iter++) {
    console.log(`\n  duplicate review ${tag}.${iter + 1} (${DEDUP}) over ${topics.length} topics — one call…`);
    const listing = topics.map((t, i) => `${i}. ${t.topic}`).join('\n');
    const { duplicates } = await askJson(DEDUP,
      `Here is a list of topics. Detect entries that refer to the SAME entity — different name, different language, different spelling. Do NOT flag topics that are merely similar or from the same domain: only the same entity.\n\n${listing}\n\n`
      + `Reply in strict JSON: {"duplicates": [[<index to keep>, <duplicate index>], …]} — or {"duplicates": []} if none.`,
      { temperature: 0 });
    gateLog.push({ dedup: `${tag}.${iter + 1}`, model: DEDUP, flagged: duplicates || [] });
    const drop = [...new Set((duplicates || []).flatMap((g) => g.slice(1)))]
      .filter((i) => Number.isInteger(i) && i >= 0 && i < topics.length);
    if (!drop.length) { console.log(`  duplicate check: nothing to flag`); return; }
    for (const i of drop.sort((a, b) => b - a)) {
      console.log(`  ✗ flagged duplicate: "${topics[i].topic}" — replaced from the draw`);
      perModel[topics[i].picked_by]--;
      topics.splice(i, 1);
    }
    await refill();
  }
}
await dedupCycle(1);

// ── 5. Top-up rounds: if the decks run dry before N. ──────────────────────────
// Same mechanism, repeated identically: fresh lists (the models are stateless,
// no extra instruction), published in candidates<n>.json, draw seeded by THEIR
// hash. No human choice enters here — the mechanism again, until N is reached.
const TOPUP = cfg.generation.topup_per_model;
const extraSeals = {};
for (let round = 2; topics.length < N && round <= 6; round++) {
  console.log(`\n  ${topics.length}/${N} — top-up round ${round}: ${TOPUP} more candidates per model…`);
  const p2 = join(runDir, `candidates${round}.json`);
  let extra;
  if (existsSync(p2)) {
    extra = JSON.parse(readFileSync(p2, 'utf8')).candidates;
    console.log('  resume: existing file reused');
  } else {
    extra = {};
    await pool(panel, panel.length, async (model) => {
      const { topics: t2 } = await askJson(model, PROMPT.replace('{{K}}', String(TOPUP)), { temperature: 1 });
      extra[model] = (t2 || []).filter((t) => t && typeof t.topic === 'string' && t.topic.trim())
        .slice(0, TOPUP)
        .map((t) => ({ topic: t.topic.trim(), why_recent: String(t.why_recent || '') }));
      console.log(`  ${model.padEnd(32)} ${extra[model].length} candidates`);
    });
    writeCanonical(p2, { protocol: cfg.version, panel, candidates: extra });
  }
  const h2 = hashFile(p2);
  extraSeals[`candidates${round}.json`] = h2;
  s = parseInt(h2.slice(0, 8), 16);
  for (const d of decks) d.deck.push(...shuffle(extra[d.model] || []));
  await refill();
  await dedupCycle(round);
}
topics.forEach((t, i) => { t.id = i; });
if (topics.length < N) console.log(`\n  ⚠ ${topics.length}/${N} — exhausted even after top-up rounds`);

const gatePath = join(runDir, 'gate.json');
const gateHash = writeCanonical(gatePath, { news_gate: GATE, dedup_check: DEDUP, log: gateLog });
const path = join(runDir, 'topics.json');
const hash = writeCanonical(path, { protocol: cfg.version, panel, seed: candHash, topics });
seal(runDir, {
  stage: 'topics',
  tool: '1-topics.mjs',
  writes: { 'candidates.json': candHash, ...extraSeals, 'gate.json': gateHash, 'topics.json': hash },
  meta: { protocol_sha: hashFile(join(ROOT, 'protocol/config.json')), count: topics.length, seed: candHash },
});
console.log(`\n✅ ${topics.length} topics → ${path}\n   sealed ${hash.slice(0, 16)}…`);
console.log(`\n   COMMIT AND PUSH NOW. The GitHub timestamp of this file is what`);
console.log(`   proves it predates the results.\n`);
