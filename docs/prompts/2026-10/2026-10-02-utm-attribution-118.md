---
date: 2026-10-02
category: feature
issue: Notion #118
plan: docs/plans/2026-10-02-utm-attribution-carry-through.md
tags: [analytics, attribution, utm, marketing-site, registry, plausible, slack]
---

# Carry UTM attribution from the marketing site through to the app (#118)

## Prompts

**2026-10-02 ~10:10 SGT** (mid `/good-morning`):

> we've had 4 new joiners since the chatGPT ads starts. let's run /beanies-pre-plan and /beanies-plan on notion #118 and once plan is done move directly to /beanies-build-auto. ask me any questions now

Pre-plan questions answered (AskUserQuestion): first-touch TTL = **30 days**; attribution **is** written to the DynamoDB registry row (privacy table + store declarations get a row); `oppref` is captured and forwarded with the UTMs but **never sent** to OpenAI (Conversions API stays out of scope). Notion row updated (Scope, Out of Scope, Open Questions, prompt, Status = In Progress).

**2026-10-02 ~11:50 SGT**:

> ok let's /end-session here. i'll skip the testing for now and let's capture the results in real world clicks through openAI or plausible

## Outcome

Built in the same session: `/beanies-pre-plan` → `/beanies-plan` (4 passes; Pass 4 caught that "Start over" runs a tier-2 sign-out inside the create flow, so the tag is cleared on tier 3 only) → `/beanies-build-auto` (five parallel implementation streams on one shared module, `@beanies/brand/attribution`). Registry Lambda applied to prod. `npm run validate` green; site build 305 tagged links / 0 untagged; 16 site checks and the app create-flow browser walk pass; survey dark/400px screenshots checked. `/code-review high` twice: round 1 nine findings (eight fixed, one recorded); round 2 scoped to the fixes found regressions from the expiry fix, resolved structurally (sweep on the per-boot call, pure reads) rather than by a third patch. Not committed, not deployed; the manual tests greg owns (iOS redirect hop, one real ad click, `oppref` shape) are in STATUS.
