# Plan: Promote Google Calendar sync out of The Beanie Lab (official feature)

> Date: 2026-07-03
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-07-03-google-calendar-official.md`

> **No GitHub issue created.** This plan was approved for direct implementation.

## User Story

As a beanies.family user, I want Google Calendar sync to be a normal, discoverable feature in Settings (not hidden behind an experimental opt-in), so that I can connect my family's activities to my Google Calendar without first enabling "The Beanie Lab."

## Context

Google's OAuth verification for the Calendar scopes was **formally approved on 2026-07-03**. That removes the two constraints that forced Calendar behind The Beanie Lab: the unverified-app consent warning and the 100-user cap. Both were **Google-side only** — verified by codebase grep, **no app code implements a cap or warning**; they were tracked solely as status notes in `docs/STATUS.md`.

The feature is already fully built and shipping at the flag layer:

- `googleCalendarSync` and `calendarClashNudge` are registered in `src/config/flagRegistry.ts` and committed **`true`** in `src/config/featureFlags.committed.ts`.
- The sync + clash **engines** (`src/stores/calendarSyncStore.ts`, `src/stores/calendarClashStore.ts`) start in `src/App.vue:433` and gate **only** on their flags — never on the Lab. So the engines need **zero change**.
- The Beanie Lab (`useBeanieLab.ts` → `BeanieLabSection.vue` → `SettingsPage.vue`) currently gates **only the connect UI** (the `CalendarSyncSettings` drawer): it's reachable only via the Lab card, and its deep-link + mount guards require `calendarVisible` (Lab opt-in AND flag).

**AI (Tinfoil) lives in the same Lab wiring and MUST stay in the Lab.** This plan removes **only** Calendar from the Lab and gives it a first-class Settings home, keeping the flags as kill-switches.

## Requirements

1. **Decouple Calendar from The Beanie Lab** without disturbing AI. After the change, the Lab houses AI only.
2. **Give Calendar a first-class Settings card** — a `SettingsCard` bound to the existing `settings.card.calendarSync` key (renders **"📅 Google Calendar"**) in the main grid, positioned **immediately after `🌍 Country & Holidays`** (greg-confirmed), opening the existing `CalendarSyncSettings` drawer.
3. **Un-gate the drawer + deep-link** from the Lab: gate them on the `googleCalendarSync` flag alone (kill-switch), not on Lab opt-in.
4. **Keep both flags** (`googleCalendarSync`, `calendarClashNudge`) as kill-switches — do not remove. The card/drawer/deep-link hide if `googleCalendarSync` is flipped off.
5. **Promote the clash-warnings sub-feature together** (greg-confirmed). It already lives inside the `CalendarSyncSettings` drawer, gated by `calendarClashNudge` (committed true) — verify it surfaces correctly in the now-ungated drawer.
6. **Publish the help article** — flip `CALENDAR_SYNC_HELP_LIVE = false → true` (`src/content/help/security.ts:6`). The article already says "Settings → Google Calendar" (`security.ts:21`) — which matches the new card label, and it never referenced the Beanie Lab — so **no location-copy edit is needed**, just the flag flip. Update the clash article's Lab-referencing comment (lines 67-71) for accuracy.
7. **Announce it** — a spotlight what's-new release note "Google Calendar sync is now official," including the standing temporary Discord CTA.
8. **Update tests** for the Lab decoupling and the new card; keep engine + `settingsStore.beanieLab` tests intact.
9. **Docs housekeeping** — update the `docs/STATUS.md` lines describing the cap/Lab-gating; leave `docs/SELF_HOSTING.md:84` as-is (still true for self-hosted builds with their own OAuth client).

## Important Notes & Caveats

- **The one dangerous edit** (`useBeanieLab.ts`): after removing the `calendarAvailable` term, `hasAnyLabFeature` must equal `aiAvailable` **alone**. If this is fumbled, the entire Lab section stops mounting for AI-only users. The composable's header comment (lines 5-28) documents this three-file invariant — update it to AI-only.
- **AI has no dedicated surface flag** — it's "available" while EITHER `aiPhotoExtract` OR `aiTravelExtract` kill-switch is alive. Do not touch those flags or `AiSettings.vue`.
- **`isFlagEnabled` is NOT reactive** (`@/config/flags`) — it reads `localStorage`/env imperatively; flips take effect on reload. Use a **plain const** `calendarAvailable = isFlagEnabled('googleCalendarSync')`, matching every existing single-flag call site. Do not wrap in `computed` (adds no reactivity).
- **No new drawer.** `CalendarSyncSettings.vue` is reused as-is structurally — but see Section C: it has real error-handling gaps that must be fixed now that far more users will reach it (the connect UI is no longer opt-in-gated).
- **Card label is "Google Calendar", not "Calendar".** The card binds the existing `settings.card.calendarSync` key which resolves to **"Google Calendar"** (`uiStrings.ts:7172`). So it renders "📅 Google Calendar" — which is what the existing help articles already reference ("Settings → Google Calendar"). No help location-copy edit needed.
- **Reuse existing i18n** for the card: `settings.card.calendarSync` (`uiStrings.ts:7172`) + `settings.card.calendarSyncDesc` (7173-7176) — already used by the Lab card. No new card strings.
- **SettingsCard contract** (verified): `<SettingsCard icon :title :description icon-bg @click="showX = true" />`. Follow the exact pattern of the neighbouring cards (e.g. Country & Holidays at `SettingsPage.vue:655-661`). Pick an `icon-bg` tint var consistent with the grid (e.g. `var(--tint-silk-20)` or `var(--tint-orange-8)`).
- **Release note is authored at deploy time.** `DEPLOY_NOTES` (`src/content/release-notes/deploys.ts`) is prepended by the deploy skill with the real version/date. This plan specifies the **exact copy**; the entry itself is added during the Vue deploy (per `scripts/deploy/release-note-guide.md`), NOT hardcoded now with a guessed version/date. `spotlight: true`.
- **PUBLIC CONTENT rule**: `deploys.ts` ships in the public bundle — keep the announcement user-facing and benefit-framed; no internals.
- **Casing / i18n**: any new in-app strings need `en` + `beanie` in `uiStrings.ts` and pass `vue/no-bare-strings`. (Expected: none needed — card reuses existing keys.) The what's-new note carries `en` + `beanie` per the ReleaseNote shape.
- **Do NOT deploy.** Implementation + commit only; greg triggers deploys.

## Assumptions

> **Review before implementation.**

1. Google verification approval is complete and stable (greg confirmed 2026-07-03); no residual scope/consent issues that would warrant keeping the Lab gate.
2. `googleCalendarSync` and `calendarClashNudge` remain committed `true` — this plan does not change their committed state, only what reads them.
3. AI stays in the Lab; no plan to promote it now.
4. The existing `CalendarSyncSettings` drawer copy needs no changes for "official" status (it was written launch-ready). Verify during implementation.
5. The `google-calendar-sync` help article body is launch-ready (no "beta/experimental" framing) — only the `CALENDAR_SYNC_HELP_LIVE` flag flips. Verify the "where to find it" copy points to Settings → Calendar.

## Approach

### A. Decouple Calendar from the Lab (respect the AI invariant)

**`src/composables/useBeanieLab.ts`:**

- Remove `calendarAvailable` (line 37), `calendarVisible` (line 42), and both from the return (line 44).
- `hasAnyLabFeature` becomes `computed(() => aiAvailable.value)` (line 39) — AI alone. **This is now value-identical to `aiAvailable`; keep it as the deliberate, semantically-named section-mount guard and add a one-line comment saying so** (so the next maintainer doesn't puzzle over two names for one value). (Alternative: expose `aiAvailable` and mount on it — either is fine; pick one and note it.)
- *_Rewrite the header comment (5-28) to DELETE the now-vacuous "OR of exactly the *Available terms" invariant*_ — with a single feature there is nothing to keep in sync across features, so re-scoping it to "two-file" would document ceremony that no longer exists. Describe an AI-only Lab plainly.
- **Keep the composable** — it still earns its place: it collapses the two-flag AI-availability OR (`aiPhotoExtract || aiTravelExtract`) into one derived value, keeps those flag names out of `SettingsPage`/`BeanieLabSection`, and centralizes the `isFlagEnabled` reads in one test-stubbable place. Do not inline/delete it.
- Result surface: `{ labEnabled, hasAnyLabFeature, aiVisible }`.

**`src/components/settings/BeanieLabSection.vue`** (collapse the now-single-feature machinery — don't keep a one-entry array):

- With only AI left, the `labFeatures` array + `v-for` + `visibleFeatures` filter + union-typed event + the `openFeature` union-narrowing (which exists _solely_ to satisfy the two-member emit overload, lines 67-70) become pure ceremony around a single card. **Collapse it:**
  - Remove the `LabFeature` interface (35-42), the `labFeatures` array (44-62), `visibleFeatures` (64), `openFeature` (67-70), and now-unused imports (`ComputedRef` line 13, `UIStringKey` line 23).
  - `defineEmits<{ 'open-ai': [] }>()`; destructure `{ labEnabled, aiVisible }`.
  - Render a single AI `SettingsCard` inline inside the existing `ConditionalSection :show="labEnabled"`, with **`v-if="aiVisible"` on the card** (reproduces the `labEnabled && aiVisible` gate and consumes `aiVisible` — otherwise it's an unused-var CI failure; mirrors SettingsPage's `AiSettings v-if="aiVisible"`). The BetaBadge MUST use the named slot (SettingsCard exposes it only via `<slot name="badge" />`, not a prop):
    ```html
    <SettingsCard
      v-if="aiVisible"
      icon="🤖"
      :title="t('settings.card.ai')"
      :description="t('settings.card.aiDesc')"
      icon-bg="var(--tint-silk-20)"
      data-testid="beanie-lab-card-ai"
      @click="emit('open-ai')"
    >
      <template #badge><BetaBadge label="settings.beanieLab.testingTag" /></template>
    </SettingsCard>
    ```
    (Verify the exact AI card icon/title/desc keys against the removed `labFeatures` AI entry — reuse those same keys.)
  - Keep the `computed` import (still used elsewhere, e.g. `animateBeaker`); only `ComputedRef` (line 13) and `UIStringKey` (line 23) imports become unused → remove them.
- This matches how every other `SettingsCard` in `SettingsPage.vue:634-698` is written (direct card + direct handler), removes the union-narrowing entirely, and reduces net churn (Section F's tests already move to a single-card shape). Re-introducing an array if a second Lab feature lands later is trivial (YAGNI).

### B. Give Calendar a Settings home (`src/pages/SettingsPage.vue`)

- Add `import { isFlagEnabled } from '@/config/flags';` and a **plain** `const calendarAvailable = isFlagEnabled('googleCalendarSync');` (NOT a `computed` — `isFlagEnabled` reads `localStorage`/env imperatively and is not reactive; flag flips take effect on reload per `flags.ts:15`. A plain const matches the established single-flag-read convention: `CalendarSyncSettings.vue:27`, `App.vue:432`, `resetStores.ts:41`). This is the non-Lab replacement for the removed `calendarVisible`. One consumer, one file → no shared helper/composable (over-abstraction).
- Update the destructure (line 112): `const { hasAnyLabFeature, aiVisible } = useBeanieLab();` (drop `calendarVisible`). Keep `showCalendarSync` (line 107); update the comment block (108-111) to reflect that only AI is in the Lab now and Calendar is a standalone card.
- **New card** in the grid, right after Country & Holidays (`SettingsPage.vue:655-661`):
  ```html
  <SettingsCard
    v-if="calendarAvailable"
    icon="📅"
    :title="t('settings.card.calendarSync')"
    :description="t('settings.card.calendarSyncDesc')"
    icon-bg="var(--tint-silk-20)"
    @click="showCalendarSync = true"
  />
  ```
- **All three reads use the plain const `calendarAvailable` with NO `.value`** (it's a boolean, not a ref — `boolean.value` is `undefined`, i.e. always-falsy):
  - Card: `v-if="calendarAvailable"`.
  - **Deep-link guard** (`cardOpenMap['calendar-sync']`, lines 125-128): `if (calendarAvailable) showCalendarSync.value = true;`; update the comment.
  - **Drawer mount guard** (lines 833-837): `v-if="calendarAvailable"`. Split the drawer out of the "Beanie Lab surfaces" comment block (829-831) so only `AiSettings` remains described as a Lab surface; give `CalendarSyncSettings` its own one-line comment (standalone, flag-gated).
- One plain const referenced three times in one file cannot drift with itself — no shared helper needed (the cross-file drift the composable guards against doesn't apply here).
- **BeanieLabSection usage** (lines 792-796): remove `@open-calendar="showCalendarSync = true"`.

### C. `src/components/settings/CalendarSyncSettings.vue` (header comment **+ real error-handling fixes**)

Promoting this out of the Lab means far more users reach the connect UI, so the drawer's real silent-failure gaps must be fixed now — this is no longer a "comment only" change. **Crucially, reuse this file's EXISTING patterns — do not invent a third.** The file already has two house patterns: (a) **store returns a typed outcome, view toasts from it** (`connect`/`reconnect` → `CalendarConnectResult`; `setDestinationCalendar` → `{ ok }`); (b) **store owns the toast + `reportError` then re-throws, view has a thin explanatory empty `catch`** (as `onToggleClash` already does). Apply these; do NOT add five bespoke `toast + console.error` catch blocks (that's a third pattern + copy-paste rot).

Scope the fix to the **two real false-success bugs** + throw-hardening only where a store method can actually throw:

- **`onSyncNow` false success.** `store.syncNow()` → `reconcileConnection` **swallows all errors** (sets `status: 'error'`/`'needs_reconnect'`, reports to Slack, returns normally — `calendarSyncStore.ts:380-433`); never throws. So `onSyncNow` always falls through to green `calendarSync.toast.synced`. **Fix (pattern a):** the status decision actually lives in **`settleConnectionStatus`** (the single status-writer, which can early-return without writing on a no-op/fresh path — which is exactly why reading `store.connections` after the await is unreliable). Originate the outcome there and **return it up** through `reconcileConnection` → `syncNow`; toast success vs. error from the returned value. **Return-type note:** the view only calls `syncNow(connectionId)` (line 122), but the no-arg `syncNow()` fans out to `reconcileAll` over many connections and is called that way by existing tests — so type it `Promise<SyncOutcome | void>` (per-connection branch returns the outcome; aggregate branch returns void/aggregate) so existing no-arg calls stay valid. Add a `calendarSync.toast.*` error key if none fits (`en`+`beanie`).
- **`onDisconnect` false success (the parallel bug).** `disconnect` → `finishDisconnect` swallows per-event delete failures (`allCleared = false`) and returns normally, leaving `status: 'disconnecting'`, yet the view still toasts green "Disconnected." **Fix (pattern a):** have `disconnect` **return whether teardown fully completed**, and toast success vs. partial accordingly.
- **Throw-hardening (pattern b) only where a store method genuinely throws** — e.g. `connect`'s `createCalendarConnection` / `disconnect`'s IDB write (`calendarSyncStore.ts:484,520`). Prefer surfacing + `reportError` in the store then re-throw, leaving the view's existing thin `catch` to reset busy state. `onConnect`/`onReconnect`/`onPickCalendar` already get their error signal from the returned result object and don't throw in normal operation — do NOT blanket-wrap them (implies a failure mode the result already covers and muddies toast ownership).
- If any view-level catching remains, factor a single `runAction(label, fn)` helper rather than repeating the toast+log five times.
- Update the header comment (lines 1-5) — currently "Gated behind the googleCalendarSync flag at the SettingsPage card" via the Lab. Reword to: standalone **Settings → Google Calendar** card, gated on `googleCalendarSync` (kill-switch).
- Confirm the clash toggle (reads `isFlagEnabled('calendarClashNudge')`, line 25) still renders.

### D. Help article (`src/content/help/security.ts`)

- Flip `CALENDAR_SYNC_HELP_LIVE = false → true` (line 6). The `google-calendar-sync` article already says "Settings → Google Calendar" (`security.ts:21`) and never referenced the Beanie Lab, so its location copy already matches the new card — **no copy edit needed**. Update the clash-article comment (67-71) that references Lab-gating for accuracy. Confirm both articles resolve on the built help center.

### E. Announcement (release note)

Specify the exact copy for the deploy-time `DEPLOY_NOTES` prepend (added during the Vue deploy, real version/date filled then), `spotlight: true`:

- **summary**: `en`: "Google Calendar sync is now official — connect your family's activities to your Google Calendar." `beanie`: lowercase variant.
- **feature 1** — icon `📅`, title "Google Calendar sync", description (benefit-framed): activities/plans flow to your Google Calendar, whole-family, you control what syncs, disconnect anytime; it's private (read the zero-knowledge/how-it-works framing). Keep it user-facing, no internals.
- **feature 2** — the standing **Discord CTA** (icon `💬`, "Join us on Discord", CTA href `https://beanies.family/discord`), per the temporary announcements convention.

### F. Tests

- `src/composables/__tests__/useBeanieLab.test.ts`: drop calendar assertions — remove `'googleCalendarSync'` from the `hasAnyLabFeature` `it.each` (line ~98), remove the "calendar requires Lab AND flag" cases (73-81), and any `calendarVisible` expectations. Keep AI cases. Assert `hasAnyLabFeature` is driven by AI flags alone.
- `src/components/settings/__tests__/BeanieLabSection.test.ts`: rework from two cards/order `[calendar, ai]`/`open-calendar` (83-97) to a single AI card; remove the "calendar flag off → only AI" case or repurpose it.
- **New coverage** (in `SettingsPage` tests if present, else a focused test): the `📅 Google Calendar` card renders and opens the drawer **independent of the Lab** (Lab off, `googleCalendarSync` on → card visible, drawer opens); and the card/drawer/deep-link **hide when `googleCalendarSync` is off** (kill-switch).
- **CalendarSyncSettings error-handling coverage** (Section C fixes), driven by the store's **returned outcome** (mock the method's return value — NOT by mutating/re-reading `store.connections`): `syncNow` returning an error status → error toast (not success); `disconnect` returning partial/incomplete → non-success toast; a genuinely-throwing store method → the view's thin `catch` resets busy state with no unhandled rejection.
- **Existing store tests stay green** (verified): `calendarSyncStore.test.ts` calls `syncNow()`/`disconnect(id)` and asserts only side-effects (status/events), ignoring return values — so adding a return type doesn't break them. The **new** outcome-return assertions live in the CalendarSyncSettings view test (above), not by editing the store tests. `calendarClashStore.test.ts`, `googleCalendarClient*.test.ts`, `settingsStore.beanieLab.test.ts` (Lab persists for AI) — unchanged.

### G. Docs

- `docs/STATUS.md`: this file is an **append-only session log** — the cap/Lab-gating strings appear across many _dated historical snapshots_ (lines 173, 214, 255, 283, …) which must NOT be retroactively rewritten. Touch at most the one **current/live** pending line (~line 75), or simply let `/end-session` add a fresh entry recording the promotion. Do not rewrite history.
- `docs/SELF_HOSTING.md:84`: leave as-is.
- `CHANGELOG.md`: add a 2026-07-03 entry (Changed/Added) — Google Calendar sync is now an official Settings feature.

## Files Affected

- `src/composables/useBeanieLab.ts` — remove calendar; AI-only invariant; header comment.
- `src/components/settings/BeanieLabSection.vue` — drop calendar `labFeatures` entry + `open-calendar` emit; simplify unions/narrowing.
- `src/pages/SettingsPage.vue` — new `📅 Google Calendar` card; `calendarAvailable` plain const via `isFlagEnabled` (new import); deep-link + drawer guards flag-based (no `.value`); drop `@open-calendar`; comment updates.
- `src/components/settings/CalendarSyncSettings.vue` — **error-handling fixes** (`onSyncNow`/`onDisconnect` toast from real outcome; throw-hardening via existing patterns) **+** header comment reword.
- `src/stores/calendarSyncStore.ts` — `syncNow` returns `SyncOutcome | void` (outcome originates in `settleConnectionStatus`, threaded up via `reconcileConnection`); `disconnect` returns teardown-complete (`finishDisconnect` returns `allCleared`). Engines otherwise unchanged.
- `src/services/translation/uiStrings.ts` — a `calendarSync.toast.*` error key (`en`+`beanie`) if no existing key fits the sync/disconnect failure toast.
- `src/content/help/security.ts` — `CALENDAR_SYNC_HELP_LIVE = true`; clash-comment wording; verify article "where to find it" copy.
- `src/content/release-notes/deploys.ts` — the announcement entry (added at deploy time; copy specified here).
- `src/composables/__tests__/useBeanieLab.test.ts` — AI-only rework.
- `src/components/settings/__tests__/BeanieLabSection.test.ts` — single-card rework.
- New/updated SettingsPage test for the standalone Calendar card (kill-switch on/off).
- `docs/STATUS.md`, `CHANGELOG.md` — housekeeping.

## Help Center Coverage

- **Action**: update existing (publish) — flip live, verify copy.
- **Category**: `security`
- **Article type**: how-to / explainer (existing)
- **Slug**: `google-calendar-sync` (existing, currently held by `CALENDAR_SYNC_HELP_LIVE = false`)
- **Title**: "How beanies Syncs Your Activities to Google Calendar"
- **Scope**: How to connect Google Calendar from **Settings → Google Calendar**, what syncs (whole-family activities/plans), how to control/disconnect it, and the privacy posture. Now that the feature is official, this becomes a normal, discoverable help article.
- **Notes**: The article's existing "Settings → Google Calendar" wording already matches the new card label (no edit needed; it never referenced Beanie Lab). The related clash-warnings article (`external-calendar-clash-nudge`, already live) points to the same place — confirm it still resolves. Publishing is just the `CALENDAR_SYNC_HELP_LIVE` flip. Follow `.claude/skills/beanies-help-docs/SKILL.md`.

## Acceptance Criteria

- [ ] With the Lab **off**, a `📅 Google Calendar` card appears in Settings right after Country & Holidays and opens the calendar drawer.
- [ ] The calendar drawer connects/disconnects Google Calendar and shows the clash-warnings toggle (both work without any Lab opt-in).
- [ ] **Error handling:** a failed "Sync now" shows an **error** toast (not a false green "Synced!"), a partial "Disconnect" shows a non-success toast (not a false "Disconnected"), and genuinely-throwing paths surface an error without an unhandled rejection — all via the file's existing outcome-return / store-rethrow patterns (no new bespoke pattern, no silent failures).
- [ ] The Beanie Lab section still appears (for AI) and no longer lists a Calendar card; toggling the Lab has no effect on the Calendar card/drawer.
- [ ] AI-only users still see the Lab section (the `hasAnyLabFeature` regression guard).
- [ ] Deep-link `?open=calendar-sync` opens the drawer when `googleCalendarSync` is on, regardless of Lab state.
- [ ] Flipping `googleCalendarSync` **off** (kill-switch) hides the card, drawer, and deep-link.
- [ ] The `google-calendar-sync` help article is published and its "where to find it" copy matches Settings → Calendar; the clash article still points to the right place.
- [ ] The what's-new announcement copy (spotlight + Discord CTA) is specified for the deploy-time prepend.
- [ ] `npm run test`, `type-check`, `lint`, `build`, `build:web` all green.
- [ ] Help Center article verified to match shipped behavior.

## Testing Plan

1. `npm run dev` — with Lab off: confirm the `📅 Calendar` card is present after Country & Holidays and opens the drawer; connect flow works; clash toggle present.
2. Toggle the Lab on/off → Calendar card/drawer unaffected; Lab still shows AI.
3. Simulate AI-only (calendar flag on is the norm; verify via unit test that `hasAnyLabFeature` = AI alone) — Lab section still mounts.
4. `?open=calendar-sync` deep-link opens the drawer without Lab opt-in.
5. Dev-flip `googleCalendarSync` off (Feature Flags card) → Calendar card/drawer/deep-link disappear; Lab/AI unaffected.
6. `npm run build:web` → help center: `google-calendar-sync` article resolves; verify "where to find it" copy.
7. Unit/component tests: `useBeanieLab`, `BeanieLabSection`, new SettingsPage calendar-card test, and the unchanged engine tests all green.
8. `npm run test && npm run type-check && npm run lint && npm run build && npm run build:web`.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the full promotion plan — three-file Lab decoupling (AI-invariant-safe), new `📅 Calendar` Settings card after Country & Holidays, flag-based (kill-switch) drawer/deep-link guards, help-article publish, deploy-time spotlight+Discord announcement, test rework, docs housekeeping.
- **Pass 2 (DRY + error handling)**: `calendarAvailable` → plain const (isFlagEnabled isn't reactive; no shared helper for a one-file consumer); **found + added real error-handling fixes to CalendarSyncSettings** (onSyncNow shows false success because reconcileConnection swallows errors; handlers lack `catch`) — no longer "comment only"; collapsed the one-entry `labFeatures` array to an inline AI card (removed interface/array/filter/union-narrowing); corrected card label to "Google Calendar" (existing key) so help copy already matches → no location-copy edit; softened STATUS.md to not rewrite historical log snapshots.
- **Pass 3 (Sustainability)**: Fixed a `.value` bug (`calendarAvailable` is a plain boolean const — all three reads drop `.value`); kept `useBeanieLab` (still centralizes the two-flag AI OR across two files) but deleted the now-vacuous "OR of terms" invariant from its header and noted `hasAnyLabFeature` as a deliberate `aiAvailable` alias; **redirected the error-handling fix to the file's existing patterns** (store returns outcome → view toasts; store-rethrow + thin `catch` for true throws) instead of five bespoke catches, and caught a **second** false-success bug in `onDisconnect` (mirrors `syncNow`); tests now assert on the store's returned outcome, adding a disconnect partial-failure case.
- **Pass 4 (Fresh-eyes sweep)**: Confirmed the AI-only path doesn't break (`hasAnyLabFeature` = AI flags, section still mounts). Precision fixes: put `v-if="aiVisible"` on the collapsed AI card (else unused-var CI failure) + pinned the BetaBadge `#badge` named-slot form (else silent badge regression); corrected the stale Files Affected list (CalendarSyncSettings is NOT comment-only; added `calendarSyncStore.ts` + `uiStrings.ts`); named `settleConnectionStatus` as the outcome source and typed `syncNow` as `Promise<SyncOutcome | void>` so existing no-arg calls stay valid; clarified that new outcome assertions live in the view test, existing store tests stay green.

## Prompt Log

> No GitHub issue created — direct implementation.

<details>
<summary>Full prompt history</summary>

### Initial Prompt

> Update - the google calendar integration has finally been formally approved - what do we need to do to make this an official feature? I think all we need to do is move it out of the "beanies lab" experimental section and give it a proper home in settings - can you please investigate and let me know?

### Follow-up (decisions)

> 1. ok with this positioning [Calendar card right after Country & Holidays]
> 2. yes [promote the clash-warnings sub-feature together]
> 3. yes [add a what's-new announcement]

### Then

> [invoked /beanies-plan to prepare the plan]

</details>
