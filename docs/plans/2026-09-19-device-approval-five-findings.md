# Plan: Device approval — five production findings from 0.21.4 device testing

> Date: 2026-09-19
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-09-19-device-approval-five-findings.md`

## User Story

As a family member signing a new device into my pod, I want the approval to actually appear when I
scan the code, to take one approve plus my PIN, and to tell me the truth about whether it saved, so
that getting a second device in is a thirty-second job rather than a thing I retry and distrust.

## Context

0.21.4 shipped the device-approval rework (cold-surface direction flip, in-app scanner, hybrid PIN
pad, consolidated sign-in chooser) to web, iOS TestFlight and Android open testing. greg tested it
on real devices and found five defects. One of them is a regression introduced in this session by
the fix for the _previous_ device-approval bug, which means the headline feature is currently dead
on cold launch in shipped code.

greg's verbatim findings:

1. In-app "use camera" scan: "almost every time i get the error message that a qr code could not be
   found in the photo... about 90% of the time. Reading the qr code with the native camera app
   directly is much more reliable."
2. "When reading a 'pull' qr code with the native camera app, if the app is closed/killed it will
   open the app, but nothing happens. It just opens to the nook screen and there is no approval
   modal."
3. "IF the app is already open when i read the pull qr code with the camera, i did see the approval
   modal, but it seems that it was not placed at the top layer, it was behind an existing 'sign in
   on another device' modal."
4. "The amount of approvals on the pull approval modal seems excessive. I think one approve + pin is
   all we need here."
5. "After approving from the approval modal, i received an error message that the approval could NOT
   be saved to the family file. But about 10s later the device requesting approval appeared to have
   decrypted the file. There is some issues with delays/validations here, and also it is not clear
   what is happening on the device requesting the approval."

## Root causes (verified against the working tree at `eb67bbe7`)

**F1 — the decoder is weak by construction, and the codes it reads are low-contrast by
construction.** Two independent causes, and the second is the larger one:

- **Every beanies QR is Heritage Orange on white.** `generateInviteQR` (`src/utils/qrCode.ts:69-84`)
  is the ONLY minting path in the app — invite, device link, approval request and recovery kit all
  route through it, directly or via `renderQr` — and it draws `dark: '#F15D22'` on `light:
'#FFFFFF'`. jsQR binarises on Rec.709 luma (`node_modules/jsqr/dist/jsQR.js:421`:
  `0.2126*r + 0.7152*g + 0.0722*b`). Heritage Orange resolves to **luma 120** against white's 255 —
  roughly **half** the module/background separation a black-on-white code would give. Add a phone
  photo's JPEG 4:2:0 chroma subsampling (which smears exactly the colour channel carrying the
  signal), auto-white-balance, and a bilinear downscale, and the adaptive binariser is being asked
  to threshold a washed-out image. That is a far better explanation of "90% of the time" than
  resolution alone, and it is why the native camera — scanning a full-resolution, uncompressed
  sensor feed continuously until it locks — wins so decisively.
- **One attempt, one scale.** `src/utils/qrDecode.ts:17` sets `MAX_DIM = 1600` and
  `decodeQrFromBitmapSource` downscales EVERY image to that before a SINGLE
  `jsQR(imageData.data, width, height)` at line 54, with no retry at another scale and no crop.

WARNING — **Correction to a premise carried in the first draft:** jsQR's DEFAULT `inversionAttempts`
is already `'attemptBoth'` (`jsQR.js:362`). Passing it explicitly is a no-op and must not be
presented as part of the fix.

Two further defects in that file, both latent:

- `canvasUnavailable` is **module-level mutable state** (`qrDecode.ts:14`) reset per call. There are
  two live `useQrCapture` instances (`ColdSignInPanel.vue:73` and `SignInCodeSheet.vue:75`), so two
  overlapping decodes can cross-contaminate the reason code and mis-tell a user their device is
  unsupported.
- The `ImageBitmap` is **never closed**, so every scan leaks a full decoded frame until GC.

And one fact that shapes the whole F1 design: **`qrDecode.ts` has no unit test today and, as
currently written, cannot have one.** The test environment is `happy-dom` (`vitest.config.ts:10`),
and happy-dom's `canvas.getContext('2d')` returns **`null`** (verified by running it), while
`createImageBitmap` IS defined. Every call into `decodeQrFromBitmapSource` under test therefore
takes the `unsupported-device` branch without ever looking at a pixel. Any plan that adds decoding
cleverness behind `getContext` adds cleverness that no unit test in this repo can reach. See §5.

**F2 — a regression introduced this session.** `src/App.vue:273-276` passes
``sessionKey: computed(() => `${familyContextStore.activeFamilyId ?? 'none'}:${familyStore.currentMember?.id ?? 'none'}`)``.
That composite is NEVER null — it begins life as the string `'none:none'`. But
`src/composables/useDeviceApprovalDelivery.ts:137` guards the session-change discard with
`if (prev != null && next !== prev) discard('session-changed')`, a guard written when the value was
nullable and `null` meant "not hydrated yet" (its docblock says `prev != null` IS LOAD-BEARING and
explains exactly this). So every hydration step (`'none:none'` -> `'fam-x:none'` -> `'fam-x:mem-y'`)
now reads as a session change and throws the held key away. Cold launch reproduces the original
0.21.3 signature exactly: a `held` event, a `dropped` event, no `delivered` event.

The existing regression test (`useDeviceApprovalDelivery.test.ts:166`) passes only because it seeds
`null` and moves to `'fam-1'` in ONE step. App.vue produces THREE steps. The test asserted the fix,
not the shape the call site actually emits.

**F3 — DOM order, not open order.** `<DeviceApprovalSheet>` is at `src/App.vue:2091`, and
`<AppHeader>` (which owns `SignInCodeSheet` at `AppHeader.vue:653`) is at line 2391. `BaseModal`
teleports to `<body>`, so the approval sheet's node lands EARLIER. Neither passes `layer`, so both
sit at `base` (z-50) and the tie breaks on document order — the approval sheet loses. Note that
`SignInCodeSheet.vue:85-88` already closes itself when IT produces the key; the uncovered case is a
key arriving from a different transport (native deep link) while that sheet is open.

**F4 — four screens, one of them avoidable. But the button weighting is NOT part of the defect.**
`DeviceApprovalSheet.vue` branches `done` (286) -> `needsInterstitial` (299) -> `!canApprove` (321)
-> `scanned` (333). The interstitial is a whole separate step whose two buttons are BOTH
`variant="secondary"`, so they carry identical weight — greg's "excessive" complaint is literally in
that markup.

**Pass 4 correction, and it changes the shape of this finding.** The draft proposed reversing the
documented equal-weight Approve/Reject rule and demoting Reject from `outline` to `ghost`. That is
not required, because **the compare panel's buttons are already weighted**: `DeviceApprovalSheet.vue:352`
is `variant="primary"` (filled Heritage Orange) and line 362 is `variant="outline"` (bordered grey).
The component docblock at lines 11-16 claiming "APPROVE AND REJECT ARE EQUALLY WEIGHTED… Both
actions are full-width and equally reachable" is **already factually wrong about its own markup** —
only the "full-width" half is true. greg's finding #4 is about the _number of steps_, not the button
weights. So requirement 8 is already satisfied in shipped code and **no security control is reversed
by this work**. The docblock is corrected to match reality, not reversed on a new decision.

Separately, the `done` / `!canApprove` branches are the SAME panel written twice (semibold title
`<p>`, soft body `<p>`, one full-width button), and a third copy would be added by F5's `pending`.

**F5 — a four-state outcome collapsed into a boolean, and no success counter on the approver
side.** `syncStore.ts:499-501` reads `const outcome = await syncNowDurable(...); if (outcome === 'saved')
return true;` and the comment directly below already says "'timeout' IS NOT 'failed'. On a timeout
the upload may still be in flight." `syncNowDurable` (`syncStore.ts:1174-1176`) returns
`'saved' | 'failed' | 'timeout' | 'unknown'`. `putEnvelopeEntry` flattens all four to `boolean`, and
`DeviceApprovalSheet.vue:254-259` renders any `false` as `deviceApproval.publishFailed`. greg's wrap
timed out, he was told it failed, and it landed ~10s later.

Two things the first draft got wrong here:

- `DeviceApprovalSheet.vue:260-262` sets `done.value = true` and emits **nothing**. There is no
  approver-side success event at all, so any new "unconfirmed" outcome would ship **without a
  denominator** — precisely the blind spot `deepLinkEvents.ts:9-14` was created to close.
- The `'failed'` branch emits telemetry but never calls `reportError`, so a genuine publish failure
  reaches CloudWatch as a bare `warn` with no stack and prints nothing to the console for a
  developer.

Second half of F5: `DeviceApprovalRequest.vue:182-183` emits `approved` with no user-facing success
state, so the requesting device just jumps.

## Requirements

1. A device-approval key delivered during cold launch must survive the full three-step session
   hydration App.vue produces, and must still be discarded on a real sign-out or person switch.
2. The delivery gate's session contract must be shaped so a call site _cannot_ reintroduce F2.
3. A publish that times out must NOT be reported to the approver as a failure. It must say the save
   is still in flight and that the other device will pick it up.
4. The device that requested approval must show an explicit success state before it moves on, and
   must stop showing a live QR code the moment it does.
5. The approval sheet must render above `SignInCodeSheet`, and the reauth PIN gate must still render
   above the approval sheet.
6. `SignInCodeSheet` must not leave the user stranded behind a stacked modal after an in-app scan —
   by **one** mechanism, owned by **one** component.
7. Approving must be one Approve plus the PIN. The provenance warning must survive **in the compare
   panel, above the fingerprint, as a visible warning callout with an intent-binding Approve label**
   — not as an easily-skimmed sentence, and not as a separate step.
8. Approve must be visually dominant; Reject must be visibly secondary. **Already true in shipped
   markup (`primary` / `outline`) — this requirement is satisfied by changing nothing, and the
   component docblock is corrected to stop claiming otherwise.**
9. The photo decoder must succeed on a phone photo taken at normal distance, where the code occupies
   roughly a quarter of the frame, **without freezing the UI for the duration**.
10. No `getUserMedia`, no viewfinder, no Android `CAMERA` permission (see Out of Scope).
11. No path added or touched by this work may end in silence: every abandoned key, every refused
    publish and every exhausted decode emits a structured event, and every user-facing failure
    carries both a person-readable sentence and a developer-readable console/CloudWatch record.
12. **Every new decision this work adds must be reachable by a unit test in `happy-dom`, or be
    stated explicitly as browser-only and covered by the Playwright/manual list.** No logic may be
    added behind an API the test environment does not implement without an injectable seam.
13. **No telemetry field may carry two vocabularies on one surface.** `deepLinkEvents.ts:38-46`
    records this exact defect being made and fixed once already; the F1 work must not repeat it.

## Important Notes & Caveats

- **`layer="top"` on the approval sheet would break the approve flow.** `ReauthGateModal` sits at
  `layer="overlay"` (z-[60], `ReauthGateModal.vue:33`) and its docblock states `layer="top"` would
  bury it. The approval sheet therefore goes to `overlay` (z-[60]) too, above `SignInCodeSheet`'s
  `base` (z-50).
- **Pass 4: the `layer` attribute goes INSIDE `DeviceApprovalSheet.vue`, on its own `BaseModal` —
  not on the `<DeviceApprovalSheet>` call site in `App.vue`.** Written at the call site it would
  _work_, by attribute fallthrough onto the single root `BaseModal` which declares `layer` as a prop
  — but it would work invisibly, and `App.vue:2098-2100` already carries a comment warning about
  precisely this hazard ("A binding here would fall through as a stray attribute"). A z-order this
  flow depends on must not be an implicit fallthrough. **Consequence for the landing order:
  Commit A touches `DeviceApprovalSheet.vue` for this one attribute** — see §Landing Order.
- **Do NOT invent an in-between tier.** z-[55] is the obvious "above base, below overlay" value and
  it is **already taken twice** — `BaseSidePanel`'s `raised` layer (`BaseSidePanel.vue:56`) and
  `MagicBeansSheet`'s backdrop (`MagicBeansSheet.vue:37`). Adding a third claimant would create a
  new equal-z tie instead of removing one. `overlay` it is.
- **Why the `overlay`/`overlay` tie against the reauth gate resolves the right way**, stated once so
  the browser check knows what it is confirming: `BaseModal` teleports to `<body>` and Vue inserts
  the teleport anchor when the _Teleport_ mounts. `DeviceApprovalSheet`'s `BaseModal` is
  unconditional, so its anchor is placed at App setup. `ReauthGateModal`'s `BaseModal` carries
  `v-if="state.member"` (`ReauthGateModal.vue:29`) and `state.member` can only become truthy via a
  `requireReauth` call, which cannot have happened at App setup — so its anchor is appended
  **later**, always, and at equal z the later node paints on top. This is the identical mechanism
  that file's own docblock already relies on for its `PasswordModal` sub-flow. **It must still be
  verified in a browser, both directions**, because a z-order that depends on mount order fails
  _silently_ — an invisible modal and a dead flow, exactly what `BaseModal`'s `gate` docblock
  describes. If it fails, the deterministic fallback is to promote `ReauthGateModal` to a new tier
  ABOVE `overlay`, never to hand-patch a z-index at a call site.
- **CORRECTED AFTER REVIEW — Escape does NOT close both stacked modals.** This caveat
  originally claimed `BaseModal` registers an unconditional `useEscapeClose` per open modal with
  "no overlay stack", so one Escape would dismiss the approval sheet and `SignInCodeSheet`
  together. That is false: `useEscapeClose.ts:25-38` keeps a module-level `escapeStack` and a
  single shared window listener, and its own comment states it closes "only the TOP-MOST one...
  rather than collapsing every layer at once". Escape therefore returns the person to the sheet
  below, exactly as the backdrop and X paths do. §3's argument is unaffected and in fact
  stronger. **Do not "fix" the behaviour described in the original caveat — there is nothing
  wrong with it.**
- **Widening `putEnvelopeEntry`'s return from `boolean` to a string union is a silent-regression
  trap.** `if (!published)` where `published` is `'failed'` does NOT enter the branch, and
  TypeScript will not flag it, because every non-empty string is truthy. The mitigation is to
  **rename** the functions in the same change so nothing compiles until each call site is
  deliberately rewritten. Do not widen the return type while keeping the name.
- **Every branch on `DurableSaveOutcome` is a `switch` with `assertNever`** (`src/utils/assertNever.ts`),
  never an `if`/`else` chain. A fifth outcome must fail the build, not fall through to a default.
- `putEnvelopeEntry` has three callers inside `syncStore.ts` (lines 6169, 6219, 6289) and zero
  outside. The two non-approval callers must keep their current behaviour exactly
  (`outcome === 'saved'`), including the documented magic-link KNOWN GAP at line 500, which is
  explicitly out of scope here.
- **Do not delete the provenance warning, and do not weaken it to a sentence.** It closed a live web
  security hole this session (an approval marker accepted from any path). Folding the step is
  greg's call and is defensible _only_ with the compensations in §4: a visible warning callout above
  the fingerprint, fail-safe on `delivery === null`, and an Approve label that states what the
  person is asserting. See the security note below.
- **SECURITY NOTE, stated plainly because this flow hands over the family key.** After the fold, the
  only _forcing_ control on the approve path is the PIN gate (`requireReauth`), which proves
  possession of the device and knowledge of the PIN — it does not prove _intent to admit this
  particular device_. The fingerprint comparison and the provenance warning are both advisory: a
  person can approve without performing either. That is a real reduction from a blocking
  interstitial and it is why §4 adds the two compensating controls rather than just deleting the
  step. What is NOT being given up: Approve/Reject weighting is unchanged (finding F4 above), Reject
  stays `outline` and full-width, and the phishing observable survives with a better denominator
  (`action: 'rejected'` and `error_code: 'request_dismissed'`, both segmented by `kind: <delivery>`,
  which the old single-purpose event could never rate). If those two segmented rates ever go to
  zero while non-`in-app-scan` approvals stay high, the fold has stopped being honest and the
  interstitial should come back — record that trigger in the docblock.
- **The equal-weight docblock is being CORRECTED, not reversed.** `DeviceApprovalSheet.vue:11-16`
  asserts in capitals that Approve and Reject are "equally weighted" and "both full-width and
  equally reachable". Only the second half is true of the markup below it. Rewrite it to say what
  the design actually is and why: Approve is `primary` because it is the action the person came to
  perform, Reject is `outline` and full-width because declining must stay a real, visible, one-tap
  choice, and neither is `danger` (declining is the safe outcome; the CIG reserves red for
  destructive confirmations). Add the anti-phishing rationale that now rests on the PIN gate, the
  fingerprint and the provenance callout, plus the zero-rate trigger above.
- The `approval_interstitial_dismissed` event loses its only emitter when the step is folded. The
  signal it carried is preserved and improved by tagging every approver-side outcome with the
  delivery kind.
- `kind` and `error_code` are already in `ALLOWED_CONTEXT_KEYS` (`src/utils/diagnosticContext.ts:61-90`),
  and `detail` is at line 199. **No new context key ships.** One line is added to the diagnostics
  row of `docs/runbooks/native-store-submission.md` naming the new `qr-decode` surface, following
  the identical "NO NEW KEYS AND NO NEW DATA CATEGORY" precedent already recorded there for #86.
- `deviceApproval.` is already on the **important-surface beanie floor**
  (`src/services/translation/uiStrings.test.ts:137`). Every new key's `beanie` value keeps the real
  nouns — "device", "family file", "saving" — and only drops case.
- Three docblocks state the no-`getUserMedia` position deliberately (`useQrCapture.ts:11`,
  `ColdSignInPanel.vue:14`, `DeviceApprovalSheet.vue:7`). If the F1 work changes what they claim
  about the decoder, update them honestly rather than leaving them stale.
- **The F1 ladder must not own telemetry, and must not own the canvas.** The in-repo precedent is
  `src/services/ai/recipeSourceResolver.ts`, whose docblock states the rule this work follows
  verbatim: the ladder is "a pure-ish function with an injectable dependency", the caller "becomes a
  flat switch over the outcomes", and it "never extracts, never persists, never toasts". A ladder
  that calls `logEvent` cannot be unit-tested without mocking telemetry, and a ladder that calls
  `getContext` cannot be unit-tested at all in happy-dom. Both stay outside it.
- **No new telemetry facade file for the QR events.** `loginFlowEvents.ts` and `deepLinkEvents.ts`
  exist because many call sites emit onto one surface. QR decoding has exactly ONE emitter
  (`useQrCapture`, which already owns the only `reportError` for a decode), so a third facade module
  would be a file for one consumer — below CLAUDE.md's extract-at-two threshold (line 328). The
  payload shape is defined once, in `useQrCapture.ts`, which is what the facade rule is for.
- **This plan lands as three sequential commits, not one.** See §Landing Order. The repo commits
  straight to `main` with linear history (CLAUDE.md:490), so this is three commits in order, each
  independently `npm run validate` green and each independently revertable — not three branches.

## Assumptions

1. `eb67bbe7` is HEAD and the tree is clean. Verified at plan time.
2. `BarcodeDetector` appears nowhere in the repo today (verified by grep over `src/` and `web/`) and
   is absent from happy-dom, so unit tests exercise the injected-decoder path unless explicitly
   stubbed. The feature-detect is therefore an injected dependency of the pure ladder, never a
   bare global read inside it.
3. `familyContextStore.activeFamilyId` and `familyStore.currentMember?.id` remain the two values
   that define a session for this purpose (per the docblock at `App.vue:259-265`: `clearSession`
   touches auth state only, so family id alone is not a session).
4. No Help Center article documents the device-approval flow (checked: `src/content/help/*.ts` has
   no coverage), so no article work is required.
5. **CORRECTED IN PASS 4.** No CloudWatch alarm or terraform metric filter keys on
   `device_approval_outcome`, on the `qr decode failed` report, or on any `surface` value this work
   touches (verified by grep: the only `metric_filter` blocks in the repo are
   `infrastructure/modules/content-fetch/main.tf` and `.../ai-extract/main.tf`, neither of which
   references these). So normalising `error_code` casing and adding a `qr-decode` surface breaks no
   existing alerting. **However, the draft's claim that `outcome: 'expired'` has no emitter is
   false** — `DeviceApprovalRequest.vue:235` emits it when the requesting device's own window
   elapses, and `docs/plans/2026-09-18-scan-to-sign-in.md:487` records it as a deliberate signal
   ("separating 'user walked away' from 'write failed'"). `'expired'` stays, on the requester side.
6. `happy-dom` returns `null` from `canvas.getContext('2d')` and does implement `createImageBitmap`
   and `ImageData`. Verified by running it at plan time. The repo has no `canvas`/`node-canvas`
   devDependency and this plan does not add one (a native build in CI for one test file is a poor
   trade).

## Approach

Built in greg's stated priority order, which is ordered by user harm.

### 1. F2 — make the session contract unbreakable

The bug is that the composable's nullability contract lived in a comment while the call site owned
the value's shape. Move the contract into the composable so it cannot be broken from outside.

- `useDeviceApprovalDelivery` stops taking `sessionKey`. It takes `familyId: Ref<string | null |
undefined>` and `memberId: Ref<string | null | undefined>` and derives the key internally with a
  `computed`: both present -> `` `${familyId}:${memberId}` ``; either missing -> `null`.
- `null` now means exactly one thing: "no identifiable session here". The discard fires on the
  transition AWAY from a known session (`prev != null && next !== prev`), which is what the original
  guard meant and what the docblock already describes.
- `App.vue` passes `computed(() => familyContextStore.activeFamilyId)` and
  `computed(() => familyStore.currentMember?.id)`. A call site can no longer supply a never-null
  value, because it no longer supplies the key at all.
- Update the composable's docblock to state the contract in terms of the two inputs, and to record
  that a _momentary_ loss of either (a member re-read, say) is deliberately treated as a session
  exit and discards the key — the conservative direction, and the only one that keeps the sign-out
  guarantee intact.

Walk the four transitions to confirm the fix and the guarantee both hold:

| transition                                          | derived key                        | behaviour                                                                           |
| --------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------- |
| cold launch `(∅,∅)` -> `(fam,∅)` -> `(fam,mem)`     | `null` -> `null` -> `'fam:mem'`    | watcher fires once, `prev === null`, **key survives**                               |
| sign-out `(fam,mem)` -> `(fam,∅)`                   | `'fam:mem'` -> `null`              | `prev != null`, **discard `session-changed`**                                       |
| switch person `(fam,m1)` -> `(fam,∅)` -> `(fam,m2)` | `'fam:m1'` -> `null` -> `'fam:m2'` | **discard on the first step**                                                       |
| surface usable before member known                  | key stays `null`                   | `delivered` may fire; sheet shows its `!canApprove` panel — pre-existing, unchanged |

**One more change in the same file, removing duplication rather than adding code:**

- `dismiss()` becomes `discard('dismissed')`. Today (`useDeviceApprovalDelivery.ts:176-180`) it is a
  byte-for-byte copy of `discard`'s body minus the emit — which means a key abandoned by tapping the
  backdrop or the X vanishes with **no terminal event at all**, so `approval_key_held` /
  `approval_key_delivered` have no closing entry and the funnel does not add up. One line replaces
  three and closes the hole. (A Reject tap produces both `device_approval_outcome: rejected` and
  `approval_key_dropped: dismissed`; the former is the authoritative one and the docblock says so.)

**No `hasPending` member is added.** The composable's public surface stays at four members, and
there is no second, subtly-different "is there a key" boolean sitting next to `approvalKey` for a
future reader to pick wrongly — the gated/ungated distinction between them is a bug waiting to be
written. See §3.

Regression test: drive the THREE-step hydration (`undefined/undefined` -> `fam/undefined` ->
`fam/mem`) and assert the key is delivered, not dropped. Keep the existing sign-out and
switch-person tests, expressed through the new inputs. Add one asserting `dismiss()` emits
`approval_key_dropped` with `error_code: 'dismissed'`.

### 2. F5 — carry the outcome instead of a boolean

- Name and export the union once: `export type DurableSaveOutcome = 'saved' | 'failed' | 'timeout' |
'unknown'` (currently inline at `syncStore.ts:1176`). `syncNowDurable` returns it.
- `putEnvelopeEntry` -> **renamed** `publishEnvelopeEntry`, returning `DurableSaveOutcome` rather
  than `boolean`. The rename is the safety mechanism, not cosmetics: it forces every call site to be
  rewritten rather than silently mis-reading a truthy `'failed'`.
- `setDeviceApprovalWrap` -> **renamed** `publishDeviceApprovalWrap`, returning `DurableSaveOutcome`.
- The two non-approval callers (6219, 6289) become `=== 'saved'` and keep their exact current
  behaviour. The magic-link KNOWN GAP is untouched and its comment stays.
- `DeviceApprovalSheet.approve()` ends in a **single exhaustive `switch`** over `DurableSaveOutcome`
  with `assertNever` in the default:
  - `'saved'` -> the `done` terminal state, **and now emits a success event** (see Observability).
  - `'timeout' | 'unknown'` -> a new `pending` terminal state. NOT an error, NOT red, NOT Heritage
    Orange — nothing has gone wrong. Copy says the approval is made and is still **saving** (the
    repo's term; never "syncing"), and the other device will pick it up as soon as it lands.
  - `'failed'` -> the existing `deviceApproval.publishFailed` error path, **plus** a
    `reportError({ severity: 'warning' })` carrying the outcome in `context`, so a developer gets a
    console line and CloudWatch gets a record with a cause rather than a bare `warn`.

#### The outcome event: one event, two vocabularies, enforced by the type

Six values on one field is not itself the problem. The problem is that they belong to **two
different actors** and the payload says nothing about which:

| emitted by                                    | values (verified by grep, Pass 4)                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `DeviceApprovalRequest.vue` (the cold device) | `ok` (182), `expired` (235), `failed` (179, 194, 224, 246)                                        |
| `DeviceApprovalSheet.vue` (the approver)      | `rejected` (220, 279), `failed` (175, 209, 216, 235, 257, 265), + new `published` / `unconfirmed` |

Splitting into two event names was considered and rejected: the approver's five existing failure
codes (`no_family_key`, `request_dismissed`, `request_superseded`, `gate_declined`, `publish-failed`)
already live on `device_approval_outcome`, and splitting would either strand them or force a
migration for no operational gain. One event, one vocabulary.

Instead, **make the payload a discriminated union so the two vocabularies cannot be crossed and the
approver's `delivery` cannot be forgotten**:

```ts
export type DeviceApprovalOutcomeEvent =
  | { side: 'requester'; outcome: 'ok' | 'expired' | 'failed'; errorCode?: RequesterErrorCode }
  | {
      side: 'approver';
      outcome: 'published' | 'unconfirmed' | 'rejected' | 'failed';
      delivery: DeliveryKind | null;
      errorCode?: ApproverErrorCode;
    };

export function emitDeviceApprovalOutcome(e: DeviceApprovalOutcomeEvent): void;
```

- `side` is a **compile-time discriminant only**. It is NOT emitted, so no new context key ships and
  no store data-collection declaration changes. Its entire job is that
  `emitDeviceApprovalOutcome({ side: 'approver', outcome: 'published' })` does not compile without
  `delivery`, and `{ side: 'requester', outcome: 'ok', delivery: … }` does not compile at all.
- The emitted shape is unchanged in structure: `action: <outcome>`, optional `error_code`, plus
  `kind: <delivery>` on approver-side emissions. (`action` is the field name — `loginFlowEvents.ts:276`
  — not a field literally called `outcome`; alert expressions are written against `action`.)
- Level stays derived, not passed: `ok` and `published` are `info`; everything else is `warn`.
- **`'expired'` STAYS.** Pass 4 found it has a live emitter (`DeviceApprovalRequest.vue:235`) and a
  documented purpose. The draft's "remove it, grep confirms no emitter" instruction was wrong and
  must not be carried out; the `side` discriminant is what makes its requester-only, `delivery`-free
  shape explicit.
- `'unconfirmed'` rather than `'failed' + error_code` because folding it into `failed` moves the
  exact defect being fixed from the UI into CloudWatch: any rate grouped on `action: 'failed'` would
  count a write that probably succeeded as a failure, and the whole finding is that these two must
  be distinguishable. The `DurableSaveOutcome` (`'timeout'` / `'unknown'`) rides along as
  `error_code` so the two sub-cases stay separable.
- `'published'` is the member the first draft missed, and it is not optional. The draft asserted
  the approver's success "is measurable via the absence of an error code" — it is not: the `done`
  path emits **nothing today**. Without a success counter, `unconfirmed` has no denominator and
  the rate cannot be computed, which violates CLAUDE.md observability rule 6.
- `'published'` is deliberately NOT `'ok'`. `'ok'` means "the cold device actually got in"; with
  `side` in the type, that distinction is stated in the type rather than only in a comment.
- **`error_code` values are normalised to snake_case in the same change, on BOTH sides.** Today the
  same event carries `no_family_key` and `request_dismissed` alongside `publish-failed`,
  `approve-threw`, `poll-failed`, `qr-unavailable`, `request-failed` and — via
  `DeviceApprovalRequest.vue:179` passing `opened.reason` straight through — `no-pending`, `payload`
  and `decrypt` (`syncStore.ts:3244`). Any hand-written CloudWatch filter has to guess. The two
  `ErrorCode` string-literal unions above make the full set explicit and make a kebab value a
  compile error; the pass-through at line 179 maps `opened.reason` through a small
  `Record<'no-pending'|'payload'|'decrypt', ApproverErrorCode>`-style literal so no dynamic string
  escapes the type. Assumption 5 confirms nothing queries the old forms.

#### The requesting device's success state

`DeviceApprovalRequest.vue` gains an `approved` ref, set immediately after
`openPodWithFamilyKey` succeeds and before `emit('approved')`.

- **Reuse, do not hand-roll:** the state is `BeanieSpinner` (`size="md"`) — the app's canonical
  in-progress visual, already used for exactly this purpose in `SignInCodeSheet`'s mint step — under
  a one-line success sentence.
- **The live QR and fingerprint MUST hide when it appears.** `DeviceApprovalRequest.vue:280` and
  `:293` gate on `qr && !expired && !failed` and `fingerprint && !expired && !failed`; both gain
  `&& !approved`. Without this the success state renders _below_ a still-scannable code, which is
  the precise defect the comment at lines 273-276 records having already been fixed once ("a screen
  indistinguishable from a working one").
- **No timer.** Set the flag and emit in the same tick: the parent chain
  (`ColdSignInPanel.vue:162` -> `LoadPodView.vue:1543` -> `finishLoaded()`, which awaits
  `ensureDurableHome()` at line 514 before emitting `file-loaded`) does real work before the view
  swaps, so the state is visible for the real duration of that work. An artificial `setTimeout`
  would add a stall nobody asked for. Verify in the browser; if `ensureDurableHome()` resolves
  instantly and the state only flashes, that is still honest feedback (the app visibly moved on) —
  the fix, if one is wanted, is the parent deferring its swap, recorded as a follow-up, never a
  delay here.

#### The terminal panels collapse from three hand-written copies to one

`done`, `signed-out` and the new `pending` are the same panel: semibold title, soft body, one
full-width dismiss button. Rather than writing a third and fourth copy, express them as a data map
and render the markup once — the same shape `SAVE_STATUS_PRESENTATION`
(`src/components/ui/saveStatusPresentation.ts`) already uses in this repo for exactly this reason
("a flat, exhaustively-testable map instead of nested template ternaries"):

```ts
type TerminalState = 'done' | 'pending' | 'signed-out';
const TERMINAL_PANEL: Record<TerminalState, { titleKey: UIStringKey; bodyKey: UIStringKey; testid: string }> = { ... };
const terminal = computed<TerminalState | null>(() => ...);
```

Typing the map values as `UIStringKey` also removes the `t(errorKey as never)` cast at line 374
(`errorKey` becomes `Ref<UIStringKey | null>`). `SignInCodeSheet`'s `t(errorKey as UIStringKey)`
cast is a different owner and stays as it is. The map lives in `DeviceApprovalSheet.vue`'s
`<script setup>`, not in a new file: it has exactly one consumer, and CLAUDE.md's extraction rule
(line 328) starts at two. If a second consumer appears, `saveStatusPresentation.ts` is the pattern
to copy for extracting it.

**Net effect on file size is a reduction, and that is a review check, not a hope.** This section
deletes the interstitial branch, `provenanceAcknowledged`, `acknowledgeProvenance`,
`dismissAtInterstitial` and two of three duplicated panels, and adds one switch, one map and one
warning callout. `DeviceApprovalSheet.vue` must end **smaller than the 377 lines it starts at**
(verified line count). If it does not, the map or the switch has landed without the deletions it
replaces, and the change is not done.

### 3. F3 — layer, and stop adding participants to one rule

- **`DeviceApprovalSheet.vue`'s own `BaseModal` gets `layer="overlay"`**, with a comment directly
  above it recording why `top` is wrong (buries the reauth gate) and why z-[55] is wrong (already
  claimed twice), because the next person will reach for one of them. Not on the `App.vue` call
  site — see Caveats.
- **`SignInCodeSheet` keeps its own self-close on scan. No new prop, no new composable member, no
  watcher.** Routing the close through `App.vue` -> `:approval-pending` -> `AppHeader` was
  considered and rejected for three reasons:
  1. **The layer fix already solves the reported defect.** F3 is "the approval sheet was _behind_
     the sign-in sheet". At `overlay` it is in front, with its own backdrop over the sheet below.
     Two stacked modals is then a cosmetic fact, not a broken flow. For the **deep-link** path the
     person is returned, on dismissal, to the sheet they themselves opened and never left — which is
     the correct place to be. (For the **in-app-scan** path there is nothing below, because
     `SignInCodeSheet.vue:88` closed itself; and Escape closes only the top-most modal, so it
     lands in the same place as the backdrop path. All three are acceptable; none is a dead end.)
  2. **The proposed mechanism was an edge-triggered watcher, and edges are the thing that breaks.**
     `watch(approvalPending, v => { if (v) showSignInCodeSheet = false })` does nothing if the key
     is already pending when the sheet is opened, and nothing on a re-scan of the same key (the
     composable deliberately returns early at `useDeviceApprovalDelivery.ts:146`). A rule that works
     only on one transition is a rule with a silent hole, in a feature whose entire history is
     silent holes.
  3. **It made three components co-own one rule** and forced a second, ungated `hasPending` boolean
     onto the composable, sitting one letter away from the gated `approvalKey`. That is the shape
     the composable's own docblock argues against ("A COMPUTED, NOT A RELEASE WATCHER… no
     retraction path to get wrong").

  So: one component, one rule, `SignInCodeSheet.vue:85-88` unchanged.

  **Documented fallback, if the browser check in §Testing shows stacked modals are actually bad**
  (e.g. the sheet below shows through at 390px in a way that reads as broken): bind a plain
  `:approval-pending` prop and make it **declarative, never a watcher** —
  `:open="showSignInCodeSheet && !approvalPending"` at the `<SignInCodeSheet>` call site in
  `AppHeader.vue:654`. That is correct whether the key arrives before or after the sheet opens,
  needs no `hasPending` member (`deviceApprovalKey !== null` is the right, already-existing value
  once the sheet is visible), and adds no imperative retraction path. Take this only if the browser
  check demands it, and record why in the commit.

- **Close the silent drop in the same file, whichever route is taken.** `SignInCodeSheet.vue:85` has
  `if (!props.open) return;` — a fully decoded approval key thrown on the floor with no event
  anywhere. Emit `emitApprovalKeyDropped({ delivery: 'in-app-scan', errorCode: 'sheet_dismissed' })`
  before returning. (`emitApprovalKeyDropped` already exists in `deepLinkEvents.ts`, so this compiles
  in Commit A with no telemetry change.) The guard is correct — provenance must not survive a
  dismissal; the silence is not.

### 4. F4 — one approve, one PIN, with the provenance check kept real

- Delete the `needsInterstitial` branch as a step, and `provenanceAcknowledged`,
  `acknowledgeProvenance` and `dismissAtInterstitial` with it.
- **The compare panel renders a provenance WARNING CALLOUT above the fingerprint whenever
  `props.delivery !== 'in-app-scan'`.** Note this is deliberately written as "not in-app-scan"
  rather than the current `delivery !== null && delivery !== 'in-app-scan'`: a `null` delivery now
  **shows** the warning rather than suppressing it. That is the fail-safe direction and it is
  strictly safer than today, at no cost (in practice `delivery` is non-null whenever the sheet is
  open, because `useDeviceApprovalDelivery` derives both from the same `pending` object).
- **Styling:** a bordered Heritage Orange notice, not red — the CIG is explicit that Heritage Orange
  is the alert colour for non-destructive warnings and that red is reserved for destructive
  confirmations and hard validation errors. Dark mode uses `accent-lift` for the text/border per
  the "accents get lighter on dark" rule. Reuse an existing notice pattern if one exists in
  `components/ui/`; do not mint new CSS if `BaseCallout`-shaped prior art is available.
- **Copy: reuse, do not re-mint.** `deviceApproval.provenanceBody` already carries exactly the right
  sentence ("Only carry on if you just pointed this device's camera at a beanies code. If someone
  sent you this link, close this; approving it would let their device into your family."). Keep the
  key and edit only the stale instruction — "close this" becomes the Reject button's name — so the
  translation pipeline sees an edit, not a churn of keys. `deviceApproval.provenanceTitle`,
  `.provenanceClose` and `.provenanceContinue` lose their only consumers and are **deleted**.
- **Intent-binding Approve label.** When the callout is showing (i.e. not `in-app-scan`), the
  Approve button renders `t('deviceApproval.approveChecked')` — a new key whose `en` states what the
  person is asserting, e.g. "Yes — I Scanned This and the Codes Match" — instead of the generic
  `deviceApproval.approve`. Same tap count as greg asked for; the assertion the blocking step used
  to extract is now extracted by the button the person is already reaching for. This is the single
  cheapest compensation for folding the step and it must not be dropped as "copy polish".
- **Approve stays `variant="primary"`. Reject stays `variant="outline"`, full width.** No button
  change ships. Requirement 8 is already met by the code at `DeviceApprovalSheet.vue:350-368` — see
  F4 above. Do **not** demote Reject to `ghost`: `ghost` is transparent with no border
  (`BaseButton.vue:38`) and reads as a text link, which would make declining materially harder to
  find on the one screen where declining must stay easy.
- Rewrite the component docblock per Caveats: correct the false "equally weighted" claim, state the
  actual weighting and why, record the fold and the two compensations, and record the zero-rate
  trigger that would bring the interstitial back.
- Replace `approval_interstitial_dismissed` with the `delivery` field now required on every
  approver-side `emitDeviceApprovalOutcome` (§2), emitted as the allowlisted `kind` field. The
  question that event answered — "are legitimate approvals arriving as deep links rather than in-app
  scans?" — is still answerable, and now per-transport rejection and success RATES are computable,
  which the old event could never do.
- `emitApprovalInterstitialDismissed` loses its only caller — **delete the function** from
  `deepLinkEvents.ts:78-88` rather than leaving dead exported code with a docblock calling it "THE
  ONLY SIGNAL THAT COULD EVER REVEAL A LIVE PHISHING ATTEMPT". Move that paragraph, rewritten onto
  the `delivery` field of `emitDeviceApprovalOutcome`, naming its two replacements explicitly:
  `action: 'rejected'` and `error_code: 'request_dismissed'`, each segmented by `kind`.

### 5. F1 — fix the contrast, then try harder, in a shape that can be tested

Four structural rules, in priority order.

**Rule 1 — the ladder is a pure function with injected dependencies.** `qrDecode.ts` splits into:

- a **shell**, `decodeQrFromImageFile`, which owns `createImageBitmap` (closed in a `finally` — it
  is never closed today), the canvas, `getContext('2d')`, `drawImage`, `getImageData`, the dynamic
  `import('jsqr')`, the `BarcodeDetector` feature-detect, the UI yield, and the existing
  chunk-failure classification. It contains no decision logic.
- a **pure runner**, `runQrLadder`, exported from the same file and taking everything it needs as
  arguments. It contains every decision and touches no browser API.

```ts
export type QrRung = 'native' | 'full-luma' | 'full-blue' | 'crop-blue' | 'large-blue';

interface ImageDataLike {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}
type RenderSpec = { maxDim: number; crop?: number };

export type LadderOutcome =
  | { ok: true; data: string; rung: QrRung; attempts: readonly QrRung[] }
  | { ok: false; reason: 'no-code' | 'unsupported-device'; attempts: readonly QrRung[] };

export async function runQrLadder(deps: {
  source: { width: number; height: number };
  /** null => this render could not be produced (no 2D context, or out of memory). */
  render: (spec: RenderSpec) => ImageDataLike | null;
  /**
   * ASYNC so the shell can defer `import('jsqr')` until the native attempt has failed.
   * A rejection propagates: the shell classifies it as `decoder-unavailable`.
   */
  decode: (data: Uint8ClampedArray, width: number, height: number) => Promise<string | null>;
  /** Present only when the platform has BarcodeDetector. May throw; the runner catches. */
  native?: () => Promise<string | null>;
  /** Awaited between steps so the browser can paint. Defaults to a no-op for tests. */
  yieldToUi?: () => Promise<void>;
}): Promise<LadderOutcome>;
```

This is the `recipeSourceResolver.ts` shape, for the same stated reason: a ladder buried inside the
code that also owns the canvas "would nest three deep and be untestable without a component
harness". Here it is worse than untestable-without-a-harness — happy-dom returns `null` from
`getContext('2d')`, so **no test in this repo could reach the decision logic at all**. The seam is
what makes requirement 12 satisfiable. It is exported for one reason, stated in its docblock: it is
the only way the ladder is testable, because the test environment has no 2D context.

**Pass 4 note on `decode` being async.** The current shell does
`Promise.all([import('jsqr'), createImageBitmap(source)])`. If `decode` were synchronous the shell
would have to resolve that import up front — which means an Android Chrome device whose
`BarcodeDetector` succeeds still pays a chunk fetch it never uses, and, worse, an offline first-load
would return `decoder-unavailable` even though the platform decoder could have read the code. Making
`decode` async lets the shell memoise `await import('jsqr')` inside the closure, on first actual use,
after `native` has had its turn. Tests supply `async () => 'DATA'`; no behaviour is assumed.

**Rule 2 — nothing mutates shared pixels, so no ordering invariant exists to break.** Group channels
under the render that feeds them, and derive the blue buffer by copy rather than by mutation:

```ts
type LadderStep = {
  render: RenderSpec;
  attempts: readonly { rung: QrRung; channel: 'luma' | 'blue' }[];
};

const LADDER: readonly LadderStep[] = [
  {
    render: { maxDim: 1600 },
    attempts: [
      { rung: 'full-luma', channel: 'luma' }, // today's behaviour, cheapest
      { rung: 'full-blue', channel: 'blue' }, // the Heritage-Orange fix
    ],
  },
  {
    render: { maxDim: 1600, crop: 0.5 },
    attempts: [
      { rung: 'crop-blue', channel: 'blue' }, // people aim at the middle
    ],
  },
  {
    render: { maxDim: 2600 },
    attempts: [
      { rung: 'large-blue', channel: 'blue' }, // last resort, most expensive
    ],
  },
];
```

- One render per step; the runner renders a step's spec once and runs that step's attempts against
  it. There is no cache, no cache key, and nothing shared between steps — so there is nothing to
  order wrongly and no invariant to document or test.
- `toBlueChannel(src): Uint8ClampedArray` **returns a new buffer** (`new Uint8ClampedArray(src)` then
  write `b` into `r` and `g`) instead of writing through the caller's. The luma buffer is never
  touched, so the two attempts inside a step are order-independent — the order in the literal is
  purely a cost preference (try the free one first), and getting it "wrong" costs milliseconds, not
  correctness. Peak memory rises by one transient copy of the current frame (~10MB at 1600px,
  ~27MB at 2600px), which is the same order as the bitmap already held.
- For Heritage Orange this lifts module/background separation from luma 120<->255 to **34<->255**
  (`#F15D22` has `b = 0x22 = 34`). It is equally safe for a black-on-white code (0<->255) and is a
  pure win for every code this app mints.
- Adding a rung is still one line of data; it is now also impossible for that line to break another.

**Rule 3 — plan before rendering, and never re-render the same pixels.** The runner is given
`source.width/height`, so it can compute each step's output dimensions **purely, before rendering**,
and skip any attempt whose `(width, height, crop, channel)` tuple it has already tried.

```ts
/** Pure, exported for test: which attempts a source of these dimensions actually costs. */
export function plannedAttempts(source: { width: number; height: number }): readonly QrRung[];
```

A 1200×900 photo plans three attempts, not four: the `maxDim: 2600` step clamps to `Math.min(1, …)`
so it never upscales, producing the same 1200×900 blue tuple `full-blue` already tried. This covers
every PDF, since `decodeQrFromPdf` renders at 1600. A test asserts that directly — a real
behavioural assertion, unlike an assertion about the order of a constant.

**Rule 4 (new in Pass 4) — the ladder must not freeze the phone.** jsQR is synchronous and
O(pixels). One pass at 1600×1200 (1.9MP) is already a visible second on a phone; the worst case here
is four passes totalling ~12MP, with the `large-blue` step alone at 2600×1950 (5.1MP). Run
back-to-back on the main thread with no break, that is a multi-second freeze in which the
`coldEntry.scanning` busy label cannot even paint. So:

- the runner `await deps.yieldToUi?.()` **between steps** (not between attempts inside a step — the
  yield is to let the browser paint, and the steps are the natural boundaries);
- the shell supplies a real macrotask yield (`new Promise(r => setTimeout(r, 0))` — a microtask does
  not release the frame), tests supply nothing and the ladder runs straight through;
- the manual device checklist explicitly covers wall-clock time and memory of the full ladder on the
  oldest test phone, and if `large-blue` is the rung that hurts, **dropping that one step is a
  one-line data change** with no structural consequence — which is the point of Rule 2.

**The native decoder is a step before the ladder, not a rung inside it.** `BarcodeDetector` (native
on Android Chrome, far better than jsQR) has no `maxDim`, no `crop` and no `channel`, so forcing it
into the rung descriptor would make every field on that descriptor optional and meaningless for one
member. It is `deps.native`, tried first, wrapped in `try/catch`; a throw appends `'native'` to
`attempts` and falls through to the ladder. The shell only supplies it when the global exists, so
happy-dom tests exercise the jsQR path by default and a stub exercises the native path explicitly.

**Reason codes get one correction, and it is more precise than the draft's.** Today
`unsupported-device` means "we never looked at a pixel", and with one render that is the same thing
as "the first render failed". With a ladder it is not. The rule:

> `unsupported-device` is returned **only when no render in the whole ladder succeeded AND no native
> attempt ran to completion.** If any render produced pixels, or if `deps.native` was present and
> returned `null` (as opposed to throwing), something _did_ look at the image and the honest answer
> is `no-code`.

The second clause matters: telling an Android Chrome user "your device doesn't support this" when
its platform decoder just examined the photo would be a lie, and that is the exact class of wrong
message this reason union was created to stop. Keep the four-reason `QrDecodeFailure` union intact
so the existing copy (`qrScan.noCode` / `.unsupportedDevice` / `.decoderUnavailable` /
`.unreadableImage`) and telemetry still map.

**The module-level `canvasUnavailable` flag is deleted**, not relocated. The runner returns its
reason in a discriminated result, so the shared mutable has no job, and the
two-instances-of-`useQrCapture` cross-contamination hazard goes with it.

**No telemetry inside `qrDecode.ts`.** The result carries `rung` (on success) and `attempts`
(always); `useQrCapture` is the one place that calls `logEvent`/`reportError`, exactly as it is
today. This keeps the ladder's tests free of telemetry mocks and keeps one reporting site per decode.

The ladder is slower only in the failure case, which currently fails anyway; and the success case is
usually faster than today's, because the common wins are the cheap early attempts.

## Landing Order

Sixteen files and five findings is too much to review as one diff, and two of the changes (the
`putEnvelopeEntry` rename, the decoder rewrite) are ones you want to be able to revert cleanly and
individually. The work splits along a seam that already exists — F1 shares no type and no test with
F2–F5 — so it lands as **three sequential commits on `main`** (CLAUDE.md:490: this repo commits
straight to `main`; branches are short-lived and exceptional), each `npm run validate` green on its
own:

| #   | Findings | Files                                                                                                                                                                                                      | Why this cut                                                                                                                                                                                          |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | F2 + F3  | `useDeviceApprovalDelivery.ts` + test, `App.vue`, **`DeviceApprovalSheet.vue` (one `layer` attribute + its comment, nothing else)**, `SignInCodeSheet.vue`                                                 | The dead-on-cold-launch regression and the buried modal. Smallest, most urgent, no dependency on anything else. Ships the fix for the currently-broken headline feature without waiting for the rest. |
| B   | F4 + F5  | `DeviceApprovalSheet.vue`, `DeviceApprovalRequest.vue`, `syncStore.ts` + test, `loginFlowEvents.ts`, `deepLinkEvents.ts`, `uiStrings.ts`                                                                   | Genuinely interlocked: the terminal-panel map serves both, and the `pending` state cannot exist before the rename. Contains the one risky rename, isolated so a revert is one commit.                 |
| C   | F1       | `qrDecode.ts` + new test, `useQrCapture.ts`, `SignInCodeSheet.vue` + `ColdSignInPanel.vue` (drop the now-dead `surface` option), `diagnosticContext.ts` (comment), `native-store-submission.md` (one line) | Independent subsystem, independent test file, and the only part with a memory/perf profile that needs real-device evidence. Revertable without touching the approval flow.                            |

**Dependency audit (Pass 4), one boundary at a time:**

- A -> nothing. `emitApprovalKeyDropped` already exists in `deepLinkEvents.ts`, so
  `SignInCodeSheet`'s new drop event compiles against unchanged telemetry. `layer` is an existing
  `BaseModal` prop. The composable signature change and its only call site (`App.vue`) move together.
- **A touches `DeviceApprovalSheet.vue`, which B then rewrites.** This is deliberate and is not a
  crossed dependency: they are sequential commits on a linear history, so there is no merge to
  resolve, and A's one-line `layer="overlay"` must not wait for B because F3 is a live defect.
  Putting the attribute in `App.vue` to keep A off that file would trade a real bug fix for an
  implicit attribute fallthrough — the wrong trade (see Caveats).
- B -> A only. `deepLinkEvents.ts` loses `emitApprovalInterstitialDismissed` in the same commit that
  deletes its only caller (`DeviceApprovalSheet.vue`). `emitDeviceApprovalOutcome`'s signature change
  and both of its calling components are in B together.
- C -> nothing in A or B. `useQrCapture.ts` and `qrDecode.ts` share no symbol with the approval
  flow. C edits `SignInCodeSheet.vue` and `ColdSignInPanel.vue` only to remove the `surface:` line
  from their `useQrCapture({…})` calls — a deletion, not a dependency.

Each commit updates `CHANGELOG.md` per the repo rule.

## Out of Scope (decided with greg)

A **live viewfinder scanner** (WhatsApp-style continuous detection). greg asked whether it was a
quick tweak; it is not. `android/app/src/main/AndroidManifest.xml:156` deliberately does not declare
`android.permission.CAMERA`, and declaring it would require it to be GRANTED before
`ACTION_IMAGE_CAPTURE` fires, putting a new runtime prompt in front of the existing AI-document and
photo-attachment capture flows. Do not add `getUserMedia`, a viewfinder, or the Android camera
permission. File a GitHub issue at the end of the run (`enhancement`, `priority: medium`,
`area: ui`, `auth`) describing the ML-Kit-on-native plus `getUserMedia`-on-web shape.

Also out of scope, and worth recording because F1's root cause raises it: **changing the QR mint
colour away from Heritage Orange.** Black-on-white would decode better still, but the branded code
is a deliberate CIG choice, the blue-channel attempt recovers the contrast on the reading side, and
changing the mint would not help any code already printed in a family's recovery kit. If the F1
telemetry shows the blue attempts carrying most successes, revisit it then with data.

Also out of scope: **adding a `canvas` devDependency so `qrDecode` can be tested against real
pixels.** A native build in CI for one test file is a poor trade; the injected-render seam (§5, Rule

1. gets the same coverage of the logic, and the real-pixel claim is covered by the browser and
   device checks in §Testing.

Also out of scope: the magic-link KNOWN GAP at `syncStore.ts:500` and `SignInCodeSheet`'s
`t(errorKey as UIStringKey)` cast — both real, pre-existing, and not this work's to change. (The
third item listed here originally, "Escape closes every open modal", was not real; see Caveats.)

## Files Affected

**Commit A (F2, F3)**

- `src/composables/useDeviceApprovalDelivery.ts` — session contract moves inside (`familyId` +
  `memberId` refs); `dismiss` routes through `discard`; no new public members
- `src/composables/__tests__/useDeviceApprovalDelivery.test.ts` — three-step hydration regression,
  sign-out and switch-person through the new inputs, dismissal event
- `src/App.vue` — pass the two session refs
- `src/components/auth/DeviceApprovalSheet.vue` — `layer="overlay"` on its own `BaseModal`, plus the
  comment explaining why not `top` and not z-[55]. Nothing else in this commit.
- `src/components/auth/SignInCodeSheet.vue` — report the dismissed-mid-decode drop (self-close stays)

**Commit B (F4, F5)**

- `src/components/auth/DeviceApprovalSheet.vue` — folded interstitial with the provenance callout and
  intent-binding Approve label, exhaustive publish-outcome switch, terminal-panel map, `reportError`
  on genuine failure, corrected docblock; buttons unchanged; ends smaller than 377 lines
- `src/components/login/DeviceApprovalRequest.vue` — explicit success state via `BeanieSpinner`, QR
  and fingerprint hidden when it shows, `side: 'requester'` on all six outcome emissions
- `src/stores/syncStore.ts` — `DurableSaveOutcome`, `publishEnvelopeEntry`, `publishDeviceApprovalWrap`
- `src/stores/__tests__/syncStore.envelopeEntry.test.ts` — updated for the rename + outcome
- `src/services/telemetry/loginFlowEvents.ts` — discriminated outcome payload, `delivery` required
  on approver-side events, typed snake_case error-code unions, `'expired'` retained on the requester
  side
- `src/services/telemetry/deepLinkEvents.ts` — delete `emitApprovalInterstitialDismissed`, rehome its
  rationale
- `src/services/translation/uiStrings.ts` — new keys (`pendingTitle`, `pendingBody`,
  `approveChecked`, requester success line), edited `provenanceBody`, deleted `provenanceTitle` /
  `provenanceClose` / `provenanceContinue`; `en` + `beanie` on every one

**Commit C (F1)**

- `src/utils/qrDecode.ts` — shell/runner split, `runQrLadder` + `plannedAttempts` exported pure,
  async `decode`, copy-not-mutate blue channel, UI yield between steps, bitmap close, no
  module-level mutable
- `src/utils/__tests__/qrDecode.test.ts` — NEW file; pure ladder tests with injected
  render/decode/native/yield
- `src/composables/useQrCapture.ts` — the one emitter: rung on success, exhaustion on failure, both
  on the new `qr-decode` surface; the `surface` option is deleted
- `src/components/auth/SignInCodeSheet.vue`, `src/components/login/ColdSignInPanel.vue` — drop the
  now-dead `surface:` argument
- `src/utils/diagnosticContext.ts` — widen the `kind` / `detail` comment to name the `qr-decode`
  surface's vocabularies (no allowlist entry added)
- `docs/runbooks/native-store-submission.md` — one line on the diagnostics row naming the new
  surface, following the #86 "NO NEW KEYS AND NO NEW DATA CATEGORY" precedent

**All three**

- `docs/plans/2026-09-19-device-approval-five-findings.md` — this plan
- `CHANGELOG.md` — one entry per commit

No change to `scripts/updateTranslations.mjs` — `uiStrings.ts`'s structure is unchanged, only
entries are added, edited and removed.

## Observability Coverage

**Events added or changed** (all context keys already allowlisted; `action` is the field carrying the
outcome, per `loginFlowEvents.ts:276`):

- `device_approval_outcome` (surface `login-flow`) gains `kind: <delivery>` (`cold-launch` | `warm` |
  `web-load` | `in-app-scan`) on every approver-side emission, required by the payload type. This
  replaces `approval_interstitial_dismissed` as the way to answer "are legitimate approvals arriving
  as deep links rather than in-app scans?", which is the question that decides whether the
  provenance warning is still honest, and it makes the phishing observable a RATE rather than a raw
  count: `action: 'rejected'` and `error_code: 'request_dismissed'`, each segmented by `kind`.
- `device_approval_outcome` gains two approver-side outcomes:
  - `action: 'published'` (`info`) — the approver's wrap landed. **This is new and is the
    denominator**; there is no approver-side success event today at all.
  - `action: 'unconfirmed'` (`warn`) with `error_code: 'timeout' | 'unknown'` — the wrap may still
    be in flight. Deliberately NOT `action: 'failed'`: the entire finding is that a probable success
    was reported as a failure, and it must not be indistinguishable in CloudWatch either.
  - `action: 'expired'` is **retained**. It has a live emitter (`DeviceApprovalRequest.vue:235`) and
    a documented job — separating "the person walked away" from "the write failed". The draft's
    instruction to delete it was based on a bad grep and must not be carried out.
- `error_code` values on this event are normalised to snake_case on both sides, enforced by two
  string-literal unions: approver `no_family_key`, `request_dismissed`, `request_superseded`,
  `gate_declined`, `publish_failed`, `approve_threw`, `timeout`, `unknown`; requester `poll_failed`,
  `qr_unavailable`, `request_failed`, `no_pending`, `payload`, `decrypt`. The last three are the
  mapped forms of `openPodWithFamilyKey`'s `reason` (`syncStore.ts:3244`), which
  `DeviceApprovalRequest.vue:179` currently passes through raw. Nothing queries the old kebab forms
  (assumption 5).
- `envelope_entry_publish_unconfirmed` (already exists at `syncStore.ts:511`) is retained unchanged
  and now correlates with the sheet-level event above.
- `approval_key_dropped` (surface `deep-link`) gains two new `error_code` values, both closing
  existing silences: `dismissed` (the person closed the sheet — previously emitted nothing, so the
  held/delivered funnel had no terminal entry) and `sheet_dismissed` (a key decoded in-app after the
  sheet was closed — previously an unlogged `return`).
- F2 is already instrumented: `approval_key_held` / `approval_key_delivered` / `approval_key_dropped`
  with `error_code: session-changed | superseded | expired`. The fix is verifiable in CloudWatch by
  the disappearance of `session-changed` drops on cold launch. No new event needed.
- **F1 gets its own surface, `qr-decode`, and that is a correctness requirement rather than tidiness.**
  `deepLinkEvents.ts:38-46` states an invariant in capitals: "`kind` CARRIES ONE VOCABULARY ON THIS
  SURFACE — the `DeliveryKind` values above, and nothing else", and records that mixing marker
  constants onto that field once already produced alerts that "silently mixed transport buckets with
  marker buckets". Emitting rung ids as `kind` on the `deep-link` surface (which is what
  `SignInCodeSheet`'s capture uses today) would repeat that defect exactly. Nor can the rung ride
  `detail` on `login-flow`, where `detail` already carries `origin=…` (`SignInCodeSheet.vue:71`).
  A dedicated surface gives the rung vocabulary a field of its own, satisfies CLAUDE.md rule 3
  ("name the surface so one CloudWatch filter isolates this feature"), and — assumption 5 — breaks
  no alerting. Concretely, **all of it emitted from `useQrCapture`, never from `qrDecode.ts`**:
  - Every completed decode emits one `logEvent` on surface `qr-decode`: `info` + `kind: <rung id>`
    on success, `warn` + `kind: 'exhausted'` + `error_code: 'no-code'` on a genuine miss. `detail`
    carries `origin=<caller>` (`profile-menu` | `cold-entry`) so the flow is still separable — the
    same idiom `useMintedLink` already uses. One event per photo — well inside 50/surface/min.
  - The existing `qr decode failed` report moves to the same surface (keeping one decode on one
    surface), keeps its three non-`no-code` reasons, and additionally carries `kind` naming the last
    attempt reached. `useQrCapture`'s `surface` option becomes dead and is deleted, along with its
    two call-site arguments — one subsystem, one surface.
  - A `BarcodeDetector` that is present but throws shows up as `'native'` in `attempts` without a
    `rung`, so a platform decoder that is broken is visible rather than merely slow.
  - `no-code` becoming an emitted (if non-reported) outcome is the point: today it is deliberately
    silent, and it is the single most common outcome and the exact one this work is trying to move.
    Without a counterpart the F1 fix is unmeasurable, which violates CLAUDE.md rule 6.
  - This makes the headline claim falsifiable: if `full-blue` and `crop-blue` carry most successes,
    the Heritage-Orange contrast diagnosis was right; if nothing shifts, it was not.

**Failure modes and how each is triaged blind:**

| Failure                                  | Event that diagnoses it                                                                                         |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Key never reaches the sheet              | `approval_key_held` with no matching `approval_key_delivered`                                                   |
| Key discarded by a session transition    | `approval_key_dropped` + `error_code: session-changed`                                                          |
| Key abandoned by the user                | `approval_key_dropped` + `error_code: dismissed`                                                                |
| Key decoded after the sheet closed       | `approval_key_dropped` + `error_code: sheet_dismissed`                                                          |
| Wrap published and confirmed             | `device_approval_outcome` + `action: published` + `kind: <delivery>`                                            |
| Wrap published but unconfirmed           | `device_approval_outcome` + `action: unconfirmed` + `error_code: timeout\|unknown`                              |
| Wrap genuinely failed                    | `device_approval_outcome` + `action: failed` + `error_code: publish_failed` (plus a `reportError` with a cause) |
| Requesting device gave up                | `device_approval_outcome` + `action: expired` (requester side, no `kind`)                                       |
| A possible phishing attempt              | `device_approval_outcome` + `action: rejected` or `error_code: request_dismissed`, **rate segmented by `kind`** |
| Decode succeeded, and on which rung      | `qr-decode` surface, `kind: <rung id>`, `detail: origin=…`                                                      |
| Decode exhausted the ladder              | `qr-decode` surface, `kind: exhausted` + `error_code: no-code`                                                  |
| No render ever succeeded, nothing looked | `qr decode failed` + `error_code: unsupported-device`                                                           |
| Platform decoder present but broken      | `qr-decode` with `native` in `attempts` and no `rung`                                                           |

**No bare `catch`**: the `BarcodeDetector` attempt is wrapped and falls through to jsQR on throw,
recorded in `attempts`; the genuine publish failure gains a `reportError` with the cause attached;
the dismissed-mid-decode return gains an event.

**Privacy/store gate**: no new `ALLOWED_CONTEXT_KEYS` entry — `action`, `error_code`, `kind` and
`detail` are all already allowlisted and declared. `side` is a compile-time discriminant and is
never emitted. Rung ids are fixed enums with no user data, following the `extraction_path` /
dish-image-`detail` precedent. One line is added to the runbook's diagnostics row naming the
`qr-decode` surface; no new data category and no store answer changes.

## Acceptance Criteria

**Commit A**

- [ ] A key delivered before hydration survives `undefined/undefined` -> `fam/undefined` -> `fam/mem`
      and is delivered once the surface is usable (unit test)
- [ ] A key held across a sign-out (`fam/mem` -> `fam/undefined`) is still discarded with
      `error_code: session-changed` (unit test)
- [ ] A switch-person (`fam/m1` -> `fam/undefined` -> `fam/m2`) still discards (unit test)
- [ ] `useDeviceApprovalDelivery` no longer accepts a caller-composed session key, and its public
      interface has gained no members
- [ ] `dismiss()` emits `approval_key_dropped` with `error_code: dismissed` and shares one body with
      `discard` (unit test)
- [ ] `layer="overlay"` is on `DeviceApprovalSheet`'s own `BaseModal`, not on the `App.vue` call
      site, and carries the comment explaining why not `top` and not z-[55]
- [ ] The approval sheet renders above `SignInCodeSheet`, AND the reauth PIN gate renders above the
      approval sheet (verified in a browser, both directions)
- [ ] Exactly one component closes `SignInCodeSheet` after an in-app scan, and it is
      `SignInCodeSheet` itself — no `approval-pending` prop and no watcher was added (unless the
      browser check demanded the documented declarative fallback, in which case the commit says why)
- [ ] A key decoded after the sheet was dismissed emits `error_code: sheet_dismissed` rather than
      returning silently

**Commit B**

- [ ] `publishEnvelopeEntry` returns `DurableSaveOutcome`; no call site tests it for truthiness; the
      approval branch is a `switch` closed with `assertNever`
- [ ] A timed-out publish shows the pending copy, not the failure copy, and emits
      `action: 'unconfirmed'`; a confirmed publish emits `action: 'published'`
- [ ] `emitDeviceApprovalOutcome`'s payload is a discriminated union: an approver-side emission does
      not compile without `delivery`, and a requester-side one does not compile with it
- [ ] **`action: 'expired'` still exists and `DeviceApprovalRequest.vue` still emits it** — the
      draft's "delete it, it has no emitter" instruction was wrong and was not carried out
- [ ] Every `error_code` on the event is snake_case and comes from a string-literal union, including
      the three mapped `openPodWithFamilyKey` reasons — a kebab value fails `tsc`
- [ ] A genuinely failed publish calls `reportError` with a cause (console + CloudWatch), not
      telemetry alone
- [ ] The requesting device shows an explicit success state, built from `BeanieSpinner`, with no
      artificial delay, **and the QR image and fingerprint are hidden while it shows**
- [ ] Approving is one Approve tap plus the PIN; no separate interstitial step;
      `emitApprovalInterstitialDismissed` is deleted, not orphaned
- [ ] The provenance warning renders as a visible Heritage-Orange callout ABOVE the fingerprint for
      every delivery that is not `in-app-scan`, **including `null`** (fail-safe), reusing the edited
      `deviceApproval.provenanceBody`
- [ ] With that callout showing, the Approve button reads `deviceApproval.approveChecked` (the
      intent-binding label), not the generic `deviceApproval.approve`
- [ ] **Approve is still `primary` and Reject is still `outline`, full width — no button variant
      changed in this diff** — and the component docblock no longer claims they are equally weighted
- [ ] The three terminal panels render from ONE markup block driven by a typed map, and the
      `t(errorKey as never)` cast is gone
- [ ] `DeviceApprovalSheet.vue` is **shorter** than its starting 377 lines

**Commit C**

- [ ] `qrDecode.ts` contains exactly one `getContext('2d')` call site and one `createImageBitmap`
      call, both in the shell, and closes the bitmap in a `finally`
- [ ] `qrDecode.ts` has no module-level mutable state
- [ ] `runQrLadder` and `plannedAttempts` are pure: they reference no browser global and call no
      telemetry function (grep: no `document`, `canvas`, `logEvent` or `reportError` in either)
- [ ] `decode` is async and `import('jsqr')` is not awaited before the `native` attempt has had its
      turn (so a successful native decode fetches no jsQR chunk)
- [ ] `toBlueChannel` returns a new buffer and does not write through its argument, so no attempt
      ordering invariant exists and no test asserts the order of a constant
- [ ] `unsupported-device` is returned only when NO render succeeded AND no native attempt completed
- [ ] A 1200×900 source plans three attempts, not four (unit test on `plannedAttempts`)
- [ ] The blue-channel conversion lifts Heritage Orange (`#F15D22`) from Rec.709 luma ~120 to 34
      against white 255 (pure unit test on the byte math — no canvas)
- [ ] `BarcodeDetector` is an injected dependency tried before the ladder, not a member of the rung
      array; a throw is recorded in `attempts` and falls through
- [ ] `yieldToUi` is awaited between steps and is an injected dependency (unit test asserts it is
      called once per step boundary, not per attempt)
- [ ] All QR decode telemetry lands on the `qr-decode` surface with `kind` carrying rung ids only;
      **no rung id is ever emitted as `kind` on `deep-link` or `login-flow`**
- [ ] `useQrCapture`'s `surface` option is gone and both call sites stopped passing it
- [ ] A decode emits a rung-tagged event on SUCCESS as well as on exhaustion
- [ ] No `inversionAttempts` argument is passed to jsQR (it is already the default)
- [ ] A real Heritage Orange QR occupying ~25% of a large photo decodes — verified in the Playwright
      scratch check (real canvas) and on greg's devices, NOT claimed by a happy-dom unit test

**All three**

- [ ] No `getUserMedia`, no viewfinder, no Android `CAMERA` permission anywhere in the diff
- [ ] Every new string has `en` + `beanie`, and every `beanie` value keeps the real nouns (the
      `deviceApproval.` important-surface floor test passes); the three deleted provenance keys have
      no remaining references
- [ ] Every new surface styled for light and dark; the pending state uses no red and no Heritage
      Orange (nothing has gone wrong); the provenance callout uses Heritage Orange, never red
- [ ] Diagnostic events above fire with the stated `surface`/`context`
- [ ] `npm run validate` green **on each commit independently**

## Testing Plan

1. `npm run validate` — once per commit, redirected to `$SCRATCH/validate.log`, per the repo rule.
2. Unit (A): the three-step hydration regression; sign-out discard; switch-person discard; the
   `dismiss()` event; `SignInCodeSheet` emits the drop event when scanned while closed and still
   emits `close` on a scan while open.
3. Unit (B): `publishEnvelopeEntry` returns each of the four outcomes and the approval path maps them
   to the three terminal states; rollback still only on `'failed'`; the two non-approval callers
   still behave identically; the terminal map covers every `TerminalState`; the requester's
   `'expired'` emission still type-checks and still fires.
4. Unit (C): `runQrLadder` driven entirely through injected `render`/`decode`/`native`/`yieldToUi`
   stubs — short-circuits on the first hit; falls through a throwing `native`; returns
   `unsupported-device` only when every render returns null AND no native ran; returns `no-code`
   when a later render succeeds or a native completed; a rejecting `decode` propagates so the shell
   can classify it; `yieldToUi` is called per step boundary; `plannedAttempts` dedupes for a small
   source; `toBlueChannel` byte math on a synthetic Heritage-Orange-on-white buffer. **No canvas is
   needed by any of these, which is the point of the seam.**
5. Browser (Playwright, scratch scripts in `scripts/design-screenshots/`, NOT `e2e/specs/` — the
   25-test cap and the Three-Gate Filter both say no):
   - approval sheet over `SignInCodeSheet`; PIN gate over the approval sheet (both directions);
   - whether the stacked-modal appearance is acceptable at 390px — this is the check that decides
     the §3 fallback;
   - the folded compare panel WITH the provenance callout at 390px and 1280px, light and dark; the
     same panel without it (`in-app-scan`); the three terminal panels; the requesting device's
     success state with the QR hidden;
   - a real-canvas decode of a generated Heritage Orange QR placed small inside a large image,
     driving `decodeQrFromImageFile` in-page. This is where the F1 pixel claim is actually proven.
6. Manual, on greg's devices (cannot be done here): cold launch from a killed app via a scanned pull
   code; real camera decode quality at normal distance, at arm's length, and in poor light; **the
   wall-clock time of a full four-attempt miss and whether the busy state stays responsive**; memory
   behaviour of the 2600px attempt on the oldest test phone (if it hurts, delete the `large-blue`
   step — one line); the timeout path against real Drive latency.

## Review Passes

- **Pass 1 (Initial draft)**: drafted from five verified root causes; caught that `layer="top"` would
  bury the reauth gate and that widening the publish return type without a rename is a silent
  truthiness regression.
- **Pass 2 (DRY + error handling)**: found the real F1 root cause — every beanies QR is Heritage
  Orange (`generateInviteQR` is the sole mint path) and jsQR binarises on Rec.709 luma, halving
  module contrast — and added a blue-channel rung; corrected the false premise that jsQR lacks
  `inversionAttempts` (it defaults to `attemptBoth`); restructured the ladder around one render
  helper + a data array, and added the missing `bitmap.close()` and the removal of module-level
  `canvasUnavailable`. Resolved the open F5 question: widen the outcome union with **two** members
  (`published` + `unconfirmed`), because the draft's claim that approver success was already
  measurable was wrong — the `done` path emits nothing. Collapsed the duplicated terminal panels into
  one typed map (the `SAVE_STATUS_PRESENTATION` idiom); reused `BeanieSpinner` instead of new UI.
  Closed four silent failures: `dismiss()` with no event, a decoded key dropped after the sheet
  closed, a genuine publish failure with no `reportError`, and a decoder whose success path emitted
  nothing. Ruled out an in-between z-tier (z-[55] is already claimed twice) and spelled out exactly
  why the `overlay`/`overlay` tie resolves correctly.
- **Pass 3 (Sustainability + maintainability)**: removed three structures that were correct today but
  breakable later. (1) The F1 ordering invariant is gone: channels are grouped under the render that
  feeds them and `toBlueChannel` copies instead of mutating, so a reorder of the data array cannot
  corrupt an earlier attempt; the cache is replaced by a pure `plannedAttempts`; `BarcodeDetector`
  becomes an injected pre-step. (2) Discovered the F1 acceptance criteria were unachievable —
  happy-dom's `getContext('2d')` returns `null` — hence the shell/pure-runner split modelled on
  `recipeSourceResolver.ts`, telemetry kept out of `qrDecode.ts`, the real-pixel claim moved to a
  Playwright scratch check, and requirement 12. Also corrected `unsupported-device` to mean "no
  render ever succeeded". (3) Cut the `hasPending` / `:approval-pending` coupling: the layer fix
  already resolves F3 and the proposed watcher had a silent hole. Made the outcome payload a
  discriminated union on a compile-time-only `side`, normalised its `error_code` casing, and split
  the work into three sequential commits with a "must end shorter than 377 lines" review check.
- **Pass 4 (Fresh-eyes final sweep)**: caught four factual errors and hardened the security story.
  (1) **`outcome: 'expired'` HAS a live emitter** (`DeviceApprovalRequest.vue:235`, documented in
  `docs/plans/2026-09-18-scan-to-sign-in.md:487`); Pass 3's "delete it, grep confirms no emitter" was
  wrong and is reversed, and assumption 5 is corrected. (2) **The anti-phishing reversal was never
  needed**: Approve is already `variant="primary"` and Reject already `variant="outline"`
  (`DeviceApprovalSheet.vue:352`/`:362`), so requirement 8 is met in shipped code — the docblock's
  "equally weighted" claim was already false about its own markup. Dropped the `ghost` demotion
  (`ghost` is borderless and reads as a text link on the one screen where declining must stay easy),
  so **no security control is reversed by this work**; the docblock is corrected, not reversed. The
  interstitial fold is kept but made defensible: a Heritage-Orange warning callout above the
  fingerprint, fail-safe on `delivery === null`, an intent-binding Approve label at the same tap
  count, reuse of the existing `provenanceBody` copy, and the phishing observable respecified as
  `rejected` / `request_dismissed` segmented by `kind`, with an explicit zero-rate trigger to bring
  the step back. (3) **`layer` was specified on the `App.vue` call site**, where it would have worked
  only by implicit attribute fallthrough onto `BaseModal` — the exact hazard `App.vue:2098` already
  warns about; moved inside `DeviceApprovalSheet.vue` and Commit A's file list corrected to include
  it, with the A/B same-file overlap audited and justified. (4) **Rung ids on `kind` would have
  broken the `deep-link` surface's documented single-vocabulary invariant** (`deepLinkEvents.ts:38-46`
  records that exact defect being fixed once already), and `detail` on `login-flow` already carries
  `origin=…`; QR telemetry moves to its own `qr-decode` surface with `detail: origin=<caller>`,
  which also lets `useQrCapture`'s now-dead `surface` option be deleted. Added: new requirement 13
  (no field carries two vocabularies on one surface); `decode` made async so `import('jsqr')` is
  deferred past the native attempt (avoids a wasted chunk and a wrong `decoder-unavailable`); a
  `yieldToUi` injected between ladder steps because four synchronous jsQR passes up to 5.1MP would
  freeze the phone; `unsupported-device` tightened to "no render succeeded AND no native completed";
  the requester's success state required to hide the still-live QR and fingerprint (the defect
  `DeviceApprovalRequest.vue:273-276` records fixing once); the four requester-side kebab error
  codes and the three pass-through `openPodWithFamilyKey` reasons added to the snake_case
  normalisation, enforced by string-literal unions; and the pre-existing "Escape closes every open
  modal" behaviour recorded as out of scope, since it falsifies one clause of §3's argument.
