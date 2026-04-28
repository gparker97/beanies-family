# Plan: setup wizard v2 — tighter copy + native disclosures

> Date: 2026-04-28
> Mockup: `docs/mockups/setup-wizard-v2.html`
> Approved direction; CIG wins on any discrepancy.

## Context

The setup wizard at `/welcome → Create a new pod` runs a 3-step flow in `src/components/login/CreatePodView.vue`. Step 2 carries a 75-word security paragraph that is the largest single block of copy bloat in the onboarding surface. Every step has a subtitle that repeats what its form labels already say. Three disabled coming-soon storage cards (Dropbox / iCloud / OneDrive) take up vertical space advertising things the user can't pick.

Mockup approved at `docs/mockups/setup-wizard-v2.html`. Goal: **drop ~60% of visible text without losing any captured information, hide-and-reveal the security story + coming-soon providers via native `<details>` disclosures, and tighten CTAs to be destination-shaped**. Visual identity, step structure, form data contract, and submit handlers all stay as-is.

## Approach

### 1. i18n changes — `src/services/translation/uiStrings.ts`

All user-visible text goes through the translation system per `CLAUDE.md`. Voice copy on the new disclosure + CTA strings was pre-greenlit by greg (mockup-approved); final pass before commit per the `feedback_voice_review.md` rule.

**Update 7 existing values (en + beanie):**

| Key                           | en                                                    | beanie                            |
| ----------------------------- | ----------------------------------------------------- | --------------------------------- |
| `loginV6.growPodTitle`        | `Start your pod 🌱`                                   | `start your pod 🌱`               |
| `loginV6.signInPasswordHint`  | `8+ characters. Used to sign into your bean profile.` | (lowercase variant)               |
| `loginV6.storageSectionLabel` | `Where should we save it?`                            | (lowercase variant)               |
| `loginV6.addBeansTitle`       | `Add your family 🫘`                                  | `add your family 🫘`              |
| `loginV6.finish`              | `Finish · take me to the nook 🏡`                     | `finish · take me to the nook 🏡` |
| `loginV6.skip`                | `Skip — just me for now`                              | (lowercase variant)               |
| `loginV6.addMember`           | `Add bean`                                            | `add bean`                        |

(`auth.subscribeNewsletter` stays untouched per greg's call — the existing copy is fine.)

**Delete 5 unused keys (no remaining consumers — verified via grep):**

- `loginV6.growPodSubtitle`
- `loginV6.step2Title`
- `loginV6.step2Subtitle`
- `loginV6.storageDescription`
- `loginV6.addBeansSubtitle`

**Add new keys for the disclosures + disabled CTA:**

- `loginV6.howThisWorks.toggle` → `How this works`
- `loginV6.howThisWorks.lead` → `Your data stays yours. beanies.family doesn't run any server or database — your encrypted .beanpod file lives in your own storage.`
- `loginV6.howThisWorks.bullet1` → `AES-256 encryption. Only your password unlocks it.`
- `loginV6.howThisWorks.bullet2` → `No tracking. No analytics on your finances.`
- `loginV6.howThisWorks.bullet3` → `Open source. Audit the code on GitHub anytime.`
- `loginV6.moreProvidersComingSoon` → `More providers coming soon`
- `loginV6.pickStorageToContinue` → `Pick a storage to continue`

After the edits run `npm run translate` to regenerate `public/translations/zh.json`. Per `CLAUDE.md`'s translation-pipeline rule the parser is text-level — verify zero parse errors before commit.

### 2. New helper — `src/utils/date.ts`

`DateOfBirth { month, day, year? }` doesn't have an existing formatter. The mockup's member-tile meta line shows `14 May` (no year, even when present). Add one tiny helper next to the existing `formatDateShort` etc. — DRY, reusable wherever a similar compact birthday format is needed later.

```typescript
/**
 * Format: "14 May" — day + short month, no year.
 * Used in compact list views (e.g. setup wizard member tiles, family
 * roster cards) where the birthday is decoration, not a load-bearing
 * value. Returns an empty string if `dob` is missing or invalid so
 * callers can render `${role}${dob ? ` · ${dob}` : ''}` without a
 * try/catch — graceful degradation, no silent failure (the empty
 * string IS the documented fallback).
 */
export function formatBirthdayShort(dob: DateOfBirth | undefined | null): string {
  if (!dob || !dob.month || !dob.day) return '';
  const idx = dob.month - 1;
  if (idx < 0 || idx >= MONTHS_SHORT.length) return '';
  return `${dob.day} ${MONTHS_SHORT[idx]}`;
}
```

Bounds-check on `month` covers garbage data (e.g. `month: 13`). Empty-string return is the documented fallback — matches the no-silent-failures rule (caller has a clear "if (s)" path; nothing is hidden, nothing throws).

### 3. Template surgery — `src/components/login/CreatePodView.vue`

Three discrete template blocks change. Script logic untouched except for one new import.

**Imports add:**

```typescript
import { formatBirthdayShort } from '@/utils/date';
```

**Step 1 (template block ~458–542):**

- Delete the `<p class="mb-6 …">{{ t('loginV6.growPodSubtitle') }}</p>` subtitle line
- The title (`loginV6.growPodTitle`) renders the new "Start your pod 🌱" via the i18n value change — no template-side change

**Step 2 (template block ~544–786) — biggest diff:**

- Delete the existing two-line title block (`<h2>{{ t('loginV6.step2Title') }}</h2>` + `<p>{{ t('loginV6.step2Subtitle') }}</p>`)
- Inside the storage section box: delete the section label `<div>{{ t('loginV6.storageSectionLabel') }}</div>` + the 75-word `<p>{{ t('loginV6.storageDescription') }}</p>`
- Replace with **a single `<h2>` rendering `loginV6.storageSectionLabel`** (now serves as the only heading)
- Functional storage cards (Google Drive + Local) — keep verbatim
- **Replace the 3-card coming-soon grid** (existing `<div class="mt-2 grid grid-cols-3 gap-2">…`) with a `<details>` disclosure containing a compact 3-chip row (each chip ~28px tall vs current ~72px tall card)
- **Add a `<details>` disclosure above coming-soon: "How this works"** — body has the lead `<p>` + 3 strong-prefixed bullets

  Both disclosures use the existing brand pattern from `InviteWizardModal.vue:370-385` (the child-hint disclosure):

  ```html
  <details class="group">
    <summary
      class="font-outfit text-secondary-500/70 hover:text-primary-500 inline-flex cursor-pointer list-none items-center gap-1.5 px-1 py-2 text-xs font-semibold transition-colors"
    >
      <span
        class="text-primary-500 text-[10px] transition-transform group-open:rotate-90"
        aria-hidden="true"
        >▸</span
      >
      <span>{{ t('loginV6.howThisWorks.toggle') }}</span>
    </summary>
    <div class="text-secondary-500/70 pb-2 pl-4 text-sm leading-relaxed">
      <p class="mb-2">
        <strong>Your data stays yours.</strong> {{ t('loginV6.howThisWorks.lead') }}
      </p>
      <ul class="list-disc space-y-1 pl-4">
        <li>{{ t('loginV6.howThisWorks.bullet1') }}</li>
        <li>{{ t('loginV6.howThisWorks.bullet2') }}</li>
        <li>{{ t('loginV6.howThisWorks.bullet3') }}</li>
      </ul>
    </div>
  </details>
  ```

- The CTA `<BaseButton>` text becomes a template ternary (no new computed needed):

  ```html
  <BaseButton :disabled="!storageSaved" @click="handleStep2Next">
    {{ storageSaved ? t('loginV6.createNext') : t('loginV6.pickStorageToContinue') }}
  </BaseButton>
  ```

  Existing `:disabled` binding unchanged. The label change communicates intent on the disabled state instead of a generic dimmed "Next" that looks active.

**Step 3 (template block ~788–991):**

- Delete the `<p>{{ t('loginV6.addBeansSubtitle') }}</p>` subtitle
- Update the member-tile meta line — currently renders just role. Add birthday inline:

  ```html
  <p class="text-xs text-gray-500 dark:text-gray-400">
    {{ member.ageGroup === 'child' ? '🌱 ' + t('loginV6.littleBean') : '🫘 ' +
    t('loginV6.parentBean') }}<template v-if="formatBirthdayShort(member.dateOfBirth)">
      · {{ formatBirthdayShort(member.dateOfBirth) }}</template
    >
  </p>
  ```

- Final CTA + skip button text changes via the i18n value updates above; no template-side change

**Modal frame cream gradient (CIG-conformance discrepancy, scoped to setup wizard only per greg):**

The container that wraps the wizard's modal frame uses `bg-white` today (or similar). Replace with Tailwind arbitrary-value gradient classes:

```html
<!-- Scoped experiment: cream gradient on the setup wizard only. CIG
     defines Cloud White as the primary background; the warmer cream
     here is a localized warmth try, evaluated after live. If this
     spreads to other surfaces, promote `#fffaf3` to a brand token in
     `packages/brand/theme.css` instead of inline-copying. -->
<div class="bg-gradient-to-b from-white to-[#fffaf3] …"></div>
```

Zero new CSS, zero touches to `packages/brand/theme.css` or `web/src/styles/global.css`. The cream tint is one inline arbitrary-value reference with a comment guarding against accidental copy-spread. If we later drop the experiment, the change is one grep for the hex literal.

### 4. e2e test fix — `e2e/specs/setup-flow.spec.ts`

Line 19's regex selector breaks when "Add Member" → "Add bean":

```typescript
// before
const addButton = page.getByRole('button', { name: /add member/i });
// after
const addButton = page.getByRole('button', { name: ui('loginV6.addMember') });
```

`ui()` is already imported from `../helpers/ui-strings` at the top of the file. One-line change. The pattern matches line 44 (`ui('loginV6.finish')`) so it's the established convention.

## DRY audit — what was checked, what was kept inline, why

| Candidate                                  | Decision                                                       | Reasoning                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Disclosure component (`<DisclosurePanel>`) | **Inline `<details>` per site.**                               | Three sites already exist (`InviteWizardModal` child-hint + FAQ; new setup wizard disclosures) but with three different visual contexts (inline gray small / full-width FAQ + plus-icon / card-shaped slate). Extraction would need ≥3 variant props (marker, weight, body padding) — net negative. Mark in commit message that the new pattern visually mirrors the child-hint precedent for consistency-by-imitation. |
| Birthday-formatter helper                  | **Extract `formatBirthdayShort(dob)` to `src/utils/date.ts`.** | One-liner, mirrors the existing `formatDate*` family in the same file. Reusable in the family roster card / Meet The Beans page next time someone wants compact birthday display.                                                                                                                                                                                                                                       |
| Disabled-state CTA label computed          | **Inline template ternary; no computed.**                      | One-line conditional on existing reactive `storageSaved`. A computed would be ceremony for a single read site.                                                                                                                                                                                                                                                                                                          |
| Cream gradient (mockup)                    | **Inline Tailwind arbitrary-value classes.**                   | `bg-gradient-to-b from-white to-[#fffaf3]` — no new theme variables, no scoped `<style>` block, no class extraction. Single string in the existing template.                                                                                                                                                                                                                                                            |
| Deprecation of unused i18n keys            | **Delete outright.**                                           | `npm run translate` handles add/remove cleanly. Keeping `@deprecated`-commented keys is bloat with no upside (no translation-history concern — keys aren't being brought back).                                                                                                                                                                                                                                         |

## No-silent-failures pass

| Code path                                                                                             | Risk                                                                 | Mitigation                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `formatBirthdayShort(member.dateOfBirth)` called on a malformed DOB                                   | Could throw or render `NaN undefined`                                | Helper returns `''` for missing/invalid month/day. Template renders the meta line with a clean `<template v-if>` guard. **Documented fallback** — no silent failure: empty string IS the contract, not a hidden error. |
| `t('loginV6.howThisWorks.bullet1')` etc. — translation lookup for new keys before zh.json regenerates | Could render the raw key string                                      | Plan mandates `npm run translate` BEFORE commit. zh.json gets all new keys populated. Fallback to en for any locale missing a key (Vue i18n default).                                                                  |
| `<details>` toggle on iOS Safari — older WebKit's `summary::-webkit-details-marker` quirk             | Could render a default disclosure triangle next to our custom marker | `list-style: none` on summary + `summary::-webkit-details-marker { display: none }` (already used in `InviteWizardModal.vue` — proven pattern).                                                                        |
| Async wizard handlers (`handleStep1Next`, `handleChooseGoogleDriveStorage`, `handleAddMember`, etc.)  | Existing failure surface                                             | **Untouched by this plan.** All existing try/catch + `formError.value = …` patterns preserved. No new failure surface introduced.                                                                                      |

Net: zero new failure paths. One existing fallback documented (the helper's empty-string return).

## Verification

### Tests

- **Unit:** no new logic that needs unit tests beyond `formatBirthdayShort`. Add a tiny test in `src/utils/__tests__/date.test.ts` (file already exists per the project's test-mirror convention) covering: happy path (`{month:5, day:14}` → `"14 May"`), missing input (`undefined` → `""`), garbage month (`{month:13, day:1}` → `""`), missing day (`{month:5}` → `""`).
- **E2E:** `setup-flow.spec.ts` selector fix described above. The full setup walkthrough re-runs unchanged.

### CI gates

```
npm run type-check
npm run lint
npm test -- --run
npx playwright test --project=chromium e2e/specs/setup-flow.spec.ts
```

All four must stay green. Full chromium e2e before commit.

### Manual smoke (only after CI green)

1. `npm run dev`. Sign up fresh → walk all 3 setup steps:
   - Step 1: title reads "Start your pod 🌱". No subtitle. Password hint is one short sentence.
   - Step 2: single heading "Where should we save it?". No 75-word paragraph. Two functional cards. Two `▸` disclosures: "How this works" expands to 3-bullet security explainer; "More providers coming soon" expands to compact chip row. Disabled CTA reads "Pick a storage to continue".
   - Step 3: title "Add your family 🫘". No subtitle. After adding a member with a birthday, the meta line reads e.g. "🫘 Parent bean · 14 May". Final CTA reads "Finish · take me to the nook 🏡".
2. Toggle beanie mode, verify lowercase variants render across all updated strings.
3. Toggle Chinese, verify the new keys render translated content (post-`npm run translate`).
4. Sign up flow finishes successfully → lands on `/nook`.

## Files affected

**Modified:**

- `src/services/translation/uiStrings.ts` — 7 value updates, 5 deletions, 7 new keys
- `src/utils/date.ts` — add `formatBirthdayShort` (~8 lines including doc-block)
- `src/utils/__tests__/date.test.ts` — add 4 unit tests for `formatBirthdayShort`
- `src/components/login/CreatePodView.vue` — 1 import + 3 template-block edits + Tailwind gradient on the modal-frame container
- `e2e/specs/setup-flow.spec.ts` — 1-line selector fix
- `public/translations/zh.json` — auto-regenerated via `npm run translate`

**Read-only references:**

- `src/components/family/InviteWizardModal.vue:370-385` — disclosure pattern to mirror
- `src/utils/date.ts` — `MONTHS_SHORT` constant + existing format-helper family
- `.claude/skills/beanies-theme/SKILL.md` — typography + color reference (CIG)

## Risks

| Risk                                                                                          | Mitigation                                                                                                                                        |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Translation pipeline regeneration corrupts zh.json on the new nested keys                     | Existing `inviteWizard.step1.faq.q1` etc. already use nested dot keys. Verify zero parse errors during `npm run translate`.                       |
| Beanie mode + emoji + em-dash combo looks broken in `loginV6.skip` ("skip — just me for now") | Tested in mockup. Em-dash + lowercase reads cleanly. Emoji unaffected by case.                                                                    |
| Cream gradient on the modal frame disagrees with the rest of the app's Cloud-White convention | Scoped to one container in one file (one inline Tailwind class). Decision noted as "setup-wizard-only experiment, evaluate after live."           |
| `formatBirthdayShort` adopted into other components later with different requirements         | Helper is a one-liner with documented fallback; trivially extensible (add a `withYear` flag if a future caller wants year). Out of scope now.     |
| The "Add Member" → "Add bean" rename confuses returning users                                 | First-setup surface only. Existing users have already completed setup and will never see this surface again. New users have no prior expectation. |

## Out of scope

- Onboarding wizard rewrite — separate plan after this lands. The invite-family-members-with-emails feature greg described will land there per the prior conversation.
- Brand-theme CSS edits (no touches to `packages/brand/theme.css` or `web/src/styles/global.css`).
- Any visual identity changes beyond the disclosure styling — typography levels, color tokens, modal proportions stay as-is.
- `prefers-reduced-motion` gate on the disclosure marker's 90° rotation. Mirrors the existing `InvitePickerStep.vue` pattern (no gate). If brand-wide reduced-motion handling is ever taken on, address all sites in one focused PR. The transform here is small (10px character, 200ms) and not a vestibular concern in practice.

## Sustainability summary (the "future maintainer" lens)

| Concern                        | Outcome                                                                                                                                                                                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Naming / discoverability**   | New keys grouped under `loginV6.howThisWorks.*` — `grep` finds the security disclosure block in one search. The new helper joins the existing `formatDate*` family in `src/utils/date.ts`.                                                                        |
| **Coupling**                   | 5 files modified; no cross-file interfaces, no shared state, no new composables. The wizard imports one new helper from `date.ts`; that's the only new edge.                                                                                                      |
| **Call-stack depth**           | Helper is one function (no internal calls beyond `MONTHS_SHORT` lookup). Disclosures are native `<details>` (zero JS). Disabled CTA is a template ternary. Nothing deeper than 2 levels of indirection anywhere.                                                  |
| **Future a11y / motion work**  | Disclosure rotation isn't gated for reduced motion — matches existing precedent. One-line gate added later in a brand-wide pass if greg wants. Disclosure-state persistence (sticky open) is a `:open` binding away if ever needed.                               |
| **Test surface**               | 4 unit tests for the new `formatBirthdayShort` helper. E2E selector fix (no new e2e). No template-level tests added — the wizard is exercised end-to-end by `setup-flow.spec.ts`.                                                                                 |
| **Public API / data contract** | Form fields, submit handlers, captured data, route flow all unchanged. Anyone with an in-progress signup before/after the deploy sees the same data shape.                                                                                                        |
| **Reliability**                | Native `<details>` on `<summary>`. Zero JS for the disclosures. The helper has bounds-check + documented fallback. Existing async handlers untouched.                                                                                                             |
| **Reversibility**              | Every change is a small text/markup diff. Rolling back is reverting the commit. The cream gradient (the only experimental visual) is one Tailwind class string — trivially removable. The deleted i18n keys can be re-added if needed (zero data dependency).     |
| **Drift risk**                 | The 3 inline `<details>` usages share style by imitation, not by component. If a 4th site adopts the pattern, that's the trigger to extract — explicitly noted in the DRY audit. Color-literal drift mitigated by the inline guard comment on the cream gradient. |
| **Build-time guarantees**      | TypeScript strictly types `t()` keys as `UIStringKey` — orphan-reference safety. `npm run translate` regenerates zh.json from the canonical en + beanie source — no manual sync. CI gates (type-check, lint, unit, e2e) run on every PR.                          |

## Commit + ship

- Single commit. Title: `feat(setup): tighter wizard copy + disclosures + birthday-on-tile (v2)`
- Body should call out: the 75-word paragraph removal, the 2 new disclosures, the disabled-CTA-with-intent pattern, the new `formatBirthdayShort` helper, the e2e selector fix.
- Per project convention: do not deploy until greg explicitly says so.
