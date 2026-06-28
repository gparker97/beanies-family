# E2E Failure Pattern Catalog

The recurring failure shapes this project's Playwright suite has seen, distilled from `docs/E2E_HEALTH.md`. Most red E2E runs are one of these — match the symptom, apply the proven structural fix, and don't reinvent. Each entry: **symptom → root cause → structural fix → code location**.

The throughline: almost every recurring failure is **WebKit under CI contention**, and every one has a *structural* remedy (a readiness gate, a reorder, a retry helper). None is fixed with `waitForTimeout`. If your fix is "wait longer," you haven't found the root cause yet.

## Table of contents

1. WebKit navigation race ("Navigation interrupted")
2. WebKit modal-to-modal transition timeout
3. WebKit pre-mounted (`v-show`) visibility lag
4. Month-end "tomorrow" date edge case
5. Stale copy-dependent selectors
6. Recurrence thresholds — when to stop hardening and cull/quarantine

---

## 1. WebKit navigation race — "Navigation interrupted"

**Symptom:** `page.goto(path)` fails with *"Navigation to '…' interrupted by another navigation to '…'"*. WebKit-only, intermittent, worse under heavy CI parallelism. (Documented 05-11, 05-16, 06-03, and more.)

**Root cause:** The SPA router guards redirect `/` → `/nook` or `/login` on first paint. Under contention, that client-side redirect fires *before* `page.goto()`'s response `load` event resolves, so Playwright sees its navigation interrupted by the app's own redirect.

**Structural fix:** Never call `page.goto()` directly in a spec. Use the `gotoRoute(page, path)` / `gotoRoot(page)` helpers, which retry on exactly this error class using `waitUntil: 'commit'` (resolves before `load` fires) with a `domcontentloaded` settle between attempts.

**Location:** `e2e/helpers/navigation.ts`. If a spec still calls `page.goto()` raw, that's the bug — swap it for the helper.

---

## 2. WebKit modal-to-modal transition timeout

**Symptom:** `waitFor` on a modal heading times out (5–15s); the second modal seems to render late or not at all. WebKit-only. (Documented 04-22, 04-23, 05-03, 05-13, 05-16 — chronic.)

**Root cause:** Two `role="dialog"` overlays momentarily coexist — the first dialog hasn't fully unmounted when the second opens. WebKit's focus/accessibility engine stalls reconciling two live dialogs under CI load.

**Structural fix:** In the *app code*, close the first modal, `await nextTick()`, then open the second — don't open-over-close. In the *test*, gate on a semantic readiness signal (the new modal's heading visible) before interacting, rather than assuming it's there. The `dismissActivityCreatedConfirm()` helper encodes this: wait for the heading, then click OK.

**Locations:** app side — `ActivityModal.vue:handleSave`, `FamilyPlannerPage.handleViewOpenEdit`, `TransactionsPage.handleViewOpenEdit`. Test side — `e2e/helpers/activity-modal.ts`.

---

## 3. WebKit pre-mounted (`v-show`) visibility lag

**Symptom:** `AccountsPage.selectAccountType()` (or similar) times out (~30s) waiting for a subtype/option button, even though the prior click committed. Often surfaces as a Playwright **strict-mode violation** (multiple matches) or a visibility timeout. WebKit-heavy. (Documented 04-30, 05-05, 05-09, 05-10, 05-13 — chronic.)

**Root cause:** Components like `AccountCategoryPicker` pre-mount all option blocks under `v-show` (display toggling, not mount/unmount). All nodes exist in the DOM; only one is visible. Two failure modes: (1) a bare `getByText('…')` matches several pre-mounted copies → strict-mode violation; (2) WebKit's a11y-tree visibility recompute lags after the click, so the "visible" state isn't observable yet.

**Structural fix:** Wait on a stronger readiness signal first (e.g. the expanded-state hint text "Select a type" becoming visible), THEN target the option. Always `.filter({ visible: true })` when the text exists on multiple pre-mounted nodes, so you bind to the one that's actually shown.

```ts
await page.getByText('Select a type', { exact: true })
  .filter({ visible: true })
  .waitFor({ state: 'visible', timeout: 30_000 })
const btn = page.getByRole('button', { name: subtype })
await btn.waitFor({ state: 'visible', timeout: 30_000 })
await btn.click()
```

**Location:** `e2e/page-objects/AccountsPage.ts` (see the in-file comments tracking recurrences).

---

## 4. Month-end "tomorrow" date edge case

**Symptom:** A test that creates an activity "for tomorrow" times out clicking the activity chip; the activity *exists in the IndexedDB export* but its chip never renders. Hit on the last day of a month; both browsers. (Documented 05-31 — a real bug the test caught.)

**Root cause:** Naive `const t = new Date(); t.setDate(t.getDate() + 1)` rolls into next month on day 30/31. The activity persists in the next month, but the planner's month view (`CalendarGrid` → `monthActivities(year, month)`) only renders chips for the visible month — adjacent-month padding cells don't show chips. So the click waits forever for a chip that's a month away.

**Structural fix:** Use `tomorrowOrTodayStr()` — returns tomorrow when it stays in-month, clamps to today on month-end — for any "create something dated near now and then find it in the current view" flow.

**Location:** `e2e/helpers/test-dates.ts`. Wired into `planner.spec.ts` (multiple sites) and `cross-entity.spec.ts`.

---

## 5. Stale copy-dependent selectors

**Symptom:** `getByText(/some label/i)` or `getByRole('button', { name: '…' })` times out after a UI copy change. Both browsers. Test drift, not a product bug. (Documented 04-19, 06-18.)

**Root cause:** UI copy changed (e.g. "Select file from Drive" → "Open Your Family File") but the spec's hardcoded English selector wasn't updated. This is the most common *non-flake* failure after feature/copy work.

**Structural fix:** Re-point the selector. Prefer a `data-testid` (immune to copy changes) or resolve the copy through `ui('key')` (the i18n resolver) so the selector tracks the same string source the app renders. Hardcoding English in a spec is the anti-pattern that creates this failure.

**Location:** `e2e/helpers/ui-strings.ts` exports `ui(key)`. Example drift: `invite-join.spec.ts` after the 2026-06-14 copy pass.

---

## 6. Recurrence thresholds — when to stop hardening and cull/quarantine

From ADR-007. The health log exists precisely to make these calls:

- **Logged (b) or (c) more than twice** → rewrite or remove the test; it's not earning its keep.
- **Logged (c) ~5–6+ times with no remaining structural fix** → candidate for browser-scoped quarantine: `test.skip(browserName === 'webkit', 'chronic CI-contention flake — see E2E_HEALTH.md YYYY-MM-DD')`. This is the **last resort**, only after the structural fixes above are exhausted, and it requires **greg's approval** plus a health-log entry. Quarantining is the sanctioned way to reach "all green" on a genuinely intractable webkit flake — not a shortcut to skip real work.

Signal-quality targets the log tracks: signal-to-noise (real bugs ÷ intentional changes) > 2.0; review quarterly; any test repeatedly generating (b)/(c) noise is a liability, not an asset.
