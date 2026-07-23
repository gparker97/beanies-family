# Plan: Notifications #55 — confirmation-review fixes + activity reminder back-fill

> Date: 2026-07-23
> Related issues: Notion tracker #55 (no GitHub issue — direct implementation)
> Plan file: `docs/plans/2026-07-23-notifications-confirmation-review-fixes.md`
> Follows `docs/plans/2026-07-23-notifications-review-remediation.md` (the work this reviews)

## User Story

As a busy parent, I want my reminders to survive a locked app, fire near the actual pickup, and exist at all for the activities already in my calendar — so the feature is trustworthy the first time I rely on it, not after I've re-saved every activity by hand.

## Context

The #55 remediation (three slices, `87bd83ba` / `4f00ddf1` / `887e7ab6`) fixed all 16 original defects and none regressed. A confirmation `/code-review` at max effort then found **15 new defects**, several introduced _by the remediation itself_. Nothing is deployed.

The three that stop reminders working:

1. **Cold start wipes every armed reminder.** `reminderInput` is `null` until `familyStore.currentMember` exists (`useScheduledReminders.ts:319`). The `immediate: true` watch queues a reschedule at boot; `buildReminderSchedule(null, …)` returns an empty set, so `desiredIds` is empty and step 3 cancels _everything_ as stale. Opening the app at the lock screen — or being killed before decryption finishes — silently deletes every scheduled reminder. The old `if (toSchedule.length === 0 && !permissionGranted) return;` guarded exactly this; Slice C removed it to fix a different bug and did not replace the protection. **The most serious defect in the set: it destroys user-visible state on an ordinary code path, and telemetry reports `notif_count: 0` looking healthy.**
2. **Pickup duty with no `endTime` fires at 09:00.** `endTime` is optional. The duty branch anchors pickup on `a.endTime`; when absent it falls through to `allDayAnchor(date)` (`useScheduledReminders.ts:126-129`) and, because `anchorTime` is falsy, skips the lead subtraction. A parent on pickup for a 15:30 activity with no end time is told "Time to pick up — Neil" at 09:00 and gets nothing near 15:30.
3. **Onboarding still hardcodes `reminderMinutes: 0`** (`OnboardingActivity.vue:106`). A brand-new family's first activity is permanently excluded from OS reminders, and onboarding sets no duty member so the exemption doesn't save it.

Two semantic contradictions introduced by yesterday's settings work:

4. **The activity-default select labels `0` as "At the time"** (from the shared `LEAD_OPTIONS`), but for activities `0` means _None_. Choosing it silently switches every activity reminder off via a control whose label promises the opposite.
5. **`LEAD_OPTIONS` offers 120 and 180** (`reminderSchedule.ts:175`); the activity chips render neither, and `ReminderMinutes` (`models.ts:621`) has no 180 at all. Setting the default to "3 hours" leaves the editor's Reminder row blank and can persist an out-of-union value. The `as ReminderMinutes` casts added yesterday hide this from the type checker.

One cross-feature side effect:

6. **Google Calendar now double-notifies.** `activityToGoogleEvent.ts:75` maps `reminderMinutes > 0` to a `popup` override; `0` meant "no overrides", and virtually every activity was `0`. See Open Decision — the back-fill makes this corpus-wide on day one.

Plus the error-handling and telemetry gaps in Requirements, and the **greg-approved one-time back-fill**.

### greg's decision on the back-fill

> "Yes i agree to perform a one-time fix to set all existing activities with the default reminder time."

This mitigates confirmation-finding 5: every stored activity carries `reminderMinutes: 0` (the modal's default for the app's whole life), so under "0 = None" none would ever produce a generic reminder.

## Requirements

### A. Stop losing reminders

1. A reschedule triggered before family data is ready (`reminderInput === null`) must **not** cancel anything, **not** prompt for permission, and **not** emit a success event. "Not ready" and "ready, nothing to schedule" are different states.
2. A duty role only fires when it has its own anchor — drop-off on `startTime`, pickup on `endTime`. A role with no anchor emits nothing rather than falling back to the all-day anchor.
3. The all-day (09:00) anchor applies only to genuinely untimed activities, never as a fallback for a missing `endTime`.
4. The generic activity reminder is suppressed when at least one duty role **had its own anchor** — so a pickup-only parent on an activity with no `endTime` still gets the generic "coming up" reminder, **unless the activity itself says None**. A role that has an anchor but is already ticked off, or whose fire time has passed, still suppresses the generic reminder (today's "don't nag" rule).
5. A failed `schedule()` must still run the cancel-stale step.
6. **Sign-out explicitly cancels every pending reminder.** The not-ready guard removes the accidental cancel that does this today, and the alarms carry family content.

### B. Make the defaults coherent

6. Activities get their own lead **value** list, shared by the Settings default select and the `ActivityModal` chips so the two can never diverge: `[0, 15, 30, 60, 1440]`, with `0` meaning **None** on both. Label _register_ stays per-surface (chips short, selects sentence-form).
7. `OnboardingActivity.vue` seeds `reminderMinutes` from `settingsStore.activityReminderLead`.
8. No code path can persist a `reminderMinutes` outside the `ReminderMinutes` union; the coercion happens once, at the single store read site.

### C. Back-fill the existing corpus (greg-approved)

9. A one-time, idempotent, family-scoped migration sets `reminderMinutes = DEFAULT_ACTIVITY_LEAD` (30) on eligible activities currently at `0`.
10. It runs **once per family**, guarded by a synced marker, so a second device does not re-apply it over a later deliberate "None".
11. It never blocks app start, never throws into the boot path, reports its outcome, and **never touches finance data**.
12. It excludes multi-day all-day spans and vacation-linked activities (see Important Notes — they would fire one 09:00 reminder per trip day).

### D. Honest error handling and telemetry

13. `ensureChannel()` short-circuits to success off Android (channels are an Android concept; `createChannel` is unimplemented on iOS), and its result gates the schedule on Android.
14. `notif_count` reports what was **actually armed** — `0` when permission was denied or the schedule was skipped.
15. A failed permission check sets `notificationPermission` to `'unknown'` rather than leaving a stale `'granted'`.
16. The configured activity default is emitted, since it decides whether activity reminders exist at all.
17. Intentionally-filtered items (None gate, audience gate, traveller filter, anchorless duty) are counted separately from thrown-exception skips.

### F. Google Calendar

19. Synced Google Calendar events carry **no** reminder override, and `reminderMinutes` is removed from the push hash so a reminder edit never re-pushes an identical event.

### G. Android notification icon

20. Android notifications show the beanie-bell, not Android's stock "i" glyph. The plugin falls back to `android.R.drawable.ic_dialog_info` when no small icon is configured (`LocalNotificationManager.java:469`) — nothing configures one today, which is why every beanies notification carries the generic info icon.

### E. Changelog

18. `CHANGELOG.md` covers the settings restructure and the back-fill, stating plainly that a deliberate "None" may have been reset.

## Important Notes & Caveats

- **The back-fill must NOT go through `activityStore.updateActivity`.** That action calls `syncLinkedRecurringPayment(result)` (`activityStore.ts:557`), which reaches `updateRecurringItem(existingItemId, itemData)` with `isActive: true` hardcoded (`utils/linkedRecurringItem.ts:65,71`) and recomputed `amount`/`startDate`/`dayOfMonth`. A corpus-wide back-fill through it would **re-activate every deactivated linked recurring payment and reset its amount and dates** — a reminders migration silently rewriting financial data. Use a single batch patch instead (see Approach 5).
- **The back-fill cannot distinguish "old default" from "deliberately None".** Both are `0`. A user who genuinely chose None will have it set to 30. greg approved this; it is the only way to rescue the corpus. **Say it plainly in the changelog** — a silently-changed setting the user chose is worse than the bug if they aren't told.
- **The back-fill writes `DEFAULT_ACTIVITY_LEAD` (the constant), NOT the device's `activityReminderLead`.** Activities are family-shared; the device pref is per-device. Using the pref would make the result depend on which device ran the migration.
- **`vacationStore.ts:153` keeps its hardcoded `reminderMinutes: 0`, and the back-fill skips vacation-linked activities.** Vacation calendar entries are multi-day all-day spans; `expandOneOff` (`activityStore.ts:211-232`) yields one occurrence per day, so a non-zero lead means one 09:00 buzz per trip day. That `0` is deliberate, not the stale modal default.
- **Do NOT extend `migrateDoc`** (`worker/docOps.ts:37-44`). It runs from both `loadDoc` (`:47`) and `applyChanges` (`:69`) — i.e. on every merge — and has no once-per-family guard, so a data back-fill there would re-apply after merging from an unmigrated device, permanently overriding later "None" choices.
- **`createChannel` is unimplemented on iOS** (`LocalNotificationsPlugin.swift:640-642` is `call.unimplemented()`) and throws on web (`dist/esm/web.js:53-55`). So `ensureChannel()` currently throws on iOS on **every reschedule**, emitting a `warning` each time — pre-existing log noise that also buries a real Android channel failure in the same bucket. Gating the schedule on its result without a platform guard first would leave iOS with **zero** reminders forever.
- **Cancel-after-failed-schedule is safe.** "Stale" is `pending − desired`. Alarms for items still wanted are in `desiredIds` and are never cancelled; only genuinely-removed items are. Cancelling after a failed schedule removes exactly what should go and keeps what should stay — strictly better than the current early return, which makes the surplus permanent.
- **`MAX_SCHEDULED = 60` is not being changed**, but the back-fill materially raises its occupancy — see Approach 9.
- **There is no family-settings `persistSetting` helper.** `persistGlobalSetting` (`settingsStore.ts:450`) writes _device_ `GlobalSettings`. Every family setter (`setOnboardingCompleted` `:552`, `setWeekStartDay` `:560`) swallows its failure into `error.value` with no report and no re-throw — do **not** copy that pattern (see Approach 5).
- **`reminderMinutes` stays required in `FamilyActivity`.** The back-fill changes values, not the schema.
- **iOS remains unverified.** Apple org enrolment is still blocked.

## Assumptions

> **Review these before implementation.**

1. `familyStore.currentMember` being `null` is the only reason `reminderInput` returns `null` (`useScheduledReminders.ts:319`). The guard therefore lives on the `null` input, not on a `currentMember` check, so a future early-return is covered automatically.
2. Family `Settings` (synced via the `.beanpod`) is the right home for the back-fill marker — the same store as `onboardingCompleted`, likewise a once-per-family lifecycle flag.
3. `LocalNotifications.schedule()` is all-or-nothing per call, so a rejection means nothing in that batch was armed.
4. Activities are the only entity needing a back-fill; to-dos and travel take their leads from device settings and store no per-item lead.
5. Two devices online simultaneously both running the back-fill is safe: the patches are identical and the marker converges under Automerge. The residual race is a device offline since before the migration — it runs its own back-fill against a stale doc and, on merge, can overwrite a deliberate "None" chosen elsewhere in the interim. Narrow and accepted (bounded to one merge window, unlike the `migrateDoc` objection which would recur forever).

## Approach

### 1. The not-ready guard, on a testable seam (req 1)

`useLocalNotifications.test.ts` deliberately tests only exported seams — the module docstring says the split exists so both failure directions are testable _"with no Pinia, no Vue watch and no fake timers"_. Putting the guard inside the closure-local `reschedule()` would place the single most important regression in this change outside that seam. So extract the whole reschedule body:

```ts
/** Steps 0-4 of one reschedule. Exported so the not-ready guard — the regression
 *  that silently deleted every armed reminder on cold start — is testable with a
 *  plain `ReminderInput` fixture, no Pinia and no Vue watch. */
export async function runRescheduleFor(
  input: ReminderInput | null,
  prefs: ReminderPrefs,
  now: Date
): Promise<void> {
  // "Not ready" is NOT "nothing to schedule". Until the family doc is loaded and a
  // current member exists, `reminderInput` is null and the desired set is empty —
  // reconciling against it would cancel every armed reminder on the device. This
  // happens on every cold start (lock screen, killed before decryption). Returns
  // BEFORE the permission check too: prompting a locked-out user is wrong.
  // Deliberately emits nothing: a `notif_count: 0` here is the exact misleading
  // signal that made this bug invisible.
  if (input === null) return;
  const { reminders, truncated, skipped, gated } = buildReminderSchedule(input, now, prefs);
  const toSchedule = buildScheduledNotifications(reminders);
  const granted = await ensureNotificationPermission(toSchedule.length > 0);
  await reconcileScheduled(toSchedule, granted, {
    truncated,
    skipped,
    gated,
    todoLead: prefs.todoReminderLead,
    activityLead: prefs.activityReminderLead,
  });
}
```

Update the module docstring with the post-change call graph and the invariant that must never be removed again:

```
 * Entry points, outermost first:
 *   watch(reminderInput, prefs) → queueReschedule (debounce)
 *     → runReschedule (in-flight/rerun guard — never call reschedule directly)
 *       → runRescheduleFor(input, prefs, now)   ← EXPORTED SEAM. Holds the
 *         not-ready guard: `input === null` means the family doc isn't loaded,
 *         which is NOT "nothing to schedule". Reconciling against an empty
 *         desired set cancels every armed alarm on the device. Do not remove.
 *         → reconcileScheduled(...)             ← EXPORTED SEAM: schedule,
 *           cancel-stale, refresh exact-alarm, emit `reschedule`.
```

The composable's `reschedule()` collapses to `runRescheduleFor(reminderInput.value, prefs.value, new Date())`. The `immediate: true` watch still fires; it no-ops until the input materialises and re-runs the moment `currentMember` lands. `__resetLocalNotificationsForTesting()` needs no new state.

**Accepted trade, and the compensating change.** The guard blocks the "cancel everything" path while the doc is unloaded. Turning reminders off _in-session_ still cancels immediately (the input is non-null then), and a stale alarm during a lock-screen cold start is recoverable noise.

**Sign-out is not** — and today's cancel-on-sign-out is _accidental_: it works only because `currentMember` goes null, the desired set empties, and step 3 cancels the world. Nothing else in the app cancels local notifications (verified: no `LocalNotifications` reference outside `useLocalNotifications.ts` / `useNotificationPermission.ts`; neither `authStore.signOut()` `:1258` nor `signOutAndClearData()` `:1413` touches them). Removing that side effect without a replacement would leave activity titles and resolved member names firing on the lock screen of a device the user has just signed out of and wiped. So the guard ships **with** an explicit replacement:

```ts
/** The explicit replacement for the cancel the not-ready guard removes.
 *  Sign-out is the ONE case where "no family data" must mean "cancel", not
 *  "wait": pending alarms carry activity titles and member names, and
 *  signOutAndClearData() promises the device is clean. */
export async function cancelAllScheduledReminders(): Promise<void> {
  if (!isNative()) return;
  try {
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length > 0) {
      await LocalNotifications.cancel({
        notifications: pending.notifications.map((n) => ({ id: n.id })),
      });
    }
  } catch (e) {
    reportError({
      surface: 'local-notifications-schedule',
      severity: 'warning',
      message:
        'failed to cancel reminders on sign-out; family content may remain on the lock screen',
      error: e,
      context: { notif_error_stage: 'cancel_all' },
    });
  }
}
```

Awaited in **both** `authStore.signOut()` and `signOutAndClearData()`, before store teardown. The plugin import stays in this module, so the "only two modules import `@capacitor/local-notifications`" invariant holds.

### 2. Duty anchors and exclusivity (req 2-4)

`resolveOsActivityLead(…, isDuty: true, …)` returns `defaultLead` rather than `null` even for `reminderMinutes === 0` (`reminderSchedule.ts:129-138`). So a naive `if (dutyEmitted > 0) continue;` would let a duty-holder whose role has no anchor fall through to the generic branch **carrying the duty-exemption lead** — emitting a reminder on an activity the user set to "None". Compute both leads:

```ts
// Two leads, one helper, no new logic: the duty exemption applies ONLY to duty
// reminders. `ownLead === null` is the chip's "None" and still suppresses the
// generic reminder — otherwise a pickup-only parent on a None activity with no
// endTime would fall through and get a reminder they switched off.
// No `!` on dutyLead: it is non-null only because of a branch inside
// resolveOsActivityLead (:136) the compiler can't see. The `dutyLead === null`
// skip in the loop is dead today and stays as the fail-loud seam — an assertion
// here would turn a future edit into minusMinutes(at, undefined) → NaN.
const ownLead = resolveOsActivityLead(a.reminderMinutes, false, prefs.activityReminderLead);
const dutyLead = resolveOsActivityLead(a.reminderMinutes, true, prefs.activityReminderLead);

// A duty fires on its OWN time — dropoff at startTime, pickup at endTime.
// A role with no anchor emits nothing: falling back to the 09:00 all-day anchor
// would tell a parent to collect their child at breakfast.
// Count roles that HAVE an anchor, not roles that emitted. Three different
// reasons a role emits nothing must NOT be conflated:
//   • no anchor      → fall through to the generic reminder (the bug being fixed)
//   • already ticked → stay suppressed (today's "don't nag" rule)
//   • fireAt in past → stay suppressed (nothing to say)
// Counting emissions would resurrect a generic reminder the moment a parent
// ticks their drop-off off — a new nag introduced by the fix for a different bug.
let dutyAnchored = 0;
for (const role of ctx.dutyRoles) {
  const anchorTime = role === 'dropoff' ? a.startTime : a.endTime;
  if (!anchorTime) { gated++; continue; }
  dutyAnchored++;
  if (isDutyDone(role === 'dropoff' ? a.dropoffCompletions : a.pickupCompletions, date)) continue;
  const at = localDateTime(date, anchorTime);
  if (!at) continue;
  if (dutyLead === null) continue;   // dead today; the fail-loud seam, see below
  const fireAt = minusMinutes(at, dutyLead);
  if (fireAt.getTime() <= nowMs) continue;
  out.push({ id: activityReminderId(a.id, date, role), fireAt, title: ctx.title, body: …, kind: 'activity' });
}
// Suppress the generic reminder only when a duty role actually had an anchor.
if (dutyAnchored > 0) continue;
if (ownLead === null) { gated++; continue; }   // the chip says "None"
```

Delete the standalone `if (lead === null) continue;` at `useScheduledReminders.ts:114` — it moves below the duty block. The generic branch keeps the all-day anchor, now reachable only for genuinely untimed activities.

**Extract the decision before adding to it.** `buildActivityReminders` is already `for (dates) → for (occurrences) → try → if(duty) for(roles)`; the changes above would take it to five levels and ~70 lines with six `continue`s meaning different things. And this exact rule — "does the duty exemption suppress the generic reminder, and does None still win" — has now been got wrong **twice** (once in the remediation, once in this plan's own Pass-1 draft). Lift the per-occurrence body into a pure exported function so the loop is iteration + try/catch only:

```ts
/** Reminders for ONE activity occurrence. Pure and exported so the
 *  duty/None/anchor rules — the part of #55 that has regressed twice — are
 *  unit-testable from a single activity + date, with no occurrence-map
 *  fixture. `buildActivityReminders` becomes iteration + try/catch only. */
export function remindersForActivityOccurrence(
  a: FamilyActivity,
  date: string,
  ctx: ActivityReminderContext,
  prefs: ReminderPrefs,
  nowMs: number,
  t: (k: UIStringKey) => string
): { reminders: ScheduledReminder[]; gated: number };
```

`buildActivityReminders` collapses to: window check → `try { activityReminderContext → relevant gate → remindersForActivityOccurrence(...) → accumulate } catch { skipped++ }`. The `try` **must still wrap `activityReminderContext`** — it dereferences assignees, `location` and the audience classifier on unvalidated CRDT data, and moving it outside would turn one malformed activity from a `skipped++` into an aborted whole build. Nesting drops from five levels to three, and the twice-regressed rule gets a direct unit test.

### 3. Shared activity lead VALUES (req 6)

The divergence bug is the value list, not the wording — the two surfaces use deliberately different registers: chips are short (`planner.reminder.15min` = "15 min", `uiStrings.ts:8119-8123`), selects are sentence-form (`formatLeadLabel` → "15 minutes before"). Mapping chips through the select formatter would put five sentence-length strings into a chip row approved yesterday and orphan four i18n keys.

```ts
export const ACTIVITY_LEAD_OPTIONS = [
  0, 15, 30, 60, 1440,
] as const satisfies readonly ReminderMinutes[];

/** Chip labels (short register — the ActivityModal chip row). An exhaustive
 *  record over ACTIVITY_LEAD_OPTIONS, so adding a value is a COMPILE ERROR
 *  until its key exists. */
export const ACTIVITY_LEAD_CHIP_KEYS: Record<(typeof ACTIVITY_LEAD_OPTIONS)[number], UIStringKey> =
  {
    0: 'planner.reminder.none',
    15: 'planner.reminder.15min',
    30: 'planner.reminder.30min',
    60: 'planner.reminder.1hour',
    1440: 'planner.reminder.1day',
  };
```

**One formatter, with the divergence at the call site.** Do NOT add a `formatActivityLeadLabel`: it would have the identical signature `(number, t) => string` to `formatLeadLabel`, so importing the wrong one is a silent mislabel the compiler cannot catch — which is confirmation-finding 4, reintroduced by an autocomplete. Give the existing formatter an explicit zero-label instead:

```ts
/** …existing docstring…
 *  `zeroLabelKey` is the ONE domain difference: for a to-do or a flight `0`
 *  means "at the event time"; for an ACTIVITY it means "no reminder". Passing
 *  it makes that choice visible at the call site instead of hiding it behind a
 *  near-identical second function. */
export function formatLeadLabel(
  minutes: number,
  t: (key: UIStringKey) => string,
  zeroLabelKey: UIStringKey = 'reminders.lead.atTime'
): string {
  if (minutes <= 0) return t(zeroLabelKey);
  // …unchanged…
}
```

`RemindersSettings.vue`'s activity row passes `'planner.reminder.none'`; travel and to-do rows call it unchanged. Net: **no new export**, and the semantic divergence is one visible argument rather than a naming near-collision.

Add to `LEAD_OPTIONS`'s docstring: _"NOT for activities — see `ACTIVITY_LEAD_OPTIONS`. This list includes 120/180, which are real travel leads but are not offered on activity chips; 180 is not even in the `ReminderMinutes` union."_ The names read as general-vs-specific, which is the trap that produced confirmation-finding 5.

`satisfies readonly ReminderMinutes[]` makes an out-of-union value a compile error. `ActivityModal`'s `reminderChipOptions` becomes `ACTIVITY_LEAD_OPTIONS.map((m) => ({ value: String(m), label: t(ACTIVITY_LEAD_CHIP_KEYS[m]) }))` — duplicated list gone, wording unchanged, no orphaned keys.

**Only the activity row** in `RemindersSettings` uses these. Travel and to-do rows keep `LEAD_OPTIONS` + `formatLeadLabel`: there `0` genuinely means "at the time", and 120 is a real flight lead (`DEFAULT_TRAVEL_LEADS` is 120, `reminderSchedule.ts:163-169`), so narrowing that list would break travel defaults.

### 4. Coerce once, in the store getter (req 7, 8)

The `as ReminderMinutes` cast appears at **two** sites already (`ActivityModal.vue:128` and `:315`), and requirements 7 + §3 would add two more. Sprinkling a helper at four call sites is the duplication this pass exists to remove, and any future consumer starts unguarded. There is one read site every consumer goes through, and the codebase already establishes coalescing there — see the `aiTier` getter comment (`settingsStore.ts:49-53`).

```ts
// settingsStore.ts — the single read site every consumer goes through, exactly
// as `aiTier` coalesces there. A pref written by an older build (LEAD_OPTIONS
// offered 180, which is not in ReminderMinutes) is narrowed HERE, so no
// consumer needs a cast or a guard.
const activityReminderLead = computed<ReminderMinutes>(() =>
  toActivityLeadOption(globalSettings.value.activityReminderLead ?? DEFAULT_ACTIVITY_LEAD)
);
```

with `toActivityLeadOption` in `reminderSchedule.ts`:

```ts
/** Snap a persisted lead to one of the values the activity UI actually OFFERS
 *  (`ACTIVITY_LEAD_OPTIONS`), falling back to the default. NOTE: this is
 *  NARROWER than the `ReminderMinutes` union, which still admits 5/10/120 — so
 *  do NOT apply it to `activity.reminderMinutes`, it would rewrite a legitimate
 *  stored 120 to 30. Named for the option list, not the type, for that reason. */
export function toActivityLeadOption(value: number): ReminderMinutes {
  return (ACTIVITY_LEAD_OPTIONS as readonly number[]).includes(value)
    ? (value as ReminderMinutes)
    : DEFAULT_ACTIVITY_LEAD;
}
```

That deletes the casts at `ActivityModal.vue:128` and `:315`, makes `OnboardingActivity.vue:106` a plain `reminderMinutes: settingsStore.activityReminderLead`, and stops the activity select rendering blank on a device that stored 180. `setActivityReminderLead` keeps its `number` signature — the getter is the guard.

A **third** cast lives in the chip handler (`ActivityModal.vue:1092`, `Number($event) as ReminderMinutes`) — the store getter cannot reach it, the value arrives as a string from the chip row. Route it through the same helper: `@update:model-value="reminderMinutes = toActivityLeadOption(Number($event))"`. Since the chips are now generated from `ACTIVITY_LEAD_OPTIONS`, this is a total function over every value the control can emit, and requirement 8 holds with no cast anywhere.

### 5. The back-fill (req 9-12)

Follows the codebase's existing one-time family-data normalization precedent, `familyStore.normalizeRoles` (`familyStore.ts:350-375`): a **single atomic `{ op: 'batch', ops }` mutate**, `reportError` on rejection. `MutationOp` supports `batch` (`worker/protocol.ts:73`) and `patch` (`:43-58`); `deleteRecipeCascade` (`recipeRepository.ts:31-42`) is the repository-level template.

**One deletable module.** The migration is a one-shot; it must be removable in a single commit, not unpicked from six long-lived files. All of its rules live in **`src/utils/activityReminderBackfill.ts`** (new, ~40 lines) — _not_ in `reminderSchedule.ts`, which is the live scheduling-rules module shared by the in-app deriver and the OS scheduler and must not accumulate archaeology. The one-new-file cost buys a one-commit deletion.

```ts
/**
 * ONE-SHOT MIGRATION — #55, shipped 2026-07. Sets `reminderMinutes` to
 * DEFAULT_ACTIVITY_LEAD on activities still carrying the old modal default of 0.
 *
 * RETIREMENT: delete this file, `activityStore.backfillReminderMinutes()`, its
 * call in App.vue and its tests once the `notif_backfilled` telemetry has
 * stopped appearing fleet-wide for ~90 days (i.e. every active family has run
 * it). DELETE THE CODE FIRST AND LEAVE `Settings.activityReminderBackfilledAt`
 * IN PLACE — removing the marker field while any device still runs an old build
 * would re-run a corpus-wide mutation. Mark the field `@deprecated` instead.
 */
/** Back-fill candidates: `reminderMinutes === 0` AND a single-occurrence-per-day
 *  shape. Multi-day all-day spans are EXCLUDED — `expandOneOff`
 *  (activityStore.ts:211-232) yields one occurrence per day, so a back-filled
 *  10-day trip would fire ten consecutive 09:00 reminders. Vacation-linked
 *  activities are excluded outright: they render as trip cards, not planner rows,
 *  and travel already has its own reminders (vacationStore.ts:153 sets 0
 *  deliberately). */
export function selectActivitiesToBackfill(activities: FamilyActivity[]): FamilyActivity[] {
  return activities.filter(
    (a) =>
      a.reminderMinutes === 0 && !a.vacationId && !(a.isAllDay && a.endDate && a.endDate !== a.date)
  );
}
```

**Repository** — `activityRepository.backfillActivityReminders(ids)`: one `mutate({ op: 'batch', ops }, { quiet: true })` of `{ op: 'patch', collection: 'activities', id, patch: { reminderMinutes: DEFAULT_ACTIVITY_LEAD }, onMissing: 'skip' }`. `onMissing: 'skip'` tolerates a concurrent delete. **`{ quiet: true }` is mandatory**: `mutate` is in `USER_ACTION_METHODS` (`docClient.ts:419`), so without it a rejection fires the "We couldn't update your data" toast at boot for a maintenance write the user never asked for — the same reason `normalizeRoles` passes it (`familyStore.ts:365`).

**Store action** — `activityStore.backfillReminderMinutes({ canEdit })` owns orchestration per MVO: pre-conditions → select → repository batch → patch `activities.value` in one immutable pass → ask `settingsStore` to persist the marker. **It must not call `updateActivity`** (see Important Notes — finance mutation) **and must not go through `wrapAsync`**: that sets the shared `isLoading` (flashing the planner skeletons at boot), writes `error.value`, and error-toasts by default. This action owns its own single try/catch, exactly like `familyStore.normalizeRoles` (`familyStore.ts:352-380`), which is also a load-path migration and also bypasses `wrapAsync`.

**Two pre-conditions, both returning WITHOUT writing the marker** so a skipped run stays retryable:

- `activityStore.activities.length === 0` — an empty list at boot is indistinguishable from "still settling"; burning the one-shot on it would leave the corpus dark forever behind a marker saying it was done.
- `canEditActivities` is **false** (`usePermissions.ts:37-39`) — a limited member's device must not silently rewrite family-shared data; an owner/pod-manager device runs it on its next boot. **The flag is passed IN, not derived in the store**: `usePermissions()` registers a `watch` on every call (`usePermissions.ts:42`), so invoking it from a Pinia action (outside any effect scope) leaks a watcher per boot and drags `authStore` into `activityStore`. Take the composable in `App.vue`'s setup body and pass the boolean: `activityStore.backfillReminderMinutes({ canEdit: canEditActivities.value })`. The action stays directly unit-testable with no permission mocking.

**Marker last, and zero candidates still marks.** If the app dies mid-migration the marker is unset and the next run resumes; because the batch selects only `reminderMinutes === 0`, a re-run is a no-op. A family with **no** candidates (created after this ships, or already migrated on another device) skips the mutate entirely — no empty `batch` round-trip, mirroring `normalizeRoles`'s `if (ops.length)` (`familyStore.ts:365`) — but **still writes the marker**, so it doesn't re-select on every boot forever. The two pre-conditions above are the only paths that return _without_ marking.

**Marker setter — keep it dumb.** Do not add a fifth error contract to `settingsStore` (it already has `persistDualSetting`, `persistAiSetting`, `persistGlobalSetting`, and the silent family setters). A migration-specific `surface` string has no business living in the settings store — it would be stranded there when the migration is deleted. The setter is a plain, throwing one-liner:

```ts
// No try/catch by design: the ONE caller (the back-fill) owns classification,
// and the migration's `surface` must not outlive the migration.
async function setActivityReminderBackfilledAt(iso: string): Promise<void> {
  settings.value = await settingsRepo.saveSettings({ activityReminderBackfilledAt: iso });
}
```

The rejection propagates to `activityStore.backfillReminderMinutes()`'s single catch, which does the `reportError({ surface: 'activity-reminder-backfill', severity: 'error', context: { notif_error_stage: 'backfill' } })` and leaves the marker unset so the next boot retries. One catch, one place to look, nothing left behind at deletion time. (Adding the missing `persistFamilySetting` mirror to fix the pre-existing silent family setters is a follow-up, out of scope here.)

`Settings` (family-synced, `models.ts`) gains `activityReminderBackfilledAt?: string`.

**Trigger:** `App.vue`'s post-init block, inside the existing `if (!docLoaded) return;` gate (`App.vue:1092`), alongside the exchange-rate refresh. Fire-and-forget with a `.catch` — never blocks or breaks boot. **Exactly one line**, calling one store action.

_Deliberately NOT the store-load path_, unlike the two existing migration precedents (`familyStore.ts:177` `normalizeRoles`, `assetsStore.ts:183` `migrateLinkedLoanAccounts`). Both of those are self-healing and permission-free. This one needs `canEditActivities`, which resolves from `familyStore.currentMember`; `activityStore.loadActivities()` can complete before that lands, so a load-path trigger would take the `!canEditActivities` early return on the only run it gets that session and silently never retry. The post-init block is the first point where both the activity list and the member are known-ready. Recorded here so the next reviewer doesn't "fix" it back into the store.

### 6. Honest failure and counts (req 5, 13, 14)

- **Make `ensureChannel()` platform-honest first:** `if (getPlatform() !== 'android') return true;` at the top. This alone removes a `warning` fired on every iOS reschedule today. **Do NOT latch `channelReady` here** — it is module state cleared only by `__resetLocalNotificationsForTesting()`, so latching it off a _platform_ check means a suite that switches platform mid-run never re-enters `createChannel` and reports a false green on the one guard protecting Android from silently dropping every reminder. The check is two string comparisons; just re-run it.
- **Then gate on it, inside the same guard.** Move `ensureChannel()` out of the schedule `try` but keep it **inside** the `if` — it never throws (it catches and reports internally), and it does not latch `channelReady` on failure, so calling it on runs with nothing to schedule would emit a fresh `critical` on every debounced reschedule for a broken-channel device, where today it emits none:

```ts
let armed = 0;
if (granted && toSchedule.length > 0) {
  const channelOk = await ensureChannel(); // never throws; owns its own reporting
  if (channelOk) {
    try {
      await LocalNotifications.schedule({ notifications: toSchedule });
      armed = toSchedule.length;
      scheduleFailureToasted = false; // recovered
    } catch (e) {
      /* report critical + one-per-session toast, NO `return` — step 3 must still run */
    }
  }
}
```

- **Remove the `return`** from the schedule catch so cancel-stale always runs.
- **Step 4 emits `notif_count: armed`**, so a denied/failed/channel-less device reports `0`.

### 7. No stale permission state (req 15)

`ensureNotificationPermission`'s catch (`useNotificationPermission.ts:62-71`) sets `notificationPermission.value = 'unknown'` before returning false. `'unknown'` is honest and, unlike a stale `'granted'`, can't make the Settings nudge lie by omission.

### 8. Telemetry (req 16, 17)

Two new context keys, both PII-free integers:

- `notif_activity_lead` — the device's configured activity default. It decides whether activity reminders exist at all.
- `notif_gated` — count of items intentionally filtered (None gate, hidden audience, traveller subset, anchorless duty). Deliberately distinct from `notif_skipped` (thrown exceptions): conflating "we chose to drop this" with "this record is malformed" would make both useless.

A third key, `notif_backfilled`, carries the migration's migrated count — see the Observability table for why it is not a reuse of `notif_count`.

Introduce the builder result type once rather than widening three inline shapes (a fourth counter later is then a one-line change in one place):

```ts
export interface ReminderBuildResult {
  reminders: ScheduledReminder[];
  /** Dropped by a THROWN error — a malformed record. Actionable: data bug. */
  skipped: number;
  /** Dropped by a RULE — activity says None, hidden audience, non-traveller,
   *  anchorless duty. Expected: NOT a bug. Conflating the two makes both
   *  useless, which is why they are separate keys. */
  gated: number;
}
```

All three builders return `ReminderBuildResult`; `buildReminderSchedule` sums both counters in its existing single reduce. Likewise name `reconcileScheduled`'s `meta` bag — it goes from 3 fields to 5 in this plan — as an exported `ReconcileMeta` interface with one line of doc per field, so the next addition is a type edit rather than an inline widening at three sites.

Destinations (all **three** keys): `src/utils/diagnosticContext.ts` (beside the existing `notif_*` block), `infrastructure/lambda/telemetry/index.mjs` + its pinned test, and the prose enumeration in `docs/runbooks/native-store-submission.md:34`. Also record the semantic change there: _"From 2026-07, `notif_count` on the `reschedule` event is the count actually ARMED, not the count desired. Pre-2026-07 data is not comparable. On the `notif_error_stage: 'schedule'` error event it remains the count ATTEMPTED — so every fleet aggregate over `notif_count` must filter on message/`notif_error_stage`."_ A metric that silently changes meaning is the classic six-months-later misread. **`PrivacyInfo.xcprivacy`, `web/src/pages/privacy.astro` and Play Data Safety are category-level declarations** (Other Diagnostic Data) with no per-key list — verified, `grep notif_` returns nothing in any of the three — so they already cover these keys and need no edit. Recorded here so the next reviewer doesn't re-open it.

### 9. `MAX_SCHEDULED` — document, don't change

Add a comment at `useScheduledReminders.ts:46` recording (a) why earliest-first truncation is acceptable — the 14-day window rolls forward and `queueReschedule` runs on every foreground, so a dropped far-out reminder is armed once it comes into range — and (b) that 60 is an iOS ~64-pending ceiling, not arbitrary.

Also record that **the back-fill materially raises occupancy**: before it, `resolveOsActivityLead` gated out essentially the entire corpus, so truncation was near-theoretical; after it, five daily recurring activities alone fill 70 slots in a 14-day window. The self-healing argument is unchanged, but `notif_truncated: true` becomes a routine signal rather than an alarm — say so, or the first CloudWatch look reads it as a regression.

### 10. Android notification icon (req 20)

Android renders the notification small icon as a **silhouette from the alpha channel only** — colour is discarded and the system tints it. A full-colour PNG becomes a white blob, which is the usual version of this bug. So the asset must be a flat single-shape mark, and a `VectorDrawable` is the right form: one file, crisp at every density, no PNG buckets.

The beanie-bell is already monoline `currentColor` paths (`BeanieBellIcon.vue`), so it ports directly — same 40×40 viewport, strokes thickened slightly for legibility at 24dp, the 50%-opacity centre line dropped (opacity variation muddies a silhouette) and the `<circle>` pom expressed as a path (`VectorDrawable` has no circle element).

- `android/app/src/main/res/drawable/ic_stat_beanie_bell.xml` — the drawable.
- `capacitor.config.ts` — `plugins.LocalNotifications.smallIcon: 'ic_stat_beanie_bell'` plus `iconColor: '#F15D22'` (Heritage Orange) for the accent Android draws alongside it.

Applies to **every** notification the app posts, not just reminders.

### 11. `CHANGELOG.md` (req 18)

Entries for the settings restructure (Reminders card/drawer, Discord CTA, configurable activity default) and — plainly — the back-fill, including that a deliberate "None" may have been reset.

## Files Affected

**Created**

- `android/app/src/main/res/drawable/ic_stat_beanie_bell.xml` — notification small icon (alpha-only silhouette)
- `src/utils/activityReminderBackfill.ts` — the one-shot selector + its retirement contract (one deletable module, not smeared across the scheduling core)
- `src/utils/__tests__/activityReminderBackfill.test.ts`

**Modified**

- `src/composables/useLocalNotifications.ts` — exported `runRescheduleFor` + `ReconcileMeta` + not-ready guard; platform-honest `ensureChannel`; channel gate; `armed` count; no early return on schedule failure
- `src/composables/useScheduledReminders.ts` — `remindersForActivityOccurrence` extraction, `ownLead`/`dutyLead` split, per-role anchors, emitted-driven exclusivity, `ReminderBuildResult` + `gated` counter, `MAX_SCHEDULED` comment
- `src/composables/useNotificationPermission.ts` — `'unknown'` on a failed check
- `src/utils/reminderSchedule.ts` — `ACTIVITY_LEAD_OPTIONS`, `ACTIVITY_LEAD_CHIP_KEYS`, `formatLeadLabel` gains `zeroLabelKey`, `toActivityLeadOption`
- `src/services/automerge/repositories/activityRepository.ts` — `backfillActivityReminders(ids)` batch patch
- `src/stores/activityStore.ts` — `backfillReminderMinutes()` action
- `src/stores/settingsStore.ts` — `activityReminderLead` getter narrows via `toActivityLeadOption`; `activityReminderBackfilledAt` getter + plain throwing setter
- `src/types/models.ts` — `Settings.activityReminderBackfilledAt`
- `src/components/planner/ActivityModal.vue` — chips from the shared constant; both `as ReminderMinutes` casts deleted
- `src/components/settings/RemindersSettings.vue` — activity row uses the activity options + label
- `src/components/onboarding/OnboardingActivity.vue` — seed from the configured default
- `src/App.vue` — `usePermissions()` in setup; fire-and-forget back-fill in the post-load block
- `src/stores/authStore.ts` — `await cancelAllScheduledReminders()` in `signOut()` and `signOutAndClearData()`
- `src/utils/diagnosticContext.ts`, `infrastructure/lambda/telemetry/index.mjs` (+ pinned test), `docs/runbooks/native-store-submission.md` — two new keys
- `capacitor.config.ts` — `LocalNotifications.smallIcon` + `iconColor` (nothing configured one, hence the stock "i")
- `src/utils/calendar/activityToGoogleEvent.ts` — `buildReminders` always returns empty overrides; `reminderMinutes` out of `computePushHash`
- `CHANGELOG.md`

**Tests modified**

- `src/composables/__tests__/useScheduledReminders.test.ts` — pickup-without-endTime, None-suppresses-generic, exclusivity-on-emitted, `gated`
- `src/composables/__tests__/useLocalNotifications.test.ts` — not-ready guard via `runRescheduleFor`, channel gate, `armed` count, cancel-after-failure
- `src/utils/__tests__/reminderSchedule.test.ts` — `ACTIVITY_LEAD_OPTIONS`, `toActivityLeadOption`, `formatLeadLabel` zero-label
- `src/stores/activityStore.test.ts` — `backfillReminderMinutes` batch + marker ordering

The back-fill's _plumbing_ (repository batch, store action) lives in the existing layers; only its **rules** get their own module, so retirement is a single-commit deletion.

## Observability Coverage

**Events changed:**

| Event                    | Level      | Context                                                                      | Why                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------ | ---------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reschedule`             | `info`     | `notif_count` now = **armed**, `+ notif_activity_lead`, `+ notif_gated`      | Removes the phantom count on denied/failed devices; explains "activity reminders stopped" (default may be None) and "this one item never fires" (it was gated).                                                                                                                                                                                                                                                                       |
| _(none)_ on not-ready    | —          | —                                                                            | A pre-init reschedule emits **nothing**. `notif_count: 0` there is precisely the misleading signal that hid the cancel-all bug.                                                                                                                                                                                                                                                                                                       |
| channel failure          | `critical` | `notif_error_stage: 'channel'`                                               | Now Android-only (no iOS noise) and actually gates the schedule, so `notif_count: 0` corroborates it.                                                                                                                                                                                                                                                                                                                                 |
| permission check failure | `warning`  | `notif_error_stage: 'permission'`                                            | The ref now goes `'unknown'` so the next `reschedule` reports honestly.                                                                                                                                                                                                                                                                                                                                                               |
| back-fill outcome        | `info`     | `surface: 'activity-reminder-backfill'`, `notif_backfilled` (migrated count) | A **dedicated** key, not a reuse of `notif_count`. `notif_count` already changes meaning in this release (desired → armed); a third meaning would make every fleet aggregate over it wrong unless each query filters on `surface`. `notif_backfilled` is also the **retirement signal**: when it stops appearing fleet-wide for ~90 days, the migration code can be deleted. Removed from the allowlists together with the migration. |
| back-fill failure        | `error`    | `surface: 'activity-reminder-backfill'`, `notif_error_stage: 'backfill'`     | Not `critical`: no user action failed, no data at risk (activities untouched on failure; the marker stays unset so the next boot retries).                                                                                                                                                                                                                                                                                            |

**Failure modes and the event that diagnoses each, blind:**

- _"All my reminders vanished"_ → the guard removes the cause; a genuine mass-cancel now shows as `notif_count: 0` **after** a populated run, distinguishable from pre-init silence.
- _"My activity reminders stopped"_ → `notif_activity_lead: 0`.
- _"This one item never reminds"_ → `notif_gated > 0` against a healthy `notif_count`.
- _"Nothing at all on Android"_ → `notif_error_stage: 'channel'` + `notif_count: 0`.
- _"My old activities still don't remind"_ → the back-fill event's presence and migrated count.

No bare `catch {}`. The back-fill's catch classifies, logs, leaves the marker unset (so it retries), and shows no toast — it is invisible maintenance and a failure costs the user nothing they had.

**Success-path signal:** `reschedule` fires every run including `armed: 0`; the back-fill emits once per family on success.

**Privacy / store gate:** `notif_activity_lead`, `notif_gated` and `notif_backfilled` are new keys → both allowlists, the pinned lambda test, and the runbook enumeration. The three category-level surfaces need no edit (verified above).

## Acceptance Criteria

- [ ] Opening the app while signed out / locked, then killing it, leaves previously-armed reminders **intact**
- [ ] A pickup duty on an activity with `startTime` but no `endTime` fires **no** duty reminder, and the generic reminder fires instead
- [ ] A duty-holder on an activity set to "None" whose role has no anchor gets **no** reminder at all (not a generic one)
- [ ] A parent on both duties still gets two reminders at `startTime − lead` and `endTime − lead`
- [ ] An activity created in **onboarding** schedules a reminder
- [ ] Settings → Reminders → Activities offers None/15m/30m/1h/1 day only; `0` reads "None" on both surfaces; the chip row's short wording is unchanged; travel/to-do rows still offer 2h/3h and read "at the time" for 0
- [ ] No code path can persist a `reminderMinutes` outside `ReminderMinutes` (compile-enforced); **all three** `as ReminderMinutes` casts are gone (`ActivityModal.vue:128`, `:315`, `:1092`)
- [ ] The back-fill sets eligible `0` activities to 30, skips vacation-linked and multi-day all-day spans, runs once per family, is a no-op on second run, never blocks boot, and **does not modify any recurring payment item**
- [ ] The back-fill does not write its marker when the activity list is empty or the member cannot edit activities
- [ ] A failed `schedule()` still cancels stale alarms
- [ ] iOS/web emit **no** `notif_error_stage: 'channel'` warning, and iOS still arms reminders
- [ ] A failed Android channel skips the schedule and reports `notif_count: 0`
- [ ] A denied permission reports `notif_count: 0`, not the desired-set size
- [ ] A failed permission check leaves `notificationPermission === 'unknown'`
- [ ] `notif_activity_lead`, `notif_gated` and `notif_backfilled` are in both allowlists, the pinned lambda test, and the runbook's key enumeration
- [ ] The back-fill's retirement contract is in its module docstring: what to delete, in what order, and why the `Settings` marker field outlives the code
- [ ] A synced Google Calendar event carries no reminder override, and editing an activity's reminder time makes `applyUpsert` return `false` with **no `patchEvent` call**
- [ ] Android notifications show the beanie-bell, not the stock "i" — verified on device, at notification-shade and lock-screen sizes
- [ ] CHANGELOG covers the settings restructure **and** states that a deliberate "None" may have been reset
- [ ] `npm run type-check`, full Vitest, `npm run test:lambda`, `npm run build`, `lint`, `stylelint`, `translate` all green

## Testing Plan

**Unit (Vitest):**

1. `useScheduledReminders.test.ts`: pickup duty with no `endTime` emits no duty reminder **and** the generic fires; the same activity at `reminderMinutes: 0` emits **nothing**; both-duties with both times still yields two; `gated` increments for a None activity, a hidden-audience to-do, a traveller-subset segment, and an anchorless duty; a duty role that is already ticked off still suppresses the generic reminder.
2. `useLocalNotifications.test.ts`: `runRescheduleFor(null, prefs, now)` performs **no** `checkPermissions`/`getPending`/`cancel`/`schedule` and emits **no** `logEvent` (the regression guard for the headline bug); a rejecting `schedule()` still reaches cancel-stale; a failed channel on Android skips `schedule()`; `ensureChannel` returns true without calling the plugin off Android; `notif_count` equals the armed count in the granted, denied and channel-failed branches; `cancelAllScheduledReminders()` cancels every id from `getPending()` and no-ops on an empty list.
3. `reminderSchedule.test.ts`: `toActivityLeadOption` coerces 180 → 30 and passes 0/15/30/60/1440; `formatLeadLabel(0, t, 'planner.reminder.none')` returns the none key while the default `formatLeadLabel(0, t)` returns "at the time".
4. `activityReminderBackfill.test.ts`: `selectActivitiesToBackfill` picks only `reminderMinutes === 0`, excludes vacation-linked and multi-day all-day spans, and is stable on a second pass.
5. `calendarMapping.test.ts`: `activityToGoogleEvent` returns `{ useDefault: false, overrides: [] }` for `reminderMinutes` 30, 0 **and** 1440; `computePushHash` is **unchanged** across 0 → 30 → 1440 and `computeExceptionHash` inherits that invariance; a `planReconcile` case whose only diff is `reminderMinutes` yields `existingHash === hash` so `applyUpsert` returns `false` without calling `patchEvent`.
6. `activityStore.test.ts`: `backfillReminderMinutes` issues **one** batch, never calls `updateActivity`, patches `activities.value` once, writes the marker last, and writes **no** marker when the list is empty or the member can't edit.

**On-device (greg, Android) — supersedes the previous plan's list:**

6. **The cold-start test, first:** arm reminders, force-quit, reopen to the lock screen without unlocking, force-quit again, confirm `getPending()` is unchanged. This is the regression that would have silently destroyed reminders in normal use.
7. **The headline timing test:** activity reminder ~15 min out, phone locked and idle, confirm arrival within seconds of `event − lead` under forced Doze (`adb shell dumpsys deviceidle force-idle`).
8. Pickup-only activity with no end time → generic reminder before the start; no 09:00 buzz.
9. Reboot with reminders pending → they survive.
10. Toggle off → zero pending; cold start with the toggle off → still zero.
11. Timezone forward 6h → foreground → reminders re-anchor.
12. Two devices, two members: privately-assigned to-do and traveller-subset flight reach only the right device.
13. Arm reminders, **sign out and clear data**, force-quit → `getPending()` is empty and nothing fires.
14. Calendar sync: after the first post-update boot, a synced event in Google shows **no** reminder; changing a beanies reminder time afterwards does not touch Google.
15. Notification icon: the beanie-bell renders as a clean silhouette in the shade and on the lock screen — not a white blob (the failure mode when the asset isn't alpha-only).
16. Back-fill: existing activities show 30 in the editor and schedule reminders; **a vacation trip produces no 09:00-per-day storm**; any linked recurring payment that was deactivated is **still deactivated**.

**CloudWatch:** `notif_exact_alarm: granted` fleet-wide is the release gate. `notif_count` must never be non-zero on a device reporting `notif_permission: denied`. Expect `notif_truncated` to rise after the back-fill — only actionable if paired with a user report of a missing near-term reminder.

## Resolved Decision — no reminders on synced Google Calendar events

**DECIDED 2026-07-23 (greg):** never set a reminder on a synced Google Calendar item. Reminders live in beanies, where they are more configurable; a reminder on both surfaces means duplicate alerts from two apps.

> "my advice would be to never set a reminder on synced google calendar items, and only assign reminders to beanies, and trigger notifications from beanies."

**Two changes, and the second is what makes it clean:**

1. `buildReminders` (`activityToGoogleEvent.ts:74-79`) always returns `{ useDefault: false, overrides: [] }`. `useDefault: false` with an empty list explicitly means "no reminders on this event" — it is already the behaviour for `reminderMinutes: 0`, so it is proven, not new. It also suppresses the _calendar's own_ default popup, which is the point: beanies owns the alert. Caveat: `reminders` is per-authenticated-user, so this silences the **connected account only** — another Google user who has _subscribed_ to that calendar still gets their own calendar-level defaults, which no field beanies writes can override.
2. **Remove `reminderMinutes` from `computePushHash`** (`activityToGoogleEvent.ts:170`). Once the field cannot affect the exported event, leaving it in the hash means every reminder-time edit in beanies re-pushes a byte-identical event to Google — forever, for nothing. The hash must cover exactly what is pushed.

**One-time re-push — unavoidable churn, not a repair.** Changing the hash inputs invalidates every stored `lastPushedHash`, so the first boot after this ships re-pushes all in-window pushable activities once — the same burst the back-fill would have caused anyway (`reminderMinutes` was in the hash either way, so the two cannot be avoided independently). Be honest about what it does: since the whole corpus sits at `reminderMinutes: 0` and `0` already maps to `overrides: []` (`activityToGoogleEvent.ts:76-78`), almost every re-pushed event is **byte-identical**. Only activities created since `ActivityModal.vue:128` began seeding from `activityReminderLead` actually carry an override to strip. After the burst, reminder edits never touch Google again.

The burst's **trigger** is the back-fill itself: the batch patch mutates `activityStore.activities`, tripping the sync watcher (`calendarSyncStore.ts:958-966`) into a debounced `reconcileAll`. So it lands at the first post-migration boot, on the migrating device — deterministic and observable, not deferred to an arbitrary poll. And because `reminderMinutes` is out of the hash by then, the back-fill's 0→30 write contributes nothing to it: there is exactly **one** burst, not two.

Cost is bounded and throttled: `reconcileAll` iterates connections **sequentially** (`calendarSyncStore.ts:687-689`), each pooled at `MAX_INFLIGHT = 5` (`:103`), with 429/5xx backoff in the client (`googleCalendarClient.ts:27`). Per connection that is N `patch` calls + N link writes for masters, **plus** one instance patch + link write per recurring-override child — `computeExceptionHash` delegates to `computePushHash` (`activityToGoogleEvent.ts:206`), so exception links invalidate too. The link writes touch **`calendarEventLinks`**, never `activities`, so the burst cannot re-trip the activity watcher and self-loop.

Failure modes, all self-healing: a hash is recorded only after a successful write (`recordLink`, `:333`), so anything that fails keeps its stale hash and retries next poll. Google's per-calendar write limit returns **403**, which classifies as `'forbidden'` (`googleCalendarClient.ts:37`) and is not retried in-run (`:47`) — the connection settles to `error` once and converges next poll. It cannot fake a re-consent prompt: only 401 maps to `'auth'` (`:36`), which is what drives `needs_reconnect`. Two devices booting together may both burst past `shouldSkipForFreshness` (`:266-271`); harmless — same deterministic id, same body, `patch` is idempotent.

**Make it hard to undo.** Narrow `GoogleEventResource['reminders']` to `{ useDefault: false; overrides: [] }` so a future "just add the override back" is a compile error, and keep `buildReminders` as a named zero-arg function returning a fresh literal with the decision in its docstring. At the deleted hash field (`:170`) leave a comment stating `reminderMinutes` is deliberately excluded **because it is not exported** — otherwise the next reader restores it as obviously push-relevant.

**Honest note for the changelog:** anyone who had explicitly set a non-zero reminder on an activity _and_ uses Calendar sync loses the Google popup for it. They keep the beanies reminder, which is the more configurable one — that is the intent — but it is a removal, so say so.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted fixes for all 15 confirmation-review findings plus the greg-approved back-fill; two findings (cap truncation, cancel-after-failure) re-examined and resolved differently from the review's framing.
- **Pass 2 (DRY + error handling)**: Rerouted the back-fill off `activityStore.updateActivity` (it rewrites linked recurring payment items and re-activates deactivated ones — a reminders migration silently mutating finance data) onto a single `batch` patch following `familyStore.normalizeRoles`; excluded multi-day all-day and vacation-linked activities (one 09:00 buzz per trip day); fixed the duty snippet re-emitting a generic reminder for "None" activities via the duty-exemption lead; made the channel gate iOS-safe (`createChannel` is `unimplemented()` on iOS and throws on web today, firing a warning on every reschedule — gating on it unguarded would have left iOS with zero reminders); moved the not-ready guard onto the exported seam so its regression test needs no Pinia; collapsed four coercion sites into one store getter; kept the chip label register by sharing values not wording; added back-fill pre-conditions that don't burn the one-shot marker; and corrected the "four privacy surfaces" and "existing `persistSetting` pattern" claims, neither of which exists as described.
- **Pass 3 (Sustainability)**: Moved the one-time back-fill out of the shared scheduling module into a single deletable `utils/activityReminderBackfill.ts` with an explicit retirement contract (delete the code, keep the marker field) and a dedicated `notif_backfilled` retirement signal rather than a third meaning for `notif_count`; recorded why the trigger deliberately isn't the store-load path both existing migrations use (`canEditActivities` resolves after `loadActivities`, so a load-path trigger would silently never retry); killed the proposed `formatActivityLeadLabel` — identical signature to `formatLeadLabel`, silently mis-importable, so the divergence becomes a `zeroLabelKey` argument; renamed `toReminderMinutes` → `toActivityLeadOption` since it snaps to the offered options, not the wider union; found a **third** `as ReminderMinutes` cast at `ActivityModal.vue:1092` the store getter can't reach; extracted `remindersForActivityOccurrence` to take the builder from five nesting levels to three and make the twice-regressed duty/None rule directly testable; named `ReminderBuildResult` and `ReconcileMeta`; replaced the bespoke fifth settings-store error contract with a dumb throwing setter plus one owning catch; and stopped `ensureChannel`'s platform short-circuit latching module state (a false green on the Android channel guard).
- **Pass 5 (Focused — Google Calendar decision)**: Confirmed `{ useDefault: false, overrides: [] }` is correct and already the live behaviour, that `reminderMinutes` has no other consumer in the export or any pull/merge path, and that the hash change invalidates every `lastPushedHash` with no versioning to reuse — but corrected three of my claims: the burst is **not** corrective (the corpus is all at `0`, which already emits empty overrides, so almost every re-push is byte-identical), the no-self-loop evidence named the wrong collection (`calendarEventLinks`, not `calendarConnections`), and the cost omitted Phase B (`computeExceptionHash` delegates to `computePushHash`). Also caught an unlisted hard test break at `calendarMapping.test.ts:160-176`.
- **Pass 4 (Fresh-eyes sweep)**: Caught that the not-ready guard silently removes today's _accidental_ cancel-on-sign-out — leaving activity titles and member names armed on the lock screen after "sign out and clear data" (verified: nothing outside the two notification modules cancels, and neither authStore sign-out path touches them) — and added an explicit `cancelAllScheduledReminders()` in both; required `{ quiet: true }` on the back-fill batch (`mutate` is a `USER_ACTION_METHOD`, so a failed migration would have red-toasted at boot) and barred `wrapAsync` for the same reason; replaced `dutyEmitted` with `dutyAnchored` after finding the proposed exclusivity rule would resurrect a generic reminder the moment a parent ticks their drop-off complete; removed the `dutyLead!` assertion and the redundant `BACKFILL_LEAD` alias; moved the `canEditActivities` check out of the store action (`usePermissions()` leaks a watcher per call); kept `ensureChannel()` inside the schedule guard (hoisting it out would fire a `critical` on every empty run); corrected the Open Decision's evidence — the reconcile IS hash-diffed, the real trigger is `reminderMinutes` being folded into `computePushHash`, which also means the re-push burst happens on either answer; and pinned down the zero-candidate marker path, the third meaning of `notif_count` on the failure event, and that `activityReminderContext` must stay inside the per-occurrence try.

## Outcome

**IMPLEMENTED 2026-07-23** — on `main`, not deployed.

- `f5b91678` — the cold-start wipe (+ the explicit sign-out cancel it made necessary), duty anchors, `remindersForActivityOccurrence`, platform-honest `ensureChannel`, armed-count telemetry, `'unknown'` permission, notification icon.
- `efd9291a` — activity lead options + all three casts, back-fill, no Google reminder overrides, telemetry declarations.

Gates: `type-check`, 3993 Vitest tests, 77 Lambda tests, `build`, `lint`, `stylelint`, `translate` — all green.

**Found during implementation (not in the plan):**

- Importing `cancelAllScheduledReminders` statically into `authStore` broke 22 tests in `dataClearingSecurity.test.ts` — it dragged the Capacitor plugin into a suite that partially mocks `capabilities`. Switched to the dynamic-import pattern authStore already uses for `syncStore`, which also keeps the plugin out of a hub module's static graph (per `docs/lessons.md`).
- The `calendarMapping.test.ts` break the focused review predicted landed exactly as described; it now asserts the no-override contract plus hash-invariance across `reminderMinutes`.

**Still open:** greg's on-device Android pass (Testing Plan 6-16 — cold-start first, then the Doze timing test), the Play Console exact-alarm declaration, and the notification-icon check at real notification sizes. None is a code task.

## Prompt Log

> **No GitHub issue created.** This plan was approved for direct implementation.

<details>
<summary>Full prompt history</summary>

### Initial Prompt

> Yes - please update the bell emoji in settings iwth the beanie bell. also, for the activity reminder, rather than the slightly confusing note that each activity keeps it's own reminder time, can yuo please change this to the default reminder time for activities, which is 30 min, but some people may want a different default. you can add a hint note that this is adjustable for each activity
>
> also for the discord element at the bottom of settings, this looks good, but the gradient goes to white which makes it hard to read the white text. consult /frontend-design:frontend-design for a proper design of this card/element. no need to make a mockup.

### Follow-up 1 (invoking `/code-review`)

> Looks good, run a /code-review max on the latest code changes to ensure that functionality will NOW work as designed and expected, notifications / reminders will be sent on time, and no new bugs or side effects are being introduced

### Follow-up 2 (invoking `/beanies-plan`)

> Yes i agree to perform a one-time fix to set all existing activities with the default reminder time. please do a /beanies-plan to prepare the fixes

</details>
