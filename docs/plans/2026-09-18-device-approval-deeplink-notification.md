# Plan: Deliver the device-approval key through the bridge's own callback, instead of hoping for a route change

> Date: 2026-09-18
>
> ⚠️ **SUPERSEDED IN PART by `docs/plans/2026-09-18-cold-surface-direction-and-scanner.md`.**
> This plan's `markConsumed` instruction (the approach bullet and its acceptance criterion)
> was REVERSED during implementation: moving that call into `handle()` gave a single-slot
> launch-replay guard a second writer, so any warm routable link evicted the launch URL and
> re-armed the replay the guard exists to prevent. The shipped code marks only on the launch
> path, and the reasoning is in a comment there. Read this file as history, not as spec.
> Related issues: None. Direct implementation.
> Plan file: `docs/plans/2026-09-18-device-approval-deeplink-notification.md`

> **No GitHub issue created.** Approved for direct implementation. Full prompt history in `## Prompt Log`.

## User Story

As someone already signed in on my phone, I want scanning a cold device's approval code to actually open the approval sheet, so that the device-to-device sign-in shipped in 0.21.3 works at all on a real phone.

## Context

A **production defect in 0.21.3**. greg reproduced it on **both Android and iPhone**: a signed-out Chrome shows the cold-device approval QR, he scans it with the phone's native camera, the phone is signed in with beanies installed, and **the app opens and nothing happens**.

### The verified root cause

Re-derived from source twice, independently:

1. `inboundLinkBridge.ts:126` registers the `appUrlOpen` listener; `handle()` captures the marker at `:106` and navigates at `:115` to `/welcome#beanies-approve=...`.
2. `router/index.ts:414` holds `ALREADY_AUTH_REDIRECT_FROM = new Set(['/welcome','/login'])`, and the guard returns `{ name: 'Nook' }` at `:473`, which discards the hash.
3. A signed-in phone sits on `/nook` (`router/index.ts:79-82`). The redirect **also** resolves to `/nook`.
4. The only warm-path consumer is `watch(() => route.fullPath, ...)` at `App.vue:1035-1041`. The watched string is identical on both sides, so the callback never runs. (vue-router also rejects the push as a duplicate. Same outcome.)
5. `deviceApprovalKey` stays `null`, so `<DeviceApprovalSheet :open="deviceApprovalKey !== null">` (`App.vue:2020-2024`) never opens.

The comment above that watcher states the assumption that failed: _"the route change is the notification"_.

**The bug is route-dependent, not universal.** Had the phone been on `/activities`, `fullPath` would have changed and the watcher would have fired. This matters for testing: a passing manual test from the wrong starting route proves nothing.

**Native cold launch fails too, for a different reason.** `installInboundLinkListener` is called at `App.vue:1755` during setup, so `getLaunchUrl()` (`inboundLinkBridge.ts:139-153`) resolves after the one-shot `takeCapturedMarker` read at `App.vue:1031`, and delivery again falls through to the broken watcher.

**No consumer-side telemetry.** The bridge logs `inbound_link_routed` (`:108-114`) on every failing scan, so CloudWatch reported success while users saw nothing. That is why a feature broken for every native user produced no signal in `#beanies-errors`.

### Scope fact that shapes verification

**Native-only.** `installInboundLinkListener` returns early when `!isNative()` (`inboundLinkBridge.ts:64-65`), and there is no `appUrlOpen` on web. On web, `main.ts:26` captures at module scope and `App.vue:1031` reads it in `onMounted`, so **the web path works today and must not regress**.

Consequence: a hand-built link opened in a desktop browser passes against the **unfixed** code and proves nothing about this bug.

## Requirements

1. A signed-in device receiving an approval deep link opens `DeviceApprovalSheet`, regardless of the route it was on.
2. Works for a warm open and for a native cold launch.
3. Delivery does not depend on vue-router.
4. The key is delivered exactly once.
5. The web/PWA path is unchanged.
6. Telemetry makes this failure visible in CloudWatch without a repro, including a success-path signal so a rate is measurable.
7. Regression tests pin the broken behaviour and fail against the unfixed code.

## Approach

### The design: a second injected callback

`installInboundLinkListener` **already takes an injected callback** (`inboundLinkBridge.ts:64`), wired from `App.vue:1755`. Add a second one:

```ts
export function installInboundLinkListener(
  navigate: (path: string) => void,
  onApprovalKey: (key: string) => void
): void;
```

`handle()` reads the approval marker from the URL **after** the origin/path allowlist passes, and calls `onApprovalKey(value)` directly. `App.vue:1755` wires it to set `deviceApprovalKey`.

That is the whole mechanism. What it buys, point by point:

- **The warm case works** because delivery is a direct call, with no route involved.
- **The cold-launch race cannot exist**, rather than being repaired. The callback is bound at install time, and install is what _initiates_ `getLaunchUrl()`. There is no window in which a key can arrive before a consumer exists.
- **Take-once is trivial**: one call site, one assignment.
- **No TDZ hazard.** The wiring at `:1755` is far below `deviceApprovalKey`'s declaration at `:186`.

**Native no longer needs the capture map at all.** The bridge stops calling `captureHashMarkers`; `main.ts:26` keeps capturing for web, and `App.vue:1031`'s one-shot read stays exactly as it is. Two transports, each with the delivery mechanism that suits it, and neither pretending to be the other.

**Delete only the watcher** (`App.vue:1032-1041`, comment included). `:1031` stays.

#### Designs considered and rejected, so they are not rediscovered mid-build

- **A subscription/replay inbox** (`onMarkerCaptured` with replay, a `markerInbox.ts` module, a `useDeepLinkMarker` composable, an unconsumed-alarm timer and a test-only reset export). Rejected: it manufactures the cold-launch race and then solves it with replay. Binding the callback before `getLaunchUrl` starts removes the race outright, which deletes the inbox, the composable, the replay, the timer and two test files.
- **A shared `listenerRegistry` in `src/utils/`.** Rejected twice over: the eight existing hand-rolled sites are **broadcast** (`googleAuth.ts:2150,2166,2186`; `syncService.ts:632,641,693,718,758`), which cannot express take-once; and their dispatch is not uniform (`syncService.ts:582` guards, `:572,661,712,2084` are bare `forEach`), so migrating them is a behaviour change, not a refactor. Extract that primitive when the eight are migrated, from the eight.
- **A Vue `shallowRef` for replay.** Rejected on boot ordering: `main.ts:26` runs before `app.use(createPinia())` at `:31` and before `app.mount()`, so a reactive primitive there has no owning scope.

#### Two decisions this change must make deliberately

**1. Hold the key until init finishes.** Making cold delivery work newly exposes a hazard the broken watcher was hiding. On a native cold launch the launch URL resolves within milliseconds while init runs for seconds. `DeviceApprovalSheet` is mounted unconditionally and uses `BaseModal`'s default `z-50` (`BaseModal.vue:51`), while the init overlay is `z-[300]` (`App.vue:1942`), so the sheet would open _behind_ the spinner. Worse, the sheet's first branch is `v-else-if="!canApprove"` (`DeviceApprovalSheet.vue:207`), where `canApprove` needs `syncStore.familyKey` and a current member (`:60`), so before init completes it renders the "signed out here" panel whose Close button sets `deviceApprovalKey = null` (`App.vue:2023`) and destroys the only copy of the key.

**Decision: hold the delivered key in a local and assign `deviceApprovalKey` only once init has settled.** Accepting the transient is not viable when the Close button destroys the key.

**2. `markConsumed` placement.** It is currently called only on the `getLaunchUrl` path (`:151`). Call it **immediately after the `ROUTABLE_PREFIXES` check passes**, not "on every path": `handle()` returns early at `:71`, `:79-85`, `:90` and `:91-99`, and marking those consumed would poison the session slot for a URL the bridge deliberately declined. Note in the code that `alreadyConsumed` is only ever _checked_ on the `getLaunchUrl` path (`:142`), so a warm re-tap of the same link still works and nobody should "fix" that.

### Telemetry

New surface `deep-link`, behind a typed facade `src/services/telemetry/deepLinkEvents.ts`, per the house rule at `loginFlowEvents.ts:4-7` ("no view or service calls `logEvent` with a hand-typed event string"). Do **not** add it to `src/services/telemetry/index.ts` — that barrel's comment at `:15-19` explains that adding exports breaks the dozen test files mocking it as `{ logEvent }`.

| Event                    | Level | Context                        | Why                                                                                                                                         |
| ------------------------ | ----- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `approval_key_delivered` | info  | `action`, `kind`               | **The success-path signal**, the one that was missing. `kind` distinguishes `warm` from `cold-launch`, the variable that produced this bug. |
| `approval_key_dropped`   | warn  | `action`, `kind`, `error_code` | The URL passed the allowlist and carried a marker, but delivery failed (no consumer, or the consumer threw).                                |
| `marker_consumed`        | info  | `action`, `kind`, `route_path` | The web one-shot path, so both transports are measurable in one filter.                                                                     |

`route_path` comes from `window.location.pathname`, **never** `fullPath` or `href`: `docs/lessons.md:630` records a live incident where `fullPath` (path + query + **hash**) leaked private content into this allowlisted field, and on the web path the key _is_ in the fragment at that moment.

`kind` is mapped to a fixed enum inside `deepLinkEvents.ts`, so the marker vocabulary lives with the telemetry rather than leaking outward.

**No timer, and no `marker_unconsumed` event.** With delivery bound before a key can arrive, there is no captured-and-unclaimed state on the native path to alarm on. This removes a `Map`, two clear rules, a reset export and fake timers from every test.

**No new context key ships.** `action`, `kind`, `error_code` and `route_path` are already in `ALLOWED_CONTEXT_KEYS` (`diagnosticContext.ts:65,68,69,86`), and that file's comment at `:91-92` states these are deliberately reused per feature. So the Lambda mirror, `docs/runbooks/native-store-submission.md`, `PrivacyInfo.xcprivacy`, the store Data-Safety answers and `privacy.astro` are **untouched**. The key value is never logged.

**Known attribution gap, stated so a triager is not misled:** the web `marker_consumed` can ship without `family_id`, because `main.ts` capture runs before pinia exists and `enrichAndRedact` swallows the store miss (`diagnosticContext.ts:523-528`). Pre-existing, not a regression, but filtering by `family_id` misses those.

### Comments to correct

- `inboundLinkBridge.ts:128-138` is **not wrong**, it is incomplete: it describes the magic-link/invite case, where "warm taps work" is true because `/join` is excluded from the redirect (`router/index.ts:411-414`). **Extend it** to cover approval; do not rewrite it, because it is the only place the retained-event/first-listener knowledge is written down.
- `App.vue:178-185` says the key is read by `consumeHashMarker`. Already wrong today (it is `takeCapturedMarker`) and must be fixed in the same edit.

### `KIT_LINK_HASH` stays on its own path, deliberately

The kit's target device is **signed out** by definition, so `/welcome` is not redirected, `LoginPage` mounts, and `consumeHashMarker(KIT_LINK_HASH)` reads it straight off `window.location.hash` (`LoginPage.vue:369-378`). The failure's precondition is being signed in, so it cannot occur for kit. Adding kit to the bridge would create a second consumer racing `LoginPage` and risk breaking a working flow in a release whose purpose is fixing a broken one.

Genuine residual gap: a **warm** native kit scan (app running, signed out) would drop. Not reachable in the common path. Record it beside the capture site per `docs/lessons.md:525`.

### Run B

Run B's in-app scanner is a component that emits its decoded key upward to `App.vue`, which calls the same handler this change introduces. No global publish seam is needed, and nothing here has to be unpicked.

## Assumptions

> Verified against `9c4b39bc` on 2026-09-18.

1. `installInboundLinkListener` still takes exactly one injected callback (`inboundLinkBridge.ts:64`) and is still called from `App.vue:1755`.
2. `deviceApprovalKey` is still declared at `App.vue:186`, well above the `:1755` wiring.
3. `ALREADY_AUTH_REDIRECT_FROM` still contains `/welcome` and the guard still redirects by route **name**.
4. `action`, `kind`, `error_code`, `route_path` are all already allowlisted, so no store re-declaration is needed.
5. `iosShareAdapter.test.ts:17-23` still shows the working Capacitor-stub pattern for Vitest.

## Acceptance Criteria

- [ ] A warm approval link on a signed-in device sitting on `/nook` opens the sheet.
- [ ] A native cold launch opens the sheet, after init completes rather than behind the overlay.
- [ ] Delivery does not depend on a route change; the `route.fullPath` watcher is gone.
- [ ] The key is delivered exactly once.
- [ ] The web path is untouched and still works.
- [ ] The origin/path allowlist still runs before any delivery; a rejected URL delivers nothing.
- [ ] `markConsumed` sits after the allowlist check, not on the early-return paths.
- [ ] The two **true regression** tests fail against the unfixed code.
- [ ] No new telemetry context key; no new translation string.
- [ ] `npm run validate` green.
- [ ] `approval_key_delivered` fires with `kind` distinguishing warm from cold-launch.
- [ ] `inboundLinkBridge.ts:128-138` extended; `App.vue:178-185` corrected.

## Testing Plan

Three honest buckets, because a blanket "must fail first" bar cannot apply to all of them.

**Characterization** (pins existing untested behaviour; passes before and after):

1. `deepLinks.test.ts`: `readHashMarker` returns `null` when the marker is absent and falls back to the raw value on a malformed `%` escape (`deepLinks.ts:40-47`); `consumeHashMarker` strips the fragment with `{}` not `null` (`:65-66`).
2. A URL failing the origin or path allowlist delivers nothing. A **security guard**; it passes today.

**True regression** (MUST fail against the unfixed code — these pin the reported bug):

3. With `@capacitor/app` and `isNative` stubbed native (pattern at `iosShareAdapter.test.ts:17-23`), a warm `appUrlOpen` carrying an approval URL delivers the key **with no navigation whatsoever**. This is the exact failing case.
4. A cold launch via `getLaunchUrl` delivers the key even though it resolves after mount.

**New-API contract** (cannot fail first, since the API does not exist; still worth having):

5. The key is delivered once, not twice, when the same URL arrives on both paths.
6. A throwing consumer is caught, emits `approval_key_dropped`, and does not wedge the bridge for the next link.
7. The init gate holds the key and assigns it once init settles.

**Browser** (`scripts/design-screenshots/`, `playwright.design.config.ts` — **never `e2e/specs/`**, which has no `testIgnore` and is at 21 of a hard cap of 25 per ADR-007):

8. Signed in, load `/welcome#beanies-approve=<key>` as a real page load; the sheet opens. **This is the web regression guard and nothing more.** It passes on the unfixed code, because the web path was never broken. Delete the script afterwards.

**Needs greg's hands** (native-only; no desktop browser can prove this):

9. **iPhone, warm, starting from the Nook:** open beanies, background it, scan the approval QR from a signed-out Chrome. Pass: the sheet appears within a second or two. The starting route matters, because starting elsewhere can pass even unfixed.
10. **iPhone, cold:** force-quit beanies, then scan. Pass: the app launches, finishes loading, **then** the sheet appears. It should not appear during "counting beans".
11. **Android, warm and cold:** as above.
12. **End to end:** approve on the phone, then confirm the cold Chrome actually opens the pod, so the fix delivered a usable key and not merely a sheet.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted a notification channel on `deepLinks.ts` with replay, a composable consumer seam, four telemetry events, and a test plan barred on failing against unfixed code.
- **Pass 2 (DRY + error handling)**: Caught four stale `inboundLinkBridge.ts` line references (the "misleading comment" target was `:128-138`, not `:157-169`) and a cited `docs/lessons.md` heading that does not exist; moved telemetry behind a typed facade per `loginFlowEvents`' no-hand-typed-events rule; made take-once structural by switching to a per-marker API; split the must-fail-first bar off the characterization tests. Recommended extracting a shared `listenerRegistry`, which Pass 3 overturned.
- **Pass 3 (Sustainability)**: Cut the shared `listenerRegistry` — the eight existing sites are broadcast, which cannot express take-once, and 4 of 8 dispatch unguarded so migrating them is a behaviour change; split state out of `deepLinks.ts`; moved error presentation out of the composable via `onError`; added a publish seam for Run B.
- **Pass 4 (Fresh-eyes sweep)**: Re-derived the root cause from source and confirmed the fix works, then **replaced the design with a materially simpler one** — a second injected callback on `installInboundLinkListener`, already called from `App.vue:1755`, which dissolves the cold-launch race rather than repairing it and deletes the inbox module, the composable, replay, the unconsumed timer, the reset export and two test files. Also found Pass 3's boot-cost justification for splitting `deepLinks.ts` was false (`main.ts:7` already pulls `logEvent`→`diagnosticContext`→pinia nineteen lines before the capture), corrected twelve stale line references including the e2e budget (21 of 25, not 23), caught that reliable cold delivery newly opens the sheet behind the `z-[300]` init overlay over a `!canApprove` pod whose Close button destroys the key, fixed `markConsumed` placement from "every path" to after the allowlist, and recategorised six tests misfiled under the must-fail-first bar.

> **Note on process:** Passes 2 and 3 reviewed a design that Pass 4 replaced. The current design is simpler and strictly smaller in blast radius, and Pass 4 verified it requirement by requirement, but it has **not** itself been through a DRY or sustainability pass. Re-running Passes 2 and 3 against it is available on request.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial report (greg, 2026-09-18)

> regarding this method - i've just updated the app on my android and iphone to 0.21.3 (latest) and tried scanning a QR code on my chrome browser with the camera app on both phoens. in both cases, the beanies app opens and nothing happens. i don't get any prompt to "approve this login" or anything to that effect. It appears there may be a bug here - can you check?

### Clarification (greg, 2026-09-18)

Asked which QR was on screen and whether Chrome was signed in. Answer: **"Signed out, showing its own code"** — the cold-device pull QR, phones signed in.

### Sequencing (greg, 2026-09-18)

> let's investigate these bugs and questions before we start implementation

### Go-ahead (greg, 2026-09-18)

> go, and fold 3 into 2 if that is your recommendation. should we implement directly, or go through beanies-plan and beanies-build-auto? ... though either way, we should run it through beanies-build-auto, ensure the impelemtnation is reviewed, and the proper tests and created to pin the functionality that was broken

### Verification direction (greg, 2026-09-18)

> for run A please go ahead to test yourself if possible using a link you build - given this bug was cross device, as long as it works in a local browser we can take this as validation for now

Recorded with a correction: the web path is not broken, so a hand-built link in a desktop browser passes against the unfixed code and validates nothing. The native path must be driven with a stubbed Capacitor. See Testing Plan items 3, 4 and 8.

</details>
