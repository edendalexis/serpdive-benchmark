# A second judge

The run of 2026-07-18 was scored by a single judge, `openai/gpt-5.4`. One judge
is one point of failure, and the obvious objection writes itself: *a single LLM
graded this, and it may be biased.*

`PROTOCOL.md` answers that the guarantee is not a second judge chosen by us, but
public re-judging — the raw payloads are in this repo, and anyone can replay the
grading with their own key and their own model. That answer stands. What
follows is us running that command first, on the model of another vendor:

```bash
node bin/4-judge.mjs      runs/2026-07-18 --model=anthropic/claude-sonnet-5
node bin/compare-judges.mjs runs/2026-07-18
```

Same prompt, same blinding, same payloads, temperature 0. One thing changes:
the judge. The 1000 verdicts are published in
[`runs/2026-07-18/annex/verdicts-anthropic-claude-sonnet-5/`](./runs/2026-07-18/annex/verdicts-anthropic-claude-sonnet-5/),
reasoning included, and `bin/compare-judges.mjs` recomputes every number below
on your machine without a key.

## The result

| judge | mako | tavily | tie | err | win rate | 95% CI |
|---|---|---|---|---|---|---|
| `openai/gpt-5.4` (published) | 475 | 307 | 217 | 1 | 47.5 % | 44.5–50.6 |
| `anthropic/claude-sonnet-5` | 510 | 342 | 147 | 1 | 51.1 % | 48.0–54.2 |

Over **decided** duels — ties excluded, which is the headline figure, because
two judges do not share the same appetite for calling a duel close:

| judge | win rate over decided | 95% CI | |
|---|---|---|---|
| `openai/gpt-5.4` (published) | **60.7 %** | 57.3–64.2 | 475/782 |
| `anthropic/claude-sonnet-5` | **59.9 %** | 56.6–63.2 | 510/852 |

**0.8 points apart, on judges from two different vendors.** The published figure
does not depend on who grades.

Note that the second judge returns a figure slightly *lower* than the published
one. We are keeping `openai/gpt-5.4` as the official score anyway: it is the
judge the protocol was preregistered with, and a run does not get re-scored
because a later measurement came out differently.

## How much do the two judges actually agree?

Three numbers, because publishing only the flattering one is precisely what
this benchmark exists to refuse:

| | |
|---|---|
| raw agreement | 661/1000 — **66.1 %** |
| agreement where both judges decided | 588/708 — **83.1 %** |
| outright reversals (one says mako, the other tavily) | 120/1000 — **12.0 %** |

Raw agreement is the low number and it is the honest headline for "do these two
models behave identically" — they do not. But the disagreement is concentrated
on the **tie boundary**, not on who won: the judges differ far more often about
whether a duel is close than about its winner. Full transition matrix:

| gpt-5.4 → sonnet-5 | n |
|---|---|
| mako → mako | 372 |
| tavily → tavily | 216 |
| tie → mako | 77 |
| tie → tie | 73 |
| tie → tavily | 66 |
| tavily → mako | 61 |
| mako → tavily | 59 |
| mako → tie | 44 |
| tavily → tie | 30 |
| error → tavily | 1 |
| tie → error | 1 |

Each judge failed on exactly one question, on two different questions. Failures
are counted as `error` and published, never dropped.

## The two tests that could have sunk this

**Sonnet calls fewer ties (147 vs 217). Does it break them our way?** It decides
143 of the duels gpt-5.4 left tied: **77 to mako, 66 to tavily — 53.8 %**,
z = 0.92 against a 50/50 split. Not significant. The second judge is simply more
decisive; that decisiveness carries no preference for either arm.

**Is the disagreement lopsided?** Reversals run **59 one way, 61 the other**.
McNemar χ² = 0.01. As symmetric as it gets — no detectable judge effect.

And per topic, the two judges name the same winner on **74 of 100**.

## What this does not prove

It does not prove the payloads are authentic — nothing here does, and the
countermeasure remains the one in the README: replay `3-collect.mjs` with your
own Tavily key.

It does not prove that no bias is shared by *all* LLM judges. Two models from
two vendors is better evidence than one, and it is not proof. The standing
invitation is unchanged, and it is the only thing that actually settles this:
take our payloads and judge them yourself.

## A note on the sealed artifacts

**Nothing from the original run was modified, and nothing can be.**
`results.json`, `MANIFEST.json` and `verdicts/` are byte-identical to what was
published on 2026-07-18. `node bin/verify.mjs runs/2026-07-18` passes, on our
machine and on yours.

One detail of the layout exists for that reason alone. `5-score.mjs` recomputes
`judge_agreement` from any directory named `verdicts-*`, which would rewrite
`results.json` and re-seal the score stage. A published score must not move
because an annex was added later — not here, and not on your machine when you
replay us. So the second judge's verdicts live under `annex/`, outside that
prefix, and the annex ships its own read-only script instead. Adding a judge
adds files; it never touches a sealed one.
