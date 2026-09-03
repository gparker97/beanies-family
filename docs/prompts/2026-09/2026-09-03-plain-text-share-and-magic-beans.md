---
date: 2026-09-03
category: feature
issue: '#83, #84 (Notion tracker)'
plan: docs/plans/2026-09-02-plain-text-share.md, docs/plans/2026-09-03-one-magic-beans-button.md
tags: [ai, share-target, rate-limiting, magic-beans, security, observability]
---

# Plain-text share (#83) + one magic-beans button (#84)

Two tracker issues implemented back to back in one session, because #84 cannot be built until
#83 lands its `text` `ShareSource` arm.

## Prompts

### 2026-09-03 — plan #84 (continuing from the pre-plan)

> once the pre-plan is complete go ahead to /beanies-plan to start the planning

### 2026-09-03 — mockup as an artifact

> can you add the mockup as a claude artifact pls

### 2026-09-03 — mockup direction

> let's go with B

### 2026-09-03 — commit the plan

> commit and push the plan

### 2026-09-03 — the build request

> now let's move on to /beanies-pre-plan and then /beanies-plan for #83.

(Answered: #83 was already fully planned on 2026-09-02 with all four review passes recorded,
so re-planning it would have re-derived — and risked losing — findings the file already held.
Greg agreed and moved straight to implementation.)

### 2026-09-03 — implement both, then review

> perfect - go ahead to implement #83 in full. once complete, proceed with implementation of
> #84. once complete run a /code-review max against all code implemented to ensure it is fully
> functional and works as designed against the plan, adn does not introduce any bugs, side
> effects,or security concerns. fix all issues found.

### 2026-09-03 — correction on the review tooling

> how come it says above that no /code-review command exists in this repo? it should exist and
> it's been run several times before - can you please check again and continue? thanks

(Correct challenge. `/code-review` exists as a marketplace plugin command at
`~/.claude/plugins/marketplaces/claude-plugins-official/plugins/code-review/commands/code-review.md`;
I had searched only this repo's `.claude/skills/` and `.claude/commands/`. The command is
PR-driven — every step goes through `gh pr diff` and it finishes by commenting on the PR — and
this work is uncommitted on `main` with no PR, so its procedure was executed against the
working diff instead.)

### 2026-09-03 — run it properly

> thanks - pls go ahead and run the proper code review and if needed merge the results from
> your own review

## Outcome

Both shipped in the same working tree. #84 was built as the two commits its plan required, and
the Commit A gate held: the share suite passed **byte-identical** to where #83 left it
(verified by `git hash-object`), which is the evidence the `withIngestLock`/`runIngest` split
is behaviour-preserving.

**Build-time step 0 mattered.** #84's plan carried pre-#83 counts and instructed a recount.
Every number had moved — 20→22 `surface: SURFACE` sites, 4→5 `origin: 'share'` literals,
645→840 lines, 49→71 tests. Trusting the plan's figures would have missed the fifth `origin`
literal, which is the text arm #83 itself added.

**The review found eight defects the four plan passes did not**, three of them HIGH:

1. `attemptBudget.persist()` wrote the in-memory Map as the whole blob, silently deleting every
   budget key not hydrated that page load — so switching families _reset_ the budget the
   family-scoped key exists to protect. The exact inverse of the module's purpose.
2. The ADR-030 consent modal and the quick-add sheet were both `z-50` and both teleported to
   body, with the sheet mounted later — so the consent prompt rendered _behind_ it on every
   in-app capture and the flow appeared to hang. Fixed by raising the gate to `layer="top"`;
   a permission prompt the user cannot see is a security-UX failure, not a stacking nit.
3. A **third** text-cap mirror in `public/share-target-sw.js` was never updated, making the
   whole size policy unreachable on the installed PWA. The plan explicitly asserted "the PWA
   needs no decode change"; that was false, and only the git-history reviewer caught it.

Plus: `ai-extract`'s new concurrency reservation (10) sat below what the route throttle admits
(~58), a self-inflicted DoS on the already-shipped image path, with no `Throttles` alarm; the
IP limit keyed the full IPv6 `/128`, so an attacker with a `/64` had unlimited buckets; only
one of five extraction call sites passed `familyId`; a bare unreadable link was sent to the
model as prose; and the truncation notice fired before the offline and consent gates, telling
users beanies had read something it had not.

**Five of the new tests were hollow** — proven by mutation, not inspection. The worst let the
entire rate-limit call site be deleted from the Lambda with all 35 handler tests still green.
Every one is now mutation-verified.
