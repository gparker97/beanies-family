# Phase 4 reference — browser verification

Read this before Phase 4. There is no browser MCP in this project — `.mcp.json` defines only
`notion-beanies`. Browser driving is the Playwright CLI, and `npx playwright test:*` is already
pre-approved in `.claude/settings.local.json`.

## The trap: a throwaway script in `e2e/specs/` joins the CI suite

`playwright.config.ts` sets `testDir: './e2e/specs'` with **no `testIgnore`**. So any file dropped there is
run by CI on every push to main across a browser matrix, and it silently counts against the ADR-007 budget.

That budget is real and nearly full: **23 of a hard cap of 25 tests.** Adding one requires removing or
consolidating another. A scratch file that sneaks in has already broken it once — `scripts/design-screenshots/capture.ts`
carries the note that it lives outside `e2e/specs/` deliberately, after a file there took the count from 21 to 22.

**So: a one-off verification script never goes in `e2e/specs/`.** Put it in `scripts/design-screenshots/` and
run it with the design config. It can still import all the real E2E plumbing:

```ts
import { test } from '../../e2e/fixtures/test';
import { IndexedDBHelper } from '../../e2e/helpers/indexeddb';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot, gotoRoute } from '../../e2e/helpers/navigation';
```

Import `{ test, expect }` from `e2e/fixtures/test`, **not** from `@playwright/test` — the fixture sets
`window.__e2e_beanie_off = true`, mocks the family registry, and cleans up DynamoDB rows afterwards.

Delete the scratch file when the verification is done, or keep it only if it earned a permanent place (and
then it is a budget decision, not a free one).

## The four configs

| Config | For | testDir |
| --- | --- | --- |
| `playwright.config.ts` | the E2E suite CI runs | `./e2e/specs` |
| `playwright.design.config.ts` | design/verification screenshots | `./scripts/design-screenshots` |
| `playwright.screenshots.config.ts` | store listing shots | `./scripts/store-screenshots` |
| `playwright.video.config.ts` | promo video | `./scripts/promo-video` |

The design config is the right one for Phase 4: chromium only, `workers: 1`, `timeout: 300_000`,
`reporter: 'line'`, `reuseExistingServer: true`.

## Running things

```bash
# a scratch verification script under scripts/design-screenshots/
npx playwright test -c playwright.design.config.ts
npx playwright test -c playwright.design.config.ts --grep "<title>"

# the real suite, when the change plausibly touched a covered journey
npx playwright test --project=chromium
npx playwright test e2e/specs/<spec>.spec.ts --project=chromium
npx playwright test -g "<test title>" --project=chromium

# watch it happen
npx playwright test -c playwright.design.config.ts --headed
```

The main config's `webServer` auto-starts `npm run dev` on `http://localhost:5173` and reuses an
already-running server locally, so there is usually no need to start the dev server by hand. The Vue app is
5173; the Astro marketing site is `npm run dev:web` on 4321 and no Playwright config targets it.

Artifacts land in `test-results/` (`screenshot: 'only-on-failure'`, `trace: 'on-first-retry'`,
`video: 'retain-on-failure'`), HTML report in `playwright-report/`. Both gitignored.

## Screenshots

```ts
await page.screenshot({ path: `screenshots/${name}.png` });
```

`screenshots/` and `scratch-shots/` are gitignored — they are rendered artifacts, and anything worth keeping
belongs on Drive, not in the repo.

**Then actually read the image back.** A screenshot that was captured and never opened proves nothing, and
saying "verified visually" on the strength of a file existing is the kind of overstatement that retires a
question in greg's head while the defect is still there. This project has no visual-regression setup — no
`toHaveScreenshot`, no golden images — so a human (or your own eyes on the image) is the only comparator.

## What to cover

Drive the plan's `## Acceptance Criteria`, as a person would:

- **The happy path**, clicked through rather than asserted at.
- **Both themes.** Toggle to dark on every surface the change paints. Most dark-mode defects in this project
  are a painted background with no dark partner or an accent with no `-lift`, and both look fine in light.
- **Phone width (~400px).** Resize and look. A large share of this project's UI bugs are mobile-only — panels
  under the notch, pickers with no height, text that wraps into nothing.
- **Large reading mode** if the change added text sizing, since it depends on everything being rem-based.
- **The empty and error states**, not only the populated one.

Assert on data where you can (`dbHelper.exportData()`), not on DOM counts or copy — ADR-007's rule, and it is
what keeps these checks from breaking on every wording change.

## What cannot be verified programmatically

Put these on the Phase 8 manual list rather than faking or skipping them:

- Real Google OAuth consent, and anything behind a real Drive token
- Native iOS/Android builds, TestFlight, Play tracks
- A genuine second device, or cross-browser storage isolation on iOS (Chrome and Safari have completely
  separate IndexedDB there)
- OS push notifications on a lock screen — `useLocalNotifications` returns early off-native, so web/PWA has no
  notification path at all
- Camera capture on a real device
- Anything involving a payment, a store review, or a third party's UI

For each one, name the device, the steps, and **what a pass looks like**. "Test the invite flow" is not
actionable. "Open the invite link in a private window on your phone; you should reach the pod without being
asked for a password" is.
