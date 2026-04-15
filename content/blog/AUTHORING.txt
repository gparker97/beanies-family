# Blog source directory — the beanstalk

Personal, dated blog posts published to `/blog/<slug>` on the Astro marketing site. This is the beanstalk — greg's weekly personal writing that also syndicates to Substack.

**Keep this directory blog-only.** Evergreen pillar/reference content goes in `content/guides/` (separate content collection, separate URL prefix, excluded from RSS).

## Frontmatter spec (enforced by Zod in `web/src/content.config.ts`)

```yaml
---
title: 'post title — any case, matches your voice'
slug: url-safe-slug
date: 2026-04-16
category: updates                # freeform string, appears as a badge
coverEmoji: 🫘                    # optional — large emoji at top of post
coverImage: /blog/something.jpg  # optional — alternative to emoji
excerpt: 'one-to-two-sentence hook for the blog index + meta description.'
featured: false                  # true = shown at top of /blog in the big gradient card
author: greg                     # defaults to 'greg' if omitted
draft: true                      # hide from prod; visible locally (remove / set false to ship)
---
```

## Draft workflow

Same as guides — `draft: true` in frontmatter makes the post:

- Visible at `http://localhost:4321/blog/<slug>` during `npm run dev:web`
- **Hidden** from the prod `/blog` list, RSS feed, sitemap, and URL (404)

No real users ever see drafts. Drafts support all the normal post features — images, OG generation, etc. — they just don't ship until published.

**Publishing checklist:**

1. Remove any `<!-- TODO -->` or authoring placeholders from the body
2. Check images (`/blog/*.jpg`) are copied to `web/public/blog/` — Astro serves from `web/public/`, not the repo-root `public/`. Missing images render as broken placeholders.
3. Verify `date` is correct (determines sort order + URL display)
4. Flip `draft: false` (or remove the line entirely)
5. Commit + push — the deploy-web workflow picks it up

## Image paths

Blog markdown references images via absolute URLs like `![alt](/blog/screenshot.jpg)`. Those paths resolve to `web/public/blog/<file>`. If an image exists in the repo-root `public/blog/` but not in `web/public/blog/`, it'll render broken on the Astro site — copy it over.

## Connecting a post to a pillar

If the post is a spoke for an existing guide (or one you're drafting), add the post's slug to that guide's `relatedPosts:` list in `content/guides/<pillar>.md`. The guide auto-renders a "further reading" section with the linked posts. Inside the blog post body, link back to the guide with a normal markdown link for the hub-and-spoke SEO loop.

## See also

- `CLAUDE.md` → "Marketing Site Structure & Content Workflow" for the full blog-vs-guides rationale + draft workflow
- `content/guides/AUTHORING.txt` → guides-specific conventions (short-answer blocks, H2 patterns)
