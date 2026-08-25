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

---

## Session 2 — YouTube actually works, and a second review (2026-08-25)

**Prompts, in order:**

- _"plan created pls validate"_ (×4, across successive terraform plans) — the standing rule from earlier in the project: read every resource in the plan, not just the intended target. One plan turned out to be stale and greg re-ran it; a four-way hash check (plan-before vs deployed, plan-after vs the zip on disk) is what settled it rather than the file's timestamp.
- _"applied, pls test the youtube link now"_ (×2).
- _"i've tested again and see these issues"_ — the photo indicator still invisible, and the link affordance dead in the meal planner.
- _"when adding two or more photos to a recipe, how are the additional photos viewed?"_
- _"should we perform a final code review on this or are we ready to commit and push?"_ → _"yes run /code-review max on the full range"_ → _"work straight through all of them"_.

## Outcome — session 2

**The captions feature never worked.** Measured from a residential IP, on a watch page reporting `playabilityStatus: OK`, across two videos and three caption formats: every `timedtext` fetch returns HTTP 200 with zero bytes. YouTube gates it behind a proof-of-origin token. The original test asserted a caption track was _listed_, never that fetching it returned anything — so it shipped broken and was documented as working in both the help centre and the changelog. Withdrawn, not fixed.

**The replacement is better than captions would have been.** Description → the recipe link cooks put there → schema.org JSON-LD on their own site → exact quantities with the model never invoked. Verified end to end: a YouTube URL yields 10 exact ingredients including `¾ cup packed light brown sugar ((165g))`.

**Two IP blocks, not one.** The watch page is blocked from AWS; so is InnerTube. The second was flagged as an unverified assumption before deploying, and deploying is what disproved it. The official Data API (`videos.list`, 1 unit of a free 10,000/day) is the production path, and `TF_VAR_youtube_api_key` is now a required production secret.

**The `/code-review max` on the full range found 15 issues.** Most were introduced in this session, and the pattern is worth recording:

- **Fixing one bug by introducing a worse one.** Making blank fields deletable (`undefined`) meant every save deleted every blank field, clobbering another device's concurrent edit — in a CRDT where that edit was otherwise safe. `diffPayload` already existed for exactly this and was written after `2026-08-15-recurring-occurrence-edit-data-loss.md`.
- **Claiming something worked without rendering it.** The photo spinner was reported as working on both the card and the recipe page. `PolaroidImage`'s caption lived only inside the branch the spinner replaced, and `:loading` never reached the detail page at all. It worked on neither.
- **Moving orchestration without moving what guards it.** When `RecipeFormModal` took ownership of its own capture it inherited five mount points and left the ADR-030 consent gate behind, so a document could reach the model with the modal never shown.
- **A tidy-up that widened a security control's blast radius.** `toLowerCase()` is not length-preserving (U+0130 → two UTF-16 units), so four linear scanners silently desynced; and `isSameRegistrableDomain`'s two-label rule made every `.co.uk` host match every other, while a separate change made it the _sole_ control on a server-side fetch.

Green suites hid every one of these, again. The tests added in response deliberately assert the behaviour (a Turkish title still yields its recipe; an untouched field is _absent_ from the update payload; a loading frame renders its caption) rather than the implementation.
