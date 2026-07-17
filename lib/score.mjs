// The arithmetic. Deliberately dumb, deliberately isolated: this is the only
// stage where we could lie without a hash showing it, so it is the one
// `verify.mjs` recomputes on the reader's machine, without us.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A verdict says "A" or "B" — the judge never knows which is which.
 * `mako_is_a` (set by 4-judge, alternating on the question index) translates
 * it. This is where the judge's blindness becomes a score, and nowhere else.
 */
export function tally(verdictsDir) {
  const files = readdirSync(verdictsDir).filter((f) => f.endsWith('.json')).sort();
  const rows = files.map((f) => JSON.parse(readFileSync(join(verdictsDir, f), 'utf8')));

  const headline = { mako: 0, tavily: 0, tie: 0, error: 0, n: 0 };
  const byTopic = {};

  for (const r of rows) {
    // A question that failed is NOT removed: it is counted as `error` and
    // published. A bench that discards its failures is a rigged bench.
    const w = r.error ? 'error'
      : r.winner === 'tie' ? 'tie'
        : (r.winner === 'A') === r.mako_is_a ? 'mako' : 'tavily';
    headline[w]++;
    headline.n++;
    const t = r.topic || 'unknown';
    byTopic[t] = byTopic[t] || { mako: 0, tavily: 0, tie: 0, error: 0, n: 0 };
    byTopic[t][w]++;
    byTopic[t].n++;
  }

  const judged = headline.mako + headline.tavily + headline.tie;
  const p = judged ? headline.mako / judged : 0;
  // Binomial standard error on the win rate. At n=1000 it is ~1.5 points:
  // this is what makes a second judge over the FULL set useless (the noise is
  // already averaged out) — see PROTOCOL.md, judging section.
  const se = judged ? Math.sqrt((p * (1 - p)) / judged) : 0;

  return {
    headline,
    win_rate: +(p * 100).toFixed(1),
    ci95: [+((p - 1.96 * se) * 100).toFixed(1), +((p + 1.96 * se) * 100).toFixed(1)],
    by_topic: byTopic,
  };
}
