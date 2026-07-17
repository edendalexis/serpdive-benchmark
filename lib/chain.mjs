// THE CHAIN OF CUSTODY.
//
// A benchmark published by the vendor who wins it is worthless if it rests on
// that vendor's word. This module replaces the word with arithmetic.
//
// Every stage produces an artifact. Every artifact is hashed (SHA-256). Every
// stage declares the hash of what it READ and what it WROTE, and refuses to run
// if its input no longer matches what the previous stage sealed. The MANIFEST
// accumulates these links.
//
// Consequence: `results.json` is a pure function of `verdicts/`, which is a
// pure function of `payloads/`, which is the VERBATIM response of the APIs to
// `questions.json`, themselves written by third-party LLMs from `topics.json`.
// Changing a single byte upstream breaks every hash downstream. `verify.mjs`
// replays this computation on the reader's machine, offline, in one second.
//
// What the chain does NOT prove, and it must be said: that the payloads are
// authentic. No cryptography can prove that — a dishonest vendor could
// fabricate its competitor's response. The countermeasure is not mathematical,
// it is social: the questions are published BEFORE the payloads (GitHub commit
// timestamps attest to it), and anyone with a Tavily key can replay
// `3-collect` and compare.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Hash of a file, as is — byte for byte, no reformatting. */
export const hashFile = (p) => sha256(readFileSync(p));

/**
 * Hash of a DIRECTORY of artifacts: the hash of the sorted list
 * `<name> <hash>`. Stable regardless of filesystem order, and sensitive to the
 * addition, removal or modification of any single file — hence to the silent
 * deletion of a question that happened to hurt us.
 */
export function hashDir(dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const lines = files.map((f) => `${f} ${hashFile(join(dir, f))}`);
  return { hash: sha256(lines.join('\n')), count: files.length };
}

/**
 * Writes a JSON file DETERMINISTICALLY: sorted keys, 2 spaces, trailing
 * newline. Two executions producing the same data produce the same bytes,
 * hence the same hash. Without this, mere key-insertion order would break the
 * chain and verification would become noise.
 */
export function writeCanonical(path, data) {
  const sorted = (v) => {
    if (Array.isArray(v)) return v.map(sorted);
    if (v && typeof v === 'object' && v.constructor === Object) {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])]));
    }
    return v;
  };
  writeFileSync(path, `${JSON.stringify(sorted(data), null, 2)}\n`);
  return hashFile(path);
}

const manifestPath = (runDir) => join(runDir, 'MANIFEST.json');

export function loadManifest(runDir) {
  const p = manifestPath(runDir);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : { run: null, links: [] };
}

/**
 * Seals a stage. `reads` are the expected input hashes: if they no longer
 * match what is on disk, we stop — someone touched an already-sealed artifact,
 * and everything downstream would be false.
 */
export function seal(runDir, { stage, tool, reads = {}, writes = {}, meta = {} }) {
  const m = loadManifest(runDir);
  m.run ??= runDir.split('/').filter(Boolean).pop();
  // The protocol hash is recorded at the first stage and never rewritten: if
  // someone modified PROTOCOL/config afterwards, the run's manifest would keep
  // pointing at the version it was actually played under.
  if (meta.protocol_sha) m.protocol_sha ??= meta.protocol_sha;
  for (const [name, expected] of Object.entries(reads)) {
    const link = m.links.find((l) => l.writes && l.writes[name]);
    if (!link) throw new Error(`CHAIN BROKEN — stage "${stage}" reads "${name}", which no stage produced.`);
    if (link.writes[name] !== expected) {
      throw new Error(
        `CHAIN BROKEN — "${name}" has changed since it was sealed.\n`
        + `  sealed by "${link.stage}": ${link.writes[name]}\n`
        + `  on disk               : ${expected}\n`
        + `  An already-published artifact was modified. Replay the chain from "${link.stage}".`
      );
    }
  }
  m.links = m.links.filter((l) => l.stage !== stage);
  m.links.push({ stage, tool, at: new Date().toISOString(), reads, writes, ...meta });
  m.links.sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage));
  writeFileSync(manifestPath(runDir), `${JSON.stringify(m, null, 2)}\n`);
  return m;
}

export const STAGES = ['topics', 'questions', 'collect', 'judge', 'score'];

export function ensureRun(runDir) {
  if (!existsSync(runDir)) mkdirSync(runDir, { recursive: true });
  return runDir;
}
