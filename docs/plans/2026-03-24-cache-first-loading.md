# Plan: Cache-First Loading with Skeleton Screens

> Date: 2026-03-24
> Related issues: Performance — app load times 4-5s with 1.2MB beanpod

## Context

After 3 weeks of usage, the .beanpod file is ~1.2MB. Cold loads (PWA reopened, morning refresh) show a full-screen blocking spinner for 4-5s. Two bottlenecks: Google Drive fetch (1.5-3s) and `Automerge.load()` (0.5-1.5s). On mobile, iOS/Android can evict IndexedDB cache after ~7 days of non-use, so cache-first alone doesn't cover all cases.

**Goal:** Eliminate the full-screen blocking spinner for authenticated users entirely. They either see real data instantly (cache hit) or the app shell with skeleton content (cache miss) — never a blank screen with a spinner.

## Approach

### Two-Layer Strategy

**Layer 1 — Cache-First:** If IndexedDB persistence cache exists, load it (<500ms) → show real data → background-sync from Drive → CRDT merge.

**Layer 2 — App Shell + Skeleton:** If no cache, show header/sidebar/nav immediately with a skeleton in the content area while Drive fetches. Progress bar at top shows activity.

### Key Architectural Change

Dismiss the full-screen spinner (`isInitializing`) after auth resolves (step 3 of `onMounted`, ~150ms), NOT after data loads. The app shell renders while `loadFamilyData()` runs. A new `isLoadingData` ref in App.vue gates whether the content area shows a skeleton or the router-view.

---

## Implementation Steps

### 1. syncStore: Add Background Sync State + Method

**File:** `src/stores/syncStore.ts`

**New refs:**

- `isBackgroundSyncing: ref<boolean>` — drives the progress bar
- `backgroundSyncError: ref<string | null>` — error message if background sync fails

**New method: `backgroundSyncFromFile()`**

- Guard: `if (isBackgroundSyncing.value) return` (prevent double-fire)
- Set `isBackgroundSyncing = true`, `backgroundSyncError = null`
- Call existing `loadFromFile({ merge: true })` — already handles CRDT merge + `reloadAllStores()` + cache recovery
- Handle `needsPassword`: try `settingsStore.getCachedFamilyKey()` → `importFamilyKey()` → `decryptPendingFileWithKey()` (same pattern already in `reloadIfFileChanged()` — extract into a shared helper to avoid duplication)
- On success: `isBackgroundSyncing = false`, call `setupAutoSync()`, `startDeferredPolling()`
- On failure: `backgroundSyncError = message`, `isBackgroundSyncing = false`
- File polling still activates for automatic retry

**DRY note:** The "try cached key on needsPassword" pattern exists in both `loadFamilyData()` (App.vue:206-228) and `reloadIfFileChanged()` (syncStore ~line 1135-1155). Extract this into a private helper `tryDecryptWithCachedKey()` in syncStore, reused by all three call sites (loadFamilyData, reloadIfFileChanged, backgroundSyncFromFile).

### 2. App.vue: Restructure Loading Flow

**File:** `src/App.vue`

**New local ref:** `isLoadingData = ref(true)` — true until `loadFamilyData()` completes (from cache or Drive)

**Revised `onMounted` flow:**

```
1. Load global settings (~50ms)
2. Skip public pages early
3. Init auth + resolve active family (~100ms)
4. ★ Set isInitializing = false HERE (app shell renders immediately)
5. loadFamilyData() — cache-first, sets isLoadingData = false when done
6. Start deferred polling, exchange rates
```

**Revised `loadFamilyData()` Path 1:**

```
Path 1 (sync configured + permission):
  1. Try cache: syncStore.loadFromPersistenceCache(cachedKeyB64, familyId)
     ├─ Success → isLoadingData = false (real data shown)
     │           → fire-and-forget: syncStore.backgroundSyncFromFile()
     │           → return
     └─ Fail (no cache, corrupt, key mismatch) → continue to step 2

  2. Existing blocking: syncStore.loadFromFile()
     (skeleton shows in content area while this runs)
     ├─ Success → isLoadingData = false (skeleton → real data)
     └─ needsPassword / fail → existing redirect logic (unchanged)
```

**Template change:**

```vue
<!-- Before (full-screen blocking overlay): -->
<div v-if="isInitializing" class="fixed inset-0 z-[300] ...">
  <BeanieSpinner size="xl" label />
</div>

<!-- After (brief pre-auth only, ~150ms): -->
<div v-if="isInitializing" class="fixed inset-0 z-[300] ...">
  <BeanieSpinner size="xl" label />
</div>

<!-- Content area skeleton (replaces router-view while loading): -->
<main ...>
  <ContentSkeleton v-if="isLoadingData && showLayout" />
  <router-view v-show="!isLoadingData || !showLayout" />
</main>

<!-- Progress bar (always rendered, hides itself when inactive): -->
<BackgroundSyncBar />
```

### 3. ContentSkeleton.vue — Single Generic Skeleton

**New file:** `src/components/ui/ContentSkeleton.vue`

ONE component that works for any page. Mimics the Nook layout (the most common landing page) using the same card structure as `NookSectionCard`:

**Design:**

- Matches `NookSectionCard` styling: `rounded-[20px] bg-white p-5 shadow-[0_4px_20px_rgba(44,62,80,0.04)]` + `nook-card-dark` class for dark mode
- **Greeting skeleton:** Two text-line placeholders (wide + narrow)
- **Bean avatars skeleton:** Row of 3-4 circles
- **Card skeletons:** 2 cards side-by-side (mimicking Schedule Cards), 1 full-width card (mimicking Todo Widget), 2 cards in a grid (mimicking Milestones + Piggy Bank)
- Each card has: a small title bar + 3-4 content lines of varying widths
- **Shimmer animation:** Warm Heritage Orange-tinted gradient sweep (`@keyframes beanie-shimmer`) added to `style.css` alongside existing brand animations. Uses the same `@utility` pattern.
- Colors: `bg-gray-100 dark:bg-slate-700` base with Heritage Orange shimmer overlay (`rgba(241,93,34,0.06)`)
- Respects `prefers-reduced-motion` (no animation, just static gray blocks) — added to existing reduced-motion media query in `style.css`
- Uses `space-y-6` matching FamilyNookPage's layout spacing
- Staggered `animation-delay` on cards (0s, 0.15s, 0.3s) for a polished cascading effect

**No new dependencies.** Pure Vue + Tailwind + one CSS keyframe.

### 4. BackgroundSyncBar.vue — Thin Progress Bar

**New file:** `src/components/common/BackgroundSyncBar.vue`

A 3px indeterminate progress bar at the very top of the viewport:

- `position: fixed; top: 0; left: 0; right: 0; z-index: 200`
- Heritage Orange (`#F15D22`) with CSS indeterminate animation
- **States** (driven by syncStore):
  - `!isBackgroundSyncing` → hidden (`v-if="false"`)
  - `isBackgroundSyncing` → indeterminate shimmer animation
  - Sync completes → bar fills to 100% → fades out (300ms transition)
  - Error → bar turns amber briefly → fades out. A toast fires via existing `useToast()` composable (no custom error UI needed — reuse the toast system)
- Uses `<Transition>` for enter/leave (same pattern as the existing loading overlay in App.vue)
- `@keyframes` defined in the component's `<style scoped>` (not in global style.css — this animation is component-specific)

### 5. Translation Keys

**File:** `src/services/translation/uiStrings.ts`

Add to both `en` and `beanie` sections:

```
sync.backgroundError: "Could not refresh from cloud" / "beans got lost in the cloud..."
```

Minimal — only the error toast message. The progress bar and skeleton are visual-only, no text needed.

### 6. CSS: Shimmer Animation

**File:** `src/style.css`

Add alongside existing `beanie-*` animations:

```css
@keyframes beanie-shimmer {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
}

@utility animate-beanie-shimmer {
  animation: beanie-shimmer 1.8s ease-in-out infinite;
}
```

Add to existing `@media (prefers-reduced-motion: reduce)` block:

```css
.animate-beanie-shimmer {
  animation: none;
}
```

---

## Error Handling

| Scenario                             | Behavior                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| Cache hit + background sync succeeds | Instant data → progress bar → seamless merge → syncHighlightStore highlights    |
| Cache hit + background sync fails    | Instant data → progress bar → error toast via `useToast()` → retry on next poll |
| Cache hit + needs password           | Try cached key → if fails, toast suggesting re-sign-in                          |
| No cache + Drive succeeds            | App shell + skeleton → progress bar → skeleton → real data                      |
| No cache + Drive fails               | App shell + skeleton → error toast → retry on poll                              |
| No cache + needs password            | Redirect to /welcome (unchanged)                                                |
| Cache corrupt                        | Falls through to Drive fetch (skeleton shows)                                   |
| User edits during background sync    | CRDT merge preserves both local edits and remote changes                        |

## Data Safety

Automerge CRDT merge (already used for cross-device sync) guarantees no data loss in every scenario. `replaceDocWithCacheRecovery()` already handles merging unsynced cache into remote. `persistDoc()` auto-saves after any doc change. The cache-first approach builds on these existing guarantees.

## Files Affected

| File                                          | Change                                                                                                                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/stores/syncStore.ts`                     | Add `isBackgroundSyncing`, `backgroundSyncError`; add `backgroundSyncFromFile()` + `tryDecryptWithCachedKey()` helper (deduplicates existing pattern); export new state |
| `src/App.vue`                                 | Add `isLoadingData` ref; dismiss `isInitializing` after auth; restructure `loadFamilyData()` Path 1 for cache-first; render `ContentSkeleton` + `BackgroundSyncBar`     |
| `src/components/ui/ContentSkeleton.vue`       | **NEW** — generic skeleton matching NookSectionCard card layout                                                                                                         |
| `src/components/common/BackgroundSyncBar.vue` | **NEW** — 3px indeterminate progress bar                                                                                                                                |
| `src/style.css`                               | Add `beanie-shimmer` keyframe + utility + reduced-motion rule                                                                                                           |
| `src/services/translation/uiStrings.ts`       | Add `sync.backgroundError` key                                                                                                                                          |

**Zero page file changes.** Skeleton and progress bar are rendered in App.vue only.

## Verification

1. **Cache hit**: Use app, close tab, reopen — instant data, progress bar completes
2. **Cache miss**: Clear IndexedDB (`beanies-automerge-*`), reload — skeleton shows, data fills in after Drive fetch
3. **No network**: Disable network after cache load — error toast, app stays functional
4. **Edit during sync**: Load from cache, add a todo, wait for merge — todo survives
5. **Cross-device**: Edit on device B, open device A — cached data → highlights after merge
6. **Reduced motion**: Enable `prefers-reduced-motion` — shimmer disabled, static gray blocks
7. **Dark mode**: Verify skeleton cards use `nook-card-dark` styling
8. Run `npm run type-check` and `npm run lint`
