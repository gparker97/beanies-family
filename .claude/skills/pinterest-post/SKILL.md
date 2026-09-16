---
name: pinterest-post
description: >-
  Create and track high-converting beanies.family Pinterest pins that funnel to the
  beanstalk blog/guides. Use this WHENEVER greg wants to make, design, draft, render, or
  schedule a Pinterest pin (or a set of pins) for a blog post or guide; when he gives a
  blog/beanstalk URL and says "make a pin / pin this / pinterest this"; when he asks for pin
  copy (title/description), a pin image, board choice, or the tagged UTM link; and ALSO when
  he wants to log or review pin performance, decide which pins are winning, weigh a paid boost
  or Pinterest ad, or plan influencer/collaborator outreach for Pinterest. Trigger even if he
  doesn't say the word "skill" — e.g. "let's do a pin for the sunday-reset post",
  "how did last week's pins do", "should we pay to promote the budgeting pin". The canonical
  strategy lives in Notion (Launch HQ → Pinterest Strategy); this skill executes it.
---

# pinterest-post

Generate on-brand beanies.family Pinterest pins — image, copy, board, and a UTM-tagged link —
and track how they perform so we amplify winners. Pinterest is a **visual search engine** and
our goal is **content traffic + SEO** (pins → a beanies.family blog/guide → the app), not
direct installs. Follower count is a vanity metric; the KPIs are **outbound clicks →
referral sessions → saves → impressions**.

Read `references/pinterest-playbook.md` (strategy, boards, UTMs, metrics, collab, paid),
`references/voice-and-copy.md` (voice, title/description rules, examples) and
`references/asset-catalogue.md` (**every** graphic available, what it depicts, and which
are defective) before producing anything. For brand visuals, defer to
`.claude/skills/beanies-theme/SKILL.md` and `docs/brand/beanies-cig-v2.html` — don't
duplicate the palette here.

## Two modes

- **Create** (default, when given a blog post / URL / "make a pin"): design **2–3 distinct
  "fresh" pins** for one destination and log them.
- **Track & amplify** (when asked "how did the pins do", "log metrics", "which pin won",
  "should we boost / collaborate"): update the Pin Tracker with reported numbers, surface
  winners, and recommend amplification, collaboration, or a small paid test.

If the request is ambiguous, ask which. Default to Create when a blog URL is present.

---

## Create mode — workflow

### 1. Resolve the destination (never skip)
- The pin points to a **beanies.family blog or guide URL**, e.g.
  `https://beanies.family/blog/<slug>`. Accept a URL directly, or a Notion Blog Posts row /
  "post N" and resolve it to its live URL the way the `beanies-blog` skill does (Blog Posts DB
  `data_source_id 33a247d9-a99f-815e-a53a-000b24c88de0`; a post's `URL` property is the live
  link; the route is `/blog/<slug>` using the bare slug, **not** the dated filename).
- **Hard rules**: beanies.family domain only — never Substack, never `app.beanies.family`,
  never the login. greg calls the blog "the beanstalk"; the real path is `/blog/<slug>`.
- **Confirm the URL is live (no 404)** before finalizing. If the target guide doesn't exist
  yet, point the pin at the nearest existing pillar guide or tell greg the content needs
  writing first. (See the playbook's "content-gap caution".)

### 2. Read the post
Fetch the destination (WebFetch the live URL, or read the Notion post body) so every pin is
grounded in what the post actually says — the hook, the concrete details, greg's phrasing.
Don't invent claims the post doesn't make.

### 3. Interview (briefly, come prepared)
Propose, don't interrogate. Confirm only what you genuinely can't infer:
- the primary **angle/keyword** for each pin (what a parent would search),
- any **seasonal** timing to lean into (Pinterest surfaces content 30–45 days ahead — see
  playbook),
- whether greg wants a **photo** pin (needs a real family/lifestyle photo he supplies) or
  **mascot/typographic** pins from brand assets,
- hashtags yes/no (default: minimize — see voice doc).

### 4. Propose 2–3 fresh pins (for approval, before rendering)
"Fresh pins" = new image + same URL, each a **genuinely different angle/design**. For each pin present:

| field | notes |
| --- | --- |
| **pin code** | `utm_content` value, `<slug-short>-<angle>`, lowercase-hyphen — the tracker id |
| **angle / keyword** | the search phrase it targets |
| **image direction** | ground + layout + align + deco + eyebrow + headline (keyword in `<em>`) + optional subtitle/kicker + **which artwork, by path from the catalogue** |
| **title** | ≤100 chars, hook+keyword in first ~40, lowercase, greg's voice |
| **description** | ≤500 chars, 2–3 keywords front-loaded in sentence 1, greg's voice |
| **board** | the single best-fit board (playbook lists the 8) |
| **tagged URL** | `…/blog/<slug>?utm_source=pinterest&utm_medium=social&utm_campaign=<slug>&utm_content=<pin-code>` |

#### The variety rule (this is the point of the step)

The first batch of pins all looked the same: near-white ground, centred mascot, the
family-hugging cluster, every time. That happened because the template hardcoded that image
and offered two pale grounds, and because "fresh" was read as "recoloured". Two things now
prevent it.

**Vary all three axes across a set, not one.** A set of pins must differ in **ground**,
**layout** AND **artwork**. Three grounds behind the same centred cluster is one pin three
times. Concretely, from `assets/pin-template.html`:

- **grounds** — `cloud` `sky` `paper` `mint` (light) and `slate` `midnight` `ember`
  `terracotta` (dark/saturated). **At least one pin in every set uses a dark or saturated
  ground.** A Pinterest feed of pale cards disappears; the orange and terracotta grounds are
  the ones that stop a scroll.
- **layouts** — `mascot` `hero-bottom` `split` `ring` `strip` `portrait` `photo` `text`.
- **artwork** — pick from `references/asset-catalogue.md`. **Do not default to the
  family-hugging cluster.** Match the art to the angle: money copy gets the pockets graphic,
  a bedtime post gets the reading hero, growth gets the beanstalk in the `portrait` layout,
  a milestone gets the ring, privacy gets the covering-eyes bean.

**Keyword colour is handled for you.** On the dark and saturated grounds the `<em>` keyword
and eyebrow go cream, not Heritage Orange, because orange on slate is about 3.1:1 and turns to
mud at thumbnail size. The template's `--accent` does this per ground; do not override it.

**Reuse the post's own image when it has a strong one.** `{{ASSET_BASE}}/blog/` holds every
beanstalk post image, so a pin can carry the same photo, screenshot or meme the reader is
about to land on. Not every pin, but it is the cheapest way to make the pin and the page feel
like one thing.

Show the copy and image direction and **wait for greg's approval / edits**. Voiced copy gets
his pass — that's his standing rule.

### 5. Render the approved pins
For each approved pin:
1. Copy `assets/pin-template.html` into the scratchpad, set
   `data-ground`/`data-layout`/`data-align`/`data-deco` on `<body>`, fill `{{EYEBROW}}`,
   `{{HEADLINE}}` (wrap the keyword in `<em>…</em>`), `{{SUBTITLE}}`, `{{KICKER}}` (delete the
   node if unused), and **set the `.hero` image to the artwork you chose** — the template ships
   with the family-hugging cluster as a placeholder, and leaving it is how the pins all ended up
   identical. For a photo pin, uncomment the `.photo` block and set the image +
   `--photo-brightness`. For `ring`, uncomment the `.ring` block.
   All art lives under `packages/brand/assets/`, referenced as `{{ASSET_BASE}}/shared/…`,
   `{{ASSET_BASE}}/marketing/…` or `{{ASSET_BASE}}/blog/…`. See `references/asset-catalogue.md`.
2. Render to a 1000×1500 @2x PNG, writing the final file into the Drive Pinterest folder:
   ```bash
   node .claude/skills/pinterest-post/scripts/render-pin.mjs <filled.html> \
     ~/gdrive-gparker97/Projects/beanies.family/Marketing/Pinterest/<pin-NN>.png
   ```
   (Playwright headless Chromium; needs network for the webfonts. If Chromium is missing:
   `npx playwright install chromium`.)
3. **Look at the PNG** and sanity-check: text inside the safe zone, keyword legible at
   thumbnail size, contrast holds, mascot/bean signature present, wordmark reads
   `beanies.family`. Re-render if off. The renderer now **fails rather than writing a pin with a
   missing image**, so a path typo stops you instead of shipping a hole; but it cannot tell you
   the composition is dull, which is what your eyes are for.

**Where files go — important.** Pins are launch/marketing content, which per the project
rules must **NOT be committed to the repo**. Render the final PNG into the Google Drive
Pinterest folder — `~/gdrive-gparker97/Projects/beanies.family/Marketing/Pinterest/` (mounted
via rclone, so it persists across machines and greg can grab it from Drive directly). Use the
scratchpad only for intermediate/throwaway renders. Then hand greg the PNG path and log the
row to Notion. The reusable *template + script* live in this skill (they're tooling, fine to
commit); the *rendered pins and their copy* live only in Drive + Notion.

**Check the mount before rendering.** If rclone isn't running, that path is an ordinary empty
local directory and the render will *appear* to succeed while landing on local disk. Confirm
with `findmnt /home/greg/gdrive-gparker97` first — not `ls`, which can't tell the difference.

> Legacy note: two paths are retired — `~/beanies-pins/` (local-only, the first batch) and
> `…/beanies.family/Pinterest/` (pre-2026-08-18, before the Drive tree gained a `Marketing/`
> layer). Always render to `Marketing/Pinterest/` going forward.

### 6. Log to the Pin Tracker (on approval)
Write one row per pin to the **Pin Tracker** Notion DB
(`data_source_id 3be247d9-a99f-80d9-a310-000bd37b083d`) — schema and how-to below. Write the PNG's
local path into the `Pin image` text column (the actual image gets attached on Pinterest when
greg posts). Give him a ready-to-paste block per pin: title, description, board, and the tagged
URL, plus the PNG path.

### 7. Hand off
Summarize: the N pins (code, board, tagged URL, PNG path), a one-line "post it" checklist
(upload PNG → paste title/description → set destination URL → pick board → publish → paste the
live Pinterest URL back into the tracker's `Pinterest URL`), and any seasonal timing note.

---

## Track & amplify mode

1. Ask greg for the current per-pin numbers from Pinterest Analytics (impressions, saves,
   outbound clicks) — or take a screenshot/paste. Optionally cross-check referral sessions in
   web analytics via `utm_source=pinterest` + the per-pin `utm_content`.
2. Update each pin's row: `Impressions`, `Saves`, `Outbound clicks`, computed
   `Save rate %` (saves/impressions×100) and `Outbound CTR %` (outbound clicks/impressions
   ×100), and `Metrics updated`.
3. **Read the results** against the benchmarks (playbook): save rate 0.2–0.5% ok, good
   outbound CTR ~1–1.5%. Name the winners and the duds. For a winner, recommend concretely:
   more pins in the same *angle/topic* (fresh designs), the best board, and whether it's
   earned a small paid boost. For a dud, say why (weak thumbnail promise? off-keyword title?
   wrong board?) and what to change.
4. **Collaboration & paid** are gated on traction — only raise them once there's a real track
   record. When warranted, pull recommendations from the playbook: which Top-5 creator to
   approach, via which channel, what to offer for their tier, and a personalized opener; or
   whether a ~$5–15/day boost on a proven pin makes sense. Route any greg-voice outreach copy
   to him for a pass. Leave the send/spend decision to greg.

---

## Constraints (read once)

- **Funnel rules are absolute**: beanies.family blog/guide destinations only; never the app,
  login, or Substack; never a bare app screenshot as the pin.
- **Never commit rendered pins or pin copy to the repo** — launch content is Notion + local
  only. The template/script in this skill are the only repo artifacts.
- **Voice**: all-lowercase titles/descriptions, greg's maker voice, no em-dashes, no hype
  filler; his pass before anything voiced is final (see `references/voice-and-copy.md`).
- **Brand visuals** come from the theme skill + CIG; the Pod motif order and mascots are
  never redrawn or recoloured.
- **Variety is a requirement, not a preference.** Every set varies ground, layout AND artwork,
  and at least one pin per set uses a dark or saturated ground. Never leave the template's
  placeholder hero in place. See the variety rule in step 4.

## Pin Tracker schema (Notion)

Inline DB "Pin Tracker" on the Pinterest Strategy page, section 6.
`data_source_id = 3be247d9-a99f-80d9-a310-000bd37b083d`. To add a row, `API-post-page` with
`parent: { type: "data_source_id", data_source_id: "3be247d9-a99f-80d9-a310-000bd37b083d" }`.

| property | type | what to write |
| --- | --- | --- |
| `Title` | title | the pin's short headline / name |
| `Description` | rich_text | the Pinterest description copy (lowercase) |
| `Link` | url | the full **tagged** destination URL (with UTMs) |
| `Pin image` | rich_text | the Drive path to the rendered PNG (e.g. `~/gdrive-gparker97/Projects/beanies.family/Marketing/Pinterest/pin-NN.png`) — a text field, since the API can't upload image files; greg attaches the actual image when posting on Pinterest |
| `Board (s)` | multi_select | the target board(s) |
| `Status` | select | Draft / Approved / Live / Paused / Archived |
| `Pin code` | rich_text | the `utm_content` value ("which pin") |
| `Angle / Keyword` | rich_text | the primary search phrase/angle |
| `Date posted` | date | when it went live |
| `Pinterest URL` | url | the live pin link (paste back after posting) |
| `Impressions` | number | from Pinterest Analytics |
| `Saves` | number | " |
| `Outbound clicks` | number | " |
| `Save rate %` | number | saves / impressions × 100 |
| `Outbound CTR %` | number | outbound clicks / impressions × 100 |
| `Metrics updated` | date | last time metrics were refreshed |
| `Notes` | rich_text | anything useful (variant it beat, boost spend, etc.) |

## Key IDs & assets

- Pinterest Strategy page: `397247d9-a99f-817f-9d7b-f73ace76f1a9`
- Influencer Outreach DB: `data_source_id 397247d9-a99f-800b-ad22-000be07e8dd2`
- Pin Tracker DB: `data_source_id 3be247d9-a99f-80d9-a310-000bd37b083d`
- Blog Posts DB (for resolving a post → URL): `data_source_id 33a247d9-a99f-815e-a53a-000b24c88de0`
- Brand images: **`packages/brand/assets/`** — the one home for beanies media
  (`shared/`, `marketing/`, `blog/`). Full visual index with defects flagged:
  `references/asset-catalogue.md`. The old `web/public/brand/` path is now generated output and
  holds only part of the set; do not point at it.
- Template: `assets/pin-template.html` · Renderer: `scripts/render-pin.mjs`
