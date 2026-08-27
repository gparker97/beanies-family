# Lessons Learned

Patterns and rules to prevent repeated mistakes.

---

## A create-payload reused as an update-payload writes fields the user never touched — and a test that can't distinguish two values proves nothing

**Date:** 2026-08-15
**Context:** Editing one occurrence of a recurring activity (changing only the pickup person) moved the session to the series' start date — overlapping an earlier instance — or hid it entirely. It shipped in `529d2547` (2026-03-09) and ran for five months.

The proximate cause was one line: `ActivityModal.onEdit` seeded the form's `date` from `activity.date` (the **series start**) while the banner directly above it displayed `props.occurrenceDate` (the day the user clicked). The modal showed two different dates and the user only ever saw one. But the line was only reachable as a bug because `buildPayload()` — a **create** payload — was reused verbatim as the **update/override** payload, so `date` was written on every save whether or not it was touched.

That single structural choice produced eight distinct failure modes, two of them proven data loss and one financial corruption:

- A leaked `recurrenceEndDate` landed on the one-off child, and `expandRecurring` applied the end-date cut **before** the `switch (recurrence)` — so a moved session vanished from both its old and new dates.
- A cloned `linkedRecurringItemId` made the child look like a payment owner; since the child is `recurrence:'none'`, the fee sync rewrote the family's **monthly** payment into a one-off and stopped it.
- `splitActivity` and "delete this and all future" both abandoned their override children, leaving ghosts that render in-app but can never sync to Google.

Three further traps surfaced while fixing it:

- **The proximate fix would have shipped a new bug.** Correcting the form's date un-masked a second defect (`confirmReschedule` never preserving `originalOccurrenceDate` on an override child), converting "the session moves" into "the session duplicates". The two had to land in the same commit.
- **The E2E test covering this path could not fail.** `planner.spec.ts` created a series starting **tomorrow** and clicked `.first()`, so the template's start date and the clicked occurrence were the same value. Its sibling asserted `expect(newTemplate.date).toBeTruthy()` — true for any date at all.
- **The unit tests tested a contract the caller never satisfied.** `activityStore.test.ts` asserted `materializeOverride`'s behaviour when passed `{ startTime }` with **no `date` key** — correct, and precisely the case the form never produced.

**Rules:**

1. **Never reuse a create payload as an update payload.** An update must carry only what changed. Use `src/utils/diffPayload.ts` (forms) or an explicit field helper (`src/utils/recurringItemFields.ts`), and remember `automergeRepository.update` keys its delete list off `Object.keys` — a cleared field must be _assigned_ `undefined`, never omitted.
2. **A store action must be safe regardless of caller.** `materializeOverride` re-forces `OVERRIDE_INVALID_KEYS` **after** the caller's overrides for exactly this reason. If correctness depends on every caller behaving, it is not a guarantee — it is a convention waiting to be broken.
3. **When two fields can disagree on screen, one of them is a bug.** A banner showing `occurrenceDate` above a form field holding `activity.date` is a defect the moment it is written, whether or not anything reads it yet.
4. **Write the test so the right and wrong answers are different values.** A fixture where the expected and buggy values coincide (series starts tomorrow, click the first occurrence) is not a test. Pick the _second_ occurrence, and assert the exact date — never `toBeTruthy()`.
5. **Fixing a masked bug un-masks the one beneath it.** Before shipping a fix, ask what the broken behaviour was accidentally compensating for. Here the spurious `originalOccurrenceDate` was hiding a second defect entirely.
6. **When one defect is found in a shared pattern, sweep every other user of that pattern.** The identical shape was live in recurring transactions, including a `recurrenceEndDate` write to a field that does not exist on `RecurringItem` — hidden by an `as any` cast — which made "delete this and all future" on a bill a silent no-op that regenerated forever.

**Postscript — the fix introduced eight regressions of its own, two financial.** A `/code-review max` pass caught them before anything shipped. The worst: adding `linkedRecurringItemId` to the "never inherit" list stripped the id but kept `payFromAccountId`/`feeAmount`, so a split minted a SECOND recurring fee item while the original's kept running — the family billed twice, forever. Three further rules earned the hard way:

7. **"Strip the dangerous field" is not automatically safe — check what the field GATES.** An id is often the difference between _update this record_ and _create a new one_. Removing it while leaving the fields that trigger the write flips an update into a create. Ask "what does the code do when this is absent?", not just "should this be here?".
8. **A blanket strip is the same anti-pattern as a blanket write.** Both ignore user intent. The first pass removed a blanket `recurrenceEndDate` strip on the activity side for exactly this reason, then reintroduced it verbatim in a new transactions helper in the same change. If a field is dropped because it is _usually_ unchanged, pass the original and compare — do not assume.
9. **Mocking the collaborator hides the regression the collaborator would have caught.** The store regression suite mocked `linkedRecurringItem` wholesale, so the double-billing was invisible to it; the E2E assertion passed only because that fixture had no fee. When a test mocks the thing a change is most likely to break, it is not covering that change.

---

## Verify the platform actually ACCEPTS a setting before spending a build on it — and beware green-looking local gates

**Date:** 2026-08-07
**Context:** Two on-device iOS TestFlight bugs were parked with a confident diagnosis and a one-line fix: set `iosScheme: 'https'` in `capacitor.config.ts`. It shipped as build 8 and changed **nothing**, because the setting is **silently discarded**. `CAPInstanceDescriptor.normalize()` (`node_modules/@capacitor/ios/.../CAPInstanceDescriptor.swift:166-176`) accepts a scheme only when `WKWebView.handlesURLScheme(scheme) === false`; `https` is reserved by WKWebView, so the value resets to the default `capacitor`. **The check was a two-minute grep of `node_modules` that nobody ran before dispatching a build.** The assumed `androidScheme`/`iosScheme` symmetry does not exist — Android's `WebViewAssetLoader` supports https, WKWebView cannot.

The real cause turned out to be unrelated: Apple fires Universal Links only on user-initiated **taps**, so an OAuth _redirect_ to one inside `SFSafariViewController` never hands off. Cost: a wasted TestFlight build + reinstall, a false CHANGELOG entry that shipped to `main` claiming the bug was fixed, and a wasted on-device check (below).

Two more traps surfaced in the same session:

- **A proposed on-device discriminator was impossible.** greg was asked to look for a separate "Safari card" in the app switcher to tell whether the app was inside `SFSafariViewController`. It **presents modally inside the host app** and never yields its own card, so that test could not produce evidence either way. The correct tell is whether a **domain is visible in a top bar** — a native `WKWebView` has no URL display. That check settled it in seconds.
- **`npm run security:lint` looked clean while failing.** It runs `eslint .`, picks up `dist/` + `web/dist/` build output, and the stylish formatter dies with `RangeError: Invalid string length` **before printing anything** — exiting non-zero for a reason unrelated to the code. Two CI round-trips were burned before a JSON-formatter re-run found the one real error.
- **`eslint-disable-next-line` applies to the literal next line.** A justification wrapped onto extra `//` lines made the directive target the _comment_ below it, not the code. CI failed again on the "fixed" commit.

**Rules:**

1. **Before spending a live-only build (iOS/Android/TestFlight) on a config or platform setting, read the platform source that consumes it** and confirm the value is accepted, not normalised away. `node_modules/@capacitor/**` is checked in and greppable. iOS is live-only — every iteration costs a build plus a reinstall, so the pre-flight grep is always cheaper.
2. **Never write a CHANGELOG entry claiming a fix works until it is verified.** The build-8 entry ("the app no longer jumps out into a browser") shipped to `main` and was false; it had to be removed the same day.
3. **When asking a human for on-device evidence, verify the observation is physically possible first.** A test that cannot distinguish the hypotheses wastes their time and produces false confidence either way.
4. **Judge a local gate by its exit code AND its output, not by a grep for "error".** A formatter crash, an empty report, or a non-zero exit for an unrelated reason all read as "clean" to a naive grep. If a gate exits non-zero, read the tail before concluding anything.
5. **Keep `eslint-disable-next-line` on ONE line**, justification included (`-- reason`). Anything wrapped silently targets the wrong line.
6. **Build the observability that makes the NEXT failure diagnosable from logs.** The fix shipped `surface: 'native-oauth'` events (`start` → `return_universal`/`return_custom_scheme` → `complete`) specifically so a third blind build is unnecessary: a missing return event, or the wrong transport, names the failure without a rebuild.

---

## Stale branches manufacture false uncertainty — delete on merge, and judge "merged" by content, not commit count

**Date:** 2026-07-22
**Context:** A branch audit found 9 non-`main` branches. Three were trivially merged. Two were not, and both wasted real time:

- **`app-icon-dawn`** — `git rev-list --count main..origin/app-icon-dawn` said **1 unmerged commit**. The app icon had in fact shipped to web _and_ Google Play the day before. It landed on `main` as `983d8731` with the same subject but a different SHA (rebased on the way in), so the count was measuring SHA identity, not content. Comparing file trees settled it: nothing on the branch was missing from `main`.
- **`calendar-drive-parity-p2`** — reported **2 unmerged commits**, and its tip was a commit literally titled _"P2 resume anchor — progress snapshot + exact next steps"_, containing a `git checkout` resume recipe and a **"Do NOT merge P2 to `main` until task #14 is green and Drive auth is live-verified"** gate. Every signal said "interrupted high-risk WIP, handle with care." It was none of those things: P2 **and** P3 had been completed and shipped to prod as `0.9.4R8` on 2026-07-12 via merge `12bfd23f`, with follow-on fixes on top (`d3b1defd`). The merge's parent was `1ae7f9fa`, _not_ the branch tip — work continued past the anchor, got rebased, and merged under new SHAs while the remote ref was never updated or deleted. `git diff main origin/calendar-drive-parity-p2 -- src/services/google/redirectState.ts` was **empty**: byte-identical.

Cost: an end-of-session cleanup turned into a full investigation — reading a 300-line plan, tracing merge parents, diffing trees — to establish that two branches contained nothing. I also initially recommended _keeping_ `calendar-drive-parity-p2` on the strength of its resume-anchor commit, which would have preserved the confusion indefinitely.

**Rules:**

1. **Delete a branch the moment it is merged, superseded, or abandoned — local and remote, in the same breath as the merge.** `git branch -d <name>` + `git push origin --delete <name>`. This project commits straight to `main`, so a surviving branch has no job to do. `main`'s history and the reflog are the safety net; a stale ref is not a backup, it is a decoy. Codified in `CLAUDE.md` § Branch Hygiene.
2. **Never conclude "unmerged" from `git rev-list --count`.** Rebase, squash and amend all change SHAs, so a fully-shipped branch routinely reports unmerged commits. Check **content**: `git diff main <branch> -- <paths>` (empty = identical), `comm -23` over the two file trees (empty = nothing unique), `git merge-base --is-ancestor <sha> main`. Content on `main` means merged, whatever the counts say.
3. **A branch is a terrible place to store intent.** The resume anchor was well-written and completely misleading, because the branch it lived on was frozen while the work moved on. Parked work belongs in `docs/STATUS.md` or a plan's Outcome section — prose that is maintained — and the branch should still be deleted.
4. **Never delete a branch backing an open PR** (`dependabot/**`) — that closes the PR. The one standing exception.
5. **Sweep for stale branches during `/end-session`**, so refs cannot silently accumulate across sessions.

---

## `type-check` + unit tests can be green while the production `vite build` is broken — run `npm run build` before pushing import-graph changes

**Date:** 2026-07-15
**Context:** The 0.9.5R8 resilience fix added a deferred-heal resume-setup navigation that imported `@/router` from `syncStore` (first time syncStore ever pulled the router). `npm run type-check` (vue-tsc) and the full 3881-test Vitest suite both passed, so I committed + pushed to `main`. The **production rollup build** then failed on the pushed SHA: `[vite:build-import-analysis] src/pages/LoginPage.vue (624:9): Failed to parse source... install @vitejs/plugin-vue`. The real cause was a module-graph cycle — `router/index.ts` statically imports `useSyncStore`, and the router lazy-loads pages (`() => import('@/pages/LoginPage.vue')`); adding a syncStore→router edge (dynamic **or** static) tipped vite's import-analysis into parsing a lazy `.vue` as raw JS. The error's reported location (`LoginPage.vue:624`, the `</script>`) and its named file (`docClient.ts`) were both **red herrings** — bisecting by reverting files to the last-good commit and rebuilding is what actually located it (in `syncStore.ts`). Fixed MVO-style: syncStore raises a reactive `needsResumeSetupNav` flag, App.vue watches it and owns `router.replace(...)` — the store never imports the router. Cost: a broken build shipped to `main` + a red Android-APK CI check, caught only because I checked CI before deploying.

**Rules:**

1. **Before pushing any change that touches the import graph — new cross-module imports, dynamic `import()`, store↔router/page edges, barrel re-exports — run the full `npm run build` locally, not just `npm run type-check` + tests.** vue-tsc and Vitest (esbuild transform, per-file) do **not** run rollup's whole-graph import-analysis; only `vite build` does. The deploy gate and the Android-APK job run `vite build`, so a graph break passes every local check and only surfaces in CI (or prod).
2. **Never import the router (`@/router`) into a widely-imported hub module** (`syncStore`, other core stores/services). It creates a cycle with the router's lazy-loaded pages. This is also the MVO-correct boundary: stores orchestrate reactive state, **views navigate**. Hand off via a reactive flag the view watches (mirror `reconnectEscalationPending` / `needsResumeSetupNav`), exactly as App.vue already does. Composables like `usePwaUpdater`/`useQuickAdd` can static-import `router` because they're leaves, not hubs.
3. **When a `vite:build-import-analysis` "Failed to parse... install @vitejs/plugin-vue" error names a `.vue` file at its `</script>` line, treat the location as a symptom, not the cause.** Bisect by `git checkout <last-good-commit> -- <file>` and rebuilding until the break clears — the offending module is the one whose reversion fixes it, not the `.vue` in the message.

---

## Android passkey `[50152] "RP ID cannot be validated"` = the assetlinks needs BOTH relations, not the signing cert — and get device ground-truth before guessing

**Date:** 2026-07-14
**Context:** 0.9.5 shipped a large PRF rebuild for native biometric (#52), but greg's Pixel still failed enable. The `passkey-prf` telemetry surfaced the real error: `create()` throwing **`[50152] "RP ID cannot be validated"`** with zero `prf_enable_result`, so it died at RP-ID validation, upstream of everything the PRF fix touched. I then chased the **wrong** discriminator: I guessed the install was upload-key-signed and **deployed a fingerprint fix (`D1:E7`) that changed nothing** — because the install was actually **Play-signed with `18:76`**, which was already `linked:true`. The cert was never the problem. Only when greg ran `adb logcat`/`dumpsys` on the device did the ground truth appear: signer = `18:76` (correct), error = `[ValidateRpIdOperation] 50152`. The **actual** cause: our `app.beanies.family` assetlinks declared `delegate_permission/common.get_login_creds` **only**; GMS Credential Manager wanted **both** `handle_all_urls` **and** `get_login_creds` (every canonical Google example pairs them). Adding `handle_all_urls` → `50152` gone, `create()` succeeded. Then a **second** wall appeared immediately: Google Password Manager wouldn't complete the **PRF** eval (`enroll_declined: no-prf`) — a known GPM limitation. Net decision: abandon WebAuthn-PRF on native, pivot to `BiometricPrompt` + Keystore (see [[ADR-029]]).

**Rules:**

1. **`50152` on Android is a Digital-Asset-Links problem, but "cert in the file + Google DAL `linked:true`" is NOT sufficient — GMS also wants `handle_all_urls` alongside `get_login_creds` at the RP-ID domain.** Declare both relations in the RP-ID `assetlinks.json`. A green per-cert DAL check can still fail on-device if the relation set is incomplete.
2. **Get device ground-truth (`adb logcat` + `dumpsys package`) BEFORE deploying a fix to a native-only bug.** I burned a prod deploy on an upload-key theory that a 30-second `dumpsys` (signer = `18:76`) would have refuted. Native failures are live-only and cheap to guess wrong about — the logcat error class (`ValidateRpIdOperation` vs a PRF/wrap failure) and the real signing cert each rule out whole branches. This is [[get-cheapest-discriminating-observation]]: the cheapest discriminator here was on the _device_, not in the DAL API, and I should have gotten it first.
3. **`webauthn.io` in Chrome on the device is the clean "is it us or the device/provider?" test** — if it creates a passkey, the device + GPM are fine and the bug is 100% your config.
4. **WebAuthn-PRF on Android GPM is fragile (RP-ID relations, GPM PRF gaps, multi-day GMS DAL caching).** For "gate/derive a local key behind a fingerprint," `BiometricPrompt` + Android Keystore is the standard, dependency-free mechanism; reserve WebAuthn-PRF for the web/PWA surface where it actually works.

---

## Get the cheapest discriminating observation before proposing a mechanism

**Date:** 2026-07-09
**Context:** Investigating the Google Drive reconnect loop, five successive root causes were asserted with high confidence and each was refuted by one cheap observation: (1) "the worker migration wiped the token" — refuted by reading which IndexedDB databases the migration actually touches; (2) "an account-email mismatch wiped it" — refuted by one `grep` of the user's console log for `[accountAssertion]`, and built on a misread of `family_email` (the family owner's profile email) as `member.googleAccountEmail`, two unrelated fields; (3) "Testing-mode 7-day refresh-token expiry" — refuted by one glance at the OAuth publishing status; (4) "unapproved sensitive scope" — refuted by a tooltip on the same console page; (5) "unregistered `drive.file` scope" — refuted by re-consenting and observing no unverified-app warning. The previous session's `/error-review` made the same mistake, committing "dead Google grants (testing-mode 7-day token expiry)" to `STATUS.md` as settled fact; that note then became this session's starting hypothesis and cost hours.

Each refutation was available _before_ the hypothesis was voiced, and cost seconds to obtain.

**Rule:** For a production incident, before proposing _any_ mechanism, enumerate the candidate causes and identify the single cheapest observation that distinguishes them — then go get that observation. Prefer a `grep` of the user's log, a DevTools key lookup, or a console screenshot over a code-reading argument, however elegant the argument. State hypotheses as hypotheses, each with its discriminating test attached, never as conclusions. Write findings into `STATUS.md` with the evidence that supports them, so a future reader can tell a measurement from a guess.

**Corollary — treat telemetry suppression as a suspect, not a given.** When a code path silently swallows a signal "because it's by design", verify the suppression can actually tell the by-design case apart from the incident it would hide. Here it could not: the revocation path _clears_ the refresh token, so the "no token stored" branch swallowed both a never-connected user and a live revocation, and the resulting biased sample is what made the bug invisible for a week and misdirected two investigations.

---

## Stop a background dev server with TaskStop + its task_id — never a broad `pkill`

**Date:** 2026-07-08
**Context:** Asked to kill the Astro dev server I'd started on port 4322, I ran `pkill -f "astro dev"`. That pattern matched **every** astro dev process — including greg's own server on 4321 — so I took both down. `kill %1` also doesn't work: a harness `run_in_background` task is not a shell job, so `%1` targets nothing.

**Rule:** To stop a server I launched with `run_in_background: true`, call **`TaskStop` with the specific `task_id`** (returned when the task started). Never use `pkill -f "<generic-name>"` to stop one process when others of the same kind may be running — it's a blast-radius footgun that hits the user's own processes. If a shell-level kill is truly needed, target the exact PID bound to the port (`ss -ltnp | grep :<port>`), not a name pattern.

---

## Keep local `node_modules` in sync with the pinned toolchain (esp. prettier) before committing

**Date:** 2026-07-08
**Context:** During the `0.9.4R1` deploy, `package.json` pinned `prettier ^3.9.4` but local `node_modules` still had `3.8.3` (the dependabot bump merged but was never `npm install`ed locally). The commit-time lint-staged hook ran the stale 3.8.3, formatting files that CI's fresh 3.9.4 rejected — burning **two CI rounds** (`googleCalendarClient.ts`, then pre-existing drift in `docs/STATUS.md`).

**Rules:**

1. If CI fails on `prettier/prettier` or `format:check` but local `npm run lint` is clean, **suspect a prettier version mismatch first**: compare `cat node_modules/prettier/package.json | grep version` against the `package.json` pin. Run `npm install`, then reformat with `npx prettier --write` (now the pinned version) and re-verify with `npm run format:check` across the whole repo before pushing.
2. **Never commit the `package-lock.json` churn** that a local `npm install` produces from a differing npm version — it's the known spurious `libc`-field deletion (see the 2026-06-30 dependabot note). `git checkout package-lock.json` after installing; stage only the real source/format fixes.

---

## Feature-gate ONLY by request — and surface every gate in the Settings admin

**Date:** 2026-06-14
**Context:** Implementing the Discord-first invite gate, I gated the new Discord CTA on `features.marketingUrl` without being asked to gate anything. That flag is `ok(VITE_MARKETING_URL)` (env-var presence), which is set in neither local dev nor `deploy.yml`, so the CTA was hidden in **dev and prod** — the feature looked unshipped.

**Two distinct systems (do not conflate):**

- `src/config/features.ts` — **env-capability detection** (e.g. `slackInvite = ok(VITE_INVITE_WEBHOOK_URL)`: "is this wired?"). Not a toggle; not in Settings. A capability check a feature genuinely cannot work without is fine.
- `src/config/flagRegistry.ts` + `featureFlags.committed.ts` — the **runtime DevFlag** system that renders in the dev-only Settings → Feature Flags card (#31). This is what "the feature flags section in settings" means.

**Rules:**

1. **Do not add a feature gate unless explicitly asked.** No ask → ship ungated. Don't invent capability gates a feature doesn't need (the Discord redirect resolves via `MARKETING_URL`'s built-in fallback — it never needed `VITE_MARKETING_URL`).
2. **If a feature IS gated (by request) via a DevFlag, register it in `flagRegistry.ts` (+ committed state in `featureFlags.committed.ts`) in the same change**, so it appears and is toggleable in the Settings admin. A gate greg can't see or flip is worse than no gate.

## Default GitHub Actions config items to **variables**, not secrets

**Date:** 2026-04-14
**Context:** Writing the `deploy-web.yml` workflow for the Astro marketing site cutover — initially used `${{ secrets.WEB_S3_BUCKET }}` and `${{ secrets.WEB_CLOUDFRONT_DISTRIBUTION_ID }}` by copying the pattern from the legacy `deploy.yml`.

**Pattern:** Mis-classifying non-sensitive config as secrets means:

- The value cannot be viewed or edited in the GitHub UI (secrets are write-only after creation)
- Any correction requires deleting + recreating the secret
- Teammates can't discover what the workflow is actually pointing at without reading Terraform output or AWS

**Rule:** **Use `secrets` only if leaking the value enables an attack you couldn't otherwise perform.** For everything else, use repository `variables`.

| Sensitive (secrets)                  | Not sensitive (variables)            |
| ------------------------------------ | ------------------------------------ |
| AWS access keys                      | S3 bucket names                      |
| API client secrets (OAuth, Stripe …) | CloudFront distribution IDs          |
| Database passwords                   | Region names, account IDs¹           |
| Webhook signing keys                 | Lambda function names, table names   |
| Private API keys                     | Domain names, workflow feature flags |

¹ Account IDs are debatable — treat as public by default unless your org's threat model says otherwise.

**Reference in workflows:** `${{ vars.NAME }}` for variables, `${{ secrets.NAME }}` for secrets.

**Migration:** if something is already stored as a secret but is non-sensitive, delete it and re-add as a variable (GitHub UI: Settings → Secrets and variables → Actions → Variables tab).

---

## E2E: Wait for async step transitions before manipulating state

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

## 12. Always check the current state of the app before performing work

**Date:** 2026-03-01
**Context:** RecurringItemForm still used old BaseInput/BaseSelect/BaseButton pattern while all other modals had been refactored to BeanieFormModal. New work (ToggleSwitch addition) was built on top of the outdated component without noticing it needed modernization first.

**Pattern:** When given a plan that modifies a specific component, it's tempting to jump straight in and make the planned changes. But the component may have fallen behind a project-wide refactoring wave (e.g., a modal redesign that touched 6 modals but missed one). Building new features on top of outdated code bakes in the inconsistency.

**Symptom:** The "edit recurring" modal looked completely different from the "add transaction" modal — old-style dropdowns and buttons vs. modern chips, pill toggles, and styled inputs. The user perceived it as a reversion.

**Rule:** Before modifying any component, check that it follows the **current** patterns used elsewhere in the app:

1. Open the file and compare its imports/structure against sibling components (e.g., does this modal use `BeanieFormModal` like other modals?)
2. If it uses outdated patterns (old component library, deprecated wrappers, missing composables), modernize it first or flag the discrepancy
3. Never assume a component is up-to-date just because it works — compare against the canonical pattern (e.g., `TransactionModal.vue` for form modals)
4. When a plan references a file to modify, treat "read and verify current state" as step zero

## 13. Dual-state desync: syncStore vs syncService family key

**Date:** 2026-03-10
**Context:** Data loss after tab idle/sleep — saves silently failing with "no family key or envelope"

**Pattern:** The family encryption key exists in TWO places: `syncStore.familyKey` (Vue shallowRef) and `syncService.currentFamilyKey` (module-level variable). The syncStore ref is used for decryption (reads), the syncService variable is used for encryption (writes, cache). If any code path clears the syncService variable without clearing the store ref, reads succeed but all writes silently fail — data appears to work but is never persisted.

**Root cause:** `SettingsPage.vue` called `syncStore.initialize()` on every mount. `syncService.initialize()` calls `reset()` which wipes `currentFamilyKey`. The syncStore Vue ref was NOT cleared. File polling read and decrypted successfully (using the Vue ref), but saves, IndexedDB cache writes, and save-on-hide/unload all failed (using the cleared service variable). On page refresh, all unsaved data was permanently lost.

**Compounding factor:** `loadFromFile()` only called `syncService.setEnvelope()` after decryption — it never called `syncService.setFamilyKey()`. So even when polling read the file every 10 seconds, the missing service key was never restored.

**Rule:**

1. **Never re-initialize sync when already active** — `syncService.initialize()` must skip `reset()` if the key/provider/family are already valid for the current family
2. **Always sync both key locations** — any path that decrypts with `familyKey.value` must call `syncService.setFamilyKey()` (not just `setEnvelope()`) to keep the service in sync
3. **Save handlers must recover from desync** — `beforeunload` and `visibilitychange` → hidden handlers should restore the service key from the store ref before saving
4. **Broader principle:** When the same state is mirrored in two locations (Vue ref + module variable), every mutation path must update both. Silent divergence causes data loss that's invisible until refresh

## 14. Beanie mode text must stay intuitive — fun but never cryptic

**Date:** 2026-03-23
**Context:** "counted a bean" was the beanie-mode override for "completed a task" — too cute, meaning lost

**Pattern:** Beanie mode (`beanie` values in `uiStrings.ts`) uses playful, lowercase language as a cosmetic overlay. But some overrides deviate so far from the original meaning that users can't understand what happened. "counted a bean" in the activity feed gave no indication it meant a task was completed.

**Rule:** Beanie-mode text should be fun and on-brand but NEVER sacrifice clarity for cuteness:

1. The beanie override must be immediately understandable without seeing the `en` version
2. If a user seeing only the beanie text can't tell what the action/item is, the override is too abstract
3. Good: "add a beanie" (for "Add Member"), "counting beans..." (for "Loading...")
4. Bad: "counted a bean" (for "completed a task") — what bean? what count?
5. When in doubt, keep the beanie text close to the English meaning with lowercase styling only

## 15. E2E: a stale warm dev server gives false-green — repro against a fresh server

**Date:** 2026-06-29
**Context:** E2E was red on CI since the 2026-06-26 create-flow rework (`b1a842fe`). Locally the tests "passed" with `--workers=1`, which led to a wrong contention diagnosis and a first fix (`workers=1`) that didn't fix CI at all.

**Pattern:** `playwright.config.ts` has `reuseExistingServer: !process.env.CI`. A dev server left running from an earlier session (`npm run dev`, port 5173) is reused by local Playwright — and it can be serving **stale code** (old modules HMR never picked up, or started before the change under test). The local suite passed against old code while CI (fresh server, current code) failed. This sent the whole diagnosis down a false "concurrency contention" path. The real cause only surfaced after killing the stale server and forcing Playwright to start a fresh one — then the on-screen error ("We saved your pod, but couldn't reach our family registry") revealed the actual root cause: the rework promoted `createNewFile`'s registry write to a critical throwing step, and E2E points the registry at `e2e.registry.invalid`.

**Rule:**

1. **When local E2E disagrees with CI, suspect the dev server first.** Kill any process on :5173 and re-run so Playwright boots a fresh server (`reuseExistingServer` only applies when CI is unset).
2. **Read the failure screenshot/`error-context.md` before theorizing.** The page snapshot showed the exact blocking error message — it would have pointed straight at the registry on the first look, before the contention rabbit-hole.
3. **A fix that's green locally but still red on CI means the local repro was invalid** — don't push-and-pray; reproduce the CI failure locally first (fresh server, CI-parity worker count).
4. **When the app gates a flow on an external service (registry/Drive/API), the E2E harness must mock that service** — don't rely on "the wizard exits before it's reached"; that assumption rots when flows change. See `e2e/helpers/registry-mock.ts`.

## 16. A markdown-only fix commit skips CI — and the deploy gate hard-fails on it

**Date:** 2026-07-22
**Context:** During `/deploy-prod-auto` for the app-icon change, CI failed on `Check formatting`. The cause was upstream: the icon commit was rebased onto a moved `main`, and **resolving a conflict during a rebase bypasses the lint-staged prettier hook** — `git add` + `git rebase --continue` runs no hooks, so a malformed CHANGELOG.md sailed into the commit that `git commit` would have auto-fixed.

The fix commit touched only `CHANGELOG.md`. Both `main-ci.yml` and `security.yml` carry `paths-ignore: ['*.md', 'docs/**', ...]`, so **neither workflow ran for the new HEAD**. `deploy.yml`'s gate then refuses to deploy: it looks for a CI run matching the HEAD sha and errors with "No Main Branch CI run found for commit $SHA" when there is none. The deploy is blocked not by a failure but by an absence.

**Rule:**

1. **After resolving a rebase conflict, run the formatter before `git rebase --continue`.** Hooks do not run during a rebase. `npx prettier --check <file>` on anything you hand-edited is the cheap guard.
2. **If a deploy's final commit touches only markdown, expect no CI run.** Dispatch both gates manually — `gh workflow run main-ci.yml --ref main` and `gh workflow run security.yml --ref main` — before `deploy.yml`. A dispatched run is attributed to the branch HEAD, so the gate's `--commit=$SHA` lookup finds it.
3. **Don't reach for `skip_gate`.** It exists for config-only changes verified locally; using it to route around a missing CI run deploys code that was never checked.

## 17. Syncing a Notion post to the repo: parse rich-text annotations + hrefs, never `plain_text`

**Date:** 2026-08-14
**Context:** While regenerating blog #8 ("me, myself, and AI") from its Notion row, the extraction script printed only each rich_text run's `plain_text`. That flattens away everything Notion stores as annotations or link metadata. Two inline links greg had added — one on "beanies.family" (utm-tagged homepage) and a spoke link on "clear the context window" (→ the family-scrapbook post) — were silently dropped, along with seven `_claude-bot_` italics and one `_everything_`. The post shipped and deployed to prod before greg caught the missing homepage link; a second sweep (this time reading annotations) found the rest. It took three follow-up commits + two redeploys to fully repair what one correct parse would have carried through cleanly.

**Pattern:** A Notion paragraph's `rich_text` is an array of runs, each carrying `plain_text` **plus** `annotations` (`bold`/`italic`/`code`/`strikethrough`/`underline`) and `href` (also reachable via `text.link.url`). Reading `plain_text` alone loses all formatting and every hyperlink with **no error** — the text still looks complete, so the loss is invisible until a human notices a link or emphasis is gone. Captions on `image` blocks are `image.caption[]` (same run shape) and are just as easy to miss.

**Rule:**

1. **When converting Notion blocks to markdown, render every run, not its `plain_text`.** For each run: wrap in `**…**` if `annotations.bold`, `_…_` if `annotations.italic`, `` `…` `` if `annotations.code`, and `[…](href)` if `href`/`text.link` is set. Compose them (a run can be both italic and a link).
2. **After a sync, grep the built HTML for `<a href` and `<em>`/`<strong>` counts and reconcile against the Notion source** before calling it done — a plain-text parse passes the build cleanly, so the build is not the check.
3. **The Notion MCP write API cannot set annotations** (`API-update-a-block`'s `richTextRequest` has no `annotations` field — it 400s). So a formatting fix that must live in Notion (golden source) has to be done by hand there; the skill can only fix the repo copy and must flag the one-click Notion toggle to keep them in sync.
4. This is the blog-sync analogue of the beanie-mode/i18n discipline: the failure is a **silent** one, and silent content regressions are the ones that reach readers.

## 18. A review finding below the ship-blocker cut is still a finding

**Date:** 2026-08-24
**Context:** The first `/code-review max` on #70 returned 15 findings plus a "cut for the cap" list. Greg picked the ship-blockers + correctness scope, so the cut list was left unactioned. One of those cut items was that `ActivityModal` had silently changed the default recurrence for new activities from weekly to monthly by adopting the shared `RecurrencePicker`. CI caught it as an E2E failure a commit later. The same pattern repeated within the session: several items "cut for the 15-item cap" on the #71 review turned out to include a real correctness bug (a template printing `factor-of-0.3` on a negative gap).

**Pattern:** Scoping a review's _fixes_ is a legitimate call about effort. Skipping a review's _triage_ is not. The cap is a presentation limit — it says "these fifteen were the most severe," not "the rest are noise." Treating the cut list as out-of-scope means the reviewer's cheapest, already-paid-for work gets thrown away, and the defects surface later as red CI or, worse, as production behaviour nobody connects back.

**Rule:**

1. **Read the below-the-cap list every time, even when the agreed scope is narrower.** Classify each item: fix now, file explicitly, or discard with a reason. Never leave it unread.
2. **Behaviour changes hidden inside a refactor are the highest-value items in that list** — a changed default, a dropped guard, an altered ordering. They pass type-check and unit tests precisely because nothing asserted the old behaviour except the code itself.
3. **When a scope decision excludes a finding, say so in the summary** so it is a recorded decision rather than something that quietly evaporated.

## 19. "I searched and found nothing" is worthless until you know the tree is current

**Date:** 2026-08-26
**Context:** Greg asked why his three new Plausible CTA goals were empty. I searched `web/` exhaustively — grep for `plausible-event`, `data-cta`, `cta_click`, `git log --all -S` across every branch, a clean `git status`, "only branch is `main`" — and concluded, with a lot of supporting evidence, that the tracking had never been implemented and that a previous session had claimed otherwise in error. Every one of those searches was sound. The checkout was **53 commits behind `origin/main`**. The feature was implemented, correct, and already deployed. Only Greg's "can you just check once more" caught it, and the thing that actually settled it was fetching the live production HTML, which had the attributes my source tree did not.

**Pattern:** A negative result is a claim about the search space, not about reality. I treated "clean working tree, one local branch" as proof the tree was current — but both are true of an arbitrarily stale checkout, and `git log --all` only spans refs that have been fetched. The confidence was manufactured by breadth: many independent searches agreeing with each other, all reading the same stale bytes. Worse, the wrong conclusion was actively expensive — it told Greg a colleague's work did not exist and would have led to rebuilding a feature that was already live.

**Rule:**

1. **`git fetch` before concluding that code is absent.** Any answer of the form "X was never implemented" / "that code does not exist" / "nothing does Y" requires a current tree first. Cheap, and the only thing that makes the negative meaningful.
2. **Check `git log HEAD..origin/main` when a user contradicts a code-based finding.** Being behind is a top-three explanation for "the user says it exists and I cannot find it," alongside a wrong search term and a different repo — check it before defending the conclusion.
3. **Prefer the deployed artifact when the question is "is this live?"** Fetching production HTML answers directly what source-grepping only answers by inference, and it is immune to checkout staleness. Confirming a claim about production against a source tree is one hop too many.
4. **Breadth of search is not freshness of search.** Ten greps over stale bytes agree with each other perfectly. When many searches converge suspiciously cleanly against a user's direct recollection, suspect the corpus, not the user.

## Never hand greg prose to copy out of the terminal

**Pattern:** the Substack cross-post copy was about to be printed as terminal text for
greg to copy/paste. He stopped it: "usually whenever i copy something from the terminal,
it never pastes properly".

**Why it breaks:** a terminal pane re-wraps long paragraphs to its own width, and those
wrap points are copied as real newlines. A five-paragraph post lands in the target editor
as forty ragged ones, and the formatting (links, bold, italics) is gone entirely because
a terminal only ever holds plain text.

**Rule:** deliverable prose that is destined for another editor gets published as an
**Artifact** with a copy button writing BOTH `text/html` and `text/plain` via
`ClipboardItem`. Rich-text targets (Substack, Notion, Google Docs, Gmail) read the
`text/html` flavour, so formatting survives and nothing is re-done by hand. Always
include the `text/plain` flavour too, and fall back to selecting the payload node if the
clipboard API is blocked.

Codified in `.claude/skills/beanies-blog/SKILL.md` § 7.
