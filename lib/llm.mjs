// A single exit point to the LLMs: OpenRouter. One access provider for five
// vendors, so none of them gets an edge from a first-party SDK, a different
// default setting, or a different version.
import { readFileSync } from 'node:fs';

export function loadEnv(dir = process.cwd()) {
  for (const f of ['.env', '.env.local']) {
    try {
      for (const line of readFileSync(`${dir}/${f}`, 'utf8').split('\n')) {
        const eq = line.indexOf('=');
        if (eq < 1 || line.startsWith('#')) continue;
        const k = line.slice(0, eq).trim();
        if (!process.env[k]) process.env[k] = line.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1');
      }
    } catch { /* no .env file: variables come from the environment */ }
  }
}

export function need(name) {
  const v = process.env[name];
  if (!v) { console.error(`\n  Missing variable: ${name}\n  See .env.example\n`); process.exit(2); }
  return v;
}

/** One OpenRouter call, retried on transient errors only. */
export async function ask(model, prompt, { temperature = 0.7, json = false, retries = 3, timeoutMs = 180000 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    // The timeout must cover reading the BODY, not just waiting for the
    // response: when an upstream freezes, OpenRouter returns a 200 and then
    // keeps the connection alive with whitespace heartbeats — without a hard
    // cap on the body, `r.json()` waits forever.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature,
          ...(json ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: ac.signal,
      });
      if (r.status === 429 || r.status >= 500) throw new Error(`http ${r.status}`);
      const d = await Promise.race([
        r.json(),
        new Promise((_, rej) => ac.signal.addEventListener('abort',
          () => rej(new Error(`body stalled beyond ${timeoutMs} ms (${model})`)), { once: true })),
      ]);
      const text = d?.choices?.[0]?.message?.content;
      if (!text) throw new Error(`empty response from ${model}`);
      return text;
    } catch (e) {
      if (attempt === retries) throw e;
      await new Promise((s) => setTimeout(s, 2000 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('unreachable');
}

/**
 * Extracts the first complete JSON array/object from a response (markdown
 * fences included). Balanced-depth scan, string-aware: it stops at the first
 * CLOSED object, so it survives trailing text (a model adding a sentence) and
 * two objects glued together — the case that used to lose questions silently.
 */
export function parseJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  try { return JSON.parse(body); } catch { /* scan for the first complete object */ }
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error(`no JSON in: ${text.slice(0, 120)}`);
  const open = body[start];
  const close = open === '[' ? ']' : '}';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return JSON.parse(body.slice(start, i + 1));
  }
  throw new Error(`unclosed JSON in: ${text.slice(0, 120)}`);
}

/**
 * Call + JSON parse, retried TOGETHER. `ask` already retries the network, but a
 * malformed JSON used to be dropped silently by the caller (a lost question or
 * verdict). Here, a failed parse re-triggers the call — this is what makes the
 * "1000" real. OpenRouter's strict JSON mode is enabled (validated without
 * breakage across all 5 panel vendors); the parser remains the safety net if a
 * provider ignores it.
 */
export async function askJson(model, prompt, { temperature = 0.7, retries = 3 } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try { return parseJson(await ask(model, prompt, { temperature, json: true, retries: 2 })); }
    catch (e) { last = e; await new Promise((s) => setTimeout(s, 1500 * (attempt + 1))); }
  }
  throw last;
}

/** Concurrency limiter — runs are large, providers have quotas. */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  }));
  return out;
}
