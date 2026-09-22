# Plan: The Google reconnect resumes itself, on every surface, once

> Date: 2026-09-22
> Related issues: None — direct implementation. Follow-up to
> `docs/plans/2026-09-22-native-setup-reentry-and-provider-identity.md`, which fixed this class in
> the CREATE flow and deferred these surfaces with reasons.
> Plan file: `docs/plans/2026-09-22-reconnect-resume-at-the-seam.md`
> Status: DRAFT — pass 2 of four complete. Do not implement until pass 4 completes and greg approves.

## User Story

As someone whose Google Drive connection has lapsed, I want tapping "reconnect" once to actually
reconnect me, so that I am not left tapping the same button on the same screen wondering whether
anything happened.

## Context

The create flow's native re-entry bug was just fixed. **The same bug lives on every reconnect
surface**, and the code has known about it for some time: `useGoogleReconnect.ts:153-157` carries

> "⚠️ `opts.returnPath` FIRST, and a caller that cares MUST pass one. The fallback below is the
> current path, which on Capacitor makes the return a `router.replace(samePath)` — a redundant
> navigation that does not remount anything, so whatever raised this button is still raising it and
> the person taps twice."

### The scope is twice what STATUS records — verified

`docs/STATUS.md:127(b)` names three surfaces. There are **six** call sites, and exactly **one**
passes a `returnPath`:

| Call site                                      | Passes `returnPath`?                            | In STATUS's list?           |
| ---------------------------------------------- | ----------------------------------------------- | --------------------------- |
| `LoadPodView.vue:1219`                         | **yes** (`RECONNECT_LOAD_PATH`, shipped 0.21.6) | n/a — this is the fixed one |
| `PodAccessBanner.vue:130`                      | no                                              | yes                         |
| `useReconnectCoordinator.ts:181`               | no                                              | yes                         |
| `useLoginFlow.ts:1232` (`onRecoveryReconnect`) | no                                              | yes                         |
| `SettingsPage.vue:422`                         | no                                              | **NO**                      |
| `SettingsPage.vue:796`                         | no                                              | **NO**                      |
| `SettingsPage.vue:904`                         | no                                              | **NO**                      |

The three Settings sites were never on anyone's list. Two of them carry comments that already
describe the native no-unload reality for a _different_ symptom ("On native the WebView does not
unload, so the user dismisses the Google tab and lands back on Settings…") without connecting it to
the two-tap bug. `STATUS.md:127(b)` must be corrected as part of this change.

### Why "make each caller pass one" is the wrong fix

It is the fix that is already in place, and it has a 1-in-6 hit rate. A contract that requires six
independent call sites to remember an invisible, native-only consequence is not a contract; it is a
tripwire that has already fired five times. The design must make forgetting impossible.

### The actual root cause, stated precisely

`reconnect()` returns `'redirecting'` and the caller `return`s. **On web that is correct**: the page
is unloading and the caller's stack is about to be destroyed. **On native Capacitor the WebView, the
component, the composable instance and the awaiting call stack all survive the round trip** — that
is the very reason nothing remounts.

So the caller's own code after `if (outcome === 'redirecting') return;` is a perfectly good
continuation that the `return` throws away, and that one surface then laboriously re-creates with a
marker, a latch and a watcher.

### Two facts that soften the headline without changing the design

Pass 2 re-read what each caller does on success, rather than trusting the count:

- `syncStore.ts:6125-6135` already clears the reconnect banner on ANY token acquisition
  (`onTokenAcquired` → `handleGoogleReconnected()`), which is why the coordinator's prompt does
  vanish on native today.
- The two Settings restore ladders refuse to auto-retry **by design**, on every platform.

But on all of them the in-place feedback — the toast, the error-slab clear, the failure message, the
rest of a multi-group plan — never runs on native, and on three the person genuinely taps twice.

## Requirements

1. A reconnect started on any surface, on native, completes in **one** tap, and the caller's own
   success and failure handling runs in place.
2. Forgetting to wire a new reconnect surface must be **impossible**: a caller that passes nothing
   gets correct behaviour on every platform.
3. `LoadPodView`'s working behaviour (validated on a production iPhone 2026-09-20) must not regress.
4. A retry after a failed reconnect resume must work in the same mount (`STATUS.md:127(c)`).
5. A reconnect that never comes back (native decline calls no callback at all) must not strand the
   person on a spinner with no escape.
6. A resume that does not run must be visible in CloudWatch. Its invisibility is why this survived a
   prior fix round.
7. `STATUS.md:127(b)`'s surface list must be corrected to six, and `(c)` resolved or restated.
8. The two uncommitted changesets in the tree must not be reverted, committed, or entangled.
9. **No new copy of the marker + latch + `{immediate:true}` watcher shape.** The repo already
   carries five; this change should retire one, not add a sixth.

## The design decisions, argued

### Decision 1: on native, the seam AWAITS the round trip; `'redirecting'` becomes web-only

`useGoogleReconnect.reconnect()` on native no longer returns `'redirecting'`. After
`startRedirectAuth` it awaits a new `awaitNativeOAuthReturn()` primitive and resolves
`'reconnected'` or `'failed'`, exactly as the desktop popup arm resolves after
`requestAccessToken`. Every caller's existing `reconnectSucceeded(outcome)` branch then runs on
native for free, with the component still mounted and its state intact. `'redirecting'` keeps its
meaning on iOS Safari and installed PWAs, where the page genuinely unloads and App.vue's boot owns
completion.

Consequences, all simplifying:

- **No return-path contract at all.** `opts.returnPath` and `opts.noRedirect` are deleted.
- **No per-attempt nonce for reconnect.** A retry in the same mount is just another awaited call.
  `STATUS.md:127(c)` is resolved by removal. `setupConnectedPath()`'s nonce stays as-is for the
  create flow, which returns on a marker; nothing is extracted.
- **The existing `isReconnecting` / `busy` state IS the "redirect under way" state**, so
  requirement 5's visible half already exists on every surface.

### Decision 2: the settle signal comes from the handler that already knows, plus a closed-sheet signal

`handleNativeAuthRedirect` already distinguishes every outcome — picker, declined, no code, calendar,
exchange success, exchange failure, state mismatch, unparseable stash. It settles a module-level
deferred armed by `startRedirectAuth`'s native branch.

**The case with no deep link at all** (the person taps Done on the sheet): `@capacitor/browser`
8.0.4 exposes `browserFinished` (verified in `definitions.d.ts:21`) and fires it on user dismissal,
not on our own programmatic `close()` on iOS. A `visibilitychange → visible` listener is the Android
backstop. Either signal starts a **2.5 s grace** which the deep link cancels; if nothing arrives the
trip settles `'dismissed'`. A false dismiss is visible in CloudWatch as `dismissed_*` followed by
`return_*` for one `start`.

### Decision 3: where the resume lives — RESOLVED: nowhere, because the caller IS the continuation

Settled against the code, and the answer was none of the three candidates:

- **(c) `router.replace({ force: true })` — premise TRUE, mechanism INSUFFICIENT.** vue-router 4.6.4
  skips the duplicate short-circuit under `force` and reassigns the `currentRoute` shallowRef, and
  `useRoute()` is a `shallowReactive` of getters over it — so a `watchEffect` reading `route.query`
  does re-run (`LoginPage.vue` already records this from experience). It is insufficient because only
  three things in the app read the route; Settings, the pod-access banner, the coordinator and the
  login recovery panel have no route watcher, and `RouterView` does not remount on a same-record
  navigation. So (c) needs per-surface listeners anyway — it is (a) with a different trigger — and it
  changes the sink for the picker, calendar and create returns. **Rejected as the mechanism; recorded
  so nobody re-tests the premise.**
- **(a) per-surface resume** would be the sixth copy of the marker + latch + immediate-watcher shape.
  Each existing copy needed its own loop guard, latch reset, dispatcher-liveness fix and nonce, and
  three review rounds found defects in them. **Rejected on DRY.**
- **(b) a seam-owned continuation** needs six call-site rewrites plus a closure that must survive a
  JS-context restart it cannot survive. **Rejected.**
- **What holds is (d):** on native the caller's stack survives, so its existing
  `reconnectSucceeded` branch is the continuation. The seam only has to not return until the trip
  settles. One primitive, zero per-surface code — and it lets us DELETE the one per-surface resume
  that exists.

The **JS-context-restart case** is unchanged and correct: the deferred dies with the context, the
deep link arrives at a fresh boot, and the listener completes the exchange and navigates to the
stored return path — the web-reload semantics every surface already handles.

### Decision 5: retire `RESUME_RECONNECT_LOAD` — validated scaffolding the seam makes redundant

With Decision 1, `LoadPodView`'s explicit marker becomes actively **wrong**, not merely unused: the
seam resolves `'reconnected'` in the first call and the marker's dispatcher branch would ALSO fire
`handleReconnectAndLoad({ isResume: true })` on the same return. Today's `!isReconnectBusy` guard
would swallow it, but a latched `autoReconnectLoad` re-read on a later remount reports a false
`reconnect_resume_no_file` warning. Two mechanisms for one return is the double-path this repo keeps
paying for. The marker, its dispatcher branch, prop, watcher, latch reset and the router guard's log
exclusion are deleted. **This is the one deliberate removal of code greg validated on a device**, so
it is the item pass 3 must re-verify and the first thing TestFlight must confirm.

### Decision 4: items 3, 4 and 5 — my recommendation is NOT HERE, with reasons

- **The triplicated cross-family predicate (item 3).** Genuinely worth fixing: three copies of a
  **data-loss** guard with three different null semantics, plus `setProvider` binding from
  `database.getActiveFamilyId()` while callers compare against
  `familyContextStore.activeFamilyId ?? currentUser.familyId`. But it is a data-loss guard, it spans
  `syncService` + `syncStore` + every `setProvider` call site, and it belongs with its own review —
  not bolted onto a reconnect-routing change. **Its own plan, next.** Recorded in `STATUS.md` with
  the three locations and the two null semantics so it cannot be lost.
- **`BaseModal`'s `p-4` (item 4).** Shared by eight surfaces; the `safeAreaStyle` docblock reasons
  about it explicitly. It is cosmetic and unrelated to reconnect routing. **Not here.**
- **`runGuarded` (item 5).** Rewrites four working paths in a file this session has already changed
  substantially, for no behaviour change. **Not here.** The create plan already recorded it as the
  follow-up for the next change that touches that file for its own reasons.

Including any of these would widen a native-auth change into a data-loss refactor plus a UI change
plus a four-path rewrite. That is the shape this area keeps breaking on.

## Approach

**Deliberately thin pending Decision 3.** Once pass 2 settles where the resume lives, the approach
section is written in full. What is already fixed:

1. Extract the per-attempt nonce from `resumePaths` into a shared helper both the create path and
   the reconnect seam use.
2. `useGoogleReconnect`'s default return path becomes current-path-plus-nonce, with the docblock
   rewritten from "a caller that cares MUST pass one" to a description of the safe default and why
   it exists.
3. `LoadPodView`'s explicit `RECONNECT_LOAD_PATH` also gains the nonce, resolving `STATUS.md:127(c)`.
4. The resume mechanism, per Decision 3.
5. `STATUS.md:127(b)` corrected to six surfaces; `(c)` resolved.

## Files Affected

**Modified (expected)**

- `src/composables/useGoogleReconnect.ts` — safe default return path, docblock
- `src/components/login/resumePaths.ts` — nonce extracted for sharing ⚠️ **OVERLAPS the uncommitted 2026-09-22 changeset**
- `src/components/login/LoadPodView.vue` — nonce on the explicit path
- `docs/STATUS.md` — corrected surface list
- Whichever surfaces Decision 3 selects
- `CHANGELOG.md` ⚠️ **OVERLAPS both uncommitted changesets**
- Tests

**Explicitly not touched**

- The cross-family predicate trio, `BaseModal`, `ResumePodSetup`'s envelopes (Decision 4)
- Every other file in the two uncommitted changesets

## Observability Coverage

Mirrors the create flow's funnel so the two are queryable the same way:

- **`reconnect-redirect-start`** — `logEvent` info on a `reconnect` surface, `context: { action, provider_type }`, emitted where the redirect is kicked off (the seam, so every surface gets it free).
- **`reconnect-redirect-return`** — the other half. **Without this, a resume that never runs produces nothing to query — which is exactly why this bug survived a prior fix round.** Started-versus-returned is the funnel.
- **`reconnect-resume-abandoned`** — a return that arrived with no continuation to run.
- Only already-allowlisted keys (`action`, `error_code`, `provider_type`, `route_path`). ⚠️ A review just caught `consent_denied` being silently stripped for not being allowlisted; do not repeat that.
- Nothing here is `critical`: a failed reconnect is recoverable and user-visible by design.

## Acceptance Criteria

- [ ] All six call sites reconnect in one tap on native; `LoadPodView` unchanged.
- [ ] A new reconnect caller that passes nothing gets the safe behaviour by default.
- [ ] A retry in the same mount works (`STATUS.md:127(c)`).
- [ ] A reconnect that never returns leaves an escapable state, not a spinner.
- [ ] `reconnect-redirect-start` / `-return` make the funnel measurable.
- [ ] `STATUS.md:127(b)` lists six surfaces.
- [ ] One nonce implementation, shared.
- [ ] `npm run validate` green; `npm run security:lint` green.

## Testing Plan

**Unit**

1. The default return path carries a nonce and differs across two calls; the explicit path still wins when passed.
2. The nonce survives a simulated JS-context restart (seeded, not a bare counter).
3. Decision 3's resume mechanism, including the no-continuation case.
4. If Decision 3 picks (c): a unit test against the REAL router proving `force: true` re-triggers a `watchEffect` reading `route.query` — the premise that deferred it.

**Browser** 5. Whatever Decision 3 makes drivable; anything OAuth-dependent goes to the manual list honestly.

**Needs greg's hands (native OAuth is `Browser.open` + `appUrlOpen`)** 6. TestFlight: let the Drive token lapse, tap reconnect on Settings → reconnects in ONE tap. 7. The same on the pod-access banner and the recovery panel. 8. Decline the consent → an escapable state, not a spinner. 9. Fail once, retry in the same mount → works on the second tap, not the third.

## Review Passes

- **Pass 1 (Initial draft)**: established the seam as the fix site and verified the scope is six call sites not three (three Settings sites were on no list); identified that a real navigation is necessary but NOT sufficient because nothing currently holds the intent; deliberately left Decision 3 open for pass 2 to settle against the code; recommended items 3/4/5 out of scope with reasons.
- **Pass 2 (DRY + error handling)**: pending
- **Pass 3 (Sustainability)**: pending
- **Pass 4 (Fresh-eyes sweep)**: pending

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

> fix whatever the review finds. once the code review is complete, please move ahead directly to
> address and fix the follow-up items with /beanies-build-auto

### Context from the preceding turn

> [greg chose "Ship as planned, follow up next" when asked how to handle the three deferred
> reconnect surfaces, and had earlier said: the setup and joiner flow must be smooth and seamless
> with minimal friction, because any small issue can cause a user to drop or churn.]

</details>
