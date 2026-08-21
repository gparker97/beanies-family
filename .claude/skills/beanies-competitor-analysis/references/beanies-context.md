# beanies.family — our own GTM, for grounded comparison

Use this so the "vs beanies" section compares the target to what beanies *actually* does, not a strawman.
Verify anything time-sensitive against `docs/STATUS.md` and the launch plan in Notion — this file is a
snapshot and can drift.

## Product & architecture
- Local-first family + financial planning PWA. Automerge CRDT is the source of truth; encrypted `.beanpod`
  file is the durable copy; optional encrypted sync to the user's own Google Drive. Web Crypto AES-GCM
  payload encryption. No data on our servers. This privacy-first / local-first / encrypted story is beanies'
  core differentiator — and is exactly the pitch several competitors (e.g. SuperFam) also make, so
  "privacy-first" alone is not a moat; execution + trust + content are.
- Features: family calendar/planner, to-dos, meal planning, accounts/budgets/transactions, assets, goals,
  milestones/scrapbook, care & safety, multi-currency. No live-location feature (a deliberate difference
  from Life360-style competitors).
- Beanie mode (playful cosmetic overlay), Chinese translation, Large reading mode.

## Market & platforms
- Global / Western-first, English-first marketing site. Android **live on Google Play**; iOS in App Store
  review (redirect-OAuth build). PWA at app.beanies.family.
- Business model: currently free; monetization not the focus pre-launch.

## Go-to-market motion (what we lean on)
- **Content / SEO** — the "beanstalk" blog (weekly, personal, greg's voice, syndicates to Substack) +
  evergreen **pillar guides** (hub-and-spoke, AIO-optimized). Targets the "Cozi / Maple alternative /
  family organizer" keyword cluster. greg's first-person E-E-A-T voice is a deliberate authority layer.
- **Reddit** — daily karma-building + opportunistic value-first posting (see the `karma-run` skill).
- **Pinterest** — on-brand pins funnelling to blog/guides (see the `pinterest-post` skill).
- **Pilot outreach** — finding people asking for family/planning apps (`pilot-scout` skill).
- **Discord** — early-adopter community; every feature announcement currently ends with a Discord CTA
  (temporary, until ~100 early adopters).
- **Migration plays** — capturing displaced users from shutting-down competitors (the Maple-shutdown post
  + comparison guides are the template).

## Where we're strong / weak (be honest in the comparison)
- **Strong:** content cadence + freshness, founder voice/E-E-A-T, Reddit + Pinterest presence, genuine
  local-first architecture, breadth of family features beyond one niche.
- **Weaker / underinvested:** ASO (store-listing optimization is not yet a focused motion), paid
  acquisition (none), the in-product family-invite viral loop (works, but not aggressively optimized/
  prompted), app maturity on iOS (still in review), brand awareness / scale (early).

## The recurring lesson from teardowns
App-first family competitors tend to grow on **ASO + product-led family-invite virality**, with content
and social as secondary. beanies over-indexes on content/social and under-indexes on ASO + the invite
loop. That asymmetry is usually where the most actionable recommendations for greg come from — so
scrutinize the target's store presence and invite mechanics closely, and check them against ours.
