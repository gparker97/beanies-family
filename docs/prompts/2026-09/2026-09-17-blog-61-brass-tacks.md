---
date: 2026-09-17
category: content
issue:
plan:
tags: [blog, beanstalk, pricing, utm, reciprocal-linking, notion, mobile-layout]
---

# Blog #61 "getting down to brass tacks" — review, UTM tagging, reciprocal linking, pricing page fixes

## Prompt 1 — 2026-09-17 (evening session)

> plese check the latest blog entry id #61 - is this ready for release? note that the blog is above
> the horizontal rule. below the horizontal rule is new copy for the pricing page which we would
> release at the same time once htis blog is release.
>
> also please update all links on the blog with the proper urls with UTM links and prepare the plan
> for reciprocal linking for this blog

## Prompt 2 — 2026-09-17

> i've made some updates to the blog, added a paragraph about the free trial, and a discord cta at
> the end. will also update the screenshot once you've updated the pricing page and added a caption
> with pricing.
>
> go ahead to fix the wording in the pricing table 'every world' -> 'every bean' and do ahead with
> the utm links and reciprocal linking plans, amke the updtes as needed on notion
>
> the other thing is that the pricing manifesto section on the pricing page looks quite narrow at
> mobile width, the margins are a bit thick between the edge of the box and the words and for a
> long-ish story, it makes it hard to read. can you adjust the layout on that section (brass tacks)
> so it reads better on mobile?

## Prompt 3 — 2026-09-17

> ok - the $1 offer problem is ok, because if you check you can see the link sits next to the
> comment abotu the app being 50% off, not being $1/mo - the $1/mo thing sits next to a discord link
> to let me know, which is correct. so it should all be ok.
>
> i've added a discord cta now (I had put it in the wrong place)
>
> fixed the typo.
>
> please pull the latest and review once more, and if all is ok, pls commit and push all changes to
> the repo with draft flag turned off (so it's ready to deploy tomorrow)

## Prompt 4 — 2026-09-17

> sorry i'm not able to access the screenshot now, can you take a screenshot of the latest pricing
> and insert it into the blog where my screenshot is? also, please use the beanies pricing hero
> image (with the beanie pulling out his pocket and the dog) as the hero image for this blog

## Outcome

Post staged on `main` with `draft: false`, dated 2026-09-18. **Not deployed** — `deploy-web.yml` is
`workflow_dispatch` only.

**Review.** Two blockers were raised on the first pass; both resolved. (1) The post did not mention
the 90-day trial or that there is no free tier, which is the whole pricing model — greg wrote a new
paragraph covering it. (2) The `/pricing#early` link appeared to promise the $1/mo deal, which was
deliberately retired from the page in `c5870fa4` (2026-09-12). **Greg corrected this reading**: the
link sits immediately after the 50%-off sentence, so "that" refers to the half-price deal, which
`#early` does document; the $1 offer routes to Discord, which is the correct mechanism. No change
needed.

**Links.** 13 links tagged `utm_campaign=getting-down-to-brass-tacks`. Two `http://beanies.family/`
autolinks corrected to `https`. The `#early` link is built **query-before-fragment**
(`?utm…#early`) — params inside the hash never reach Plausible. The github link was repointed at
`docs/SELF_HOSTING.md`, since the sentence promises instructions and the repo root is a code tree.

**Reciprocal loop**, both directions: the post links out on four phrases that were already making
the point (privacy explainer, maple shutdown, local-first pillar, the apps post); the pillar
`local-first-family-finance-planning-tools` lists the slug in `relatedPosts` and links out inline on
"suddenly changing its pricing model" (line 61), which was already the sentence this post answers.
`lastUpdated` bumped to 2026-09-18 so guide and post ship together.

**Pricing page.** "every feature, every world" → "every bean". The brass-tacks letter was running a
**207px / 24-character measure at 375px**: `.whopays` set its own inline padding on top of the
`.wrap` gutter it already contains (40px a side), and the card's 44px inset took most of the rest.
Now 303px / 38 characters; 768px+ byte-identical. **The first attempt silently did nothing** — the
mobile block sits earlier in the sheet than `.handout.letter` at equal specificity, so the base rule
won on source order. Only caught by measuring computed padding, not by looking at a screenshot.

**Images.** The plans shot is captured from the built page (so it carries current prices and the
fixed "every bean" line); the cover composes the pricing mascots onto a 1200x750 brand ground,
because the raw asset is square with alpha and the card frame is 16:10.

**Notion→markdown conversion.** Twelve emphasis runs carried a trailing space inside the markers
(`*hope *it does`), which markdown ships as literal asterisks. The converter moves the space
outside; verified every one renders as a real `<em>`/`<strong>`.

## Gotchas found (worth fixing / remembering)

1. **The skill's image optimizer writes to a gitignored directory.** `.claude/skills/beanies-blog/scripts/optimize-blog-image.mjs`
   has `OUT_DIR = web/public/blog/`, but `.gitignore:93` ignores `/web/public/blog/` — it is build
   output regenerated by `npm run sync-brand-assets`. The tracked source is
   `packages/brand/assets/blog/`. Images written by the script are invisible to git and lost on a
   clean checkout. Caught only because `git status` showed no images staged. **Not yet fixed.**
2. **A stale `node_modules` masquerades as a test failure.** The pre-push hook failed with 18 tests
   failing across 17 AI/enclave/recipe/planner suites. `@tinfoilsh/verifier` and `ehbp` are declared
   in `package.json` (since `855a0809`, #49) but were absent from `node_modules`, so
   `vite:import-analysis` could not resolve the dynamic imports in `enclave/seal.ts` and
   `enclave/attestation.ts` and every dependent suite failed to _collect_. `npm install` fixed it
   with **no lockfile change** — which proves the manifest was fine and only the install was stale.
   Distinct from the teardown flake recorded in `4663a85f`; the two want opposite responses (install
   vs retry). Recorded in `docs/STATUS.md`.
3. **Port 4321 was held by an SSH tunnel**; Astro silently moved to 4322 while 4321 still answered
   200 with a stale site from another machine. Known trap — verify the port from the dev-server log,
   never assume.
