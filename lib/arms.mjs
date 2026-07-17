// THE ARMS.
//
// An arm = a function that takes a question and returns the RAW HTTP response
// of the API, as is. `raw` is the exact string received on the wire: it is what
// goes to the judge, and it is what tokens are counted on.
//
// If you think we picked our own adversary, add yours here. It is ten lines,
// the 1000 questions are published, and `bin/3-collect.mjs` takes
// `--arms=mako,tavily,yours`. We have nothing to hide and it is verifiable.

/** The judge-facing body: verbatim, minus the vendor's own SYNTHESIS. */
const stripSynthesis = (obj, fields) => {
  const o = { ...obj };
  for (const f of fields) delete o[f];
  return o;
};

export const ARMS = {
  // SERPdive / Mako — default config, no parameters.
  mako: {
    vendor: 'SERPdive',
    envKey: 'SERPDIVE_API_KEY',
    // `verdict` is our synthesis: out of scope, like Tavily's `answer`.
    // `extra_info` STAYS — it is Google's answer box, i.e. web content, not a
    // summary of our making, and it is a default output of the API.
    synthesisFields: ['verdict'],
    // Server time self-reported by the vendor INSIDE its payload: each side
    // measures itself, we never clock the adversary. Excludes the network.
    serverMs: (json) => (typeof json.response_time_ms === 'number' ? Math.round(json.response_time_ms) : null),
    async call(query, key) {
      const t0 = Date.now();
      const r = await fetch('https://api.serpdive.com/v1/search', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ query, model: 'mako' }),
        signal: AbortSignal.timeout(60000),
      });
      const raw = await r.text();
      return { status: r.status, raw, latency_ms: Date.now() - t0 };
    },
  },

  // Tavily — search_depth basic, the documented default config.
  // `answer` is null by default and we do NOT enable it: that would compare
  // their summarizer to our extraction. `score` is KEPT — their docs present it
  // as a ranking aid for the LLM, it is part of what they deliver.
  tavily: {
    vendor: 'Tavily',
    envKey: 'TAVILY_API_KEY',
    synthesisFields: ['answer'],
    // Tavily reports `response_time` in seconds; converted to ms, same unit everywhere.
    serverMs: (json) => (typeof json.response_time === 'number' ? Math.round(json.response_time * 1000) : null),
    async call(query, key) {
      const t0 = Date.now();
      const r = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ query, search_depth: 'basic' }),
        signal: AbortSignal.timeout(60000),
      });
      const raw = await r.text();
      return { status: r.status, raw, latency_ms: Date.now() - t0 };
    },
  },
};

/**
 * What the judge reads. The VERBATIM payload, minus only the vendor's own
 * synthesis — the same rule applied to both sides, and it is written into the
 * protocol.
 */
export function forJudge(armName, raw) {
  const arm = ARMS[armName];
  try {
    return JSON.stringify(stripSynthesis(JSON.parse(raw), arm.synthesisFields), null, 2);
  } catch {
    return raw; // unreadable: passed as is rather than "repaired"
  }
}

/**
 * Tokens are counted on the ENTIRE JSON returned by the API — that is what the
 * agent pastes into its prompt, hence what it pays for. Counting only the
 * `content` field matches no actual invoice, and would artificially inflate
 * our edge: our envelopes are smaller than theirs.
 */
export const tokensOf = (raw) => Math.round(raw.length / 4);
