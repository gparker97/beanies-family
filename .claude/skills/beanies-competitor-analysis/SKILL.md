---
name: beanies-competitor-analysis
description: >-
  Run a full competitive-marketing teardown of any company or app — reverse-engineering HOW they
  acquire users and sell — then compare it head-to-head with beanies.family and hand greg prioritized,
  concrete actions to improve user acquisition and sales. Use this WHENEVER greg names a competitor,
  rival, "similar app", or any company and wants to understand their marketing, distribution, growth,
  channels, traffic, funding, ASO, or how they got their users — e.g. "how did SuperFam get 30k
  families", "dig into Cozi's marketing", "competitive analysis of Maple", "where does <app> get its
  traffic", "teardown <company>'s acquisition strategy", "what channels is <rival> using", "should we
  worry about <startup>". Trigger even if he doesn't say "competitive analysis" or "skill" — a request
  to investigate another product's marketing/growth/channels IS this skill. Produces a structured report
  (saved to Notion) that always ends in a beanies comparison + ranked next actions.
---

# beanies-competitor-analysis

## What this skill is for

greg runs beanies.family and needs to know what other family-tech (and adjacent) products are doing to
win users — so he can copy what works, avoid what doesn't, and find lanes they've left open. This skill
turns "look into company X" into a rigorous, honest teardown of **how that company actually acquires
users and makes money**, then translates it into **actions beanies can take**.

The output is not a neutral profile. It always ends by comparing the target to beanies' current approach
and giving greg a **ranked, concrete list of user-acquisition and sales moves** — that comparison and
those actions are the whole point. A teardown with no "so what for beanies" has failed.

## The core discipline: verify, don't repeat

The single most important habit in this work is **treating claims as claims until independent data
backs them**. Companies publish vanity numbers ("30,000 families!") in funding PR, and every outlet
echoes the press release, so the same unverified number appears in ten places and *looks* corroborated.
It isn't. Your job is to find the independent signal — app-store install brackets, rating counts,
traffic estimators, review velocity — and say plainly where the real number lands and where the claim
is inflated. Honesty about uncertainty is more valuable to greg than false precision. Every material
claim in the report carries a confidence level and a source.

A second habit: **absence of data is itself data.** A product with 30k claimed users but a website
ranked ~13M globally and no Reddit/Pinterest footprint isn't a mystery — it's telling you the product
is app-store-and-virality-led, not web-led. Read the silence.

## Workflow

### Phase 0 — Resolve identity FIRST (do this before fanning out)

Every downstream research lane needs the same core facts, and if each one re-derives them independently
you waste effort and risk them analyzing different things. So pin these down once, up front, and pass
them into every lane:

- **Real primary domain** (companies squat lookalikes — verify by fetching, don't assume; `superfam.app`
  not `superfam.ai`).
- **App identifiers** — Google Play package id and Apple App Store id (these unlock the best user data).
- **Legal entity + HQ + founding year** (disambiguates from same-named companies).
- **Name-collision check** — search the name and confirm which social handles, Product Hunt launches,
  etc. actually belong to the target. Common startup names collide; an asset that isn't theirs will
  corrupt the analysis. Flag collisions explicitly.

Resolve this inline with a few searches/fetches, then hand the verified facts to the lanes below.

### Phase 1 — Four parallel research lanes

If subagents are available, **run these four lanes in parallel** (one focused agent each) — it is faster
and keeps each investigation deep. If not, run them sequentially inline. Seed every lane with the Phase 0
facts so none of them re-resolve identity. Each lane returns a structured brief with source URLs and
per-claim confidence.

Full prompt scaffolding for each lane lives in `references/research-lanes.md` — read it before spawning.
In brief:

1. **Company / product / claims** — identity, founders + pedigree, full funding history, product &
   architecture, business model/pricing, and **the headline user/traction number stress-tested against
   independent data**. This lane owns the "is the 30k real?" question.
2. **Web traffic & analytics** — Similarweb / Semrush / HypeStat estimates: total visits, traffic-source
   split, geography, top keywords, referrers. **Expect thin data for app-first products and read the
   thinness as signal** — pivot the conclusion to app-store intelligence when the web footprint is tiny.
3. **Content / SEO / PR** — owned blog (topics, cadence, is it stalled?), earned media (every article +
   date + outlet), backlinks, founder thought-leadership, and comparison/positioning content. Note
   whether they contest the same keywords beanies targets.
4. **Social / community / app-store / paid** — channel-by-channel presence & activity (Reddit, Pinterest,
   Instagram, Facebook/Meta Ad Library, LinkedIn, X, YouTube/TikTok, regional platforms), **app-store
   metrics as the real user-proxy** (install range, rating count, review themes, ASO investment),
   influencer/referral programs, and evidence of paid spend.

### Phase 2 — Synthesize into the report

Merge the four briefs, resolve any contradictions (e.g. one lane read 30k, another 21k installs — say
which is load-bearing and why), and write the report using the structure below. The synthesis adds two
things the individual lanes can't: the **reverse-engineered "how they got their users," ranked by likely
impact**, and the **beanies comparison + actions**.

### Phase 3 — Save to Notion + summarize in chat

Per project rules, competitive/marketing strategy lives in **Notion, never the repo**. Write the report
to Notion (Launch HQ → Competitive Intel, or ask greg where if there's no obvious home), and deliver a
tight executive summary in the conversation with the headline read + top 3 actions. Do NOT commit the
report to the git repo.

## Report structure

Use this template. Lead with the answer, not the methodology.

```
# <Company> — Competitive Teardown
> Compiled <date> · for beanies.family · confidence noted per claim

## One-line read
<The single most important takeaway — their real GTM in one sentence.>

## Snapshot
- Entity / HQ / founded · Founders + pedigree · Funding · Product · Architecture · Business model

## The headline metric, stress-tested
<Their claimed number, where it came from, independent cross-checks, and the honest verdict.>

## How they got their users (reverse-engineered, ranked)
1. <Biggest driver + evidence>  2. <next> ... — ranked by likely impact, each with the evidence.

## Channel-by-channel
<Each channel: present/absent, activity, numbers, what it tells us. Name the empty ones — they're whitespace.>

## Web & app-store footprint
<Traffic profile + geography + the app-first-vs-web-first read + ASO posture.>

## Content / SEO / PR
<Owned cadence, earned media, keyword overlap with beanies, founder E-E-A-T (or its absence).>

## vs beanies.family
<Side-by-side: positioning, channels, geography, architecture. Where they beat us, where we beat them, where we don't collide.>

## Actions for beanies (prioritized)
**Copy (what's working for them):** ...
**Keep pressing (where we already out-execute):** ...
**Positioning / watch items:** ...
<Each action concrete and doable — a store-listing audit, an invite-flow change, a content lane — not "improve marketing".>

## Sources & confidence
<Grouped links; flag what could NOT be verified.>
```

## What good looks like (lessons baked in from real runs)

- **Rank the acquisition drivers** — don't just list channels, say which one actually moved the numbers.
  For app-first products the answer is often product-led invite virality + ASO, with social as a
  shopfront, not a driver. Greg needs to know where the leverage is.
- **App-store data beats web analytics for app-first competitors.** Install brackets, rating counts, and
  review themes are the closest thing to ground truth on real users and on how users describe finding the
  product. Mine the reviews for positioning language.
- **Cross-check the vanity metric three ways** (self-report vs Play installs vs iOS ratings vs founder's
  own LinkedIn claim — founders often quietly restate "active users" as "downloads"). Report the spread.
- **Whitespace is as actionable as strengths.** The channels a competitor ignores that beanies already
  uses (or could) are low-competition lanes — call them out explicitly.
- **Every action must be doable by greg.** Tie recommendations to beanies' actual surfaces: the store
  listings, the invite/join flow, the beanstalk/guides, Reddit, Pinterest. Reference `references/beanies-context.md`
  so the comparison is grounded in what beanies actually does, not a generic strawman.

## Handling blocked / thin sources

Many high-value sources bot-block automated fetches (Meta Ad Library, Google Play detail pages,
chrome-stats, appbrain) and many estimators have "no data" for small sites. This is normal. Guidance for
working around it — which estimators to try, how to triangulate install counts, when to treat a negative
as "no discoverable footprint" vs "confirmed absent" — is in `references/research-lanes.md` under
"Data-source playbook." The rule: never fabricate a precise number to fill a gap; report the range, name
the tool, and label the confidence. An honest "best-evidence inference from absence" beats a made-up stat.

## Scope

Default depth is the full four-lane teardown. For a quick "just tell me what <app> is and how they grow"
ask, it's fine to run a lighter version (Phase 0 + a single combined pass) and say you did — but any
request framed as a real competitive analysis, "how did they get users," or "should we worry about them"
deserves the full treatment. When unsure, ask greg how deep he wants to go.
