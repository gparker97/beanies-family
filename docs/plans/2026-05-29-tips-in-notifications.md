# Plan: Tip of the day → notifications drawer

> Date: 2026-05-29
> Related issues: None — direct implementation (no issue requested)
> Plan file: `docs/plans/2026-05-29-tips-in-notifications.md`

## User Story

As a beanies.family user, I want the daily beanie tip to live in my notification bell instead of taking up space on my Nook page, so that my Nook stays focused on family signals and I can scroll back to re-read tips I've already seen.

## Context

The Nook page renders `BeanTipCard.vue` (`src/components/nook/BeanTipCard.vue`, ~400 LOC including its scoped CSS) at line 235 of `FamilyNookPage.vue`. The card is permanent-real-estate: it shows one tip per day from `ALL_TIPS` (21 tips, `src/content/tips.ts`), and "Got it" / the close button permanently dismisses that tip — the user can never re-read it. Per-member dismissal state is in `localStorage` keyed `bean-tips-<memberId>` with shape `{ dismissedTips: string[], tipsEnabled: boolean, lastTipShownDate: string }` (see `src/composables/useBeanTips.ts`).

The notification subsystem (added in #167, polished through 2026-05-28) is already architected for exactly this content shape:

- Notifications are **derived** from a snapshot (`utils/notifications.ts` — pure, total, never throws), with the only persisted state being per-member read/unread (`FamilyDocument.notificationReads`).
- A "kind" is one union member (`types/notifications.ts`) + one deriver block (`utils/notifications.ts`) + one entry in `notificationKinds.ts` (+ optional custom detail body component).
- Two existing kinds — `whats-new` and `announcement` — are **window-exempt** (they bypass the 30-day rolling window) and have their ids exempted from `pruneReadState` so re-reading older items is the default behaviour.
- The single side-effect wiring composable — `useNotifications()` (`src/composables/useNotifications.ts`, 98 lines, four numbered concerns) — is called once from `App.vue` and already owns: the poll-tick, the OS-badge sync, a one-time localStorage→synced-readState migration (for what's-new), and the auth/onboarding/member gate for migration + auto-open. **Tip daily issuance is the same shape of side-effect** — it belongs here, not in a parallel daemon. Adding two lines (an `ensureTodayTipIssued()` call after the migration + a `today` watcher) keeps the composable cohesive without inflating its responsibilities; each concern remains one numbered block.

Tips are a clean fit: window-exempt, finite in count (21), and read-state-syncable via the existing `notificationReads` map. Moving them frees ~200px of Nook real-estate (per mobile measurement) and converts "dismiss = lose forever" into "tap = mark read, still re-readable".

## Requirements

1. Add a new notification kind `'tip'` that appears in the bell, ordered newest-first like all other kinds.
2. The closed-row presentation uses a `💡` icon with a soft amber tint behind it, and a `today's tip` kicker — uniform across all tips (no per-category tint at the row level, because tips appear daily and restraint matters).
3. The opened-detail body shows the floating beanie character + full tip message + the existing "try it →" action when a `tryItRoute` is defined. The category palette tints the detail body's character backdrop (recovers the personality currently in `BeanTipCard.vue`).
4. The bell's "got it" action maps to mark-as-read (which already happens automatically when a notification row is opened). When the user taps "got it" inside the detail body, the drawer also closes (`store.back()` → list → close), matching the intent that "got it = I'm done with this tip".
5. The existing "don't show tips" mute remains functional. It is also surfaced as a toggle in Settings → Appearance (the panel that already holds dark-mode / beanie-mode / sound toggles — there is no separate "Notifications" card on the page).
6. One tip is issued per local day, by the same rules as today (first un-muted, un-issued tip from `ALL_TIPS` whose `condition` passes against the current store snapshot).
7. Issued tips persist in the bell across days. After the 21st tip, no further tips are issued; existing rows remain readable.
8. Migration: existing `dismissedTips` arrays in `localStorage` are moved into a new `mutedTipIds` field on first read (those tips are never re-issued and never appear in the bell — bury, no backfill). The migration is idempotent so re-reads do not re-migrate or corrupt state.
9. `BeanTipCard.vue` is deleted and its mount on `FamilyNookPage.vue` is removed — no nook-side surface remains.
10. The notification system's existing pure/derive/never-throw discipline is preserved: the tip block in `deriveNotifications` follows the same `try/catch` + `console.warn` skip-on-malformed pattern as the announcement and what's-new blocks.
11. **No silent failures.** Every persistence path in `useBeanTips` (`localStorage.getItem` / `JSON.parse` / `localStorage.setItem`) logs at least `console.warn('[useBeanTips] …', err)` on failure; unrecoverable errors that block tip mute/enable from a user action additionally surface an error toast (which auto-reports via `useToast`).
12. **Downgrade safety.** The persisted v2 shape continues to write the legacy `dismissedTips` field (as a mirror of `mutedTipIds`) so an older app version (e.g. a stale PWA cache) reading the storage still honours the user's muted set instead of resurfacing tips. New fields (`schemaVersion`, `issuedTips`, `mutedTipIds`) are additive — JSON tolerates extra keys. On the v2 reader side, the load reconciles any `dismissedTips` entries not present in `mutedTipIds` (the **union** is the muted set), defending against an in-flight downgrade write that added a mute via the legacy field.

## Important Notes & Caveats

- **The deriver must remain pure and total.** Issuance is a side-effect (it writes to `localStorage`) and therefore must not happen inside the deriver. Issuance is owned by `useBeanTips.ensureTodayTipIssued()` and runs from the single existing side-effect surface — `useNotifications()` — which already mounts in `App.vue` and already owns the auth/onboarding gate and the `today` reactivity (via the store's `tick()` poll that updates `now`). The deriver only reads `issuedTips` as a passive input.
- **Read-state lives on the synced `FamilyDocument`; issuance lives in per-device `localStorage`.** This intentional split preserves current behaviour (tips are per-device personal advice, not family events). A user with two devices may see different "today's tips" on each — both are valid local truths. The read-state map syncs naturally, and the `tip:` prefix exemption in `pruneReadState` keeps cross-device read entries from being garbage-collected.
- **Tip IDs use the `tip:` prefix and reference the immutable `BeanTip.id`.** If a tip is later removed from `tips.ts`, any historical issued tip-notification whose `BeanTip` is missing must render gracefully (skip with `console.warn`, do not throw) — same shape as `getReleaseNote(version)` returning `undefined`.
- **ID-space confirmed disjoint (Pass 4).** `BeanTip.id`s are all `tip-*` (kebab-case with a hyphen, e.g. `tip-link-txn`); the notification prefix is `tip:` (with a colon). Adjacent prefixes are `whats-new:` and `announcement:`. There is no path by which a tip id and an announcement id can collide — neither at the notification-id level (different prefixes) nor at the source-id level (`tip-link-txn` ≠ `discord-community-2026-05`).
- **Audience.** The tip notification belongs to the _current member_ (the same member whose `bean-tips-<memberId>` localStorage was written to). The existing `useBeanTips` watcher on `familyStore.currentMemberId` re-hydrates state on member switch.
- **Member-switch + day-roll edge (Pass 4).** Both the member-switch watcher (inside `useBeanTips`) and the `today` watcher (inside `useNotifications`) fire synchronously. Because the module-level `state` ref is atomically swapped on member-switch, the next `ensureTodayTipIssued()` reads/writes against the freshly hydrated state for the new member. The previous member's state is dropped (not persisted again) at the moment of swap. If the day rolls between the swap and the new member's `loadState`, the new member's `lastTipShownDate !== today.value` and the `today` watcher correctly issues day-2's tip on the new member.
- **Sort stability (Pass 4).** `Array.prototype.sort` has been guaranteed stable since ECMAScript 2019; all browsers we target honour it. Two notifications with identical `occurredAt` (e.g. a tip issued at the same instant as a what's-new note) retain insertion order, which is fine.
- **No mobile bell-list bloat for now.** Upper bound is 21 tips. Combined with other kinds, the list could feel longer over time, but this is bounded and acceptable. A "tips section" or "older" expander is **out of scope**.
- **Reduced motion + dark mode.** `TipBody.vue` lifts the `@media (prefers-reduced-motion: reduce)` rule and the `:global(.dark)` rules from `BeanTipCard.vue` verbatim (no behavioural change).
- **Clock-drift note (Pass 4).** `issuedAt` is captured at issuance moment via `new Date().toISOString()`. A backward NTP correction could make a later tip carry an earlier `issuedAt` than its predecessor — out-of-order display would be cosmetic and bounded (the bell would still show one tip per local day; the worst case is a tiny inversion of two adjacent days). Not a blocker.
- **Adding a new window-exempt kind in the future**: the single checklist is (1) add it to the `NotificationKind` union, (2) add a deriver block, (3) add an entry to `NOTIFICATION_KIND_PRESENTATION` + `ACCENT_TINT_CLASS` + `kindLabelKey` + `notificationTitle` + `notificationSummary`, (4) add its prefix to `PRUNE_EXEMPT_PREFIXES`. This documents the same five-touchpoint pattern as `whats-new`/`announcement`/`tip` — predictable and easy to audit.
- **DRY (single edit surfaces):**
  - The `pruneReadState` prefix-exemption is an internal `PRUNE_EXEMPT_PREFIXES` array (extending `WHATS_NEW_PREFIX`/`ANNOUNCEMENT_PREFIX` into a tuple) — not three parallel `startsWith` calls.
  - `NOTIFICATION_KIND_PRESENTATION`, `ACCENT_TINT_CLASS`, `kindLabelKey`, `notificationTitle`, `notificationSummary` are the only places per-kind logic is added.
  - The "today's tip" kicker is a new `notifications.kindTip` key pointing at "today's tip"; the longer-form `tips.label` ("Beanie Tip of the Day") is reused inside the detail body where the longer phrase fits.
  - `TIPS_BY_ID` is a single module-level `Map` exported from `src/content/tips.ts` and consumed by both the deriver (via the snapshot) and `useNotificationPresentation` (via a new `getTip(id)` helper). `TipBody.vue` consumes the resolved `tip` returned from `useNotificationPresentation` — no second `getTip()` call site, no ad-hoc `ALL_TIPS.find(…)` calls anywhere.
  - The session-ready gate inside `useNotifications` (currently inlined into one watcher's source getter at lines 86–89) is extracted into a single `ready` arrow-getter shared between the existing migration/auto-open watcher and the new `today`-driven issuance watcher. (Confirmed by Pass 4 inspection — currently inline, no pre-existing `computed`.)
  - HMR note: rebuilding the `TIPS_BY_ID` map on hot-reload is consistent (it's purely derived from `ALL_TIPS`); no stale-cache concern.

## Assumptions

> **Review these before implementation.** These were valid at the time of planning but may have changed.

1. The current notification window is `WINDOW_DAYS = 30` (`notificationsStore.ts:37`). Tips will be window-exempt regardless.
2. `ALL_TIPS` contains 21 tips. If it grows past ~50, a "tips section" UI may be warranted; out of scope here.
3. `BeanTip.tryItRoute` is always a static path. Confirmed against `src/content/tips.ts` — all routes are bare paths. Cast to `AppNotification.route` directly with no `query`.
4. `useBeanTips` is currently only mounted via `BeanTipCard.vue` (confirmed by grep — only `BeanTipCard.vue` imports it). After deletion of that card, the issuance daemon must move; we mount it inside `useNotifications()` (already called once at app root).
5. The `bean-tips-<memberId>` localStorage key is stable; no other code reads it. Confirmed by repo grep.
6. The `notificationReads` map is the only synced surface touched. No new CRDT fields are introduced.
7. The Settings page currently has no dedicated "Notifications" card — the existing Appearance card (dark mode, beanie mode, sound effects, ~line 700) is where toggles of this shape live. The tips toggle joins that card.
8. The Help Center "Notifications" article (`src/content/help/features.ts`, slug `notifications`) is the single article describing the bell. It will be updated to mention tips. No new article is required.
9. No existing `schemaVersion` convention in the codebase. Introducing one for `bean-tips-*` is internally consistent (Pass 3 confirmed no other surface uses one).
10. `Array.prototype.sort` stability is relied on (ECMAScript 2019). Confirmed across our target browsers.
11. `reportError` signature is `{ surface, message, error?, context?, severity? }` — `message` is REQUIRED. Every plan-quoted call now includes a message.

## Approach

### 1. Type + plumbing

**`src/types/notifications.ts`** — add `'tip'` to the `NotificationKind` union and `'tip'` to the `KindPresentation.accent` union. No other shape change required.

**`src/utils/notifications.ts`** —

- Define `const TIP_PREFIX = 'tip:';` next to the existing prefix constants.
- Collapse the three prune-exemption prefixes into a single tuple: `const PRUNE_EXEMPT_PREFIXES = [WHATS_NEW_PREFIX, ANNOUNCEMENT_PREFIX, TIP_PREFIX] as const;` and replace the two `startsWith` calls inside `pruneReadState` with a single `PRUNE_EXEMPT_PREFIXES.some(p => id.startsWith(p))`. Update the docblock above `pruneReadState`. (DRY — net coupling decreases.)
- Add `export const tipId = (id: string): string => \`${TIP_PREFIX}${id}\`;`.
- Extend `DeriveInput` with `issuedTips: readonly { tipId: string; issuedAt: string }[]` and `tipsById: ReadonlyMap<string, BeanTip>`.
- Add the tip-emitting block at the bottom of `deriveNotifications`, mirroring the announcement block (try/catch + `console.warn`), resolving via `tipsById.get(issued.tipId)`, skipping silently with `console.warn` when undefined, using the `Number.isNaN(issuedMs) ? raw : iso` fallback, setting `title: tip.id` (resolved by `useNotificationPresentation`), `route: tip.tryItRoute` (`undefined` is fine — both `NotificationDetail` and `TipBody` gate the Open/try-it button on `notification.route`), `sourceId: tip.id`, `read: isRead(id)`.
- The existing closing `out.sort(…)` continues to handle ordering. Per ECMA-stable sort, ties retain insertion order.

**`src/components/notifications/notificationKinds.ts`** — register `tip: { accent: 'tip', icon: '💡', detailBody: TipBody }`; `tip: 'bg-[var(--tint-amber-10,rgba(245,188,80,0.10))]'` in `ACCENT_TINT_CLASS` (uses the same `rgba(…)` fallback convention already proven by the existing `tint-orange-8`/`tint-silk-20`/`tint-purple-12` entries); cases for `kindLabelKey` / `notificationTitle` / `notificationSummary`.

**`src/style.css`** — add `--tint-amber-10: rgb(245 188 80 / 10%);` (light) and `--tint-amber-10: rgb(245 188 80 / 14%);` (dark), adjacent to the existing tint definitions.

### 2. `useNotificationPresentation` extension

Mirror the existing `release` / `announcement` resolver pattern with a third `tip` resolver. Import `getTip`; add `const tip = computed(() => n.value.kind === 'tip' && n.value.sourceId ? getTip(n.value.sourceId) : undefined);`. Extend `summary` (return `txt(tip.value.message)` when defined) and `hasRichBody` (true for resolvable tip). Return `tip` so `TipBody` consumes the same resolved object. The addition is purely additive — every existing destructuring call site (NotificationRow, NotificationDetail, AnnouncementCard, WhatsNewGiftCard, the unit test) names only the fields it needs and is unaffected.

### 3. Issuance daemon — folded into `useNotifications`

**`src/composables/useBeanTips.ts`** —

- Schema v2: `{ schemaVersion: 2; issuedTips: { tipId; issuedAt }[]; mutedTipIds: string[]; tipsEnabled: boolean; lastTipShownDate: string }`. Persisted shape additionally mirrors `mutedTipIds` into a legacy `dismissedTips: string[]` field on every write (downgrade safety, Req #12).
- `loadState(memberId)`: read raw + JSON.parse inside try; on throw → `console.warn('[useBeanTips] load failed', err)` + return empty-v2.
  - **Hard shape gate before any field access (Pass 4):** if `typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)` → `console.warn('[useBeanTips] storage corrupted, resetting', parsed)` + return empty-v2 and immediately persist. This guards against `parsed = null` / `parsed = 42` / `parsed = []` shapes that would otherwise throw on `parsed.dismissedTips`.
  - If `parsed.schemaVersion === 2`: validate each field (Array.isArray / typeof / fallback), then **union** any `parsed.dismissedTips` entries not already in `parsed.mutedTipIds` into the returned `mutedTipIds` (defends against an in-flight downgrade write that wrote a mute via the legacy field), and return.
  - Else (v1 / no version): migrate to v2 by mapping `dismissedTips → mutedTipIds`, initialise `issuedTips: []`, persist immediately (idempotent — re-running on the v2 result is a no-op).
- `saveState`: write the v2 shape with the `dismissedTips: mutedTipIds` mirror. On `localStorage.setItem` throw: `console.warn('[useBeanTips] save failed', err)` + `reportError({ surface: 'bean-tips-save', message: 'localStorage write failed for bean-tips', error: err, severity: 'warning' })`. No toast (writes happen on issuance ticks; surfacing one mid-tick would be noise).
- `ensureTodayTipIssued()`: no-op gate (`!tipsEnabled`, no `currentMemberId`, no `onboardingCompleted`, or `lastTipShownDate === today.value`). Otherwise scan `ALL_TIPS` for first eligible tip (not muted, not already issued, condition passes); append `{ tipId, issuedAt: new Date().toISOString() }` + set `lastTipShownDate = today.value`. Exhausted: still set `lastTipShownDate = today.value` to break retry. Wrapped in try/catch with `reportError({ surface: 'bean-tips-issuance', message: 'ensureTodayTipIssued threw', error: err, severity: 'error' })`. Because the gate is checked against the freshly-read `state.value`, two synchronous calls in the same Vue flush (session-ready + `today` change) are safely idempotent — the second sees `lastTipShownDate === today.value` and exits.
- `muteAllTips()` / `enableTips()`: try/catch persistence write; on failure `showToast('error', "Couldn't update tip preference", err.message, { surface: 'bean-tips-toggle', error: err })`. (`useToast` auto-reports.)
- Drop `dismissTip()`, `currentTip`, `isDismissing` (consumers: only `BeanTipCard.vue` which is being deleted — confirmed by grep).
- Expose `issuedTips` (computed/readonly ref over `state.value.issuedTips`), `tipsEnabled` (computed over `state.value.tipsEnabled`), `ensureTodayTipIssued`, `muteAllTips`, `enableTips`.

**`src/composables/useNotifications.ts`** — extract the inline ready-gate (currently the getter on line 86) into a top-level arrow `const ready = () => authStore.isAuthenticated && settingsStore.onboardingCompleted && Boolean(familyStore.currentMember);` used by both the existing watcher (`() => ready()`) and the new tip-issuance watcher. Add numbered concern **#5 — daily tip issuance**:

```ts
// 5. Daily tip issuance — runs on session-ready and on every local-day roll.
//    Idempotent: `ensureTodayTipIssued()` no-ops when lastTipShownDate === today.
const beanTips = useBeanTips();
const { today } = useToday();
watch(today, () => {
  if (!ready()) return;
  beanTips.ensureTodayTipIssued();
});
// In the existing session-ready watcher: after `runWhatsNewMigrationOnce()`:
//   beanTips.ensureTodayTipIssued();
```

The `today` watcher does NOT use `{ immediate: true }` — first issuance is driven by the session-ready watcher, which already runs immediately. This avoids a redundant call on first mount.

### 4. Snapshot composition

**`src/stores/notificationsStore.ts`** — instantiate `useBeanTips()` ONCE at store-setup scope (bind to `const beanTips`). In the snapshot computed, reference `beanTips.issuedTips.value` and `tipsById: TIPS_BY_ID`. `TIPS_BY_ID` is a module-level constant (stable ref), and `beanTips.issuedTips` is a single computed/ref — no re-allocation per recompute.

**`src/content/tips.ts`** — append:

```ts
const TIPS_BY_ID: ReadonlyMap<string, BeanTip> = new Map(ALL_TIPS.map((t) => [t.id, t]));
export { TIPS_BY_ID };
export function getTip(id: string): BeanTip | undefined {
  return TIPS_BY_ID.get(id);
}
```

### 5. `TipBody.vue` (new)

Consumes `tip` from `useNotificationPresentation(props.notification)`. Renders the floating beanie character + category-tinted backdrop + tip message + action row:

- **try-it →** button (only rendered if `notification.route` is defined; `undefined` is the no-button branch, identical to how `NotificationDetail` already gates its Open button). On click: `router.push(notification.route)` + `store.close()`.
- **got it** button: closes the drawer via `store.back()` (markRead already happened on open via `openTo`). Matches Req #4's "got it = I'm done with this tip" intent.
- **don't show tips**: calls `muteAllTips()` (which surfaces an error toast on persistence failure) + on success calls `store.back()` + `showToast('success', t('tips.mutedConfirm'), undefined, { durationMs: 4000 })`. Drawer dismissal mirrors the "got it" path; tips no longer show going forward.

Missing-tip fallback (when `getTip(sourceId)` returns undefined): small "this tip is no longer available" + got-it. Lifts `prefers-reduced-motion` + dark-mode rules from `BeanTipCard.vue` verbatim. Single-file Vue 3 Composition API.

### 6. Settings touch

**`src/pages/SettingsPage.vue`** — add a fourth row to the Appearance card (~line 700) with label `t('settings.tips.toggle')` / hint `t('settings.tips.toggleHint')`. The `ToggleSwitch` uses the project's established `:model-value` + `@update:model-value` pattern (verified Pass 4 against the dark-mode/beanie-mode/sound-effects toggles immediately above it). `v-model` against a computed is NOT used (Vue would warn / silently drop):

```html
<ToggleSwitch
  data-testid="tips-enabled-toggle"
  :model-value="beanTips.tipsEnabled.value"
  @update:model-value="(v) => v ? beanTips.enableTips() : beanTips.muteAllTips()"
/>
```

Errors surface via toast inside `enableTips()` / `muteAllTips()`.

### 7. Nook page cleanup

**`src/pages/FamilyNookPage.vue`** — Remove the `BeanTipCard` import (line 23) and the `<BeanTipCard />` mount + preceding comment (lines 234-235). The parent container is `flex flex-col gap-*` so the slot collapses naturally.

**`src/components/nook/BeanTipCard.vue`** — delete the file.

### 8. Translation keys

**`src/services/translation/uiStrings.ts`** — add:

- `notifications.kindTip`: `{ en: "Today's tip", beanie: "today's tip" }`
- `tips.mutedConfirm`: `{ en: 'Tips muted. You can re-enable them in Settings.', beanie: 'tips muted. you can re-enable them in settings.' }`
- `tips.unavailable`: `{ en: 'This tip is no longer available.', beanie: 'this tip is no longer available.' }`
- `settings.tips.toggle`: `{ en: 'Daily tips', beanie: 'daily tips' }`
- `settings.tips.toggleHint`: `{ en: 'One small tip per day in your notification bell.', beanie: 'one small tip per day in your notification bell.' }`

Existing keys reused (no duplication): `tips.label`, `tips.gotIt`, `tips.tryIt`, `tips.dontShowTips`.

## Files Affected

| Action | File                                                            | Purpose                                                                                                                                                                                                                   |
| ------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| edit   | `src/types/notifications.ts`                                    | Add `'tip'` to union + accent                                                                                                                                                                                             |
| edit   | `src/utils/notifications.ts`                                    | `tipId()`, `TIP_PREFIX`, `PRUNE_EXEMPT_PREFIXES` consolidation, `DeriveInput` fields, tip block                                                                                                                           |
| edit   | `src/components/notifications/notificationKinds.ts`             | Register `tip` kind: presentation, accent tint, label key, title/summary cases                                                                                                                                            |
| edit   | `src/composables/useNotificationPresentation.ts`                | Resolve tip via `getTip(sourceId)`, expose `tip`, extend `summary`/`hasRichBody`                                                                                                                                          |
| edit   | `src/composables/useBeanTips.ts`                                | Schema v2 + downgrade-safe `dismissedTips` mirror + idempotent migration + hard shape gate, `ensureTodayTipIssued()`, no-silent-failure logging + error reporting, drop dead `dismissTip` / `currentTip` / `isDismissing` |
| edit   | `src/content/tips.ts`                                           | Export `TIPS_BY_ID` + `getTip(id)` helper                                                                                                                                                                                 |
| edit   | `src/stores/notificationsStore.ts`                              | Bind `useBeanTips()` at store-setup, wire `issuedTips` + `tipsById` into the snapshot                                                                                                                                     |
| edit   | `src/composables/useNotifications.ts`                           | Extract `ready` arrow; mount tip issuance into the existing side-effect daemon as numbered concern #5 (ready-gate call + `today` watcher without `immediate`)                                                             |
| create | `src/components/notifications/TipBody.vue`                      | Detail body — beanie + tip text + try-it/got-it/mute, with missing-tip fallback and drawer-dismissal on got-it/mute                                                                                                       |
| edit   | `src/pages/SettingsPage.vue`                                    | "Daily tips" `ToggleSwitch` row in Appearance card with `:model-value` + `@update:model-value`                                                                                                                            |
| edit   | `src/pages/FamilyNookPage.vue`                                  | Remove `<BeanTipCard />` mount + import                                                                                                                                                                                   |
| delete | `src/components/nook/BeanTipCard.vue`                           | Replaced by `TipBody.vue` in the drawer                                                                                                                                                                                   |
| edit   | `src/style.css`                                                 | Add `--tint-amber-10` (light + dark)                                                                                                                                                                                      |
| edit   | `src/services/translation/uiStrings.ts`                         | 5 new keys (see §8)                                                                                                                                                                                                       |
| edit   | `src/content/help/features.ts`                                  | Update "Notifications" article: add a section about the daily 💡 tip                                                                                                                                                      |
| edit   | `src/utils/__tests__/notifications.test.ts`                     | Tip deriver block + prune exemption (extend existing file)                                                                                                                                                                |
| create | `src/composables/__tests__/useBeanTips.test.ts`                 | Migration, idempotency, day-roll, mute, exhaustion, error logging, downgrade-safety mirror, corrupted-shape guards                                                                                                        |
| edit   | `src/composables/__tests__/useNotificationPresentation.test.ts` | Tip summary resolution + missing-tip empty summary                                                                                                                                                                        |

## Help Center Coverage

- **Action**: `update existing`
- **Category**: `features`
- **Article type**: existing how-to/explainer
- **Slug**: `notifications`
- **Title**: "Notifications — staying on top of what needs you" (unchanged)
- **Scope**: Add a section "A daily tip from the beanies" explaining: one small tip per day appears in the bell with a 💡 icon; tap to read the full tip and try the linked feature; tips persist in the list so you can scroll back; turn off in Settings → Appearance → Daily tips.
- **Notes**: Call out that tips are per-device (a user may see a different daily tip on phone vs. laptop), and that turning off tips does not delete the ones already in the bell — they remain readable.

The article work lands in the same change as the feature.

## Acceptance Criteria

- [ ] A new tip notification appears in the bell the first time a user opens the app on a new local day (provided `tipsEnabled` and `onboardingCompleted`).
- [ ] Opening a tip notification renders the full beanie character + tip message + "try it →" (when applicable) + "got it" + "don't show tips".
- [ ] Tapping "try it →" routes to the tip's `tryItRoute`, marks the notification read, and closes the drawer.
- [ ] Tapping "got it" inside `TipBody` marks-read AND closes the detail drawer (`store.back()`).
- [ ] Tapping "don't show tips" mutes future tips, shows a `tips.mutedConfirm` toast, closes the detail drawer, and does NOT remove previously-issued tip rows from the bell.
- [ ] Tips already in the bell remain visible after refresh / day-roll / week-roll — read-state survives the `pruneReadState` call.
- [ ] Once 21 tips have been issued, no further tips appear; existing rows remain readable.
- [ ] Existing users with a populated `dismissedTips` localStorage array DO NOT see those tips backfilled into the bell. The migration moves them silently to `mutedTipIds`.
- [ ] **Downgrade safety**: a v2 write is readable by a v1 app version — opening the v2 storage in a (simulated) v1 reader produces the same `dismissedTips` set the user muted in v2, never resurfacing tips.
- [ ] **Corrupted-storage safety**: `loadState` against `null` / scalar / array / malformed JSON returns the empty-v2 shape and emits a single `console.warn` — no throw.
- [ ] `BeanTipCard.vue` is deleted; `FamilyNookPage.vue` no longer references it.
- [ ] The Settings → Appearance card has a "Daily tips" toggle wired to `tipsEnabled` via `:model-value` + `@update:model-value` (no Vue console warnings on rapid flicker).
- [ ] `deriveNotifications` remains pure and total — a malformed `issuedTips` entry or a missing `BeanTip` produces a `console.warn` and skip, never a throw.
- [ ] Every persistence error in `useBeanTips` produces at minimum a `console.warn` with the `[useBeanTips]` prefix; persistence errors during a user-initiated toggle additionally show an error toast.
- [ ] An `ensureTodayTipIssued()` throw is caught, reported via `reportError` (`surface: 'bean-tips-issuance'`), and does not propagate to the `useNotifications` daemon.
- [ ] Dark mode and `prefers-reduced-motion` behave identically to `BeanTipCard.vue` today.
- [ ] The "Notifications" Help Center article (`features.ts`, slug `notifications`) gains a section describing the daily tip.

## Testing Plan

### Unit (vitest)

**`src/utils/__tests__/notifications.test.ts`** — extend with a `describe('deriveNotifications — tip')` block:

1. Tip is emitted for each entry in `issuedTips` when the corresponding `BeanTip` is resolvable.
2. Tip is window-exempt — an `issuedAt` 60 days ago still produces a notification.
3. A tip whose `BeanTip.id` is not in `tipsById` is skipped silently (no throw, one `console.warn`).
4. A tip with a malformed `issuedAt` falls back to the raw string in `occurredAt` (matches the announcement block's pattern).
5. Read-state is resolved against the tip's id (`tip:<tipId>`).
6. `pruneReadState` keeps `tip:` ids even when `keepIds` is empty (and the consolidated `PRUNE_EXEMPT_PREFIXES` still covers `whats-new:` and `announcement:`).

**`src/composables/__tests__/useBeanTips.test.ts`** — new file:

1. First run: state is empty, `ensureTodayTipIssued()` picks the first eligible tip and persists `issuedTips: [{ tipId, issuedAt }]`, sets `lastTipShownDate`.
2. Idempotency: calling `ensureTodayTipIssued()` again the same day is a no-op.
3. Day-roll: advance `today.value`, call again → second tip issued, two entries in `issuedTips`.
4. Migration: v1 shape (`{ dismissedTips: ['tip-a', 'tip-b'], tipsEnabled: true, lastTipShownDate: '…' }`) loads as v2 with `mutedTipIds: ['tip-a', 'tip-b']`, `issuedTips: []`. Subsequent `ensureTodayTipIssued()` skips `tip-a`/`tip-b`. The localStorage write happens once on first read.
5. **Downgrade-safety mirror**: after `muteAllTips()` writes v2 storage, the persisted JSON includes both `mutedTipIds: [...]` AND `dismissedTips: [...]` with identical content. Reloading the same raw JSON through a v1-shaped reader (`{ dismissedTips: Array.isArray(parsed.dismissedTips) ? parsed.dismissedTips : [] }`) yields the same muted set — no tip resurfacing on downgrade.
6. **Re-converge on downgrade-then-upgrade**: simulate a downgrade write (`{ dismissedTips: ['tip-x'], tipsEnabled: true, lastTipShownDate: '…' }` overwriting v2), then re-load — the v2 reader sees no `schemaVersion`, runs the migration, and `mutedTipIds` includes `'tip-x'`. (Confirms the legacy mirror round-trips.)
7. **Downgrade union semantics**: a v2 payload containing BOTH `mutedTipIds: ['a']` AND `dismissedTips: ['a','b']` (simulating an in-flight downgrade-era write) loads as `mutedTipIds: ['a','b']` (union, not overwrite).
8. **Corrupted-storage guards**: `loadState` with each of `parsed = null`, `parsed = 42`, `parsed = []`, `parsed = '{not json'` returns the empty-v2 shape without throwing; each emits a single `console.warn`.
9. Mute mid-rotation: with 3 entries in `issuedTips`, `muteAllTips()` sets `tipsEnabled = false`. Subsequent calls are no-ops; `issuedTips` is unchanged (history preserved).
10. Re-enable: `enableTips()` → `ensureTodayTipIssued()` issues the next tip.
11. Exhaustion: all 21 tips issued; `ensureTodayTipIssued()` is a no-op but updates `lastTipShownDate` to avoid retry loop.
12. Member switch: switching `currentMemberId` reloads state from the new key.
13. Condition gating: with `tipContext.activityCount === 0`, the `tip-link-txn` tip is skipped; the next eligible tip is issued.
14. **Persistence-failure observability**: stub `localStorage.setItem` to throw; `ensureTodayTipIssued()` triggers a `console.warn` AND `reportError` is called with `surface: 'bean-tips-save'`. The composable's in-memory state is still advanced (no UI desync within the session).
15. **Issuance-throw containment**: monkey-patch a tip's `condition` to throw; `ensureTodayTipIssued()` does not throw, calls `reportError` with `surface: 'bean-tips-issuance'`, and `lastTipShownDate` is unchanged (so the next call retries — bad code reported but not silently swallowed).
16. **Toggle error toast**: stub `localStorage.setItem` to throw; `muteAllTips()` calls `showToast('error', …)` (test mocks `useToast`).

**`src/composables/__tests__/useNotificationPresentation.test.ts`** — add:

1. Tip notification's summary line resolves to `txt(tip.message)`.
2. Tip with `sourceId` matching no `BeanTip` returns an empty summary (no throw).
3. `hasRichBody` is true for a resolvable tip (drawer routes to `TipBody`).

### Manual

1. Fresh user (no `bean-tips-<memberId>` localStorage): open app on Day 0 → bell shows one 💡 row. Tap → detail opens with beanie + message + "try it →".
2. Tap "try it →" → routes to the tip's path. Drawer closes. Row marked-read.
3. Tap "got it" → drawer closes; row already marked-read on open.
4. Tap "don't show tips" → drawer closes; success toast appears; reload → no new tip issued; previous tip rows remain in the bell.
5. Day-roll: bell gains a second 💡 row.
6. Mute via Settings → Appearance → Daily tips → reload → no new tip issued. Existing tips remain in the bell.
7. Toggle on → reload → next tip issued.
8. Existing user with 8 dismissed tips: open → bell has zero 💡 rows. Day-roll → 1 new row.
9. Mobile (375px): tip row fits the standard row layout.
10. Dark mode: amber tint reads against the dark surface; detail body uses lifted dark-mode rules.
11. `prefers-reduced-motion: reduce`: floating beanie + bulb-pulse animations are disabled.
12. Settings toggle flicker-test (rapid on/off) → no Vue console warnings (confirms `:model-value` binding, not `v-model` on a computed).
13. **DevTools storage disable**: with localStorage write-blocked, mute via Settings → an error toast appears (surface: `bean-tips-toggle`) and Slack receives an auto-report. The user is not stranded in silence.

## Review Passes

- **Pass 1 (Initial draft)**: drafted complete plan including types, deriver block, issuance daemon, snapshot wiring, TipBody.vue spec, Settings toggle, migration with bury-no-backfill, help article update.
- **Pass 2 (DRY + error handling)**: Folded the issuance daemon into the existing `useNotifications` composable (no parallel daemon), consolidated `pruneReadState` exemptions into a single `PRUNE_EXEMPT_PREFIXES` tuple, routed `TipBody` through `useNotificationPresentation` (one resolver, not two), dropped now-dead `dismissTip`/`currentTip`/`isDismissing` from `useBeanTips`, replaced silent catches with `console.warn` + `reportError` + user-facing error toast on user-initiated failures, centralised `--tint-amber-10` in `style.css`, reused existing `tips.*` keys where possible, corrected the Settings location to the Appearance card.
- **Pass 3 (Sustainability)**: Added downgrade-safe `dismissedTips` mirror in the v2 persisted shape (Req #12 + new acceptance criterion + two new tests); documented the window-exempt kind extension checklist; made the `useNotifications` integration concrete (extract shared `ready` arrow, bind `useBeanTips()` once at store-setup scope, numbered concern #5); noted HMR-safety for `TIPS_BY_ID`; confirmed via grep that dropping `currentTip`/`isDismissing`/`dismissTip` is safe and that no project-wide `schemaVersion` convention exists.
- **Pass 4 (Fresh-eyes sweep)**: Verified id-space disjointness (`tip-*` ids vs `tip:` prefix). Confirmed `Array.prototype.sort` stability (ECMAScript 2019). Hardened `loadState` against non-object `parsed` (`null` / scalar / array) before any field access — was a latent throw path in Pass 3. Tightened the downgrade-safety reader rule to explicitly **union** any newly-appearing `dismissedTips` entries into `mutedTipIds`. Added required `message` field to every `reportError` call (verified against `errorReporter.ts`). Pinned the Settings toggle binding to the established `:model-value` + `@update:model-value` pattern (verified against `SettingsPage.vue` Appearance card). Specified `store.back()` after "got it" and "don't show tips" inside `TipBody` so the drawer dismisses on mute (Req #4 intent). Confirmed the `useNotifications` ready-gate is currently inline (not a pre-existing computed) — extraction is correct. Noted that the new `today` watcher must omit `{ immediate: true }` to avoid a redundant first-mount fire. Confirmed `useNotificationPresentation`'s additive `tip` return doesn't break any of the 5 destructuring call sites. Confirmed the `bg-[var(--tint-amber-10,rgba(245,188,80,0.10))]` arbitrary-value syntax matches the existing precedent. Added a clock-drift note. Documented the member-switch + day-roll edge as safe under synchronous Vue watcher flush. Added two acceptance criteria + four test cases covering the new edge paths.

## Prompt Log

> Saved here because no GitHub issue was created (direct implementation).

<details>
<summary>Full prompt history</summary>

### Initial Prompt (frontend-design skill, in-app from greg)

> Now I'd like to discuss the tip of the day which is displayed in the nook page every day. Given the space on the nook page is important, even on mobile, and also that closing the tip makes you lose it forever, i'd propose to move the tip of the day to the notification section. just as with announcements and what's new, the tip of the day would have a special (but subtle - as it comes up every day) style, giving a small tip to the user. this frees up space on the nook page and also leaves the tip in the notification drawer so it can be seen again even after it's been read. what do you think and how do you propose we implement this?

### Confirmation (AskUserQuestion)

> Migration: "Bury — no backfill (Recommended)"
> Row tint: "Uniform amber for all tips (Recommended)"

</details>
