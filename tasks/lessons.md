# Lessons Learned

Patterns and rules to prevent repeated mistakes.

---

## 1. E2E: Wait for async step transitions before manipulating state

**Date:** 2026-02-23
**Context:** Create Pod wizard E2E bypass

**Pattern:** When an E2E test clicks a button that triggers an async handler (e.g., `handleStep1Next` calls `authStore.signUp()`), and the handler sets component state on completion (e.g., `currentStep = 2`), any `page.evaluate` that modifies the same state will be overwritten when the async handler resolves.

**Symptom:** "element was detached from the DOM, retrying" — the target UI briefly renders then disappears because the async callback overwrites the state change.

**Rule:** Always wait for the **destination UI** to be visible before programmatically manipulating component state in E2E tests. Example:

```typescript
// BAD: race condition — signUp() hasn't finished yet, will overwrite currentStep
await page.getByRole('button', { name: 'Next' }).click();
await page.evaluate(() => window.__e2eHook.setStep(3));

// GOOD: wait for step 2 to render (proves async handler completed)
await page.getByRole('button', { name: 'Next' }).click();
await page.getByText('Step 2 Title').waitFor({ state: 'visible' });
await page.evaluate(() => window.__e2eHook.setStep(3));
```

## 2. E2E: Native OS dialogs cannot be automated — use dev-mode hooks

**Date:** 2026-02-23
**Context:** `showSaveFilePicker` / `showOpenFilePicker` in Create Pod step 2

**Pattern:** Browser APIs that open native OS dialogs (`showSaveFilePicker`, `showOpenFilePicker`, `showDirectoryPicker`) cannot be intercepted or automated by Playwright, even with mocks. The entire chain (`selectSyncFile` → `storeFileHandle` → `syncNow` → `save`) is too deep to reliably mock from `page.evaluate`.

**Rule:** For components gated behind native OS dialogs, expose a minimal dev-mode-only hook:

```typescript
// In the component (production-safe)
if (import.meta.env.DEV) {
  (window as any).__e2eComponentName = { setStep: (s: number) => (step.value = s) };
}
```

Then use it in E2E tests to skip the unmockable step entirely.

## 3. Use `familyStore.owner` not `familyStore.currentMember` during signup

**Date:** 2026-02-23
**Context:** Owner not appearing in Create Pod step 3

**Pattern:** `authStore.signUp()` creates the owner member via `familyStore.createMember()` (which adds to `members` array) but does **not** call `familyStore.setCurrentMember()`. So `familyStore.currentMember` remains `null` during the Create Pod wizard.

**Rule:** During the signup/create-pod flow, use `familyStore.owner` (computed from `members.find(m => m.role === 'owner')`) to reference the current user, not `familyStore.currentMember`.

## 4. E2E: Use explicit timeouts for async dashboard assertions

**Date:** 2026-02-23
**Context:** Flaky `toContainText('150')` failure on monthly expenses stat

**Pattern:** Dashboard stats load asynchronously — the page navigates, IndexedDB queries run, Pinia stores recompute, and Vue re-renders. On slow CI runners (shared GitHub Actions VMs) this chain can exceed Playwright's default 5s `expect` timeout, causing intermittent failures even though the data is correct.

**Symptom:** `expect(locator).toContainText('150')` fails with `unexpected value "USD $0.00"` — the stat simply hasn't updated yet.

**Rule:** Always use an explicit `{ timeout: 10000 }` on `toContainText` / `toHaveText` assertions that check values loaded asynchronously from IndexedDB, especially after a page navigation:

```typescript
// BAD: default 5s timeout, flaky on slow CI
await expect(dashboardPage.monthlyExpensesValue).toContainText('150');

// GOOD: explicit 10s timeout for async data
await expect(dashboardPage.monthlyExpensesValue).toContainText('150', { timeout: 10000 });
```

## 5. Translation script must stay in sync with uiStrings.ts format

**Date:** 2026-02-24
**Context:** `scripts/updateTranslations.mjs` parser broke when `UI_STRINGS` was refactored to `STRING_DEFS`

**Pattern:** The translation script (`scripts/updateTranslations.mjs`) parses `uiStrings.ts` at the text level (not via TypeScript imports). Any structural refactoring of `uiStrings.ts` — renaming the main object, changing the export pattern, switching from `as const` to `satisfies`, etc. — can silently break the parser.

**Rule:** Whenever you modify the structure of `uiStrings.ts` (not just adding/removing string entries), also verify and update the parser in `scripts/updateTranslations.mjs`. Run `npm run translate` to confirm the parser still extracts all keys correctly.

## 6. Repo rename: GitHub redirects handle most things automatically

**Date:** 2026-02-24
**Context:** Renamed repo from `gp-family-finance-planner` to `beanies-family`

**Pattern:** Renaming a GitHub repo is low-risk because GitHub sets up automatic redirects from the old URL. The main tasks are: (1) rename on GitHub Settings, (2) update local remote URL with `git remote set-url`, (3) sweep codebase for hardcoded references to old name.

**Rule:** Before renaming, grep the entire codebase (including CI workflows, Terraform, wiki, docs) for the old name. After renaming, run a deploy to verify nothing broke. If `package.json` name was already different from the repo name, there's even less to change.

## 7. PBKDF2 salt rotation invalidates wrapped DEKs

**Date:** 2026-02-24
**Context:** Passkey biometric login returned "incorrect key" after sign-out

**Pattern:** `encryptData()` generates a new random PBKDF2 salt on every call. When a passkey wraps the DEK (derived from password + salt), any subsequent save that re-encrypts the file generates a new salt, making the wrapped DEK stale. This happens silently — e.g., `flushPendingSave()` on sign-out re-encrypts with a fresh salt.

**Symptom:** Passkey registration succeeds, but biometric login fails with "incorrect key" because the file's salt no longer matches the salt the DEK was derived from.

**Rule:** When using key-wrapping (AES-KW) with PBKDF2-derived keys, ensure the encryption salt remains stable after wrapping:

1. After wrapping a DEK, switch to `encryptDataWithKey(data, key, originalSalt)` which preserves the salt
2. Always store a cached password as fallback alongside PRF-wrapped DEKs
3. On login, try DEK decryption first, fall back to cached password if the DEK is stale
4. Design a graceful fallback chain: DEK → cached password → manual password entry
5. **Return fallback data alongside primary data** — when `authenticateWithPasskey` returns a DEK on the PRF path, also return `cachedPassword` so the caller can fall back. Don't assume the primary path will always succeed.
6. **Force-save after registration** — `navigator.credentials.create()` pauses JS for user interaction (biometric prompt). During this pause, debounced auto-saves (password-based, new random salt) can fire, making the just-wrapped DEK stale. Force an immediate DEK-based save after registration to re-align the file's salt.

## 8. Keep test mocks in sync when adding new module exports

**Date:** 2026-02-24
**Context:** `passwordCache.test.ts` CI failure — `setSessionDEK` and `flushPendingSave` missing from `syncService` mock

**Pattern:** When a module gains new exports (e.g. `syncService.ts` added `setSessionDEK` and `flushPendingSave`), any `vi.mock()` for that module in existing tests will throw at runtime if the mocked code path calls the new export. Vitest's factory mocks are exhaustive — unmocked exports become `undefined`, which throws `No "X" export is defined on the mock`.

**Symptom:** Tests that previously passed start failing with `[vitest] No "setSessionDEK" export is defined on the "@/services/sync/syncService" mock. Did you forget to return it from "vi.mock"?` — even though the test file wasn't changed.

**Rule:** Use Vitest's `__mocks__/` auto-mock convention for heavily-mocked modules. Place the shared mock at `<module>/__mocks__/<module>.ts` and use `vi.mock('<path>')` (no factory) in test files. Tests that need custom behaviour spread the defaults and override:

```typescript
// Simple tests — auto-mock has all exports covered:
vi.mock('@/services/sync/syncService');

// Tests with custom behaviour — spread defaults, override what's needed:
vi.mock('@/services/sync/syncService', async () => {
  const defaults = await import('../../services/sync/__mocks__/syncService');
  return {
    ...defaults,
    onStateChange: vi.fn((cb) => {
      /* custom */
    }),
  };
});
```

When adding a new export to the module, only the `__mocks__/` file needs updating. All test files benefit immediately.

## 9. File System Access API: concurrent writes corrupt files

**Date:** 2026-02-25
**Context:** `.beanpod` data file corruption — stale trailing bytes appended after valid JSON

**Pattern:** The File System Access API's `createWritable()` does not guarantee atomic writes for local file system files. When two `save()` calls execute concurrently (e.g. debounced auto-save racing with a forced save from sign-out or passkey registration), their `truncate`/`write`/`close` operations can interleave. If the second write produces shorter content, the tail of the first write's content remains as stale bytes at the end of the file, corrupting the JSON.

**Symptom:** Valid JSON followed by garbage characters at EOF. Example: `..."familyName": "Greg Beanies Dev"}"My Family"\n}` — the file has the correct new content, but the tail of a previous (shorter) write's content remains.

**Root cause:** No write mutex in `save()`. The `truncate(0)` fix (commit e74add6) only prevents corruption from sequential writes of different lengths; it does NOT protect against concurrent writes whose operations interleave at the stream level.

**Fix (multi-layered):**

1. **Write mutex:** Serialize all `save()` calls via a Promise-based lock (`saveInProgress`). Each call waits for any in-flight save to finish before starting.
2. **Write-then-truncate:** Instead of `truncate(0)` → `write(content)`, use `seek(0)` → `write(content)` → `truncate(contentLength)`. This ensures the file is exactly the right size regardless of interleaving.
3. **Explicit `keepExistingData: false`:** Pass it explicitly to `createWritable()` to guarantee the temp file starts empty across all browser implementations.

**Rule:** Any async function that writes to a shared file via the File System Access API MUST be serialized with a mutex. Debouncing alone is insufficient — it prevents rapid re-triggering but does not prevent overlapping async operations.

## 10. Pinia store vs service-level state: keep them in sync after identity changes

**Date:** 2026-02-26
**Context:** Google Drive file reverts to local file on page refresh

**Pattern:** `syncService.decryptAndImport()` calls `familyContext.createFamilyWithId(FAMILY-B)` directly, which updates the **database module's** `currentFamilyId` to FAMILY-B. But the Pinia `familyContextStore.activeFamily` ref still points to FAMILY-A — it was never updated. Later, `authStore.signIn()` reads `familyContextStore.activeFamilyId` (FAMILY-A) and persists it in the session. On refresh, the app restores FAMILY-A and looks up its provider config — finding the local file handle instead of the Google Drive config that was correctly stored under FAMILY-B.

**Symptom:** After loading from Google Drive and refreshing, the app silently reverts to a previously loaded local file. Console shows `Provider config for <FAMILY-A>: none` — because the Google Drive config was stored for FAMILY-B, which the session never references.

**Root cause chain:**

1. `decryptAndImport()` adopts FAMILY-B at DB level but not Pinia level
2. `authStore.signIn()` captures stale FAMILY-A from Pinia into the session
3. On refresh, session says FAMILY-A → provider config lookup finds local file, not Google Drive

**Additional contributing factors:**

- `pendingEncryptedFile` stored `{} as FileSystemFileHandle` as a placeholder for Google Drive files — this couldn't be normalized back to a provider in `decryptAndImport`, so `persist()` was never called through that path either
- No mutual exclusion between local file handles and Google Drive configs in IndexedDB — both could coexist for the same family

**Rule:** When any service-level function changes the active family identity (via `createFamilyWithId`, `setActiveFamilyDB`, etc.), the Pinia `familyContextStore` MUST be synced immediately afterward:

```typescript
const { getActiveFamilyId } = await import('@/services/indexeddb/database');
const activeFamilyId = getActiveFamilyId();
const familyCtx = useFamilyContextStore();
if (activeFamilyId && activeFamilyId !== familyCtx.activeFamilyId) {
  await familyCtx.switchFamily(activeFamilyId);
}
```

**Broader principle:** When state is duplicated across layers (DB module, Pinia store, session storage), any operation that changes one layer must propagate to all others. Silent divergence between layers causes bugs that are extremely hard to trace because each layer looks correct in isolation.

**Defense in depth:**

- Each storage provider's `persist()` should clear the other provider's stale config (mutual exclusion)
- Store provider identity as plain strings (not class instances) in Vue refs to avoid Proxy issues
- Add diagnostic logging to `syncService.initialize()` showing which provider was found

## 11. Extract shared components early — duplicated UI code diverges silently

**Date:** 2026-02-28
**Context:** Todo view/edit modal duplicated across 3 files (~600 lines total)

**Pattern:** When the same UI pattern (modal, form, card) is copy-pasted across multiple files, the copies inevitably diverge in small ways (missing emojis, inconsistent trim() calls, different entity names). Each bug fix or feature change must be applied N times, and some copies get missed.

**Symptom:** The planner's todo modal was missing emojis that the todo page and nook widget had. The nook widget wasn't calling `.trim()` on description. These inconsistencies were invisible until a side-by-side comparison.

**Rule:** When a UI pattern appears in 2+ locations with identical structure, extract it into a shared component immediately. Use prop-driven visibility (`todo: Item | null` where non-null = open) and self-contained internal state. Follow the `ActivityModal.vue` pattern: props for data in, emits for actions out, all logic encapsulated.
