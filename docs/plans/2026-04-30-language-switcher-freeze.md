# Plan: Fix language-switcher freeze + ensure non-blocking translation loads

> Date: 2026-04-30
> Related: greg's report — clicking Chinese causes a 30s–1m spinner during which the switcher is unresponsive, especially after deploys when many translations need API backfill.

## Context

The intended UX:

- Click a flag → cosmetic language switch is **instant** (using whatever `public/translations/{lang}.json` ships with the deploy)
- Missing translations download **in the background**, never blocking the click handler or disabling the switcher
- User can flip languages **at any time**, even mid-load — the latest click wins; stale loads can't clobber it

What actually happens today (audited 2026-04-30):

1. **The click handler awaits the slow path.** `selectLanguage()` in `AppHeader.vue` (lines 113–117) does `await translationStore.loadTranslations(code)`. The store applies whatever it has from the bundled JSON immediately (lines 77–80, fast), but then enters a sequential API loop at `translationApi.translateBatch()` to backfill missing keys from MyMemory at ~200 ms each. After a fresh deploy with ~500 new strings, that loop runs ~100 s. The handler stays awaited the whole time, so the user perceives the switcher as frozen.
2. **The mobile switcher is actively `:disabled` during load.** `MobileHamburgerMenu.vue` lines 281–328 gate each language button behind `:disabled="translationStore.isLoading"` and `pointer-events-none`. The user can't flip back even if they want — UI explicitly locks them out.
3. **No cancellation when the user switches mid-load.** Click Chinese, then 5 s later click English, both loads run concurrently. The Chinese load eventually completes its API loop and writes `translations.value = newChineseMap` even though the user is now on English — last-writer-wins race.
4. **Catastrophic JSON-fetch failure is invisible.** If `/translations/zh.json` 404s, the cosmetic switch never happens, `error.value` is set + `console.error` fires, but nothing user-visible. The click looks ignored.

The 200 ms-per-key MyMemory rate limit is intentional (free tier; we don't hit batch endpoints). The bug is _awaiting_ that loop in the click path, _disabling_ the switcher while it runs, _not canceling_ superseded loads, and _not surfacing_ catastrophic failures.

## Approach

Four changes, lock-step.

### 1. Extract `useLanguageSwitcher()` composable (DRY)

Two surfaces (`AppHeader.vue`, `MobileHamburgerMenu.vue`) need fire-and-forget switching. Per the project's DRY rule + greg's standing instruction (extract NOW when 2 surfaces exist, not later), the cancellation contract + locking comment + error logging live in _one_ place.

**`src/composables/useLanguageSwitcher.ts`** (new):

```ts
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslationStore } from '@/stores/translationStore';
import type { LanguageCode } from '@/types/models';

/**
 * Switch the app language without ever blocking the click handler.
 *
 * The translation store applies the language cosmetically before any API
 * work, so the switch feels instant. We intentionally do NOT `await` the
 * load — awaiting would freeze the user inside the click handler for the
 * entire ~100 s API backfill on a fresh deploy. The store's internal
 * `activeLoadToken` (see translationStore.ts) handles cancellation, so a
 * mid-load language switch supersedes a previous load cleanly.
 *
 * DO NOT add `await` back without revisiting docs/plans/2026-04-30-language-switcher-freeze.md.
 */
export function useLanguageSwitcher() {
  const settingsStore = useSettingsStore();
  const translationStore = useTranslationStore();

  function switchLanguage(code: LanguageCode) {
    // Persist preference + load translations in parallel. Failures of either
    // are logged but never bubble — the catch keeps a network hiccup from
    // rejecting an otherwise-completed UX action.
    settingsStore.setLanguage(code).catch((err) => {
      console.warn('[langSwitcher] settingsStore.setLanguage failed:', err);
    });
    translationStore.loadTranslations(code).catch((err) => {
      console.warn('[langSwitcher] translationStore.loadTranslations failed:', err);
    });
  }

  return { switchLanguage };
}
```

Consumers:

```ts
// AppHeader.vue
const { switchLanguage } = useLanguageSwitcher();
function selectLanguage(code: LanguageCode) {
  showLanguageDropdown.value = false; // surface-specific UI state
  switchLanguage(code);
}
```

```ts
// MobileHamburgerMenu.vue — directly in template:
// @click="switchLanguage(lang.code)"
```

No more duplicated `await`. No more two copies of the catch block.

### 2. Mobile switcher: never disabled

**`src/components/common/MobileHamburgerMenu.vue`** lines 281–328 — remove `:disabled="translationStore.isLoading"` and `pointer-events-none` from the language buttons. Keep the small spinner indicator on the actively-loading flag (visual feedback) but the buttons stay clickable at all times.

Desktop already isn't disabled (only `opacity-75` for visual hint) — leave as-is.

### 3. Cancellation token in `translationStore`

Closure-scoped `activeLoadToken` counter inside the Pinia setup. Each `loadTranslations` call captures `++activeLoadToken` at start; staleness checks before every reactive write _and_ at every iteration of the API loop. Worst-case cancellation latency = one loop iteration (~200 ms) since we check before each `await translateOneKey()`.

**Why a counter, not AbortSignal:** AbortSignal would cancel the in-flight HTTP request slightly faster (saving up to 200 ms per supersede event) but requires plumbing a signal through `translationApi.ts`. The complexity isn't worth a single-event 200 ms gain. A future maintainer can add it if MyMemory cancellation latency becomes a real concern.

#### Sustainability principles applied

- **Linear orchestrator.** No phase nests inside another. Each phase is preceded by a clear comment marker and followed by a single staleness guard. The function reads top-to-bottom like a checklist; no branching in/out of nested closures.
- **Per-key try/catch extracted to a helper.** Without extraction, the API loop would have a `try` inside a `for` inside the outer `try` — 4 levels deep. With `tryTranslateOneKey()` the loop stays flat (2 levels: outer try + for).
- **Catastrophic-failure handler extracted.** Inlined in the catch, the error path is `try → catch → if → 3 calls`. Extracted, the catch is `if isStale return; handle()`. Orchestrator nesting maxes at 2.
- **One staleness predicate, one phrase.** `const isStale = () => myToken !== activeLoadToken;`. Used as `if (isStale()) return;` everywhere — visually consistent, no inverted variants. Future maintainers see the same five characters at every guard.
- **No defensive wrappers around utilities we trust.** `reportError` and `showToast` are well-tested utilities used widely in the app. Don't wrap them in their own try/catch — if they throw, that's their bug, and silencing makes diagnosis harder.
- **Closure-scoped token, not module- or store-state.** Closure inside the Pinia setup has the same singleton lifetime as the store but is invisible to templates and composables — exactly what we want for an internal cancellation primitive.

#### `src/stores/translationStore.ts` changes (sketch)

The actual edits overlay onto the existing function shape — this is the contract, not a wholesale rewrite. Existing IndexedDB reads, MyMemory call sites, progress increments, and cache writes stay; we thread `isStale` checks through them, extract the per-key try, and add the catastrophic-failure surface.

```ts
export const useTranslationStore = defineStore('translation', () => {
  // ... existing state (currentLanguage, translations, isLoading, loadProgress, error) ...
  // ... existing internal `t()` helper used by both useTranslation composable and our actions ...

  /**
   * Cancellation pattern: each loadTranslations call captures `++activeLoadToken`
   * at start. Staleness checks (`isStale()`) gate every reactive write — a
   * superseded load's last write can never clobber the active load's state.
   * Closure-scoped because templates never need to read it. Standard SWR/Vue
   * Query semantics. See docs/plans/2026-04-30-language-switcher-freeze.md.
   */
  let activeLoadToken = 0;

  /** Try one key against the API. Per-key failure is non-fatal — the t()
   * helper falls back to the source-language string. Logged so it isn't
   * silent. Returning null tells the caller "skip this entry, keep going". */
  async function tryTranslateOneKey(key: string, language: LanguageCode): Promise<string | null> {
    try {
      return await translateOneKey(key, language);
    } catch (err) {
      console.warn(`[translationStore] missed key "${key}" for ${language}:`, err);
      return null;
    }
  }

  async function loadTranslations(language: LanguageCode): Promise<void> {
    const myToken = ++activeLoadToken;
    const isStale = () => myToken !== activeLoadToken;

    try {
      isLoading.value = true;
      error.value = null;
      loadProgress.value = 0;

      // ─── Phase 1: bundled JSON (fast, ~50–300 ms) ───
      const data = await fetchTranslationFile(language);
      if (isStale()) return;

      loadProgress.value = 20;
      currentLanguage.value = language; // cosmetic switch — instant
      translations.value = bundledMap(data);

      // ─── Phase 2: identify missing keys ───
      const missing = findMissingKeys(data);
      if (missing.length === 0) return;

      // ─── Phase 3: IndexedDB cache backfill (parallel reads, fast) ───
      const cached = await readCache(language, missing);
      if (isStale()) return;
      if (cached.size > 0) {
        translations.value = mergeIntoMap(translations.value, cached);
      }
      const stillMissing = missing.filter((k) => !cached.has(k));
      if (stillMissing.length === 0) return;

      // ─── Phase 4: API backfill (~200 ms/key) ───
      // Staleness check at the top of each iteration so a mid-load supersede
      // aborts within ~200 ms, not after the remaining hundred seconds of fetches.
      const newEntries = new Map<string, string>();
      for (const key of stillMissing) {
        if (isStale()) return;
        const translated = await tryTranslateOneKey(key, language);
        if (isStale()) return;
        if (translated === null) continue; // per-key failure → log + skip
        translations.value = setKey(translations.value, key, translated);
        newEntries.set(key, translated);
        loadProgress.value = computeProgress(newEntries.size, stillMissing.length);
      }

      // ─── Phase 5: persist new entries ───
      if (isStale()) return;
      if (newEntries.size > 0) {
        await writeCache(language, newEntries);
      }
    } catch (err) {
      // Catastrophic failure (JSON fetch dead, IndexedDB unavailable, etc.).
      // Stale loads already returned earlier — this catch only fires for the
      // active load, so we surface it loudly.
      if (isStale()) return;
      handleCatastrophicLoadError(language, err);
    } finally {
      // Only the active load clears the spinner — stale aborts must not
      // reset isLoading while a newer load is still running.
      if (!isStale()) {
        isLoading.value = false;
        loadProgress.value = 100;
      }
    }
  }

  function handleCatastrophicLoadError(language: LanguageCode, err: unknown): void {
    const wrapped = err instanceof Error ? err : new Error(String(err));
    console.error('[translationStore] loadTranslations failed:', wrapped);
    error.value = wrapped.message;

    // Universal error pipeline — catastrophic failures join #beanies-errors
    // alongside the rest of the app's structured errors.
    reportError({
      surface: 'translation-load',
      message: `Translation load failed for ${language}`,
      error: wrapped,
      context: { language },
    });

    // User-facing toast — they clicked a flag and nothing changed; tell them
    // why. Renders in whatever language is currently active:
    //   - Phase 1 failure (fetch dead) → currentLanguage was NOT yet updated;
    //     toast renders in the previous language (e.g., English). Correct.
    //   - Phase 2–5 failure → currentLanguage already flipped to the new
    //     language in Phase 1; toast renders in the new language. Correct.
    // Either way `t()` resolves against a complete translations map.
    showToast('error', t('error.translationLoadFailed'), t('error.translationLoadFailedHelp'));
  }

  // ... existing returns ...
});
```

#### Cancellation contract (visual reference)

```
Time →

User clicks Chinese (token N starts)
  Phase 1 fetch ─────►
                    Phase 1 done (token N still active) → write currentLanguage='zh'
                    Phase 2-3 ─►
User clicks English (token N+1 starts) ◄──── token N is now stale
                                            Phase 4 loop iter checks isStale() → return
                                            Catch never fires for stale (already returned)
                                            Finally never resets isLoading for stale

  Token N+1: fresh load, owns isLoading, owns next reactive writes
```

| Event                       | Active load (`!isStale()`)          | Stale load (`isStale()`)              |
| --------------------------- | ----------------------------------- | ------------------------------------- |
| Phase 1–5 reactive write    | applies                             | early-returns before write            |
| Phase 4 per-key API failure | log + skip key, continue            | bail next iteration check             |
| Catch block                 | calls `handleCatastrophicLoadError` | no-op (caught by `if isStale return`) |
| Finally block               | clears `isLoading`                  | no-op                                 |
| Cancellation latency        | n/a                                 | ≤200 ms (next loop iteration)         |

### 4. i18n + reuse the universal error reporter

**Two new keys** in `src/services/translation/uiStrings.ts`:

```ts
'error.translationLoadFailed': {
  en: "We couldn't load translations",
  beanie: "couldn't load translations",
},
'error.translationLoadFailedHelp': {
  en: 'Check your connection and try again. The app stays in your previous language until then.',
  beanie: 'check your connection and try again. the app stays in your previous language until then.',
},
```

Run `npm run translate`; manually verify zh rendering (track record on auto-translation has been mixed — same workflow as the travel-segment fix).

**Reuse `src/utils/errorReporter.ts`** (already used by `errorClassifier`, `useStaleTabRefresh`, etc.). The translation store is currently the odd one out — it sets `error.value` and console.errors but doesn't go through the universal Slack pipeline. Wiring it in is one import + one call. No new infrastructure.

### 5. Tests

**Create `src/stores/__tests__/translationStore.test.ts`** — currently zero coverage. Six cases:

1. **Instant cosmetic switch.** Calling `loadTranslations('zh')` synchronously sets `currentLanguage.value = 'zh'` after the bundled-JSON fetch resolves but _before_ any API loop iteration runs. Assert with controlled microtask flush.
2. **`isLoading` toggling.** Starts false, true on call, false after resolve. Stale-load resolution does NOT flip isLoading off (active load still owns it).
3. **Stale-load bailout — Phase 1/2 (post-bundled-apply).** Start `loadTranslations('zh')`, before its first await resolves call `loadTranslations('en')`. After both settle, `currentLanguage.value === 'en'` and `translations.value` is the English map. The Chinese write was aborted by the staleness check.
4. **Stale-load bailout — Phase 4 (API loop).** With `translateOneKey` mocked to take 50 ms each and 5 missing keys, fire `loadTranslations('zh')`, advance fake timers 30 ms, fire `loadTranslations('en')`. Assert the Chinese load aborted at the next iteration; the English bundled state is what's reactive; no Chinese key writes after the supersede point. Verifies the ≤200 ms cancellation latency contract.
5. **Catastrophic failure surfaces a toast + reportError.** Mock `fetchTranslationFile` to reject. Assert: `error.value` is populated, `console.error` was called with `[translationStore]` prefix, `reportError` was called with `surface: 'translation-load'`, `showToast` was called with the new i18n keys. **Stale catastrophic failures (rejection from a superseded load) do NOT toast.** This is the test that proves intentional silence is bounded.
6. **Per-key failure is non-fatal.** With one key in the missing list throwing in `translateOneKey`, assert the loop continues, the other keys resolve, and `error.value` stays null (per-key failure is logged but doesn't escalate).

Mock `fetch` (or the file-load helper), the API client, and `useToast` / `errorReporter`. **All tests use `vi.useFakeTimers()`** — the 200 ms loop timing must be deterministic to avoid flakiness.

### Files affected

**Modified:**

- `src/stores/translationStore.ts` — add `activeLoadToken` + staleness checks, extract `tryTranslateOneKey` + `handleCatastrophicLoadError`, route catastrophic failures through `reportError` + `showToast`
- `src/components/common/AppHeader.vue` — `selectLanguage` calls into `useLanguageSwitcher` instead of awaiting both stores
- `src/components/common/MobileHamburgerMenu.vue` — same handler change; remove `:disabled` + `pointer-events-none` on language buttons
- `src/services/translation/uiStrings.ts` — 2 new error keys
- `public/translations/zh.json` — regenerated via `npm run translate` (verify zh output reads naturally)

**Created:**

- `src/composables/useLanguageSwitcher.ts` — single switchLanguage helper, single catch chain, single locking comment
- `src/stores/__tests__/translationStore.test.ts` — 6 cases

### Reused unchanged

- `src/services/translation/translationApi.ts` — the 200 ms/key MyMemory loop is the API's rate limit, not our bug. Unchanged. (Sustainability follow-up: add a one-line comment explaining why it's sequential.)
- `src/composables/useTranslation.ts` — pure passthrough to the store. Unchanged.
- `src/utils/errorReporter.ts` — the universal `reportError` already exists; the translation store joins the rest of the app in using it.
- `src/composables/useToast.ts` — the existing `showToast('error', title, help)` contract.
- The store's existing internal `t()` helper — already used by `useTranslation`; we call it from inside our actions (same closure scope, no circular dep).

### Out of scope (deliberate)

- **Parallelizing the API loop.** Once the click handler isn't awaiting, the user never _feels_ the loop. If the loop ever becomes a perf concern (5000+ missing keys after a major release), revisit then.
- **Sharding `zh.json`.** The file is 367 KB; loads in <300 ms. Sharding is a boot-perf optimization, not a freeze-fix concern.
- **AbortSignal plumbing.** Counter token aborts within ~200 ms — good enough.
- **Retry on catastrophic failure.** The user can click the flag again. Auto-retry adds complexity for marginal value.
- **Batching the per-key reactive writes during Phase 4.** Currently each successful key triggers a `translations.value = setKey(...)` reactive update. With 500 keys that's 500 re-renders during the load. Could be batched (write once at end), but: (a) this is pre-existing behavior, not something this PR introduces, and (b) per-key updates give a "translations are filling in" effect that may be desirable. Out of scope for the freeze fix; revisit if rendering perf during loads becomes a real complaint.

### Sustainability follow-ups (not blockers)

- The 200 ms-per-key sequential loop in `translationApi.ts` is intentional but currently lacks a comment explaining why. Add a one-line note ("MyMemory free tier rate limit; do not parallelize without subscribing to a paid tier") so a future maintainer doesn't try to remove it without understanding why.
- Document the `activeLoadToken` cancellation pattern in the store's top-of-file doc-block: "internal, closure-scoped, matches SWR semantics; see plan/2026-04-30-language-switcher-freeze.md" so the design intent survives if/when the file is refactored.
- The `useLanguageSwitcher` composable is intentionally minimal (just two store calls + catches). If a future feature adds e.g. analytics events on language switches, those get added to the composable — single source of truth means no surface drift.

### Implementation order

1. **Add `activeLoadToken` + staleness checks + extracted helpers (`tryTranslateOneKey`, `handleCatastrophicLoadError`) + reportError + toast wiring to `translationStore.ts`.** Add 2 i18n keys, regenerate zh.json. Write tests 1–4 first (the cancellation contract). Verify in isolation.
2. **Build `useLanguageSwitcher.ts`** with the fire-and-forget + catches + locking comment.
3. **Refactor `AppHeader.vue`** to consume the composable. Drop the inline `await`s.
4. **Refactor `MobileHamburgerMenu.vue`** to consume the composable. Drop `:disabled` + `pointer-events-none` on the language buttons.
5. **Run tests 5–6** (catastrophic failure path; per-key failure tolerance).
6. **Final verification:** type-check + lint + full unit suite + dev smoke (described below).

Each step is independently shippable. After step 1 the store is correct but consumers still await (working data, broken UX). After step 2 the composable exists but isn't used. Steps 3 + 4 cut over each surface.

## Verification

- **Type-check + lint clean** at every step. Run `npx vue-tsc -b --noEmit` (the strict mode used by the pre-commit hook) — plain `vue-tsc --noEmit` misses some errors (lesson from the travel-segment commit).
- **Unit tests:** `npx vitest run src/stores/__tests__/translationStore.test.ts` → all 6 cases pass. Full suite stays green.
- **Translation pipeline:** `npm run translate` clean; `zh.json` reads naturally for the new keys (override manually if not — same hash-preservation workflow used for travel-segment + filtered-to fixes).
- **Dev smoke at `npm run dev`:**
  - Throttle network to "Slow 3G" in DevTools, intercept MyMemory to add ~150 ms latency per call, clear IndexedDB.
  - Click Chinese flag → cosmetic switch happens within ~300 ms (bundled JSON load).
  - **Switcher remains interactive** — click English flag during the still-pending Chinese backfill → English applies instantly; no waiting, no stuck spinner.
  - Click Chinese again → cosmetic switch happens instantly; missing keys backfill in background.
  - Verify console: stale-load aborts don't log noise; only real errors log with `[langSwitcher]` or `[translationStore]` prefix. Catastrophic failures hit Slack `#beanies-errors` (verify via test webhook or by checking `errorReporter` mock in dev).
  - Force a catastrophic failure: block `/translations/zh.json` in DevTools, click Chinese — toast appears with the new i18n message in the _previous_ language (English on first switch); console error logged; `reportError` fires; app stays in the previous language.
  - On mobile (DevTools 375 px viewport): language buttons stay clickable during load. No `pointer-events-none`.
- **Beanie mode:** orthogonal, unaffected.
- **Save plan to `docs/plans/2026-04-30-language-switcher-freeze.md`** — already exists from the inline drafting; verify it matches this final version before implementation begins.
