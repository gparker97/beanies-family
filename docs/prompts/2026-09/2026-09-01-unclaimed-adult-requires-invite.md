---
date: 2026-09-01
category: security
issue: 'Notion tracker #79'
plan: docs/plans/2026-09-01-unclaimed-adult-requires-invite.md
tags: [auth, login-flow, prove-engine, tap-through, invites, permissions]
---

# An unclaimed adult can be tapped into on an open pod

## Prompts

### 2026-09-01 — pre-plan

> /beanies-pre-plan let's implement #79, once pre-plan is done move to /beanies-plan

### 2026-09-01 — clarification on the proposed adult step-up

> when you say a credential less adult must have a grown up step up or set a PIN, what does that mean exactly?

Answered, then: "Rewrite #79 to match the findings (Recommended)".

### 2026-09-01 — challenging the threat model

> but for a grown up (or child) to join the pod, they must have the invite link sent to them from a pod member to decrypt the pod, so just to be clear, what scenario are we actually trying to prevent here? for example, in case somebody steals the invite link (which i believe it only good for 24 hrs)?

### 2026-09-01 — the adopted approach

> Ok understand and this makes sense. i'm fine to implement as recommended, but one question - in the case somebody joins the pod via an invite link, do they still need another adult to enter their PIN? This could cause friction if they aren't in the same room. Another thought- what if any unclaimed family members (those with no credentials) can only be claimed when the pod is opened via the invite link? ... Which approach do you think makes more sense?

### 2026-09-01 — approval to plan

> yes please update the tracker as needed and run this approach through the plan

### 2026-09-01 — approval to implement

> once the plan is done go ahead to implement. once implementation is done run a /code-review high to ensure the implementation works are expected and designed as per the plan and does not introduce any new bugs, side effects, or security issues

## Outcome

Implemented as planned. The tap-through probe in `proveMethods.ts` is now gated on
`isChildMember`, which is exported from that module and is also the store-level guard in
`authStore.signInPasswordless`, so the engine (what to offer) and the store (what to
allow) cannot drift. An unclaimed adult gets a new `invite-needed` explanatory pane
pointing at The Pod; children tap through unchanged. `authStore.setPassword` (dead code,
no callers, minted a session with no authorization check) and the picker's credential
badge are both deleted. All three passwordless refusals, including the two that were
previously silent, now report once through a shared `refuse()` helper.

Three corrections landed along the way, each of which would have shipped as a wrong
statement:

1. The tracker's premise was wrong. `setPassword` was dead code; the live mechanism was
   `tap-through`, and it is a deliberate feature for PIN-less children.
2. I told greg the hole was reachable only via Switch Member. Wrong: `tryTrustedAutoOpen`
   re-opens the pod before the picker, so it is reachable after an ordinary sign-out on a
   trusted device.
3. The plan described the invite as "member-bound". Wrong: it is family-scoped with a 24h
   expiry, and member binding happens at claim time.

`/code-review high` found no defect in the diff. Three of its four findings were applied
(a stale `docs/STATUS.md` block, a silent `catch` in `signInPasswordless`, and a wrong zh
translation of the new copy). The fourth was a separate pre-existing gap that greg
asked to fold in: `applyDefaults` derived `canViewFinances ?? true`, so a wizard-created
child could reach the finances from their own bean. Now `?? ageGroup !== 'child'`. The
default applies only where no value is stored, so a grown-up's explicit toggle still wins
either way, and the member modal drops the toggle for a NEW child so both creation paths
agree. Greg chose to apply it retroactively, matching #79's no-grandfathering rule.

5289 unit tests green, type-check and lint clean.

## Follow-up prompt

### 2026-09-01

> is it safe to go ahead and fix the issue now as part of this security work?

Answered yes, with the mechanics checked first: the default lands only on members with no
stored value, owners and pod managers short-circuit ahead of it, and the admin modal reads
through the transformed list so it cannot desync. The one genuine fork was put to greg,
because the codebase holds precedent for both answers (`normalizeRoles` step 2 locks in
legacy admins' `canManagePod` specifically so a default change does NOT reach them). Greg
chose to apply it to everyone.
