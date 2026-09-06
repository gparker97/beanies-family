---
date: 2026-09-07
category: feature
issue: none
plan: docs/plans/2026-09-07-native-update-gate.md
tags: [native, ios, android, capacitor, app-update, beanpod-v5, telemetry]
---

# Prompt log: ask people to update the app, and require it when their family file needs it

Follows the compacted-pod v5 work (`docs/plans/2026-09-06-compacted-pod-v5.md`), whose
Caveats deferred this: a compacted family file is written as beanpod 5.0, and a native
build that predates that format refuses it at parse. The web heals itself through the
service worker; iOS and Android cannot, so beanies had no way to ask a phone to move.

## Prompts

### 2026-09-07, initial

> one last thing before we move onto the code review - we forgot to add it to the plan,
> but we need to add the code / packages so that we can force and/or prompt both android
> and ios users to update the app when needed. i believe previously it was mentioned that
> this is a capcitor package we need to add, and on ios also some code to check if the
> user is on the latest version. wherever possible, we should ask the user to install the
> latest version of the app. can we add that directly, or should we run it through another
> set of plans?

### 2026-09-07, answering the two questions raised before planning

> Regarding your questions above:
>
> 1. Let's start with a prompt and force when needed as per your recommendations. agree
>    that a force update should be used to ensure apps can read the new v5 beanpod
> 2. agree

### 2026-09-07, the standing instruction this work ran under

> go ahead to run the code review against all code implemented in this session [...] once
> the code reviews and fixes are complete, run /beanies-plan as per the instructions above
> to build the plan for implementation of the force update for both android and ios apps.
> [...] once the plan is complete, proceed to implement as per the plan. once the
> implementation is complete, run a code review again on the implementation and fix any
> issues found [...] once all reviews and fixes are complete, run /end-session to capture
> context and ensure everything is committed and pushed to the repo.

## Outcome

Phase A shipped. Phase B (Play's in-app flexible update flow, behind
`@capawesome/capacitor-app-update`) is deliberately not started; the plan records it as a
separate change that Phase A does not depend on.

**Two questions, answered separately, because they have different consequences.**

- _Is there a newer version?_ Answered by a static file we deploy by hand,
  `web/public/min-app-version.json`. It drives a dismissible PROMPT, once per session,
  and it is structurally incapable of blocking anyone.
- _Is this build too old to keep working?_ Answered only by the file in front of the
  device, through `UnsupportedBeanpodVersionError`. It drives the BLOCK, which now
  carries a working way out.

The load-bearing consequence: nothing we deploy, mistype or forget can lock a family out.

**What landed**

- `src/utils/compareAppVersions.ts` — a real version comparison (`0.9 < 0.16`), returning
  `null` rather than throwing on anything it cannot parse.
- `src/services/appUpdate/versionPolicy.ts` — the floor's fetch over `CapacitorHttp`
  (never `fetch`: the apex sends no CORS headers, so a browser fetch is refused on every
  device and the fail-open would hide it forever). Enforced by a lint zone.
- `src/composables/useAppUpdate.ts` — native-only, the mirror of `usePwaUpdater`. One
  prompt per session, gated on online, quiet, and past boot.
- `src/utils/appQuiet.ts` — `isAppQuiet()` moved verbatim out of `usePwaUpdater` so both
  updaters ask the same question.
- The block's way out: `fatalErrorStore` gained an `action` that is DATA, not a callback,
  attached in `surfacePayloadFatal` and rendered as a real anchor plus the URL as
  selectable text outside the disclosure, so it is never a dead end.
- `ConfirmModal`'s confirm control becomes an anchor when given a `confirmHref`, because
  `confirm()` resolves a promise and a post-await `openExternal` is a tap that appears to
  do nothing.
- `packages/brand/nav.ts` — `STORE_URL`, one copy, replacing four literals.
- `src/components/common/FatalErrorOverlay.vue` — extracted from `App.vue` so the app's
  most important failure surface could be mounted and tested for the first time. A
  verbatim markup move; the plan had said "no new component", and this is the one place
  the implementation deliberately went further, because the alternative was asserting on
  source text, which this repo has an explicit lesson against.

**Honest about what it does not do:** it helps nobody who is stale today. They are on
0.16, which contains none of this code. It is insurance for the next format change.
