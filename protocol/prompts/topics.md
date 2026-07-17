# Prompt — candidate topics (stage 1)

Sent ONCE to each panel model, none of them seeing the others. `{{K}}` is the
number of candidates requested (`candidates_per_model` in
`protocol/config.json`). The harness then draws at random from each list —
seed = SHA-256 of `candidates.json`, so chosen by nobody.

No line of this prompt asks for a style, a tone, or a domain that would suit
us. Every constraint is justified as a **definition of the product under
test**: a search API whose customer is an LLM agent. Topic diversity comes
from no instruction — it comes from the mechanism (a wide list, a random
draw).

---

```
You are writing a list of TOPICS to test a web search API whose customer is an
LLM agent.

An agent calls a search API for what it CANNOT know: what happened after its
training, what changes, what is time-stamped. So give {{K}} entities — people,
organizations, works, places, products, events — each of which has seen recent,
verifiable developments.

Do not self-censor on fame: a niche entity is a perfectly legitimate test case,
just as much as a heavily covered one.

Reply in strict JSON:
{"topics": [
  {"topic": "<the entity, as one would name it in a search>",
   "why_recent": "<one sentence: which recent development makes it testable>"},
  …
]}
```
