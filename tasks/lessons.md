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
