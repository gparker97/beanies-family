---
date: 2026-08-27
category: content
issue: Notion Blog Posts #48
plan: n/a
tags: [blog, beanstalk, app-launch, utm, analytics]
---

# Blog #48 — "THE APPS ARE HERE"

## Prompts

**2026-08-27** — "i've drafted the next blog which is (obviously) about the app
release, wrote it very quickly this morning, please do a full review and let me
know your thoughts or anything i could tighten or add - notion #48 due"

**2026-08-27** — "i've made a lot of fixes and edits, pls review again"

**2026-08-27** — "have made some fixes and edits, can you review and also please
build UTM enabled links for all the links in the blog and make the updates
directly in notion"

**2026-08-27** — "regarding the prize claim path, i will work on this directly
with users through discord and offline channels"

**2026-08-27** — "are you sure the utm tags are correct? [...] why are you tagging
the campaign as apps-to-a-real-boy? That's a different post. For this post, the
campaign should be something like the-apps-are-here shouldn't it?"

**2026-08-27** — "i've already changed the title and the utms look ok now. have
made some final edits. can we push now?"

## Outcome

Three review passes against the Notion golden source. Findings were reported, not
applied — greg made every prose edit himself.

Link work applied directly to Notion on request: 15 links tagged
`utm_source=blog&utm_medium=post&utm_campaign=the-apps-are-here&utm_content=<label>`,
with a distinct `utm_content` per link so the five `/download` CTAs are separable
in Plausible. All `http://beanies.family` links corrected to `https`.

**Campaign-naming correction.** The first pass used `apps-to-a-real-boy`, carried
over from the draft. greg caught it: the campaign names the post the link lives
_in_, not the destination. Verified against all ten previously-tagged posts — the
convention holds without exception (sometimes as a topic shorthand, e.g.
`have-your-cake-and-eat-it-too` → `privacy-explainer`). Corrected to
`the-apps-are-here`, which the post slug now matches 1:1.

Post generated to `content/blog/2026-08-28-the-apps-are-here.md`. Store badges
reuse the official `/badges/*.svg` already in the repo rather than converting
Notion's copies — no rasterisation of vector badge art, no expiring-S3 fetch, and
they carry `data-cta` so they feed the CTA goals.

Added to `relatedPosts:` in `content/guides/local-first-family-finance-planning-tools.md`.
The inline link _from_ the post _to_ that pillar is still owed (needs a prose edit).

## Finding: blog CTAs are invisible to the CTA goals (not fixed)

`web/src/lib/assert-cta-tagged.mjs` matches `STORE_HREF = /^\/(?:ios|android|download)$/`
— relative and anchored, so it sees neither an absolute `https://beanies.family/download`
nor a query-tagged one. Every blog `/download` link written absolute therefore passes
the guard silently and feeds no Plausible goal; `grep data-cta content/` returns nothing.
This post's badges are the first tracked CTA in a blog post.

Worth fixing separately: widen the regex to tolerate both forms, then decide how
`data-cta` reaches content-collection prose. Deliberately not folded into this post.
