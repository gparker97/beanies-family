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

---

## Follow-on: the acceptance drills, and what they found

Greg ran the compaction acceptance steps and reported three things. All three
turned out to be different from what they looked like, and none was the beanpod
version guard.

### Prompts

> ok i've performed steps 1, 2, and 4 all on my test family and i've already confirmed
> step 5 in an earlier test [...] i did not test step 3 as i'm not sure what you mean by
> 'corrupt the safety copy before compaction completes' [...] as long as you confirm the
> code/guard looks correct i'm ok to push this wihtout explicit testing.
>
> however for step 2, i believe there is an issue with the design for loading another data
> file [...] it switches the family to local file. Further, session B remained on the google
> drive (compacted) file and did not also switch to local file after the import.
>
> Note that during step 4, when trying to import a new family file, i received a message
> that the file version was newer, but it did not prevent me from loading the file. [...] in
> addition, when trying to load the newer file from the welcome gate, the sign in spinner
> appears to be spinning indefinitely.

> i've tried to load the dev family again from google drive from the welcome gate [...] After
> the spinning ran for ~60s or longer, I got this error: rpc-timeout:initAndLoadCache

> go ahead to fully plan and implement these fixes. at the moment i'm locked out of the dev
> family as even if i try to open the local file, the spinner spins forever.

> once the review is done, let's /end-session once more [...] the main goal and next steps of
> the next session would be to run testing on compaction against the updates just implemented,
> and once all confirmed, run a couple more small feature (i.e. copy changes, the ability to
> duplicate a list, share recipes, etc), and then run a full deploy including both apps to the
> store.

### Outcome

**Step 3 confirmed by reading, not by testing**, at greg's request and with evidence: every
safety-copy failure is `return refuse(...)` and `compactDoc()` is not reached until after all
of them; the check is a real round trip (write, read back, byte-compare against what went
out, not against the in-memory copy); a mismatch deletes the bad copy before refusing; nine
`expect(docClient.compactDoc).not.toHaveBeenCalled()` assertions cover the refusal paths.

**The lockout** was two lines live in prod since ADR-032, not this cycle's work. Fixed in
`cd7d3dd7`; see `docs/STATUS.md` and the plan.

**The "guard bypass" was not one.** I said it might be before the trace came back, and the
trace disproved it: all 17 beanpod read routes call `parseBeanpodV4` and abort. The failure
was a message with no reachable render site, next to a Force Save button.

**The Drive restore issue is real and unfixed**, with its own investigation report. It makes
the compaction rollback route strand a Chromium desktop user, and it needs its own plan.
