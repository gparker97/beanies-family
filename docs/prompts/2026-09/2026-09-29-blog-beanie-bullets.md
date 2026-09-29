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

## Outcome

- Mockup: `docs/mockups/blog-beanie-bullets-2026-09-29.html` (real copy from issue 24, the beanie wall; desktop orange tint + phone sky tint).
- Proposal: frontmatter `beanieBullets` (3-tuple, build-enforced), rendered by the post layout between header and "the post" divider; opt-in per post; Notion `Beanie Bullets` property as the golden source. Awaiting greg's decision.
