# AgentSearchBench

**A search API for agents does not sell links. It sells, to an LLM that pays
per token, the material to answer correctly.** This benchmark measures exactly
that, and nothing else: at a given token budget, which API lets an LLM answer
correctly.

1000 questions. 100 topics. **Written by five AIs from five different vendors,
not by us.** Judged blind by a single judge — and you can re-judge with yours.
Everything is published: the questions, the raw responses of both APIs, every
verdict with its reasoning, and the code.

---

## The problem with this kind of page

This benchmark is published by SERPdive, and SERPdive wins it. You should be
suspicious. The correct reflex is: *"they wrote the questions, picked the
judge, and threw away the runs that hurt them."*

No argument answers that. Only a structure does.

## The chain of custody

Five stages. Each produces a frozen, hashed artifact. Each **refuses to run**
if its input no longer matches what the previous stage sealed.

```
1-topics     5 third-party LLMs  →  candidates.json   5 free-form lists, no instruction
                                    topics.json       100 topics drawn at random (seed = hash of the candidates)
2-questions  5 third-party LLMs  →  questions.json    1000 questions
3-collect    both APIs           →  payloads/         VERBATIM responses
4-judge      blind judge         →  verdicts/         A or B, never knowing which is which
5-score      arithmetic          →  results.json
```

Then, on **your** machine, offline, without any key, in one second:

```bash
node bin/verify.mjs runs/2026-07-20
```

`verify` recomputes every hash and **recomputes the score from the verdicts**,
without trusting `results.json`. If we had rounded a single number our way,
this command would call it out.

## The two things that make this hard to fake

**The git history is the proof of precedence.** One stage = one pushed commit.
The questions are timestamped by GitHub **before** a single payload exists. We
cannot retro-fit the questions after seeing the results without rewriting the
history — and that shows.

**The judging is replayable without us.** The raw payloads are in the repo.
Take your own key, your own model, and rerun `bin/4-judge.mjs`. If our judge
favored us, you would prove it within the hour.

## What this benchmark does not prove

**That the payloads are authentic.** No hash can prove that — a dishonest
vendor could fabricate its competitor's response. The countermeasure is not
mathematical, it is within your reach: a Tavily key costs a few dollars.
**Replay the collection.**

## "You picked the only adversary you can beat"

The duel pits **Mako** against **Tavily Basic**: same promise, same price, same
buyer. Tavily *advanced* costs twice as much, takes four seconds and returns
more tokens — different product, different customer. Exa and Perplexity play in
another category. Brave and Serper sell raw SERP.

And a pairwise A/B duel does not scale to N arms without becoming a different
benchmark.

So our answer is not to add arms, it is to hand you the harness:
**`lib/arms.mjs` takes one more competitor in ten lines**, and the 1000
questions are right there. Add yours.

## Replaying

```bash
npm install
cp .env.example .env        # your keys — none of ours are in this repo

node bin/1-topics.mjs    runs/$(date +%F)     # ~$2
node bin/2-questions.mjs runs/$(date +%F)     # ~$12
node bin/3-collect.mjs   runs/$(date +%F)     # ~1000 Tavily credits
node bin/4-judge.mjs     runs/$(date +%F)     # ~$26
node bin/5-score.mjs     runs/$(date +%F)     # free
node bin/verify.mjs      runs/$(date +%F)     # free, offline
```

The web moves. **A run is dated**, and replaying the collection tomorrow will
return different pages. That is by design: this is a living leaderboard, not a
number carved in stone. A live-search benchmark claiming byte-for-byte
reproducibility would be lying about what it measures.

## The protocol

[`PROTOCOL.md`](./PROTOCOL.md) — preregistered, hashed, pushed **before** the
first question. It states what we measure, with which arms, which prompts,
which judge, and **what we forbid ourselves**. Its SHA-256 is recorded in every
run's manifest: had we changed it mid-run, the manifest would point at the old
one.
