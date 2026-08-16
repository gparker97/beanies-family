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

Read `references/pinterest-playbook.md` (strategy, boards, UTMs, metrics, collab, paid) and
`references/voice-and-copy.md` (voice, title/description rules, examples) before producing
anything. For brand visuals, defer to `.claude/skills/beanies-theme/SKILL.md` and
`docs/brand/beanies-cig-v2.html` — don't duplicate the palette here.

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
"Fresh pins" = new image + same URL, each a **genuinely different angle/design** (different
ground colour, hook, and/or layout — not three recolours). For each pin present:

| field | notes |
| --- | --- |
| **pin code** | `utm_content` value, `<slug-short>-<angle>`, lowercase-hyphen — the tracker id |
| **angle / keyword** | the search phrase it targets |
| **image direction** | ground (`cloud`/`slate`/`sky`) + layout (`mascot`/`photo`/`text`) + eyebrow + headline (with the orange `<em>` keyword) + optional subtitle/kicker + which mascot/photo |
| **title** | ≤100 chars, hook+keyword in first ~40, lowercase, greg's voice |
| **description** | ≤500 chars, 2–3 keywords front-loaded in sentence 1, greg's voice |
| **board** | the single best-fit board (playbook lists the 8) |
| **tagged URL** | `…/blog/<slug>?utm_source=pinterest&utm_medium=social&utm_campaign=<slug>&utm_content=<pin-code>` |

Show the copy and image direction and **wait for greg's approval / edits**. Voiced copy gets
his pass — that's his standing rule.

### 5. Render the approved pins
For each approved pin:
1. Copy `assets/pin-template.html` into the scratchpad, set `data-ground`/`data-layout`/
   `data-align` on `<body>`, and fill `{{EYEBROW}}`, `{{HEADLINE}}` (wrap the keyword in
   `<em>…</em>`), `{{SUBTITLE}}`, `{{KICKER}}` (delete the node if unused). For a photo pin,
   uncomment the `.photo` block and set the image + `--photo-brightness`, and uncomment the
   bottom-right `.mascot-accent`. Mascot/photo assets live in `web/public/brand/`.
2. Render to a 1000×1500 @2x PNG:
   ```bash
   node .claude/skills/pinterest-post/scripts/render-pin.mjs <filled.html> <out.png>
   ```
   (Playwright headless Chromium; needs network for the webfonts. If Chromium is missing:
   `npx playwright install chromium`.)
3. **Look at the PNG** and sanity-check: text inside the safe zone, keyword legible at
   thumbnail size, contrast holds, mascot/bean signature present, wordmark reads
   `beanies.family`. Re-render if off.

**Where files go — important.** Pins are launch/marketing content, which per the project
rules must **NOT be committed to the repo**. Render into the scratchpad (or `~/beanies-pins`,
where the first batch lives), hand greg the PNG, and log the row to Notion. The reusable
*template + script* live in this skill (they're tooling, fine to commit); the *rendered pins
and their copy* live only in scratchpad + Notion.

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

## Pin Tracker schema (Notion)

Inline DB "Pin Tracker" on the Pinterest Strategy page, section 6.
`data_source_id = 3be247d9-a99f-80d9-a310-000bd37b083d`. To add a row, `API-post-page` with
`parent: { type: "data_source_id", data_source_id: "3be247d9-a99f-80d9-a310-000bd37b083d" }`.

| property | type | what to write |
| --- | --- | --- |
| `Title` | title | the pin's short headline / name |
| `Description` | rich_text | the Pinterest description copy (lowercase) |
| `Link` | url | the full **tagged** destination URL (with UTMs) |
| `Pin image` | rich_text | the local path to the rendered PNG (e.g. `~/beanies-pins/pin-NN.png`) — a text field, since the API can't upload image files; greg attaches the actual image when posting on Pinterest |
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
- Brand images: `web/public/brand/` — bean signature `beanies_small_bean_favicon_512x512.png`,
  family cluster `beanies_family_hugging_transparent_1024x1024.png`, plus father/mother/
  neutral/celebrating mascots and photos (`beanies-family-reading.webp`).
- Template: `assets/pin-template.html` · Renderer: `scripts/render-pin.mjs`
