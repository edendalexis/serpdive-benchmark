# Prompt — writing the questions (stage 2)

Sent to each panel model, 2 questions per topic. `{{BRIEF}}` is the news
summary produced by `perplexity/sonar` (the news gate). `{{TAKEN}}` is the list
of questions already written on this topic by the other panel models.

**The model order rotates from one topic to the next**: without that, the same
model would always be the first to take the salient facts, and the others
would inherit the leftovers.

---

```
You are writing search queries for an LLM AGENT, not for a human.

Recent factual context about "{{TOPIC}}":
{{BRIEF}}

Write {{N}} queries that an LLM agent would send to a web search API because it
CANNOT answer them from its own weights: the fact postdates its training, or it
changes over time, or it is too specific to be memorized.

Constraints (these are properties of the product under test, not style
guidelines):
- A query must have a FACTUAL, VERIFIABLE answer in recent web sources. No
  opinions, no predictions, no "what do you think of".
- Write the way an agent phrases a query: keyword-dense, not a conversational
  sentence. This is what actually goes into the API.
- Do not copy the summary above: the query must SEEK the information, not
  contain it.

Queries already written on this topic (do not produce anything close):
{{TAKEN}}

Reply in strict JSON:
{"queries": ["<query 1>", "<query 2>"]}
```
