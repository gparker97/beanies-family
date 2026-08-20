---
date: 2026-08-20
category: feature
issue: none
plan: docs/plans/2026-08-20-app-review-demo-mode.md
tags: [app-store, review, demo, auth, gating, telemetry]
---

# App Review demo mode

## Prompts

### 2026-08-20 — initial (problem statement)

> no matter what i do it seems that i can't force google to turn of 2FA checks on the beaniesdemo@gmail.com account that i sent to apple for review. they keep telling me they are being asked for a code every time they logon. is there any way to turn off all forms of 2FA and verification for gmail ?

Answered: no — 2-Step Verification can be turned off, but Google's risk-based
"verify it's you" challenge for unfamiliar device + IP + country cannot be, and a
reviewer VM trips it every time. Offered two routes; recommended shipping a demo
bypass (Apple's own App Review Information guidance explicitly allows one).

### 2026-08-20 — follow-up

> plan option A with /beanies-plan

### 2026-08-20 — approval

> approve and start implementation to completion, no need for a mockup, ok to skip phase 0 if it's not needed for this feature to work. we can perhaps use it as a general demo for other users interested in beanies as well in teh future

## Outcome

Shipped. A code-gated demo mode: an "App Review Access" button on the welcome
screen (rendered only in a deliberately-armed, unexpired build) opens a modal;
a correct code seeds a complete synthetic family in memory and lands on `/nook`
with no Google sign-in and no network call.

Notable findings from the four-pass plan review, all verified against source:

- `createNewFile` fires the pod-created Slack ping itself (not `CreatePodView`),
  returns a result rather than throwing, and makes a **third** remote call (a
  pre-write registry lookup) that the first draft missed.
- `signUp({ deferPassword: true })` would have tripped `createNewFile`'s
  fail-closed sentinel precondition and paged `#beanies-errors` on every attempt.
- **Data-safety defect (Pass 4):** `signUp` returns `{ success: true }` without
  doing anything when a session already exists, so seeding on top of a live
  session would have written the fixture into a _real family's_ document. Now a
  non-destructive `session-exists` precondition.
- Seeding through the entity stores would have fired confetti, ~60 Plausible
  events and a balance cascade per record; it goes through a shared batch
  document seeder instead.

Phase 0 (consolidating the duplicate SHA-256 in `pkce.ts` / `inviteService.ts`)
was skipped as agreed — it touches the OAuth login path for every real Drive user
and is not needed for this feature.

Greg noted demo mode may later be repurposed as a general "try beanies" demo for
prospective users. Deliberately **not** built for that: a public demo has no
secret code and therefore a different threat model. Recorded as a decision point
at the top of the retirement checklist rather than designed in speculatively.
