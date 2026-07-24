# Plan: Tapping an OS reminder notification opens the specific item

> Date: 2026-07-24
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-07-24-notification-tap-deeplink.md`

> **No GitHub issue created.** This plan was approved for direct implementation. Full prompt history is in the Prompt Log below.

## User Story

As a family member, I want tapping a reminder notification on my phone to open the exact thing it is about — the activity, to-do, travel plan (or Helpful Hint) — so that I can act on it in one tap instead of landing on a generic screen and hunting for it.

## Context

The #55 OS local notifications (Capacitor `LocalNotifications`, native-only) fire and display correctly, but **tapping one does nothing useful** — the app just resumes to the Nook / last screen with no item open. This is a bug (an unimplemented deep-link), not intended behaviour.

Two gaps (confirmed in code):

1. **No tap handler.** `useLocalNotifications()` (`useLocalNotifications.ts:391`) registers only `localNotificationReceived` (delivery telemetry, lines 404-425). There is no `localNotificationActionPerformed` (tap) listener anywhere, so a tap just resumes the app with no navigation.
2. **No target in the payload.** `buildScheduledNotifications` (`useLocalNotifications.ts:100-111`) sets `extra: { kind, at }` only. The delivered notification's numeric `id` is a lossy FNV hash (`stableNotificationId`, line 82) — the entity id is **not** recoverable from it — so the payload must carry the target explicitly.

By contrast, the recently-fixed **Google Calendar** deep link works because a calendar event is a **URL** (`/activities?activity=<id>`) that the router + `useDeepLinkParam` handle. The local-notification tap never reaches that URL/router layer.

The infrastructure to do this already exists and is reused, not rebuilt:

- `entityDeepLink(type, id)` (`entityDeepLink.ts:15`) → `{ path, query }` for all 8 entity types. It is a **leaf util** (no app-module imports) already imported by `utils/notifications.ts`, `utils/calendar/eventDescription.ts`, and `GlobalSearch.vue`, so importing it into the reminder builder adds **zero cycle risk**.
- The **in-app bell "Open"** button already navigates via `router.push({ path, query })` (`NotificationDetail.vue:23-27`) — the exact warm-path navigation to reuse.
- Every destination page already wires `useDeepLinkParam({ param, open, ready })` (FamilyPlannerPage `activity`, FamilyTodoPage `view`, TravelPlansPage `vacation`, etc.) so **once the app navigates to the URL, the page opens the modal itself once its store hydrates** — no per-page work needed.
- The **cold-start defer/resume** pattern is proven in `useCalendarRedirectResume`.

## Requirements

1. Tapping any reminder notification navigates to the item it concerns and opens it:
   - **activity** reminder (generic and dropoff/pickup duty) → `/activities?activity=<activityId>`
   - **to-do** reminder (timed + all-day, incl. **Helpful Hint** to-dos) → `/todo?view=<todoId>`
   - **travel** reminder → `/travel?vacation=<vacationId>`
2. Works in both cases: **app alive** (warm tap → navigate immediately) and **app killed** (cold-start tap → navigate once the family doc is loaded and the pod is ready).
3. Never navigates into an un-ready app (not signed in / pod not created / family doc not loaded) — defers until ready, then navigates.
4. Degrades gracefully: a tap with no target (notification scheduled by an older build) or a target that no longer exists (item deleted) lands the user on the relevant page without a crash, and is logged.
5. Native-only (OS notifications are native-only; the PWA uses the in-app bell). No behaviour change on web.
6. Not feature-gated.

## Important Notes & Caveats

- **`useLocalNotifications` stays router-free.** The tap listener forwards the raw `extra` to `handleReminderTap` in the resume module; a small new composable (`useReminderTapResume`, initialized in `App.vue` next to `useCalendarRedirectResume`) owns the router + navigate-when-ready logic.
- **The stash is a module ref, not sessionStorage.** A notification tap is an **in-process** Capacitor event — unlike the OAuth redirect (which tears down the JS context and needs sessionStorage), the native app keeps the same JS context across a cold-start tap, so a module-scoped reactive ref survives from the tap until the doc loads.
- **Cold-start listener timing & ordering.** The Capacitor event is delivered asynchronously (later tick), so the `useReminderTapResume()` call one line after `useLocalNotifications()` in `App.vue` setup has already established its watch. Even if a stash landed first, `pendingIntent` is **module-scoped** and the watch uses `{ immediate: true }`, so its first synchronous run consumes it — the intent cannot be lost to ordering.
- **CRITICAL — the reactive doc-loaded signal.** `isDocLoaded()` (`docService.ts:23`) / `isLoaded()` (`projection.ts:36`) read a **plain module-level `let loaded` boolean** — not a ref. `computed(() => podCreated && isDocLoaded())` would be reactive to `podCreated` **only**; when the doc loads (`bumpDocVersion()` flips `loaded` and bumps `docVersion`) the computed would **not** re-evaluate, the watch would never re-fire, and the deferred intent would sit unnavigated forever — a **silent failure of the entire cold-start path**. The readiness computed MUST read `docVersion.value` (a `shallowRef`, `projection.ts:28`, re-exported from `docService.ts:18`).
- **One `DeepLink` shape from builder → payload → router.** `ScheduledReminder.deepLink` holds the `entityDeepLink` result; `extra.link` carries that same object verbatim; the tap reader navigates it with `router.push(link)`. No field is renamed (no `route`↔`path` flatten/reconstruct), so there is one definition and no translation layer to drift.
- **Navigation is async — use `.catch`, not `try/catch`.** `router.push` returns a Promise; a synchronous `try/catch` would NOT catch an async navigation-guard rejection (it would leak as an unhandled rejection). Follow `useCalendarRedirectResume`: `router.push(link).then(logNavigated).catch(reportError)`. Consume the intent **before** the push so a rejecting link can never loop.
- **Warm tap while already on the target route is benign.** vue-router returns a "duplicated" `NavigationFailure` that **resolves (does not reject)** → flows to `navigated`, no false error, no double-open (`useDeepLinkParam` keys off a query _change_; if the user had closed the modal the query was already stripped, so re-adding it correctly re-opens).
- **A tap is an explicit foreground gesture, not a mid-flow interruption** — the user left the app to the tray and tapped. Navigating is desired; no "confirm before navigating" guard.
- **Deleted entity is not an error.** The page's `useDeepLinkParam.open()` returns `false` and leaves the param — no modal, no crash. A normal outcome, not an error.
- **Old pending notifications** carry `extra` without a `link` → "ignored, no target" (graceful). They are re-scheduled WITH the link on the next reconcile, so the gap self-heals within a session.
- **Travel deep-links to the trip, not the segment.** `TravelSegmentOccurrence.vacationId` (`vacation.ts:1105`) is already on the occurrence — no segment→vacation lookup needed.
- **Do not parse the notification id.** The numeric id is a lossy hash; the target must come from `extra`.

## Assumptions

> **Review these before implementation.**

1. Capacitor delivers the scheduled `extra` back on `localNotificationActionPerformed` under `action.notification.extra` (confirmed: `localNotificationReceived` already round-trips `extra`).
2. A launch (cold-start) tap is re-emitted to the listener registered at `App.vue` setup. If a device/OS drops the launch tap, the item simply doesn't auto-open (pre-fix behaviour) — no regression.
3. Navigating to a URL whose store hasn't hydrated is safe because the page's `useDeepLinkParam` retries on `ready` — so the resume only gates on the app being broadly ready, not each entity store.

## Approach

### 1. Carry a deep-link target on every reminder (`useScheduledReminders.ts`)

- Extend `ScheduledReminder` with `deepLink: DeepLink` (import `DeepLink` + `entityDeepLink`).
- Set it in each `out.push`:
  - `buildTodoReminders` (~299): `entityDeepLink('todo', todo.id)` — covers Helpful Hints with no special-casing.
  - `remindersForActivityOccurrence` duty (~186) + generic (~207): `entityDeepLink('activity', a.id)`.
  - `buildTravelReminders` (~348): `entityDeepLink('vacation', o.vacationId)`.
- No change to `buildReminderSchedule`. Single source of the deep-link — computed once, never re-derived (DRY).

### 2. Put the target in the notification payload (`useLocalNotifications.ts`)

- `buildScheduledNotifications`: `extra: { kind: r.kind, at: r.fireAt.getTime(), link: r.deepLink }` — the `DeepLink` object verbatim (JSON-serialisable, round-trips unchanged).
- Cast `extra` to the shared `ReminderExtra` type (exported by the resume module; type-only import → no runtime cycle).

### 3. Register the tap listener (`useLocalNotifications.ts`)

- `useLocalNotifications()` self-guards to native (line 393), so the listener is native-only for free. After the `localNotificationReceived` registration, add a sibling `localNotificationActionPerformed` listener with the same `.catch → reportError` shape (`notif_error_stage: 'tap-listener'`).
- The handler is one line: `handleReminderTap(action.notification.extra as ReminderExtra)`. All decisions + outcome logging live in `handleReminderTap`, so this module owns no outcome enum.
- Gains exactly **one** runtime import (`handleReminderTap`) + the `ReminderExtra` type. Still no router.

### 4. Navigate-when-ready (`useReminderTapResume.ts` — NEW)

- `export interface ReminderExtra { kind?: string; at?: number; link?: DeepLink; }` (`kind` is a plain `string` — telemetry label only, avoids coupling to the reminder-kind union).
- Module-private `logTapOutcome(outcome: 'navigated'|'deferred'|'ignored-no-target', kind?)` → `logEvent({ level:'info', surface:'local-notifications', message:'notification tapped', context:{ notif_kind, notif_tap_outcome } })`.
- `const pendingIntent = ref<{ link: DeepLink; kind?: string } | null>(null)`.
- `export function handleReminderTap(extra)`: if `extra?.link` → stash; else → `logTapOutcome('ignored-no-target', extra?.kind)`.
- `export function useReminderTapResume()`:
  - Reactive readiness: `computed(() => { void docVersion.value; return authStore.podCreated && isDocLoaded(); })`.
  - `watch([pendingIntent, ready], attempt, { immediate: true })`; `attempt()`: no intent → return; not ready → log `deferred` once → return; else consume the intent first, then `router.push(intent.link).then(() => logTapOutcome('navigated', intent.kind)).catch((e) => reportError({ ..., context: { notif_error_stage: 'tap-navigate' } }))`.
- Init in `App.vue` next to `useCalendarRedirectResume()`.

### 5. Observability

- One module-private `logTapOutcome`; every tap resolves to exactly one outcome.
- **`notif_tap_outcome` must be allowlisted in BOTH mirrors** — client `src/utils/diagnosticContext.ts` AND the Lambda ingest mirror `infrastructure/lambda/telemetry/index.mjs` (confirmed real; `notif_*` block ~line 112) **plus its pinned test** `__tests__/handler.test.mjs`, which asserts a hard-coded **alphabetically sorted** `expected` array — insert in sorted position or the test fails. Client-only would let the Lambda silently drop the key at ingest.
- `notif_error_stage` already exists (key is gated, not values); its new values `tap-listener`/`tap-navigate` need only prose.
- Store declaration: `notif_tap_outcome` is a closed, non-PII enum → update `docs/runbooks/native-store-submission.md` prose. NEVER put the entity id or deep-link path in telemetry.

## Files Affected

- `src/composables/useScheduledReminders.ts` — `deepLink` on `ScheduledReminder`; set at the 4 push sites; import `entityDeepLink`/`DeepLink`.
- `src/composables/useLocalNotifications.ts` — `link: r.deepLink` in `extra`; `localNotificationActionPerformed` listener → `handleReminderTap`.
- `src/composables/useReminderTapResume.ts` — **new**.
- `src/App.vue` — init `useReminderTapResume()`.
- `src/utils/diagnosticContext.ts` — allowlist `notif_tap_outcome`.
- `infrastructure/lambda/telemetry/index.mjs` + `__tests__/handler.test.mjs` — allowlist mirror + sorted pinned array.
- `docs/runbooks/native-store-submission.md` — diagnostics prose.
- Tests: `src/composables/__tests__/useScheduledReminders.test.ts`; `src/composables/__tests__/useReminderTapResume.test.ts` (**new**).

## Observability Coverage

Surface: **`local-notifications`** (reuses the existing #55 surface).

- **Tap → outcome (success + degradations):** `logEvent` info with `{ notif_kind, notif_tap_outcome }` via the single `logTapOutcome`. Success (`navigated`) emitted too, so the tap→open rate is measurable and a "tapping does nothing" report is triageable blind: `deferred`, `ignored-no-target`, `navigated`.
- **Failure modes:** listener registration fails → `reportError` `notif_error_stage: 'tap-listener'`; `router.push` rejects → `reportError` `notif_error_stage: 'tap-navigate'` (intent already consumed, so no loop). Both `severity: 'warning'`.
- **No bare catches.** Every branch emits.
- **Privacy/store gate:** `notif_tap_outcome` in BOTH allowlist mirrors + pinned test; non-PII enums only (reminder kind + outcome), never the entity id or path.

## Acceptance Criteria

- [ ] Tapping an activity / to-do / travel / Helpful-Hint reminder opens that exact item (warm, app alive).
- [ ] Tapping after the app was killed (cold start) opens the item once the family doc loads — verifying the `docVersion.value` reactive gate re-fires the watch.
- [ ] A tap while not-signed-in / pod-not-created defers, then navigates once ready; never navigates into an un-ready app.
- [ ] Tapping the same notification while already on the target item is benign — no false error, no crash, no double-open.
- [ ] Travel reminders open the parent trip via the occurrence's `vacationId` (no lookup added).
- [ ] A tap whose target was deleted lands on the page with no crash; an old-build notification with no `link` is ignored gracefully.
- [ ] `useLocalNotifications` imports no router; exactly one runtime import from the resume module.
- [ ] Web behaviour unchanged (native-only).
- [ ] Diagnostic events fire with `surface: 'local-notifications'` + `notif_tap_outcome`; allowlisted in BOTH mirrors (+ pinned test) and store-declared.

## Testing Plan

1. **Builder unit tests**: each builder sets `deepLink` = `entityDeepLink('todo'|'activity'|'vacation', <id>)` (todo incl. a hint todo; activity generic + duty; travel departure asserts `vacation` + `vacationId`).
2. **Resume unit tests** (mocked router/authStore/docService): (a) tap + ready → one `router.push` + intent cleared; (b) tap + NOT ready → no push, then ready → push (deferred→navigated), asserting a `docVersion` bump alone re-fires the watch; (c) tap with no `link` → no intent, `ignored-no-target` logged; (d) `router.push` **rejects** → `reportError` via `.catch` + intent already cleared (no unhandled rejection, no loop).
3. **Payload test**: `buildScheduledNotifications` includes `link` in `extra`.
4. **Lambda allowlist test**: pinned `handler.test.mjs` accepts `notif_tap_outcome` and still strips an unlisted key.
5. **Real-device (post-deploy, native-only):** Android — fire each reminder kind, tap with the app foregrounded / backgrounded / killed; confirm each opens the right item. Tap for a deleted to-do → lands on the page, no crash. Tap while already on the item → no error.
6. **Regression:** in-app bell "Open", global search, and the calendar deep link still navigate unchanged (shared `entityDeepLink`/`useDeepLinkParam`).
7. `npm run build` + `npm run type-check` + Vitest green before push.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the fix — carry `entityDeepLink(...)` on each `ScheduledReminder` → into the notification `extra`; add a native-only `localNotificationActionPerformed` listener that stashes the intent; a new router-free `useReminderTapResume` navigates when signed-in + `podCreated` + doc-loaded, letting the destination page's existing `useDeepLinkParam` open the entity; travel uses the occurrence's `vacationId`; graceful no-target/deleted handling; `notif_tap_outcome` telemetry.
- **Pass 2 (DRY + error handling)**: Verified every reuse claim against source. Fixed a silent-failure correctness bug — the readiness gate must read `docVersion.value` (`isDocLoaded()` reads a plain boolean, so the computed would never re-fire on doc load and the cold-start intent would never navigate). Closed a silent telemetry-loss gap — `notif_tap_outcome` must also go in the Lambda `ALLOWED_CONTEXT_KEYS` mirror + its pinned test, or the key is dropped at ingest. DRY'd `extra` into one shared type and outcome logging into one `logTapOutcome`; ensured every catch path reports.
- **Pass 3 (Sustainability)**: Simplified the payload contract — carry the `DeepLink` object verbatim in `extra.link` instead of flattening to `route`+`query` and reconstructing (removes a rename/drift point); consolidated all tap-outcome handling behind a single `handleReminderTap(extra)` so `useLocalNotifications` owns no outcome enum and makes one runtime import; co-located the exported `ReminderExtra` type in the resume module without coupling to the reminder-kind enum or creating a cycle.
- **Pass 4 (Fresh-eyes sweep)**: Verified all load-bearing claims — the Lambda telemetry mirror **is real** (+ its pinned test asserts a _sorted_ array, so insert in sorted position), `docVersion`/`isDocLoaded` re-exports confirmed, `entityDeepLink` is a leaf util (zero cycle risk), builder push sites + `App.vue` init line correct. Fixed a second correctness bug — navigation must use `router.push(link).then().catch()` (async promise) rather than a synchronous `try/catch` that would leak a guard rejection; the intent is consumed _before_ the push so a rejecting link can't loop. Documented that a warm tap onto the already-open route is benign (duplicated navigation resolves, not rejects), that a tap is an explicit foreground gesture (no guard warranted), and that module-scoped `pendingIntent` + `immediate: true` make cold-start ordering loss-proof.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial observation (greg)

"One thing I've noticed on the app is that tapping on the notification on my phone does not appear to open up the specific item (activity, todo, travel plan, etc) - generally it will just load the nook screen or activities screen without an item open. this is different from opening up a deep link from a calendar integration in google calendar, which was fixed recently. is this behavior expected or is it a bug?"

### Direction (greg)

"fix it now" — and asked whether to fix directly or via /beanies-plan; agreed to route it through /beanies-plan.

### Approval (greg)

"approve and implement"

### Assembled intent (/beanies-plan)

Bug fix: tapping an OS/local notification does not deep-link to the specific item. Root cause: no `localNotificationActionPerformed` listener + the `extra` payload carries no entity target (delivered id is a lossy hash). Fix: carry a deep-link target on each ScheduledReminder → into the notification `extra`; register a tap listener that navigates via `entityDeepLink` (+ `useDeepLinkParam` opens the item, like the in-app bell "Open"). Handle cold-start (defer/resume like the calendar redirect resume), auth/pod gating, travel segmentId→vacation resolution, and all reminder kinds incl. Helpful Hints. No GitHub issue. Not feature-gated. Observability: log the tap→navigate outcome.

</details>
