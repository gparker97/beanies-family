---
name: beanies-blog
description: Review, prepare and publish a beanies.family "beanstalk" blog post that lives in the Notion Blog Posts database. Use this skill whenever greg mentions the blog, the beanstalk, a Friday post, publishing or reviewing a post, a post ID or Notion blog row, blog images, Substack cross-posting, or says anything like "it's blog day", "review my post", "is post 12 ready", "ship the blog", or "time for this week's post" — even if he doesn't name the skill. Also use it when asked to check a draft's tone, grammar, SEO, or images before publication, or to sync a Notion post into the repo.
---

# beanies-blog — review, prepare, publish

The blog ships every Friday. Notion is where greg writes; the repo is where the site
builds from; Substack gets the same words by hand. This skill moves one post through
that pipeline without letting the three copies drift, and without letting a machine
rewrite a human's voice.

Two ideas run through everything below:

**Notion is the golden source.** The markdown file in `content/blog/` is a build
artefact of the Notion row, not a second original. When they disagree, Notion wins and
the file is regenerated. That is what makes "golden source" structurally true instead
of a convention people forget under time pressure.

**Propose, don't rewrite.** This is greg's own writing, published under his name, in
his voice. The review produces a report. Nothing is written to Notion, the repo, or
anywhere else until he has approved the specific changes. Even an obvious typo fix
gets shown before it lands — it costs one line in a report and buys the guarantee that
his prose never quietly drifts toward AI cadence.

---

## Notion binding

The one place holding runtime ids. Nothing else in this skill restates them.

```
Beanstalk Blog (hub page)   33a247d9-a99f-813a-b36d-ff0c93eb3544
  └── Blog Posts (database) 33a247d9-a99f-814d-bdff-c554dcff3a0b
        data_source_id      33a247d9-a99f-815e-a53a-000b24c88de0   ← what API-query-data-source / API-patch-page use

MCP namespace: mcp__notion__*  (verified working on this database)
  If a call returns object_not_found, try mcp__notion-beanies__* — the issue tracker
  needs that namespace, and the two are easy to confuse.

Properties (read the LIVE schema at runtime; select options drift):
  ID            unique_id    ← "find the blog by id" means THIS
  Title         title
  Status        select       Idea · Draft · In Review · Ready · Published
  Publish Date  date
  Category      select       (see the category map below)
  URL           url          the live post URL, filled in after publishing
  Sub           rich_text    the post subtitle → maps to frontmatter `subtitle`
  Substack      checkbox     ticked once cross-posted
  Notes         rich_text

In practice greg uses only Idea → Draft → Published. `Ready` and `In Review` exist in
the schema but no row has ever held them, so don't filter on them expecting results.

Querying: filter to the ONE row you need by its `ID`. An unfiltered list of this
database returns ~56k characters and blows the tool's token limit, and `has_more` is
true — so it paginates too. Never fetch the whole table to find one post.

Write-back happens in two phases, both AFTER greg approves:
  1. Review fixes  → the post's Notion blocks + any property corrections
  2. Post-publish  → Status = Published, Publish Date = today, URL = live URL
```

The post body lives in the row's **page blocks**, not a property. Read it with
`API-get-block-children` (paginate — long posts exceed one page).

---

## What the repo expects

The Zod schema in `web/src/content.config.ts` is the contract, not
`content/blog/AUTHORING.txt` — the doc omits `subtitle` and `updatedDate`, both of
which are real and in use. When they disagree, believe the schema.

| Field         | Required | Source                                          |
| ------------- | -------- | ----------------------------------------------- |
| `title`       | yes      | Notion `Title`                                  |
| `slug`        | yes      | Notion `URL` if set, else derived from title    |
| `date`        | yes      | Notion `Publish Date`                           |
| `category`    | yes      | Notion `Category`, mapped (below)               |
| `excerpt`     | yes      | **not in Notion** — preserve, or propose one    |
| `subtitle`    | no       | Notion `Sub` if set, else preserve existing     |
| `coverEmoji`  | no       | not in Notion — preserve                        |
| `coverImage`  | no       | `/blog/<file>.webp`                             |
| `featured`    | no       | not in Notion — preserve (default `false`)      |
| `author`      | no       | defaults to `greg`                              |
| `updatedDate` | no       | set only when revising an already-published post|
| `draft`       | no       | `false` unless greg says to keep the flag on    |

Some fields still have no home in Notion (`excerpt` chiefly, plus `coverEmoji` and
`featured`). So regeneration is **not** a blind overwrite: read the existing file first,
carry those fields forward, and only propose new values when the file doesn't exist yet.
Losing a hand-tuned `excerpt` — which is also the meta description and the RSS summary —
would be a silent SEO regression. (`subtitle` now maps from the Notion `Sub` property, so
it survives regeneration; older posts written before `Sub` existed may only carry it in
the file — preserve it there.)

File path: `content/blog/YYYY-MM-DD-<slug>.md` (repo root, **not** `web/src/content/`).

### Category map

Three vocabularies exist and none of them match. Notion's `Category` select, the repo's
freeform `category:` string, and the badge lookup in
`web/src/pages/blog/[...slug].astro`. A category outside the badge map renders with **no
badge at all** and throws no error — which is why `founder story`, `feature announcement`
and `memoir` are already live on the site with missing badges. Map on the way in:

| Notion Category      | repo `category:` |
| -------------------- | ---------------- |
| Founder Story        | `stories`        |
| Use Case             | `use-case`       |
| Feature Announcement | `updates`        |
| Update / Changelog   | `updates`        |
| Tutorial             | `how-to`         |
| SEO / Comparison     | `review`         |
| Random               | `philosophy`     |
| Audience Engaging    | `philosophy`     |
| Post                 | ask greg         |
| Substack Note        | not a site post  |

If the post being worked on has a drifted category, offer to fix it. Don't go
mass-editing the other posts uninvited.

---

## Images

Blog images live in `web/public/blog/` and are referenced as `/blog/<name>.webp`. The
repo-root `public/blog/` is **not served** — a file there renders as a broken image.

Notion serves images from **expiring S3 URLs** (roughly an hour). Download them the
moment you read the blocks; a URL captured now and fetched later will 403.

Run the bundled script for every image. It resizes to max 1200px wide, encodes WebP at
q80, strips EXIF, refuses to upscale, and verifies its own output:

```bash
node .claude/skills/beanies-blog/scripts/optimize-blog-image.mjs <file> [--name slug-ish-name]
```

It prints the exact `/blog/...` path to paste into the markdown. Name images after the
post (`aloe-vera-big-island-2002.webp`), not `image1.png`.

Two things bite here. `web/src/lib/rehype-image-dims.mjs` injects `width`/`height` at
build time so there's no layout shift — but if the file is missing it logs to the build
console and ships a broken `<img>`. Nothing fails. So after writing the markdown,
confirm every referenced image actually exists on disk. And the existing
`scripts/convert-images.mjs` only re-encodes at q85; it does not resize, so don't reach
for it here.

---

## The workflow

### 1. Find the post

Take the ID greg gives (`#12`, `post 12`, `id 12`) and filter the data source on the
`ID` property — one row, not the whole table. No ID? Query for `Status = Draft` with a
`Publish Date` on or near the coming Friday, newest first, and ask which. Read the page
blocks, paginating to the end.

Stop and confirm before continuing if:

- `Status` is `Idea` — the post isn't written yet; reviewing it is premature.
- `Status` is `Published` — you'd be re-publishing something live. Usually a mistake,
  occasionally a deliberate revision (in which case set `updatedDate`, not `date`).
- `Category` is `Post` or `Substack Note` — these rows are social/Substack copy, not
  beanstalk posts. `r/ParentingTech post` and `LI new job post` live in this database
  and must never be published to `/blog`.

### 2. Review, and write a report

Read the whole post before commenting on any of it. Then produce a report — no edits
anywhere yet.

Cover, in this order (most valuable first):

- **Does it land?** Is there one clear idea, and does the opening earn the next
  paragraph? A post that is merely correct is not ready.
- **Voice.** Does it sound like greg — direct, warm, self-deprecating, occasionally
  sweary? Flag anything that reads as marketing copy or as AI. Watch for the tells:
  tricolons, "it's not just X, it's Y", hedging, throat-clearing openers.
- **Structure.** Does it need subheadings for scanning? Is the ending a landing or a
  trailing-off?
- **Accuracy.** Every factual claim about the app, its architecture, or its privacy
  posture must be true of the *shipped* code. Check it. A blog post is a public claim.
- **Grammar, spelling, punctuation.** Mechanical, but say what's wrong.
- **House rules.** No em-dashes (greg's rule — use hyphens or restructure). `beanies.family`
  always lowercase. The tagline is *every bean counts*, lowercase, no period, in a
  standalone lockup. Never "Beanies".
- **SEO / GEO.** Is there an `excerpt` that works as a meta description (~155 chars)?
  Does the post link to its pillar guide in `content/guides/`, and is its slug listed in
  that guide's `relatedPosts:`? That two-way link is the hub-and-spoke loop; a post
  missing it is orphaned.
- **Images.** Present? Captioned? Alt text that describes the image rather than repeating
  the caption?

Present findings as a list greg can accept or reject item by item. Separate the two
kinds clearly: **mechanical** (typos, links, casing, em-dashes — safe to accept in bulk)
and **substantive** (anything touching voice, argument, or an anecdote — each needs a
yes). Quote the sentence, show the proposed change, say why. Never present a rewritten
paragraph as a fait accompli.

### 3. Apply approved fixes — Notion first

Nothing lands before approval. Once greg approves, write to **Notion first**, always. A
fix that exists only in the repo is a fix that will be lost the next time the post is
regenerated, and greg will re-read the old sentence in Notion and wonder why.

### 4. Regenerate the repo markdown from Notion

Convert the Notion blocks to markdown. Preserve the frontmatter fields Notion doesn't
model (see the table). Set `draft: false` unless greg explicitly says to keep the flag
on. Optimize and place every image. Then verify:

```bash
npm run dev:web              # Astro on :4321
# open http://localhost:4321/blog/<slug>
```

Drafts render in dev regardless of the flag (`isPublished()` short-circuits on
`import.meta.env.DEV`), so seeing the page prove nothing about the flag. Check the flag
by reading the frontmatter. Also confirm the post appears on `/blog` and that every
image loads.

### 5. Commit and push

Normal commit to `main` (this project commits straight to main). Update `CHANGELOG.md`
only if the post accompanies a product change — a blog post alone isn't a changelog
entry.

**Pushing does not publish.** `deploy-web.yml` is `workflow_dispatch:` only — there is no
`push:` trigger. (`CLAUDE.md` line ~351 says "Commit + push → deploy-web ships it". That
is wrong, and worth fixing when you next touch that file.) A pushed post with
`draft: false` is *staged*, sitting in `main`, invisible to the world until someone
dispatches the workflow.

This is a feature: it means step 5 is safe and reversible, and step 6 is the only
irreversible one.

### 6. Ask before going live

Deploying is outward-facing and hard to take back. Invoking a review skill is not the
same as asking to publish, so **stop here and ask**, even though greg described this step
when the skill was written. Show him what will ship, then wait.

On his yes, deploy — `/deploy-prod-auto` handles it, or dispatch directly:

```bash
gh workflow run deploy-web.yml --ref main    # takes no inputs; -f flags return HTTP 422
```

Then verify the live URL actually serves the post before claiming success. A green
workflow is not a rendered page.

### 7. Substack

Prepare a paste-ready copy in the scratchpad (never the repo — it's a derived artefact):

- Substack's editor mangles some markdown; flatten what it can't take.
- Images must be re-uploaded there by hand; list which ones and where they go.
- Keep the canonical link back to the beanies.family post.

Then **remind greg to publish on Substack**. The skill never posts there — Substack has
no supported write API, and an unofficial one publishing under his name is a bad failure
mode.

### 8. Close the loop in Notion

Only after the post is confirmed live:

- `Status` → `Published`
- `Publish Date` → the date it actually went live
- `URL` → the live post URL
- `Substack` → tick it once greg confirms he's cross-posted (ask; don't assume)

If any patch fails, say which property and value, so it can be set by hand. Never let a
Notion write fail silently — the tracker being wrong is worse than the tracker being
empty.

---

## Things that will bite

- **`beanies.family/beanstalk` does not exist.** The Notion hub page says it does. The
  route is `/blog`. Don't paste the Notion URL into anything user-facing.
- **A missing image never fails the build.** It logs, and ships broken. Verify on disk.
- **Notion image URLs expire.** Download on read, not later.
- **`AUTHORING.txt` is incomplete.** The Zod schema is the contract.
- **A wrong `category` renders no badge, silently.** Use the map.
- **Drafts look identical in dev.** The flag is only observable in the frontmatter and in
  a production build.
- **Guides carry the back-link, not posts.** A post links to its pillar with an ordinary
  markdown link; the pillar lists the post's slug in `relatedPosts:`. Both directions
  need doing, in two different files.

## When something is off

If the post isn't ready — the argument doesn't hold, a claim is unverifiable, the images
are missing — say so plainly and stop. Friday is a cadence, not a deadline worth
publishing something weak for. Greg would rather hear "this needs another pass" than
read it on the internet.
