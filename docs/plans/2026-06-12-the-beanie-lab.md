# Plan: The Beanie Lab — hidden per-device experimental-features section

> Date: 2026-06-12
> Related issues: None — direct implementation (gates #32 Google Calendar sync + #34 clash nudge + #133 beanies AI behind an opt-in)
> Plan file: `docs/plans/2026-06-12-the-beanie-lab.md`
> Design locked: `docs/mockups/settings-beta-features-2026-06-12.html`. Built through the beanies-plan 4-pass discipline.
>
> **No GitHub issue created.** This plan was approved for direct implementation. Full prompt history is embedded under **Prompt Log** below.

## User Story

As a beanies.family user who's curious about new features, I want an opt-in "Beanie Lab" in Settings so I can try in-development features (Google Calendar sync, beanies AI) on my own device, while everyone else sees a calm, unchanged app — and the maintainer can let a handful of early adopters test before public launch.

## Context

greg wants to test Google Calendar sync (built, prod-off behind `googleCalendarSync`/`calendarClashNudge`) and beanies AI (#133, soft-launched and currently always-visible) himself and with 1–2 early adopters during Google OAuth verification — without a public launch. Rather than flip prod flags fully on, we add a **per-device opt-in**: a quiet, collapsed "The Beanie Lab" disclosure at the bottom of Settings. Off by default, it reveals the two features (each tagged _Testing_) only for users who switch it on. Everyone else sees a calm, unchanged app.

## Requirements

1. Always-present, quiet, collapsed disclosure row at the bottom of Settings (below Quick Toggles, above the dev-only Flags card / About footer) titled "The Beanie Lab" with an animated beaker glyph (animates only when expanded; static when collapsed).
2. Expanding reveals: the warm blurb, a master toggle "Enable experimental features" (per-device, **OFF by default**), and — when ON — the Google Calendar and beanies AI cards (reusing `SettingsCard`), each with a _Testing_ tag. When OFF, an empty-state line.
3. The master toggle persists **per-device** (in `GlobalSettings`, like dark/beanie/sound), NOT family-synced.
4. Move the beanies AI card and Google Calendar card **out of the main settings grid** into the Lab section. They no longer appear in the grid for anyone.
5. Tapping a Lab card opens its existing drawer (`AiSettings` / `CalendarSyncSettings`) unchanged.
6. The AI/Calendar drawers and their deep-links (`?open=ai`, `?open=calendar-sync`) must no-op when the Lab is disabled.
7. Flip committed flags `googleCalendarSync: true` and `calendarClashNudge: true` (alive in the build; visibility now governed by the Lab opt-in + flag).
8. Respect `prefers-reduced-motion` (no beaker animation).
9. All new copy via i18n (en + beanie; zh regenerated with `npm run translate`).

## Approach

### 1. Single source of truth — `src/composables/useBeanieLab.ts` (new)

```ts
export function useBeanieLab() {
  const settingsStore = useSettingsStore();
  const labEnabled = computed(() => settingsStore.beanieLabEnabled);
  const aiVisible = computed(() => labEnabled.value);
  const calendarVisible = computed(() => labEnabled.value && isFlagEnabled('googleCalendarSync'));
  return { labEnabled, aiVisible, calendarVisible };
}
```

The single `isFlagEnabled` read lives here. Consumed by both SettingsPage (drawer/deep-link guards) and BeanieLabSection (the `labFeatures` visibility) so the two cannot drift.

### 2. Per-device persisted setting — `settingsStore` + `GlobalSettings`

- `GlobalSettings.beanieLabEnabled?: boolean` (`src/types/models.ts`) — device-level.
- Getter: `beanieLabEnabled = computed(() => globalSettings.value.beanieLabEnabled ?? false)`.
- **New helper `persistGlobalSetting<K>(label, key, value)`** mirroring `persistDualSetting`/`persistAiSetting`: `isLoading=true` + `error=null` on entry; on failure `showToast('error', t('settings.persistFailed'), t(label), { error, surface, context })` + `console.error('[settingsStore] …')` + **re-throw**; cast `{ [key]: value } as Partial<GlobalSettings>`. Deliberately NOT the silent `setSoundEnabled`/`setBeanieMode` pattern (those swallow into `error.value`). Then `setBeanieLabEnabled = (v) => persistGlobalSetting('settings.beanieLab.title', 'beanieLabEnabled', v)`. Export both.
- _(Optional, deferred — out of scope unless greg opts in:)_ re-point `setSoundEnabled`/`setBeanieMode` at the helper to retire their silent failures, but only with their call-site handlers updated to consume the new re-throw.

### 3. New component — `src/components/settings/BeanieLabSection.vue`

Always rendered by SettingsPage. Reuses existing primitives — no new disclosure/reveal/badge markup:

- Local `expanded` ref (collapsed by default). Accessible `<button aria-expanded :aria-controls>` header.
- Inline animated beaker SVG (from the mockup); animation class bound to `expanded && !prefersReducedMotion` via `useReducedMotion()`.
- Body in `<SmoothHeight :revision="expanded">` (revision driven **only** by `expanded`; it rests at `height:auto` and naturally follows the inner reveal — don't also drive it off `labEnabled`).
- Master `SettingToggleRow`; its `@update:model-value` **awaits `setBeanieLabEnabled` in try/catch** so the store's re-throw is consumed (no unhandled rejection).
- Cards reveal in `<ConditionalSection :show="labEnabled">` (existing dashed-divider collapse).
- Declarative flat `labFeatures` array `{ key, icon, titleKey, descKey, visible, event }` — calendar→`calendarVisible`, ai→`aiVisible`. `v-for` renders only `visible` entries; empty-state line when none. A future lab feature = one array entry.
- Cards use `SettingsCard` + its `#badge` slot with `<BetaBadge label="settings.beanieLab.testingTag" />`.
- Emits `open-ai` / `open-calendar` (drawer state stays in SettingsPage).

### 4. Generalize `src/components/ui/BetaBadge.vue`

Add optional `label?: UIStringKey` prop (default `'common.beta'`), resolved through the badge's existing `t()`. Pass a translation **key**, not a resolved string, to keep i18n/beanie/zh reactivity inside the badge.

### 5. `src/pages/SettingsPage.vue` wiring

- Remove the beanies AI card (≈681–690) and Google Calendar card (≈691–698) from the grid.
- Mount `<BeanieLabSection @open-ai="showAi = true" @open-calendar="showCalendarSync = true" />` between Quick Toggles and the dev-only Flags card.
- Replace `aiSurfaceEnabled = true` / `calendarSyncEnabled` consts (and stale comments ~105–110) with `const { aiVisible, calendarVisible } = useBeanieLab();`. **These are reactive computeds — every script read becomes `.value`** (`cardOpenMap.ai`: `if (aiVisible.value) showAi.value = true`); templates auto-unwrap. Drawer mounts: `<AiSettings v-if="aiVisible">`, `<CalendarSyncSettings v-if="calendarVisible">`.
- Deep-links: add a guarded `'calendar-sync'` entry (parity with `ai`). Both guards read the same composable.
- **Verify (don't speculate):** confirm `globalSettings` is hydrated before the Settings route renders (same source dark/beanie mode read on first paint); only add handling if a real gap is found.

### 6. Flags + help gate

- `src/config/featureFlags.committed.ts` → `googleCalendarSync: true`, `calendarClashNudge: true` (kill-switches retained).
- `src/content/help/security.ts` → `CLASH_NUDGE_HELP_LIVE = true` so testers' "What's this?" link resolves. **First verify** the article is excluded from the Astro sitemap or can carry `noindex`; if not, fall back to hiding the "What's this?" link on the same flag.

### 7. i18n

New `settings.beanieLab.*`: `title` ("The Beanie Lab" / "the beanie lab"), `blurb`, `enableLabel`, `enableHint`, `testingTag` ("Testing"), `empty`. Reuse `settings.card.ai/aiDesc/calendarSync/calendarSyncDesc` + `settings.persistFailed`. Regenerate `public/translations/zh.json` via `npm run translate`.

## Files Affected

- **New:** `src/composables/useBeanieLab.ts`, `src/components/settings/BeanieLabSection.vue`
- **Edit:** `src/pages/SettingsPage.vue`, `src/components/ui/BetaBadge.vue`, `src/stores/settingsStore.ts`, `src/types/models.ts`, `src/config/featureFlags.committed.ts`, `src/content/help/security.ts`, `src/services/translation/uiStrings.ts` (+ `public/translations/zh.json` via `npm run translate`)
- **Tests:** `settingsStore` spec, `useBeanieLab.spec.ts`, `BeanieLabSection.spec.ts`, deep-link guard

## Help Center Coverage

None. The Lab is an intentionally quiet, unannounced opt-in wrapper; its contents (Calendar, AI) have/will have their own articles. The in-product blurb suffices; a dedicated Beanie Lab article would contradict its hidden purpose.

## Acceptance Criteria

- [ ] Quiet, collapsed "The Beanie Lab" row at the bottom of Settings for all users; beaker static when collapsed.
- [ ] Expanding animates beaker (unless reduced-motion) + body height; shows blurb + master toggle (OFF by default).
- [ ] Toggle ON reveals Calendar + AI cards via ConditionalSection (Calendar only if its flag is on), each _Testing_-tagged; tap opens the correct drawer.
- [ ] Toggle persists per-device, survives reload, does NOT sync to other family devices.
- [ ] AI + Calendar cards gone from the main grid; deep-links no-op when Lab off.
- [ ] Card visibility + drawer/deep-link guards derive from the SAME `useBeanieLab` computeds; all SettingsPage script reads use `.value`.
- [ ] Save failure → toast + console error + re-throw (no silent revert); `persistGlobalSetting` resets `isLoading` and clears `error` on entry; toggle handler consumes the re-throw.
- [ ] No new disclosure/badge/reveal markup duplicates an existing primitive; SmoothHeight `:revision` is `expanded`-only.
- [ ] `npm run validate` green; new + existing tests pass.

## Testing Plan

1. Unit (store): default false; `setBeanieLabEnabled(true)` persists; failure path toasts + leaves state unchanged + re-throws + resets `isLoading`.
2. Unit (composable): `aiVisible` follows the toggle; `calendarVisible` needs toggle AND `isFlagEnabled('googleCalendarSync')` (stub both ways).
3. Component: collapsed default; expand toggles `aria-expanded` + animation class; OFF→empty state, ConditionalSection hidden; ON→cards (calendar gated by flag stub); emits open events; reduced-motion → no animation class; toggle handler swallows a rejected setter.
4. Guard: `?open=ai`/`?open=calendar-sync` no-op when Lab disabled; open when enabled (+flag for calendar); enabled deep-link opens on cold load.
5. Manual (`npm run dev`, Lab ON): row → expand → enable → cards appear _Testing_-tagged → tap opens drawers; connect calendar → #34 clash nudge + "What's this?" resolves; AI readers work; toggle OFF → both vanish; reload persists; light/dark.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the section, per-device setting, flag flips, declarative lab-features list, tests.
- **Pass 2 (DRY + error handling)**: Mandated reuse of ConditionalSection/SmoothHeight/useReducedMotion/SettingsCard; generalized BetaBadge (`:label`) instead of a new badge; replaced the silent `setSoundEnabled` copy with a non-silent `persistGlobalSetting` helper (toast + console + re-throw); clarified the `?open=calendar-sync` guard and help-gate coupling.
- **Pass 3 (Sustainability)**: Extracted the duplicated gating into the `useBeanieLab` composable (single source of truth); fixed `persistGlobalSetting` to set `isLoading=true` on entry and cast `as Partial<GlobalSettings>`; kept `labFeatures` flat.
- **Pass 4 (Fresh-eyes sweep)**: Reactive-computed swap requires `.value` on all script reads + a deep-link hydration-timing confirmation; SmoothHeight `:revision` must be `expanded`-only; toggle handler must consume the re-throw; BetaBadge takes a translation key.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Context prompt (Option A + verification)

> I'd like to flip the release gate for #34 to live but the main thing pending is the google app verification - the consent screen still shows the scary unverified app message. what i would like to do is flip this on so i can test this function myself (and perhaps with 1-2 early adopters) while we are still in the verification process. what would you suggest as the best way (or a few options) to achieve this? Also can you list the steps i should cover for the google demo video…

### Initial feature prompt

> Ok - let's do A - but can we make an adjustment to the UX? perhaps create a separate, hidden (under an accordian expansion, etc) section that says new feature - still in testing, or something like that? So these should not show up as regular boxes in seeings, but rather in a separate, somewhat hidden testing features section? Perhaps we can add a toggle to turn on beta features in the settings page? And it would be OFF by default. /frontend-design can you propose some options… Let's put BOTH the google calendar and beanies AI settings boxes in there for now.

### Follow-up — placement / scope / hide-AI

> (AskUserQuestion answers) Placement: Quiet disclosure at bottom · Scope: Per-device · Hide AI: Yes, hide AI behind beta.

### Follow-up — naming + UI treatment

> looks good but ratehr than naming it "beta features" (a bit dry) can we name it something like "beanies experimental lab" and give it a little but of an experimental UI treatment, like frankensteign, lightning bolt, etc? And for the description below, something like 'get a sneak peek at some of our latest and greatest features, but keep in mind, they are still in development and may not work as expected (or at all)' -- or something to that effect? a bit warming and more exciting

### Follow-up — name options

> or think of something better than 'beanies experimental lab'? some options
> (chose) i like #1 but let's go with "the beanie lab"

### Follow-up — kick off planning

> kick off /beanies-plan

### Follow-up — help-article decision

> (AskUserQuestion answer) Publish it (flip the gate).

</details>
