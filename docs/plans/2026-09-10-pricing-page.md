# Plan: the pricing page, and every "free for now" pointed at it

> Date: 2026-09-10
> Related issues: None; direct implementation
> Mockup: `docs/mockups/2026-09-10-pricing-page.html` (v4, approved; also https://claude.ai/code/artifact/1cc2a871-831e-4dee-a973-f83acde9e2e2)
> Notion source for the statement: Beanstalk blog DB item #61 "pricing statement"

## Context

The marketing site has never had a pricing page, while nine pages and four blog posts hedge
with "free for now" / "probably not forever" and nowhere to land. A copy sweep found 18 such
hedges, 6 outright contradictions that would be false the day a paid tier exists, one live
public commitment ($1/month forever for the first 10 reviewing families), and one legal clause
(`terms.astro` "provided free of charge") that is out of scope for a marketing change.

## The model (decided in conversation, 2026-09-10)

- **beta**: everything free, no clock. Ends at v1.0.
- **v1.0**: new families get 90 days of everything, AI included, no card. Then free (the
  whole app minus the managed AI helper; bring-your-own-key still works) or subscribe.
- **always**: subscribers fund the free tier. No subscribers, no free tier, no beanies.
- **prices**: USD $9.99/mo, $84.99/yr; SGD S$13/mo, S$110/yr. Positioned ~+20% on the
  family-organiser annual mean ($70.62 ex-Maple, n=7). Currency switcher, extensible.
- **early families**: first 10 who rate + review + tell greg: $1/mo (USD or SGD) forever.
  Everyone else before v1.0: 50% off forever, keyed on pod creation date.

Rejected: an event-count cap (not cost-grounded; unenforceable under the encryption model
without misusing diagnostics telemetry; no market precedent; punishes the most engaged
families). Rejected: trial-only with no free tier (inverts the switching pages' attack on
Cozi's paywall; family apps need slow multi-person adoption; app-store review pattern).

## Approach

1. `web/src/lib/pricing.ts`: one exported `PRICES` table (currency → figures) and the FAQ
   list, so the rendered table, the client switcher and the FAQPage JSON-LD share a source.
2. `web/src/pages/pricing.astro`: port of the approved mockup on `BaseLayout` +
   `switch-page.css` + `.welcome-page`, Caveat imported per-page, every app link tagged
   `data-cta`/`data-cta-loc` for the build guard, page-scoped styles for the new pieces.
3. `web/src/components/TrustBetaFree.astro`: the `🆓 free while beanies is in beta` badge,
   which was the same string in four files, now one component that links to `/pricing`.
4. Nav (desktop + drawer) and Footer gain `pricing`.
5. Hedges get a link; contradictions get reworded (see the sweep in the session log).
6. `terms.astro` untouched; flagged for a legal read.

## Files affected

Created: `web/src/pages/pricing.astro`, `web/src/lib/pricing.ts`,
`web/src/components/TrustBetaFree.astro`.
Modified: `Nav.astro`, `Footer.astro`, `switch-page.css` (trust link style),
`pages/index.astro`, `pages/from/{index,cozi,maple,skylight}.astro`, `pages/help/faq.astro`,
`pages/help/index.astro`, `public/llms.txt`, four `content/blog/*.md` (link only, no prose
changes), `CHANGELOG.md`.

## Verification

`npm run build:web` (runs the CTA guard), screenshots at 1200 and 400, the nav at 930px
(seventh link), the currency switcher in a browser, then `/code-review`.
