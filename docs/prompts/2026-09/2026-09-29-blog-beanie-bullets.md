---
date: 2026-09-29
category: content
issue: ''
plan: ''
tags: [blog, beanstalk, summary, beanie-bullets, mockup, web]
---

# Blog: "3 beanie bullets" summary box

## Prompts

- **2026-09-29** "/beanies-blog There is a bit of a contradiction with our blog strategy, which is that we are targetting families and parents who are extremely busy, offering to help reduce some of the mental load in their lives, but at the same times innundating them with 1000-1500 word blogs every week ... my thiking is that we prepare a bullet point summary for every blog post, both going forward, as well as retroactively ... include a summary section at the top of every blog ... 3 bullet points. Always 3 ... "3 beanie bullets" ... (1) what we built, (2) how it will help you, and (3) where to find it ... visually separated ... Invoke /frontend-design ... "We know our beanies are busy, so here are the key points from this post:" ... wouldn't apply for my stories (like aloe vera, etc) ... how do you think we coudl make it work for new and existing blogs?"
- **2026-09-29** "can you crarte the mockup as a claude artifact" -> https://claude.ai/artifact/9i78Lc4gzfLWRkX5A3Nd5V
- **2026-09-29** "'3 beanie bullets' -> 'the long and short of it'; top sentence: 'we know our families are busy, so here's the beanie breakdown'; each bullet should be the beanie face favicon emoji ...; keep the small role labels - italics or the small caps ... what is your recommendation" -> applied; bullets use `beanies_small_bean_favicon`; role labels switched to the site's small-caps label style (recommended).

- **2026-09-29** "This looks perfect, please proceed to build with /beanies-build-auto and update the beanies-blog skill as proposed above ... the summary bullets should be presented to me and i'll approve before the blog is pushed to the repo from notion. once the summary points are approved, ensure that notion is also retrofitted ... propose summary bullets for the existing blogs as appropriate."

## Outcome

- Mockup: `docs/mockups/blog-beanie-bullets-2026-09-29.html` (real copy from issue 24, the beanie wall; desktop orange tint + phone sky tint).
- Proposal: frontmatter `longAndShort` (3-tuple, build-enforced), rendered by the post layout between header and "the post" divider; opt-in per post; Notion `Long and Short` property as the golden source. Awaiting greg's decision.
- Built via `/beanies-build-auto`: plan `docs/plans/2026-09-29-blog-long-and-short-summary.md` (4-pass); `LongAndShort.astro`, strict schema, llms-full, beanies-blog skill section; Notion `L&S:` properties added; retrofit batch pending greg's approval (recorded in the plan).
