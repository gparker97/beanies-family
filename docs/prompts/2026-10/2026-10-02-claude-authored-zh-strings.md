---
date: 2026-10-02
category: feature
issue: Notion #38
plan: docs/plans/2026-10-02-claude-authored-zh-strings.md
tags: [i18n, translation, simplification, zh]
---

# Claude-authored Chinese UI strings; retire the MyMemory pipeline (#38)

## Prompts

**2026-10-02 ~06:50 SGT** (after `/good-morning` + tracker close-out):

> Ok - rather than 117 - i'm thinking about issue #38 - the original idea was to migrate from mymemory to qwen and run all translations through tinfoil. However does that make sense? I feel like the easiest solution is that we just run all migrations through claude (yourself) with an appropriate model when we create the UI strings, since you are creating them anyway, and you almost always end up fixing them. i'm not sure why this approach wasn't considered before so maybe i'm missing something, but can you analyze the approach of using claude to run all translations when the UI string is created or changed (plus a one time sweep of all strings) vs sending them to tinfoil or another AI service? i suppose tinfoil may be cheaper, but that depoends on the model used and several other factors. but certainly, just using claude here seems simpler than building a pipeline that sends i strings through our lamdbda to tinfoil. simplifying the codebase is always a good thing, and removing the weekly translation script, etc. what are your thoughts?

Analysis given: Claude-at-authoring-time wins on context, precedent (the beanie overlay), a CI gate being stronger than a nightly fill, net code deletion (~700 lines + a workflow + the client runtime fallback), and privacy. Tinfoil/API pipeline only worth it with many languages or non-Claude authors. Design choice: zh inline in uiStrings.ts plus a build-time extract to keep zh.json and the runtime loader unchanged.

**2026-10-02 ~07:00 SGT**:

> agree. go ahead to rewrite this row and take it through /beanies-plan, once done go ahead to implement with /beanies-build-auto and run the one-time sweep across all chinese. Let's ensure the chinese is correct and readable for chinese speakers. any questions please ask me now as i will be away momentarily

Assumptions stated and accepted ("agree"): zh inline + prebuild extract; MyMemory removed end to end including the client fallback; sweep is a fresh rewrite on Opus with a review pass, Simplified only; no deploy.

## Outcome

Built, reviewed twice and verified the same day via `/beanies-build-auto`; not committed, not deployed. Full record in the plan's Outcome section. Headline: all 5,764 Chinese values rewritten by 24 Opus batches plus a fresh-eyes review (1,331-key sample, 3.9% defect rate, 93 corrections); MyMemory removed end to end including a `deploy.yml` step the plan passes caught; `zh.ts` is a typed sibling module loaded as a 114 KB (gzip) lazy chunk; `npm run validate` green; browser-verified in dev and the production preview. Design deviation from the morning discussion: typed sibling module instead of inline values plus an extract script, recorded in the plan.
