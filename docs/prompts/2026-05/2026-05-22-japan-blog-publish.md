---
date: 2026-05-22
category: design
issue: 'None — content publish'
tags: [blog, beanstalk, japan, founder-story, content, notion-sync, image]
---

# blog #6 "my 10-year-old outclassed me" — review + publish from Notion

Final editorial pass on the Japan founder story, title/sub iteration, then mirror
from Notion into `content/blog/` and push to main.

## Prompt 1 — 2026-05-22

> it is time to release a new blog today - i will publish blog #6 from notion (the japan trip with my son) - can you review this and do a final pass to confirm it's ready for publication? note that anything below the last sentence (stay cool my beans - greg) and below the horizontal line should be ignored

## Prompt 2 — 2026-05-22

> thanks for the review. what are some punchier titles/subs you might recommend? i was trying to think for a while but couldn't come up with anything i thought was that good

## Prompt 3 — 2026-05-22

> how about "my son outclassed me" sub: "lessons learned from our dream vacation together"

## Prompt 4 — 2026-05-22

> ok done, i've updated the title and sub and other small bits, can you push it to the repo pls from notion

## Outcome

- Reviewed the Notion draft (blocks above the divider only). Flagged: en-dash vs hyphen,
  a split-italic `Sumimasen`, a stray straight apostrophe, `youtube` → `YouTube`, the
  standalone `—` scene divider, the missing CTA link, and the cover/photo handling.
  Verified the Mt. Fuji seat sides (right southbound, left northbound) are both correct.
- Title landed on **"my 10-year-old outclassed me"** / sub **"what I learned from our
  dream vacation together"** after a round of options.
- Mirrored to `content/blog/2026-05-22-my-10-year-old-outclassed-me.md`:
  - curly quotes → straight (matches existing post sources; smartypants re-curls at build)
  - fixed the split-italic romaji line; moved stray spaces out of the CTA emphasis spans
  - preserved greg's `—` divider verbatim
  - downloaded the Notion photo, resized + converted to
    `web/public/blog/greg-neil-fushimi-inari-kyoto.webp` (1200px, q80, ~261 KB)
  - frontmatter: `category: founder story`, `coverEmoji: 🚄`, `draft: false`
- `deploy-web` is `workflow_dispatch`-only, so pushing to main does not auto-publish;
  the post goes live on the next manual "Deploy web" run.
