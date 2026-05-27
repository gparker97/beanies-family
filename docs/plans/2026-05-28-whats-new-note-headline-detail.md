# Plan: What's-new note — headline + detail blocks (beanstalk list)

> Date: 2026-05-28
> Related: in-app notifications (#233), per-deploy release notes (`f81d920`), celebratory what's-new (`92d1934`)
> Mockup: `docs/mockups/whats-new-note-headline-detail-2026-05-28.html` (`/frontend-design`; greg picked **Treatment B · beanstalk list**)

## Context

The shipped what's-new note renders a per-deploy note as one run-on centred paragraph
(`WhatsNewBody.vue` `isBrief` path). greg wants per-deploy notes to follow the proven
WhatsNewModal pattern — a **short bold headline + concise beanie-voice detail below** — as the
**general rule**, and to support **more than one new thing per deploy**. Update yesterday's
`2026.05.27` note to the new shape.

## Key finding — no new data model

`ReleaseNote` already carries the exact shape: `features[]` = `{ title, description, icon?, tryItRoute? }`
(headline + detail blocks) plus a one-line `summary` (the bell-row title). Curated monthly releases
already use `features`; per-deploy notes just haven't. So the change is: per-deploy spotlight notes
populate `features[]`, and the detail body gets the beanstalk-list treatment instead of flat cards /
a run-on paragraph. `summary` stays the at-a-glance row line.

## Approach

1. **`WhatsNewBody.vue` — body content region only** (hero, Pod, sign-off, footer unchanged):
   - Derive `blocks = release.features ?? []`.
   - `blocks.length === 0` → keep the centred `summary` paragraph as the **fallback** (legacy /
     minor summary-only notes).
   - `blocks.length === 1` → **single** style: centred, optional lead emoji (`feature.icon`), bold
     Outfit headline (`title`), Inter detail (`description`), optional centred `try it →`.
   - `blocks.length >= 2` → **beanstalk** style: a soft orange→terracotta gradient stalk with a
     bean node per block; left-aligned headline + detail (+ optional `try it →`).
   - Keep the existing "also fixed" list after the blocks (curated releases).
   - Hero kick gains ` · {n} updates` when `blocks.length >= 2` (new i18n key).
   - rem-based font sizes only; dark-mode overrides for headline/detail + the node's white halo.

2. **`src/content/release-notes/deploys.ts`** — rewrite the `2026.05.27` entry:
   - `summary` → short row one-liner ("notifications are here!" + a few words).
   - add `features: [{ title, description, icon: '🔔' }]` (single block; headline + reason).
   - update the in-file template comment to show the per-deploy `features` shape.
   - **Copy authored in greg's voice → flag for his approval before commit** (no em-dashes).

3. **`scripts/deploy/release-note-guide.md`** — make headline + detail the general rule:
   - Significant per-deploy note = `summary` (row one-liner) + `features[]` (1..N headline+detail
     blocks); each `title` short/bold, `description` concise beanie-voice "what + why", optional
     `icon`/`tryItRoute`. Minor "fixes & improvements" notes stay `summary`-only, no spotlight.

4. **i18n** — add `whatsNew.updateCount` ({n} updates), en + beanie; regenerate zh (`npm run translate`).

5. **Tests** — add `WhatsNewBody.test.ts`: single block → headline + detail; multi → N blocks +
   stalk; summary-only → fallback message; kick count appears only for multi. (`index.test.ts`
   untouched — it uses synthetic notes.)

6. **Validate** — `npm run type-check`, lint, format, unit tests, build. No deploy (greg-gated).

## Files affected

- `src/components/notifications/WhatsNewBody.vue` (rewrite content region + styles)
- `src/content/release-notes/deploys.ts` (2026.05.27 entry + template comment)
- `scripts/deploy/release-note-guide.md` (general-rule guidance)
- `src/services/translation/uiStrings.ts` (+ `whatsNew.updateCount`) + zh regen
- `src/components/notifications/__tests__/WhatsNewBody.test.ts` (new)

## Out of scope / unchanged

- The gift-card row (`WhatsNewGiftCard.vue`), hero, Pod, Caveat sign-off, footer.
- `isSpotlightRelease` / `isCelebratoryWhatsNew` (features already imply spotlight).
- No prod deploy this session.
