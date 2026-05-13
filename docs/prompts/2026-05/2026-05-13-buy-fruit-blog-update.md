---
date: 2026-05-13
category: design
issue: 'None — content sync'
tags: [blog, beanstalk, buy-fruit, someday-maybe, content, image]
---

# "buy fruit" blog post — sync updated copy from Notion + add someday/maybe image

## Prompt 1 — 2026-05-13

> I've made several edits and updates to the "buy fruit" blog entry - can you please take the updated version from notion (item #5) and update the beanstalk. there is also one new image, which is at /tmp/someday-maybe.png, please compress/convert as needed before upload

## Outcome

- Pulled the updated body from Notion content DB item #5 ("buy fruit", page `33a247d9a99f8067881ff5f08248ad3a`) and rewrote `content/blog/2026-04-17-buy-fruit.md`. Main changes vs the published version: "todo" → "to-do" throughout; new `someday/maybes` thread woven in (intro line, a David Allen / _Getting Things Done_ paragraph with two outbound links, the "flip a to-do to someday/maybe" how-to + new screenshot, and the closing paragraphs now mention someday/maybes); "daily briefing box" → "daily briefing"; minor wording polish ("my little friend" → "my little friends", "big" → "big (and colorful)", etc.). Frontmatter unchanged except `excerpt` "todo" → "to-do".
- Converted `/tmp/someday-maybe.png` (462×511 PNG, 33 KB) → `web/public/blog/beanies-someday-maybe-task.webp` (462×511 WebP w/ alpha, ~12 KB) via the project's `sharp` (quality 82, effort 6). Referenced inline after the "flip it to someday/maybe" paragraph.
- Note: the Notion page has a stray duplicate of that screenshot (an older Title-Case variant) sitting _below_ the "greg" sign-off — treated as a leftover and not included, per "one new image".
- `npx prettier --check` passes on the markdown.
