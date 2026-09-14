---
name: beanies-build-auto
description: >-
  Take a piece of beanies.family work all the way from plan to verified, reviewed, fixed code — plan via
  /beanies-plan, implement it, apply terraform when infra is needed, verify in a real browser, run /code-review,
  fix what it finds, decide whether a second review is warranted, then hand back a summary plus the manual tests
  only greg can do. Use this WHENEVER greg wants something built end-to-end rather than just designed — phrases
  like "take this to /beanies-plan and implement it", "plan it then build it", "implement this and code-review
  it", "build this properly", "go ahead and implement, then review and fix", "take this all the way", "implement
  the plan in docs/plans/...", or an approved plan/mockup/tracker issue handed over with "go". Also use it when
  he asks to implement something and mentions reviewing, browser testing, screenshots, terraform, or fixing what
  the review finds. Trigger even if he doesn't name this skill or say "build" — a request that spans
  implementation AND verification AND review IS this skill. It never deploys to production; it stops at
  reviewed, verified code and hands off to /deploy-prod-auto.
---

# beanies-build-auto — Plan → Implement → Verify → Review → Fix

The one-shot version of a prompt greg has typed by hand a dozen times (`docs/prompts/2026-09/` is full of
them). It exists so the discipline is the same every time instead of depending on how much of it he
remembered to type.

This skill **orchestrates**; it does not re-implement. Planning belongs to `beanies-plan`, reviewing belongs
to `/code-review`, deploying belongs to `/deploy-prod-auto`. What this adds is the connective tissue between
them, and the judgement calls at each seam.

**It never deploys to production.** No `gh workflow run deploy.yml`, no `deploy-web.yml`, no
`mobile-*-release.yml`, no `/deploy-prod-auto`. It ends at code that is reviewed and verified on the local
branch; shipping is a separate, deliberate act with its own decision gate.

---

## When to Invoke

- **Via slash command**: `/beanies-build-auto` — optionally with a plan path (`/beanies-build-auto docs/plans/2026-09-14-magic-beans.md`) or a tracker id
- **Automatically**: when greg asks for something to be built end-to-end — implementation plus review, or plan plus implementation — rather than designed or planned alone
- **Not** when he only wants a plan. "Save the plan, don't implement" means `/beanies-plan` and a full stop. If the ask is ambiguous, assume plan-only and offer this skill; starting an unwanted implementation costs far more than asking.

---

## Workflow

### Phase 0: Establish the plan and the preconditions

Two entry paths. Work out which one you are on before anything else:

- **No plan yet** → invoke `/beanies-plan` in-thread. It runs its four passes and ends by calling
  `ExitPlanMode`, which puts the plan in front of greg. **His approval there is the gate for everything
  below.** Do not start implementing on the strength of the slash command alone — the command authorises the
  *sequence*, the plan approval authorises the *content*.
- **A plan already exists** (a path was given, or `docs/plans/` holds the approved plan for this work) → read
  it in full and skip to Phase 1. Say which plan you are building so greg can catch a wrong one immediately.

Then check the preconditions, because both failure modes here are expensive and silent:

1. **The working tree must be clean.** greg runs parallel Claude sessions, and building on top of another
   session's uncommitted work entangles two changesets that then cannot be reviewed or reverted separately.
   Dirty tree → stop and ask whose work it is.
2. **The plan's assumptions must still hold.** A plan written days ago may name a file that moved or a helper
   that now exists. Re-read its `## Assumptions` and spot-check the ones that are cheap to verify. Say which
   ones you checked.

Then state the shape of the run before starting: which plan, whether infra is involved, and what you expect
to be able to verify in a browser versus what will need greg's hands. Getting the "what I cannot verify" list
out early means he can start thinking about it while you work, rather than being handed it at the end.

### Phase 1: Implement

Build what the plan says, in the order the plan says. The plan is the spec — deviating from it silently is
the single worst thing that can happen in this phase, because the review in Phase 5 checks the code against
the plan, so a silent deviation gets reviewed against the wrong yardstick and passes.

When implementation reveals the plan was wrong (it happens, and the plan's own `## Assumptions` section
exists because of it), **stop and say so** rather than quietly building something else. A one-line
"the plan assumed X, X is false, here is what I propose instead" costs a moment. Discovering it in review
costs the whole loop.

Honour the project's standing rules while you work — they are in `CLAUDE.md` and the theme skill, and the
review will fail you on them regardless:

- **DRY.** Check for an existing composable, util, or component before writing a new one. If the same pattern
  now appears in 2+ places, extract it now, not later.
- **No silent failures.** Every `catch` classifies and logs. Critical → `reportError({ severity: 'critical' })`.
- **Observability is part of the feature**, not a follow-up. The plan's `## Observability Coverage` section
  names the events; emit them, including on the success path so rates are measurable.
- **i18n.** No bare user-visible strings. `uiStrings.ts` needs both `en` and `beanie` for every key.
- **Both themes in the same change.** Every painted background needs a dark partner; every accent used as
  text needs its `-lift`. Inline `style` and `<style scoped>` rules both outrank a `dark:` utility.

### Phase 2: Verify the build is sound

```bash
npm run validate
```

That is type-check, lint, format:check, unit tests, and build in one gate — the same set CI runs. Run it
before the browser and before the review, because a review of code that does not compile wastes a review.

If it fails, fix and re-run until green. Do not proceed with a red gate and a note to come back to it.

Touched a Lambda? `npm run test:lambda` too — `validate` does not cover them.

### Phase 3: Infrastructure, when the plan calls for it

Skip this phase entirely when no infra changed. When it did, read
`references/terraform.md` before running anything — it carries the trap that makes a terraform plan lie, and
the exact gate for when an apply may proceed unattended.

The short version:

```bash
scripts/infra/tf-plan.sh                          # or: tf-plan.sh -target=module.ai_extract
```

That script sources `~/.beanies-tf.env`, runs the account guard, checks log retention, plans, and prints
**every** resource change. Read all of them.

Then apply the plan **only if every change is one the plan document called for**:

```bash
scripts/infra/tf-apply.sh                         # applies the saved plan, not a fresh one
```

**Any unexpected resource, any destroy, any replace, or any drift → stop and show greg the diff before
touching anything.** An unexpected change is either someone's console edit that terraform is about to
silently revert, or a secret about to be blanked. Neither is yours to decide.

### Phase 4: Verify it in a browser

4563 green unit tests once hid three real defects, because tests assert what you thought to assert and a
browser shows you what actually happens. So walk the user's real steps.

Read `references/browser-verification.md` for the mechanics — in particular the trap that a throwaway
Playwright script dropped in `e2e/specs/` silently joins the CI suite and breaks the ADR-007 budget.

What to cover:

- **The happy path from the plan's `## Acceptance Criteria`**, clicked through as a person would.
- **Both themes.** Light and dark, on any surface the change paints.
- **Phone width (~400px)** for anything with layout. Most of this project's UI defects are mobile ones.
- **Screenshots of anything visual**, and actually look at them. A screenshot you did not open proves nothing.

When something genuinely cannot be driven programmatically — a real Google OAuth consent screen, a native
iOS/Android build, a second physical device, a push notification on a lock screen, a paid flow — do not fake
it and do not skip it silently. It goes on the manual-test list in Phase 8. That list is a deliverable, not
an apology.

### Phase 5: Review what was built

```
/code-review max
```

`max` is the level this project's history justifies: `docs/lessons.md` records three consecutive
`/code-review max` rounds each finding defects in the previous round's fixes, and a session where the four
plan passes plus one review still missed that the feature's central premise was untrue.

Give the review the plan as its yardstick — it is checking three distinct things, and only the first is what
a review does by default:

1. Does the code do what the plan said, completely?
2. Does it introduce bugs, side effects, or security issues?
3. Does it violate the project's standing rules (DRY, silent failures, i18n, dark mode, observability)?

**Triage every finding, including the ones below the ship-blocker line.** A capped review list once dropped a
real correctness bug (`docs/lessons.md`, `docs/E2E_HEALTH.md`). "Below the cut line" is a statement about
priority, never about validity — record what you are not fixing and why, so it is a decision rather than an
oversight.

### Phase 6: Fix what it found

Fix findings in severity order. Re-run `npm run validate` after, and re-run the browser check for anything a
fix touched visually.

**If a fix is the third patch in the same area, stop patching.** When review rounds keep finding regressions
in the last round's fixes, that is the signal to move the decision onto the type or into the owning layer
instead of correcting more call sites. The 0.21 session is the worked example: a second review found three
release-blocking regressions, and **all three were introduced by fixes for the first review's findings** — a
5xx retry silently disabled, a delivered reminder re-arming on every checkbox tick, and a Drive fix that never
reached the `.beanpod` path. Hand-patching had stopped converging. Say so out loud when you see it, and
propose the structural fix.

### Phase 7: Decide whether to review again

Run a second `/code-review max` automatically, without asking, when **any** of these is true:

- A fix touched auth, crypto, sync, money, or data-integrity paths
- A fix changed a **shared** helper, composable, or component — the blast radius is every caller
- More than roughly five findings were fixed
- A fix added new logic rather than correcting a line
- A fix was itself in code the first review had passed

Those are the conditions under which this project has historically found defects in its own fixes, which is
why they trip automatically rather than politely asking.

Otherwise, report how extensive the fixes were and recommend. greg decides.

Either way, **say which branch you took and why.** "No second review: three one-line fixes, none in shared
code" is a useful sentence. Silence is not.

### Phase 8: Report

Close with a report greg can act on in under a minute:

```markdown
**Built:** <one line — what now works that did not before>
**Plan:** docs/plans/<file>.md

**What changed**
- <file or area> — <what and why, one line each>

**Infrastructure:** <none | what was applied, and the resource changes>

**Verified in a browser**
- <step walked> — <result>  (light/dark, desktop/phone as relevant)

**Review:** <N> findings, <N> fixed, <N> deliberately not fixed
- <finding not fixed> — <why, and where it is recorded>

**Second review:** <ran automatically because X | not run because Y — recommend Z>

**Needs your hands** (cannot be done programmatically)
1. <specific step, on what device, and what a pass looks like>

**Not done:** <anything in scope that was left out, and why>
```

Two rules about this report. **Name what a passing manual test looks like** — "check the invite flow" is not
actionable, "join from a second device in a private window; you should land on the pod without a password
prompt" is. And **report failures plainly.** If something does not work, say so with the output. A report
that overstates what was verified is worse than no report, because it retires the question in greg's head.

---

## What this skill does not do

- **It does not deploy.** That is `/deploy-prod-auto` or `/deploy-prod-skip-ci`, both of which have their own
  decision gate for release notes and version floors. Offer the handoff; never take it.
- **It does not commit or push** unless asked. The deploy skills commit as part of their flow, and an
  auto-commit here would pre-empt their decision gate. Report the diff and leave it.
- **It does not update the tracker or Notion.** `beanies-pre-plan` owns the row's state.
- **It does not write the plan itself.** `beanies-plan` does, with its four passes intact.

---

## Rules

- **The plan is the yardstick, at every phase.** Implementation follows it, the browser check exercises its
  acceptance criteria, the review checks against it. When the plan turns out to be wrong, change the plan
  out loud — never silently build something else and let the review measure against a fiction.
- **The slash command authorises the sequence; the plan approval authorises the content.** When Phase 0 runs
  `beanies-plan`, greg's response to `ExitPlanMode` is a real gate. This is the one place the house
  "never auto-chain" rule is deliberately relaxed, and only because invoking this skill is itself the request
  to chain — that relaxation does not extend past the plan.
- **Never apply terraform with an unexpected change in the plan.** Not a destroy, not a replace, not a
  resource nobody asked for. Stop and show greg. Applying through surprise is how a live secret gets blanked
  or a console fix gets reverted.
- **Always run terraform through `scripts/infra/`.** A `terraform plan` from a shell that did not source
  `~/.beanies-tf.env` produces a confident, wrong plan rather than an error. The scripts exist so that cannot
  happen; do not hand-roll the commands.
- **A screenshot you did not look at is not evidence.** Nor is a test you did not run. Say what you actually
  verified and how, and let the rest go on the manual list.
- **Every review finding gets triaged.** Below the ship-blocker line is a priority call, not a validity call.
  Record the ones you are not fixing.
- **When patches stop converging, go structural.** Three rounds in the same area means the decision belongs
  on the type or in the owning layer, not in more call sites.
- **Never deploy from this skill**, and never suggest it as the automatic next step. Reviewed code and shipped
  code are different states, and the gap between them is greg's to close.
- **Report honestly, including what you skipped.** Scaling the work down is greg's call, not yours — so if
  something in scope was left out, the report names it rather than quietly omitting it.

---

## Reference files

- `references/terraform.md` — the infra phase in full: the lying-plan trap, the account guard, the apply gate,
  and what the two scripts do. Read before Phase 3.
- `references/browser-verification.md` — Playwright mechanics, the four configs, where a throwaway script may
  and may not live, and how to capture screenshots. Read before Phase 4.
