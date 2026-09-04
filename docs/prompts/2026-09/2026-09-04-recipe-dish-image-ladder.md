---
date: 2026-09-04
category: bugfix
issue: 'Notion tracker #86 (siblings #87, #88)'
plan: 'docs/plans/2026-09-04-recipe-dish-image-ladder.md'
tags: [recipes, cookbook, magic-beans, content-fetch, telemetry, ai, early-adopter-feedback]
---

# Recipe dish-image ladder (#86)

Origin: feedback from an early adopter who joined 2026-09-04 after searching for an
open-source Maple alternative, and reported three recipe issues on Discord. The feedback was
split into three tracker rows — #86 (dish photos), #87 (course/tags/meal grouping), #88
(shopping list from a recipe) — and #86 was taken forward first.

## Prompts

### 09:xx — the early adopter's feedback, relayed verbatim by greg

> Hey, could you perhaps have it so that when you pull a recipe from a website, it pulls a
> picture from the website of the recipe and uses that? Edit: Okay, so it does this, but it
> seems very hit and miss. Perhaps see about improving this feature?
>
> Also, add categories for the recipe section, would be nice. And the ability to group them
> by meal (breakfast, lunch, dinner, brunch, snack)

greg added:

> The user has asked for improvements to how recipes work - regarding photos, he noted that
> in some cases he shared URLs where there were plenty of photos in the link, but none of
> them were found or added to the recipe.
>
> The first objective here would be to see how we can improve how images/pictures are
> captures when a new recipe is added. the goal should be the every recipe, as much as
> possible, has a picture. the user can always change it later, but it starts with a
> (relevant) image. the image should be verified by AI to ensure it is relevant and not
> unrelated to the recipe (and of course not offensive, obscene, etc). can you propose how
> we can improve this?
>
> the rest of the ask is more straightforward - recipe categories, sort or group by meal,
> and for these, add the ability to sort/group on the recipe homepage as well (to sort or
> view by meal, category, etc)
>
> One additional thing a user has raised (which may be better to address in a separate
> issue) is the ability for a recipe to generate it's own shopping list - perhaps the user
> can trigger a new list from the recipe or something to that effect, and it could also be
> validarted or created by AI. what do you think we could do here?

### 09:xx — scoping decisions

Asked and answered:

- **Issue split** → three issues (image capture / categories + grouping / shopping list).
- **Image fallback when nothing is usable** → a generated beanie illustration, deterministic
  per recipe. Explicitly NOT an AI-generated food image, NOT a blank card.
- **Image hosting** → unchanged from today (fetched server-side, re-hosted in the family's
  own photo store).

### 09:xx — categories decisions

> 1. let's not add brunch for now. we could maybe make this an options later
> 2. for the category, i think both is the right answer - add a dropdown for course (main,
>    side, dessert, drink, etc) and then also add free form tags, which can then be displayed
>    or sorted on in the view

Plus the build order:

> once the issues have been created let's start first with the photo fixes then move onto
> categories and meal grouping

### 09:xx — issue creation

> yes, create all three

Created as Notion tracker #86 (Bug, High), #87 (Feature, High, mockup requested), #88
(Feature, Normal).

### 09:xx — pre-plan for #86

> let's start with #86. once the pre-plan is done move onto /beanies-plan and prepare the plan

Pre-plan resolved three things:

- **AI budget** → a family over its hourly budget skips the scraped-image check entirely and
  falls back to the placeholder; the capture never blocks on the image.
- **Sequencing** → ONE release, telemetry and fixes together. Consequence recorded: there is
  no measured pre-change baseline, so the fix is judged on the absolute post-fix hit rate and
  the per-rung distribution, not a before/after delta.
- **Fallback art** → deterministic variation per recipe id.

### 09:xx — planning

> go ahead to /beanies-plan

### 09:xx — attribution correction (AI validation)

greg corrected a misattribution I had repeated several times:

> btw note that the user didn't ask for the AI validation of photos. he just wants photos to be
> captured more completely. the AI validation was my idea, and we can come back to it later if needed

Recorded because it changes how the deferred follow-on should be prioritised: the in-body `<img>`
rung and its `image_relevance` gate answer **no outstanding user request**. The early adopter's
only photo ask was that capture be more reliable.

### 09:xx — the PolaroidImage deviation

Pass 1 found that tracker #86 (and the pre-plan advice that produced it) named the wrong
component for the fallback: `EmptyStateIllustration.vue` is a fixed 160px circular
_page-level_ empty state, while the recipe fallback is a per-item 16/10 fill inside a
polaroid frame — and `PolaroidImage.vue` **already renders** an on-brand terracotta
kraft-paper placeholder for photo-less recipes. Only the per-recipe variation was missing.

Raised for approval rather than switched silently. greg:

> agreed, use PolaroidImage - continue with the passes

## Outcome

_To be completed once the plan is approved and implemented._

Key findings carried into the plan:

1. The same-registrable-domain bound on dish images is a **deliberate security control**
   (documented at both call sites), not an oversight — it is resolved by candidate
   _provenance_ (server-extracted from the fetched page) rather than by deletion, and the
   model stops supplying image URLs entirely since `htmlToText` strips every tag before the
   model ever sees the page.
2. The on-brand fallback placeholder already existed in `PolaroidImage.vue`.
3. The most common image failure — no candidate found at all — was **completely unlogged**,
   which is why the regression was invisible until a user reported it.
