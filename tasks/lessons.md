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
