# Pinterest playbook — beanies.family

Everything the pin skill needs to know about *where* pins go, *how* they get found,
and *how we grow*. The canonical strategy lives in Notion (**Launch HQ → "Pinterest
Strategy & Influencer Outreach"**, page_id `397247d9-a99f-817f-9d7b-f73ace76f1a9`); this
file distills the parts a pin-builder needs plus the current 2026 best-practice research.
When they disagree, prefer the Notion page (it's greg's decisions) but flag the conflict.

## Why we're here (the funnel)

Pinterest is a **visual search engine**, not a social feed. Our goal is **content traffic +
SEO**, not direct installs. The funnel is:

> Pinterest search → a designed vertical pin → a blog/guide on **beanies.family** → an
> in-content CTA → `app.beanies.family` signup.

Two hard rules that protect the funnel:
- **Pins link to a blog/guide on the beanies.family domain — never straight to the app,
  never the raw login, never Substack.** Pinning to the app kills conversion; linking to
  Substack leaks SEO authority off our domain. If a post also lives on Substack, use the
  `beanies.family/blog/<slug>` canonical URL.
- **Never post a bare app screenshot.** Screenshots only appear *inside* a branded 2:3
  graphic as the payoff.

## KPIs (priority order — from the Notion page)

1. **Outbound clicks** to beanies.family  ← the commercial signal
2. **Pinterest-referral sessions** (cross-check in web analytics via the UTMs)
3. **Saves** (Pinterest's main ranking/compounding signal)
4. **Impressions**

**Follower count is a vanity metric — ignore it.** On Pinterest, keywords beat followers;
a new account with tight, on-topic pins can rank immediately.

Benchmarks for a new/small account (community-sourced, not Pinterest-official — treat as
rough): save rate ~0.2–0.5% (below 0.2% = weak content), outbound CTR platform-avg
0.2–0.5% and a *good* organic CTR ~1–1.5%. Small niche accounts often over-index on
engagement because the audience is tightly matched.

## Boards (keyword-named for SEO)

**This list is the single source of truth, and it must mirror the boards that actually
exist on greg's Pinterest account — not an aspirational set.** Assign every pin to a board
NAMED HERE, and pick from what exists rather than inventing a new one. Subtly-different
boards for the same topic (e.g. "family calendar & organization" vs "family organization
and planning" vs "family organization / all-in-one family app") are a mistake: Pinterest
reads them as one topic and splits the ranking signal across all three. Consolidate; don't
proliferate.

**Actual boards (keep this in sync with the live account):**

1. **Family Organization and Planning** — the original catch-all board.
2. **Family Meal Planning** — approved by greg 2026-09-05, when the meal-planner post gave
   the account its first real cluster of meal/recipe pins. Meal planning is a genuinely
   distinct high-volume search cluster from organization, which is why it earned its own
   board rather than being folded in. **greg creates the board on Pinterest himself** (there
   is no API for it) - if it does not exist yet at posting time, that is the blocker, not a
   pin problem.

On 2026-08-20 greg consolidated everything into a single board (Pinterest has no merge
button — he bulk-moved pins in, then deleted the emptied boards). The retired/merged-away
boards were "Family Organization / All-in-one Family App", "Large Family Life", "Family
Command Center" and "Family Budgeting & Money" — **do NOT recreate any of them**; they no
longer exist. The Pin Tracker's `Board (s)` options were pruned to match. As of 2026-09-05 the
Tracker carries two options: Family Organization and Planning, and Family Meal Planning.

> **Creating a new board:** greg's rule is keep the list clean — add one ONLY when a
> genuinely distinct keyword topic clearly benefits, and get his ok first (then add it here
> AND to the Tracker's options). The first board to actually earn this
> was **Family Meal Planning** (2026-09-05). The next strongest candidate is a real
> **Family Budgeting & Money** board: "money/budgeting" is a distinct high-intent search cluster from
> "organization", so once there are several money-angle pins it may earn its own board. Never
> auto-spawn a near-duplicate of the organization board to fit a single pin.

**Retired assumption (do NOT recreate these unless greg actually makes them):** the earlier
draft of this playbook listed Family Budgeting & Money, Family Meal Planning, Chore Charts &
Kids, Large Family Life, Family Calendar & Organization, Homeschool Planning, Family Command
Center, Money-Saving Tips for Parents. These were aspirational, not real boards. Some may be
worth creating deliberately later as distinct keyword topics — but only as a considered
decision, one at a time, never auto-spawned to fit a pin.

Rules:
- Pick the **single most topically-relevant EXISTING board** for each pin (board topic is a
  ranking input).
- If a pin genuinely fits no existing board, **propose creating one and get greg's ok** —
  then add it here — rather than silently forcing a near-duplicate.
- A pin may be added to a second relevant board later, but publish it fresh to its best-fit
  board first.

## The "fresh pins" mechanic — why we make 2–3 per post

The 2026 algorithm rewards **fresh pins** = a *new image + new URL combination*, not
repins of an existing pin. Practically: for one blog post, publish **2–3 visually distinct
pins**, each a different angle/headline/design, each with its **own `utm_content`** so we
can tell which creative won. This is simultaneously a growth play and an A/B test — then we
double down on the design/topic that earns saves + outbound clicks.

Distinct means *genuinely different*: a different ground colour, a different hook (e.g.
"the sunday reset" vs "one place for money + plans"), a different layout (mascot vs photo vs
typographic). Three near-identical recolours are not three fresh pins.

## UTM scheme (define once, keep stable)

Pinterest **preserves query params** on outbound links (the old "UTMs unsupported" advice
is wrong). Every pin URL is the clean `beanies.family/blog/<slug>` destination plus:

| param          | value                              | why |
| -------------- | ---------------------------------- | --- |
| `utm_source`   | `pinterest`                        | the channel |
| `utm_medium`   | `social` (organic) / `cpc` (paid boost) | organic vs promoted |
| `utm_campaign` | the destination **blog/guide slug** | which content the pin promotes |
| `utm_content`  | a **unique per-pin code** (see below) | *which pin* the click came from |

**`utm_content` = the pin code**, formatted `<slug-short>-<angle>` — e.g.
`weekly-reset-sunday`, `weekly-reset-oneplace`. It is stable, human-readable, and is also
the row identifier in the Pin Tracker (see below), so a click in analytics maps back to an
exact pin. Keep it lowercase, hyphenated, no spaces.

Build the final URL by appending in this exact order:
`?utm_source=pinterest&utm_medium=social&utm_campaign=<slug>&utm_content=<pin-code>`

## Rich Pins (one-time, free — recommend enabling)

Article Rich Pins auto-pull title/description/author from our Astro OG tags (already solid).
No visible badge anymore, but they keep pin metadata synced to the source and help ranking.
Setup is one-time: confirm a business account + verified domain (both done), then validate a
single live guide URL in Pinterest's Rich Pin Validator; approval then applies domain-wide.
If greg hasn't validated yet, surface it as a quick win — not a per-pin step.

## Hashtags — the live tension

The Notion page's copy bank suggests **3–5 hashtags per pin**. Current (2026) best-practice
research says **hashtags are effectively deprecated** for Pinterest ranking (~1% of ranking
power; don't hurt, don't meaningfully help). **Recommendation: minimize** — spend the
description's characters on natural long-tail keyword *phrases* instead of hashtag lists. If
greg still wants a few, cap at 2–3 highly relevant ones at the end of the description. Always
surface this choice rather than silently deciding.

## Cadence & seasonality

- **5–15 fresh pins/week**, ~80% link-pins to blog/guides (evergreen, keyword-shaped),
  ~20% styled app-screenshot payoff pins.
- **Seasonality is the biggest free lever**: Pinterest surfaces content **30–45 days
  ahead** of a spike, so time themes early — back-to-school organization (Jul–Aug), New
  Year get-organized + family budget (late Dec–Jan), summer travel packing (spring), holiday
  budgeting (Oct–Nov). When proposing pins, check the calendar and lead the season.

## Paid reach — when a little money makes sense

Organic-first: Pinterest's organic reach is genuinely strong and free. Paid is an
*accelerant for proven winners*, not a rescue for weak pins.

- No hard minimum; practical range ~$5–$15/day for a small test, ~$18/day+ for conversion
  campaigns. CPC ~$0.10–$1.50, often 30–50% cheaper than Meta.
- **The useful quirk**: a promoted pin keeps working organically after the budget ends (it
  stays searchable), so spend compounds more than on Meta.
- **Recommend a small boost only when** a pin has already earned above-benchmark saves +
  outbound clicks organically over ~2–4 weeks. Boost the winner; never boost a fresh pin
  blind. Set `utm_medium=cpc` on a boosted pin's URL so paid vs organic is separable in
  analytics.

## Collaborations — the influencer pipeline

The **Influencer Outreach** database (on the same Notion page,
`data_source_id 397247d9-a99f-800b-ad22-000be07e8dd2`) holds 22 vetted creators with a
`Status` funnel (Top 5 — first wave → To approach → Contacted → Replied → Collab live /
Deprioritize / Do not contact).

**Gate outreach on having a presence.** Suggest reaching out once we have a real track
record to show (a set of live pins, some saves/clicks, ideally a couple of ranking pins) —
a cold pitch with an empty account converts poorly. When the account has traction, surface
the **Top 5 first wave** and recommend the next 1–2 to approach.

Outreach rules (from the page):
- **Channel priority**: collab email from their blog "Work With Me"/contact page → blog
  contact form → Instagram DM / IG-bio email → Pinterest DM (last resort, assume unread).
  **Pinterest DMs are a dead channel for business — never lead with one.**
- **Do NOT cold-pitch** (closed to collabs): Organizing Moms, World of Printables,
  Lamberts Lately.
- **Tier tactics**: Micro/nano (1k–25k) = free lifetime premium + affiliate or a small flat
  fee; a warm, personalized email often converts. Mid (25k–250k) = expect a rate card / paid
  post; some do product-for-post. Large (250k+) = agency/manager-gated; treat as funded
  campaigns or reach benchmarks only.
- **The pitch**: ~150–200 words; personalize the first line with a specific board/pin/
  printable of theirs (biggest response lever); lead with what's in it for them (free
  lifetime premium, affiliate cut, co-branded printable, giveaway), not features; one trivial
  CTA; don't attach a media kit on first contact (offer it as the CTA); use their required
  subject line exactly; follow up once or twice ~1 week apart. A drafted Wondermom Wannabe
  pitch is on the Notion page as a model — reuse its shape, re-personalize per creator, and
  route greg's-voice copy to him for a pass before sending (his standing rule).

When you recommend a collaboration, say: who, why now, which channel + exact contact, what
to offer given their tier, and a one-line personalized opener hook. Leave the send to greg.

## Content-gap caution

Several strong pin concepts (weekly meal plan, chore charts, family command center,
one-income budget) may not have a dedicated guide/post yet — the 4 pillar guides that exist
are `/guides/family-organization`, `/guides/overwhelmed-family-planning`,
`/guides/family-finance-basics`, `/guides/local-first-family-finance-planning-tools`. **A
pin must never point at a URL that 404s.** Before finalizing, confirm the destination is
live; if it isn't, either point the pin at the nearest existing pillar guide or tell greg the
content needs writing first.
