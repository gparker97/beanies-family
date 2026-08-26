---
date: 2026-08-26
category: feature
issue: 'Notion #64 (share to beanies) — links phase'
plan: 'docs/plans/2026-08-26-share-target-links.md'
tags: [share-target, links, youtube, recipe-capture, ai-extract, android, ios, code-review]
---

# Sharing a LINK to beanies (#64 links)

The first #64 phase took files. This one takes URLs — the thing people actually share from
YouTube, which was also the reason beanies did not appear in YouTube's share sheet at all.

## Prompts

**The ask** — _"no need to file just go ahead to prepare the plan for adding link sharing - my
inclination would just be to send the link to the AI endpoint to determine the classification,
unless you feel that is risky or a security problem and you can propose a better alternative"_

**Plan** — _"continue with the remaining passes and save the plan"_ → _"go ahead and implement
the link sharing plan"_ → _"once implementation is done, run a /code-review max to ensure all
implementation works are expected and designed and to the spec of the plan and does not
introduce any new bugs or side effects, and fix any issues found"_

**Deploy order** — _"deploy the lambda then let me know the review findings"_ (the client asks
for `task: 'share'` with text, which a pre-deploy Lambda rejects — Lambda always goes first).

**Question about unsupported types** — _"what if somebody shares something that is completely
outside of the 3 supported types... is it through a pre-AI check or will an image bytes or link
text be sent to AI and only then will AI reply that it's not a supported type?"_

**Device testing** — _"i've tested again and looking much better. i noticed that full youtube
videos work well, but youtube shorts rarely work"_ (with worked/failed example URLs), plus the
photo-viewer close button not responding.

**The pushback that mattered** — _"before we build anything I'd like to dig a little bit deeper
into *why* exactly captions and transcripts cannot be pulled... can we do a more comprehensive
investigation into why it seems we can't get transcripts or captions?"_

**The fallback** — _"ok let's build the title-plus-link fallback then i think we're ready to
deploy"_

## What the captions investigation actually found

Worth recording, because the answer is counter-intuitive and will otherwise be re-litigated:

- **Shorts that fail have literally 0-character descriptions.** Measured, not assumed. The
  watch page's own `shortDescription` is empty too, and pinned comments are viewer chatter.
- **Every caption route is gated by YouTube's proof-of-origin (`pot`) token,** which answers
  without one by returning **HTTP 200 with an empty body** — which is why this looked like a
  bug rather than a wall. Verified across the Data API (`captions.list` works with an API key;
  `captions.download` needs OAuth _and_ video ownership), the public `timedtext` endpoint, the
  signed URL the watch page itself hands out, and InnerTube (`Precondition check failed`) —
  with manual as well as auto tracks, from a residential IP as well as from AWS.

So the title and the link genuinely are all there is. Which is what the fallback ships.

## Outcome

- **Title-plus-link fallback.** A video with no readable recipe now becomes a recipe named
  after the video, carrying the video as its source link, with ingredients and steps left
  empty and a toast saying why. It never reconstructs a recipe from a title — rung 5 (no title
  either) still refuses outright.
- **Device findings fixed:** the photo race on quick open (`lh3` URLs 404 during Drive publish
  → retry with backoff), delete landing on "recipe not found" (the `@deleted` emit could never
  fire from inside `v-if="recipe"` — replaced with a watch redirect), and the photo viewer's
  close button sitting under the system clock (safe-area inset + Escape).
- **`/code-review max` findings all resolved**, including serializing the consent gate so two
  documents cannot share one answer.
