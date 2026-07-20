---
name: review-dependabot-prs
description: Review, triage, and action all open bot-authored PRs — both Dependabot dependency bumps AND the monthly `automation`-labeled data-sync PRs (airport-sync, holiday-sync, translation-sync): squash-merge the safe ones, close the genuinely out-of-scope ones with an explanation (and propose an ignore entry for indefinitely-deferred majors), and surface the ones that need a human decision with a written analysis. Use when greg invokes `/review-dependabot-prs` or asks to handle / review / clean up / triage the Dependabot PRs, the dependency-update backlog, or the monthly airport / public-holiday / translation bot PRs.
---

# review-dependabot-prs — Dependabot PR Triage

Dependabot opens a steady trickle of dependency-bump PRs (npm weekly + GitHub Actions weekly — see `.github/dependabot.yml`). Left alone they pile up; merged carelessly they break the build. This skill is the standardized triage so every Dependabot PR gets the same comprehensive look: read what changed, check CI, weigh blast radius, then **act** — merge, close, or hold-for-decision — rather than freestyling each backlog sweep.

The cost of both failure modes is real: stale deps accumulate CVEs; a careless major-version merge eats a day of breakage. The right call usually needs the same checklist every time, so it lives here.

**This sweep also picks up the monthly `automation` data-sync bot PRs** — airport-sync, holiday-sync, translation-sync (see `.github/workflows/*-sync.yml`). They're the same mental mode (a bot's mechanical PR that wants a quick human skim) and greg deliberately runs them through this same review rather than auto-merging, so they belong in the same pass. They're triaged on a different axis than dependency bumps — see **Step 4b**.

---

## When to Invoke

- **Via slash command**: `/review-dependabot-prs`
- **When greg asks**: "handle the dependabot PRs", "review the dependency updates", "clean up the dependabot backlog", "are there any dep PRs to merge", etc.
- **Proactively only as an offer**: if `/start-session` or `/good-morning` surfaces "N open Dependabot PRs", offer to run this — don't run it unprompted.

---

## Step 0: Verify GitHub account

```
gh auth status
```

The active account must be **`gparker97`**. If a different account is active, run `gh auth switch --user gparker97`. If `gparker97` isn't logged in, prompt the user to run `gh auth login` and stop.

Also check the working tree is clean:
```
git status --short
```
If it's dirty, stop and ask — don't mix Dependabot triage with unrelated uncommitted work.

## Step 1: Enumerate the open Dependabot PRs

```
gh pr list --author "app/dependabot" --state open --json number,title,headRefName,createdAt,labels
```

Also enumerate the `automation` data-sync bot PRs (they run through Step 4b, not the Dependabot classification):
```
gh pr list --label "automation" --state open --json number,title,headRefName,createdAt,labels
```

If **both** lists are empty → report "no open bot PRs — backlog is clean" and stop. If only one is empty, proceed with the other.

## Step 2: Gather data on each PR

For each PR, run in parallel (one `gh pr view` per PR, batched in a single message):
```
gh pr view <n> --json number,title,body,headRefName,mergeable,mergeStateStatus,statusCheckRollup,labels,files
```

From each, extract:

- **Dependency name** + **from → to versions** — the PR body's first line (`Bumps [<name>](...) from X to Y`). For **grouped** updates the body lists several deps.
- **Semver bump**: patch (`x.y.Z`), minor (`x.Y.0`), or **major** (`X.0.0`). This is the single biggest risk signal.
- **Dev vs prod dependency**: the title disambiguates — `chore(deps)(deps-dev):` = devDependency, `chore(deps)(deps):` = production. (GitHub-Actions PRs use `chore(ci)`.)
- **Security advisory?** The auto-applied `security` label means nothing on its own — `.github/dependabot.yml` slaps it on *every* npm PR. A real advisory shows up as a `<summary>` block in the body (e.g. "⚠️ CVE-…", "GHSA-…") or you can cross-check `gh api /repos/gparker97/beanies-family/dependabot/alerts --jq '.[] | select(.state=="open") | {pkg: .dependency.package.name, severity: .security_advisory.severity, ghsa: .security_advisory.ghsa_id}'`.
- **Compatibility score** (Dependabot's own number, in the body) — a soft signal, not decisive.
- **CI state** from `statusCheckRollup`: dependabot PRs run `PR Checks` + `Security Scanning`. Healthy = every check `SUCCESS` *except* `Select browsers`, `E2E — *`, and Lighthouse, which are `SKIPPED` unless the `run-e2e` label is applied. **`SKIPPED` E2E/Lighthouse is normal and fine for a dep bump** — do not treat it as a failure. A genuine red (`FAILURE`) on Unit Tests / Build Verification / SAST / CodeQL / Dependency Review is a hold signal.
- **`mergeable` / `mergeStateStatus`**: `UNKNOWN` is common until you interact — re-fetch after a comment if needed. `CONFLICTING` / behind-main → needs a rebase (Step 4, 🔁).

## Step 3: Cross-reference the known-deferred list

Read `docs/STATUS.md`, section "**Major-version dependency migrations**" and "**Dependabot security alerts**" (under Engineering follow-ups). That block is the running record of deps that are *intentionally* on hold — ERESOLVE-blocked majors waiting on ecosystem peers (eslint 10, stylelint 17), majors needing a focused migration with QA (astro 6, vite 8, @astrojs/mdx 5, astro-seo 1), and transitive-only CVEs whose vulnerable path isn't in our tree. **Don't re-litigate those every run** — match the PR against this list first.

## Step 4: Classify each PR

| Category | Criteria | Action |
|---|---|---|
| ✅ **Safe to merge** | patch or minor bump **AND** (devDependency, OR production-dep patch) **AND** all required checks `SUCCESS` (skipped E2E/Lighthouse is fine) **AND** not on the STATUS deferred list **AND** the changelog (in the body) shows no breaking change / no notable behavior change to anything we use. GitHub-Actions bumps (`chore(ci)`) to a pinned action are almost always safe (patch/minor). | squash-merge (Step 5) |
| 🔶 **Needs a human decision** | **any major version bump** (no exceptions — majors are held even with green CI); OR a production-dep **minor** bump to a load-bearing lib (`vue`, `vue-router`, `pinia`, `vite`, `@vitejs/plugin-vue`, `vite-plugin-pwa`, `typescript`, `tailwindcss`, `@automerge/automerge`, `astro`, `@astrojs/*`, `chart.js`, `vue-chartjs`, `idb`); OR CI failing for a non-flaky reason; OR a real security advisory whose fix requires app-code changes (not just a transitive bump); OR a grouped update mixing clearly-safe deps with a risky one. | leave open + post an analysis comment (Step 5) + flag it in the report for greg |
| ❌ **Out of scope** | a major that's ERESOLVE-blocked on peers that haven't caught up *and* already documented on the STATUS deferred list; OR a transitive-only CVE where the vulnerable function/version is provably unreachable in our dependency tree (verify against the advisory's affected range + actual usage — if you can't confirm unreachability, it's a 🔶 not a ❌); OR superseded by a newer PR for the same dep. | `@dependabot close` + explanation comment (Step 5); for majors that should stay closed indefinitely, also propose an `ignore` entry in `.github/dependabot.yml` |
| 🔁 **Stale / behind main** | `mergeStateStatus` is `BEHIND` / `mergeable` is `CONFLICTING` purely because main moved (no real conflict in the dep change itself) | `@dependabot rebase` comment (Step 5); record as "re-check next run" — don't block waiting for the rebase + re-run |

When in doubt between two categories, pick the *safer* one: 🔶 (hold) over ✅ (merge), and 🔶 over ❌ (close). A held PR costs a follow-up; a bad merge or a wrongly-closed security fix costs more.

## Step 4b: Automation data-sync PRs (airports / holidays / translations)

The three monthly `automation`-labeled PRs (authored by `app/github-actions`) are **data refreshes, not code changes**, so the semver / advisory / deferred-list machinery above doesn't apply — triage them on their own axis:

- `airport-sync.yml` → regenerates `src/constants/airports.ts` from OurAirports (public domain)
- `holiday-sync.yml` → refreshes `public/holidays/*.json` (+ `src/constants/countries.ts`)
- `translation-sync.yml` → refreshes translation data

**Critical — these PRs bypass the app's CI, and that's expected.** They're created with the default `GITHUB_TOKEN`, and GitHub deliberately will **not** run your other workflows (`main-ci`, `e2e`, type-check) on a branch pushed by that token — a recursion guard. So expect `mergeStateStatus: UNSTABLE` with the **only** check being `GitGuardian` (a GitHub App, which does run). That is **normal, not a failure** — there's simply no build gate on these PRs. The consequence: a malformed upstream (e.g. OurAirports changing its CSV format → broken generated TS) would sail straight through. **You are the gate** — do a light diff sanity check before merging.

Skim `gh pr diff <n>` (for the 100-file holiday PR, `gh pr view <n> --json files` + spot-check a couple), then:

| Signal | Read | Action |
|---|---|---|
| Small, sensible data churn — a handful of entries added/removed, a "last regenerated" date bump, a normal yearly holiday-window roll-forward | clean | squash-merge (Step 5) |
| Something load-bearing looks wrong — a major airport (LHR / JFK / SIN …) dropped, an IATA code reassigned to a different city, a whole country's holidays emptied, a wildly lopsided deletion count, or a diff that reads like a format break (garbled fields, TS that won't parse) | suspicious | **don't merge** — hold and flag it in the report with the *specific* anomaly; the upstream source or the generator (`scripts/updateAirports.mjs` and the holiday/translation equivalents) may need a look |

Because CI didn't gate the PR, close the loop yourself when a **`.ts`** data file changed (`airports.ts`, `countries.ts`): either run `npm run type-check` locally *before* merging, or — since the squash-merge to `main` triggers the push-driven `main-ci` / `e2e` — glance that the post-merge run goes green and say so in the report. Pure `public/holidays/*.json` data changes are lower-risk (no compile step) but still deserve the skim.

There's no "close as out-of-scope" for these — they're either clean-and-merge or hold-with-an-anomaly-note. They don't touch the `docs/STATUS.md` deferred list, so **Step 6 doesn't apply** to them.

## Step 5: Take action

**Merges** — one at a time, in PR-number order:
```
gh pr merge <n> --squash --delete-branch
```
Squash-merge only (repo convention; see prior dependabot merges in git history). If a merge fails because the PR is now `BEHIND` (a previous merge in this batch moved main), don't `--admin` past it — post `@dependabot rebase` (below) and note it as a re-check-next-run item. Never use `--admin` to bypass an incomplete or red check.

**Closes (out of scope)** — a single comment does both the close and the explanation:
```
gh pr comment <n> --body "@dependabot close

<one short paragraph: what this is, why it's out of scope right now, and the condition under which it should be revisited — e.g. 'eslint 10 is ERESOLVE-blocked on @microsoft/eslint-plugin-sdl + typescript-eslint peer ranges; revisit when those publish eslint-10-compatible majors. Tracked in docs/STATUS.md.'>"
```
Then, **only for majors that should stay closed indefinitely**, propose adding an `ignore` entry under the relevant ecosystem in `.github/dependabot.yml` (the file already has a commented-out `ignore:` block showing the shape) so Dependabot stops re-opening it weekly — present the diff and let greg confirm before committing it.

**Holds (needs decision)** — post an analysis comment, then leave the PR alone:
```
gh pr comment <n> --body "<analysis: what changed (link the relevant changelog entry), why it can't be auto-merged (major / core-lib / CI / advisory), what specifically needs deciding, and a recommendation if you have one>"
```

**Rebases**:
```
gh pr comment <n> --body "@dependabot rebase"
```

## Step 6: Keep the deferred list current

If you **closed** any PR as out-of-scope, or **held** a new major that wasn't already listed, append/update the relevant line in `docs/STATUS.md`'s "Major-version dependency migrations" / "Dependabot security alerts" block so the next run doesn't re-investigate it from scratch. Commit that edit together with any `.github/dependabot.yml` ignore-entry change:
```
git add docs/STATUS.md .github/dependabot.yml
git commit -m "chore(deps): triage dependabot PRs — <N merged, M closed, K held>" -m "<one line per closed/held PR with the reason>" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
```
(Merging PRs already lands their own commits on `main`; this is just the housekeeping commit. Skip it entirely if nothing was closed/held and STATUS doesn't need touching — a pure batch of safe merges needs no extra commit. `git push` runs the pre-push test hook; a STATUS/dependabot.yml-only change passes it trivially.)

Do **not** trigger a production deploy from this skill — dependency bumps ride out on the next normal deploy. If a merged bump is security-urgent, say so in the report and let greg decide to `/deploy-prod-auto`.

## Step 7: Report

A table — one row per PR:

| PR | dependency | from → to | bump | dep type | verdict | action taken | recommendation | notes |
|----|-----------|-----------|------|----------|---------|--------------|----------------|-------|

- **recommendation** — the clear call for this PR: **Merge** or **Close** (those are the two normal outcomes). Use **Rebase** only when the sole blocker is a stale branch with no other decision pending. Always state one — even for a held PR, give the recommendation you'd act on once greg signs off (e.g. a held major you've vetted as safe is **Merge**; a held major with real breakage risk is **Close**).
- **notes** — one brief phrase explaining the recommendation (e.g. "critical CVE fix, breaking changes inert on Node 24", "ESLint-10 ERESOLVE-blocked on peers", "dev-only patch, green CI").

Include the `automation` data-sync PRs in the same table (dep type = e.g. `data-sync (airports)`; bump = `data`; verdict = ✅ merge or 🔶 hold-anomaly). For a held data-sync PR, the notes state the specific anomaly you spotted.

Then a short tally: **N merged · M closed · K held · J rebased** (counting both Dependabot and automation PRs). For each **held** PR, one line stating exactly what greg needs to decide (for a data-sync hold: the anomaly). For each **closed** PR, one line with the revisit condition. If you proposed a `dependabot.yml` ignore entry, show the diff and ask for confirmation. If you merged a data-sync PR that touched a `.ts` file, note the post-merge CI / type-check result.

---

## Rules

- **Majors are always held, never auto-merged** — even with green CI and a clean changelog. A major-version bump gets a 🔶 analysis comment and goes in the report for greg. No exceptions.
- **Never `gh pr merge --admin`** — if a required check isn't `SUCCESS` (skipped E2E/Lighthouse excepted), the PR is a hold, not a merge. Admin-bypass is off the table.
- **Never close a real security advisory PR unless you've confirmed the vulnerable path is unreachable** — check the advisory's affected versions/functions against actual usage in the tree. Can't confirm? Hold it; don't close it.
- **Squash-merge only.**
- **`automation` data-sync PRs bypass CI by design** — created by `GITHUB_TOKEN`, so `main-ci`/`e2e`/type-check don't run on the branch; `UNSTABLE` with only `GitGuardian` green is normal, not a red flag. You are the build gate: skim the data diff for anomalies (a major airport vanishing, a country's holidays emptied, a format break) before merging, and verify type-check/post-merge CI when a `.ts` data file (`airports.ts`, `countries.ts`) changed. Never auto-merge them blind. See Step 4b.
- **`@dependabot close` (PR comment) is preferred over `gh pr close`** for out-of-scope PRs — Dependabot tracks the close and won't immediately recreate the same-version PR. For indefinitely-deferred majors, follow up with a `.github/dependabot.yml` `ignore` entry (with greg's confirmation) so it stops recurring weekly.
- **Don't block on rebases** — post `@dependabot rebase`, note it, move on. The re-run happens async; the next sweep picks it up.
- **Dirty working tree on entry → stop and ask.** Don't entangle this with unrelated changes.
- **Run the gh commands as single, simple invocations** — no inline `$(...)`, `&&`, `;`, `||`, or heredocs (those trigger permission prompts). Multi-paragraph comment/commit bodies use a single `--body`/`-m` per paragraph or a single multi-line string, not a heredoc.
