---
date: 2026-09-05
category: bug-fix / accessibility / documentation
issue: null
plan: null
tags: [dark-mode, accessibility, contrast, wcag, cig, brand, tokens, sweep]
---

# Dark mode — the surface under the ink

A parallel session was running Tier 2 pod compaction throughout. All work here was kept
off that session's files and committed by explicit path.

## Prompts

**~09:00 — session start**

> /good-morning — note that a parallel session is running related to data compaction

**~10:15 — the report and the ask**

> There still appears to be some issues in dark mode:
>
> On the family scrapbook in the header there is white text on a yellow banner that is
> hard to read
>
> On the recipe view page in the family note section, there is also white text on a
> yellow background that is impossible to read
>
> Please do one more sweep across the entire site to ensure that all surfaces are
> following the new and updated dark mode conventions and that there is not invisible or
> difficult to read text in dark mode
>
> Another claude session notices that the beanies CIG update was only a single line and
> did not give much detail about the new dark mode conventions. can you review the CIG and
> ensure it's fully updated and filled it out in full detail regarding dark mode
> conventions, so all future sessions will always use the decided conventions and we can
> avoid drift across the app for all surfaces in both light and dark mode
>
> [relaying the other session's comments]
>
> > The CIG has not really been updated. The overhaul changed exactly one sentence in it —
> > naming ink/surface-*/line — and says nothing about the -lift accent tokens anywhere.
> > That's precisely the rule that bit me, and it lives only in the SKILL. I didn't edit
> > the CIG because the parallel session is likely still in that file and I'd rather not
> > collide. Say the word and I'll add it.
> >
> > There's a pre-existing backlog of the same defect in 20+ components — RecipeRail,
> > MealPickerSheet, MedicationCard, BudgetSummaryCard, MealPlannerPage and others all have
> > bare text-[#F15D22] with no lift. Natural scope for the parallel session's dark-mode
> > work rather than for #87.
> >
> > I left ChipButton's selected-chip text-primary-500 alone. It's byte-identical to what
> > FrequencyChips has always shipped across 16 call sites and is pinned deliberately by
> > the characterisation test. Restyling sixteen unrelated controls isn't #87's call.
>
> Also update the main instructions in claude.MD as needed to ensure all sessions refer to
> the CIG for style conventions for both light and dark mode and that there is no further
> drift across the app

**mid-session**

> note that i'm running a parallel session so pls be careful to only commit your own changes

**session close**

> /end-session — push only your changes will deploy in another session

**during close**

> fyi the other session appears to have captured ad push your changes

## Outcome

Shipped as `02f49910` (106 files, 965 insertions), on `main`, **not deployed**.

The two reported bugs were the same defect, and it was _created by_ the previous
dark-mode pass rather than missed by it: that pass added `dark:text-ink` to elements whose
background was a hand-painted pastel with no dark partner. Measured at 1.01:1. The same
shape existed in two further places greg had not yet hit (the milestones hero and
`StickyNote`'s three pastel papers).

Beyond the reported bugs: three `html.dark` rules had never once applied (a descendant
combinator swallowed into a `:not()`, making the selector invalid); the onboarding suite's
`opacity`-dimmed text composited to ~1.4:1 in dark; ~120 accent sites gained their `-lift`
partner; and `--color-silk-lift` / `--color-teal-lift` were added because Sky Silk, one of
the five brand colours, had no lift and blue accents were being hand-rolled as one-off
hexes.

A contrast figure asserted from memory (3.61) turned out to be wrong (5.08) and was
corrected in all three documents. The real finding was more useful than the invented one.

The CIG gained two full slides and had its drifted nav rebuilt; CLAUDE.md and the theme
skill now name it as the authority for both modes.

Full detail in `docs/STATUS.md` (2026-09-05 block) and `docs/lessons.md` (top entry).

**Owed:** visual verification in a browser — none of this is confirmed by eye.
