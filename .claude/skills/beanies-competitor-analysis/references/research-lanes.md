# Research lanes — prompt scaffolds & data-source playbook

Read this before Phase 1. Each lane below is a ready-to-adapt subagent prompt. Fill in `<TARGET>`, the
verified domain, and the Play/App-Store ids from Phase 0. Tell every lane: **return a structured brief
with source URLs and a per-claim confidence level, be explicit about what could NOT be verified, and your
final message IS the brief.**

If subagents aren't available, work these four lanes yourself sequentially — the structure still holds.

---

## Lane 1 — Company / product / claims

> Research <TARGET> (<one-line what-they-do>, domain <domain>). Focus: company + product + user-base
> verification. Deliver: (1) legal entity, HQ, founding year; (2) founders + their pedigree (ex-which
> companies — is this their first venture in this space?); (3) full funding history — every round, amount,
> investors, dates; (4) product — what it does, platforms, pricing/business model, and any
> architecture/privacy claims (and whether those are audited or just marketing); (5) THE KEY QUESTION —
> stress-test their headline user/traction number: where did it originate (own PR? press echo?), what unit
> is it (users vs families vs downloads — do sources disagree?), and cross-check it against Google Play
> install brackets and Apple rating counts. Verdict: is the number credible, and as what? (6) growth
> timeline + any stated milestones. Search the company name, founder names, and the relevant startup press
> for the target's geography (for India: Inc42, YourStory, Entrackr, Tracxn, Moneycontrol; for US/EU:
> TechCrunch, Crunchbase, PitchBook). Report confidence per claim.

## Lane 2 — Web traffic & analytics

> Investigate the web-traffic profile of <TARGET> (domain <domain>). Pull public analytics estimates:
> Similarweb (total monthly visits, traffic-source split direct/organic/paid/social/referral/mail/display,
> top countries, trend, engagement metrics), plus Semrush/HypeStat/other estimators as cross-checks. Report
> top organic keywords (are they branded-only, or is there a real non-brand SEO engine?), top referrers,
> and the social-traffic split if exposed. IMPORTANT: early-stage / app-first products often show "not
> enough data" — if so, SAY SO and explain what that implies (app-led vs web-led distribution). Do not
> fabricate precise numbers; report ranges, name the tool, label confidence. Deliver a coverage/confidence
> table and a bottom-line read on whether this is a web-led or app-led product.

## Lane 3 — Content / SEO / PR

> Investigate the content-marketing, SEO, and earned-media strategy of <TARGET> (domain <domain>). Deliver:
> (1) owned blog/content hub — topics, cadence (steady vs launch-burst vs stalled), SEO angle, and whether
> they target the same keywords beanies does; (2) earned media — every article/mention with outlet +
> headline + date + URL, and note whether coverage is all one funding beat or sustained; (3) backlink /
> mention footprint (Product Hunt launch? directories? "best family apps" listicles?); (4) founder-led
> thought-leadership (LinkedIn/Medium/X/podcasts/YouTube) — or its absence; (5) comparison/positioning
> content (do they publish "X vs Y" posts? against whom?); (6) overall SEO posture — is organic search an
> engine or just a seeded foundation? Distinguish OWNED vs EARNED vs launch-platform content. Flag name
> collisions (assets that belong to a same-named company). Report confidence per claim.

## Lane 4 — Social / community / app-store / paid

> Investigate the acquisition channels of <TARGET> (domain <domain>; Play <pkg>; App Store <id>). For EACH
> channel report present/absent + activity + follower/engagement numbers + what they post: Reddit (which
> subreddits, organic vs self-promo), Pinterest, Facebook + Meta Ad Library (any paid creatives?),
> Instagram, LinkedIn (company + founders), X, YouTube/TikTok, and any regional platforms relevant to their
> market. Then app stores as the real user-proxy: Google Play install range + rating count + review themes;
> Apple rating count + review themes (mine reviews for how users describe finding + using the app and for
> positioning language); ASO investment signs (keyworded listing, locale variants, install-link domain).
> Also: influencer/creator collaborations, referral/invite-reward programs, and any evidence of paid ads.
> Then reverse-engineer, ranked: how did they most likely get users onboard? Be explicit about channels
> where you found nothing, and distinguish "confirmed absent" from "no discoverable footprint / bot-blocked".

---

## Data-source playbook

**User counts (best → weakest):** third-party install estimators (chrome-stats, AppBrain, Sensor Tower /
data.ai if accessible) → Google Play install bracket ("10,000+"/"50,000+") → Apple rating count as a
floor (ratings are a small fraction of installs) → founder LinkedIn self-claims → company PR. Triangulate;
report the spread rather than one number.

**Known bot-blockers** (expect 403 / hang on direct fetch): Meta Ad Library, Google Play detail pages,
chrome-stats, AppBrain, LinkedIn company pages. Workarounds: try WebSearch snippets instead of WebFetch;
read the estimator's summary via search results; use the founder's own public posts as a cross-check; and
when a source is genuinely unreadable, say "could not verify directly" rather than guessing.

**Traffic estimators:** Similarweb is the default; it often withholds absolute visits below a threshold but
still exposes rank, geography split, source *ranking*, and top keywords. HypeStat/Semrush are cross-checks
(both frequently have "no record" for small domains — that itself is signal). A domain nobody tracks is an
app-first product; pivot to app-store intelligence.

**Name collisions:** startup names collide constantly (a family app and an unrelated creator-payments tool
both called "SuperFam"). Before attributing any handle, Product Hunt launch, or review to the target,
confirm it's actually theirs. A misattributed asset poisons the whole analysis.

**Geography:** check locale variants on the store listing (en_US/en_IN/en_GB) and the Similarweb country
split — they reveal whether a nominally-local competitor is eyeing beanies' Western market.
