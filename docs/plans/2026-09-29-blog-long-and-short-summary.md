# Plan: "the long and short of it" — summary box for beanstalk posts

> Date: 2026-09-29
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-09-29-blog-long-and-short-summary.md`
> Mockup: `docs/mockups/blog-beanie-bullets-2026-09-29.html` (round 2, approved; artifact https://claude.ai/artifact/9i78Lc4gzfLWRkX5A3Nd5V)

> **No GitHub issue created.** This plan was approved for direct implementation.

## User Story

As a busy parent reading a beanstalk feature post, I want a three-point summary at the top (what was built, how it helps me, where to find it) so that I can use the feature without reading 1,000–1,500 words, and read the full story only if I want to.

## Context

The blog targets families with little time, yet ships 1,000–1,500-word posts weekly; understanding a new feature currently means reading the whole post. greg wants a fixed, three-bullet summary box at the top of feature-style posts, going forward and retroactively. Personal stories (aloe vera, Japan trip, vibe-coding) keep no box. The design was iterated in two mockup rounds and approved ("This looks perfect").

Current state:

- Posts are markdown in `content/blog/*.md`, schema in `web/src/content.config.ts` (Zod), rendered by `web/src/pages/blog/[...slug].astro`. Each post gets a per-issue tint (`--tint-hex`, `--tint-ink`, `--tint-wash`) from `TINTS` in `web/src/utils/blog.ts`.
- Notion "Blog Posts" data source (`33a247d9-a99f-815e-a53a-000b24c88de0`) is the golden source; `.claude/skills/beanies-blog/SKILL.md` regenerates the repo markdown from it and preserves non-Notion frontmatter.
- Blog categories are inconsistent (helpful hints / AI / apps posts are `updates`, sharing is `use-case`), so eligibility cannot be derived from category.
- The site favicon `beanies_small_bean_favicon_100x100.webp` is already served at `/brand/` (synced from `packages/brand/assets/shared/` by `scripts/sync-brand-assets.mjs`).
- The plain `mcp__notion__*` namespace can read this data source as of 2026-09-29 (the skill's note claiming only `mcp__notion-beanies__*` works is stale; `-beanies` is not loaded in this environment).

## Requirements

1. New optional frontmatter field `longAndShort` on blog posts: an object with three required string keys `built`, `helps`, `where` (Zod, `.trim().min(1)` each, `.strict()`). Omitted → no box. Present with a missing/blank/misspelled key → web build fails naming it.
2. The post page renders the box between `</header>` and the "the post" divider, only when the field is present.
3. Box content (fixed, not per post): heading "the long and short of it"; intro line "we know our families are busy, so here's the beanie breakdown"; three items with small-caps role labels "what we built", "how it helps you", "where to find it" (rendered uppercase via CSS; source strings lowercase).
4. Each bullet marker is the beanie-face favicon (`/brand/beanies_small_bean_favicon_100x100.webp`), drawn as an `li::before` CSS background at 22px (decorative by definition; no `<img>`, so copied HTML carries no image).
5. Text wrapped in backticks inside any bullet renders as an app-path chip (e.g. `` `Settings › Beanie Wall` ``). No other markup is interpreted; bullets render as text (no HTML injection).
6. Box uses the issue tint: background `color-mix(--tint-hex 7%, white)`, 1px border `color-mix(--tint-hex 22%)`, labels in `--tint-ink`, radius 22px. Under the page's own phone breakpoint `@media (max-width: 520px)`: padding 18px 16px, radius 18px, and `.las-path { white-space: normal; max-width: 100% }` (the page's `overflow-x: hidden` would otherwise clip a long chip silently).
7. Semantics: `<section class="long-and-short" aria-labelledby="long-and-short-heading">` (stable class for the Substack selector; distinctive id so it can't collide with Astro's slugged markdown heading ids) with an `<h2>` and a `<ul>`; plain HTML for crawlers. RSS is unaffected (`rss.xml.ts` emits only `excerpt`).
8. `llms-full.txt` includes the three bullets (raw strings, backticks kept, same shared role labels) for a post that has them, above its body, so AI crawlers see the summary.
9. Notion: add three rich_text properties to the Blog Posts data source: `L&S: What We Built`, `L&S: How It Helps`, `L&S: Where to Find It`. These are the golden source for `longAndShort`.
10. Update `.claude/skills/beanies-blog/SKILL.md`:
    - property table + frontmatter mapping for the three properties;
    - during review, for any feature-style post, propose the three bullets (or say why the post should have none) and get greg's explicit approval BEFORE the post is regenerated/pushed to the repo;
    - on approval, write bullets to Notion first, then regenerate;
    - "where" bullet must name the real, shipped UI path, verified against `src/services/translation/uiStrings.ts` / the code;
    - Substack copy leads with the box: take the `<section>` outerHTML from the same Playwright page load as `.blog-prose` (markers are CSS, so it pastes as a plain heading + intro + `<ul>`);
    - sync rules: always double-quote the three YAML values (a leading backtick is a YAML parse error), escaping `\` then `"` (double quotes, not single, because greg's apostrophes would need `''`); Notion bold/italic annotations are dropped, only `annotations.code` maps to backticks (plain_text drops them, so read the annotations); drafting rule: no bold, backticks only for the path; all three empty → omit the field; one or two filled → stop and report row ID + empty property names before regenerating;
    - make the Notion namespace note namespace-agnostic: use whichever `mcp__notion*` namespace is loaded; on `object_not_found` for this data source, try the other namespace before assuming a bad ID (the note has flipped twice);
    - all long-and-short rules live in ONE new SKILL.md section (eligibility, drafting rules, approval gate, Notion-first write, sync rules); outside it only the three property rows, one frontmatter-table row, and one-line pointers from steps 2, 4 and 7.
11. Retrofit (drafts already prepared during planning: 13 feature posts, 13 stories, every "where" verified against uiStrings/router/nav): present them to greg as one batch for approval. Only after approval: write to Notion (the three properties on each row) first, then add `longAndShort` to each repo markdown file. No `updatedDate` bump (a summary is not a content revision).
12. No deploy. `deploy-web.yml` stays greg's manual action.

## Important Notes & Caveats

- The drop-cap/lead styling targets `.blog-prose > p:first-of-type`; the box lives outside `.blog-prose`, so it cannot steal the lead treatment. This is why it is rendered by the layout, not the markdown.
- The marketing site is English-first and not covered by the app's i18n lint (per CLAUDE.md), so the fixed strings live in the `.astro` file.
- The web site is light-only (no dark palette), so no dark partner is needed; match existing post-page styles.
- Rem-based text only (no px font sizes). Label size 0.6875rem matches existing small-caps labels (`.post-kicker`, `.post-nav-label`).
- Bullet text is lowercase by house style for the blog voice; not enforced in code.
- Backtick chips: an unmatched backtick renders literally (no crash).
- Deliberate deviation from the mockup: bullets are text-only, so the mockup's `<strong>beanie wall</strong>` is not reproduced (simpler, no markup parsing).
- The guides' `keyTakeaways` recap card (`guides/[...slug].astro:161-175`) was considered for reuse and rejected: dark slate, numbered, end-of-article, a different design from the approved mockup.
- UI paths in `longAndShort.where` are point-in-time. When a post announces a UI rename, the skill's review step greps `content/blog` for chips containing the renamed label. Manual, documented; no automated checker.
- Notion writes happen only after greg's explicit approval of the batch; a failed property write must be reported by row and property, never silently skipped.

## Assumptions

1. `web/public/brand/beanies_small_bean_favicon_100x100.webp` is produced by the brand sync on `predev`/`prebuild` (verified present 2026-09-29).
2. Astro's content schema accepts a nested `z.object` for an optional field (standard Zod).
3. The Notion integration behind `mcp__notion__*` can add properties via `API-update-a-data-source` (read verified; write assumed). Adding the properties is the FIRST Notion step; on failure, show the API error and ask greg to add them in the Notion UI, then re-read the live schema.

## Approach

**Schema** — `web/src/content.config.ts`: add
`longAndShort: z.object({ built: z.string().trim().min(1), helps: z.string().trim().min(1), where: z.string().trim().min(1) }).strict().optional()` with a docblock naming the Notion properties it maps from.

**Shared roles** — `web/src/utils/blog.ts`: `export type LongAndShort = NonNullable<CollectionEntry<'blog'>['data']['longAndShort']>` and `export const LONG_AND_SHORT_ROLES = { built: 'what we built', helps: 'how it helps you', where: 'where to find it' } satisfies Record<keyof LongAndShort, string>`. Key order = render order; export a typed `longAndShortEntries(summary)` helper (one cast, `Object.entries(LONG_AND_SHORT_ROLES) as [keyof LongAndShort, string][]`) used by both the component and llms-full so order and typing cannot drift. Mirrors the `BLOG_CATEGORIES`/`CATEGORIES` drift guard; `astro check` runs in `build:web`.

**Component** — new `web/src/components/LongAndShort.astro` (prop `summary: LongAndShort`). Holds the heading + intro strings, iterates the entries helper, splits each bullet inline with ``text.split(/`([^`]+)`/)`` (odd segments → `<span class="las-path">`), and carries the mockup's scoped CSS using fallback-backed values matching the page's `var(--tint-*, …)` convention: `var(--tint-hex, #f15d22)`, `var(--tint-ink, #a83a11)`, `var(--deep-slate, #2c3e50)` (defined on `.post-page`, `[...slug].astro:657`), Outfit/Fraunces stacks already loaded. Bean markers via `li::before` background-image. A component keeps the 968-line post page from growing.

**Page** — `[...slug].astro`: `{post.data.longAndShort && <LongAndShort summary={post.data.longAndShort} />}` between `</header>` and the divider.

**llms-full.txt** — for posts with the field, push `Summary:` + one `- <role>: <raw text>` line per entry before the body.

**Notion** — first step: `API-update-a-data-source` adds the three rich_text properties (fallback per Assumption 3).

**Skill** — edit `beanies-blog/SKILL.md` per Requirement 10: one new "The long and short of it" section (eligibility, drafting rules: one sentence each, ≤25 words, lowercase, "where" = exact shipped UI path in backticks; approval gate; Notion-first write; sync rules; rename grep), plus the three property rows, one frontmatter-table row, one-line pointers from steps 2/4/7, and the namespace-agnostic note.

**Retrofit** — present the prepared batch (table: post, bullets, or "no box: story"). On approval: Notion properties per row, matched by the `URL` property / `ID` (never by title), then repo frontmatter, then `build:web` + spot-check. Report per-row, per-property Notion results.

## Files Affected

- `web/src/content.config.ts` — schema field
- `web/src/components/LongAndShort.astro` — new
- `web/src/pages/blog/[...slug].astro` — render the component
- `web/src/utils/blog.ts` — `LongAndShort` type, `LONG_AND_SHORT_ROLES`, entries helper
- `web/src/pages/llms-full.txt.ts` — summary lines
- `.claude/skills/beanies-blog/SKILL.md` — workflow update
- `content/blog/*.md` — `longAndShort` on approved posts (after approval)
- `docs/mockups/blog-beanie-bullets-2026-09-29.html` — approved mockup (already committed)
- `CHANGELOG.md` — "Added" line for the blog summary box
- Notion Blog Posts data source — 3 properties + values (after approval)

## Observability Coverage

The marketing site is static Astro with no client JS on this surface and no path to the CloudWatch firehose (`logEvent` is app-only). The feature has no runtime failure mode: content is resolved at build time.

- **Failure modes**: malformed `longAndShort` (missing key, blank string, misspelled key, wrong type) → Zod fails `build:web` with the file and key named; missing favicon asset → markers simply don't draw (CSS background; the `.webp` is a generated untracked companion and `sync-brand-assets.mjs` only fails on a missing source folder), caught by browser verification; unmatched backtick → rendered literally (documented).
- **Success-path signal**: none needed at runtime. Adoption is visible in the repo (grep `longAndShort:`). Reading behaviour is already measurable in Plausible.
- **Critical vs telemetry**: none. **Privacy/store gate**: no new context keys.

## Acceptance Criteria

- [ ] A post with `longAndShort` renders the box between header and divider, matching the approved mockup (desktop + 400px), tint-coloured per issue.
- [ ] A post without the field renders exactly as before (no empty box, no layout shift).
- [ ] A post with a missing `where` key, or a misspelled key, fails the web build with a clear Zod error.
- [ ] Backticked paths render as chips; other text renders as plain text.
- [ ] The longest real `where` path shows fully (wrapped, not clipped) at 400px.
- [ ] Lead paragraph drop cap is unchanged on a post with the box.
- [ ] `llms-full.txt` shows the summary for posts that have it.
- [ ] `npm run validate` and `npm run build:web` green.
- [ ] Notion has the three properties; the beanies-blog skill documents the mapping, approval gate, Notion-first write, "where" verification and Substack prepend.
- [ ] Retrofit bullets presented to greg; after approval, Notion rows and repo files both carry them and match.
- [ ] Observability: build-time schema enforcement verified by a deliberately broken local frontmatter (reverted).

## Testing Plan

1. `npm run validate && npm run build:web` (validate does not build the web site).
2. Temporarily remove `where` from one post locally, then a misspelled key → `build:web` fails naming it → restore.
3. `npm run dev:web`; visit a post with the box and one without, desktop 1280 + 400px; screenshots reviewed.
4. Check `/llms-full.txt` locally for the summary lines.
5. After retrofit approval: query Notion rows for the three properties and diff against repo frontmatter.

## Review Passes

- **Pass 1 (Initial draft)**: drafted from the approved round-2 mockup and greg's prompts.
- **Pass 2 (DRY + error handling)**: inline chip split (dropped helper/test/vitest change); role labels in one `satisfies`-typed `LONG_AND_SHORT_ROLES` shared by component + llms-full; Zod `.trim().strict()`; Substack takes the box's built HTML; skill sync quotes YAML, maps Notion code annotations to backticks, stops on part-filled rows; corrected favicon-observability claim + web build command; Notion property-add failure falls back to greg adding them in the UI.
- **Pass 3 (Sustainability)**: fallback-backed tint/slate values; bean markers as CSS `::before` backgrounds (drops a Substack strip transform); namespace-agnostic Notion note; all long-and-short skill rules in one SKILL.md section; caveat that "where" paths are point-in-time.
- **Pass 4 (Fresh-eyes sweep)**: chip wraps via `white-space: normal` under the page's `@media (max-width: 520px)` (page `overflow-x: hidden` would clip silently); corrected Pass 3's false "`--deep-slate` undefined" claim (defined at `[...slug].astro:657`, fallback kept); mockup `<strong>` recorded as a deliberate text-only deviation, Notion bold/italic dropped on sync; YAML escapes `\` and `"`; distinctive heading id, stable `.long-and-short` class, typed shared role iteration; RSS unaffected.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

/beanies-blog There is a bit of a contradiction with our blog strategy, which is that we are targetting families and parents who are extremely busy, offering to help reduce some of the mental load in their lives, but at the same times innundating them with 1000-1500 word blogs every week, which they have to read if they want to understand what the new features are if they want to use them. while i think it's very important that people understand a lot of thought is behind these features, and everything we do, and the decisions or thought process i (or we) took to come to the final product, not everybody has the time or energey to read everything. for this reason, my thiking is that we prepare a bullet point summary for every blog post, both going forward, as well as retroactively for ones we've posted already. i'm thinking something like the below: include a summary section at the top of every blog, giving a clear, brief, and concise summary of the article in 3 bullet points. Always 3, for consistency and repeatability; we can title the section "3 beanie bullets" or something to that effect - a clear title so readers always know they can go there for the summary; the focus is on the key items and themes from each feature announcement post - (1) what we built, (2) how it will help you, and (3) where to find it; i think the section should somehow be visually separated from the rest of the blog, perhaps in a shaded box, or somethign to that effect. Invoke /frontend-design for thoughts on how we can include this section in the beanstalk blog and how it should look to clearly convey to users that this is a summary of the article and brings you right to the information you need; Have a very short sentence at the top - something like - "We know our beanies are busy, so here are the key points from this post:"; THis probably wouldn't apply for my stories (like aloe vera, etc), but would work well for more straightforward feature announcements, so it may not apply across the board to every piece. Let me know your thoughts on this, and how do you think we coudl make it work for new and existing blogs?

### Follow-up 1

can you crarte the mockup as a claude artifact

### Follow-up 2

Looks very good - can you make the below adjustents: '3 beanie bullets' -> 'the long and short of it'; top sentence: 'we know our families are busy, so here's the beanie breakdown'; each bullet should be the beanie face favicon emoji, to stay on brand and use an existing item; let's keep the small role labels - for the design though, do you suggest italics, or the small caps letter that we use more conventionally across the site? what is your recommendation

### Follow-up 3

This looks perfect, please proceed to build with /beanies-build-auto and update the beanies-blog skill as proposed above to ensure this is done going forward. the summary bullets should be presented to me and i'll approve before the blog is pushed to the repo from notion. once the summary points are approved, ensure that notion is also retrofitted with the summary bullet points. please go ahead to build and propose summary bullets for the existing blogs as appropriate.
</details>

## Retrofit batch (drafted 2026-09-29, PENDING greg's approval)

Classified by content, not `category:`. Every `where` was checked against the `en` labels in `uiStrings.ts`, `src/constants/navigation.ts` and `src/router/index.ts`. Nothing below is in Notion or the repo until greg approves it.

**Stories, no box (13):** welcome-to-the-beanstalk, accidentally-built-greatest-family-app, best-cozi-maple-alternatives-in-2026 (borderline: a whole-product comparison), aloe-vera, have-your-cake-and-eat-it-too (privacy philosophy), japan-trip-with-my-son, vibe-coding-the-wrong-way, vibe-coding-has-killed-my-sanity, made-a-wish-to-become-a-real-boy (borderline: PWA vs native essay; the-apps-are-here is the download post), didnt-have-time-to-write-a-post-this-week, me-myself-and-ai, maple-alternative (borderline: migration pitch pointing to /from/maple), getting-down-to-brass-tacks (pricing).

**Feature posts (13):**

| post                                      | built                                                                                                                                       | helps                                                                                                                        | where                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| travel-plans-intro                        | a travel plan for each family trip that keeps flights and hotels next to loose ideas, even when half of it isn't booked yet.                | you can jot down tentative plans as they come and fill in the details later, without anything getting lost.                  | `The Treehouse › Travel Plans`                                                                       |
| buy-fruit                                 | shared to-dos you can assign to anyone in the family with a due date, plus a someday/maybe list for things with no date yet.                | small asks like 'buy fruit' reach the right person on the right day instead of getting buried in a group chat.               | `The Treehouse › To-Dos`, with today's items also in `Your Daily Briefing` on the `Family Dashboard` |
| activity-finance-linking                  | activities and loans can create a linked payment from one of your accounts, so a fee is recorded once and flows into your finances.         | kids' activity costs stay in step with your transactions and net worth, with no bank logins or monthly csv uploads.          | `The Treehouse › Family Activities`, add a fee to an activity and switch on `Create Monthly Payment` |
| dog-ear-infection                         | a medications tab for every family member, pets included, holding dose, schedule, notes, label photos and a log of each dose given.         | anyone in the family can check who gave the last dose and when, so nobody doubles up or misses one.                          | `The Bean Pod › Meet the Beans`, then tap a bean and open the `Medications` tab                      |
| family-scrapbook-that-lasts-forever       | a family scrapbook where you capture photos and the funny things your kids say, as they happen or backfilled from years ago.                | the little moments you swear you'll remember get saved for good, in your own family file rather than a notes app.            | `The Bean Pod › Family Scrapbook`                                                                    |
| getting-your-beans-in-a-row               | beanie lists: checklists for one-off projects or recurring chores that can reset on a schedule and attach to a trip or activity.            | packing lists and weekly grocery runs stay out of your to-dos, and the ones that are due show up in your daily briefing.     | `The Treehouse › Beanie Lists`                                                                       |
| google-calendar-integration               | a Google Calendar connection that pushes your beanies activities and travel plans out to the Google calendars you choose.                   | family members who live in Google Calendar still see every event, with who's driving and who's paying packed into the notes. | `Settings › Google Calendar`                                                                         |
| welcome-our-new-ai-overlords (borderline) | magic beans, private AI that reads a photo, screenshot or itinerary and fills in an activity or travel plan for you.                        | you skip retyping invites and booking emails, and the AI provider keeps nothing once it has finished reading.                | tap `Magic beans` on `The Treehouse › Family Activities` or `The Treehouse › Travel Plans`           |
| my-life-could-use-some-helpful-hints      | helpful hints, automatic nudges for things families forget, like visas before a trip or a gift before a birthday party.                     | the stuff that usually slips through the cracks shows up in your to-dos days ahead, while there's still time to sort it.     | `The Treehouse › To-Dos`, under `Helpful Hints`, with on/off switches in `Settings › Reminders`      |
| the-apps-are-here                         | native beanies.family apps for iPhone and Android, available now on the App Store and Google Play.                                          | beanies opens like any other app on your phone, and you can share photos and links straight into it from the share menu.     | the `App Store` or `Google Play`, search for beanies.family                                          |
| mommy-whats-for-dinner-tonight            | a meal planner for laying out the week's meals by drag and drop, plus a family cookbook that reads recipes from links, videos or text.      | nobody has to work out dinner at 5pm, and you can share the week's plan or print it for the fridge.                          | `The Treehouse › Meal Planner`, with recipes in `The Bean Pod › Family Cookbook`                     |
| beanie-wall-for-your-whole-family         | the beanie wall, a full-screen family display for a spare tablet showing the week's calendar and a chore board for each kid.                | everyone can see what's on and tick off their own chores, so you know who really earned their allowance.                     | `Settings › Beanie Wall`, then tap `Start the wall`                                                  |
| sharing-with-beanies                      | a beanies.family option in your phone's share menu, so a flyer photo or booking email becomes a filled-in calendar activity or travel plan. | event details land on the family calendar in seconds instead of sinking into your camera roll.                               | your phone's share menu › `beanies.family`, in the iPhone or Android app                             |
