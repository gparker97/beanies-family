# Plan: Medication dose log — group by day + over-limit warnings

> Date: 2026-05-24
> Related issues: None — direct implementation
> Plan file (final home): `docs/plans/2026-05-24-medication-dose-log-grouping.md`
> **No GitHub issue created.** Approved for direct implementation; full prompt history is in the Prompt Log below.

## User Story

As a parent giving a child medication, I want the dose log grouped by day with a clear per-day count — and a gentle heads-up when I'm about to log more than the recommended doses in a day — so that I can see at a glance how many doses were given each day and avoid accidentally over-dosing.

## Context

The medication drawer (`MedicationViewModal.vue`) currently renders logged doses as a flat, undifferentiated list sorted newest-first (`MedicationLogRow` rows, 5 shown then "View all"). Because medications are typically prescribed as _N doses per day_, a flat list makes it hard to answer the question that actually matters — "how many doses were given on each day, and did any day exceed the recommendation?"

Each `Medication` already captures `dosesPerDay` (1–4, or `null`/`undefined` for "as needed"). We can use it to (A) group the log by calendar day with a per-day count and flag days that went over, and (B) show a gentle, informative, **dismissable** heads-up in the "Log a dose" confirm dialog when the dose about to be logged would push that day over the recommended count. The warning must be helpful, not alarming — Heritage Orange, never Alert Red, and never blocking (Save stays enabled).

A mockup was built and approved: `docs/mockups/medication-dose-log-grouping.html`.

## Requirements

1. **Group the "Recent doses" list by calendar day** in `MedicationViewModal.vue`, newest day first, with a date header (`Today` / `Yesterday` / `Mon, 21 Apr`).
2. **Per-day count** on each day header (e.g. "3 doses"), pluralized.
3. **Over-limit flag per day**: when a day's dose count exceeds the medication's `dosesPerDay`, the count pill turns Heritage Orange and a slim orange-tint note appears under the header: "{over} more than the recommended {limit} a day."
4. **"As needed" medications** (`dosesPerDay` outside the structured 1–4 range — null/undefined/other) show the daily count but **never** an over-limit flag.
5. **Truncation respects day boundaries**: show the most recent N day-groups by default (N = 3), with "View all" / "Show less" toggling the rest — never cut a day in half (so per-day counts are always accurate).
6. **Dismissable over-limit heads-up in `DoseLogConfirmModal.vue`**: when the dose about to be logged on the selected date would exceed `dosesPerDay`, show an informative, dismissable callout at the top of the dialog body. Heritage Orange tint, 💡 icon, an ✕ to dismiss, **Save remains enabled** (non-blocking). Reset (re-show) each time the dialog opens.
7. The warning counts doses on the **selected** date in the dialog (correct for back-dated entries), not just "today".
8. All new copy goes through i18n (`uiStrings.ts`, both `en` + `beanie`), zh regenerated via `npm run translate`. Dynamic numbers use the established `t('key').replace('{token}', String(v))` convention.
9. No regression to existing behavior: the hero "Give a dose" CTA, delete-log, empty state, last-dose caption, photo lightbox, and auto-close-on-delete all keep working.

## Important Notes & Caveats

- **`t()` has no interpolation.** It takes a `UIStringKey` only (`src/composables/useTranslation.ts:36`). Dynamic copy uses the existing repo convention: define the string with `{token}` placeholders and call `t('key').replace('{token}', String(v))` in the component (see `PhotoAttachments.vue:55`, `TodoItemRow.vue:83`, `GoalViewModal.vue:147`).
- **"Is this a real per-day limit?" is decided by the EXISTING `isValidDosesPerDay`** (`src/utils/medicationFrequency.ts:38`), which is `n is 1 | 2 | 3 | 4`. Anything else (null/undefined/0/5+/corrupt) is "as needed / other" — the same rule the form and `useCriticalItems` already use. The new `getDailyDoseStatus` MUST route through it rather than re-deriving `dosesPerDay > 0`, so all surfaces agree and a corrupt value (e.g. `7`) can't silently masquerade as a limit. (The form already defensively logs + nulls a corrupt stored `dosesPerDay` — `MedicationFormModal.vue:104-121`; we inherit that hygiene by reusing the same predicate.)
- **`getDailyDoseStatus` returns `limit: number | null`, NOT `1|2|3|4|null`.** This is deliberate — keeping the structured-frequency union out of a general-purpose util means the util doesn't depend on the form's domain vocabulary, and the only consumers stringify it (`String(limit)`) so the narrower type buys nothing. Do not "tighten" it to the union later; that would couple the util to `medicationFrequency`'s type and create churn for zero behavioral gain.
- **Copy avoids the word "today"** in both the per-day note and the confirm-dialog warning, because the warning is keyed off the _selected_ date (which can be back-dated). Phrase as "in a day" / "{over} more than the recommended {limit} a day" so it's accurate regardless of date. (Minor wording shift from the mockup's "…today", deliberately, for back-dated correctness.)
- **The dialog's existing "Given today" list stays today-scoped and unchanged** — that's out of scope. Only the new warning is selected-date-aware.
- **Heritage Orange only.** Per brand + CLAUDE.md, never Alert Red for this routine, non-destructive alert. Reuse the existing `--tint-orange-8` / `--tint-orange-15` tokens (`src/style.css:80-81`) — the exact strip + `#F15D22` text already used by the over-note and the "Now" button in `DoseLogConfirmModal.vue:140`.
- **Group counts use ALL logs, not just the visible window** — so a day's count is always its true total even when collapsed. Truncation is applied at the group level only.
- **Reuse the standard list-disclosure primitives.** Windowing is `useExpandableList` (`src/composables/useExpandableList.ts`, ADR-025) + the `<ShowMoreToggle>` affordance (`src/components/ui/ShowMoreToggle.vue`), NOT a hand-rolled `showAll`/`hasMore` pair. The current `MedicationViewModal` predates this primitive; this change brings it into line. (`useExpandableList`'s internal `watch` also keeps the window truthful if logs are deleted while the drawer is open.)
- **Extract the over-limit day header into a small presentational component — `MedicationDayHeader.vue`.** The over-limit visual treatment (label + count pill that turns orange + the orange-tint over-note) now appears at the _same time_ in two surfaces: the grouped drawer log AND (callout-wise) the confirm dialog. This is the "second over-limit surface" extraction trigger. Rather than inline the pill + over-note styling into the `MedicationViewModal` template (which would make that template deeply nested and put the orange visual logic in two files), extract a dumb, prop-driven `MedicationDayHeader.vue` (`label`, `count`, `status: DailyDoseStatus`) that owns the header + pill + over-note. This keeps the drawer's per-group template shallow (header component + rows) and the orange over-limit visual in exactly one place. **The confirm-dialog callout stays inlined** — it is a _different shape_ (full-width dismissable banner with title/body/✕ icon, not a list header), so forcing it through `MedicationDayHeader` would couple two unrelated layouts; the shared piece between them is the `getDailyDoseStatus` util + the tint tokens, which they already share.
- **Error handling.** All new logic is pure/derived (status computeds, day grouping, day-label) — no async, nothing that can throw on valid input, so no try/catch is added (ceremonial try/catch around pure functions would be noise). The only real failure surface — persisting the log — is already wrapped: `medicationsStore.createMedicationLog` goes through `wrapAsync` (toast + `error` ref + console) and `useGiveDose` surfaces a toast+console on _every_ non-success path (`useGiveDose.ts:38-71`). The warning is advisory and never blocks Save, so it has no failure path of its own. The one "never fail silently" guard we DO add is the `isValidDosesPerDay` routing above, so a corrupt `dosesPerDay` degrades to "as needed" instead of inventing a bogus limit.
- **`relativeDayLabel` must keep its one-shot, NON-reactive "today".** The extracted helper computes "today" via the existing `localToday()` helper (`src/utils/date.ts:449`, which is exactly `toDateInputValue(new Date())`) at call time, matching what `EntityActivityLog.dateLabel` does today — it does NOT take the reactive `useToday().today`. Using the sibling `localToday()` rather than re-inlining `toDateInputValue(new Date())` keeps `date.ts` DRY and makes the non-reactive intent self-documenting (the name announces "one-shot"); the value is byte-for-byte identical, so `EntityActivityLog`'s grouping behavior is preserved exactly. This is load-bearing: a future maintainer must not "helpfully" wire reactive today into it, which would silently change `EntityActivityLog`'s grouping behavior. An explicit unit test + acceptance criterion pin this down.
- **Drawer day labels are intentionally one-shot (non-reactive).** Because `dayGroups` resolves labels via `relativeDayLabel` (one-shot `localToday()`), a drawer left open across midnight keeps the prior "Today" label until reopened. This is deliberate and matches the existing `EntityActivityLog` behavior; the drawer is a transient surface and re-renders its labels every time it opens. Do not wire reactive today into the grouping to "fix" this — it would diverge from `EntityActivityLog` for no real-world benefit.
- **Confirm-dialog dismiss persists for the open session, by design.** `dismissed` resets only when the dialog _opens_ (per Requirement 6). If the user dismisses the heads-up and then changes the date picker to a _different_ over-limit day, the heads-up stays hidden — dismiss means "I've acknowledged this for this dialog session," not "hide until the next over day." This is the deliberate, less-naggy reading of the requirement; do not re-show on date change.
- **Help Center**: assessed — not needed. UI clarity polish on an existing feature; it does not add a new capability, change what the user can do, or contradict any existing article (the warning is non-blocking). No `## Help Center Coverage` section.

## Assumptions

> Review before implementation — valid at planning time (2026-05-24).

1. `Medication.dosesPerDay` semantics: `1|2|3|4` = recommended/day (per `isValidDosesPerDay`); anything else (`null`/`undefined`/`0`/`5+`/corrupt) = "as needed" (no limit). Confirmed in `models.ts` + `medicationFrequency.ts:38` + `MedicationFormModal.vue`.
2. `MedicationLogEntry.administeredOn` is a full ISO-8601 datetime; local calendar day = `toDateInputValue(new Date(administeredOn))` (matches `medicationsStore.dosesToday` at `medicationsStore.ts:71`).
3. Logs from `logsForMedication()` are sorted descending by `administeredOn` (`medicationsStore.ts:53-59`), so `groupByDate` produces newest-day-first groups without extra sorting.
4. The drawer is `size="narrow"`; the design must read well at ~390px and wider.

## Approach

### 1. Shared pure helper — `src/utils/doseLimit.ts` (NEW)

Single source of truth for "is this day over the recommendation", used by BOTH surfaces so they can never disagree. Delegates the "is this a real limit" decision to the existing `isValidDosesPerDay` so it can never drift from the rest of the app.

```ts
import { isValidDosesPerDay } from '@/utils/medicationFrequency';

export interface DailyDoseStatus {
  limit: number | null; // null = no recommendation ("as needed")
  isOver: boolean; // count strictly exceeds limit
  over: number; // how many over (0 when within/limitless)
}

/** Status of a day that has `count` doses for a med whose recommended/day is `dosesPerDay`. */
export function getDailyDoseStatus(
  count: number,
  dosesPerDay: number | null | undefined
): DailyDoseStatus {
  // Reuse the app-wide predicate: only 1–4 is a real limit; everything
  // else ("as needed", 0, 5+, corrupt) is limitless. This keeps the log
  // flag, the confirm warning, the form, and useCriticalItems in lockstep.
  if (!isValidDosesPerDay(dosesPerDay)) return { limit: null, isOver: false, over: 0 };
  const limit = dosesPerDay; // narrowed to 1 | 2 | 3 | 4
  const over = Math.max(0, count - limit);
  return { limit, isOver: over > 0, over };
}
```

- **Log grouping** calls it with the day's actual count → flags `isOver`.
- **Confirm dialog** calls it with the _prospective_ count (`dosesOnSelectedDate + 1`) → warns when adding this dose would be over.
- `limit` is intentionally `number | null` (not the `1|2|3|4` union) — see the caveat above; consumers only stringify it.

### 2. Store helper — `src/stores/medicationsStore.ts`

Generalize the existing today-only counter so the confirm dialog can count any selected date (DRY — `dosesToday` becomes a thin wrapper). Both are returned from the store's setup function (the store currently exposes only `dosesToday`).

```ts
function dosesOnDate(medicationId: string, dateStr: string): number {
  let count = 0;
  for (const log of medicationLogs.value) {
    if (log.medicationId !== medicationId) continue;
    if (toDateInputValue(new Date(log.administeredOn)) === dateStr) count++;
  }
  return count;
}
function dosesToday(medicationId: string): number {
  return dosesOnDate(medicationId, today.value);
}
```

Add `dosesOnDate` to the returned object alongside the existing `dosesToday`.

- The linear scan is intentionally kept simple: it's O(n) over a single family's medication logs (a small set), and `dosesToday` has scanned this way in production already. The confirm modal calls `dosesOnDate` inside a computed that re-runs as the date/time pickers change — that's still trivial work at this data volume. **Do not pre-index this into a `Map` keyed by med+date** unless a real perf signal ever appears; the index would add invalidation complexity for no measurable gain.

### 3. Shared day-label helper — extract from `EntityActivityLog.vue`

`EntityActivityLog.vue:72-82` already has the exact `Today/Tomorrow/Yesterday → formatNookDate` logic we need. Extract it (DRY) into a reusable pure helper and refactor `EntityActivityLog` to use it:

- Add to `src/utils/date.ts`: `relativeDayLabel(dateStr: string, t: (k: UIStringKey) => string): string` — logic lifted from `EntityActivityLog.dateLabel` (uses `date.today` / `date.tomorrow` / `date.yesterday` keys + `formatNookDate`). It computes "today" via the existing **`localToday()`** sibling helper (which is exactly `toDateInputValue(new Date())`) — **one-shot, NOT the reactive `useToday`** — so behavior is byte-for-byte preserved while staying DRY within `date.ts` and self-documenting about its non-reactive intent. Takes `t` as a param to keep `date.ts` free of translation-store coupling, matching the existing pure-helper convention in that file (`frequencyDisplayFor` does the same). For tomorrow/yesterday it derives from a fresh `new Date()` the same way the source does.
- `EntityActivityLog.vue`: replace local `dateLabel` with `relativeDayLabel(dateStr, t)` (its existing `t` from `useTranslation`). No behavior change.
- New grouped log uses the same helper.

### 4. `MedicationDayHeader.vue` (NEW) — the grouped-log day header

A dumb, prop-driven presentational component owning the per-day header so the orange over-limit visual lives in exactly one place (see the extraction caveat above). No store, no `useToday`, no async — pure props in, markup out.

- Props: `{ label: string; count: number; status: DailyDoseStatus }`.
- Renders:
  - the day label (`font-outfit … text-xs … uppercase`, mirroring `EntityActivityLog.vue:121-125`),
  - the count pill — text `` `${count} ${t(count === 1 ? 'medicationLog.dose' : 'medicationLog.doses')}` ``; slate tint normally, `--tint-orange-15` bg + `#F15D22` text + ⚠ when `status.isOver`,
  - the over-note (only when `status.isOver`) — a `--tint-orange-8` strip with `t('medicationLog.overNote').replace('{over}', String(status.over)).replace('{limit}', String(status.limit))`.
- It reads `useTranslation` for its own pill/over-note copy (consistent with every other leaf component); the date _label_ is passed in already-resolved (the parent computes it via `relativeDayLabel`, which needs the grouping date key).

### 5. `MedicationViewModal.vue` — grouped, counted, flagged log

Replace the flat `visibleLogs` block (template lines 311–326) and its hand-rolled windowing (`INITIAL_VISIBLE`/`showAll`/`visibleLogs`/`hasMoreLogs`, lines 85–91) with day-grouping windowed by the standard primitive:

- Imports: `groupByDate` from `@/utils/groupByDate`; `relativeDayLabel`, `toDateInputValue` from `@/utils/date`; `getDailyDoseStatus` from `@/utils/doseLimit`; `useExpandableList` from `@/composables/useExpandableList`; `ShowMoreToggle` from `@/components/ui/ShowMoreToggle.vue`; `MedicationDayHeader` from `@/components/pod/MedicationDayHeader.vue`.
- **`dayGroups` as a readable multi-line computed** (not a dense one-liner) — `logs` is already desc-sorted → newest day first; `count`+`status` precomputed so the template stays declarative:

  ```ts
  const dayGroups = computed(() => {
    const dosesPerDay = medication.value?.dosesPerDay;
    const groups = groupByDate(
      logs.value,
      (l) => toDateInputValue(new Date(l.administeredOn)),
      (d) => relativeDayLabel(d, t)
    );
    return groups.map((g) => ({
      ...g,
      count: g.items.length,
      status: getDailyDoseStatus(g.items.length, dosesPerDay),
    }));
  });
  ```

- **Windowing by group** via the shared primitive (verified API):
  `const { visible: visibleGroups, canShowMore, canShowLess, showMore, showLess } = useExpandableList(dayGroups, { initial: 3 });`
  Render the affordance with `<ShowMoreToggle :can-show-more="canShowMore" :can-show-less="canShowLess" :more-label="t('medicationLog.viewAll')" :less-label="t('medicationLog.showLess')" tone="on-light" @show-more="showMore" @show-less="showLess" />` (default `tone="on-light"` is Heritage Orange `text-primary-500`). This replaces the bespoke orange toggle button and reuses the existing `medicationLog.viewAll` / `medicationLog.showLess` keys. **Drop the trailing "→" from the `medicationLog.viewAll` string** (`uiStrings.ts:705`, both `en` + `beanie`) — `ShowMoreToggle` always renders its own chevron, so the arrow would read doubled. Verified `viewAll`/`showLess` are used only in this component, so the edit is isolated and safe.
- **Reset on med change**: replace the existing `showAll`-resetting watcher (lines 94–99) with `watch(() => props.medication?.id, () => showLess())` — collapses to the first 3 groups when switching medications, via the composable's own API (no raw ref poking).
- **Template per group**: `<MedicationDayHeader :label="group.label" :count="group.count" :status="group.status" />` then the `MedicationLogRow` rows (unchanged, still `@delete="handleDeleteLog"`). The drawer template stays shallow — one header component + the row loop per group — with no inline pill/over-note markup.
- The `logListEl` ref + pulse-on-new-dose (`handleGiveDose`, lines 117–124) is preserved — `[data-log-id]` lives on `MedicationLogRow`, which still renders inside the groups under `logListEl`, so the `querySelector` still finds the freshly-added row.
- Empty state (`logCount === 0`) is unchanged.

### 6. `DoseLogConfirmModal.vue` — dismissable over-limit heads-up

Note: this modal has no `med` local — the medication is `state.value.medication`. All new computeds read that.

- `import { getDailyDoseStatus } from '@/utils/doseLimit';`
- `const dismissed = ref(false);` — reset to `false` inside the **existing** `watch(() => state.value.open, (open) => { if (open) { resetToNow(); dismissed.value = false; } })` (lines 79–84), so the heads-up re-shows every time the dialog opens. (`resetToNow()` runs synchronously here, so `dateValue` is always a valid `YYYY-MM-DD` by the time the modal renders — `prospectiveCount` can never produce a false warning off an empty date.)
- `prospectiveCount = computed(() => { const med = state.value.medication; return med ? medicationsStore.dosesOnDate(med.id, dateValue.value) + 1 : 0; });` — `dateValue` is already `YYYY-MM-DD` from `BeanieDatePicker` (line 136). Selected-date-aware → correct for back-dated entries.
- `overStatus = computed(() => getDailyDoseStatus(prospectiveCount.value, state.value.medication?.dosesPerDay));`
- `showOverWarning = computed(() => !dismissed.value && overStatus.value.isOver);`
- Render the dismissable callout **inlined** at the **top of the modal body** (first child of the `v-if="state.medication"` `div`, before the "Given today" section), `v-if="showOverWarning"`: 💡 icon, a title + body, and an ✕ button (`@click="dismissed = true"`, `:aria-label="t('action.dismiss')"`). Styling: `--tint-orange-8` background, rounded-2xl, `#F15D22` accents — mirroring the existing orange affordances already in this file (line 140). This callout is a distinct full-width banner shape (title/body/dismiss), NOT the list-header shape `MedicationDayHeader` renders, so it is correctly NOT routed through that component; the shared piece is `getDailyDoseStatus` + the tint tokens. Body text via `t('medicationLog.overWarning.title').replace('{count}', String(prospectiveCount.value))` and `t('medicationLog.overWarning.body').replace('{name}', state.medication.name).replace('{limit}', String(overStatus.value.limit))`.
- Dismiss persists for the rest of the open session even if the user changes the date picker (see caveat) — re-show is keyed off dialog _open_, not date change.
- `onSave` / `saveDisabled` unchanged — the warning is **non-blocking** by design.

### 7. i18n — `src/services/translation/uiStrings.ts` (+ `npm run translate` for zh)

Add to the `medicationLog.*` block (each with `en` + `beanie`):

- `medicationLog.overNote` — en: `'{over} more than the recommended {limit} a day.'`
- `medicationLog.overWarning.title` — en: `'{count} doses in a single day'`
- `medicationLog.overWarning.body` — en: `"{name}'s recommended limit is {limit} a day. It's worth double-checking the spacing since the last dose — you can still log it if that's right."`

Edit the existing `medicationLog.viewAll` to drop the trailing "→" (en: `'View all'`, beanie: `'view all'`) — see §5; `ShowMoreToggle` supplies the chevron.

Add to the `action.*` block (does NOT currently exist — verified):

- `action.dismiss` — en: `'Dismiss'`, beanie: `'dismiss'`. (Used as the ✕'s `aria-label`.)

Reuse the existing `medicationLog.dose` / `medicationLog.doses` for the count pill (singular when `count === 1`), and the existing `medicationLog.viewAll` / `medicationLog.showLess` for `ShowMoreToggle`.

## Files Affected

- **NEW** `src/utils/doseLimit.ts` — `getDailyDoseStatus` + `DailyDoseStatus` (delegates to `isValidDosesPerDay`).
- **NEW** `src/utils/__tests__/doseLimit.test.ts`.
- **NEW** `src/components/pod/MedicationDayHeader.vue` — dumb day-header (label + count pill + over-note); owns the over-limit orange visual.
- `src/utils/date.ts` — add `relativeDayLabel(dateStr, t)` (one-shot non-reactive today via the existing `localToday()`).
- `src/utils/__tests__/date.test.ts` — tests for `relativeDayLabel` (incl. the non-reactive-today guarantee).
- `src/components/common/EntityActivityLog.vue` — use `relativeDayLabel` (remove local `dateLabel`).
- `src/stores/medicationsStore.ts` — add `dosesOnDate`; `dosesToday` delegates; return both.
- `src/stores/__tests__/medicationsStore.test.ts` — tests for `dosesOnDate`.
- `src/components/pod/MedicationViewModal.vue` — grouped/counted/flagged log via `MedicationDayHeader`; windowing via `useExpandableList` + `<ShowMoreToggle>` (removing the bespoke `showAll` windowing + toggle).
- `src/components/pod/DoseLogConfirmModal.vue` — dismissable over-limit warning (reads `state.value.medication`, reuses the existing open-watcher + `dateValue`).
- `src/services/translation/uiStrings.ts` — new keys (`medicationLog.overNote`, `medicationLog.overWarning.title`, `medicationLog.overWarning.body`, `action.dismiss`) + edit `medicationLog.viewAll` to drop the trailing "→" (+ zh regenerated by `npm run translate`).

## Acceptance Criteria

- [ ] Drawer log is grouped by day, newest first, each header showing the day label + dose count.
- [ ] A day exceeding `dosesPerDay` shows the orange count pill + the "{over} more than the recommended {limit} a day." note.
- [ ] The over-limit pill + over-note are rendered by a single `MedicationDayHeader` component (the orange visual is not duplicated inline in the drawer template).
- [ ] "As needed" meds (and any `dosesPerDay` outside 1–4) show counts but never an over-limit flag.
- [ ] Default view shows the 3 most recent day-groups; "View all"/"Show less" (via `<ShowMoreToggle>`) toggles whole groups; counts stay accurate when collapsed; switching meds collapses back to 3. The toggle shows a single chevron (no doubled "→").
- [ ] Logging a dose that would exceed the recommendation shows the dismissable 💡 heads-up; ✕ hides it; reopening the dialog re-shows it; changing the date within the same open session after dismissing does NOT re-show it; Save works whether shown or dismissed.
- [ ] Warning is correct for a back-dated dose onto an already-full prior day.
- [ ] Pulse-on-new-dose, delete-log, empty state, last-dose caption, photo lightbox, auto-close-on-delete all still work.
- [ ] `getDailyDoseStatus` (incl. corrupt/out-of-range `dosesPerDay` → limitless), `dosesOnDate`, `relativeDayLabel` covered by unit tests; `relativeDayLabel` proven to derive "today" one-shot from the system clock at call time (via `localToday()`, non-reactive); `EntityActivityLog` unchanged in behavior.
- [ ] `npm run type-check`, `npm run lint`, `npm run validate` clean; zh regenerated; no hardcoded UI strings.

## Testing Plan

1. **Unit** — `doseLimit.test.ts`: `dosesPerDay` null/undefined/0/5/NaN → limitless (`limit: null`, never `isOver`); 1–4 with count < / = / > limit → correct `isOver`/`over`/`limit`. `medicationsStore.test.ts`: `dosesOnDate` counts only matching med + date (incl. a timezone-boundary case — a 23:30 vs 00:30 pair), and `dosesToday` still delegates correctly. `date.test.ts`: `relativeDayLabel` → today/tomorrow/yesterday/older, with a stub `t`; assert it derives "today" from the system clock at call time (e.g. via faked timers) — i.e. it does NOT depend on a passed-in or reactive today — so the `EntityActivityLog` behavior is provably preserved.
2. **Component (existing harness)** — extend `useDoseConfirm.test.ts` / a `DoseLogConfirmModal` mount: warning shows at prospective-over, hidden when within limit, hidden after ✕, re-shown on reopen, stays hidden on a post-dismiss date change within the same session, Save stays enabled throughout. Optionally a shallow `MedicationDayHeader` mount: over vs within renders the orange pill + over-note only when `status.isOver`.
3. **Manual (`npm run dev`)** — seed a med with `dosesPerDay: 3`; log 4 doses today → drawer shows "Today · ⚠ 4 doses" + note; the 4th log attempt shows the heads-up. Add doses across 2–3 prior days → groups + accurate counts; collapse/expand; switch to another med and confirm it re-collapses to 3. Set an "as needed" med (and, defensively, one with a stored `dosesPerDay: 7`) → counts only, no flag. Narrow (~390px) + wide widths; light + dark.
4. **Full** — `npm run validate` green.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the two-surface change — shared `getDailyDoseStatus` util + `dosesOnDate` store helper + extracted `relativeDayLabel`; grouped/counted/flagged drawer log with group-level truncation; dismissable selected-date-aware heads-up in the confirm dialog; i18n via the `.replace('{token}')` convention.
- **Pass 2 (DRY + error handling)**: Verified reuse against the codebase and tightened: (a) `getDailyDoseStatus` now delegates to the existing `isValidDosesPerDay` (verified `n is 1|2|3|4`) instead of re-deriving `> 0`, so the "real limit" rule can't drift and a corrupt value degrades safely to "as needed"; (b) drawer windowing now uses the standard `useExpandableList` + `<ShowMoreToggle>` primitives (ADR-025, both APIs verified) instead of a hand-rolled `showAll`/`hasMore` pair and bespoke toggle button — fewer moving parts, consistent affordance, free shrink-safety when logs are deleted; (c) corrected the confirm-modal references to `state.value.medication` (there is no `med` local) and folded the `dismissed` reset into the existing open-watcher; (d) confirmed no new try/catch is warranted (all new code is pure/derived; the only async path is already wrapped by `wrapAsync` + `useGiveDose` toasts) and that no reusable dismissable-callout component exists to reuse (the single-use orange note is correctly inlined using existing tint tokens); (e) `action.dismiss` confirmed absent → added.
- **Pass 3 (Sustainability)**: Extracted the grouped-log day header (label + count pill + over-note) into a new dumb `MedicationDayHeader.vue` so the over-limit orange visual lives in one place and the drawer template stays shallow — this change is itself the "second surface" the prior pass had deferred extraction for (the confirm-dialog callout stays inlined as a distinct banner shape). Broke the dense one-line `dayGroups` computed into a readable multi-line form. Hardened `relativeDayLabel`'s non-reactive "today" guarantee with an explicit caveat, test, and acceptance criterion. Pinned `getDailyDoseStatus`'s `limit: number | null` (don't leak the `1|2|3|4` union into a general util) and the intentionally-simple `dosesOnDate` linear scan (don't prematurely index) so neither is "optimized" into needless complexity later.
- **Pass 4 (Fresh-eyes sweep)**: Routed `relativeDayLabel`'s one-shot "today" through the existing `localToday()` sibling (DRY within `date.ts`, self-documenting non-reactive intent, byte-for-byte identical value); firmed the `medicationLog.viewAll` "→" removal from conditional to definite (verified key is used only in `MedicationViewModal`, and `ShowMoreToggle` always renders its own chevron); pinned two deliberate decisions as caveats + acceptance criteria so they aren't "fixed" later — dismiss persists for the open session across date changes, and drawer day labels are intentionally one-shot/non-reactive (matching `EntityActivityLog`). Verified all remaining references (store/composable shapes, primitive APIs, `groupByDate` signature, absent `action.dismiss`, synchronous `resetToNow` preventing a false warning off an empty date) against the codebase.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

> We should make a small improvement to the medication doses log in the medication drawer. Currently the doses are just listed in a list, but it is hard to tell at what date and how many doses were given each day. I think it would be useful to put the medications in a logical grouping by date, so it can clearly be seen how many doses were logged each day, as medications are typically prescribed for a certain number of doses per day. i would suggest there is also a warning type element indicating when more than the suggested number of doses (as captured in the medication item) has been given per day
>
> thre should also be a (dismissable) warning to the user when they attempt to log more than the required number of doses in a given day. it should not be scary - but rather informative, indicating that you are logging more than the recommended daily doses for this medication, and the relevant helpful information is provided to the user

### Follow-up 1 (after mockup presented)

> looks good, pls build a plan to implement

</details>
