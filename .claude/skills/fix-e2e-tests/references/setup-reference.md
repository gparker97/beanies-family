# E2E Setup Reference

Concrete, literal details of the beanies.family Playwright setup — commands, file locations, helper/fixture APIs, dev-only hooks, and CI internals. Pull what you need; you don't have to read it all.

## Table of contents

1. Directory layout
2. npm scripts & how to run things
3. Playwright config essentials
4. CI workflow internals
5. Helper & fixture API
6. Page objects
7. Dev-only test hooks (`window.__e2e*`)
8. Where artifacts land

---

## 1. Directory layout

```
e2e/
├── specs/                      # the tests (≈21 tests / 7 files — within the 25 budget)
│   ├── setup-flow.spec.ts      # fresh pod creation + family member setup
│   ├── cross-entity.spec.ts    # multi-layer integration: institutions, onboarding, accounts+loans+activities (largest)
│   ├── planner.spec.ts         # activity CRUD + recurring edit scopes (this / all-future / all)
│   ├── financial-data.spec.ts  # account→net-worth, income/expense→summary
│   ├── invite-join.spec.ts     # invite wizard, join-via-registry, join-failure fallback
│   ├── trusted-device.spec.ts  # password cache set→persist→clear
│   └── google-drive.spec.ts    # Drive provider visibility (Load Pod view, Create Pod step 2)
├── page-objects/               # DashboardPage, AccountsPage, AssetsPage, TransactionsPage
├── helpers/                    # indexeddb, auth, activity-modal, navigation, combobox, date-picker, cleanup, test-dates, ui-strings
└── fixtures/                   # test.ts (custom fixture), data.ts (TestDataFactory)
```

## 2. npm scripts & how to run things

From root `package.json`:

```json
"test:e2e":          "playwright test",
"test:e2e:ui":       "playwright test --ui",
"test:e2e:headed":   "playwright test --headed",
"test:e2e:debug":    "playwright test --debug",
"test:e2e:chromium": "playwright test --project=chromium",
"test:e2e:firefox":  "playwright test --project=firefox",
"test:e2e:webkit":   "playwright test --project=webkit",
"test:e2e:report":   "playwright show-report"
```

Common invocations:

```bash
npx playwright test e2e/specs/planner.spec.ts                 # one spec, all projects
npx playwright test e2e/specs/planner.spec.ts --project=webkit # one spec, one browser
npx playwright test -g "Reschedule"                            # by test title substring
npx playwright test --project=webkit --repeat-each=5           # confirm a flake fix held
npx playwright test ... --headed                               # watch it run
npm run test:e2e:ui                                            # interactive runner / trace explorer
npm run test:e2e:report                                        # open the last HTML report
```

The webServer auto-starts `npm run dev` (no need to start it yourself). First run after `npm ci` may need `npx playwright install`.

## 3. Playwright config essentials

`playwright.config.ts` (root):
- **testDir** `./e2e/specs`; **fullyParallel** true; **baseURL** `http://localhost:5173`.
- **Projects:** `chromium` (Desktop Chrome), `firefox` (Desktop Firefox), `webkit` (Desktop Safari).
- **Timeouts/retries:** global 20s, retries 1 in CI / 0 local. **WebKit is special: 60s timeout, 2 retries** — it absorbs transient "internal error" crashes (issue #155). When a webkit test fails inside 60s it's likely real; a pass-on-retry is the flake signal.
- **Artifacts:** `trace: 'on-first-retry'`, `screenshot: 'only-on-failure'`, `video: 'retain-on-failure'`. `reducedMotion: 'reduce'` (kills decorative animation stalls). `serviceWorkers: 'allow'`.
- **Reporters:** HTML → `playwright-report/`, JUnit → `test-results/junit.xml`.
- **webServer** injects dummy `VITE_GOOGLE_*` / `VITE_REGISTRY_*` env so feature-flag-gated UI (Drive, registry) renders without `.env.local`.

## 4. CI workflow internals

File `.github/workflows/e2e.yml`, workflow name **"E2E Tests"**. Jobs you'll see in `gh run view`:
- **"Select browsers"** — computes the matrix (only runs on the `labeled` event).
- **"E2E — chromium"**, **"E2E — webkit"** (and **"E2E — firefox"** on full sweeps) — the actual test jobs (`name: E2E — ${{ matrix.browser }}`).

Triggers & matrix:
- **push to `main`** → `[chromium, webkit]` (ignores `*.md`, `docs/`, `tasks/`, `LICENSE`, `.claude/`).
- **PR labeled `run-e2e`** → `[chromium, webkit]` (E2E is opt-in per PR — add the label to run it).
- **schedule** (Mon 06:00 UTC) and **workflow_dispatch** → full `[chromium, firefox, webkit]`.
- `fail-fast: false` — every browser runs even if one fails, so you get the full picture in one run.

Artifacts: `playwright-report-<browser>` (14-day retention), `test-videos-<browser>` (7-day). Pull with `gh run download <run-id> -n <artifact-name> -D <dir>`.

Useful: to force a full E2E run on a PR, add the `run-e2e` label; to run on demand, `gh workflow run e2e.yml`.

## 5. Helper & fixture API

**Always import test/expect from the custom fixture**, not bare Playwright:
```ts
import { test, expect } from '../fixtures/test'
```
The fixture disables beanie mode (`window.__e2e_beanie_off = true`) so copy is standard-cased, and runs `cleanupRegistry(page)` after each test so aborted tests don't leave orphan registry rows.

**IndexedDB** (`helpers/indexeddb.ts`) — `new IndexedDBHelper(page)`:
- `clearAllData()` — wipes all `beanies-*` DBs + the `e2e_auto_auth` / `__e2eSeedDoc` keys. Call at test start, then re-navigate.
- `exportData()` — returns the Automerge doc state: `{ familyMembers, accounts, transactions, assets, goals, recurringItems, todos, activities, vacations?, settings }`. **This is your primary assertion surface** (assert data, not DOM).
- `seedData({...})` — pre-populate state for tests that need it.

**Auth** (`helpers/auth.ts`):
- `bypassLoginIfNeeded(page)` — walks the Create Pod flow on fresh state (or short-circuits via the auto-auth flag), waits for `app-content`. Use to get into the app.
- `navigateToAddMembers(page)` — stops at the add-members step (Finish still visible) for tests of that step.

**Navigation** (`helpers/navigation.ts`): `gotoRoute(page, path)`, `gotoRoot(page)` — webkit-race-hardened; use instead of `page.goto()`.

**Other helpers:** `combobox.ts` (`ComboboxHelper`: `open/search/selectOption/selectOther/expectDisplayText`), `date-picker.ts` (`selectBeanieDate(scope, 'YYYY-MM-DD')`), `activity-modal.ts` (`dismissActivityCreatedConfirm(page)`), `test-dates.ts` (`tomorrowOrTodayStr()`), `ui-strings.ts` (`ui(key)` → English display text; throws on unknown key, catching typos), `cleanup.ts` (`cleanupRegistry(page)`).

**Fixtures/data** (`fixtures/data.ts`): `TestDataFactory.createFamilyMember/createAccount/createSettings(...)`.

## 6. Page objects

`page-objects/` wraps the gnarly flows. `AccountsPage` is the one most touched by flakes — its `selectAccountType()` carries the `v-show` visibility-gate fix (pattern #3 in the failure catalog). Prefer extending a page object over duplicating a tricky interaction across specs.

## 7. Dev-only test hooks (`window.__e2e*`)

Exposed only under `import.meta.env.DEV`:
- `window.__e2eDataBridge` — `exportData()`, `seedData({...})`, `cleanupActiveFamily()`. Backs the `IndexedDBHelper`.
- `sessionStorage['e2e_auto_auth'] = 'true'` — suppresses `InviteGateOverlay` + `TrustDeviceModal`.
- `sessionStorage['__e2eSeedDoc']` — base64 Automerge binary, persisted across reloads (cleared by `clearAllData()`).
- `window.__e2eCreatePod.installMemoryProvider()` — injects an in-memory file provider for Create Pod flows (the harness that lets the unified-create E2E run without real Drive).
- `window.__e2e_beanie_off` — set by the fixture to disable beanie-mode lowercasing.

If a test depends on one of these and it's missing, confirm the dev server is the one Playwright started (the config injects the env it needs) and that the hook is still wired in `src/services/e2e/` and friends.

## 8. Where artifacts land

- HTML report: `playwright-report/` → `npm run test:e2e:report` to open.
- Traces (on first retry): inside the report; open a trace to see per-step DOM snapshots, console, network — the fastest way to see *why* a step failed.
- Videos / screenshots on failure: `test-results/`.
- JUnit XML: `test-results/junit.xml`.
