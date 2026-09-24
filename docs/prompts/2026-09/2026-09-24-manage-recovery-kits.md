---
date: 2026-09-24
category: feature
issue: 'Notion #99'
plan: 'docs/plans/2026-09-24-manage-recovery-kits.md'
tags: [recovery-kit, security, settings, tombstones, envelope, manage-kits]
---

# Manage recovery kits: see every kit on file, invalidate the ones you no longer trust

## Prompt 1 — 2026-09-24 03:40 UTC

> /beanies-pre-plan let's prepare and plan notion #99 so that recovery kits can be viewed and invalidated as required from the UI, once done move to /beanies-plan

## Pre-plan decisions — 2026-09-24 03:55 UTC (AskUserQuestion)

> Last kit: "Block, unless replaced in the same flow". Who can invalidate: "Owner and pod managers" (canManagePod; every member can see the list). Invalidated kits: "Show as invalidated". Mockup: "Two directions to compare" → approved "B: modal from the drawer".

## Prompt 2 — 2026-09-24 05:10 UTC

> proceed to implement with /beanies-build-auto and only pause for a genuine showstopper or blocker issue requiring my decision

## Prompt 3 — 2026-09-24 06:30 UTC

> Since creating Kit allows you to reset pins I think it should only be available for a pod owner or admin

## Prompt 4 — 2026-09-24 07:20 UTC

> Currently, creating a new recovery kit happens immediately after tapping the button with no confirmation. I think we sy9ould have a confirmation modal / information before the kit gets created. Perhaps with info (i.e. You already have 2 recovery kits - confirm to create a recovery kit?) what do you think?

## Prompt 5 — 2026-09-24 07:25 UTC

> go ahead and build it
>
> One other thing, If there are no existing recovery kits, i think we should also highlight the recovery kit in settings when you open the page - i.e. a couple quick flashes and a highlight around the empty recovery kit button, etc. can we do this also?

## Outcome

Built via `/beanies-build-auto` from the four-pass plan. Settings → Security & Recovery now shows a live/invalidated kit summary with **Manage Kits** (a Tier 1 modal listing every kit by its printed ID, with creator and revoker attribution) and the existing Create a New Kit. Invalidation writes a `recoveryKeys:<kitId>` slot tombstone through the #77 machinery, on the 20 s credential budget, behind a red confirm and the PIN step-up; the store's last-kit guard runs on the freshly merged envelope after `observeRemote()`. The only live kit reads Replace and is retired only once the new kit's confirmation is durable. Sign-in names invalidation as a possible cause of a non-matching code when the family has any kit tombstone. Help article updated. Review round 1 (`/code-review high`) added the `recovery_kits_exhausted` merge-time detector (the concurrent two-device race cannot be closed by a per-device guard), an in-flight `busy` state on the list, the `observed` flag on the outcome event, and a store-level test for `revokeRecoveryKit`. Kit creation was then made manager-only (owner or canManagePod) in the store and on both Settings surfaces, per greg's decision; the kit nag and sign-out guard were already manager-only. Not committed or deployed by the build skill. Follow-up: Create a New Kit (drawer and Manage Kits footer) now asks first via the info confirm, leading with the live-kit count; the Replace flow bypasses it (it has its own confirm). With no live kit, the create button gets a two-beat attention pulse (`attention-pulse-twice`, reduced-motion gated) when Security & Recovery opens.
