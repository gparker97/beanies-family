# Plan: In-app notifications — derived list, synced read-state, single drawer (Treatment B)

> Date: 2026-05-26
> Related issues: [#233](https://github.com/gparker97/beanies-family/issues/233)
> Plan file: `docs/plans/2026-05-26-in-app-notifications.md`
> Mockup: `docs/mockups/notifications-2026-05-26.html` (Treatment B — one drawer, list → detail)
> Status: **Planned — NOT implemented this session.** Pick up later from this plan + the issue.

## User Story

As a member of a beanie family, I want to be notified when my tasks are coming due, when a family member assigns me a task, and when my events are coming up — surfaced in one place behind a header bell with an unread badge — so I can stay on top of my personal and family life and feel less stressed that I might be forgetting something (or someone).

## Context

The app has **no notification center today**. "What's due for whom" is computed fresh by `useCriticalItems()` (todos, activities, duties, meds, holidays) with a smart per-member audience rule, and that feed drives the daily-briefing toast and the native (Capacitor) OS reminders (`useLocalNotifications`). But there is no persisted notion of a notification, no read/unread state, and no bell in the header. The "What's New" release notes are shown via a one-off centre modal (`WhatsNewModal` + `useWhatsNew`, gated on localStorage `beanies-lastSeenWhatsNew`).

This plan introduces **in-app notifications only** (push is a later phase). The design that emerged from planning is intentionally lean:

- **Notifications are _derived_, not stored.** Every notification maps to a deterministic stable id over data already in the synced family document (todos, activities) plus the static release-notes registry. Every device reconstructs the same list, so a notification appears on all of a member's devices automatically and back-fills correctly on next open.
- **The only persisted state is per-member read/unread**, stored in the synced Automerge document so that reading on one device clears the badge on another. There is no per-user backend; the family file is the only sync channel.
- **"What's New" becomes a notification** (kind `whats-new`) rather than a special modal — it auto-opens the drawer on login when there's an unseen release and is otherwise findable in the list like any other notification.

The chosen UI is **Treatment B** from the mockup: a single `BaseSidePanel` drawer that shows the list and slides to a detail view (with a back arrow) — one primitive, identical on desktop and mobile.

## Requirements

### Functional

1. **Header bell with unread badge.** A new squircle bell joins the existing header controls. **Placement (updated 2026-05-27 — see Re-validation note):** `NotificationsBell` is a single shared component mounted in THREE spots so it's reachable everywhere: (a) `AppHeader.vue` desktop right-cluster (before the privacy toggle), (b) `AppHeader.vue` mobile right-cluster (before the privacy toggle), and (c) **`CalendarCommandBar.vue`'s reclaimed mobile trailing group, beside `SearchButton`** — because on the planner route at the phone breakpoint `AppHeader` is now hidden (`v-if="!headerReclaimed"`, shipped 2026-05-27) and the command bar is the top bar; without (c) the bell would be invisible on the mobile calendar page. It shows a **Heritage Orange** unread indicator (default: a calm dot; an unread-count variant is a one-token swap) whenever ≥1 notification is unread for the current member. The badge clears the instant the last notification is read.
2. **PWA / installed-app icon badge.** When there are unread notifications, set the OS app-icon badge via the Badging API (`navigator.setAppBadge(count)`); clear it (`navigator.clearAppBadge()`) when unread hits zero. **This is a genuinely new capability — there is no existing badge helper to reuse.** Feature-detected and failure-tolerant (see Requirement 8).
3. **Single drawer (Treatment B).** The bell opens one `BaseSidePanel` showing the notification list grouped by recency (Today / Earlier). Tapping a row slides the same drawer to a **detail** view with a back arrow; back returns to the list (it does not close the drawer). Escape / platform-back: from detail → list; from list → close.
4. **Notification triggers (this phase):**
   - **Task coming due (assignee).** A to-do that is assigned to the current member (or unassigned-but-eligible per the existing audience rule), not completed, not "someday", with a due date, produces a `todo-due` notification.
     - **Dated, no time:** fires the **morning of** the due date; **escalates** (style only) when overdue.
     - **Dated + time:** fires **~30 min before** the due time; escalates when overdue.
   - **Task assigned to me.** A to-do assigned to the current member produces a `todo-assigned` notification when (a) someone else created it (any date/no-date), or (b) it was self-created **and** has no date/time (so a self-made no-deadline task isn't silently lost — there's no due trigger for it).
   - **Activity coming up.** An activity occurrence relevant to the current member (assignee, or drop-off / pick-up duty) produces an `activity-reminder` notification, firing at occurrence start minus the activity's own `reminderMinutes` (default **30** when unset; all-day / no-`startTime` activities fire morning-of).
   - **What's New.** Each release in the registry produces a `whats-new` notification; the latest unseen one auto-opens the drawer on login.
5. **Read / unread semantics.** Notifications are **unread** when generated. Opening a notification's detail marks it **read**. From the detail view a notification can be marked **unread** again. **Mark all read** marks every currently-active unread notification read and removes the badge everywhere. Because notifications are _derived from the full synced dataset_ (not from rendered rows), "mark all read" covers every active unread notification regardless of whether its row was ever scrolled into view (the store iterates `notifications`, not the rendered list). Read-state is **synced across the member's devices** via the family document.
6. **Open the source.** From the detail view, a primary action navigates to the item's home screen and opens the item, reusing the existing deep-link query-param convention (`/todo?view=<id>`, `/activities?activity=<id>`).
7. **Empty state.** When there are no notifications: a warm "you're all caught up" beanie empty state.

### Non-functional

8. **No silent failures.** Every fallible operation is guarded; users see warm messaging where relevant and developers get a `console.warn/error` breadcrumb **and** a `reportError(...)` call (the established telemetry path → `#beanies-errors`). Specifically:
   - **Read-state mutation** (`markRead`/`markUnread`/`markAllRead`/`pruneReadState`): guard `isDocLoaded()` and `familyStore.currentMember` _before_ calling `changeDoc` (which throws if no doc). On a missing precondition or a thrown `changeDoc`, log `[notificationsStore.<fn>]` + `reportError` and no-op visibly (the row's read state simply doesn't change; never a silent half-write). Mirrors the `familyStore.normalizeRoles` try/catch pattern (verified at `familyStore.ts:348-374`). `changeDoc` is `(fn, message?)` (verified `docService.ts:156`); pass a descriptive message string for the Automerge history.
   - **Badging API**: feature-detect (`'setAppBadge' in navigator`) and wrap each call in try/catch; a throw or absent API degrades to "no OS badge" with a single `console.warn` (no `reportError` spam — absence is expected on most browsers).
   - **localStorage what's-new migration**: wrap the `localStorage.getItem` read in try/catch (private-mode / disabled storage); on failure, skip seeding (worst case: prior releases show once as unread) and `console.warn`.
   - **Derivation**: `deriveNotifications` is pure and total — it must never throw. Internally each entity loop is defensive (uses `normalizeAssignees`, `parseIsoDateSafely`, optional chaining) and skips malformed records with a `console.warn`. The store's `notifications` computed additionally wraps the call in try/catch returning `[]` + `reportError` so a single bad record can never blank the bell or crash the app.
9. **DRY — reuse, don't reimplement.** Confirmed-existing units to reuse rather than rebuild (verified against the codebase at planning time):
   - `BaseSidePanel` (`src/components/ui/BaseSidePanel.vue`) — **already** teleports to body, wires Escape + body-scroll-lock via `useFullscreenOverlay`, and renders header/body/footer slots. **Do NOT re-wire Escape or scroll-lock in the drawer.** Only the platform-back gesture is missing (see below). Verified: it accepts `open`, `title?`, `side`, `size`, `closable`, and emits `close` (`BaseSidePanel.vue:1-38`).
   - `useBackGestureClose` (`src/composables/useBackGestureClose.ts`) — the one close-behavior the panel lacks; wire it in the drawer. Signature `(isOpen: Ref<boolean>, onClose: () => void)`, self-guarding and self-disposing (verified `useBackGestureClose.ts:61`). **It manages exactly ONE history entry per `isOpen` true-transition** — see the drawer wiring note for the detail→list re-arm requirement this implies.
   - `usePollWhileVisible(cb, intervalMs, { fireImmediatelyOnVisible, surface })` — builds on the singleton `useToday().isVisible`; catches + reports callback throws itself (verified `usePollWhileVisible.ts:55-82`).
   - Audience: extract the **private** `classifyAudience` + `BriefingAudience` type + `isDutyDone` helper out of `useCriticalItems.ts` into a shared module (see Shared-helper extractions). `normalizeAssignees`, `formatNameList`, `isAdultMember`, `getMemberById`/`getMemberName` already live in `@/utils/assignees` and `@/composables/useMemberInfo`.
   - Todo state: `isTodoOverdue` (`@/utils/todo`), `parseIsoDateSafely` (`@/utils/safeDate`), `localToday` (`@/utils/date`).
   - **Relative-time display: reuse `timeAgo` / `formatLogEntryTime` (row timestamp) and `relativeDayLabel` (Today/Tomorrow/Yesterday group headers) — all in `@/utils/date` (verified at lines 247, 284, 467). `relativeDayLabel(dateStr, t)` takes the translation fn, so thread `t` through the row/group component. Do NOT write a new "x ago" helper.**
   - Occurrence resolution: `activityStore.activitiesForDate(dateStr)` returns `{ activity, date }[]`. **Caveat (verified `activityStore.ts:549-556`): it expands _every_ recurring activity across the whole month on each call, then filters to one day. Calling it once per day across the 30-day window would re-expand each month up to ~30× per derive, and the derive re-runs on every poll tick — a latent performance cliff.** See the resolver contract in Derivation + the **new** `activeOccurrencesForMonth` store method (the existing month primitive `monthActivities` uses the WRONG, member-filtered source — see the source-trap note in the store section).
   - Release registry: `getAllReleaseNotes()` / `getLatestVersion()` / `getReleaseNote(version)` from `@/content/release-notes` (verified exports; versions are date-based strings like `'2026.04'`).
   - Deep-link map: extract the `selectResult` entity→route/query switch from `GlobalSearch.vue` into a shared helper used by both (see below).
10. **i18n.** All user-visible text goes through `uiStrings.ts` `STRING_DEFS` (`{ en, beanie? }`; `beanie` optional, applied at runtime, not translated). **The translate script (`scripts/updateTranslations.mjs`) is a line-based regex parser** — it requires each entry as `'key': {` on one line and the `en:` value matchable by a single-line single/double-quote regex. Keep every new `notifications.*` entry single-line-parseable (no template literals, no `en` value spanning lines). After adding keys, run `npm run translate` to regen zh and confirm the parser's "Parsed N strings" count rose by the number added.
11. **Comprehensive tests**, especially for the task-due trigger (explicit user requirement).

### Explicitly out of scope (future phases — do NOT build now)

- Push notifications (and per-category / per-item push enablement).
- The "dismissed a push 3×, offer to turn off" comfort flow.
- Notification preferences in Settings.
- Folding the **daily hint** into notifications (design accommodates it via the per-kind presentation map; not built).

## Important Notes & Caveats

- **Colour = Heritage Orange, not red.** The brand rule and the design-system header spec both mandate Heritage Orange for the unread indicator; red is reserved for destructive confirmations. The mockup uses orange. (Greg said "red"; this is the one place it would break the warmth-not-alarm rule. Easy to swap if he insists, but default to orange.)
- **In-app only ⇒ generated while open.** Without push, notifications become active while the app is open (clock tick via `usePollWhileVisible`) or back-fill on next open. The native build's existing `useLocalNotifications` continues to fire OS reminders independently; this phase does not change it.
- **Read-state is visible to the whole family.** It lives in the shared, family-key-encrypted document, so other members' devices can technically see _that_ you read notification X (the underlying todos/activities are already shared). No sensitive content — ids + a read timestamp only. This was Greg's explicit choice (sync over per-device).
- **Overdue is a style, not a second notification.** A `todo-due` notification keeps its id when it slips overdue; the detail/row shows an "overdue" escalation. Completing the todo removes it from the active list.
- **Re-assignment limitation.** `todo-assigned` uses `createdAt` as its occurred-at. If a member is added as an assignee _after_ creation, the assignment notification time won't reflect that. Acceptable v1 limitation — documented, not handled.
- **History window.** Time-based notifications (`todo-due`, `todo-assigned`, `activity-reminder`) are derived for a rolling **30-day** window (older drop off the list entirely). `whats-new` ignores the window and is always retained (bounded by release count), satisfying "you can always refer back to the what's new notification."
- **What's-New migration.** Existing users have a localStorage `beanies-lastSeenWhatsNew`. On first run of the new system, seed synced read-state for all `whats-new:<version>` with version **≤** that value (string `<=` comparison — versions are zero-padded date-based strings like `'2026.04'`, which sort correctly lexicographically; do NOT `parseFloat`) so they don't all resurface as unread. The localStorage read is try/catch-guarded (Requirement 8).
- **Do not put read-state in the V4 envelope.** It belongs in the Automerge `FamilyDocument` (synced content), not the file envelope.
- **Privacy mode** masks financial figures only; notification titles (todo/activity names) are not financial and are not masked.

## Assumptions

> **Review these before implementation.** Valid at planning time (2026-05-26); may have drifted. Each was verified against the codebase during the DRY/error-handling and fresh-eyes passes; the verified facts are inlined below.

1. **Schema/migration.** `FamilyDocument` (`src/types/automerge.ts`) + `initDoc()` + `ALL_COLLECTIONS` (`src/services/automerge/docService.ts`) are still the schema/seed/auto-migration mechanism. `migrateDoc()` sets any name in `ALL_COLLECTIONS` missing from an older doc to `{}` — shape-compatible with the empty `notificationReads` map, so **no bespoke migration** is needed (verified `docService.ts:104-113`). **Verified:** `ALL_COLLECTIONS` is typed `Array<Exclude<keyof FamilyDocument, 'settings'>>` (`docService.ts:76`), so adding the field to `FamilyDocument` makes adding `'notificationReads'` to that array type-required (good — it forces the migration entry). `initDoc()`'s `initial` literal (`docService.ts:41-64`) must also seed `notificationReads: {}` or it will fail to type-check.
2. **CollectionName blast radius.** Adding `notificationReads` widens `CollectionName = Exclude<keyof FamilyDocument, 'settings'>` (verified `automerge.ts:58`). **Verified safe:** `CollectionEntity<'notificationReads'>` would resolve to `Record<string,string>`, but that type is only instantiated inside `AutomergeRepository<K>` (`automergeRepository.ts:34-35`) and we never create a repository for `notificationReads` (it's mutated via raw `changeDoc`). The E2E `dataBridge` keeps its own explicit runtime `COLLECTIONS: CollectionName[]` array (`src/services/e2e/dataBridge.ts:22`) which need not be exhaustive — leaving `notificationReads` out of it simply means E2E never seeds read-state, which is intended. No CRUD-repository or E2E-bridge changes are forced.
3. **Poll + close composables.** `usePollWhileVisible(cb, intervalMs, { fireImmediatelyOnVisible, surface })` builds on the singleton `useToday().isVisible` (no extra listeners). `useEscapeClose` / `useBackGestureClose` take `(isOpen: Ref<boolean>, onClose)`. `useBackGestureClose` pushes exactly one history marker on the `isOpen` false→true edge and pops it on true→false. **Verified.**
4. **BaseSidePanel behaviour.** **Verified:** `BaseSidePanel` wraps `useFullscreenOverlay(open, close)` = `useEscapeClose` + `useBodyScrollLock`, and uses `<Teleport to="body">`. It already closes on Escape/scrim and emits `close`. It does **NOT** handle the platform-back gesture. The drawer must therefore (a) NOT add its own Escape/scroll-lock, (b) add `useBackGestureClose` with the detail→list re-arm handling described below, and (c) intercept the panel's `close`/Escape so that when `view === 'detail'` it pops to `list` instead of closing.
5. **Deep-link convention.** `GlobalSearch.selectResult` pushes `/todo?view=<id>`, `/activities?activity=<id>` (plus `vacation→/travel?vacation`, `account→/accounts?view`, `transaction→/transactions?view`, `goal→/goals?view`, `asset→/assets?view`, `member→/family?edit`). **Verified** at `GlobalSearch.vue:245-272`; still honored by the target pages.
6. **Audience model.** `classifyAudience` is a **private (non-exported)** function inside `useCriticalItems.ts` (`:57-72`) returning a `BriefingAudience` union (`assignee` | `forChild` | `unassigned` | `hidden`), with `isAdultMember` from `useMemberInfo` and a sibling private `isDutyDone` (`:35-37`). It takes `(assigneeIds, viewer, resolveMember)` and holds **no** Vue/store references — so it extracts to a pure module verbatim. It is _the_ single source of "who sees what" and can be reused with **no behaviour change** to the briefing/native reminders. **Verified.**
7. **WhatsNew retirement.** `useWhatsNew.ts` has exactly one consumer (`WhatsNewModal.vue`); `WhatsNewModal.vue` is mounted only in `App.vue` (line 1584, import line 24) and name-referenced in a comment in `PwaReinstallModal.vue` (no import). The generated `src/content/help/whats-new.ts` is unrelated marketing content. **Verified safe to retire** — update the `PwaReinstallModal` comment too.
8. **In-app gate.** `settingsStore.onboardingCompleted` + `authStore.isAuthenticated` are the auto-open gate (same as `useWhatsNew.ts:15-22`, plus the E2E `sessionStorage.e2e_auto_auth` suppression). `familyStore.currentMember` is the "known member" gate for read-state ownership. **Verified.**
9. **Activity reminder field.** `activity.reminderMinutes` exists on `FamilyActivity` (`src/types/models.ts:562`) with preset values and is the intended source for reminder lead time; `startTime` absence ⇒ all-day. **Verified.**
10. **Occurrence source.** `activityStore.activitiesForDate` expands over **`activeActivities`** (unfiltered) specifically so drop-off/pickup-only occurrences are never dropped (verified `activityStore.ts:549-556`). The existing month primitive `monthActivities` expands over **`filteredActivities`** (member-filtered, `activityStore.ts:48,309-315`), so it is the WRONG source for the duty audience. `expandRecurring` is private. The window pass therefore needs a **new public** `activeActivitiesForMonth(year, month)` over `activeActivities` (see store section). **Verified.**

## Approach

### Ownership & boundaries (read this first)

A single owner for each piece of mutable state, so a future maintainer never has to ask "who writes this?":

| State / effect                                 | Sole owner                                                                    | Notes                                                                                                                                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reactive `now`                                 | `notificationsStore`                                                          | A plain `ref`. **Only** advanced by `store.tick()`, which is called **only** by the composable's poll. Nothing else writes `now`.                                         |
| Drawer state (`isOpen`, `view`, `selectedId`)  | `notificationsStore`                                                          | All transitions go through store actions (`open`, `close`, `openTo`, `back`, `openToLatestWhatsNew`). Components and the composable **never** assign these refs directly. |
| Auto-open-once latch (`autoOpenedThisSession`) | `notificationsStore`                                                          | Set inside `openToLatestWhatsNew()`; guarantees the login auto-open can't race the manual bell toggle or double-fire.                                                     |
| Read-state writes                              | `notificationsStore` (`markRead`/`markUnread`/`markAllRead`/`pruneReadState`) | The **only** code that calls `changeDoc` on `notificationReads`. No component or composable writes read-state directly.                                                   |
| PWA app-icon badge side-effect                 | `useNotifications` composable                                                 | A `watch(store.unreadCount, …)`. The store never touches `navigator.setAppBadge`.                                                                                         |
| Poll cadence + one-time migration              | `useNotifications` composable                                                 | Calls `store.tick()` and the store's migration/prune actions; owns no business state itself.                                                                              |

### Data model

**Synced read-state** — add one top-level map to the Automerge document:

```ts
// src/types/automerge.ts — add to FamilyDocument
notificationReads: Record<string, Record<string, string>>;
// memberId → (notificationId → ISO readAt timestamp). Nested maps merge cleanly in Automerge.
```

- `initDoc()`: seed `notificationReads: {}` in the `initial` literal (`docService.ts:41-64`).
- `ALL_COLLECTIONS`: add `'notificationReads'` so `migrateDoc()` auto-creates it on older docs (no bespoke migration). Adding the field to `FamilyDocument` makes both edits type-required.

**Derived notification (in-memory only):**

```ts
// src/types/notifications.ts
export type NotificationKind = 'todo-due' | 'todo-assigned' | 'activity-reminder' | 'whats-new';

export interface AppNotification {
  id: string; // deterministic stable id (see below)
  kind: NotificationKind;
  title: string; // resolved, display-ready
  body?: string; // one-line summary
  occurredAt: string; // ISO — the moment this became active (its trigger time)
  overdue?: boolean; // todo-due escalation flag
  route?: string; // deep-link path for "Open"
  query?: Record<string, string>; // deep-link query (e.g. { view: todoId })
  sourceId?: string; // entity id
  occurrenceDate?: string; // recurring activity occurrence
  read: boolean; // resolved against the read-state map
}
```

Note: **`accent` and `icon` are NOT on the notification** — they are presentation, derived from `kind` via the per-kind table below, so the pure deriver never decides emoji or colour.

**Per-kind presentation map (single edit surface for new kinds).** To keep kind-switching from sprawling across the deriver, the row, and the detail as `daily-hint` / `push` are added later, co-locate all per-kind presentation in one table next to the type:

```ts
// src/types/notifications.ts (or a sibling notificationKinds.ts)
import type { Component } from 'vue';
export interface KindPresentation {
  accent: 'todo' | 'activity' | 'assigned' | 'whats-new';
  icon: string;            // emoji
  detailBody?: Component;  // custom detail body (whats-new uses WhatsNewBody); undefined ⇒ default meta card
}
export const NOTIFICATION_KIND_PRESENTATION: Record<NotificationKind, KindPresentation> = { … };
```

`NotificationRow` reads `accent`/`icon` from this map; `NotificationDetail` reads `detailBody` from it. Adding a future kind is: one `NotificationKind` union member, one deriver block, one table entry (and a body component only if it needs a custom one) — no scattered `v-if` edits.

**Stable ids** (one per logical event; escalation reuses the id):

- `todo-due:<todoId>:<dueDate>`
- `todo-assigned:<todoId>`
- `activity-reminder:<activityId>:<occurrenceDate>`
- `whats-new:<version>`

### Derivation — pure and unit-tested

`src/utils/notifications.ts` exports a **pure, total** `deriveNotifications(input, now): AppNotification[]` where `input` is a plain snapshot:

```ts
interface DeriveInput {
  todos: Todo[];
  members: FamilyMember[];
  currentMember: FamilyMember;
  releaseNotes: readonly ReleaseNote[];
  readState: Record<string, string>; // the current member's id→readAt map
  windowDays: number; // 30
  // Activity occurrences already resolved for the window, bucketed by date.
  // The store assembles this with ONE month-bucketed pass over the UNFILTERED
  // activeActivities source (see store note) so the deriver stays pure AND we
  // never re-expand the same month 30×ed AND drop-off/pickup-only occurrences
  // are never dropped.
  occurrencesByDate: Record<string, { activity: FamilyActivity; date: string }[]>;
}
```

It must never throw — each entity loop is individually defensive (skips a malformed record with a `console.warn` rather than aborting). It:

1. Builds `todo-assigned`, `todo-due` from todos (reusing `normalizeAssignees`, the **extracted shared audience classifier**, `isTodoOverdue`, `parseIsoDateSafely`, and `localToday`). Trigger-time rules per Requirement 4. Completed/someday excluded; due notifications for completed todos excluded.
2. Builds `activity-reminder` by iterating the pre-resolved `occurrencesByDate` for dates in `[now − windowDays, now]` + the shared duty/assignee audience, firing at `start − reminderMinutes` (default 30; no `startTime` ⇒ all-day ⇒ morning-of). **The deriver does not resolve occurrences itself** — the store supplies `occurrencesByDate`, built once per window over `activeActivities` (see store note), so we avoid both the per-day month re-expansion cliff and the member-filter trap.
3. Builds `whats-new` from `releaseNotes` (all releases; window-exempt).
4. Drops time-based items whose `occurredAt` is in the future (not yet active) or older than the window.
5. Resolves `read` from `readState`; sorts newest-active first within Today/Earlier groups.

**Pure read-state reducers** live in the same module and take/return plain maps (`Record<string, string>` — the current member's slice), so they're trivially testable and reused by the store's `changeDoc` callbacks:

- `markReadIn(map, id, nowIso) → map'`
- `markUnreadIn(map, id) → map'`
- `markAllReadIn(map, ids, nowIso) → map'`
- `pruneReadState(map, keepIds) → map'` — **drops every entry whose id is not in `keepIds`, with one explicit exemption: any `whats-new:*` id is always kept** (whats-new is window-exempt; pruning it would resurface old releases as unread). The store builds `keepIds` from its own currently-derived `notifications`, so prune ownership and predicate are unambiguous and unit-testable in isolation.

### Orchestration — store + thin side-effect composable

**`src/stores/notificationsStore.ts`** (Pinia, MVO orchestrator). Sole owner of `now`, drawer state, and read-state writes (see Ownership table):

- Imports `todoStore`, `activityStore`, `familyStore`, `settingsStore`; holds a reactive `now` ref.
- **`snapshot = computed(...)`** — pure assembly only: reads `docVersion.value` (so read-state mutations via raw `changeDoc` re-trigger it), gathers todos, members, currentMember's `readState` slice, release notes, and builds `occurrencesByDate` with a **single month-bucketed pass** (compute the distinct year-months spanning `[now − 30d, now]` — at most two — expand each once via the new `activityStore.activeActivitiesForMonth(year, month)`, bucket occurrences by date) rather than 30 `activitiesForDate` calls. Reactive to store data, `docVersion`, and `now`.
  - **Source trap (MUST read):** the new `activeActivitiesForMonth` MUST expand over `activeActivities` (the unfiltered source `activitiesForDate` uses), **NOT** `filteredActivities` / the existing `monthActivities`. `filteredActivities` member-filters on `normalizeAssignees`, which would silently drop occurrences where the current member is _only_ a drop-off/pickup duty-holder — breaking the duty audience for `activity-reminder`. The store/derive test must assert a duty-only occurrence still produces a notification.
- **`notifications = computed(...)`** — calls `deriveNotifications(snapshot.value, now.value)` **inside a try/catch** that returns `[]` + `reportError` on any unexpected throw. (Splitting assembly from derivation keeps each computed single-responsibility and independently testable.)
- `unreadCount`, `hasUnread` computeds.
- **Drawer UI state + actions:** `isOpen`, `view: 'list' | 'detail'`, `selectedId`, `autoOpenedThisSession` (private latch). Actions: `open()`, `close()`, `back()` (pops `detail → list`; from `list` ⇒ `close()`), `openTo(id)` (open at a notification's detail + mark read), `openToLatestWhatsNew()` (no-op if `autoOpenedThisSession` or no unseen release; otherwise set the latch, open to the latest unseen `whats-new`). The bell toggles via `open()`/`close()`; nothing outside the store assigns these refs.
- **Read-state mutations** via **direct `changeDoc`** on `doc.notificationReads[memberId]` (the established non-CRUD pattern — see `familyStore.normalizeRoles`, `familyStore.ts:348-374`): `markRead(id)`, `markUnread(id)`, `markAllRead()`, `pruneReadState()`. Each first checks `isDocLoaded()` + `familyStore.currentMember`; on a missing precondition logs `[notificationsStore.<fn>]` + `reportError` and returns; the `changeDoc` body is wrapped in try/catch with the same breadcrumb + report (never a silent no-op, never an unhandled throw). The pure reducers compute the new map; the `changeDoc` callback writes it (initialise `doc.notificationReads[memberId]` to `{}` if absent before writing). `markAllRead()` builds its id set from **every currently-active unread notification in `this.notifications`** (not from rendered rows). `pruneReadState()` derives its `keepIds` from `this.notifications` (own source of truth).
- `tick()` — **updates `now` and nothing else.** `openSource(notification)` — router push via the shared `entityDeepLink` helper, then `close()`.

**`src/stores/activityStore.ts`** — add a small public method:

- `activeActivitiesForMonth(year, month): { activity: FamilyActivity; date: string }[]` — same body shape as the private `monthActivities` but iterating `activeActivities` (not `filteredActivities`), so it matches `activitiesForDate`'s source and includes duty-only occurrences. This is the only `activityStore` change; do not expose the private `expandRecurring` directly. (A one-line internal helper keeps `monthActivities` and `activeActivitiesForMonth` DRY if desired, parameterised by source — optional.)

**`src/composables/useNotifications.ts`** — a side-effect-only composable called **once** in `App.vue` (mirrors `useLocalNotifications()`). Owns no business state; only triggers store actions and the badge effect:

- Starts `usePollWhileVisible(() => store.tick(), 60_000, { fireImmediatelyOnVisible: true, surface: 'notifications-tick' })` so time-based items activate while open and on tab wake. (The poll already catches + reports a throwing `tick`.)
- Syncs the **PWA app badge** to `store.unreadCount` via a `watch` — feature-detected (`'setAppBadge' in navigator`), each call in try/catch, `clearAppBadge()` at 0, single `console.warn` on failure (no `reportError` — absence is expected). This `watch` is the **only** badge writer.
- Runs the **one-time What's-New localStorage→synced migration** (try/catch on the `localStorage.getItem`; string `<=` version comparison) and triggers `store.pruneReadState()` on init, gated on a loaded doc + present member.
- **Auto-opens** the drawer by calling **`store.openToLatestWhatsNew()`** when the gate flips true (`isAuthenticated` + `onboardingCompleted` + not E2E). The store's latch makes this idempotent and race-free; the composable never writes drawer state directly.

### UI components (`src/components/notifications/`)

- **`NotificationsBell.vue`** — header button + badge (dot default / count variant), calls `store.open()`/`store.close()`. A single shared component placed in `AppHeader.vue`'s desktop squircle cluster AND its mobile header section AND `CalendarCommandBar.vue`'s reclaimed mobile trailing group (beside `SearchButton`) — see Requirement 1 for why the command-bar placement is required (AppHeader is hidden on the mobile planner). Mirrors how `SearchButton`/`HamburgerButton` are now shared between AppHeader and the command bar.
- **`NotificationsDrawer.vue`** — uses `BaseSidePanel` (right). **Relies on the panel's built-in Escape + scroll-lock + teleport — does NOT re-add them.** Reads `store.view`. Both the panel's `@close` (Escape/scrim/X) and the platform-back gesture must route through `store.back()` (pops `detail → list` when in detail, else closes). Header: title + "Mark all read" (list view) / back arrow + item title (detail view). Mounted **once** in `App.vue` (replacing the `<WhatsNewModal />` mount).
  - **Back-gesture wiring (MUST read — `useBackGestureClose` only manages ONE history entry):** `useBackGestureClose` pushes a single history marker on the `isOpen` false→true edge and pops it on the true→false edge; it does **not** re-push on internal state changes. The drawer has a three-state machine (closed / list / detail), so naïvely wiring `onClose: () => store.back()` is **buggy**: the first back gesture from `detail` pops `detail → list` (consuming the single marker) but leaves `isOpen === true` with no marker on the stack, so a _second_ back gesture escapes the drawer and navigates the app instead of closing it. Implement one of these (prefer A for simplicity):
    - **A (simplest, robust):** bind `useBackGestureClose(detailViewRef, () => store.back())` where `detailViewRef = computed(() => store.isOpen && store.view === 'detail')` for the inner pop, **and** a second `useBackGestureClose(listViewRef, () => store.close())` where `listViewRef = computed(() => store.isOpen && store.view === 'list')` for closing from the list. Each guards a single layer, so each gets its own marker and re-arms automatically as `view` transitions flip the two refs. (Two instances; the per-instance marker keys are unique by design — verified `useBackGestureClose.ts:11-20`.) **Ordering caveat (verified `useBackGestureClose.ts:122-138`): `popMarker` calls `history.back()` (async); `pushMarker` calls `pushState` (sync). On a `list → detail` FORWARD tap both fire in the same tick (list ref true→false pops, detail ref false→true pushes), so make the `view` change in a SINGLE store action (Vue batches both watchers in one flush) and don't also process the panel's `@close` during that transition. Add a forward-direction test (open → list → detail → list → detail) asserting the marker count stays bounded and a back from detail still pops to list, alongside the back-direction test. This is the first two-concurrent-instance use of the primitive in the app — if the forward test shows history-stack churn, fall back to option C below.**
    - **C (fallback if A is flaky):** ONE `useBackGestureClose(isOpenRef, () => store.close())` so platform-back always closes the whole drawer cleanly (never escapes to navigation), and handle `detail → list` purely via the in-header back-arrow tap + the Escape/`@close` intercept (`view === 'detail'` ⇒ `store.back()` else close). Slightly less "hierarchical platform-back," but zero marker churn and provably correct. Decide between A and C from the forward-direction test result during implementation.
    - **B (single instance + manual re-arm):** bind one `useBackGestureClose(isOpenRef, handler)` where `handler` calls `store.back()`, and after a `detail → list` pop programmatically re-push a marker so the next gesture is caught. This re-enters the primitive's private state and is more fragile than A.
  - Choose **A**. Add a drawer/component test asserting: back from detail → list (drawer stays open), back again → closed.
- **`NotificationRow.vue`** — presentational list row; reads `accent`/`icon` from `NOTIFICATION_KIND_PRESENTATION[kind]`. Tinted squircle lead icon, title, body, relative time via `timeAgo`/`formatLogEntryTime`, unread dot, read styling.
- **`NotificationDetail.vue`** — renders the body component from `NOTIFICATION_KIND_PRESENTATION[kind].detailBody` (falls back to the default meta card when undefined) plus "Open in <page> →" + "Mark unread". **No per-kind `v-if` ladder** — the table drives it.
- **`WhatsNewBody.vue`** — the rich release content (feature cards, "Try it →", "also fixed", signature) extracted **verbatim** from the retiring `WhatsNewModal.vue` (including its scoped styles and the `txt(val)` beanie/en switch), so nothing is lost and it's a clean unit inside the detail. Referenced from the kind table as `whats-new`'s `detailBody`.

Group headers (Today / Earlier, or finer Today / Tomorrow / Yesterday) use `relativeDayLabel(dateStr, t)` — no new label helper.

### Shared-helper extractions (DRY)

- **Audience classifier.** Move the private `classifyAudience` + `BriefingAudience` type + `isDutyDone` from `useCriticalItems.ts` into a new shared **pure** module (e.g. `src/utils/audience.ts`) — it already takes `(assigneeIds, viewer, resolveMember)` and imports only `isAdultMember`, so keep it Vue/store-free. Exported and consumed by both `useCriticalItems` and `deriveNotifications`. Verbatim move — no behaviour change to the briefing/native reminders. `useCriticalItems` keeps its message-key tables and rendering; only the audience primitive relocates. This is the single source of "who sees what"; duplicating it would risk the two copies drifting — hence the extraction (not just a move) plus a lock-in test.
- **Deep-link map.** Extract the `selectResult` entity→route/query switch from `GlobalSearch.vue` into a shared `entityDeepLink(type, id): { path: string; query: Record<string,string> }` helper (cover the full `ResultType` enum, not just todo/activity). `GlobalSearch.vue` calls `router.push(entityDeepLink(...))`; the notification "Open" action reuses the same helper. No behaviour change to search navigation.

### Retirements

- Delete `src/components/common/WhatsNewModal.vue` and `src/composables/useWhatsNew.ts` (logic absorbed into the deriver + migration + `WhatsNewBody`). Remove the `App.vue` mount/import. Update the comment reference in `PwaReinstallModal.vue` (it cites "same guard WhatsNewModal uses" — repoint to the new auto-open gate or the E2E guard helper).

## Files Affected

**New**

- `src/types/notifications.ts` — `AppNotification`, `NotificationKind`, `NOTIFICATION_KIND_PRESENTATION` (per-kind accent/icon/detailBody table).
- `src/utils/notifications.ts` — pure `deriveNotifications`, stable-id builders, read-state reducers (`markReadIn`/`markUnreadIn`/`markAllReadIn`/`pruneReadState`).
- `src/utils/audience.ts` — extracted pure `classifyAudience`, `BriefingAudience`, `isDutyDone` (shared by `useCriticalItems` + deriver).
- `src/utils/entityDeepLink.ts` — extracted entity→route/query map (shared by `GlobalSearch` + notification "Open").
- `src/stores/notificationsStore.ts` — `snapshot` + `notifications` computeds, unread count, drawer state/actions, `now` + `tick`, read-state mutations.
- `src/composables/useNotifications.ts` — poll tick, app-badge sync, migration/prune trigger, auto-open-on-login (delegates to store actions).
- `src/components/notifications/NotificationsBell.vue`
- `src/components/notifications/NotificationsDrawer.vue`
- `src/components/notifications/NotificationRow.vue`
- `src/components/notifications/NotificationDetail.vue`
- `src/components/notifications/WhatsNewBody.vue`
- Test files: `src/utils/__tests__/notifications.test.ts` (primary, comprehensive), `src/stores/__tests__/notificationsStore.test.ts`, `src/utils/__tests__/audience.test.ts` (lock the extracted behaviour), `src/utils/__tests__/entityDeepLink.test.ts`, plus component tests for Bell / Drawer / Row.
- Help Center article (see Help Center Coverage).

**Modified**

- `src/types/automerge.ts` — add `notificationReads` to `FamilyDocument`.
- `src/services/automerge/docService.ts` — seed in `initDoc()`'s `initial` literal, add to `ALL_COLLECTIONS`.
- `src/stores/activityStore.ts` — add public `activeActivitiesForMonth(year, month)` over `activeActivities` (the unfiltered source) for the window pass.
- `src/components/common/AppHeader.vue` — mount `<NotificationsBell />` (desktop cluster + mobile header, before the privacy toggle in each).
- `src/components/planner/CalendarCommandBar.vue` — mount `<NotificationsBell />` in the reclaimed mobile trailing group (beside `SearchButton`, gated on `headerReclaimed`) so the bell is reachable on the mobile planner where AppHeader is hidden. **(New in the 2026-05-27 re-validation.)**
- `src/App.vue` — replace `<WhatsNewModal />` with `<NotificationsDrawer />`; remove the `WhatsNewModal` import; call `useNotifications()` once.
- `src/composables/useCriticalItems.ts` — import the extracted audience helpers from `@/utils/audience` (remove the now-duplicated private copies); no behaviour change.
- `src/components/common/GlobalSearch.vue` — consume `entityDeepLink()`.
- `src/components/common/PwaReinstallModal.vue` — repoint the stale "same guard WhatsNewModal uses" comment.
- `src/services/translation/uiStrings.ts` — add `notifications.*` (`{ en, beanie? }`, single-line-parseable); run `npm run translate` to regen zh; verify the parser's "Parsed N strings" count rose as expected.

**Deleted**

- `src/components/common/WhatsNewModal.vue`
- `src/composables/useWhatsNew.ts`

## Help Center Coverage

- **Action**: `new article`
- **Category**: `features`
- **Article type**: `explainer` (with a short how-to on the bell + mark-all-read)
- **Slug**: `notifications`
- **Title**: Notifications — staying on top of what needs you
- **Scope**: Explains what the bell shows (tasks coming due, tasks assigned to you, upcoming events, and what's new), how unread vs read works, that read-state syncs across your devices, and that this is in-app only for now (push is coming). Frames it as "we'll quietly keep track so you don't have to."
- **Notes**: Call out that read-state is shared within the family document (other members can't see your _content_ beyond the already-shared tasks, but it does sync your read-state across your own devices); and that "What's New" now lives in the bell rather than a pop-up. Written per `.claude/skills/beanies-help-docs/SKILL.md`, shipped in the same change.

## Acceptance Criteria

- [ ] A Heritage Orange unread indicator appears on the header bell (desktop + mobile) and the PWA app icon whenever the current member has ≥1 unread notification, and clears everywhere when the last is read / "mark all read".
- [ ] Bell opens a single `BaseSidePanel`; rows slide to a detail view with a back arrow; Escape/back pops detail→list then closes (a second back gesture from `list` closes the drawer — never escapes to navigation); behaves identically on mobile. (Escape/scroll-lock come from the panel; back-gesture from `useBackGestureClose`, wired per-layer so each transition re-arms — no double-wiring of Escape.)
- [ ] `todo-due` fires morning-of for dated-no-time todos and ~30 min before for dated+timed todos, escalates when overdue, and disappears when the todo is completed.
- [ ] `todo-assigned` fires when someone else assigns me a todo, and for self-assigned no-date/no-time todos; not for self-assigned dated todos.
- [ ] `activity-reminder` fires at start − `reminderMinutes` (default 30; no `startTime` → morning-of) for occurrences I'm an assignee/drop-off/pick-up for, resolved via a single month-bucketed pass over the **unfiltered** `activeActivities` (no per-day month re-expansion; a drop-off/pickup-only occurrence still fires).
- [ ] `whats-new` notifications exist for releases, the latest unseen one auto-opens the drawer once on login (via the store's latch — never double-fires against a manual open), and prior releases remain findable and never pruned; the old `WhatsNewModal` is gone with no regression.
- [ ] Opening a notification marks it read; it can be marked unread from detail; "mark all read" clears all current unread (full derived set, including notifications whose row was never scrolled into view); read-state syncs across the member's devices via the family file.
- [ ] "Open" from detail navigates to and opens the source item via the shared `entityDeepLink` helper (same paths as search).
- [ ] Older `.beanpod` files load and gain `notificationReads` automatically; no silent failures anywhere in the flow (read-state mutation, Badging, localStorage migration, derivation are all guarded + reported).
- [ ] Adding a hypothetical new kind touches only the union, one deriver block, and the presentation table — confirmed by inspection (no scattered `v-if`).
- [ ] Comprehensive unit tests pass (esp. task-due), full `npm run validate` green, zh regenerated and the parser count matches.
- [ ] Help Center article added per **Help Center Coverage** and matches shipped behavior.

## Testing Plan

1. **Pure deriver (`notifications.test.ts`) — comprehensive, primary:**
   - `todo-due`: dated-no-time → morning-of; dated+timed → 30-min-before; overdue flag; completed/someday excluded; not-eligible excluded; audience matrix (assignee / unassigned-eligible / for-child / hidden); 30-day window boundary; stable-id determinism.
   - `todo-assigned`: other-creator fires; self+no-date fires; self+dated does **not**; other+dated yields both assigned and due (distinct ids).
   - `activity-reminder`: timed → start−reminderMinutes; no-`startTime` → morning-of; default 30 when unset; recurring occurrences within window (via a stubbed `occurrencesByDate`); assignee/drop-off/pick-up audience — **including an occurrence where the member is ONLY a drop-off/pickup (not in assignees), which must still produce a notification** (guards the source trap).
   - `whats-new`: one per release; latest-unseen unread; read-state respected; window-exempt.
   - read resolution + `unreadCount`; `markReadIn`/`markUnreadIn`/`markAllReadIn` pure reducers.
   - `pruneReadState`: drops stale entries; **always keeps `whats-new:*` entries even when not in keepIds.**
   - **Totality:** a malformed todo/activity (bad date, missing fields) is skipped, not thrown — `deriveNotifications` never throws.
2. **Audience (`audience.test.ts`):** lock `classifyAudience`/`isDutyDone` behaviour post-extraction (assignee / forChild / unassigned / hidden / pet / all-stale-ID cases).
3. **Deep-link (`entityDeepLink.test.ts`):** assert at minimum `entityDeepLink('todo', id)` and `entityDeepLink('activity', id)` (the only kinds notifications use) match the pre-extraction `selectResult` path/query; the remaining `ResultType` mappings are covered by the existing `GlobalSearch` navigation regression (item 6). Right-sized — no need for a separate exhaustive 8-type file purely for this feature.
4. **Store (`notificationsStore.test.ts`):**
   - read-state mutations write the correct `doc.notificationReads[memberId]` shape via `changeDoc` (incl. initialising the member slice to `{}` when absent); no-doc / missing-member guards log + report and no-op (no throw); the `notifications` computed returns `[]` + reports if the deriver throws.
   - `snapshot` builds `occurrencesByDate` via `activeActivitiesForMonth` with a bounded number of month expansions (assert it's called ≤ the distinct-months count, not ~30×) and over the **unfiltered** source (a duty-only occurrence appears in the snapshot).
   - `markAllRead()` marks every active unread in `this.notifications`, not just a rendered subset (feed many notifications, render none, assert all become read).
   - drawer state machine: `back()` pops detail→list then closes; `openTo` marks read; `openToLatestWhatsNew()` is idempotent (second call is a no-op) and a no-op once `autoOpenedThisSession` is set or there's no unseen release.
   - localStorage→synced what's-new migration (incl. localStorage-throws path; string `<=` version comparison seeds the right set); prune drops stale `readAt` entries but retains whats-new.
5. **Components:** `NotificationRow` (unread vs read, accent/icon from the kind table, relative time), `NotificationsDrawer` (list↔detail via `store.view`, back pops detail→list with drawer still open then a second back closes, mark-all-read, open-source push, no double Escape wiring), `NotificationsBell` (dot/count, toggle calls store actions).
6. **Regression:** `useCriticalItems` briefing + native reminders unchanged after the audience extraction; `GlobalSearch` navigation unchanged after the `entityDeepLink` extraction; `monthActivities` callers unchanged after adding `activeActivitiesForMonth`.
7. **No new E2E** (Three-Gate filter: in-app only, no data loss, fully covered by unit/component) — note in `docs/E2E_HEALTH.md` if revisited.
8. **Manual:** desktop + mobile bell/drawer; two-device read-state sync; old-doc load; Badging API on a supporting browser **and** on one without it (graceful no-op); reduced-motion; **platform-back twice from detail (detail→list→closed, never escaping to navigation)**; family with many recurring activities (confirm the bell stays responsive across poll ticks — validates the month-bucketed resolver).

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the full derived-notifications + synced-read-state design, Treatment-B single drawer, four triggers with exact timing, What's-New folding + migration, file inventory, ACs, and the comprehensive test plan.
- **Pass 2 (DRY + error handling)**: Verified every reuse claim against the codebase. Corrected: `BaseSidePanel` already wires Escape + scroll-lock + teleport (via `useFullscreenOverlay`) — only `useBackGestureClose` is new, so the drawer must not double-wire and must intercept close to pop detail→list. Pinned real shapes: `classifyAudience`/`BriefingAudience`/`isDutyDone` are private inside `useCriticalItems` (extract to `utils/audience.ts`); occurrence resolution is `activityStore.activitiesForDate` (`{activity,date}[]`, month-scoped). Reuse existing `timeAgo`/`formatLogEntryTime`/`relativeDayLabel`/`parseIsoDateSafely`/`localToday` instead of new helpers. Documented the line-based regex translate-script constraint. Confirmed `notificationReads` widens `CollectionName` harmlessly (no repository instantiated; `dataBridge` has its own list). Hardened all fallible paths with guards + `reportError` and added a totality test. Added `entityDeepLink` extraction + tests; flagged the stale `PwaReinstallModal` comment.
- **Pass 3 (Sustainability)**: Split the store's single overloaded computed into `snapshot` (pure assembly) + `notifications` (try/catch + derive) to keep each single-responsibility. Pinned **single-owner boundaries** in an Ownership table: `now` (store, advanced only by the poll's `tick()`), drawer state (store actions only), read-state writes (store's four mutators only), badge (composable's lone `watch`). Eliminated the auto-open double-fire risk by giving the store an `autoOpenedThisSession` latch + `openToLatestWhatsNew()` action that the composable merely calls. Defined the prune **predicate** and its owner (store builds `keepIds` from its own `notifications`; `whats-new:*` always exempt) so it can't accumulate cruft or wrongly resurface releases. Replaced scattered kind-switching with a co-located `NOTIFICATION_KIND_PRESENTATION` table (accent/icon/detailBody), moving `accent`/`icon` off the notification object so the deriver makes no presentation decisions — adding a future kind is one table entry. Caught a reliability cliff: `activitiesForDate` re-expands the whole month per call, so 30 day-queries per derive (re-run every poll tick) is wasteful; required a single month-bucketed occurrence pass feeding the deriver via `occurrencesByDate`, with a store test asserting the bound.
- **Re-validation (2026-05-27, pre-implementation)**: Audited every assumption against current `main` after the 2026-05-27 AppHeader refactor + mobile header-reclaim. All schema/audience/occurrence/primitive/WhatsNew/translate assumptions confirmed unchanged. **One drift fixed:** the mobile planner now hides `AppHeader` (`headerReclaimed`), so the bell must also mount in `CalendarCommandBar`'s reclaimed trailing group (beside `SearchButton`) — `NotificationsBell` is now a shared component in three spots, `CalendarCommandBar.vue` added to Files Affected. `entityDeepLink` extraction still targets `GlobalSearch.vue`'s `selectResult` (logic stayed there; only the button + mount moved into `SearchButton.vue`). No other edits needed.
- **Post-implementation refinement (2026-05-27, greg review)**: After building, greg refined the row + the mark-unread affordance (mockup `docs/mockups/notifications-row-2026-05-27.html`). (1) Each row is now useful at a glance: bold **title** (entity name) + **summary** (who · where, with a chip for the viewer's drop-off / pick-up duty) + the real **date + time** — so the deriver now also emits `subtitle`, `eventDate`/`eventTime`, `dutyRole`, and `assignedByName` (all pure), and `notificationKinds.ts` gained `notificationTitle`/`notificationSummary`/`notificationWhen`/`dutyRoleLabelKey` to compose the localised lines. (2) **Read/unread moved onto the row** as a tappable pip (solid orange = unread → tap to read; hollow ring = read → tap to unread); the detail's **Open** is now the sole prominent primary, with "Mark unread" demoted to a quiet text link beneath it (kept for discoverability per greg). New i18n: `notifications.due`/`yourTask`/`assignedByYou`/`youDropoff`/`youPickup` (zh hand-corrected for the duty terms).
- **Pass 4 (Fresh-eyes sweep)**: Fixed two correctness bugs and pinned one comparison. (1) **Back-gesture detail→list→close**: `useBackGestureClose` manages a single history marker keyed on `isOpen`, so wiring `onClose: () => store.back()` left no marker after the detail→list pop and a second back gesture escaped the drawer — specified per-layer back-gesture instances (one for detail→list, one for list→close) so each transition re-arms. (2) **Occurrence source trap**: the month-bucketed pass must expand over the unfiltered `activeActivities` (via a new public `activeActivitiesForMonth`), not the member-filtered `monthActivities`, or drop-off/pickup-only reminders would be silently dropped; added the duty-only test. (3) **What's-New migration**: pinned string `<=` comparison (date-based zero-padded versions, never `parseFloat`). Also clarified `markAllRead` covers the full derived set (not rendered rows) with a test, and that `changeDoc` is `(fn, message?)` requiring slice-init. Rest of the plan confirmed sound — no scope added.

## Prompt Log

<details>
<summary>Full prompt history (also mirrored as a comment on the GitHub issue)</summary>

### Initial prompt (feature request)

> Let's work on making the notifications capability of the app functional, as this is one of the most important aspects of the beanies app - to know when you have to take care of something for your family.
>
> For now, we will work on the below: Adding a functional notifications icon (with badge) to the header; Triggering notifications as required at the correct times in a secure and robust way; Ensuring notifications appear in your notifications drawer reliably and in the right way; Notifications can be marked as read. We will not implement push notifications yet - just getting notifications to work and show up correctly in the notifications drawer / screen.
>
> As a member of a beanie family, I would like to be notified when important events are coming up, or when I have to do important things, like pick up my kids, get the groceries, or when one of my family members puts in a task for me, so I can stay on top of my personal and family life and feel less stressed that I may be forgetting something (or someone).
>
> Key requirements: Activate in-app notifications (notifications view from a header icon) + red dot on the app badge when unread. Push notifications enabled as a future functionality. A notification is triggered when any family task is coming due to the assignee of the task. Write comprehensive tests. Active notifications display a red dot/badge on the notification icon; if unread, the bell and PWA/app icon show a red dot/badge; cleared when all read. Clicking a summary from the bell dropdown opens a sidebar drawer with full details; from there navigate to the originating screen/item. Notifications are unread when generated, read once opened; can be closed or marked unread again from the drawer; a "mark all read" function removes the unread dot everywhere.
>
> (FUTURE — not now) per-category/per-event push enablement; in-app vs push (global or per category); after dismissing the same push 3×, offer to turn off push with a comforting message; notification preferences in Settings.
>
> IMPORTANT NOTE: the "what's new" notifications (currently a custom modal on login) should ALSO be considered a notification — open in the notification drawer on login when available, closable/markable like any other notification, and findable later in the list. In the future the "daily hint" may also become a notification.
>
> Ask if any questions before implementing. Once all requirements are clear, create a mockup with your proposal(s).

### Follow-up — clarifying answers (round 1)

> Triggers: **all three** — task coming due (assignee), task newly assigned to me, calendar event/activity coming up. Plus the question: "what about when a single user uses the app across multiple devices (2 phones and a laptop)?"
> Timing: morning-of for todos with a date but no time; if no date or time, only when the todo is assigned (even if self-assigned); for activities, use the existing "reminder" field — default 30 min before the activity start time.

### Follow-up — clarifying answers (round 2)

> Read-state: **sync via the family file** (read on phone clears the badge on laptop).
> Timed to-dos (date + time): **fixed lead before the time** (~30 min, matching the activity default) + overdue escalation.

### Follow-up — plan instruction (this invocation)

> let's make a plan to implement this for Treatment B as per the mockup (notifications in one drawer). Please CREATE a github issue for this - we will not implement in this session. Ensure the saved plan and issue contains all the relevant information to pick this up later.

</details>
