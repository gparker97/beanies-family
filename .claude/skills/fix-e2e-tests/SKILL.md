---
name: fix-e2e-tests
description: Diagnose and fix failing Playwright E2E tests end-to-end — pull the failing CI logs (the `E2E Tests` GitHub Actions workflow), correlate against recent commits, decide whether each failure is a real product bug / test drift / flake, apply a structural fix, cull or consolidate tests that violate ADR-007, then run and re-run until every browser is green. Use whenever greg says the e2e tests are red/broken/failing, asks to fix or investigate E2E or Playwright failures, mentions a failing `E2E —` CI job or the `run-e2e` label, pastes a Playwright failure, or invokes `/fix-e2e-tests` — especially after development work, since that's when E2E breaks most.
---

# fix-e2e-tests — E2E Failure Triage & Repair

E2E tests break most often right after feature work: a selector drifts when copy changes, a new modal step shifts a flow, a store mutation changes what lands in IndexedDB. Left unfixed they erode trust in the suite until people start ignoring red — the worst outcome, because then a real regression sails through. This skill is the standardized loop for taking the suite from red back to all-green, the right way: **find the truth behind each failure, fix the root cause (not the symptom), keep the suite within its ADR-007 guardrails, and don't stop until it actually passes.**

The project has hard-won E2E conventions — the Three-Gate Filter, the 25-test budget, "assert data not DOM", no `waitForTimeout`, and a running health journal. This skill enforces them rather than reinventing them. Read `docs/adr/007-testing-strategy.md` once at the start if you haven't this session; it is the source of truth for what a good E2E test is.

---

## When to Invoke

- **Via slash command**: `/fix-e2e-tests` (optionally with a CI run URL/ID, a branch, or a spec name)
- **Proactively**: when greg says "the e2e tests are failing", "e2e is red", "fix the Playwright tests", "the E2E job broke on my PR", pastes a Playwright error/trace, or mentions a failing `E2E — chromium` / `E2E — webkit` job. Especially offer it right after a feature lands, since that's the highest-failure moment.

---

## The exit bar (read this first — it shapes everything)

**Done means every browser the suite runs is green: Chromium AND WebKit.** Not "chromium passes and webkit is probably flaky." The whole point of the loop is to leave the suite trustworthy.

That bar is demanding because WebKit has a long tail of CI-contention flakes (see `references/failure-patterns.md`). Two disciplines make all-green achievable instead of an infinite loop:

1. **Fix the structure, never pad the clock.** A `waitForTimeout` or a bumped timeout hides a race; it doesn't fix it. Every recurring webkit failure in this project has had a *structural* fix (a readiness gate, a modal-ordering change, a navigation retry helper). Reach for those first — they're cataloged in the references.
2. **Quarantine is the documented last resort, not an escape hatch.** ADR-007 says a test logged as a flake more than ~5–6 times with no viable structural fix may be skipped on the offending browser (`test.skip(browserName === 'webkit', ...)`) with a logged justification. Only propose this when (a) you've applied the known structural fix and it still fails, AND (b) the health log shows it's a chronic, already-understood webkit flake at/over that threshold. **Quarantining needs greg's explicit approval** — surface it as a recommendation with evidence, don't do it silently. A quarantined test still counts as "green" for exit only once it's logged and approved.

---

## Workflow

### Step 0 — Orient

```bash
git branch --show-current && git status --short
```

Note the branch and whether the tree is clean. A dirty tree is fine here (you're often mid-feature) — just be aware of what's uncommitted, since it's the prime suspect for a fresh failure. Read `docs/adr/007-testing-strategy.md` if you haven't already this session.

If greg handed you a specific CI run, PR, or spec, scope to that. Otherwise default to "the latest E2E failure on this branch / on main."

### Step 1 — Locate the failure (GitHub CI first)

The most common entry point is a red CI job. Pull the truth from GitHub before touching code.

```bash
# Recent runs of the E2E workflow (file: .github/workflows/e2e.yml, name: "E2E Tests")
gh run list --workflow=e2e.yml --limit 10
# Drill into a run — the matrix jobs are named "E2E — chromium" / "E2E — webkit"
gh run view <run-id>
# The failing step log, trimmed to failures
gh run view <run-id> --log-failed
```

Download the artifacts — they contain the trace, screenshots, and video that explain *why*:

```bash
# HTML report per browser (artifact names: playwright-report-chromium / -webkit)
gh run download <run-id> -n playwright-report-chromium -D /tmp/e2e-report-chromium
# Failure videos (artifact names: test-videos-chromium / -webkit), 7-day retention
gh run download <run-id> -n test-videos-chromium -D /tmp/e2e-videos-chromium
```

Open `index.html` from the report to read the trace (network, console, DOM snapshots at each step). If the run's artifacts have expired (14-day report / 7-day video retention) or greg is working locally, reproduce locally instead — see Step 3.

Extract, for each failing test: the **spec file + test title + line**, the **failing action/assertion**, the **error class** (timeout, strict-mode violation, navigation-interrupted, assertion mismatch), and **which browser(s)** failed. Whether a failure is chromium-too or webkit-only is the single biggest clue — webkit-only points at the contention-flake catalog; chromium-too points at a real product/test bug.

### Step 2 — Correlate with recent changes

A test that was green yesterday and red today almost always has a culprit in the diff. Find it:

```bash
# What changed recently across the app + the specs
git log --oneline -15
# Did the failing spec, its helpers, or the feature it exercises change?
git log --oneline -10 -- e2e/ src/<area-the-test-touches>/
# The actual diff of a suspect commit
git show <sha> --stat
```

Cross-check the failure against the change. Classic correlations:
- **UI copy changed** → a `getByText`/`getByRole({name})` selector no longer matches (test drift).
- **A modal/step was added to a flow** → the test walks an outdated path (test drift, sometimes a real UX regression).
- **A store/CRDT mutation changed** → the IndexedDB export assertion now sees different data (could be a real bug *or* an intended change the test must follow).
- **Nothing in the diff touches this area** and it's webkit-only → likely a contention flake (Step 4 confirms).

### Step 3 — Reproduce and gather evidence locally

```bash
# Single spec, one browser, watch it happen
npx playwright test e2e/specs/<spec>.spec.ts --project=chromium --headed
# Or the interactive runner (filter to the one test, step through)
npm run test:e2e:ui
# A single test by title
npx playwright test -g "<test title>" --project=webkit
```

For webkit issues specifically, run the failing test a few times — `--repeat-each=5 --project=webkit` — to distinguish a hard failure (fails every time → real) from a flake (passes sometimes → contention). Capture the trace on failure and read it; the DOM snapshot at the failing step usually shows whether the element was absent, hidden, or duplicated.

`references/setup-reference.md` has the full command set, the helper/fixture API (`IndexedDBHelper`, `gotoRoute`, `bypassLoginIfNeeded`, `ui()`, the page objects), the `window.__e2eDataBridge` hooks, and the exact CI matrix logic. Read it when you need a command or helper you don't already know.

### Step 4 — Classify each failure, then fix the root cause

Every failure resolves to one of three categories (these mirror the `E2E_HEALTH.md` log):

**(a) Real product bug** — the app genuinely broke; the test correctly caught it. Fix the *app code*, not the test. This is the best outcome — the suite did its job. Verify the test goes green against the fix without weakening the assertion.

**(b) Intentional change** — the app behavior changed on purpose and the test is asserting the old reality. Update the test to match the new truth (selector, flow steps, expected data). Never loosen an assertion just to get green — re-point it at the new correct value. If the change means the user journey itself is different, make sure the test still exercises a *meaningful* journey, not a hollowed-out shell.

**(c) Flake** — the test and the app are both correct; the failure is timing/contention (overwhelmingly webkit-under-CI). **Do not paper over it with `waitForTimeout`.** Apply the structural fix for its pattern:
- Navigation interrupted (`page.goto` beaten by an SPA redirect) → use `gotoRoute()`/`gotoRoot()` (retries on the interrupt with `waitUntil: 'commit'`).
- Modal-to-modal transition timeout → close the first dialog and `await nextTick()` before opening the next; gate on the heading being visible (`dismissActivityCreatedConfirm` pattern).
- Pre-mounted (`v-show`) element with a strict-mode/visibility timeout → wait on a stronger readiness signal and `.filter({ visible: true })` to disambiguate the visible node.
- Copy-dependent selector that drifts → migrate to `data-testid` or resolve copy through `ui('key')` instead of hardcoding English.

`references/failure-patterns.md` is the catalog of every recurring failure shape this project has seen, each with its symptom, root cause, and the exact structural fix + code location. **Read it before inventing a fix** — the odds are high your failure is already a known pattern with a proven remedy.

Selector hierarchy when you touch one (most stable first): `data-testid` → `getByRole({name})` → `getByLabel` → `getByPlaceholder` → `getByText` (last resort, and prefer `ui('key')` over a hardcoded string so a copy change doesn't break it again).

### Step 5 — Audit the suite against ADR-007 (cull / consolidate — propose first)

While you're in the specs, look for tests that no longer earn their place. This keeps the suite lean and the budget honest. Flag a test for removal or consolidation when it:
- **Fails the Three-Gate Filter** — not a business-critical outcome, OR a unit test could cover it, OR it can't run without `waitForTimeout`/copy-brittle selectors.
- **Tests its own mocks** — only asserts that `page.route()` returned the mock.
- **Duplicates** another test's journey with no distinct data outcome (consolidate the pair).
- **Pushes the suite over the 25-test budget** — adding one means retiring a weaker one.
- **Is a chronic flake** logged (b)/(c) more than twice with no structural fix left to try (ADR-007's cull threshold).

**Removal and consolidation are destructive and judgment-heavy — always propose before acting.** Present a short list: each candidate, which gate/rule it fails, and your recommendation (remove vs. consolidate-into-X). Wait for greg's go-ahead before deleting or merging any test. Don't bundle silent deletions into the fix pass.

### Step 6 — Run until every browser is green

This is the loop that satisfies the exit bar. Work from fast/cheap to full:

```bash
# 1. The spec you fixed, both browsers
npx playwright test e2e/specs/<spec>.spec.ts --project=chromium
npx playwright test e2e/specs/<spec>.spec.ts --project=webkit
# 2. The full suite, chromium (the deploy-critical lane)
npm run test:e2e:chromium
# 3. The full suite, webkit
npm run test:e2e:webkit
```

For a long run you want to watch without re-reading the whole log, use the **Monitor** tool with an `until`-loop or a result-streaming poll so you're notified when it finishes or when a failure line appears — but **verify `jq`/tools exist in the monitor's shell** (its environment can differ from your interactive shell; a missing binary makes the monitor spin silently). When in doubt, prefer a `run_in_background` Bash command that exits on completion, or just run the suite in the foreground and read the summary.

Loop: a failure → back to Step 4 for that test → fix → re-run. Keep going until both `--project=chromium` and `--project=webkit` report all-pass. A test that only fails intermittently isn't done — run it `--repeat-each=5` to confirm the structural fix actually held before you call it green.

**The only sanctioned way to exit with a still-failing webkit test** is the quarantine path from "The exit bar" above: known chronic flake + structural fix exhausted + at/over the cull threshold + **greg approved** + logged in `E2E_HEALTH.md`. Otherwise, keep fixing.

### Step 7 — Log every outcome in `docs/E2E_HEALTH.md`

The health journal is what makes the suite self-correcting — it's how a third recurrence of the same flake becomes a decision to cull. Append a row for each failure you handled, matching the existing table format (`| Date | Test | Category | Notes |`):
- **Date** ISO (`YYYY-MM-DD`), **Test** as `spec.spec.ts:line` (list multiple for a shared flake), **Category** `(a)`/`(b)`/`(c)` (combine like `(a) + (c)` when one run revealed both).
- **Notes**: what broke (with the error), the root cause, the fix applied (link the commit/helper), verification (which browsers passed after), and a cross-reference if it's a recurrence of an earlier entry. Match the depth of the existing entries — they're a real diagnostic record, not one-liners.

If you culled/consolidated/quarantined any test in Step 5/6, record that here too with the rationale.

### Step 8 — Commit, push, and report back

Once the suite is genuinely all-green (Step 6 satisfied), commit and push the fix — don't leave a green suite uncommitted. Follow the project's normal commit/push rules:
- Branch first if you're on `main` and the change warrants it (per the repo's git conventions).
- Update `CHANGELOG.md` if the fix changes user-facing behavior (a real product-bug fix often does; pure test-harness fixes usually don't — use judgment).
- Let the pre-push hooks run (never `--no-verify`).
- Use a clear `test(e2e):` / `fix:` message describing the root cause, and the project's standard commit trailers.
- **Stop short of deploying.** Committing the fix and deploying to prod are separate decisions — never trigger a deploy unless greg explicitly asks (project rule).

Then give greg a tight summary:
- **Failures handled**: per test — category (a/b/c), root cause in one line, fix applied.
- **Suite status**: chromium X/X green, webkit Y/Y green (or "webkit Z quarantined — approved, logged").
- **Cull/consolidate**: what was removed or merged (only what was approved), new test count vs. the 25 budget.
- **Health log**: confirm the entries were added.
- **Committed & pushed**: the commit SHA / branch (or note if you intentionally held off and why).
- **Loose ends**: anything you couldn't fully resolve and why.

---

## Rules

- **Root cause, never symptom.** No `waitForTimeout`, no blanket timeout bumps to "make it pass." Every fix should explain *why* the test now passes. The references catalog the structural fixes — use them.
- **Don't weaken assertions to get green.** Re-point an assertion at the new correct value (category b); never delete the check or loosen it into meaninglessness just to clear red.
- **All browsers green is the bar.** Chromium-green is necessary but not sufficient. Webkit counts. Quarantine only via the documented, greg-approved last resort.
- **Propose before you delete.** Culling/consolidating tests changes coverage — surface candidates with rationale and wait for approval.
- **Respect the 25-test budget.** Adding a test means retiring a weaker one. Note the count in the report.
- **Always log to `E2E_HEALTH.md`.** An unlogged fix loses the signal that drives future cull decisions.
- **Verify before declaring done.** Re-run (and `--repeat-each` for flakes) — a single green run of a formerly-flaky test proves nothing.
- **Commit + push once green; never deploy.** When the suite is genuinely all-green, commit and push the fix (branch off `main` if needed, run the hooks, update `CHANGELOG.md` when user-facing). Deploying to prod is a separate, explicit decision — never trigger it from this skill.
