# Plan: Notifications #55 — review remediation (make the alarms actually fire, on time, to the right person)

> Date: 2026-07-23
> Related issues: Notion tracker #55 (no GitHub issue — direct implementation)
> Plan file: `docs/plans/2026-07-23-notifications-review-remediation.md`
> Builds on `docs/plans/2026-07-23-notifications-end-to-end-native.md`

## User Story

As a busy parent, I want the reminder on my phone to arrive **before** the thing happens, for **my** items only, and to keep working after I edit an event, fly somewhere, or reboot my phone — so I can trust it enough to stop double-checking the app.

## Context

The #55 native-reminders feature is code-complete on `main` (`888b4208`, `e1bf4cac`), all gates green, **not deployed**. A max-effort `/code-review` (60 agents, adversarial verify) returned **15 confirmed defects**. Two are release-blocking on their own (a privacy leak and an undeclared store-data change); the rest mean the feature does not do what it says for the most common cases.

**Plus one defect the review could not see, found while drafting this plan — and it is the most important one.**

### The undiscovered defect: exact alarms are denied by default on this build

`android/variables.gradle:4` sets `targetSdkVersion = 36`. The manifest declares `SCHEDULE_EXACT_ALARM` (`AndroidManifest.xml:63`). On **Android 14+ (API 34+)**, `SCHEDULE_EXACT_ALARM` is **no longer granted at install** — it is denied by default for apps that are not recognised alarm-clock/calendar apps, and the user must grant it manually in Settings.

When it is denied, `@capacitor/local-notifications` does **not** fail. It silently downgrades (`LocalNotificationManager.java:380-393`):

```java
if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarmManager.canScheduleExactAlarms()) {
    Logger.warn("Exact alarms not allowed in user settings.  Notification scheduled with non-exact alarm.");
    if (schedule.allowWhileIdle()) {
        alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, pendingIntent);   // INEXACT
    }
```

`setAndAllowWhileIdle` is inexact and Doze-batched — Android guarantees only _one_ such alarm per app per ~9 minutes in idle. **That is the original "9am dropoff reminder arrived ~5 minutes late" defect from 2026-07-15**, and the current #55 fix does not address it. `allowWhileIdle: true` was added on the assumption it buys exactness; it does not. It only buys _permission to fire during Doze at all_.

So the feature as it stands would very likely reproduce the exact bug it was written to fix, on every Android 14/15/16 device, and the CloudWatch trace would show a perfectly healthy schedule.

**The industry-standard fix is a manifest line, not a subsystem.** Android provides `USE_EXACT_ALARM` (API 33+): auto-granted, non-revocable, no user prompt. Google Play policy restricts it to apps whose _core function_ is an alarm clock or a calendar. beanies.family ships a Family Planner calendar with per-event reminders — this is the intended use case, and it is the same permission Google Calendar, Todoist and Any.do declare. We declare both (`USE_EXACT_ALARM` for 33+, `SCHEDULE_EXACT_ALARM` capped at 32) and add a Play Console declaration.

### The second landmine, found in review: honouring "None" naively ships the feature dark

`Activity.reminderMinutes` is **required**, not optional (`models.ts:676` — no `?`). `ActivityModal` initialises it to `0` (`:124`), resets to `0` on new (`:308`), and writes it on every save (`:532`). So **every activity ever created carries `reminderMinutes: 0`**, and the fallback at `useScheduledReminders.ts:93-94` never fires for real records.

A naive "0 means None, so skip" would therefore return `[]` for the entire existing corpus — including greg's 9am drop-off duty, the exact case #55 exists to serve. Requirement 5 below carries the two changes that make honouring "None" safe, and the skip must **not** be applied to the in-app bell at all — see Approach §3.

### Steering constraint from greg

> "use standard notification and alerting conventions, do not build from scratch where existing libraries or conventions already exist. many apps trigger notifications flawlessly, so do not over engineer and just build something that works leveraging existing work and industry standards"

This plan is written to that. Every fix below is either (a) a manifest/permission declaration, (b) a call to a helper that **already exists in this repo**, or (c) a reordering of existing calls. **No new subsystem, no new library, no scheduler abstraction, no diff-state engine.** Two small shared helpers are extracted (`resolveActivityLead`, `allDayAnchor`) and one small module (`useNotificationPermission`) — all three _delete_ duplication or coupling rather than add a layer.

The one structural change is the reschedule ordering (schedule-then-cancel-stale instead of cancel-all-then-schedule), which is both the standard reconciliation pattern _and_ strictly simpler than what is there now — it deletes the failure mode rather than adding a rollback to it.

## Requirements

### A. Delivery must actually be exact (the undiscovered defect)

1. Declare `USE_EXACT_ALARM` (API 33+) and keep `SCHEDULE_EXACT_ALARM` with `android:maxSdkVersion="32"` in `android/app/src/main/AndroidManifest.xml`.
2. Read the exact-alarm state via the plugin's Android-only `checkExactNotificationSetting()` — `checkPermissions()` returns `{ display }` **only**; `exact_alarm` lives on `SettingsPermissionStatus` (`definitions.d.ts:834-841`), never on `PermissionStatus` (`:826-833`). Guard the call with `getPlatform() === 'android'` and a try/catch: on any other platform, or on failure, the state stays `'unknown'`, nothing is emitted, and no exact-alarm UI is offered. Emit it on every reschedule so a downgrade to inexact is visible in CloudWatch rather than silent.
3. When exact alarms are unavailable **and** the user has reminders on, offer the OS recovery path via the plugin's existing `changeExactNotificationSetting()` — surfaced only after the condition is observed, never pre-emptively (CLAUDE.md § Cloud Auth UX).
4. Complete the Play Console "Exact alarm permission" declaration as part of the release that carries this.

### B. Fire at the right time

5. `reminderMinutes: 0` means **no OS reminder for that activity** (the in-app bell is unaffected — it is a feed, not an alarm) — matching the chip label (`ActivityModal.vue:413` renders `0` as `t('planner.reminder.none')`; `ActivityListCard.vue:90` hides the chip when `0`). **Two consequences must ship in the same change or the feature goes dark:**
   - **5a.** `ActivityModal.vue` defaults new activities to `DEFAULT_ACTIVITY_LEAD` (30) instead of `0`. Because `reminderMinutes` is required (`models.ts:676`) and the modal writes it on every save (`:532`), _100% of stored activities are `0` today_ — that is the old default, not a user choice.
   - **5b.** **Duty reminders are exempt from the lead-0 skip**, on **both** surfaces. `activityReminderContext` already treats duty as overriding a `hidden` audience (`reminderSchedule.ts:77`) — the per-activity chip governs _the activity's_ reminder, not _my drop-off run_. A drop-off/pickup reminder fires at `DEFAULT_ACTIVITY_LEAD` when `reminderMinutes === 0`.
6. Pickup duties fire at the activity's **`endTime`**, drop-off duties at `startTime`. A member who is both gets **both** reminders. An occurrence emits _either_ its duty reminders _or_ the generic activity reminder — never both.
7. All-day activities and dated-but-untimed to-dos get a morning-of **OS** reminder at **09:00 local** (the Google Calendar convention), not silent exclusion. The lead is **not** subtracted from an all-day anchor. The in-app bell's all-day trigger stays at midnight — different question, different answer.
8. Reminders re-anchor when the device timezone changes, so a return leg armed at home fires at the right local time abroad.

### C. Fire to the right person

9. To-do reminders honour `classifyAudience` — the same gate the in-app deriver (`utils/notifications.ts:173`) and the briefing (`useCriticalItems.ts:254`) already apply. A privately-assigned to-do never reaches another member's lock screen.
10. Travel reminders honour per-segment `travellerIds` via the existing `resolveSegmentTravellers` helper — only members actually on that segment are armed.
11. A drop-off/pickup duty already marked done for that date does not fire, via the existing `isDutyDone` helper.

### D. Lifecycle must not lose reminders

12. Reschedule reconciles rather than destroys: schedule the desired set, then cancel only what is pending-but-no-longer-desired. A transient `schedule()` failure must never leave the device with fewer reminders than it started with. Two reconciles never run concurrently.
13. A cold start with reminders off, or with an empty schedule, still cancels stale OS alarms — **cancellation is never gated on permission**.
14. A revoked OS notification permission is detected on the next reschedule, not masked by a latched in-memory `true`.
15. A `schedule()` failure that leaves the device under-armed pages `#beanies-errors` (`severity: 'critical'`) **and** tells the user, once per session, that the in-app briefing still has everything.

### E. Truthful UI and compliance

16. Settings → Reminders reflects reality on every platform: no inert controls, no stale permission state, no pre-emptive "notifications are off" nudge before the permission has ever been requested.
17. The in-app to-do deriver honours the user's `todoReminderLead` instead of a hardcoded 30 minutes (deletes a duplicated constant).
18. OS reminder titles render correctly in Chinese, and the **class** of placeholder-destroying translations is closed, not just the three instances.
19. The bell's unread state is exposed to assistive technology.
20. The `notif_*` diagnostic keys — existing and new — are declared everywhere CLAUDE.md requires before this ships.
21. No failure path is silent: channel-creation failure, per-record builder skips, listener-registration failure and the exact-alarm hand-off all emit structured signal and, where the user is affected, user-visible copy.

## Important Notes & Caveats

- **`USE_EXACT_ALARM` carries a Play policy obligation.** It is auto-granted and non-revocable, which is why Google gates it on the app's core function. beanies.family's Family Planner qualifies (calendar with user-set per-event reminders), but the Play Console declaration must be completed with that justification or the release can be rejected. Do not ship the manifest change without the declaration. Fallback if greg declines the policy surface: `SCHEDULE_EXACT_ALARM` + the `changeExactNotificationSetting()` hand-off — worse UX (a manual toggle per device), same correctness. **See Open Decision.**
- **`ReminderMinutes` keeps `0` in the type union** (`models.ts:620`); `0` now means "off" at the scheduler. **This is not behaviour-neutral for existing data.** `reminderMinutes` is required (`models.ts:676`) and `ActivityModal` has always defaulted new activities to `0` (`:124`, `:308`), so _every_ stored activity reads as "None" today. The change is only safe alongside 5a (new-activity default → 30) and 5b (duty exemption, on both surfaces). No data migration is proposed: existing activities genuinely display "None" in the UI, so honouring it is the truthful reading — the duty exemption is what preserves the headline behaviour.
- **Anchor the meaning at the type, not only in the scheduler.** Add a docstring at `models.ts:620` / `:676`:
  ```ts
  /** Per-activity OS reminder lead in minutes. `0` means **no reminder** — the
   *  chip renders it as `planner.reminder.none` and offers only 0/15/30/60/1440
   *  (`ActivityModal.vue:412`). Never "at the event time". Duty (drop-off/pickup)
   *  reminders are exempt from the `0` skip — see `resolveActivityLead`.
   *  The `5 | 10 | 120` members are legacy and unreachable from the UI. */
  ```
  This is the single place someone reading the data model will look; the scheduler comment alone is not discoverable from here.
- **The device-level leads in Settings keep `0` = "at the time".** Not inconsistent: there the master toggle is the off switch, and `LEAD_OPTIONS`'s `reminders.lead.atTime` label is accurate. Only the per-activity chip — which literally reads "None" — changes meaning.
- **Do not "fix" the timezone problem with a timezone library.** The alarm is an absolute epoch by design; every calendar app has this property. The standard fix is to _recompute_ on the events that invalidate it — which this app can already observe via `useToday()`. Adding Luxon/Temporal here would be exactly the over-engineering greg ruled out.
- **Do not register a new wake listener.** `useToday.ts:9-13` states it owns the app's only `visibilitychange`/`pageshow` listeners and that other consumers watch its reactive state rather than adding parallel listeners (`usePollWhileVisible.ts:11-13` repeats the rule). Honour it.
- **Do not build a diff/state engine for reschedule.** "Schedule desired, cancel stale" is a two-set operation over ids we already compute. Scheduling an id that is already pending _replaces_ it (Android reuses the PendingIntent by request code; iOS replaces by identifier) — plugin/OS behaviour we get for free, and what makes the reorder safe. Confirmed from plugin source on Android (see Assumption 4); Testing Plan step 7 is a smoke check rather than a discovery step. Slice C still runs it first, because iOS is unverified and an OEM could in principle differ.
- **`deriveNotifications` is pure** (`notifications.ts:2-9` — "no Vue, no stores, no `Date.now()`"). Never import a store into it; inject via `DeriveInput` from `notificationsStore`.
- **`useScheduledReminders.test.ts:108` currently pins the wrong behaviour** ("reminderMinutes = 0 fires AT the event time (distinct from off)"). Invert it, don't delete it — a test asserting `0` schedules nothing, **and** that a duty still does, is the regression guard for requirement 5.
- **Do not widen `useCriticalItems`' scope.** It drives the today-only in-app briefing. It is the _reference implementation_ for both the duty pairing (`:128-186`) and the generic-vs-duty exclusivity rule (`:191`) — mirror them, don't change them.
- **iOS is unverifiable this round.** Apple org enrolment is still blocked; the Swift path has never compiled. Every iOS claim here is from the plugin's documented behaviour, not observation. Android is the shipping target; iOS correctness is best-effort and must be re-verified when enrolment clears.

## Assumptions

> **Review these before implementation.** Valid at the time of planning.

1. `@capacitor/local-notifications` stays at `^8.2.1`, where `checkExactNotificationSetting()` and `changeExactNotificationSetting()` exist and both return `SettingsPermissionStatus { exact_alarm: PermissionState }` (verified in `dist/esm/definitions.d.ts:155-176, 834-841`). Both are documented **Android-only** — `checkPermissions()` exposes `display` and nothing else (`:826-833`), so the exact-alarm read is a separate, platform-guarded call.
2. `targetSdkVersion = 36` (verified, `android/variables.gradle:4`). If it were ever dropped below 33, `USE_EXACT_ALARM` would be ignored and `SCHEDULE_EXACT_ALARM` would auto-grant again.
3. Google Play accepts the calendar justification for `USE_EXACT_ALARM`. Not yet submitted — this plan's single external dependency.
4. Scheduling a notification id that is already pending **replaces** it rather than duplicating it. Confirmed from plugin source on Android: the alarm `PendingIntent` uses `FLAG_CANCEL_CURRENT` with request code = notification id (`LocalNotificationManager.java:329-333`), and the pending store is a `SharedPreferences` map keyed by id (`NotificationStorage.java:34-45`), read verbatim by `getPending()` (`LocalNotificationsPlugin.java:102-106`); fired non-repeating entries are pruned (`TimedNotificationPublisher.java:51`). iOS is assumed equivalent by documented `identifier` semantics and is **unverified**. Testing Plan step 7 is a smoke check, not a gate on unknown behaviour.
5. This module stays the app's sole local-notification producer, so "pending but not desired" means "stale". True today; the same assumption the current cancel-all already makes (`useLocalNotifications.ts:168`). Keep the comment stating it, so a future second producer is a conscious decision.
6. The `notif_*` keys added in `e1bf4cac` have not yet reached a published Play Data Safety form — i.e. we are fixing a declaration gap before user data is misdescribed at scale. **If the live 0.9.6 build already carries them, this becomes a compliance correction with a deadline, not a pre-ship task.** Verify first.

## Approach

Sixteen defects, grouped so each group is one coherent edit. Ordered by blast radius. See **Implementation Order** below for how they ship.

### 1. `AndroidManifest.xml` — exact alarms (requirement 1)

```xml
<!-- API 33+: auto-granted, non-revocable. Play policy: calendar/alarm core function.
     beanies.family's Family Planner is a calendar with user-set per-event reminders. -->
<uses-permission android:name="android.permission.USE_EXACT_ALARM" />
<!-- API 31-32 only: auto-granted there, denied-by-default from 34. -->
<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM"
                 android:maxSdkVersion="32" />
```

No code change. This alone is what makes `setExactAndAllowWhileIdle` reachable, and therefore what makes the entire feature deliver on time.

### 2. The scheduler — `useLocalNotifications.ts` + a small permission module (requirements 2, 3, 12-15, 21)

**Permission state moves to a dedicated adapter module**, `src/composables/useNotificationPermission.ts` (~60 lines). It is the _only_ other file allowed to import `@capacitor/local-notifications`, and it owns the whole permission surface — nothing else:

```ts
export type NotifPermission = 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale' | 'unknown';
/** Live OS notification-permission state. `'unknown'` until first checked (web
 *  never checks). Written by every `ensureNotificationPermission()` run, so a
 *  mid-session revoke propagates to Settings without a remount. */
export const notificationPermission = ref<NotifPermission>('unknown');
/** Live exact-alarm state. Android-only: `'unknown'` on iOS/web and until the
 *  first successful `checkExactNotificationSetting()` — `checkPermissions()`
 *  does NOT carry it (definitions.d.ts:826-833). */
export const exactAlarmPermission = ref<'granted' | 'denied' | 'unknown'>('unknown');

/** Check (always) and optionally prompt (at most once per session). */
export async function ensureNotificationPermission(mayPrompt: boolean): Promise<boolean>;
/** Android-only refresh; a no-op (and never a throw) elsewhere. Called from
 *  every reschedule, so Settings and telemetry share one source of truth. */
export async function refreshExactAlarmPermission(): Promise<void>;
/** Guarded `changeExactNotificationSetting()` hand-off — see "silent paths" below. */
export async function openExactAlarmSettings(): Promise<void>;
/** Test-only — reset the refs and the once-per-session prompt latch. */
export function __resetNotificationPermissionForTesting(): void;
```

Module-level refs are the app's established singleton pattern (`useToday.ts:29-33`), so this introduces no new idea. `useLocalNotifications` calls `ensureNotificationPermission`; `RemindersSettings.vue` imports the two refs. Neither imports the other, and the settings panel no longer transitively pulls in five Pinia stores via `useScheduledReminders.ts:20-24`.

This is the plan's **only** new file. It exists to _remove_ coupling, and it lets `useLocalNotifications.ts`'s docstring claim ("the plugin import is confined to this module", `:24`) be restated truthfully as "confined to this module and `useNotificationPermission.ts`".

**No permission latch.** `ensureNotificationPermission` always calls `checkPermissions()` (req 14) and keeps only a once-per-session latch on `requestPermissions()`.

**`reschedule()` becomes four unconditional steps** — replacing `:150-199`:

```ts
// 1. Always check (req 14) — records the live state for Settings + telemetry.
//    Only *prompt* when there is something to remind about and we haven't asked.
const granted = await ensureNotificationPermission(toSchedule.length > 0);

// 2. Schedule the desired set (needs permission + channel).
const desiredIds = new Set(toSchedule.map((n) => n.id));
if (granted && toSchedule.length > 0) {
  await ensureChannel();
  await LocalNotifications.schedule({ notifications: toSchedule });
}

// 3. Cancel only what is pending-but-no-longer-desired. Runs REGARDLESS of
//    permission — cancelling needs none, and a denied/failed check must never
//    strand alarms on the device (req 13).
const pending = await LocalNotifications.getPending();
const stale = pending.notifications.filter((n) => !desiredIds.has(n.id)).map((n) => ({ id: n.id }));
if (stale.length > 0) await LocalNotifications.cancel({ notifications: stale });

// 4. Emit the reschedule event (always, including count 0).
```

Schedule first: if step 2 throws, the previous alarms are still armed and the user is no worse off. Cancel second: if step 3 throws, the user has surplus reminders, not missing ones. Both failure directions degrade toward "too many" rather than "none". Steps 2 and 3 carry their own try/catch at different severities; step 3 is **not** inside step 2's.

**One queue, never two concurrent reconciles — and all of it at module scope.** With schedule-then-cancel-stale, an overlapping run's `getPending()` can observe the other run's freshly-scheduled ids and cancel them as "stale". Extract the debounce body at `:203-211` into a single `queueReschedule()`; the data/pref watcher, the visibility watcher (§4) and the initial run all call it. `reschedule()` is never invoked directly.

**`debounce`, `inFlight`, `rerunQueued`, `scheduleFailureToasted` and `channelReady` all move to module scope, beside `initialized`** — `__resetLocalNotificationsForTesting()` is module-level (`:215`) and cannot reach function-local state, so leaving them inside the composable would make the Reset contract below a silent no-op.

```ts
// module scope, beside `initialized`
let debounce: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
let rerunQueued = false;
let scheduleFailureToasted = false;
let channelReady = false;

function queueReschedule(): void {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => void runReschedule(), RESCHEDULE_DEBOUNCE_MS);
}
async function runReschedule(): Promise<void> {
  if (inFlight) {
    rerunQueued = true;
    return;
  } // never two reconciles at once
  inFlight = true;
  try {
    await reschedule();
  } finally {
    inFlight = false;
    if (rerunQueued) {
      rerunQueued = false;
      queueReschedule();
    }
  }
}
```

Three variables, one entry point, no state machine.

**A testable seam.** `useLocalNotifications.test.ts` today (77 lines, 5 cases) only exercises the pure exported helpers — there is no harness for the composable, and building one that drives Pinia + a deep `watch` + fake timers to assert _ordering_ is disproportionate. Follow the file's own established convention (`buildScheduledNotifications` is "Exported for unit testing", `:51`) and export the reconcile itself at module level:

```ts
/** Steps 2–4 of the reconcile — schedule desired, cancel stale, emit. Split
 *  out (and exported) so the ordering and both failure directions are
 *  unit-testable against a mocked plugin, with no Pinia and no Vue watch. */
export async function reconcileScheduled(
  toSchedule: LocalNotificationSchema[],
  meta: { truncated: boolean; skipped: number; todoLead: number }
): Promise<void>;
```

`reschedule()` becomes: build with a fresh `now` → `reconcileScheduled(...)`. Testing Plan step 4 targets `reconcileScheduled` directly; only the queue guard needs the timer harness.

**Failure severity and user copy** (req 15). The `schedule()` catch becomes `severity: 'critical'` — the user set a reminder and it is not armed. `reportError` already collapses repeats (60s count-summary dedup, `errorReporter.ts:18-24`), so no extra page-throttling is needed. The **toast** does need one: `reschedule()` runs on every debounced data change, so guard it with a module-level `let scheduleFailureToasted = false` and show, on the first failure of a session only:

```ts
showToast('error', t('reminders.scheduleFailed'), undefined, { silent: true });
```

**`silent: true` is required**: an error toast auto-fires `reportError` on surface `app` (`useToast.ts:118-137`), which would double-log the failure we just reported at `critical` under `local-notifications-schedule`, with no dedup between them (different surface + message → different bucket key). Reset the latch on the first successful schedule. Copy states the fallback truthfully ("We couldn't set your device reminders. Your in-app briefing still shows everything."). The cancel-stale catch stays `warning` with no toast (harmless surplus).

**Close the four silent paths** (req 21):

- **Channel failure.** `ensureChannel()` returns `boolean`. On `false`, escalate the existing report to `critical` on Android, tagged `notif_error_stage: 'channel'` — a missing channel means _every_ reminder silently vanishes (the composable's own comment at `:82-84` says so). Still attempt the schedule (iOS ignores channels; a stale-but-present channel may exist).
- **Builder skips are counted, not just console-warned.** All three builders change return shape uniformly to `{ reminders: ScheduledReminder[]; skipped: number }` (`buildActivityReminders` `:80`, `buildTodoReminders` `:124`, `buildTravelReminders` `:155`), incrementing `skipped` in their existing `catch` blocks; `buildReminderSchedule` sums them into its existing `{ reminders, truncated }` result. All three are exported and directly tested, so their existing cases destructure the new shape — mechanical but real work; **do not use a mutable out-parameter to avoid it.** `reschedule()` emits `notif_skipped` alongside `notif_count`. A non-zero `notif_skipped` with a healthy `notif_count` is the only way to see "one family's data quietly drops a reminder every run".
- **No floating listener registration.** `:140` becomes:
  ```ts
  LocalNotifications.addListener('localNotificationReceived', handler).catch((e) =>
    reportError({
      surface: 'local-notifications',
      severity: 'warning',
      message: 'delivered-listener registration failed; delivery telemetry is blind this session',
      error: e,
      context: { notif_error_stage: 'listener' },
    })
  );
  ```
- **Exact-alarm hand-off is guarded.** `changeExactNotificationSetting()` throws on OEMs with no such Settings activity. `openExactAlarmSettings()` wraps it; on failure show an error toast naming the manual path ("Settings → Apps → beanies.family → Alarms & reminders") and `reportError({ severity: 'warning', context: { notif_error_stage: 'exact_alarm_settings' } })`. **Reuse the already-shipped-but-unreferenced key `reminders.openDeviceSettings`** (`uiStrings.ts:6641`, added in `e1bf4cac`, referenced nowhere in `src/`) for the CTA rather than adding a new one.

**Carry the fire time so lateness is computable.** `buildScheduledNotifications` (`:52-63`) adds `at: r.fireAt.getTime()` to `extra`. The delivered listener computes `Date.now() - extra.at`, **bucketed** to keep the key low-cardinality and PII-free: `notif_lateness_bucket: 'on_time' | 'lt_1m' | 'lt_5m' | 'lt_15m' | 'gte_15m'` (`on_time` = < 30s). Guard `Number.isFinite` — a missing/NaN `at` logs the delivery without the bucket rather than logging `NaN`.

**Reset contract.** Module-level state no longer resets when the composable re-runs, so `__resetLocalNotificationsForTesting()` (`:215`) must additionally call `__resetNotificationPermissionForTesting()` and clear `scheduleFailureToasted`, `inFlight`, `rerunQueued` and any pending debounce timer. **Every piece of module-scoped mutable state added by this plan gets a line in that function**, or the suite develops order-dependence.

### 3. The builders — `useScheduledReminders.ts` + `reminderSchedule.ts` (requirements 5-7, 9-11)

Every fix reuses a helper that already exists, or extracts one that removes an existing duplication.

**One lead resolver, both surfaces; one scheduling gate, OS only** (req 5). The lead ternary exists verbatim twice — `useScheduledReminders.ts:93-94` and `notifications.ts:277-278`. That default resolution is genuinely shared. The **"None means skip"** rule is not: the bell is a feed of what is on today, and applying the skip there would delete the activity entry from the in-app briefing for _every currently-stored activity_ (all of which read `0`), including all-day ones that never consult the lead (`notifications.ts:279-281`) — and would make the schedule-failure toast copy ("your in-app briefing still shows everything") a lie. Two helpers in `reminderSchedule.ts`, one shared, one OS-only:

```ts
/** Effective activity lead in minutes. `0` is preserved (fire AT the event
 *  time) — this is trigger math only, shared by the bell and the scheduler so
 *  the default can't drift. It does NOT decide whether a reminder exists. */
export function activityLeadMinutes(reminderMinutes: number | undefined): number {
  return typeof reminderMinutes === 'number' ? reminderMinutes : DEFAULT_ACTIVITY_LEAD;
}

/** OS-scheduling gate. `0` is the chip's "None" (`planner.reminder.none`; the
 *  chip offers 0/15/30/60/1440, so `0` is literally None, never "at the time")
 *  → no OS alarm. `isDuty` opts out: the chip governs the activity's reminder,
 *  not my drop-off run. Returns the lead to use, or `null` to skip.
 *  Deliberately NOT used by the in-app deriver — see `activityLeadMinutes`. */
export function resolveOsActivityLead(
  reminderMinutes: number | undefined,
  isDuty: boolean
): number | null {
  const lead = activityLeadMinutes(reminderMinutes);
  if (lead === 0) return isDuty ? DEFAULT_ACTIVITY_LEAD : null;
  return lead;
}
```

- `useScheduledReminders.ts:93` → `const lead = resolveOsActivityLead(a.reminderMinutes, ctx.dutyRoles.length > 0); if (lead === null) continue;`
- `notifications.ts:277` → `const reminder = activityLeadMinutes(a.reminderMinutes);` — **behaviour unchanged**, duplication deleted.

**New-activity default** (req 5a): set `reminderMinutes` to `DEFAULT_ACTIVITY_LEAD` in **both** places it is initialised — the ref declaration (`ActivityModal.vue:124`) and `onNew` (`:308`) — importing from `reminderSchedule.ts`, never hardcoding 30. (`DEFAULT_ACTIVITY_LEAD` infers the literal type `30`, so it assigns to `ReminderMinutes` cleanly.)

**Knock-on:** `hasDetailData` (`ActivityModal.vue:233`) auto-expands the "more details" panel when `activity.reminderMinutes > 0`, so with the new default every activity would open expanded on edit. Change that clause to `activity.reminderMinutes > 0 && activity.reminderMinutes !== DEFAULT_ACTIVITY_LEAD` — the panel expands only when the user actually chose something, which is what the predicate means.

**Duty gating + pickup anchor** (req 6, 11). Replace `ActivityReminderContext.dutyRole` with `dutyRoles`:

```ts
/** Every duty the viewer holds on this occurrence, in fire order
 *  (drop-off before pickup). Empty when the viewer holds none. */
dutyRoles: ('dropoff' | 'pickup')[];
```

There is exactly one other reader (`notifications.ts:295`), which becomes `dutyRole: ctx.dutyRoles[0]` — `AppNotification.dutyRole` (`types/notifications.ts:45`) is a **distinct field** and is unchanged, as are `useNotificationPresentation.ts:83` and `notificationKinds.ts:129`, which read _that_ field. No deprecated alias: one field, one meaning.

The builder emits one reminder per entry in `dutyRoles` — drop-off anchored on `startTime`, pickup on `endTime` — skipping any role where `isDutyDone(activity.dropoffCompletions | pickupCompletions, date)`. `isDutyDone` is already exported (`utils/audience.ts:29`) and already tested (`utils/__tests__/audience.test.ts:57`).

**Reference implementation already in the repo:** `useCriticalItems.ts:128-186` does exactly this pairing (combined / pickup-only / drop-off-only, `endTime` for pickup, `isDutyDone` for completion). Mirror its shape; do not invent a second rule.

**Ids and the emission rule.** `activityReminderId(activityId, date, role?)` (`utils/notifications.ts:97`) gains an optional third param appended as `:${role}`. **Duty reminders always pass a role**; the generic reminder always omits it, so the in-app deriver's ids stay byte-identical and the two duty reminders can never collide with each other or with the generic one.

**Emission rule (mirrors `useCriticalItems.ts:191`, do not invent a second one):** an occurrence emits _either_ its duty reminders (one per entry in `dutyRoles`) _or_ the generic activity reminder — never both. When `dutyRoles` is non-empty the generic reminder is suppressed, exactly as the briefing suppresses the generic "you have…" line for a pickup/drop-off item. Without this, the drop-off reminder and the generic reminder hash to the same `stableNotificationId` and one silently overwrites the other — invisible in telemetry.

Consequence to note, not fix: OS reminder ids for duty items no longer match the bell's id for the same occurrence. Nothing cross-references them; amend the "shared scheme → future unification" comment at `useScheduledReminders.ts:48` to say so.

**Cap note:** two duty reminders per activity roughly doubles the activity contribution to `MAX_SCHEDULED = 60` (`:42`). `notif_truncated` already measures it — no code change, but the on-device test should include a duty-heavy week.

**To-do audience gate** (req 9). Two lines, using the existing classifier:

```ts
const audience = classifyAudience(
  normalizeAssignees(todo),
  input.currentMember,
  input.resolveMember
);
if (audience.kind === 'hidden') continue;
```

**DRY note:** this is the fourth caller of `classifyAudience` (`notifications.ts:173`, `useCriticalItems.ts:254`, `reminderSchedule.ts:65`, and here). All four call the shared primitive directly, which is correct — no further extraction is warranted. What _is_ warranted is a one-line comment at each site pointing at the others, so the next person adding a fifth surface finds the rule instead of re-deriving it.

**Travel traveller filter** (req 10). `extractSegmentOccurrences(vacationId, seg, segmentIndex)` receives no vacation object (`vacation.ts:1159-1163`), so the trip's assignees must be threaded from the caller. Three coordinated edits:

1. `vacation.ts:1103` — add to `TravelSegmentOccurrence`:
   ```ts
   /** Segment travellers. `undefined` = the whole trip — resolve via
    *  `resolveSegmentTravellers`, never read raw. */
   travellerIds?: UUID[];
   /** The trip's assignees, so the occurrence is self-contained. */
   tripAssigneeIds: UUID[];
   ```
2. `vacation.ts:1159` — `extractSegmentOccurrences(vacationId, seg, segmentIndex, tripAssigneeIds: UUID[])`. **Required, not defaulted**: a default of `[]` would make a forgetful future caller silently fall back to "everyone is a traveller", re-opening requirement 10 with no failing test and no signal. There is exactly one production call site (`vacationStore.ts:82`); the 12 call sites in `utils/__tests__/vacation.test.ts` gain an explicit `[]` mechanically.
3. `stores/vacationStore.ts:82` — thread it from `allTravelSegmentOccurrences` (`:70-74`), where `v` is in scope: `safeExtract(v.id, seg, idx, v.assigneeIds ?? [])`.

The builder then:

```ts
const on = resolveSegmentTravellers(o.travellerIds, o.tripAssigneeIds);
if (on.length > 0 && !on.includes(input.currentMember.id)) continue;
```

`resolveSegmentTravellers` (`segmentTravellers.ts:17`) already encodes "undefined = the whole trip" and is already tested. The `on.length > 0` guard preserves today's "trip with no assignees reminds everyone" behaviour — do not drop it.

**All-day / untimed → 09:00 local, OS side only** (req 7). Add to `reminderSchedule.ts`:

```ts
/** Morning-of anchor for all-day activities and dated-but-untimed to-dos — the
 *  Google Calendar convention. This is an OS *fire time*: the reminder fires AT
 *  09:00 and the lead is NOT subtracted (an all-day item has no start to lead
 *  into). Deliberately NOT used by the in-app deriver, whose all-day trigger is
 *  `startOfLocalDay` — there "trigger" means "when does this enter the bell
 *  window", and an all-day item is current from midnight. Different question,
 *  different answer; do not unify them. */
export const ALL_DAY_REMINDER_HOUR = '09:00';
export function allDayAnchor(dateISO: string): Date | null {
  return localDateTime(dateISO, ALL_DAY_REMINDER_HOUR);
}
```

Both builders **split their compound guard** rather than replacing it wholesale — the existing `continue`s also cover cases that must still skip (`!a?.id`; `todo.completed || !todo.dueDate`). Replacing them outright would schedule reminders for id-less activities and for **completed** to-dos:

```ts
// buildActivityReminders — replaces `if (!a?.id || !a.startTime) continue;`
if (!a?.id) continue;
const at = a.startTime ? localDateTime(date, a.startTime) : allDayAnchor(date);
if (!at) continue;
const fireAt = a.startTime ? minusMinutes(at, lead) : at; // no lead on an all-day anchor

// buildTodoReminders — replaces `if (todo.completed || !todo.dueDate || !todo.dueTime) continue;`
if (todo.completed || !todo.dueDate) continue;
const at = todo.dueTime ? localDateTime(todo.dueDate, todo.dueTime) : allDayAnchor(dateISO);
if (!at) continue;
const fireAt = todo.dueTime ? minusMinutes(at, prefs.todoReminderLead) : at;
```

The to-do branch anchors on `dateISO` (`todo.dueDate.slice(0, 10)`), matching the id it already builds at `:137`. The existing `fireAt <= nowMs` guard suppresses a same-day item after 09:00 — no extra case. Budget for the cap: a 14-day window of all-day items now contributes reminders it previously skipped, against `MAX_SCHEDULED = 60`.

**The in-app deriver is unchanged.** `notifications.ts:208` and `:282` keep `startOfLocalDay`: the bell must surface an all-day item from midnight, not withhold it until 09:00.

### 4. Timezone re-anchoring (requirement 8)

**Reuse the app's existing wake sink — do not register a second listener.** `useToday()` (`useToday.ts:85-99`) already owns the only `visibilitychange`/`pageshow` listeners and exposes `isVisible: Readonly<Ref<boolean>>`; every other consumer watches it (`useToday.ts:9-13`, `usePollWhileVisible.ts:11-13`).

```ts
const { isVisible } = useToday();
let lastTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
watch(isVisible, (visible) => {
  if (!visible) return;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (tz !== lastTz) {
    lastTz = tz;
    logEvent({
      level: 'info',
      surface: 'local-notifications',
      message: 'timezone changed',
      context: { notif_tz_changed: true },
    });
  }
  queueReschedule(); // NOT reschedule() — see the queue in § 2
});
```

The re-anchor deliberately reschedules on **every** foreground, not only on a timezone change — that also recovers from reboots, manual clock changes and OEM alarm purges. The timezone comparison only decides whether to emit the event. `lastTz` is a plain `let`: nothing watches it.

No new package, no `@capacitor/app` import, and it is a harmless no-op on web (the composable already early-returns on `!isNative()`, `:73`).

### 5. Settings truthfulness (requirements 16, 17)

- `RemindersSettings.vue` imports the two refs from `useNotificationPermission` — deleting its `@capacitor/local-notifications` import (`:14`), its local `permissionGranted` ref (`:87`), and its whole `onMounted` block (`:88-101`).
- Nudge gate becomes `isNative() && remindersEnabled && notificationPermission.value === 'denied'` — never on `'prompt'` or `'unknown'`. That removes the pre-emptive warning (CLAUDE.md § Cloud Auth UX: _"Never pre-warn users that a flow might fail … Surface friction only when failure is actually observed"_).
- **Exact-alarm recovery row (req 3), rendered here and nowhere else.** Gated on `isNative() && remindersEnabled && exactAlarmPermission === 'denied'` — Android-only by construction, since the ref stays `'unknown'` off Android. Copy: `reminders.exactAlarmHelp`; CTA: the already-shipped-but-unreferenced `reminders.openDeviceSettings` (`uiStrings.ts:6641`), calling `openExactAlarmSettings()`. **On return, always `queueReschedule()`**: the plugin documents that flipping the setting granted→denied restarts the app and _deletes every exact-alarm notification_ (`definitions.d.ts:157-160`), so the pending set must be reconciled after the round-trip either way. Satisfies CLAUDE.md § Cloud Auth UX — the row exists only once the denial has actually been observed.
- **In-app deriver honours the pref** (req 17), keeping `deriveNotifications` pure. Delete `DUE_LEAD_MINUTES = 30` (`notifications.ts:42`) and add to `DeriveInput` (`:61`):
  ```ts
  /** Device to-do reminder lead (minutes). Injected so the deriver stays pure. */
  todoLeadMinutes: number;
  ```
  `notifications.ts:207` uses `input.todoLeadMinutes`. `stores/notificationsStore.ts` (snapshot at `:95-123`) adds `todoLeadMinutes: settingsStore.todoReminderLead` — the store already resolves the default (`settingsStore.ts:95-97`, `?? DEFAULT_TODO_LEAD`), so behaviour is unchanged for untouched devices and the web control becomes real.
- **Scope the master toggle honestly.** It governs OS notifications. Fix the false docstring at `RemindersSettings.vue:10-11` ("on web the section still persists the prefs (honoured by the in-app briefing)") and retitle/re-hint the toggle so web users aren't told a switch does something it can't. The lead selects stay on both platforms, because after the change above they genuinely affect both.

### 6. i18n (requirement 18)

Delete `reminders.activityTitle` / `todoTitle` / `travelTitle` (`uiStrings.ts:6656, 6667, 6669` — all `{ en: '{title}' }`). A key whose whole value is `{title}` is a pipeline hazard by construction: the zh auto-translation replaced the placeholder with the word 标题 and destroyed every notification title. Pass `ctx.title` / `todo.title` / `o.title` straight through.

**Close the class, not just the three keys.** `scripts/updateTranslations.mjs:171` already gatekeeps junk translations with `suspiciousTranslationReason(source, translated)` (six rules; a trip falls back to English, `:230-234`). Add rule 7 — placeholder preservation, the industry-standard ICU check:

```js
// 7. Every `{placeholder}` in the source must survive verbatim. MyMemory
//    translates them ("{title}" → "标题"), which silently destroys the
//    interpolation — the exact defect that broke every zh notification title.
const placeholders = source.match(/\{[a-zA-Z0-9_]+\}/g) ?? [];
if (placeholders.some((p) => !translated.includes(p))) return 'placeholder lost in translation';
```

**Prerequisite:** `updateTranslations.mjs` currently calls `main()` unconditionally at module scope, so importing it from a test would call the MyMemory API and rewrite `public/translations/zh.json`. Add the repo's existing direct-invocation guard, copied verbatim from `scripts/derive-store-version.mjs`:

```js
import { pathToFileURL } from 'url';
// Run as a CLI only when invoked directly (not when imported by the test).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  });
}
```

One rule plus one new test file protects every current and future placeholder key (~40 of them), not just the three deleted here. `suspiciousTranslationReason` is already exported (`:171`) but has never been under test, so rules 1-6 gain their first coverage alongside rule 7.

Two keys are added (`reminders.scheduleFailed`, `reminders.exactAlarmHelp`) and one already-shipped key is finally used (`reminders.openDeviceSettings`). Net: −1 key. Re-run `npm run translate` and spot-check zh per the standing convention.

### 7. Accessibility (requirement 19)

`NotificationsBell.vue:91` puts `:aria-label` on a `<path>` inside an `aria-hidden="true"` `<svg>` (`:66`) — unreachable to assistive tech. The fix is on the **button's own `aria-label`** (`:53`), which is the only lever available: an `aria-label` overrides descendant content, so a visually-hidden `<span>` inside the button would be ignored while that attribute stands (and removing it loses the name entirely on the read state). `notifications.unread` is the fragment `'unread'` (`uiStrings.ts:6585`), so compose rather than substitute:

```vue
:aria-label="store.hasUnread ? `${t('notifications.title')} — ${t('notifications.unread')}` :
t('notifications.title')"
```

Delete the now-dead `:aria-label` on the `<path>`. Update `NotificationsBell.test.ts:32,38` to assert the **button's accessible name** rather than `wrapper.find('[aria-label="notifications.unread"]')` — the current assertion passes on markup no screen reader can reach.

### 8. Store declarations (requirement 20)

Add every `notif_*` key — the six from `e1bf4cac` (`notif_count`, `notif_truncated`, `notif_lead_default`, `notif_permission`, `notif_error_stage`, `notif_kind`) plus this plan's four (`notif_exact_alarm`, `notif_tz_changed`, `notif_skipped`, `notif_lateness_bucket`) — to:

- `src/utils/diagnosticContext.ts` allowlist (existing `notif_*` block at `:180-186`)
- `infrastructure/lambda/telemetry/index.mjs:112-117` + its pinned test
- `docs/runbooks/native-store-submission.md` data-collection table
- `ios/App/App/PrivacyInfo.xcprivacy`
- Play Console Data Safety answers
- `web/src/pages/privacy.astro`

**Deliberately not added:** `notif_channel_ready` (the channel failure already emits `notif_error_stage: 'channel'` at `critical` — one condition, one signal) and `notif_stale_cancelled` (a cancel count adds nothing over `notif_count`). Each new key costs six declaration surfaces in perpetuity; only add one that answers a question nothing else answers.

Per CLAUDE.md this is required in the same change as the allowlist entry. **Verify first whether the live 0.9.6 build already ships the original six** — that changes this from a pre-ship task into a compliance correction.

## Implementation Order

Three slices, each independently green (`type-check` + Vitest + `build` + `lint`) and independently revertable. Do not collapse them: they have different risk profiles and different rollback consequences.

**Slice A — delivery + compliance (release-blocking, no behaviour change to the builders).**
Approach §1 (manifest), the exact-alarm **read + telemetry** only (a platform-guarded `checkExactNotificationSetting()` inline in `useLocalNotifications.ts`; it moves into `useNotificationPermission.ts` in Slice C), §8 (all `notif_*` declarations across the six surfaces), the Play Console declaration. The exact-alarm **recovery UI** ships with Slice C, because it needs both the extracted permission module and the Settings rewiring — Slice A makes the denial _measurable_, Slice C makes it _fixable by the user_. Verifiable on-device on its own (Testing Plan 7, 8). Nothing here depends on B or C.

**Slice B — who and when (pure builders, unit-testable, zero platform risk).**
Approach §3 in full (`resolveActivityLead`, `dutyRoles` + pickup anchor + `isDutyDone`, to-do audience gate, traveller filter, `allDayAnchor`, `skipped`), §5's `todoLeadMinutes` injection, §6 (i18n + the translator guard), §7 (a11y). Contains the privacy fixes (requirements 9, 10) and the lead-0 flip. **Ship 5, 5a and 5b in one commit — separating them ships the feature dark.**

**Slice C — lifecycle (the only slice resting on an unverified platform assumption).**
Approach §2's reconcile reorder, permission de-latching, `useNotificationPermission` extraction, the `queueReschedule` guard, §4 (timezone re-anchor), §5's Settings rewiring. **Gated on Testing Plan step 7** — do not land C until "scheduling an existing id replaces it" (Assumption 4) is confirmed on a real device. If it fails, C alone is reworked; A and B are already delivering.

## Files Affected

**Created**

- `src/composables/useNotificationPermission.ts` — the permission surface, extracted to decouple Settings from the scheduler
- `scripts/__tests__/updateTranslations.test.mjs` — placeholder-preservation rule 7 plus first-ever coverage of rules 1-6

**Modified**

- `android/app/src/main/AndroidManifest.xml` — exact-alarm permissions
- `src/composables/useLocalNotifications.ts` — reconcile ordering + exported `reconcileScheduled` seam, module-scoped queue state, `queueReschedule` + in-flight guard, critical severity + once-per-session silent toast, exact-alarm telemetry, channel-ready escalation, non-floating listener, lateness bucket, tz re-anchor via `useToday().isVisible` (no new listener), extended test-reset, **and a corrected module docstring**: `:16-17`'s "delivered exactly via `allowWhileIdle` so Doze can't defer it" is false (`allowWhileIdle` only permits firing _during_ Doze — exactness comes from the manifest, §1) and is the comment that would let this bug re-enter; `:22-23`'s "cancel-all-then-reschedule … no diff-state to drift" is inverted by §2
- `src/composables/useScheduledReminders.ts` — `resolveActivityLead`, `dutyRoles` + pickup anchor + emission rule, duty-done gate, todo audience gate, traveller filter, all-day anchor, `skipped` counter
- `src/utils/reminderSchedule.ts` — `activityLeadMinutes`, `resolveOsActivityLead`, `allDayAnchor`, `ALL_DAY_REMINDER_HOUR`, `dutyRole` → `dutyRoles`
- `src/utils/notifications.ts` — `activityReminderId` role param, `DUE_LEAD_MINUTES` → injected `todoLeadMinutes`, duplicated ternary → `activityLeadMinutes` (behaviour unchanged), `ctx.dutyRoles[0]`
- `src/types/models.ts` — `ReminderMinutes` / `reminderMinutes` docstrings anchoring "0 = none"
- `src/stores/notificationsStore.ts` — inject `todoLeadMinutes` into the snapshot
- `src/utils/vacation.ts` — `travellerIds` + `tripAssigneeIds` on `TravelSegmentOccurrence`; required 4th param on `extractSegmentOccurrences`
- `src/stores/vacationStore.ts` — thread `v.assigneeIds` through `safeExtract`
- `src/components/planner/ActivityModal.vue` — new-activity default lead 30 (both init sites), `hasDetailData` knock-on
- `src/components/settings/RemindersSettings.vue` — drop direct plugin import + `onMounted`, read the permission refs, honest nudge + copy + docstring, exact-alarm recovery row + `openExactAlarmSettings()` CTA
- `src/components/notifications/NotificationsBell.vue` — a11y fix
- `src/services/translation/uiStrings.ts` + `public/translations/zh.json` — −3 placeholder-only keys, +2 error keys
- `scripts/updateTranslations.mjs` — placeholder-preservation rule + direct-invocation guard (it self-executes on import today)
- `src/utils/diagnosticContext.ts`, `infrastructure/lambda/telemetry/index.mjs` — four new context keys
- `docs/runbooks/native-store-submission.md`, `ios/App/App/PrivacyInfo.xcprivacy`, `web/src/pages/privacy.astro` — declarations

**Tests modified**

- `src/composables/__tests__/useScheduledReminders.test.ts` — invert lead-0; duty-role, duty-exempt, generic-vs-duty exclusivity, audience, traveller, all-day, `skipped` cases; new builder return shape
- `src/utils/__tests__/reminderSchedule.test.ts` — `activityLeadMinutes`, `resolveOsActivityLead`, `allDayAnchor`, `dutyRoles`
- `src/utils/__tests__/notifications.test.ts` — `todoLeadMinutes` honoured; an activity at `reminderMinutes: 0` still yields a bell entry, duty or not
- `src/utils/__tests__/vacation.test.ts` — 12 existing call sites gain an explicit `[]`; new traveller cases
- `src/components/notifications/__tests__/NotificationsBell.test.ts` — accessible name on the button, not a `<path>` attribute
- `infrastructure/lambda/telemetry/__tests__/handler.test.mjs` — new keys

## Observability Coverage

**Events added / changed** (all on the existing `local-notifications` surface family):

| Event                                 | Level          | Key context                                                | Why                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------- | -------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reschedule` (existing)               | `info`         | `+ notif_exact_alarm`, `notif_skipped`, `notif_permission` | Makes the silent inexact downgrade — the root cause of the original late-firing bug — visible, plus per-record drops and the _current_ (never latched) permission state, so a mid-session revoke lands on the same record as the schedule outcome. **One event per run, not two**: `local-notifications` is rate-limited to 50/surface/min. The denial-only `logEvent` at `useLocalNotifications.ts:118-123` is deleted as superseded. |
| `notification delivered` (existing)   | `info`         | `notif_kind`, `+ notif_lateness_bucket`                    | Scheduled-vs-delivered skew. The metric that would have caught #55 originally.                                                                                                                                                                                                                                                                                                                                                         |
| `timezone changed`                    | `info`         | `notif_tz_changed`                                         | Confirms the re-anchor fired when the device crossed zones.                                                                                                                                                                                                                                                                                                                                                                            |
| schedule failure                      | **`critical`** | `notif_error_stage: 'schedule'`, `notif_count`             | Escalated from `warning`. The user set a reminder and it is not armed — a failed user action; pages `#beanies-errors` and toasts once per session.                                                                                                                                                                                                                                                                                     |
| channel failure (Android)             | **`critical`** | `notif_error_stage: 'channel'`                             | A missing channel silently drops _every_ notification — same user impact as a failed schedule.                                                                                                                                                                                                                                                                                                                                         |
| cancel-stale failure                  | `warning`      | `notif_error_stage: 'cancel'`                              | Degrades to surplus reminders, not missing ones — firehose only.                                                                                                                                                                                                                                                                                                                                                                       |
| listener registration failure         | `warning`      | `notif_error_stage: 'listener'`                            | Delivery telemetry blind this session; no user impact.                                                                                                                                                                                                                                                                                                                                                                                 |
| exact-alarm settings hand-off failure | `warning`      | `notif_error_stage: 'exact_alarm_settings'`                | OEM has no such activity; user gets the manual path in copy.                                                                                                                                                                                                                                                                                                                                                                           |

**Failure modes and the event that diagnoses each, blind:**

- _"My reminder was late"_ → `notif_exact_alarm: 'denied'` on the reschedule + `notif_lateness_bucket` on delivery. Previously **undiagnosable**: the firehose reported a healthy schedule.
- _"I got no reminder at all"_ → `notif_permission` on the _current_ reschedule (not a stale latched value) separates revoked-permission from nothing-scheduled from schedule-failed from channel-missing (`notif_error_stage`).
- _"One of my items never reminds"_ → `notif_skipped` non-zero against a healthy `notif_count`.
- _"Wrong time abroad"_ → `notif_tz_changed` presence/absence around the trip.
- _"I got a reminder for a deleted item"_ → the item's absence from `notif_count` plus the delivered event's `notif_kind`.
- _"I got someone else's to-do"_ → audience gating is pure and unit-tested; deliberately **no** event (logging item content would breach the allowlist).

No bare `catch {}` is introduced; every new catch site classifies, logs, and — where the user is affected — shows copy naming the fallback and the recovery.

**Success-path signal:** `reschedule` already fires on every run including count 0 — kept, and now carries `notif_exact_alarm` so the _rate_ of inexact devices is measurable across the fleet. That rate is the alert worth building next.

**Honest coverage caveat:** `localNotificationReceived` only fires while the app process is alive — which, for a reminder that arrives while the phone is idle, is the _unusual_ case. `notif_lateness_bucket` is therefore a small, biased sample: useful for detecting a fleet-wide inexact downgrade, useless for auditing an individual delivery. Do not read a low sample count as "no reminders fired".

**Privacy / store gate:** `notif_exact_alarm`, `notif_tz_changed`, `notif_skipped`, `notif_lateness_bucket` are **new** context keys → the allowlist in `src/utils/diagnosticContext.ts` **and** the Lambda mirror **and** the four store-declaration surfaces in § 8. Same change, not a follow-up. All are enum/boolean/integer — no free text, no item titles, no PII.

## Acceptance Criteria

- [ ] `USE_EXACT_ALARM` declared; a debug build on an Android 14+ device logs `exact_alarm: granted` and `setExactAndAllowWhileIdle` (not the downgrade warning) in logcat
- [ ] Play Console exact-alarm declaration completed with the calendar justification
- [ ] A **newly created** activity (modal defaults) schedules a reminder — the lead-0 change did not silently disable activity reminders for everyone
- [ ] An activity with `reminderMinutes: 0` schedules nothing **unless** the viewer is on drop-off/pickup duty, which still fires
- [ ] The bell still shows **any** activity whose `reminderMinutes` is `0` — duty or not; the lead-0 change is invisible to the in-app briefing
- [ ] A member who is both drop-off and pickup gets **two** reminders — `startTime − lead` and `endTime − lead` — and no generic duplicate
- [ ] Completing a drop-off duty removes its pending reminder on the next reschedule
- [ ] A to-do assigned to another adult schedules **nothing** on this device
- [ ] A travel segment with `travellerIds` excluding the current member schedules **nothing** on their device; a trip with no assignees still reminds everyone
- [ ] An all-day activity fires an OS reminder at 09:00 local on the day, with no lead subtracted; the bell still surfaces it from midnight
- [ ] Toggling reminders off, force-quitting, and cold-starting leaves **zero** pending notifications — including when permission is denied
- [ ] A forced `schedule()` rejection leaves the previously-armed reminders intact, pages `#beanies-errors`, and toasts the user once naming the in-app-briefing fallback
- [ ] Revoking OS permission mid-session is reflected in the next `notif_permission` event and in Settings without a remount
- [ ] `RemindersSettings.vue` contains **no** `@capacitor/local-notifications` import
- [ ] `useLocalNotifications` registers **no** `visibilitychange`/`appStateChange` listener of its own (it watches `useToday().isVisible`), and no two reconciles run concurrently
- [ ] Settings shows no permission nudge before the permission has been requested
- [ ] The web PWA schedules no OS notification, and every visible Settings control there has a real effect
- [ ] A zh-language reminder shows the item's real title, and `npm run translate` rejects a translation that drops a `{placeholder}`
- [ ] A screen reader announces unread state on the bell button
- [ ] All `notif_*` keys are in both allowlists **and** all four store-declaration surfaces
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified
- [ ] `npm run type-check`, full Vitest, `npm run build`, `lint`, `stylelint`, `translate` all green

## Testing Plan

**Unit (Vitest) — the bulk of the coverage, since these builders are pure:**

1. `reminderSchedule.test.ts`: `activityLeadMinutes` — `0` → `0`, `undefined` → 30, `15` → 15; `resolveOsActivityLead` — `0` → `null`, `0 + isDuty` → 30, `undefined` → 30, `15` → 15; `allDayAnchor` returns 09:00 local and `null` on a malformed date; `dutyRoles` returns both roles when applicable.
2. `useScheduledReminders.test.ts`: invert the `reminderMinutes: 0` case to assert **no** reminder; **and** assert that the same activity with the viewer on drop-off duty **still schedules** (the regression guard proving the lead-0 change did not disable the feature).
3. `useScheduledReminders.test.ts`: both duty roles emit on `startTime`/`endTime`; a viewer who is both an assignee and on drop-off duty gets the duty reminder only (no generic duplicate) and its id carries the role suffix; `isDutyDone` suppression; `classifyAudience: 'hidden'` to-do suppression; traveller-subset suppression; trip-with-no-assignees still reminds; 09:00 all-day anchor; DST-boundary anchoring; `skipped` increments when one record throws while the rest still schedule.
4. `useLocalNotifications` (via the exported `reconcileScheduled`, plus one fake-timer case for the queue guard): schedule-before-cancel ordering; only non-desired ids cancelled; cancellation still runs when permission is denied (req 13); a rejecting `schedule()` leaves pending untouched, reports `critical`, and toasts once; `ensureChannel` failure reports `critical` with `notif_error_stage: 'channel'`; a rejecting `addListener` is caught, not unhandled; two overlapping `queueReschedule()` calls produce exactly one reconcile pass plus one queued re-run.
5. `notifications.test.ts` / `notificationsStore`: `todoLeadMinutes` honoured (60 → trigger at due − 60), default unchanged at 30; an activity with `reminderMinutes: 0` still yields an `activity-reminder` bell entry — both for a duty-only viewer **and** for a plain assignee (the deriver never applies the None skip).
6. `scripts/__tests__/updateTranslations.test.mjs`: rule 7 rejects a translation that drops `{title}`; rules 1-6 gain their first coverage.

**On-device (greg, Android — the parts unit tests cannot prove):**

7. **Verify assumption 4 first, before Slice C** — schedule an id, reschedule the same id, confirm `getPending()` shows one entry and one notification arrives. Everything in the reconcile rests on this.
8. **The headline test:** set an activity reminder ~15 min out, lock the phone, leave it idle, confirm the notification arrives within seconds of `event − lead` (not batched minutes late). Repeat under forced Doze (`adb shell dumpsys deviceidle force-idle`).
9. Reboot with reminders pending → confirm they survive (the plugin's `LocalNotificationRestoreReceiver` handles this; verify, don't assume).
10. Toggle off → `getPending()` empty. Cold start with the toggle off → still empty.
11. Change the device timezone forward 6 hours → foreground the app → confirm reminders re-anchor to the correct local time.
12. Revoke notification permission in OS settings → foreground → confirm the Settings nudge appears and CloudWatch shows the revoked state.
13. Two devices, two members: confirm a privately-assigned to-do and a traveller-subset flight reach only the right device.
14. A duty-heavy week (both roles on several recurring activities) → confirm `notif_truncated` behaviour is sane against `MAX_SCHEDULED = 60`.

**CloudWatch:** after the deploy, confirm `notif_exact_alarm` is `granted` across the fleet — that is the release gate. `notif_lateness_bucket` is a biased sample (see the coverage caveat) and is a corroborating signal only, not a gate.

## Resolved Decision

**`USE_EXACT_ALARM` — DECIDED 2026-07-23 (greg).** Declare it, with the Play Console declaration justifying it under the calendar/alarm-clock policy. beanies.family's Family Planner is a calendar with user-set per-event reminders, so the justification is honest. This is the industry-standard path (Google Calendar, Todoist, Any.do declare the same permission) and gives zero-friction delivery: auto-granted, non-revocable, no user prompt.

**The `changeExactNotificationSetting()` recovery row stays in scope regardless** (Approach §5, Slice C) — it is not redundant. `USE_EXACT_ALARM` only exists from API 33; on **Android 12 / 12L (API 31-32)** the app falls back to `SCHEDULE_EXACT_ALARM`, which _is_ user-revocable. `minSdkVersion = 24`, so those devices are in the supported range and the recovery path is their only route back. It costs one gated Settings row and reuses an already-shipped i18n key.

**Residual risk:** a rejected Play declaration would block the release. Mitigation: Slice A carries both the manifest change and the declaration, so a rejection surfaces before Slices B and C land, and degrading to the hand-off-only posture is a one-line manifest edit with no code change.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted remediation for all 15 confirmed review findings, plus the previously-undetected exact-alarm downgrade (targetSdk 36 + denied-by-default `SCHEDULE_EXACT_ALARM`) that would have reproduced the original late-firing defect on every Android 14+ device.
- **Pass 2 (DRY + error handling)**: Caught that requirement 5 would have shipped the feature dark (`reminderMinutes` is required and `ActivityModal` defaults every activity to `0`) — added the new-activity default and the duty exemption; corrected three unimplementable instructions (`extractSegmentOccurrences` has no trip assignees, `deriveNotifications` is pure and can't read a store, `useLocalNotifications` returns `void` so can't export reactive state); replaced the proposed `appStateChange` listener with the app's existing `useToday().isVisible` wake sink; extracted `resolveActivityLead` + `allDayAnchor`; closed four silent-failure paths and made `notif_lateness` actually computable.
- **Pass 3 (Sustainability)**: Caught a bell-side regression the shared lead resolver would have introduced (duty-only activities at `reminderMinutes: 0` would vanish from the in-app briefing because only the OS caller passed `isDuty`) and a duty-id collision between the generic and drop-off reminders; removed Pass 2's deprecated `dutyRole` alias — its "four live consumers" are four consumers of a _different_ field, and `ActivityReminderContext.dutyRole` has two readers, both being rewritten; stopped `allDayAnchor` being forced onto the in-app deriver, where 09:00 would hide all-day items from the bell until mid-morning; made the traveller argument required so a forgetful caller gets a compile error instead of silently reminding everyone; added an in-flight/queue guard so the new reconcile can never run concurrently with the foreground re-anchor; moved cancellation off the permission gate so requirement 13 actually holds; extracted `useNotificationPermission` so Settings stops transitively importing five Pinia stores; bounded the schedule-failure toast to once per session; cut two low-value `notif_*` keys; closed the placeholder-destruction class permanently via a seventh `suspiciousTranslationReason` rule; and split the work into three independently revertable slices.
- **Pass 4 (Fresh-eyes sweep)**: Corrected a load-bearing plugin-API error carried from Pass 1 (`checkPermissions()` returns `display` only — `exact_alarm` is on the Android-only `checkExactNotificationSetting()`, so requirements 2 and 3 would have silently no-opped on every platform); caught that sharing the lead-0 skip with the in-app deriver would delete activity entries from the bell for the _entire_ existing corpus, not just duty-only ones (split into `activityLeadMinutes` + `resolveOsActivityLead`); resolved the reset contract's contradiction by hoisting reconcile state to module scope and exporting a `reconcileScheduled` seam (there is no existing composable test harness); stopped the schedule-failure toast double-reporting via `useToast`'s auto-reporter (`silent: true`); split the compound guards the all-day anchor would have replaced wholesale (id-less activities and completed to-dos would have been scheduled); gave the exact-alarm recovery a home in Settings and moved it out of Slice A, which could not have delivered it; unblocked the translator-guard test by adding the repo's direct-invocation guard to a script that self-executes on import; fixed an a11y fix that `aria-label` override would have suppressed; folded `notif_permission` into the existing `reschedule` event to halve firehose volume; and promoted Assumption 4 from unverified to source-confirmed on Android.

## Prompt Log

> **No GitHub issue created.** This plan was approved for direct implementation.

<details>
<summary>Full prompt history</summary>

### Initial Prompt (invoking `/code-review`)

> max of all code just prepared for issue #55, ensure alerts will be triggered as expected and on time based on reminder times and all functionality will work as designed

### Follow-up 1 (invoking `/beanies-plan`)

> prepare a plan to address and fix the above issues definitively using standard notification and alerting conventions, do not build from scratch where existing libraries or conventions already exist. many apps trigger notifications flawlessly, so do not over engineer and just build something that works leveraging existing work and industry standards

</details>
