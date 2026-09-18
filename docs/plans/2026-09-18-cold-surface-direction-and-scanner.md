# Plan: Scan a beanies QR code — direction, provenance, and the PIN pad

> Date: 2026-09-18
> Related issues: None. Direct implementation.
> Plan file: `docs/plans/2026-09-18-cold-surface-direction-and-scanner.md`
> Mockup: https://claude.ai/artifact/26RTLm8SSzF2xKeAdsYrp7 (approved by greg, 2026-09-18)
> Supersedes in part: `docs/plans/2026-09-18-device-approval-deeplink-notification.md` (Run A)

> **No GitHub issue created.** Approved for direct implementation. Full prompt history in `## Prompt Log`.

## User Story

As someone getting beanies onto another device, I want the app to lead with the direction that actually works on the device in my hand, and to let me scan a code from inside beanies, so that signing in a second device is obvious rather than a guess — and so that an approval request can only reach me because I chose to scan something.

## Context

### This plan finishes work already in the working tree

The tree is deliberately **not clean**. It carries Run A's uncommitted changeset (the device-approval deep-link delivery fix). greg's decision, verbatim: **"let's go with option 2, fold it into run B"**. Run A does not ship alone, because two `/code-review max` passes found it still carries several reliability gaps, and because it sharpens a security hole that **predates Run A and is live in shipped 0.21.3**.

Carried forward: `src/App.vue`, `src/services/share/inboundLinkBridge.ts`, `src/services/auth/deepLinks.ts`, `src/components/auth/DeviceApprovalSheet.vue`, new `src/services/telemetry/deepLinkEvents.ts`, two new test files, plus a `CHANGELOG.md` entry and a prompt-log append.

⚠️ **Run A's plan is now partly stale and is history, not spec.** Its acceptance criterion and approach still say `markConsumed` should move after the allowlist check; the code deliberately does the opposite, because moving it gave a single-slot replay guard a second writer. That file must be reconciled, not left contradicting the code it describes.

### The organising insight

`/welcome` is a **verified App Link** (`android/app/src/main/AndroidManifest.xml`, `autoVerify="true"`) and Universal Link (`public/.well-known/apple-app-site-association`). On iOS a camera scan opens a URL through the **same mechanism** as a tapped link. The OS gives us no provenance: a device-approval link tapped in WhatsApp is byte-identical to a code deliberately scanned, and the only defence left is the human fingerprint comparison — which a person who did not initiate a scan has no reason to perform.

**So the in-app scanner is not only nicer UX; it is the closest thing to a provenance binding available.** It cannot make "only a scanned code can approve" true by construction — nothing can, without an OS signal — but it can make "the approver chose to point a camera at something" observable, and route everything else through a warning first. That is the spine of this plan, and it is why the scanner and the security fix belong in one change rather than two.

### Why the direction change is needed

greg, testing the shipped 0.21.3 flow on his iPhone, hit the cold surface and found it offers only the _pull_ direction: the phone displays a code for another device to scan. His observation, and it is correct: on a phone the natural direction is the opposite, and W4's own rationale in `docs/plans/2026-09-18-scan-to-sign-in.md` says pull exists for the cold **laptop**, which has no camera. `ColdSignInPanel` leads with pull on every surface regardless of form factor, and nothing on screen mentions the other direction exists.

## Build Order — ONE deployment

**Decided by greg, 2026-09-18: everything ships in a single production deployment.** The sections below are the order the work is BUILT in, not separate releases. Nobody deploys three times.

**⚠️ THE WEB APPROVAL HOLE IS LIVE IN SHIPPED 0.21.3.** An earlier draft of this plan claimed the opposite — that the path was "self-defusing" until Run A's hold-gate landed — and that claim was wrong. Traced against HEAD:

- `main.ts:26` captures the approval marker from the fragment on **any path**, with no check. Its own comment says an approval link "targets `/welcome`", but nothing enforces it.
- `App.vue:1031` at HEAD assigns it immediately on mount, which opens the sheet.
- The init overlay is **opaque** (`bg-[#FDFBF9]`) at `z-[300]` against the sheet's `z-50`, so the sheet opens INVISIBLE behind the loading screen.
- `canApprove` is a **computed** and the key is never cleared, so when `loadFamilyData()` lands the already-open sheet re-renders into the live fingerprint-compare panel.

The "signed-out panel gets dismissed" defence required the user to see and dismiss it inside a sub-second window between the overlay clearing and family data arriving. That is a flicker, not a defence. **Run A's hold-gate does not create the hole; it removes the transient that currently masks it.**

Exploitation is phishing-dependent, not silent: an attacker runs the real cold surface to obtain a genuine link carrying their own public key, sends it, and still needs the victim to tap Approve **and** enter their PIN. But the prompt is indistinguishable from the legitimate one.

**Why one deployment anyway — greg's call, made with the above on the table.** Splitting buys nothing on the calendar (same day, same hands) and costs extra deploy runs, extra rounds of two-phone testing and potentially extra store builds. greg: _"keep one deployment… I am fine with this small issue and we can continue as normal."_

**Stop-loss.** If W1/W2 verification slips past the intended ship day, W4+W5+hygiene go alone — they are independently deployable by construction (see the build order) and need no hardware, so a live hole never waits on a PIN-pad refactor.

**What survives from that analysis is the dependency fact, which shapes the build order:** the `entry` discriminator does not depend on the scanner. With no in-app-scan producer yet, every arrival is `deep-link` and gets the interstitial, which is stricter than the end state. So the interstitial can be built and tested before the scanner exists, rather than waiting on it.

**Build in this order**, so a mistake in the widest-blast-radius work cannot take the rest down:

1. **W4 + W5 + hygiene** — the delivery composable, the web `/welcome` restriction, the `approve()` race, the plan/CHANGELOG reconciliation. Unit-testable end to end, no new UI. `entry` lands as a type with only `'deep-link'` produced and the interstitial unconditional.
2. **W1 + W3** — the direction change, the scanner (which adds the `'in-app-scan'` producer), the minting spinner.
3. **W2** — the hybrid PIN pad, itself staged in three revertible steps (see W2). This goes last because `PinInput` has 14 instances across 8 files and is the one component that can break login for everyone.

Everything is then verified together and deployed once.

## Requirements

1. On a touch-primary device the cold surface leads with **push** (scan a code shown by a signed-in device); on a pointer-primary device it leads with **pull**, as today. Both directions remain reachable on both, so the user can switch.
2. An **"Open Camera"** action on the cold surface photographs a code and decodes it in-app.
3. An in-app **"Scan a Code"** entry point exists on the signed-in device, homed in the profile menu. ⚠️ It reaches the sheet by a `ProfileMenu → AppHeader → App.vue` emit chain (the shape `SignInCodeSheet` already uses) — **not** a new pinia store, which would undo the no-module-state property W4 exists to establish. Note `AppHeader` is conditionally rendered (`v-if="!headerReclaimed"`), so the home is not quite permanent.
4. Provenance is a property of the **approver's entry point**, not of the payload: a key that arrived through the in-app scanner goes straight to the fingerprint compare; a key that arrived through a deep link is shown an interstitial first.
5. The pull QR does not start its 3-second file poll until the user opens that disclosure.
6. One **hybrid** `PinInput`: an on-screen keypad on touch, a physical keyboard everywhere, one component and one set of behaviours.
7. `autofocus` on `PinInput` actually focuses, at all **nine** existing call sites across **seven** files.
8. The "Sign In Another Device" sheet shows a spinner while the code is being minted.
9. The device-approval delivery gate is a **tested composable**, tri-state, session-scoped, TTL-bounded, and instrumented on every path including the hold.
10. The web capture path is restricted to `/welcome`, closing a hole that is **live in production today** (`main.ts:26` has no path check) and that Run A's hold-gate makes deterministic.
11. `DeviceApprovalSheet.approve()` cannot publish a wrap for a request that has been superseded or dismissed.
12. Everything ships in ONE deployment. Run A never ships without its review findings.

## Important Notes & Caveats

- **The in-app scanner is point-and-shoot, not a live viewfinder.** `useFilePicker` with `capture: 'environment'` opens the OS camera for one photo, and `decodeQrFromImageFile` (`src/utils/qrDecode.ts`) decodes it. A real viewfinder needs `getUserMedia` and an Android camera permission the manifest deliberately does not declare. greg asked for "open camera… and once the scan is done, the app should open again" — with this mechanism the app never leaves, so that requirement is satisfied by construction rather than by returning.
- **This deliberately reverses a documented non-goal.** Run A's plan and `docs/plans/2026-09-18-scan-to-sign-in.md:84,511` both ban an in-app scanner. Both also wrote the escape hatch: it would reuse the kit decoder end to end as a separate small change. This is that change. Say so in the two comments that currently assert the ban — `ColdSignInPanel.vue:14-18` and `DeviceApprovalSheet.vue:5-9` — or they become the next misleading comment. **The replacement text must preserve the `getUserMedia` ban**, which is what stops the next implementer reaching for a viewfinder; what changes is a point-and-shoot file capture, not the camera-permission position.
- **Follow `useReminderTapResume`'s WATCH SHAPE, not its SCOPE.** Its docblock states the problem well — "COLD START is the case this exists for… `{ immediate: true }` means the watch consumes any intent stashed before it was created, so ordering can never lose the tap" — and that tri-state-plus-immediate-watch shape is exactly right here.
  **Its module scope is not.** Module scope exists there because a notification tap can fire before any component exists. That does not apply: both writers of an approval key run inside `App.vue`'s setup, so the consumer always predates the producer. A **setup-scoped** composable returning `{ approvalKey, entry, deliver }` is simpler, testable with a `withSetup` harness and no `__resetForTesting` export, and makes Requirement 9's "session-scoped" property structural instead of something someone must remember to clear.
  **Confirmed finding, file separately:** `useReminderTapResume` DOES share the cross-session hazard — `pendingIntent` is module-scoped with no sign-out or family-switch clear, only `__resetReminderTapForTesting()`. Severity low (a stale intent navigates to another family's `/activities?activity=<id>` and simply misses, leaking nothing), but it belongs on the Notion tracker with the other follow-ups.
- **Do not gate delivery on `isInitializing` or on a bare `canApprove`.** Both have been tried and both are wrong; the reasoning is in Run A's code comments and must be preserved when the logic moves.
- **`/welcome` restriction is not a provenance check.** Whatever else changes, no comment or test may claim it closes tap-phishing. It narrows which URL an attacker must use, nothing more.
- **Dual-casing standard**: `en` Title Case, `beanie` lowercase, brand noun `beanies` always lowercase. greg's "scan a beanies QR code" therefore becomes `en: "Scan a beanies QR Code"`. Flag to greg if any result reads badly.
- **E2E budget is 21 of a hard cap of 25** (ADR-007), and `playwright.config.ts` has no `testIgnore`, so scratch verification scripts go in `scripts/design-screenshots/` only and are deleted after.

## Assumptions

> Verified against the working tree on 2026-09-18.

1. `useIsTouchPrimary` exists and is the correct signal, **but initialises `false` and only reads `matchMedia` in `onMounted`** (`:14,22-27`), so it must be fixed to read synchronously at setup before the whole panel depends on it.
2. `PinKeypad` exists in `src/components/ui/`, is presentational and PIN-agnostic, and is used by `WallUnlockPad`.
3. `useFilePicker` supports `capture: 'environment'`, and `decodeQrFromImageFile` handles images and PDFs.
4. `BeanieSpinner` exists with `size` variants and a **`label` prop** (`:10`) that already renders `t('action.loading')` with animated dots and `role="status"`.
5. `useReminderTapResume` and `useDeepLinkParam` are both unit-tested and already wired into `App.vue`.
6. `APPROVAL_EXPIRY_MS` is 3 minutes (`src/services/crypto/deviceApproval.ts:49`).
7. No test in the repo mounts `App.vue`; `DeviceApprovalSheet` is mountable but untested.

## Approach

### W1 — Cold-surface direction, and the scanner

`ColdSignInPanel` gains a form-factor branch on `useIsTouchPrimary`:

- **Touch-primary → push leads.** Numbered steps (open beanies on the signed-in device → profile → "Sign In Another Device" → point this phone at the code), plus an **Open Camera** button that runs the capture-and-decode path. Pull is demoted to a secondary "Show My Code Instead" disclosure.

⚠️ **Open Camera must NOT re-implement link handling.** The code it photographs on the cold surface is the invite/device link minted by `SignInCodeSheet`, and `PasteLinkPanel.openPastedLink()` is already its complete consumer: scheme normalisation, `parseInviteLink`, the nine-key query reconstruction, the "emit as well as push because a duplicate navigation fires no watcher" fix, and the `magicLink.pasteUnparseable` error. That is roughly 45 lines carrying three separate ⚠️ comments. Extract its body and have both the paste box and the camera button call it. ⚠️ **It cannot be a plain exported function**: `PasteLinkPanel.vue:29` gets its router from `useRouter()`, which throws outside setup. **Decided: a composable, `useBeaniesLinkSubmit()`.** Both call sites are in setup (`PasteLinkPanel.vue:29` already calls `useRouter()`; the Open Camera button lives in `ColdSignInPanel`'s setup). Importing the `router` default export would make the unit unmockable without booting the real router, for identical ergonomics.

- **Pointer-primary → pull leads**, exactly as today, with the push steps as the secondary.
- `PasteLinkPanel` stays visible in both.

**What the three callers share is a CLASSIFIER, not a decode path.** Each consumes a different payload — the cold surface an invite/device link, the profile-menu scanner a `#beanies-approve=` key, kit entry a `parseKitInput` code — and each can be handed the wrong one, which is genuinely likely because all three are square black-and-white codes in the same product. Today the error text then lies: `parseInviteLink` returns null on an approval URL, so the cold surface would say "check it copied fully" about a link that copied perfectly.

So the shared unit is **`classifyBeaniesQr(text)`**, returning a discriminated union: `{kind:'approval',key}` / `{kind:'invite',parsed}` / `{kind:'kit',code}` / `{kind:'beanies-url-unknown'}` / `{kind:'not-beanies'}`. `useQrCapture` stays thin: pick → decode → classify → hand back a tagged result.

⚠️ **The wrong-code COPY goes in one exhaustive table, not per call site.** Three call sites each hand-writing a message per other arm is a 3×5 matrix that becomes 4×6 with the next code type, with nothing failing when a cell is missing. What the user needs to hear is a property of **what they scanned**, not of where they scanned it: "that's the code a signed-out device shows — you need the one from a device that's already signed in" is true wherever it is read. So: a single **`wrongCodeMessageKey(found: QrKind): string`** beside the classifier, backed by a one-dimensional `Record<QrKind, string>` so **TypeScript fails to compile** when a new kind is added and the table is not filled. If the message depends only on what was scanned, `expected` is dead weight and reintroduces the matrix this paragraph exists to prevent — call sites compare `found !== expected` themselves and pass only `found`.

⚠️ **Kit entry is NOT a consumer of `useQrCapture`.** `LoadPodView` does not use `useFilePicker` at all — it is a `<label>`-wrapped native input (`:1625-1631`) calling `decodeQrFromImageFile` directly (`:132-133`). Migrating it buys nothing and **adds a failure mode it does not have** (`open()` returning false is only reachable because `useFilePicker` clicks the input programmatically; a `<label>` cannot fail that way). It is also the only reason `useQrCapture` would need `{ accept, capture? }` and the only reason the reverted-`capture` note at `:1611-1624` is load-bearing here. So `useQrCapture` serves the **two new camera call sites only**, with `capture: 'environment'` and `accept="image/*"` fixed. Keep a `kit` arm in the classifier for **recognition** so a kit code scanned at the cold surface still gets a real message, but do not touch `LoadPodView`. File kit consolidation as a follow-up.

⚠️ **`useFilePicker.open()` returns `false`** when the hidden input never mounted, and its docblock says callers surface their own message. `useQrCapture` propagates that boolean; both Open Camera buttons render a real failure string on it. A flagship new button that is a tap doing nothing is the single outcome this pass exists to prevent.

**`decodeQrFromImageFile` widens to FOUR reasons, not three.** `no-code` (jsQR found nothing — the only one a user may be blamed for), `unreadable-image` (HEIC, corrupt file), `unsupported-device` (`getContext('2d')` returned null), and `decoder-unavailable` (a rejected `import('jsqr')`/`loadPdfjs()` chunk — the offline first-load case `LoadPodView.vue:143-147` already calls out). ⚠️ Note `unsupported-device` is reached by an early `return null` at `qrDecode.ts:25-26`, **not** by the blanket `catch` at `:54`, so the implementer restructures that return as well as the catch. It has exactly one caller today (`LoadPodView.vue:133`), so widening it is cheap. The union carries the underlying error so the function reports once with a real stack, rather than callers re-reporting a reason string with nothing behind it.

**Poll on tap, not on mount.** `DeviceApprovalRequest` starts a 3-second whole-file poll in `onMounted`. Mount it when the disclosure opens. Two further reasons beyond bandwidth: `onMounted` also runs `createApprovalRequest()` and `emitDeviceApprovalRequested()` (`:209-210`), so eager mounting generates a throwaway ECDH keypair and **inflates the `device_approval_requested` denominator on every cold-surface view**.

⚠️ **`retry()` is `window.location.reload()` (`:262`) and must change.** Behind a disclosure, a reload drops the user back on the collapsed push view with the pull section shut, so "Show a new one" visibly does the opposite of what it says. Bump a `:key` on the component instead — a remount is the semantics `retry()` actually wanted; the reload was only ever a way to get one. ⚠️ **The key must be owned by the PARENT**: `retry()` lives inside `DeviceApprovalRequest`, which cannot key itself, so this is `emit('retry')` plus a counter held by `ColdSignInPanel`.

⚠️ **Fix `useIsTouchPrimary`, not the panel — and do not hand-roll the fix.** It initialises `ref(false)` and reads `matchMedia` only in `onMounted` (`:14,22-27`), so a touch device would paint the pull-first layout and then swap. **`src/composables/useMediaQuery.ts` already does exactly the right thing** (synchronous read, SSR guard, scope-disposed listener), so this becomes `return useMediaQuery('(pointer: coarse)', false)` and deletes ~20 lines.

`useMediaQuery.ts:22-26` claims it was "deliberately NOT adopted by … `useIsTouchPrimary`" because those are "module-scoped singletons". **That reason is factually wrong for this consumer** — `useIsTouchPrimary.ts:14` creates a fresh `ref` per call and already uses `onMounted`/`onUnmounted`. Correct that stale note in the same change. Two things to check rather than assume: the return type narrows to `Readonly<Ref<boolean>>` (both existing consumers only read it), and `AiDocumentPicker.test.ts:15-23` stubs `matchMedia` before mount so it still passes.

**Provenance — decided, not left open.**

⚠️ **A nonce in the code proves nothing, and an earlier draft of this plan wrongly proposed one.** The QR is generated by the **cold device** (`createApprovalRequest()`, called at `DeviceApprovalRequest.vue:209`). An attacker simply runs the real beanies cold surface on their own laptop, obtains a genuine app-issued nonce inside a genuine `/welcome#beanies-approve=…` URL, and sends that link. The nonce attests that the _sender's_ app minted the code, which was never in doubt, and says nothing about how the _approver_ came to be holding it. Shipping it would have burned an envelope-format change to buy a comment claiming to close tap-phishing — the exact false claim this plan's own caveats forbid.

**Provenance is therefore a property of the approver's entry point — and it is carried by the transport field that already exists**, rather than as a second parallel flag. Extend `DeliveryKind` (`deepLinkEvents.ts:35`) to `'warm' | 'cold-launch' | 'web-load' | 'in-app-scan'`, keep the buffer's payload as the single `{ key, delivery }` object it already carries, and derive the rest: `const needsInterstitial = delivery !== 'in-app-scan'`.

That matters for more than tidiness: if `entry` were a separate ref on `App.vue` set by "whichever producer fired", a buffered deep-link key could be released while the flag read `in-app-scan`, skipping the interstitial for exactly the key it exists to gate. One object, one buffer, desync structurally impossible. It also means every call site already supplies it, and `approval_entry_point` becomes redundant because `approval_key_delivered`'s `kind` already carries it — **delete that event**. Update the "one vocabulary" docblock at `deepLinkEvents.ts:37-42`, since a fourth transport is being added to that vocabulary legitimately (an in-app scan IS how the key arrived), and an unexplained addition reads as the drift that comment forbids.

The sheet then takes one `:delivery` prop and the interstitial is one `v-if` in one component:

- `delivery === 'in-app-scan'` → the fingerprint-compare panel directly. The user demonstrably chose to point a camera at something.
- anything else → an interstitial first: "Did you just scan this code with your camera? If someone sent you this link, close this." Close is the equally-weighted default, not a secondary action.

That is the only binding available without an OS provenance signal. **Residual gap, recorded rather than papered over:** a user who taps through the interstitial is no better protected than today. The Help Center may claim exactly this and no more.

⚠️ **THE INTERSTITIAL BECOMES THEATRE UNLESS THE SCANNER IS THE PROMOTED ROUTE.** The cold surface's own QR is a `/welcome#beanies-approve=` link and today it tells people to scan it with their phone's camera — which produces `deep-link`. If that stays the primary flow, virtually every legitimate approval hits the interstitial, which is precisely how users are trained to tap through warnings. Three things make it defensible instead:

1. **Promote the in-app scan.** The touch-primary push copy leads with "open beanies on your signed-in phone → profile → Scan a Code", and "or use your phone's camera" is demoted.
2. **Instrument the dismissal.** Add `approval_interstitial_dismissed` (warn; `action` + `kind`, both allowlisted). This is the ONLY signal that could ever reveal a live phishing attempt in CloudWatch, and it converts the interstitial from friction into a detector.
3. **Name a delete-or-keep threshold.** If after 30 days `approval_key_delivered{kind=in-app-scan}` is under roughly half of approvals, the interstitial is friction with no constituency and should be removed rather than left to be tapped through.

### W2 — One hybrid PIN input

`PinInput` stops removing the hidden input when `keypad` is set. Instead the input is always present, with `inputmode="none"` when the on-screen pad is drawn. Focus, paste, the accessible name and a physical keyboard keep working; the OS keyboard still never opens, which was the whole reason for the split. Three special cases delete themselves: the sr-only progress region (`:91-93`), the permanently-on `caretActive` (`:73`), and `focusInput()`'s early return (`:68`).

⚠️ **`PinInput` must NOT call `useIsTouchPrimary()` itself.** There are **16** `<PinInput>` instances across 8 files. If the component decides, all 16 change behaviour on touch — including a keypad appearing in the Settings PIN form and the Reset-member-PIN modal, which nobody asked for — it forces `WallUnlockPad` to override back to always-on (a docked wall tablet can report a fine pointer), and it makes all 16 mounts depend on a `matchMedia` stub in tests. `keypad` stays a plain boolean prop passed by the surfaces that want one.

⚠️ **`ReauthChallenge` has THREE hosts, and one is the beanie wall.** It is mounted by `ReauthGateModal.vue:37` (greg's "Sign In Another Device" gate), `WallLockMenu.vue:201` (**the wall**) and `TransferOwnershipModal.vue:195`. On a docked wall tablet `useIsTouchPrimary()` is exactly the signal argued unreliable above, so `ReauthChallenge` takes `keypad` as a **prop from its host** (`WallLockMenu` → `true`) rather than computing it.

That makes **five** mount contexts to verify, not three: `WallUnlockPad`, `ReauthGateModal`, `WallLockMenu`, `TransferOwnershipModal`, `ProveView`. Still a large win over 16.

⚠️ **`ProveView` has three `PinInput`s** — the main entry (`:431`) and the reset-PIN pair (`:389`, `:395`). All three get the pad on touch, one prop each.

⚠️ **`PinSettings.vue:142` is `:autofocus="!hasPin"`, a dynamic binding.** Imperative autofocus means the Settings form starts stealing focus on mount where today nothing does. The two instances are mutually exclusive so there is no focus fight, but **the scroll jump on the Settings page is new behaviour** and gets verified deliberately rather than discovered.

**Stage W2 in three independently revertible steps**, because this component has the widest blast radius in the change:

1. **Imperative autofocus only.** `keypad` stays display-only. Verify the nine sites. Nothing moves on screen — and this alone is what greg literally asked for.
2. **Hybrid input.** Always render the hidden input; `inputmode="none"` under `keypad`. Only `WallUnlockPad` is affected. The three special cases go.
3. **Absorb the keypad**, delete `WallUnlockPad.vue:79-89,179`, opt in from `ReauthChallenge` and `ProveView`. Only here does the wall's boxes→error→keypad ordering question arise, in isolation.

If the day runs out, steps 1 and 2 ship and step 3 defers to a follow-up. Steps 1 and 2 deliver greg's literal ask (focus lands on the PIN pad) plus the structural win, with no visual movement.

`autofocus` becomes imperative (`focusInput()` on mount) rather than the inert native attribute. That repairs **nine call sites across seven files**, not the four an earlier draft claimed: `PinSettings.vue:131,142`, `PinPromptModal.vue:75`, `ReauthChallenge.vue:372`, `ResetMemberPinModal.vue:147`, `ProveView.vue:389,436`, `ResumePodSetup.vue:1115`, `JoinPodView.vue:823`. Most need no edit, but all nine need browser verification, which is a materially different test plan.

**A partial DRY win falls out, and only a partial one.** `ProveView` has TWO focus watchers, and they are not the same thing:

- `:179-188` (`activeMethod`) — the PIN input sits inside `v-else-if="activeMethod === 'pin'"`, so switching to PIN **mounts** it. Mount-focus subsumes this. Delete it.
- `:167-176` (`props.error`) — fires on a **wrong PIN with no remount**, and does `pinValue.value = ''` **as well as** refocusing. Mount-focus cannot cover it. ⚠️ **Deleting this loses clear-on-wrong-PIN**, and `pinInputRef` must stay for it.

The pad is drawn on touch-primary devices at the reauth gate **and** at `ProveView`'s main PIN entry, per greg's "the same logic goes for logging in when on a phone or tablet".

⚠️ **`WallUnlockPad` is where the duplication actually lands.** Once `PinInput` renders its own `PinKeypad` when `keypad` is passed, `WallUnlockPad` would keep a second `<PinKeypad>` (`:179`) plus its own `press()`/`backspace()` (`:79-89`) — digit append, `PIN_LENGTH` clamp, error clear, disabled guard — which is precisely the logic `PinInput` now owns, in two copies. `WallUnlockPad` deletes both and relies on `PinInput`'s. **Layout consequence, decided:** the wall renders boxes → error → keypad today, and internalising the pad necessarily moves the error below it. **Ships as boxes → keypad → error**, accepted as a visual change and verified on the wall at 1024px.

Two behaviours to preserve and name: `inputmode="none"` is what keeps the OS keyboard down (the entire reason the `keypad` branch exists), and the hidden input plus the keypad become **two writers of `modelValue`** — the existing watch at `PinInput.vue:54-64` already resyncs `inputEl.value`, so it works, but a unit test pins it.

### W3 — Minting spinner

`SignInCodeSheet`'s `isMinting` branch is currently a bare `<p>{{ t('signInCode.minting') }}</p>` (`:74-76`) that announces nothing. `BeanieSpinner` already has a `label` prop rendering `t('action.loading')` with animated dots and `role="status"`, so the whole branch becomes `<BeanieSpinner size="md" label />` and `signInCode.minting` is deleted (grep confirms exactly one consumer).

⚠️ **Flag to greg:** this changes the `en` string from "counting beans..." to "Loading...". That is what the dual-casing standard asks for (the `beanie` value stays "counting beans..."), but it is a visible copy change on a surface he is watching, so confirm rather than assume.

### W4 — The delivery gate becomes a tested composable

Move the gate out of `App.vue` into a **setup-scoped** composable (see the caveat on why the `useReminderTapResume` precedent applies to its watch shape but deliberately not to its scope). It must be:

1. **Tri-state**: `ready` / `not-yet` / `never`. Only `not-yet` buffers. `never` (signed out here, auth failure) hands the key to the sheet so its existing signed-out panel — currently dead code — can explain itself.
2. **Session-scoped**: cleared by sign-out and family switch, so a held key can never be released into a different member's session.
3. **TTL-bounded** against `APPROVAL_EXPIRY_MS`, so an abandoned request is dropped rather than approved into the void.
4. **A computed, not a two-way retraction.** "Close the sheet when the surface goes unusable" is just "the predicate went false", so expose `approvalKey` as a **computed** that is `null` whenever the surface is unusable. One source of truth, no retraction path. Making the composable both produce and retract its own output is the two-writer shape this plan flags as a hazard elsewhere.
   ⚠️ **And the predicate comes in as a `Ref<boolean>`, not as store reads.** Define ONE `isSurfaceUsable` computed in `App.vue` folding `familyKey && currentMember && !initError && !fatalErrorStore.message`, and pass it in. Boolean in, key out: the composable knows nothing about stores, its tests need no pinia, and the next person who adds a fifth fatal signal edits one computed.
   ⚠️ **Correct the justification while you are there.** An earlier draft said `fatalErrorStore.message` and `initError` are "separate signals". They are not — `App.vue:319-328` already mirrors one into the other. The real reason to fold both in is narrower: that mirror is a default-flush watcher while the gate's own watch is `flush: 'sync'`, so the gate can observe a fatal one tick before `initError` catches up.
5. **Instrumented on every path**, including the hold, so native has an arrival denominator.
6. **Identity-aware**: re-delivering the same key is not a supersession; superseding tags the **held** key's transport, not the incoming one.
7. Carrying `{ key, delivery }` as one object, which removes the latent TDZ.

⚠️ **Provenance is DERIVED from `delivery`, never stored separately.** The composable's payload stays the single `{ key, delivery }` object; `DeviceApprovalSheet` takes `:delivery` as a prop beside `:public-key` and computes `needsInterstitial` itself. Deleting the interstitial later is then one `v-if` and one union member, not two parallel ref chains to unpick.

⚠️ **Setup scope does NOT give session-scoping for free, and an earlier draft claimed it did.** `App.vue` never unmounts, so setup scope removes the cross-TEST leak, not the cross-SESSION one that Requirement 9 exists for. Name the actual reset trigger — a watch on `familyContextStore.activeFamilyId` and on `syncStore.familyKey` going null — and give it an acceptance test. Otherwise an implementer believes scope did the work and ships a held key that survives a family switch.

### W5 — Security and the sheet's race

- Restrict the **web** capture to `pathname === '/welcome'`.
- **EXACT-MATCH ALLOWLIST. Delete `isPathUnder` outright, and do NOT reuse `isRouteActive`.** An earlier draft prescribed sharing `isRouteActive` between the routing allowlist and the marker gate. That would have **widened** the marker gate: `isRouteActive` matches descendants, so `/welcome/anything#beanies-approve=…` would start _delivering_ keys that are correctly refused today — the opposite of Requirement 10.
  `/welcome` and `/join` are flat routes with no children (`router/index.ts:97,109`), so descendant matching is not needed by either consumer. Replace `ROUTABLE_PREFIXES` + `isPathUnder` with an exact-match set plus one trailing-slash normalisation. Then the routing gate and the marker gate are the same comparison **by construction** rather than by a shared helper someone must remember to keep shared; today's divergence (`:118` admits `/welcome/`, `:165` requires an exact match, `:219` strips the fragment regardless, so `/welcome/#beanies-approve=…` routes and silently discards the key with no telemetry at all) cannot recur; and **`route.ts` never becomes a security consumer**, which removes the hardest-to-reverse coupling in this plan — a nav-highlighting helper permanently carrying an auth contract, where a future "make nav matching more forgiving" change silently widens a boundary.
  Keep the `path-not-eligible` drop event; it is now the only other thing in this bullet.
  **The web side gets the same normalised exact comparison**, placed in `main.ts` beside `captureHashMarkers([APPROVAL_LINK_HASH])`. Not `startsWith`.
  **Coverage is demonstrable, not asserted:** every consumer of `APPROVAL_LINK_HASH` is `main.ts:26` (web capture), `App.vue` (web take), `inboundLinkBridge.ts:165` (native) and `DeviceApprovalRequest.vue:213` (producer). `consumeHashMarker` serves only `KIT_LINK_HASH`. There is no fourth path.
- **`DeviceApprovalSheet.approve()` — two signals, not one overloaded counter.** An earlier draft said to move `readGeneration++` above the watcher's early return at `:93-94`. That does make a dismissal bump the counter, but then `generationAtStart !== readGeneration` is true for BOTH "superseded" and "dismissed", while the plan needs two distinct messages and two distinct `error_code`s from that one comparison — which it cannot give. It also doubles the counter's churn, since `open` goes `true→false→true` on every cycle, weakening any future same-request comparison.
  So leave `readGeneration` meaning exactly one thing (_a new code arrived_) and test dismissal separately, after `await requireReauth`:
  - `if (!props.open)` → `request_dismissed`, no user message (the sheet is gone).
  - `else if (generationAtStart !== readGeneration)` → `request_superseded`, with "that request was replaced — compare the new code and approve again". An unqualified failure over a fresh fingerprint reads as though the NEW one failed.
    Re-checks: the meaningful one is **between `wrapForApproval` (`:160`) and `setDeviceApprovalWrap` (`:171`)**, because `:160` is what binds the family key to `req`. A re-check at `:183` fires after a wrap has already published and cannot be unpublished — state which message that case gets, or the implementer shows a failure over a success.
- **The `consumer-threw` double-count**: `reportError` itself calls `logEvent` with the caller's surface, so the catch at `inboundLinkBridge.ts:183-192` writes two `deep-link` events carrying the same `action`. Keep both calls (the stack detail is worth having) and change the `reportError` context to `action: 'approval_consumer_error'`. Only the `action` collides.

### Hygiene

Reconcile Run A's plan file at **both** `:89` (approach) and `:144` (acceptance criterion), which still prescribe the `markConsumed` placement the code deliberately reversed; fix the prompt-archive heading convention and frontmatter; **replace** the CHANGELOG entry rather than correcting it, since it describes only Run A's delivery fix and its "waits until your family data has loaded" clause claims more than the code yet honours; the shipped entry covers the whole change; add the `docs/STATUS.md` pointer; file the two engineering follow-ups (the eight-site broadcast-registry extraction, the bridge's hand-typed `login-flow` events) to the **Notion tracker**, not STATUS.

## Files Affected

- `src/components/login/ColdSignInPanel.vue`, `DeviceApprovalRequest.vue`, `PasteLinkPanel.vue` (extract `submitBeaniesLink`), `LoadPodView.vue` (kit call site)
- `src/components/ui/PinInput.vue`, `src/components/wall/WallUnlockPad.vue` (drops its duplicated keypad wiring), `src/components/login/ProveView.vue` (drops its local focus workaround), `src/components/auth/ReauthChallenge.vue`
- Browser-verify only, no edit expected: `PinSettings.vue`, `PinPromptModal.vue`, `ResetMemberPinModal.vue`, `ResumePodSetup.vue`, `JoinPodView.vue`
- `src/components/auth/SignInCodeSheet.vue`, `DeviceApprovalSheet.vue`
- `src/components/common/ProfileMenu.vue`, `AppHeader.vue` (the scanner's host)
- `src/composables/useQrCapture.ts` (new), `useDeviceApprovalDelivery.ts` (new)
- `src/utils/qrDecode.ts` (four-reason union + `classifyBeaniesQr`), `src/utils/route.ts` (security-consumer warning), `src/composables/useIsTouchPrimary.ts` (synchronous initial read)
- `src/App.vue` (gate moves out), `src/main.ts` (web path restriction)
- `src/services/share/inboundLinkBridge.ts`, `src/services/telemetry/deepLinkEvents.ts`
- `src/services/translation/uiStrings.ts` (`en` + `beanie` for every new key)
- Tests for both new composables, `DeviceApprovalSheet`, and `PinInput`
- `docs/plans/2026-09-18-device-approval-deeplink-notification.md` (reconcile), `CHANGELOG.md`, `docs/STATUS.md`, `docs/prompts/2026-09/2026-09-18-scan-to-sign-in.md`

## Help Center Coverage

- **Action**: `update existing`
- **Category**: `getting-started`
- **Scope**: Getting beanies onto another device now has two directions and an in-app scanner; the article should say which to use when, and that the fingerprint comparison is the thing that matters.
- **Notes**: must NOT claim scanning is safer than tapping a link in a way the code does not enforce. Whatever provenance binding W1 settles on is what the article may claim, and no more.

## Observability Coverage

Surface `deep-link` (existing) plus the delivery composable:

- `approval_key_held` (info) — the missing arrival denominator for native.
- `approval_key_delivered` (info) — emitted once the sheet is actually actionable, with `kind` = transport.
- `approval_key_dropped` (warn, surface `deep-link`) — ⚠️ this list is the shipped set; an earlier draft named `never-ready`, which exists nowhere in `src/`, and omitted `session-changed`, which the composable does emit. An alert built from the stale list would have filtered on a code that can never fire and missed every sign-out loss. — `error_code` one of `empty-key`, `path-not-eligible`, `superseded` (the buffer's two-scans-in-one-load case), `expired`, `session-changed`, `consumer-threw`. Every terminal loss path emits exactly one, and the consumer-threw `reportError` uses `action: 'approval_consumer_error'` so it does not double-count.
- ⚠️ **Do not merge vocabularies across surfaces.** `approve()`'s `request_dismissed` / `request_superseded` go to `emitDeviceApprovalOutcome` on the **`login-flow`** surface, not to `approval_key_dropped` on `deep-link`. Existing device-approval codes mix hyphen and underscore and `errorCode` is a free `string`, so state the convention: **new codes use hyphens on `deep-link`, and match the surrounding underscore style on `login-flow`.**
- `approval_interstitial_dismissed` (warn; `action` + `kind`) — **the only signal that could ever reveal a live phishing attempt in CloudWatch**, and what turns the interstitial from friction into a detector.
- No separate `approval_entry_point` event: `approval_key_delivered`'s `kind` already carries the transport, including `in-app-scan`.
- QR capture: decode failures split four ways (`no-code` / `unreadable-image` / `unsupported-device` / `decoder-unavailable`), plus a `wrong-code-kind` outcome from `classifyBeaniesQr` when someone scans the right product's wrong code, and a picker-never-opened outcome from `useFilePicker.open()` returning false.

All ride already-allowlisted keys (`action`, `kind`, `error_code`, `route_path`), so no `ALLOWED_CONTEXT_KEYS` change, no Lambda mirror change and no store re-declaration. The approval key is never logged.

## Acceptance Criteria

- [ ] Touch-primary leads with push; pointer-primary leads with pull; both switchable.
- [ ] Open Camera decodes in-app; the app never leaves.
- [ ] In-app "Scan a Code" exists in the profile menu and feeds the sheet directly.
- [ ] The interstitial renders for every non-`in-app-scan` arrival, with Close weighted equally, and `approval_interstitial_dismissed` fires when it is closed.
- [ ] The in-app scan is the PROMOTED route in the touch-primary copy, not the fallback.
- [ ] `path-not-eligible` fires when a marker is stripped from a routable-but-ineligible path.
- [ ] `isPathUnder` is deleted; routing and marker gates are the same exact-match comparison; `route.ts` is NOT a security consumer.
- [ ] `retry()` no longer calls `window.location.reload()`.
- [ ] `useIsTouchPrimary` is `useMediaQuery`-backed and reads synchronously at setup.
- [ ] `decodeQrFromImageFile` returns the four-reason union and each reason renders a distinct message.
- [ ] `wrongCodeMessageKey` is exhaustive and a wrong-code scan gets a directive message.
- [ ] `useFilePicker.open()` returning false renders a real failure string at BOTH camera buttons.
- [ ] The pull QR's poll starts on disclosure, not on mount.
- [ ] One `PinInput`; keypad on touch; physical keyboard everywhere; `autofocus` works at all **nine** call sites.
- [ ] Minting shows a spinner.
- [ ] The gate is a composable with tests covering tri-state, session reset, TTL, supersession identity, and the fatal path.
- [ ] Web capture restricted to `/welcome`.
- [ ] `approve()` cannot publish for a superseded or dismissed request; the abort is visible to the user.
- [ ] Run A's plan reconciled; CHANGELOG corrected; follow-ups filed to Notion.
- [ ] `npm run validate` green; every new regression test verified to fail against the unfixed code.
- [ ] Both light and dark, desktop and 390px, on every surface touched.

## Testing Plan

1. Unit: both new composables; the three new pure functions (`classifyBeaniesQr`, `wrongCodeMessageKey`, the four-reason `decodeQrFromImageFile`); `PinInput` hybrid behaviour with two writers of `modelValue`; `DeviceApprovalSheet.approve()` races (dismissed vs superseded as separate signals); the `/welcome/` regression in `inboundLinkBridge`; and the delivery composable's session reset on family switch.
2. Regression: each carried Run A finding gets a test that fails without its fix.
3. Browser: the cold surface in both form factors, both themes, at 390px and desktop; the PIN pad; the minting spinner. `scripts/design-screenshots/`, deleted after.
4. greg's hands: the two-device scan both directions, on iPhone and Android, warm and cold; and the in-app scanner against a real cold laptop.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted five workstreams around the provenance insight, folding Run A's unfinished security and reliability work into the same change.
- **Pass 2 (DRY + error handling)**: Cut the unsound nonce-provenance option (the COLD device generates the code, so an attacker running the real cold surface obtains a genuine nonce and the check proves nothing) and fixed provenance to the approver's entry point with an interstitial for deep-link arrivals; routed Open Camera through `PasteLinkPanel`'s existing link consumer instead of a second copy; reshaped the shared unit from a decode wrapper into a `classifyBeaniesQr` union so a wrong-code scan gets a directive message rather than a lie; corrected four autofocus call sites to nine across eight files and added `WallUnlockPad`'s duplicated keypad wiring; replaced W3's hand-rolled text with `BeanieSpinner label`; added `fatalErrorStore.message` to the gate predicate, a fourth decode reason, two distinct abort messages, a `path-not-eligible` event, and a named fix for the `consumer-threw` double-count; made the delivery composable setup-scoped rather than inheriting the module scope that is itself the hazard Requirement 9 exists to close; and confirmed `useReminderTapResume` shares that hazard.
- **Pass 3 (Sustainability)**: Split the change at the security/UX seam (W4+W5+hygiene can ship first with the interstitial on every arrival; scanner and PIN work follow) and staged W2 into three revertible steps; kept form-factor detection at `PinInput`'s call sites rather than inside it, cutting the browser-verification matrix from fourteen instances to three; moved entry-point provenance onto the sheet as a prop and the fatal predicate into one `isSurfaceUsable` computed passed in as a `Ref`, so the delivery composable stays a buffer with a named session-reset trigger; moved wrong-code copy into an exhaustive `Record` so a fourth code type fails to compile; dropped kit from `useQrCapture`'s scope and `useIsTouchPrimary` onto the existing `useMediaQuery`; corrected the `approve()` race to two signals rather than one overloaded counter; and preserved `ProveView`'s wrong-PIN clear-and-refocus watcher that the DRY win would have deleted.
- **Pass 4 (Fresh-eyes sweep)**: Found the plan's central premise inverted — the web approval hole IS live in shipped 0.21.3, because `main.ts:26` captures on any path and the opaque `z-[300]` init overlay hides the sheet until `canApprove` flips true, so the "dismiss the signed-out panel" defence never happens — and rewrote the one-deployment rationale from "no urgency" to "no calendar gain", with a stop-loss; replaced the shared-predicate `isRouteActive` reuse, which would have WIDENED the marker gate to `/welcome/*`, with an exact-match allowlist that deletes `isPathUnder` and keeps `route.ts` out of the security path; collapsed `entry` into `DeliveryKind` so key and provenance cannot desync in the buffer, deleting the redundant `approval_entry_point`; made the interstitial defensible by promoting the scanner, adding `approval_interstitial_dismissed` and naming a 30-day delete-or-keep threshold; caught that `ReauthChallenge` has three hosts including the wall so `keypad` must be a prop; reduced `wrongCodeMessageKey` to one dimension; settled the composable-vs-router and wall-layout decisions; and corrected the `<PinInput>` count (16) and eight further drifted citations.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### greg, on the cold surface (initial)

> i'm testing the magic link qr sign in just now, and one thing i noticed is that on my iphone, after going to the welcome gate and consenting to my google account, i am provided with a QR code to scan. however, i'm on my phone, and it may be the case that i'm already logged in on my browser. should we also have an affordance for the welcome gate on the phone to scan a QR code (magic link) within the browser as well? i thought that was part of the plan - to allow for push or pull login. is this behavior expected or am i missing something?

### greg, approving the direction and adding scope

> let's shape a fix now to make this more intuitive. also a small improvement, when opening 'sign in a new device' from the profile dropdown, put focus on the pin input pad so the cursor is already there when the user starts typing their pin.

### greg, on the mockup and the PIN pad

> Yes let's prepare a mockup (as a claude artifact) - and one thing to note is that while it's correct that a device with a camera should lead with push, but just to confirm an option/affordance to use pull (i.e. show the qr code) should still exist in the case the users want to switch (i.e. scan with a second logged-in phone). also, please note that on a phone/touchscreen device, we should bring up the touch-enabled PIN-pad (like the one we use on a tablet) as opposed to the keyboard-centric PIN input. the same logic goes for logging in when on a phone or tablet.

### greg, on the spinner

> also please add the normal beanie spinner on the sign in anotehr device surface to ne visible when the magic link is being created, at the moment it just pauses for about 5 seconds and says "counting beans" but without any spinner

### greg, on wording and the in-app scanner

> "Use a Device You're Signed In On" -> "scan a beanies QR code"
> -> for the above, rther than the box "use your normal camera app.." can we also include a button to open the camera on the device (i.e. 'open camera')? and once the scan is done, the app should open again.
>
> "scan this from your other device" -> "scan this from a signed-in device"
>
> in additon, for the "pull" approach above, should we also have an option in the app somewhere to 'scan QR code on another device' to make it clear? ... this is also how it works for whatsapp and other apps (a scanning function is invoked from within the app that scans a QR code on a browser, etc). what do you think?

### greg, on the hybrid PIN pad

> for the touch PIN pad, can/should we standardize on one hybrid design (a pin pad that also works with keyboard input) rather than two designs to reduce complexity in the codebase?

### greg, folding Run A in

> let's go with option 2, fold it into run B, go ahead with /beanies-build-auto

</details>
