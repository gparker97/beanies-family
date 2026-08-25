---
date: 2026-08-25
category: feature
issue: '#72 (Notion tracker)'
plan: docs/plans/2026-08-25-recipe-capture-from-any-source.md
tags: [ai, cookbook, security, ssrf, terraform, code-review]
---

# Recipe capture from any source (#72)

## Prompts

**Pre-plan (`/beanies-pre-plan #72 for recipe share once pre plan is done move straight to /beanies-plan`)** — intake from the Notion tracker row, then straight into planning.

Four clarifications resolved during intake:

1. **Scope** — "#72 as written — capture from any source" (share-to targets stay with #64).
2. **YouTube fallback** — greg rejected a flat refusal and supplied a research ladder: auto-captions are usually present; audio transcription via Whisper; Gemini can watch the video and read on-screen frames; check the pinned comment and the channel's own blog; prompt for structured output and mark inferred values; ingredients/procedures are not copyrightable but narration is.
3. **Provider boundary** — chose captions-only, no new provider: _"given the fact that youtube should, in theory, create captions for every video automatically, and also ensure to capture the full descriptions, pinned first comment from the author, follow key links for recipes, and any other text or info we can capture about the video so the LLM has the highest possible chance of generating useful info"_.
4. **Blog-first** — "Yes — check the description for a recipe URL first". **Dish photo** — "Fetch and store". **Phasing** — "All three phases in one plan".

**Security widening** — _"ensure that these security improvements don't apply just to the recipe, but to all AI magic beans features. If we need to do that in a separate path, that's fine."_

**Implementation** — _"go ahead to implement a and b and let me know what to run and apply"_, then _"continue to implement all fixes and test once complete... and also try to adjust the call to the recipe sites so that it works even from an aws server"_.

## Outcome

Shipped in phases: a cross-cutting security commit (A2), a behaviour-preserving provider refactor (A), phase 1 (documents), then phases 2+3 (web links and YouTube) with a new `content-fetch` Lambda.

Three things worth remembering:

- **The pre-plan premise held up, but two claims in it did not.** The plan asserted a same-domain check on the model-supplied image URL was implemented; it was not, and only a code review caught the gap between the documentation and the code.
- **Green tests twice hid a dead feature.** 57 unit tests passed against a `guardedFetch` that failed every real request (the DNS-pin hook returned the wrong shape for Node 20's Happy Eyeballs). Only probing the deployed endpoint found it. Real-socket tests were added afterwards.
- **Large recipe sites block datacenter IPs.** Fixed by sending a normal browser header set, documented openly in `guardedFetch`. Sites that block by IP range rather than user-agent still refuse us, and that is surfaced honestly as `site_refused`.
