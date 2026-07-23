# Plan: Notifications end-to-end (native) — reminder lead-time for activities, travel & timed to-dos + a Settings on/off toggle

> Date: 2026-07-23
> Related issues: Notion tracker #55 (no GitHub issue — direct implementation)
> Plan file: `docs/plans/2026-07-23-notifications-end-to-end-native.md`
> Mockup: `docs/mockups/notifications-settings-2026-07-23.html`

## User Story

As a busy parent, I want a timely heads-up **before** my family's activities, travel, and timed to-dos, so I actually leave and prepare on time — not a notification when it's already too late.

## Context

The native app schedules on-device local notifications (ADR-029 A4 — the zero-knowledge backend can't server-push, so reminders are generated on-device from decrypted data). Two defects were found 2026-07-15 when greg's 9am son-dropoff reminder arrived **~5 min after 9am**:

1. **No lead time.** `buildScheduledNotifications` (`src/composables/useLocalNotifications.ts:55`) fires a reminder **exactly at** the item's `HH:mm` (`new Date(\`${todayStr}T${item.time}:00\`)`), with no offset. A 9:00 dropoff reminds at 9:00 — already too late.
2. **Inexact delivery.** The schedule payload is `{ at }` only (`useLocalNotifications.ts:61`) — no `allowWhileIdle`, and the Android manifest declares no `POST_NOTIFICATIONS` / exact-alarm permissions — so Android batches/defers under Doze.

Crucially, **the lead-time logic already exists** in the _parallel_ in-app notification-centre deriver (`src/utils/notifications.ts`): `activity-reminder` fires at `minusMinutes(startTime, reminderMinutes ?? DEFAULT_REMINDER_MINUTES)` (`notifications.ts:294-297`) and `todo-due` at `minusMinutes(due, DUE_LEAD_MINUTES)` (`:221`). The OS scheduler simply doesn't use it. This is the central DRY opportunity — extract the lead-time primitives, don't duplicate them.

Additional scope from the intake + approved mockup:

- **Travel** (departures) and **timed to-dos** must schedule reminders too — neither is emitted to the OS scheduler today (`useCriticalItems` is strictly _today-scoped_ and carries no travel).
- A **Settings → Reminders** section (per-device on/off + adjustable leads).
- A distinctive **beanie-bell** header icon, **waves-as-unread** (not a dot), a **one-shot ring** on new-reminder arrival, **bigger circle-less header icons**, and the **beanie-bell sticker** in the drawer empty state.
- A **hint** in travel-plan creation pointing to the reminder settings.

The in-app briefing (`useCriticalItems` → `FamilyStatusToast`) and the in-app notification centre stay today-scoped and are **not** changed in scope by this work; web/PWA keep the in-app briefing and honour the toggle, but fire no OS notification (native-only this round).

## Requirements

**Scheduling / delivery (native OS notifications):**

1. Fire each reminder at **(event time − lead)**, never at the event.
2. Deliver **on time** — set `allowWhileIdle: true` on every scheduled notification so Doze can't batch it; declare the required Android permissions.
3. **Activities**: lead = the existing `Activity.reminderMinutes` (`models.ts:671`, `ReminderMinutes = 0|5|10|15|30|60|120|1440`, `models.ts:615`). `0` means "fire at event time" — distinct from the toggle being off. The forward source MUST preserve duty-only (dropoff/pickup) occurrences (see Important Notes — the source is the UNFILTERED occurrence assembly, not the member-filtered `upcomingActivities`).
4. **Travel**: schedule ahead of each segment's **departure** occurrence, by travel **type**, with device-adjustable defaults (see #7). The occurrence source (`vacationStore.travelSegmentOccurrencesInRange`, `kind: 'departure'`) covers `flight_outbound`, `flight_return`, `train`, `ferry`, `cruise` — i.e. every `SupportedTravelType`. Return legs are already covered as a `flight_return` departure occurrence (standard `departureDate`/`departureTime`); cruise uses `embarkationDate`/`embarkationTime`. `car`, `flight_other` and `activity` segments produce **no calendar occurrence** today (`extractSegmentOccurrences` returns `[]` for them), so they are **out of scope** for OS reminders this round — see caveat.
5. **Timed to-dos** (`TodoItem.dueTime` set): schedule at a device-adjustable default lead (default 30 min).
6. Schedule across a **forward window** (not just today) so travel/todos days ahead are armed. Keep the cancel-all-then-reschedule strategy.
7. **Settings → Reminders** (device-scoped — local notifications live per device):
   - Master **on/off** toggle.
   - Adjustable **per-travel-type** default leads for the supported occurrence types (**flights** 2h — outbound + return share one lead; **cruise** 2h; **train** 1h; **ferry** 1h). No car row (car has no occurrence to fire on).
   - Adjustable **timed-to-do** default lead (default 30 min).
   - Activities row is informational (links to the activity editor — activities keep their own `reminderMinutes`).
8. **Graceful permission handling** — denial is not an error; the in-app briefing still shows everything. An orange (never red) nudge in the settings section when OS notifications are off.

**UI:**

9. New **beanie-bell** header icon ("the bell IS the beanie cap": ribbed cap body, folded cuff = the bell rim, orange pom, slate clapper). Monoline, `currentColor` for the base shape; the pom is the one accent.
10. **Unread = warm orange→terracotta ringing lines** beside the bell (replacing the Heritage-Orange dot). No waves when all-clear; muted bell when the toggle is off.
11. **One-shot ring animation** when a _new_ reminder arrives (not a perpetual loop); `prefers-reduced-motion` suppresses it, dot/waves remain.
12. **Bigger, circle-less header icons** for the bell **and** the search magnifier — visible glyph ~30–34px, no white squircle container, **tap/click target stays ≥40px**.
13. **Drawer empty state** uses the beanie-bell sticker (`public/brand/beanies_reminder_bell_transparent_*.png`, already in repo).
14. **Travel-plan creation hint** under the departure field pointing to Settings → Reminders.
15. All new copy in the beanie voice, fully i18n (`en` / `beanie` / `zh`).

## Important Notes & Caveats

- **Activity forward source MUST be the UNFILTERED occurrence assembly — NOT `upcomingActivities`.** `activityStore.upcomingActivities` (`activityStore.ts:347`) reads `filteredActivities` (member-filtered), **excludes vacation-linked activities**, and caps at 30. Member-filtering silently drops **duty-only** (dropoff/pickup where you are not an assignee) occurrences — which is _exactly the son-dropoff case that motivated this feature_. The in-app deriver deliberately assembles occurrences from the **UNFILTERED** `activeActivitiesForMonth` (see `notificationsStore.snapshot`, `notificationsStore.ts:96-106`) so duty occurrences survive. The forward-window reminder source reuses that same assembly; audience/duty inclusion is then decided by the shared `@/utils/audience` classifier (dropoff/pickup override `hidden`), identically to `useCriticalItems`/`notifications.ts`. Using `upcomingActivities` would reintroduce the original defect.
- **Do NOT change `useCriticalItems`'s scope.** It drives the in-app _today_ briefing (`FamilyStatusToast`) and the sort/audience rules are shared with the in-app deriver. The OS scheduler gets a **separate forward-window source** (see Approach) rather than making `useCriticalItems` return future/travel items — that would bleed future items into the today briefing.
- **Two notification systems stay separate.** In-app notification centre (`notificationsStore` / `notifications.ts` / bell drawer) and OS local notifications (`useLocalNotifications`) are distinct. This plan touches the OS scheduler + the bell/drawer _presentation_, and reuses the in-app deriver's _lead-time primitives_ **and its audience/who/duty derivation** (via an extracted `activityReminderContext` helper — see Approach C), while authoring OS copy in its own per-surface `reminders.*` templates so the two surfaces can evolve independently. It does not merge the systems.
- **Reuse of `deriveNotifications` is impossible for scheduling (and correctly so):** `deriveNotifications` only emits items whose trigger is already `≤ now` (`inWindow` requires `triggerMs <= nowMs`), i.e. items whose lead has _passed_. The OS scheduler needs the opposite — future triggers. Hence a separate forward builder is justified; it shares the lead-time primitives, the occurrence assembly, and the audience/who/duty derivation context, so no derivation logic is duplicated (OS copy is authored per-surface).
- **Travel: only `SupportedTravelType` fires; car/other are out of scope.** `travelSegmentOccurrencesInRange` returns `TravelSegmentOccurrence`s whose `transportType` is a `SupportedTravelType` (`flight_outbound|flight_return|train|ferry|cruise`, `vacation.ts:1097`). `extractSegmentOccurrences` returns `[]` for `car`, `flight_other`, `activity` (`vacation.ts:1150-1162`). Requiring the plan to remind on car "leaving time" would need a new occurrence side for `car` in `extractSegmentOccurrences` — deliberately **not** in scope this round (it also has no time field pair). The travel-lead prefs and defaults are therefore keyed on `SupportedTravelType`, and the settings UI exposes flight/cruise/train/ferry only. If car reminders are wanted later, the single structural change is a `car` occurrence side — noted for a follow-up.
- **Exact-alarm / Play policy (targetSdk 36).** `USE_EXACT_ALARM` auto-grants but Play restricts it to genuine alarm/clock apps — beanies is a family planner, so requesting it risks a Play rejection. `SCHEDULE_EXACT_ALARM` on Android 14+/targetSdk 34+ is **denied by default** for non-alarm apps and would require a runtime deep-link grant flow (extra friction). **Recommendation: rely on `allowWhileIdle: true`** (bypasses Doze batching, delivers within a small idle-window jitter) as the baseline, declare `POST_NOTIFICATIONS` + `RECEIVE_BOOT_COMPLETED` (+ `SCHEDULE_EXACT_ALARM` as a _normal_ declaration for Android 13 where it's auto-granted-revocable), and do **not** build the exact-alarm user-grant flow this round. **Verified in the plugin source (`LocalNotificationManager.setExactIfPossible`, `LocalNotificationManager.java:380-396`): when the app lacks exact-alarm permission, the plugin logs a warning and transparently falls back to `setAndAllowWhileIdle` — so omitting the grant flow degrades gracefully, never throws, and still honours `allowWhileIdle`.** On Android 13 (where `SCHEDULE_EXACT_ALARM` auto-grants) the same path yields `setExactAndAllowWhileIdle` for free. Combined with the lead-time fix (we now remind _before_ the event), a few minutes of idle jitter no longer makes the reminder "late". **On-device validation required** (greg to confirm a scheduled reminder fires close to on-time under Doze). This resolves intake Open Q #4 pragmatically; revisit only if on-device testing shows unacceptable jitter.
- **`@capacitor/local-notifications@8.2.0` supports `allowWhileIdle`** (`definitions.d.ts:767`) — no plugin upgrade needed. `RECEIVE_BOOT_COMPLETED` is required for alarms to survive reboot; the plugin re-registers on boot only if declared.
- **The `reminders` channel is created at runtime, not in the manifest.** This plugin exposes channels only via `LocalNotifications.createChannel()` (`definitions.d.ts:124`) — there is **no** manifest/`capacitor.config` channel declaration. On Android O+ a notification posted to a non-existent `channelId` is silently dropped, so the channel MUST be created (idempotently) at scheduler init **before** any schedule call that references `channelId: 'reminders'` (see Approach D/E).
- **Multi-device**: each device schedules its own local notifications from the same synced data (no cross-device dedupe — both a parent's phones may fire; acceptable).
- **The beanie-bell icon is multi-colour** (orange pom, orange/terracotta waves) → it **cannot** go through `BeanieIcon` (which forces `stroke="currentColor"`, single-colour). It must be a bespoke inline-SVG component (as the current bell and search already are). Reuse the exact SVG paths from the approved mockup.
- **Hit-target rule**: dropping the visible white squircle must **not** shrink the tap target below 40px — keep a transparent 40px hit area (padding/min-size) around the enlarged glyph. This is an accessibility requirement, not optional. (Both current buttons already are `h-10 w-10`; the change is dropping `bg-white … rounded-[14px] shadow-…` and enlarging the inner `svg` from `h-[18px]` — the 40px flex box stays.)
- **Do not use Alert Red** anywhere (unread waves, permission nudge) — Heritage Orange / Terracotta per the CIG.
- **Header-icon restyle scope** (intake Open Q #5): landing it within #55 (same visual pass) — the bell restyle already touches `NotificationsBell.vue` and the "big, no-circle" language must match its twin `SearchButton.vue` or the header looks half-done. Kept in-scope.
- **rem-based text / no arbitrary px for text** — the settings section copy uses the six-level scale; only the icon SVG dimensions are px (decorative, allowed).

## Assumptions

> **Review before implementation** — valid at planning time (2026-07-23).

1. Device-scoped storage (`GlobalSettings` + `globalSettingsRepository`) is the right home for reminder prefs (mirrors `soundEnabled`/`beanieLabEnabled`). Confirmed by the codebase map.
2. `allowWhileIdle: true` delivers acceptably close to on-time without the exact-alarm user-grant flow. **To be validated on-device.**
3. A forward scheduling window of **14 days** is sufficient. The OS caps pending notifications ~64; rather than _assume_ a family's 2-week count stays under, the builder **enforces** a `MAX_SCHEDULED = 60` cap on the `fireAt`-sorted list (soonest kept — see Approach C/D) so overflow is impossible and deterministic. Both window length and cap are single tunable constants.
4. Travel reminders schedule per **departure** occurrence (`travelSegmentOccurrencesInRange` `kind: 'departure'`), for `SupportedTravelType` only (see caveat — car/flight_other/activity have no occurrence). `flight_return` return legs ride the same standard departure fields.
5. The activity forward source is the **UNFILTERED** month-bucketed occurrence assembly (`activeActivitiesForMonth` over the window's distinct months), _reused verbatim_ from the pattern in `notificationsStore.snapshot` — **not** `upcomingActivities` (member-filtered, vacation-excluded, capped; would drop duty-only occurrences — see Important Notes). The month-bucketing helper (`distinctMonths` + bucket loop) is extracted so the store and the forward builder share one implementation (DRY).
6. The one-shot ring should fire when `unreadCount` _increases_ while the drawer is closed — the simplest correct "new arrival" edge. This is a purely **presentational** edge, so it lives in the **bell component** (a bell-local `watch` on the store's `unreadCount`/`isOpen`), **not** as new state in `notificationsStore` — keeping the store single-responsibility (data + drawer state) and the animation trigger in the presentation layer (mirrors the badge watcher shape at `useNotifications.ts:67`).
7. OS reminder title/body strings are produced by **dedicated per-kind `reminders.{activity,todo,travel}*` templates** filled via `fillTemplate` from a small explicit reminder context — **not** by synthesizing `AppNotification`-shaped intermediates and calling the in-app row helpers (`notificationTitle`/`notificationSummary`). The audience/duty/who-where derivation IS shared (via an extracted pure `activityReminderContext` helper reused by both the in-app deriver and the forward builder), but the OS _copy_ is authored per-surface so the OS notification and the in-app row can evolve independently without silently coupling their wording. All three kinds are symmetric (each gets its own template), which is simpler and less fragile than faking a full `AppNotification` to satisfy a row-presentation helper (a future field read there would silently corrupt OS copy).

## Approach

The mockup (`docs/mockups/notifications-settings-2026-07-23.html`) is the design source; every concrete token (colours, radii, type scale, spacing, the `SettingToggleRow`/`SettingsCard` patterns) comes from the beanies theme + CIG, and the CIG wins on any conflict. The mockup's raw px/hex are design intent, not values to copy verbatim.

### A. Shared lead-time primitives (DRY foundation)

`minusMinutes` (`notifications.ts:137`) and `localDateTime` (`:115`) are module-private in `notifications.ts`; `DEFAULT_REMINDER_MINUTES`/`DUE_LEAD_MINUTES` are local constants. Extract these into a shared, tested util **`src/utils/reminderSchedule.ts`**:

- `minusMinutes(d, minutes)`, `localDateTime(dateISO, time?)` — moved here, re-exported to `notifications.ts` (no behaviour change; `notifications.ts` imports them). This removes the duplication risk before it happens.
- Reminder-lead constants become the **defaults** for the new device prefs (single source): `DEFAULT_ACTIVITY_LEAD = 30`, `DEFAULT_TODO_LEAD = 30`, and `DEFAULT_TRAVEL_LEADS: Record<SupportedTravelType, number>` (`flight_outbound` + `flight_return` = 120, `cruise` = 120, `train`/`ferry` = 60). Keyed on `SupportedTravelType` (the occurrence's `transportType`), never the wider `VacationTravelType`.
- (Optional, if no existing formatter fits) a small `formatLeadLabel(minutes, t)` for the "X minutes / 2 hours before" select-option labels — checked first against `utils/date`; none exists today, so it lives here beside the constants it labels.

### B. Device-scoped reminder preferences

Add to `GlobalSettings` (`models.ts:32-49`, device-scoped, **not** synced):

- `remindersEnabled?: boolean` (master; getter default `true`).
- `todoReminderLead?: number` (minutes; default `DEFAULT_TODO_LEAD`).
- `travelReminderLeads?: Partial<Record<SupportedTravelType, number>>` (per-type overrides; a missing type falls back to `DEFAULT_TRAVEL_LEADS`).

Store wiring mirrors `beanieLabEnabled` exactly: getters in `settingsStore.ts` with `?? default`; actions via the existing `persistGlobalSetting(label, key, value)` helper (`settingsStore.ts:427`, toast + `console.error` + rethrow so an optimistic toggle reverts on failure) — **no new repo function** (`saveGlobalSettings` takes `Partial<GlobalSettings>`). Export getter + action in the store return. No `getDefaultGlobalSettings` change needed (the `?? default` getters cover absence).

### C. The forward-window reminder source (pure builder)

New **`src/composables/useScheduledReminders.ts`** exposing the reactive assembled `reminderInput` (occurrence assembly + active todos + travel occurrences + prefs) and a pure, unit-tested builder `buildReminderSchedule(input, now, prefs)`. A thin `scheduledReminders` computed (over the store poll-clock `now`, for tests/preview convenience) is also exported, but the OS scheduler calls the **pure builder with a fresh `now`** at each reschedule (see Approach D) so a `fireAt` can never drift into the past between recompute and schedule:

```ts
interface ScheduledReminder {
  id: string;
  fireAt: Date;
  title: string;
  body: string;
  kind: 'activity' | 'travel' | 'todo';
}
```

The builder assembles reminders across a `REMINDER_WINDOW_DAYS = 14` forward window, each with `fireAt = minusMinutes(eventDateTime, lead)`, dropping any `fireAt <= now`.

**Structure (flat, per-source sub-builders):** `buildReminderSchedule` delegates to three small pure sub-builders — `buildActivityReminders`, `buildTravelReminders`, `buildTodoReminders` — each taking its already-assembled source + `now` + `prefs` and returning `ScheduledReminder[]`; the top-level concatenates them, drops `fireAt <= now`, then **sorts by `fireAt` ascending and caps to `MAX_SCHEDULED = 60`** (see Reliability, below). Each sub-builder owns its own **per-item `try/catch` + single `console.warn`** (verbatim the resilience contract of `deriveNotifications`), so the three sources stay shallow (no three-level nesting), are independently unit-tested, and one malformed record — or one whole source failing — never aborts the rest.

- **Activities** (`buildActivityReminders`): occurrences from the **UNFILTERED** month-bucketed assembly (`activeActivitiesForMonth` over the window's distinct months — shared helper, see below), audience/duty decided by `@/utils/audience` (dropoff/pickup override `hidden`, identical to `useCriticalItems`/`notifications.ts`); lead = `activity.reminderMinutes ?? DEFAULT_ACTIVITY_LEAD`.
- **Timed todos** (`buildTodoReminders`): active todos (`todoStore.activeTodos`) with `dueDate` + `dueTime` in-window, lead = `prefs.todoReminderLead`.
- **Travel** (`buildTravelReminders`): `vacationStore.travelSegmentOccurrencesInRange(now, now+window)` where `kind === 'departure'` and `time` present, lead = `prefs.travelReminderLeads[o.transportType] ?? DEFAULT_TRAVEL_LEADS[o.transportType]`.

**Reliability — deterministic OS-cap:** the OS silently caps pending notifications (~64). The top-level sorts the surviving reminders by `fireAt` ascending and truncates to `MAX_SCHEDULED = 60`, so we always schedule the **soonest** reminders and never rely on a family "staying under" the limit — the nearest reminders (the ones that matter) are never the ones dropped, and the next reschedule re-fills as they fire. If truncation happens, emit `notif_truncated: true` on the reschedule telemetry event.

**Occurrence-assembly reuse (DRY):** the `distinctMonths(start, end)` + `activeActivitiesForMonth` bucket loop currently inlined in `notificationsStore.snapshot` (`notificationsStore.ts:50-106`) is extracted to a small shared helper (e.g. `assembleOccurrencesByDate(store, start, end)` in `activityStore` or a util) and consumed by BOTH the store and this builder — so there is exactly one occurrence-assembly implementation and the forward source can't drift from (or wrongly narrow) the in-app one. The helper is window-agnostic (takes `start`/`end`); the store passes its 30-day window, the builder its 14-day one.

**Message copy (per-surface templates, shared derivation):** the audience/duty classification and the assembled `who · where` + `dutyRole` are the only genuinely shared derivation — extract a pure `activityReminderContext(occ, currentMember, resolveMember)` from the deriver's activity block (currently inline at `notifications.ts:288-310`) returning `{ title, who, dutyRole }`, and consume it in BOTH the in-app deriver and this builder (one derivation, no drift). The OS **title/body** are then authored as dedicated, per-kind templates — `reminders.activityTitle`/`reminders.activityBody`, `reminders.todoTitle`/`reminders.todoBody`, `reminders.travelTitle`/`reminders.travelBody` — filled with `fillTemplate` (never string-concat). This deliberately does **not** route OS copy through the in-app `notificationTitle`/`notificationSummary` row helpers: doing so would require synthesizing a full `AppNotification` shape per item (fragile — a future field read in a row helper silently corrupts OS copy) and would hard-couple two surfaces that should read differently and evolve independently. Per-surface templates are both less code and less coupling. `id` uses the same stable-id builders already exported from `notifications.ts` (`activityReminderId`, `todoDueId`) plus a new `travelReminderId(segmentId, date)`, so a future unification is painless.

**Gating**: `scheduledReminders` (and the pure builder via a single top-level guard) returns `[]` when `!settingsStore.remindersEnabled` — one guard, so the toggle "truly stops" everything.

### D. Rewire the OS scheduler

`useLocalNotifications.ts`:

- Source changes from `useCriticalItems` → `useScheduledReminders`. **`reschedule()` invokes the pure `buildReminderSchedule(reminderInput.value, new Date(), prefs.value)` with a fresh `now` each run** (parity with today's `Date.now()`-at-call-site semantics), rather than reading a memoized computed — so no reminder is scheduled with a `fireAt` that has drifted past between recompute and schedule.
- At init (once, idempotent), **create the `reminders` channel** via `LocalNotifications.createChannel({ id: 'reminders', name, importance: 5 /* HIGH */, ... })` **before** the first `reschedule()` — a notification posted to an undeclared channel is dropped on Android O+ (see caveat). `createChannel` is safe to call repeatedly.
- `buildScheduledNotifications(reminders, now)` maps each `ScheduledReminder` → `{ id: stableNotificationId(r.id), title: r.title, body: r.body, schedule: { at: r.fireAt, allowWhileIdle: true }, channelId: 'reminders' }`. (Keep `stableNotificationId`; drop the old `todayStr`-string construction.) The input list is already `fireAt`-sorted and capped to `MAX_SCHEDULED = 60` (< the OS ~64 pending limit) by the builder — so the mapping is a straight 1:1, overflow is impossible, and the scheduler never has to know about the cap.
- Keep cancel-all-then-reschedule + the 1s debounce + the existing `try/catch` around every plugin call (nothing goes un-wrapped). The `watch` now watches the reactive `reminderInput` + device prefs (both feed the schedule), so a pref change re-runs it.
- Permission prompt still deferred until there's something to schedule.

### E. Android manifest + notification channel

`android/app/src/main/AndroidManifest.xml`: add `<uses-permission>` for `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, and `SCHEDULE_EXACT_ALARM` (normal declaration; see caveat — no runtime grant flow built this round; the plugin falls back to `setAndAllowWhileIdle` when it's absent/denied). The `reminders` notification channel (importance high) is **not** a manifest entry — this plugin has no manifest/`capacitor.config` channel declaration; it is created at runtime via `LocalNotifications.createChannel()` at scheduler init (see Approach D) so `allowWhileIdle` alarms post prominently. Confirm the plugin's boot receiver is active (requires `RECEIVE_BOOT_COMPLETED`).

### F. Settings → Reminders section

New **`src/components/settings/RemindersSettings.vue`** (mirrors `BeanieLabSection.vue` / `CalendarSyncSettings.vue`; uses `SettingsCard` + `SettingToggleRow` for the master toggle, and `BaseSelect` for the lead dropdowns), mounted in `SettingsPage.vue` beside the other section components. Its toggle handler mirrors `BeanieLabSection.onToggleLab` verbatim — `await` the store action, swallow only the already-reported rethrow in the `catch` (the control reads the persisted value, so a failed write leaves it unchanged). Contents per the mockup §5:

- Master `SettingToggleRow` → `remindersEnabled`.
- Group "How much notice?": informational Activities row (link to activity editor); per-supported-type lead `BaseSelect`s (Flights / Cruise / Train / Ferry) bound to `travelReminderLeads`; a timed-to-do lead `BaseSelect` bound to `todoReminderLead`. No car row.
- Orange permission nudge (native, when OS permission is denied) — reuse the existing tinted-notice pattern; **not** red.
- Native-only detail: on web the section still renders and the toggle persists (honoured by the in-app briefing gating), but the OS-permission nudge is hidden.

### G. Header bell + waves + one-shot ring

- **`NotificationsBell.vue`**: replace the inline Heroicons bell with the approved **beanie-bell** paths (mockup §1). Base shape `currentColor`; pom `fill` Heritage Orange. Unread → render the two ringing-line paths (Heritage Orange + Terracotta) **instead of** the dot (`hasUnread` drives which is shown). When `!remindersEnabled`, render the muted variant (pom greyed) — informational only; the in-app centre still works.
- **One-shot ring (DRY):** generalize the existing `useAttentionPulse` composable to `pulse(el, className = 'attention-pulse')` (its body is precisely the remove→reflow→add→`animationend`-remove one-shot retrigger we need; keep the default arg so all current callers are untouched) and call `pulse(bellEl, 'bell-ring')` from the bell. Do **not** re-implement the dance inline. The "a notification just arrived" edge is a **bell-local `watch`** on the store's `unreadCount`/`isOpen` — pulse when `unreadCount` increases while `!isOpen`. This keeps a purely-presentational animation trigger in the presentation layer and adds **no new state to `notificationsStore`**. Add a `.bell-ring` keyframe to `style.css` and add `.bell-ring` to the existing `prefers-reduced-motion` allowlist (`style.css:383-397`, alongside `.attention-pulse`) so it's suppressed there while the dot/waves remain.
- **Bigger, circle-less**: in `NotificationsBell.vue` **and** `SearchButton.vue`, drop the `bg-white … rounded-[14px] shadow-…` squircle; enlarge the glyph from `h-[18px]` to ~`h-[30px] w-[30px]` (bell ~34px per mockup); keep the existing `h-10 w-10 flex items-center justify-center` box so the **transparent 40px** tap target is unchanged. Keep a subtle transparent-hover per CIG. Both are single-instance components (each mounted once live), so one edit per component covers all sites (AppHeader desktop/mobile + `CalendarCommandBar.vue`).

### H. Drawer empty state

`NotificationsDrawer.vue:135-150`: swap `beanies_celebrating_circle_transparent_300x300.png` for `beanies_reminder_bell_transparent_256x256.png` (already in `public/brand/`), keep the existing `t('notifications.empty')` / `t('notifications.emptyHint')` copy (already "You're all caught up" — matches the mockup). Decorative `alt=""` retained.

### I. Travel-plan creation hint

`src/components/travel/TravelSegmentEditModal.vue`: add a Sky-Silk hint row under the departure-time field (mockup §6) — `t('reminders.travelHint')` with the resolved default lead for the chosen supported type + a link/affordance to Settings → Reminders. Copy interpolates the lead via `fillTemplate`. Shown only for a `SupportedTravelType` segment (no lead exists for car/other). Purely informational; no new state.

### J. i18n

New `reminders.*` keys in `uiStrings.ts` (section title, toggle label + hint, group label, per-supported-type row labels, lead-option labels via `formatLeadLabel` unless an existing minutes formatter is found, permission nudge, travel hint, and the OS-body copy: `reminders.activityTitle`/`activityBody`, `reminders.todoTitle`/`todoBody`, `reminders.travelTitle`/`travelBody`) — each with `en` + `beanie`; run `npm run translate` for `zh`. Reuse existing minute/duration formatting if present (checked: none in `utils/date` today — add the small `formatLeadLabel` in `reminderSchedule.ts`).

## Files Affected

**New:**

- `src/utils/reminderSchedule.ts` — shared lead-time primitives + default-lead constants (keyed on `SupportedTravelType`) + `formatLeadLabel` (+ `__tests__`).
- `src/composables/useScheduledReminders.ts` — forward-window reminder source + pure `buildReminderSchedule` (delegating to three per-source sub-builders) (+ `__tests__`).
- `src/components/settings/RemindersSettings.vue` — the Settings → Reminders section.
- (Help Center) `src/content/help/**` — reminders article (see Help Center Coverage).

**Modified:**

- `src/composables/useLocalNotifications.ts` — source + `allowWhileIdle` + runtime `createChannel('reminders')` at init + fresh-`now` per reschedule; `buildScheduledNotifications` signature.
- `src/utils/notifications.ts` — import extracted primitives (no behaviour change); export a `travelReminderId` builder beside the existing id builders; **extract the pure `activityReminderContext` helper** (`{ title, who, dutyRole }`) consumed by both the deriver's activity block and the forward builder.
- `src/composables/useAttentionPulse.ts` — parameterize `pulse(el, className = 'attention-pulse')` (backwards-compatible) for reuse by the bell ring.
- `src/stores/activityStore.ts` (or a util) — extract the shared `distinctMonths`+bucket occurrence assembly consumed by both `notificationsStore.snapshot` and `useScheduledReminders`.
- `src/stores/notificationsStore.ts` — consume the extracted occurrence assembly (no new arrival-edge state — the ring trigger is bell-local).
- `src/types/models.ts` — `GlobalSettings`: `remindersEnabled`, `todoReminderLead`, `travelReminderLeads` (keyed on `SupportedTravelType`).
- `src/stores/settingsStore.ts` — getters + actions for the three prefs (via `persistGlobalSetting`).
- `src/components/notifications/NotificationsBell.vue` — beanie-bell SVG, waves-as-unread, one-shot ring (via `useAttentionPulse`, triggered by a bell-local watch on `unreadCount`/`isOpen`), circle-less/bigger.
- `src/components/common/SearchButton.vue` — circle-less/bigger, matching language.
- `src/components/notifications/NotificationsDrawer.vue` — empty-state sticker swap.
- `src/components/travel/TravelSegmentEditModal.vue` — reminder hint row (supported types only).
- `src/pages/SettingsPage.vue` — mount `RemindersSettings`.
- `android/app/src/main/AndroidManifest.xml` — permissions (`POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `SCHEDULE_EXACT_ALARM`); the `reminders` channel is created at runtime in `useLocalNotifications`, not here.
- `src/style.css` — `.bell-ring` keyframe + reduced-motion allowlist entry.
- `src/services/translation/uiStrings.ts` — `reminders.*` keys (+ generated `zh`).
- `src/utils/diagnosticContext.ts` (+ Lambda allowlist + its pinned test) + store-declaration docs — new telemetry context keys (see Observability).
- `docs/mockups/notifications-settings-2026-07-23.html` — approved mockup (already committed; listed as design input).

## Help Center Coverage

This introduces a distinct, user-visible capability (timed OS reminders + a Settings control), so it warrants an article.

- **Action**: `new article` (or update an existing notifications/briefing article if one already covers the in-app briefing — check `src/content/help/**` first and extend rather than duplicate).
- **Category**: `features`
- **Article type**: `how-to`
- **Slug**: `reminders`
- **Title**: "Get reminded before activities, travel and to-dos"
- **Scope**: From the user's side — what reminders fire (activities, travel departures — flights/cruise/train/ferry, timed to-dos), that they arrive _before_ the event, how to turn them on/off per device, how to adjust how much notice each type gets, and that reminders are native-app only (web/PWA shows the in-app briefing instead). Explain the per-device nature (turning off on one phone doesn't affect another).
- **Notes**: Call out that reminders need OS notification permission (and what to do if it's denied); that turning the master toggle off stops all OS reminders; that activities use their own per-activity reminder time; and that car/road travel doesn't fire a departure reminder (no departure time is tracked for it).

Written per `.claude/skills/beanies-help-docs/SKILL.md`, shipped in the same change.

## Observability Coverage

Surface: **`local-notifications`** (existing; keep it greppable). All events fire on native only.

- **`logEvent` (info) — success/rate path**: on each successful reschedule, emit `notifications reschedule` with structured `context`: `notif_count` (total scheduled), `notif_lead_default` (the active to-do default lead), and `notif_truncated` (bool — whether the `MAX_SCHEDULED` cap clipped the list) so _scheduled-rate_ and cap-pressure are measurable. Emit even when count is 0 (so "toggle off / nothing to schedule" is visible), respecting rate limits.
- **`logEvent` (info) — permission**: keep the existing permission-outcome log (`useLocalNotifications.ts:97`) but add `context: { notif_permission: display }` so grant-rate is queryable (not just in the message string).
- **`reportError` (warning) — schedule failure**: keep the existing `local-notifications-schedule` / `local-notifications-permission` `reportError`s; add `context: { notif_count, notif_error_stage }` so a failing reschedule is diagnosable (which stage: build / cancel / schedule). **Not** critical — the in-app briefing is the fallback and no user data is at risk.
- **Delivered (best-effort)**: register a `localNotificationReceived` listener; on fire, `logEvent` (info) `notification delivered` with `context: { notif_kind }`. This closes the "scheduled vs delivered vs late" triage loop (the original defect) from CloudWatch without a repro.
- **Failure modes covered**: no lead applied → visible via `notif_lead_default` on the schedule event; nothing scheduled when it should be → `notif_count: 0` + toggle state; OS-cap pressure → `notif_truncated: true`; permission denied → permission event; Doze-late → scheduled-vs-delivered timestamp delta; a malformed record → per-item `console.warn` in the sub-builder (never aborts the schedule). No bare `catch {}` — every plugin call stays wrapped (existing pattern) and now carries structured context.
- **Critical vs telemetry**: none warrant `severity: 'critical'` (no user action fails, no data at risk — the in-app briefing always shows the same items). All firehose `info`/`warning`.
- **Privacy / store gate**: new context keys — `notif_count`, `notif_lead_default`, `notif_truncated`, `notif_permission`, `notif_kind`, `notif_error_stage` — MUST be added to `ALLOWED_CONTEXT_KEYS` (`src/utils/diagnosticContext.ts:61`) **and** the Lambda-side allowlist (`infrastructure/lambda/telemetry/index.mjs`) + its pinned test, **and** declared as collected Diagnostics in `docs/runbooks/native-store-submission.md` + `PrivacyInfo.xcprivacy` + the store Data-Safety/App-Privacy answers + `privacy.astro`. All are non-PII counters/enums/bools. This coupled update is part of the change, not a follow-up.

## Acceptance Criteria

- [ ] Reminders fire at (event − lead), and arrive on time under Doze (`allowWhileIdle`), validated on-device.
- [ ] The master toggle truly stops (and restarts) all OS reminders (`scheduledReminders` returns `[]` when off; pending cancelled).
- [ ] Activities use `reminderMinutes` (0 = at event time, distinct from off); **duty-only (dropoff/pickup) occurrences are scheduled** (forward source is unfiltered — the original defect case is covered); travel uses per-supported-type device-adjustable leads incl. `flight_return` legs; timed to-dos use the device to-do lead.
- [ ] Car/flight_other/activity travel correctly produce no OS reminder (no occurrence source) and no misleading settings row for them.
- [ ] Never exceeds the OS pending-notification cap: `scheduledReminders` is `fireAt`-sorted and capped to `MAX_SCHEDULED = 60` (soonest kept); truncation is telemetry-visible (`notif_truncated`).
- [ ] The `reminders` channel is created at runtime before the first schedule; notifications post to it (not dropped to a non-existent channel on Android O+).
- [ ] Settings → Reminders shows the master toggle + adjustable flight/cruise/train/ferry + to-do leads; changes persist per-device (survive reload, don't sync).
- [ ] OS-permission denial degrades gracefully (in-app briefing unaffected; orange nudge, never red).
- [ ] Completing/editing an item reschedules correctly (cancel-all-then-reschedule extends to travel + todos without drift).
- [ ] Beanie-bell icon renders at all bell mounts; legible ~20px up; base is `currentColor` (dark-mode safe); pom orange.
- [ ] Unread shows the ringing lines (not a dot); one-shot ring fires on new arrival (bell-local watch via the shared `useAttentionPulse`, no store state added); suppressed under `prefers-reduced-motion`.
- [ ] Header bell + search are bigger and circle-less; tap targets remain ≥40px.
- [ ] Drawer empty state shows the beanie-bell sticker.
- [ ] Travel-segment form shows the reminder hint with the correct default lead + Settings link (supported types only).
- [ ] OS notification title/body come from the dedicated `reminders.*` templates (per kind incl. travel); no `AppNotification` shape is synthesized for scheduling.
- [ ] All new copy is i18n (`en`/`beanie`/`zh`); `npm run translate` clean.
- [ ] Help Center reminders article added/updated and matches shipped behaviour.
- [ ] Observability events fire with the stated `surface`/`context`; new context keys allowlisted (app + Lambda + pinned test) and store-declared; scheduled-vs-delivered triageable from CloudWatch without a repro.
- [ ] `npm run type-check`, `npm run lint`, full test suite, and `npm run build` all green.

## Testing Plan

1. **Unit — `buildReminderSchedule` + the three sub-builders**: activities (reminderMinutes incl. 0; **a dropoff/pickup duty-only occurrence for a non-assignee current member IS scheduled** — the regression guard for the original defect), timed todos (device lead), travel departures (per-supported-type incl. overrides + `flight_return`; car/flight_other/activity yield nothing), window boundary (in/out of 14d), past `fireAt` dropped, **`fireAt`-sorted + capped to `MAX_SCHEDULED` (61 in-window → soonest 60 kept, `notif_truncated` flagged)**, one malformed record skipped without aborting the rest (and one whole source throwing doesn't kill the others), master-off → `[]`. Each sub-builder is unit-tested in isolation. (Pure builders — the bulk of coverage lives here.)
2. **Unit — OS copy templates**: `reminders.{activity,todo,travel}Title/Body` render correctly per kind via `fillTemplate` (incl. duty phrasing for a dropoff/pickup occurrence); no `AppNotification` synthesized.
3. **Unit — `reminderSchedule.ts`**: `minusMinutes` / `localDateTime` parity with prior `notifications.ts` behaviour (guard the extraction); `formatLeadLabel` output.
4. **Unit — shared occurrence assembly**: the extracted `distinctMonths`+bucket helper produces the same `occurrencesByDate` the store previously built inline (guard the extraction).
5. **Unit — `activityReminderContext`**: the extracted helper returns the same `{ title, who, dutyRole }` the deriver previously computed inline, and the deriver still emits identical `subtitle`/`dutyRole` (guard the extraction).
6. **Unit — settings actions**: getters default correctly; `persistGlobalSetting` writes device-scoped; failure path reverts + toasts.
7. **Component — RemindersSettings**: toggle + selects bind to store; web hides the OS nudge.
8. **Component — NotificationsBell**: dot→waves on `hasUnread`; ring class added when `unreadCount` increases while closed (bell-local watch, via `useAttentionPulse`) and removed on `animationend`; no ring when the drawer is open; muted variant when disabled; reduced-motion suppresses ring.
9. **Manual (native, on-device — greg)**: schedule a near-future activity/travel/todo; confirm it fires ~lead before the event, on time under Doze; **confirm the notification actually posts (channel exists)**; toggle off → none fire; permission-denied path shows the nudge and the briefing still lists items; reboot survives (RECEIVE_BOOT_COMPLETED).
10. **Manual (web)**: settings persist; no OS notification; in-app briefing unaffected.
11. **Telemetry**: confirm the CloudWatch events appear with the new context keys (incl. `notif_truncated`) after a native reschedule.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the full plan from the approved mockup + a two-agent codebase map — shared lead-time primitives, a device-scoped pref set, a forward-window `useScheduledReminders` source feeding the rewired OS scheduler with `allowWhileIdle`, the manifest/channel changes, the Settings section, the beanie-bell/waves/one-shot-ring/circle-less-header UI, drawer sticker, travel hint, i18n, Help Center, and coupled telemetry allowlist updates.
- **Pass 2 (DRY + error handling)**: Verified reuse claims against source and fixed three correctness/DRY defects — (1) the activity forward source was `upcomingActivities`, which is member-filtered + vacation-excluded and drops duty-only dropoff/pickup occurrences (the exact defect case); switched to the UNFILTERED `activeActivitiesForMonth` assembly and extracted that assembly so the store and builder share one implementation; (2) travel scope corrected to `SupportedTravelType` only (car/flight_other/activity have no occurrence — removed the misleading car lead and bad `returnDepartureTime`/`leavingTime` field references, keyed leads on `SupportedTravelType`); (3) OS message strings now reuse the existing pure `notificationTitle`/summary helpers and one-shot ring reuses a parameterized `useAttentionPulse` instead of re-implementing either — plus made the builder's per-item try/catch resilience explicit.
- **Pass 3 (Sustainability)**: Reduced coupling/complexity — (1) OS copy now uses dedicated per-kind `reminders.*` templates instead of synthesizing `AppNotification` intermediates through in-app row helpers (extracted a shared `activityReminderContext` for the genuinely-shared audience/who/duty derivation, so the two surfaces stay DRY on data but decoupled on wording); (2) moved the one-shot "new arrival" ring edge out of `notificationsStore` into a bell-local watch (keeps the store single-responsibility); (3) flattened `buildReminderSchedule` into three shallow per-source sub-builders; (4) replaced the "stays under 64" assumption with a hard `fireAt`-sorted `MAX_SCHEDULED=60` truncation (telemetry-flagged via `notif_truncated`).
- **Pass 4 (Fresh-eyes sweep)**: Fixed a display-breaking gap — the `reminders` channel was described as a manifest/`capacitor.config` entry, but this plugin creates channels only at runtime via `LocalNotifications.createChannel()` and posting to an undeclared channel is dropped on Android O+; now created idempotently at scheduler init before the first schedule. Also: made `reschedule()` invoke the pure builder with a fresh `now` per run (no stale-computed `fireAt` drift), and verified in the plugin source (`LocalNotificationManager.setExactIfPossible`) that it falls back gracefully to `setAndAllowWhileIdle` when exact-alarm permission is absent — confirming the "no grant flow" stance is safe.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Pre-plan hand-off (assembled `=== BEANIES PRE-PLAN ===` block, tracker #55)

The full assembled intake block produced by `/beanies-pre-plan` and written to Notion #55 `beanies-plan prompt` — captured verbatim in the tracker. Summary: native notifications end-to-end; fix the 2026-07-15 lead-time + inexact-delivery defects; activities use `reminderMinutes`; travel per-type leads (flight/cruise 2h, train/ferry/car 1h) adjustable in Settings; timed to-dos default 30 min adjustable; per-device master toggle; graceful permission handling; native-only (web keeps in-app briefing + honours toggle); bell restyle ("bell IS the beanie cap", waves-as-unread, one-shot ring, reduced-motion), bigger circle-less header icons (bell + search, ≥40px hit target), drawer empty-state sticker, travel-creation hint; observability on surface `local-notifications`; GitHub issue: skip; feature gate: no.

### Design iterations (this session, mockup)

- greg: mockup requested to confirm settings options + wording and design a distinctive on-theme bell; travel offsets option 1 (flight/cruise 2h, rest 1h) but adjustable in Settings + a hint in travel creation; per-type defaults adjustable in settings; per-device scope.
- greg: Gemini beanie-bell PNG → use dual-use (monoline header + sticker for larger surfaces); make the hat flair more noticeable + bigger header icons filling the space (apply to search too); unread = the ringing lines (option C) not a dot.
- greg: make the hat wrap the bell; asked where the sticker lives → drawer empty state; then: make the _entire bell_ the beanie cap (pom on top, clapper poking out) — approved this "cap" version.
- greg: "go with the cap version, lock it in and generate the proper sizings for the reminder bell png" → 5 transparent sizes generated to `public/brand/`.

### `/beanies-plan` invocation

> continue to prepare the plan

</details>
