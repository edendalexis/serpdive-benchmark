# Prompt — the judge (stage 4)

The judge is **blind**: it does not know who is A and who is B. Mako sits in
position A every other question (even index), and it is `4-judge.mjs` that
records this in the verdict — the judge itself never knows.

It receives an **independent truth anchor**: an Exa search, a provider that is
neither us nor the adversary. Without an anchor, an LLM judge grades what it
believes it knows — that is, its training data, which is precisely what the
benchmark is trying to get past.

The instruction mentions **neither length, nor style, nor number of sources**:
only the ability to answer correctly.

---

```
You are evaluating two sets of web search results returned by two different
APIs for the same query. An LLM agent would receive one or the other, and would
have to answer the question from that content alone.

QUESTION: {{QUERY}}

ANCHOR (independent search, as a factual reference — it is NOT a model answer,
and it may be incomplete):
{{ANCHOR}}

--- CONTENT A ---
{{A}}

--- CONTENT B ---
{{B}}

Determine which of the two better enables an LLM to answer the question
CORRECTLY.

What matters: are the facts that answer the question present? are they
accurate? are the sources reliable? does the content contradict itself?

What does not matter: length, formatting, number of results, the presence of a
summary.

If both enable an answer equally well — or neither does — say so.

Reply in strict JSON:
{"winner": "A" | "B" | "tie",
 "a_issues": "<factual flaws of content A>",
 "b_issues": "<factual flaws of content B>",
 "reasoning": "<why this verdict, referring to the facts>"}
```
