# Plan: Scan to sign in — device-to-device as the first-class way into a cold device

> Date: 2026-09-18
> Related issues: None — direct implementation (Notion tracker #97)
> Plan file: `docs/plans/2026-09-18-scan-to-sign-in.md`
> Mockup: `docs/mockups/scan-to-sign-in-2026-09-18.html`

## User Story

As a parent who created a pod on my laptop and now wants the app on my phone, I want to scan a code and land on my PIN screen, so I never meet the recovery kit.

As a parent who set up on my phone and now wants the site on my laptop, I want the laptop to show a code I scan with my phone, so I never paste a credential through a messaging app.

As a parent with no second device, I want to scan my recovery kit rather than transcribe 32 characters.

As the holder of a signed-in phone, I want minting a sign-in code to require my PIN, so someone holding my unlocked phone cannot mint a key to the whole family's data.

## Context

`src/services/auth/magicLink.ts:5-9` records the measurement that started this: **6 of the 22 real families created since telemetry began redeemed a recovery kit, every one on a cold device, and 5 of the 6 then replaced a PIN that worked.** They did not need recovery. They needed a way in.

The kit had become the front door because nothing else was visible. Getting onto a second device is the single worst friction in the product, and it is hit by essentially every family: you sign up on a laptop, then install the app; or you sign up on the app, then open the site.

This issue was reshaped on 2026-09-18 from a four-rung recovery ladder (`docs/research/2026-09-17-cold-device-recovery-options.md`) into one product decision: **scanning a QR from a device that is already signed in becomes the first-class way to sign in on a cold device.** Everything else is a fallback. The kit stays, demoted, and made scannable.

**Almost all of the machinery already exists, and materially more of it than the first draft of this plan assumed.** `qrcode` and `jsqr` are installed; `src/utils/qrCode.ts` generates and `src/utils/qrDecode.ts` decodes; `useMintedLink` is the shared mint sequence; `MintedLinkPanel` is already the QR + link + copy + copy-failure + `qrUnavailable` presentation; `RecoveryKitLink` is already the shared quiet kit chip; `PasteLinkPanel` is already shared across surfaces; **and `DeviceLinkCard` already mints a 15-minute device sign-in link from a signed-in device today, live in Settings.** The dominant problem is **surfacing and wiring, not cryptography and not new components.**

### What the code survey changed about the original framing

Six assumptions turned out to be wrong or already solved. Each shrinks the work:

1. **The PIN-reset complaint is already fixed.** `ProveView.vue:115-135` lands a kit arrival on the member's own first method (usually the PIN), with "Set a new PIN" one tap away via `switchTargets` (`:247-260`), and the comment cites this very measurement. Pinned by `src/components/login/__tests__/ProveView.recoveryOpener.test.ts`. The mockup's "Using your kit won't change your PIN" is therefore **already true** — it becomes copy, not a behaviour change.
2. **The creation screen is already non-skippable.** `RecoveryKitDisplay` is `:closable="false"` (`:167`) and its only exit is an explicit confirm (`:318-320`), after which `ResumePodSetup.handleKitStepStored` (`src/components/login/ResumePodSetup.vue:795-808`) stamps `settingsStore.markRecoveryKitConfirmed()`. The gate exists; the gap is clarity.
3. **An unregistered envelope dict cannot be silently dropped.** `ENVELOPE_KEY_DICTS` is annotated `Record<EnvelopeKeyDictField, …>` (`envelopeMerge.ts:73-81` for the type, `:117-129` for the registry), so omitting a new dict is a compile error.
4. **`ProveView` needs no `PROBES` reorder.** `'recovery'` is in `NON_SWITCHABLE` (`ProveView.vue:214-219`) and the kit already renders as a standalone bottom chip (`:525-531`, `RecoveryKitLink`). `resolveProveMethods` appends the `recovery` terminal **outside the probe loop** (`proveMethods.ts:254-256`), so reordering `PROBES` could not move the kit even if we wanted it to. The kit is already the quiet last resort on this screen. **This deletes the riskiest change in the original draft and, with it, the `fell-back` telemetry discontinuity it would have caused.**
5. **A signed-in device can already mint a sign-in code.** `DeviceLinkCard.vue` + `useMintedLink` + `MintedLinkPanel` + `LINK_EXPIRY_MS` (15 minutes, `src/services/crypto/inviteService.ts:27`) ship today at `SettingsPage.vue:2259`. W3 is a **surfacing and gating** change, not a new mint.
6. **`stagePendingFile` cannot be the W4 poll.** It returns `{ ok: true }` immediately when `syncStore.hasPendingEncryptedFile` is true (`src/services/auth/stagePendingFile.ts:83`) — which is exactly the cold device's state. Polling through it would spin for three minutes against a cached envelope and never see the approval: a silent failure that looks like a working screen. W4 must call `syncStore.loadFromFile()` directly.

## Requirements

1. On every cold surface, **getting in from an already-signed-in device is the top-line way back in** — one short line of copy, ahead of every other route back into an existing beanpod. (It does **not** outrank the Create hero on `WelcomeGate`: see the caveat below.)
2. The recovery kit is a fallback on those surfaces, never a peer.
3. On the recovery-kit entry screen, scan/upload is primary and hand-typing is secondary; a phone offers its camera directly.
4. The family-creation screen leads with the sign-in code (with a QR) and keeps the kit clearly explained beneath it.
5. A signed-in member can mint a sign-in code from the profile menu, gated behind their PIN.
6. A cold device can display its own code and be approved from a signed-in device, with no new server and no in-app camera. ****
7. The cold-unlock funnel emits a denominator and an abandonment signal so the kit-redemption rate can be compared before and after.
8. Every surface is authored for light and dark in one pass.
9. **No path in this feature fails silently.** Every QR render, every QR decode, every dynamic import, every file-picker open, every mint, every publish and every approval has a caught, classified, user-visible and firehose-reported failure with a stated next action.
10. **The work ships in three independently revertible releases** (below), and the durable file format is not touched until the funnel data says it must be.

## Important Notes & Caveats

### Two decisions are SETTLED. One remains open.

**SETTLED (greg, 2026-09-18 — do not reopen):**

1. **The profile-menu "sign in another device" action uses the EXISTING 15-MINUTE DEVICE LINK**, not the 7-day magic link. The approved mockup was updated to match and pushed (`50dd03a4`, `docs/mockups/scan-to-sign-in-2026-09-18.html` surface 4 now reads _"profile menu · PIN-gated · 15 min"_ and _"Works for the next 15 minutes."_). **The plan and the mockup agree; there is no deviation to flag.**
2. **The 7-day magic link is unchanged** and remains what the family-creation screen hands the user, because that one is meant to be saved and used later.

3. **The creation screen KEEPS the save/print/tick checkbox gate** that the approved mockup draws (`scan-to-sign-in-2026-09-18.html:1244` / `:1308` / `:1324`). greg's reasoning, and it is correct: nobody can get stuck, because the checkbox is a plain `<input type="checkbox">` with no network and no platform dependency, so it is always tickable. The earlier recommendation against it assumed a gate that _required_ a successful save; that is not what is drawn.

   > **Binding implementation constraint.** The checkbox arm is **unconditional** — never disabled, never hidden, never dependent on the PDF having been attempted or having succeeded. Continue is released by save **or** print **or** tick. If this is later "tidied" into something like `:disabled="!hasTriedSaving"`, the stranding scenario becomes real on a screen that already loses 47% of its starters (`RecoveryKitDisplay.vue:279-283`, `ResumePodSetup.vue:718-727`, and the never-block rule at `:10-11`). Pinned by an acceptance criterion and a unit test.

4. **Everything ships in ONE release, ungated.** greg, 2026-09-18: _"i'm fine to build everything now and flip the flag to true - no need to keep anything behind a false flag… expectation is we deliver as per the mockup just approved."_ This matches the tracker row's standing `Feature gate: NO` directive. The W0/W1-3+W5/W4 grouping below is retained as **build order**, not as separate releases, and there is no `flagRegistry` entry.

### The mockup is delivered in full, both directions

Because W4 ships in the same release, the approved mockup's **surface 1 (cold entry)** and **surface 2 (cold unlock)** are built as drawn: the cold device shows its own QR, a comparable fingerprint, and a "waiting for approval" state.

Both directions therefore work on day one, and which one a person meets is decided by where the usable camera is — never by them understanding the difference:

| Cold device | Warm device | How it resolves                                                           |
| ----------- | ----------- | ------------------------------------------------------------------------- |
| Phone       | Laptop      | Laptop mints from the profile menu; the phone's OS camera scans it. Push. |
| Laptop      | Phone       | Laptop shows its own code; the phone scans and approves. Pull (W4).       |

The second row is the user story that reads _"so I never paste a credential through a messaging app"_. It is satisfied by W4, which is why W4 is in scope rather than deferred. `PasteLinkPanel` remains available on both surfaces as the fallback for someone who was genuinely sent a link.

**The one irreversible thing in this plan is still W4's envelope dict**, and that has not changed — it is simply accepted deliberately rather than deferred. See _Build order_ below for what that obliges.

### No camera code ships on the cold surfaces, in any release

The word "scan" on `WelcomeGate` / `LoadPodView` / `ProveView` means **the user points their phone's native camera app at a code on another screen**, and the OS opens the deep link. There is no `getUserMedia`, no viewfinder, no in-app scanner anywhere in this plan — the repo has none today and gains none. This is stated here, once, globally, because "make scan the top-line action" reads to an implementer like "build a scanner", and that would be the single largest accidental scope expansion available in this work.

The one place a camera is genuinely involved is **kit entry (W2b)**, and even there it is `useFilePicker`'s `capture: 'environment'` — the OS camera app takes a photo, and `decodeQrFromImageFile` decodes the file. Same mechanism `PhotoAttachments` and `AiDocumentPicker` already use.

If greg later wants an in-app "photograph the code on my other device" path on the cold surfaces, it reuses W2b's decoder end to end and is a separate, small change. **Explicit non-goal here.**

### The scan affordance must not outrank Create on the welcome gate

`WelcomeGate` renders three `LoginChoiceCard`s: a full-width Create hero (`:108`, carrying the "start here" pill), then a `grid-cols-2` row of Sign In (`:205`) and Join (`:238`), then `PasteLinkPanel` (`:276`). Create is the acquisition funnel and is the correct top-line action for a first-timer, who by definition has no signed-in device to scan from.

**Requirement 1 is therefore scoped to "top-line among the ways back in".** On `WelcomeGate` the scan affordance sits at the head of the returning-user group — above Sign In / Join — never above the Create hero. Demoting Create to promote a route only existing families can use would trade the signup funnel for the re-entry funnel.

### Naming is fixed by the CIG, not by preference

Opening a family is **two steps**: _unlock the beanpod_ (family-wide) then _sign in_ (per person, PIN). **"Recovery" names the printed kit and nothing else** (`.claude/skills/beanies-theme/SKILL.md` § Credentials). So every scan surface is headed "Unlock my beanpod" and is an **unlock**, never a "recovery". This also resolves the research corpus's single biggest usability warning (Proton's identity-recovery vs data-recovery confusion) — the CIG already separates them.

### Two link kinds already exist, and W3 uses the SHORT one (settled)

|                | Device link                                     | Magic link                                         |
| -------------- | ----------------------------------------------- | -------------------------------------------------- |
| Lifetime       | 15 min (`inviteService.ts:27`)                  | 7 days (`inviteService.ts:37`)                     |
| Envelope dict  | `inviteKeys`, keyed by token hash, `local-wins` | `memberLinkKeys`, keyed by memberId, `newest-wins` |
| Minting again  | **additive — revokes nothing**                  | **overwrites, killing the previous link**          |
| Meant for      | both devices in hand, right now                 | saved, carried, stored                             |
| Ships today at | `DeviceLinkCard` / Settings                     | `MagicLinkCard` / Settings + creation step         |

**W3's profile-menu action is the device link.** "Sign in another device" is the both-devices-in-hand case by definition, which is the exact sentence `DeviceLinkCard`'s own docblock uses (`:16-17`). Choosing it:

- reuses a shipped, tested mint end to end;
- removes the "a new code stops the old one working" warning entirely from that surface, because a device-link mint is additive — one fewer confusing sentence on a screen whose job is to be obvious;
- narrows the leak window of a full-family-key transport from a week to fifteen minutes, which is the same risk argument that justifies the PIN gate.

The 7-day magic link stays exactly where it is explained — Settings and the creation screen.

### The magic link is a family-wide credential, and it is not single-use

This still governs W1 and the Settings card:

- Nothing decrements on redeem, so it is reusable by anyone holding it for its full 7 days.
- Expiry is a **client-side policy check only**, not a cryptographic bound (`inviteService.ts:33-36`).
- `magicLink.ts:11-14`: _"whoever holds it can open everything the family has; the member binding and the PIN that follows gate the INTERFACE, not the ciphertext."_

The same "a full-FK transport in someone's hands" argument is what justifies the PIN gate in W3 even for the shorter link.

### The token is never persisted, so idempotence is impossible

`magicLink.ts:28-29` — Settings can only mint a **new** magic link, never re-show the live one, and a second mint genuinely revokes the first. `MagicLinkCard` already says so (`magicLink.createWarning`, `magicLink.onlyTimeShown`). Nothing in this plan changes that; W3 sidesteps it by using the additive device link.

### The same magic-link mint has been written three times, and the same bug fixed three times

This is the strongest DRY finding in the survey and it widens W0.3.

`mintMagicLinkPackage` → `setMemberLinkWrap` → `buildMagicLinkUrl` appears, near-verbatim, in **three** places:

- `MagicLinkCard.vue:62-104` (Settings)
- `ResumePodSetup.mintOwnerMagicLink` (`:731-793`, creation)
- `useJoinFlow.mintJoinerMagicLink` (`:1341-1412`, join)

They differ only in the publish timeout (join passes `CREDENTIAL_PUBLISH_TIMEOUT_MS`), the `detail: 'origin=…'` on the telemetry, and the return shape. And the evidence that this is costing real money is written in the copies themselves: `MagicLinkCard`'s comment says _"The other two mint sites already use it"_ about `envelope.familyId`, and `useJoinFlow`'s says _"The other two mint sites already read the store"_ about the provider. **The same two bugs were each found and fixed three times, once per copy.** W0.3 collapses all three.

### `keyDictSize` is blind to overwrites

`envelopeMerge.ts:212-238` — it is a COUNT compared with a strict `>` (`syncStore.ts:2011`), so it detects an added entry and nothing else. Every rotation and revocation is invisible to it. Anything that replaces an entry in place must publish **explicitly** via `putEnvelopeEntry` (`syncStore.ts:478-531`), never rely on riding the next save.

### The creation screen sits at the tail of a flow that already loses 47% of its starters — and it has FOUR hosts

Stated in `RecoveryKitDisplay.vue:279-283` and `ResumePodSetup.vue:718-727`: this is an unclosable modal, and network-dependent things must never wedge it.

**`RecoveryKitDisplay` is mounted by four callers, not two**, and only one of them passes a `magicLink`:

| Host                                                      | `magicLink` prop | W1's reorder applies? |
| --------------------------------------------------------- | ---------------- | --------------------- |
| `ResumePodSetup.vue:1159` (creation step)                 | yes              | **yes**               |
| `RecoverySettings.vue:202` (regenerate)                   | no               | no                    |
| `RecoveryKitPromptModal.vue:101` (the nag)                | no               | no                    |
| `src/pages/dev/MagicLinkCopyHarness.vue:44` (dev harness) | yes              | yes                   |

**W1's reorder must therefore be conditional on `magicLink` being present.** The existing template already brackets the whole link block in `v-if="magicLink || magicLinkErrorKey"` (`:228`); the reorder has to stay inside that bracket, and the "before you go" divider must not render on a kit-only host. Getting this wrong silently regresses two shipped surfaces that this issue never intended to touch.

### Three silent failures already on the path this work promotes

These are pre-existing, and W2 makes each of them a **primary** path, so they are in scope now rather than later:

1. `RecoveryKitDisplay.vue:91-93` — `catch { kitQr.value = ''; }` inside the watch at `:70-98`. No log, no on-screen note. `useMintedLink:59-73` already carries the fix and the reasoning for exactly this case (_"DO NOT `catch { qr = '' }` AND MOVE ON"_); this site never got it.
2. `qrDecode.ts:50-57` — `decodeQrFromImageFile` wraps the whole body in `catch { return null }` (`:54-56`). A corrupt PDF, a failed `pdfjs` chunk load, a `createImageBitmap` refusal and "this photo genuinely has no QR in it" are one indistinguishable `null`, shown as `recovery.kitScanFailed` with zero telemetry. **There is a second, separate `return null` at `:26`** (`canvas.getContext('2d')` returned nothing) which is a decoder-unavailable condition wearing a no-code disguise.
3. `LoadPodView.handleKitPhotoPicked` (`:119-137`) — it has a `try`/**`finally`** with **no `catch`**, so a chunk-load failure on either dynamic `import()` rejects unhandled while `isScanningKit` is reset by the `finally`: the button appears to finish and nothing happens. **The fix is adding the missing `catch`, not adding a `try`.**

And a fourth, on the same screen and the same journey: **`handleKitRedeem`'s outer `catch` (`LoadPodView.vue:912-915`) is `console.error` only** — no `reportError`, no `logEvent`. A throw anywhere in redeem-or-decrypt shows "decryption error" and reaches the firehose never. W5 closes it.

### The unclaimed-adult edge on kit redemption stays as-is

An adult member with no credential at all on an open pod has `firstProvableForKit === undefined` (`ProveView.vue:97-99`) and lands on `reset-pin` with no switch links (`:247-260`). This is the deliberate never-blank guarantee, and it is correct: they have no PIN to preserve. Not changed by this work; recorded so it is not mistaken for a regression.

### Do not use the aux channel for W4

Under `drive.file`, folder sharing does not grant a member's app API access to files another member's instance created (`docs/adr/021-photo-storage.md` § _`drive.file` scope implications_, point 2). The `.beanpod` envelope is the only object every member provably has API access to.

### The profile menu is not the only device-actions surface, and `AppHeader` is not always mounted

`App.vue:2276` renders `<AppHeader v-if="!headerReclaimed" />`. On the mobile/tablet planner route the header is **suppressed**, and `MobileHamburgerMenu` (`App.vue:2294`) carries the device actions instead — it has its own Switch member / Sign out / Sign out & clear trio (`:588-612`) in a completely different dark-drawer visual language.

Consequences, recorded rather than discovered later:

- **W0.1 extracts the `AppHeader` dropdown only.** `MobileHamburgerMenu` is not a duplicate of it in any useful sense; folding them together is a separate piece of work and is out of scope.
- **"Sign in another device" is unreachable on the mobile planner route in Phase 2.** Judged acceptable: it is one nav away, and this is a once-in-a-while action. Recorded as a known gap, not an oversight.
- **If the item is ever added to `MobileHamburgerMenu`, the single `SignInCodeSheet` mount must move from `AppHeader` up to `App.vue`**, beside `ConfirmModal` (`:1980`) and `ReauthGateModal` (`:1981`), with a `useConfirm`-shaped module-level opener. Do not host it in two places. For Phase 2 the `AppHeader` mount is correct and is the simpler of the two.

### Build order, and the one thing that is permanent

Everything below ships together. The grouping is **build order**, not release gating:

| Phase       | Contents          | User-visible?            | Backed out by                                 |
| ----------- | ----------------- | ------------------------ | --------------------------------------------- |
| **Phase 1** | W0 (groundwork)   | No — pure consolidation  | `git revert`; nothing persists                |
| **Phase 2** | W1 + W2 + W3 + W5 | Yes — the funnel change  | `git revert`; nothing persists                |
| **Phase 3** | W4                | Yes — pull-mode approval | Code reverts; **written dict entries do not** |

Phase 1 first because W0.1 (`ProfileMenu`) and W0.3 (`linkMint`) are prerequisites for W3, and W0.4/W0.5 (the QR helpers) are prerequisites for W1 and W4 alike. Building them last would mean writing the duplicate first and removing it after.

**⚠️ W4's `deviceApprovalKeys` is the one change here that cannot be undone by deleting code.** An envelope field is effectively permanent: old writers preserve unknown fields, every reader tolerates it forever, and `ENVELOPE_KEY_DICTS` grows a row the merge, the tests and every future migration must carry. Shipping it ungated is a deliberate decision (greg, 2026-09-18) taken in exchange for delivering both directions on day one. What it obliges:

- The dict shape must be right **first time**, because a second revision means two shapes to support forever. The checklist under W4 is not optional.
- `envelopeMerge.test.ts`'s registry assertion and a direct `newest-wins` assertion are part of the same commit, not a follow-up.
- The success-path telemetry (`device_approval_outcome`) still ships, so the feature's actual usage is measurable even though nothing now depends on that measurement to proceed.

### Complexity budget

This plan is allowed to create **exactly seven source files (four of them only in Phase 3), plus their tests** — the list under _Files Affected_. Anything beyond that list is a signal the design drifted and should come back for review rather than be added silently. The rule that keeps it there: **no new component unless an existing one cannot be configured into the job**, which is what killed `SignInCodePanel.vue` in Pass 2.

## Assumptions

> **Review these before implementation.** Valid as of 2026-09-18.

1. `docs/mockups/scan-to-sign-in-2026-09-18.html` is the approved design (greg, 2026-09-18), as amended by `50dd03a4` (15-minute device link on surface 4) and `b6c06c53` (kit copy). **It is reproduced in full** — both scan directions and the creation-screen checkbox gate. There are no outstanding plan↔mockup divergences.
2. Rungs 2 (family re-admit) and 3 (PIN + email escrow) are deferred; a single-member single-device family consciously falls through to the recovery kit.
3. `usePollWhileVisible` remains the house polling primitive. It already catches, reports and survives a throwing callback (`:66-81`) — **and it swallows the error entirely**, so any "we have failed N times in a row" state must be counted inside the W4 callback, never inferred from the primitive. It also has **no hard stop**: the 3-minute cap is the pane calling the returned `stop()`.
4. The four facade context keys this plan actually uses (`action`, `kind`, `detail`, `error_code`) remain allowlisted in `src/utils/diagnosticContext.ts` (`:68`, `:86`, `:199`, `:69`), so W5 ships without a store-declaration change. (`stage` is allowlisted at `:104` but is **not** used by this feature — listed here only so nobody adds it.)
5. ECDH P-256 via Web Crypto is available on every target (browsers, iOS/Android WebView). P-256 is chosen over X25519 precisely because Web Crypto support for X25519 is still uneven.
6. A module under `src/services/auth/` may read a Pinia store. Precedent: `src/services/auth/stagePendingFile.ts` does exactly this and documents its `syncStore`-only rule. W0.3 follows that shape.
7. `RecoveryOpener` is `'kit' | 'passphrase'` (`useLoginFlow.ts:69`) and stays that way. A device approval is an ordinary family-key arrival, not a recovery — see W4.

## Approach

Five workstreams. **W0 is Phase 1; W1–W3 + W5 are Phase 2; W4 is Phase 3 and is gated.** W0 is small, and every item in it removes code or prevents a duplicate rather than adding a layer.

### W0 — Shared groundwork (Phase 1; do first; it is what keeps the rest DRY)

**W0.1 Extract the profile menu.** `AppHeader.vue` renders the dropdown twice — mobile `:334-517` and desktop `:731-914`. A `diff` of those two ranges returns **one line: a comment** (verified). 184 lines duplicated exactly; adding a menu item today means editing two places.

Extract `src/components/common/ProfileMenu.vue`. **Put the boundary in the right place or the duplication comes straight back:** the menu is rendered twice, so every prop and every listener AppHeader has to wire is wired twice.

- **ProfileMenu owns what a View may own**: its own reads of `familyStore` / `authStore` / `familyContextStore`, the avatar helpers, `isFlagEnabled('beanieWall')`, and the pure-navigation handlers (`edit profile`, `settings`, `help`, `start wall`) via its own `useRouter()`. These are "read reactive state, emit an intent" — exactly the View role under MVO, and none of them is header-specific.
- **Only three things cross the boundary**, because only these are genuinely the header's: `isRefreshing` (prop) + `refresh-all` (emit), because the SW-update + `backgroundSyncFromFile` orchestration lives in `AppHeader.handleRefreshAll` (`:192-238`); `sign-out` and `switch-member` (emits), because AppHeader owns the sign-out modal and its `isSigningOut` progress state; and `close` (emit).
- The result is that each of AppHeader's two call sites is **one short tag**, not fourteen lines of listener wiring repeated twice. If the tag grows past ~5 attributes, the boundary is wrong.
- Collapsing the two instances into one absolutely-positioned menu would be better still, but the two dropdowns live inside different responsive header rows — out of scope here unless it turns out to be trivial.
- **`MobileHamburgerMenu` is out of scope** (see the caveat above).

**W0.2 Promote the panel that already exists — do NOT build a new one.** The original draft proposed a new `SignInCodePanel.vue`. `src/components/settings/MintedLinkPanel.vue` **is** that component: `InviteLinkCard` QR frame + truncated mono link + copy button + copy-failure row + `qrUnavailable` degrade line, with host-supplied `qrAlt`/`hint` (and its own prop comment explaining why those must be host-supplied). Two changes:

- Move it to `src/components/ui/MintedLinkPanel.vue` and update its importers (`MagicLinkCard`, `DeviceLinkCard`, plus the Phase 2 sheet). It is no longer settings-only.
- **Delete `InviteLinkCard`'s dead `link` prop** (`src/components/ui/InviteLinkCard.vue:15`) and the `:link="link"` pass-through at `MintedLinkPanel.vue:42`. Pass 3 proposed making it optional; the survey shows it is **declared required, never referenced anywhere in that component's template, and has exactly one consumer in the whole repo** (`MintedLinkPanel`, plus `InviteLinkCard.test.ts`'s `defaultProps`). A required prop that nothing reads is dead code, and deleting it is strictly simpler than loosening it — it also stops Phase 3's QR-only pane having to pass `link=""` to satisfy nothing. Drop it from the test's `defaultProps` in the same commit, or Vue will render it as a stray DOM attribute on the root element. (`MintedLinkPanel.link` stays required: that component _does_ render it, at `:64`.)

**W0.3 Extract the mint bodies — all four of them.** `DeviceLinkCard.vue:35-64`, `MagicLinkCard.vue:65-104`, `ResumePodSetup.mintOwnerMagicLink:731-793` and `useJoinFlow.mintJoinerMagicLink:1341-1412`. Create `src/services/auth/linkMint.ts` exporting two functions, each returning the existing `{ link } | { errorKey, errorCode }` contract:

```
mintDeviceLink(): Promise<{ link } | { errorKey, errorCode }>
mintMagicLink(opts: { memberId: string; publishTimeoutMs?: number }): Promise<{ link } | { errorKey, errorCode }>
```

- `publishTimeoutMs` exists solely because the join step deliberately uses `syncStore.CREDENTIAL_PUBLISH_TIMEOUT_MS` while the creation and Settings mints deliberately do not — that difference is documented at `useJoinFlow.ts:1362-1364` and must survive the extraction as a parameter, not be flattened away.
- **The service emits NOTHING.** No `logEvent`, no `emitLinkMinted`, no `reportError`. Telemetry stays with the hosts, because `useMintedLink` already owns it for two of them and emitting from both places would double-count the funnel. The three non-`useMintedLink` hosts keep their existing `emitLinkMinted({ detail: 'origin=…' })` + `reportError` exactly as they are today; all that leaves their bodies is the ~40 lines of crypto and URL building.
- **Keep the dynamic `import()`s inside the service** (`@/services/crypto/inviteService`, `@/services/auth/magicLink`), which is how all four sites do it today and is what keeps them out of the login bundle.
- **The reason is MVO, not just reuse.** `MagicLinkCard`'s closure is 40 lines of key wrapping, monotonic stamping and durable publishing sitting inside a `<script setup>`. A View should not hold that. And the two bugs already fixed three times each (`envelope.familyId` not `activeFamilyId`; the store's provider not the invite's) become impossible to fix in only two places.

The two Settings cards and the W3 sheet then all pass the same function to `useMintedLink`. **No new telemetry and no new `try`/`catch` may appear in any of those three hosts** — `useMintedLink` owns both, and `DeviceLinkCard`'s docblock (`:9-14`) already states that if a host regrows either, the extraction has been undone.

**W0.3b Thread `detail` through `useMintedLink`.** `useMintedLink` currently emits `emitLinkMinted({ kind, ok })` with no `detail` at three points (`:52`, `:56`, `:80`), and has no option to supply one — so W3's "which entry point did this mint come from" cannot ride the existing emitter without this. Add an optional `detail?: string` to the composable's options and spread it into all three emits. Then:

- `DeviceLinkCard` → `detail: 'origin=settings'`
- `MagicLinkCard` → `detail: 'origin=settings'`
- W3's `SignInCodeSheet` → `detail: 'origin=profile-menu'`

`origin=` matches the convention the other two mint sites already use (`origin=creation`, `origin=join`), so every `link_minted` event in the product gains a consistent, queryable origin for free — and the two Settings cards, which have never had one, get one.

**W0.4 One QR-render path, with the degrade logged.** Add `renderQr(source, { surface, kind }): Promise<{ dataUrl: string } | { unavailable: true }>` beside `generateInviteQR` in `src/utils/qrCode.ts`, containing exactly the warn-log `useMintedLink:59-73` already performs. Then:

- `useMintedLink` calls it instead of inlining the `catch` (behaviour identical, one fewer copy).
- `RecoveryKitDisplay`'s watch (`:70-98`) calls it, replacing the silent `catch { kitQr.value = '' }` at `:91-93` and gaining a visible "the picture didn't render — the code below still works" line, matching `MintedLinkPanel`'s existing `qrUnavailable` treatment (`:52-59`).
- W1's new magic-link QR and Phase 3's public-key QR use it, so there is exactly one QR failure path in the product.

**W0.5 One "family key in hand → open the pod" tail — and keep the UI out of the store.** `LoadPodView.handleKitRedeem:886-913` is: decrypt the pending file → classify a payload failure → emit → `finishLoaded(opener)`. The current one has an untelemetered hole at `:887-902` (the `!dec.success` branch returns with no event).

Extract it once, per MVO, as a `syncStore` orchestrator action:

```
openPodWithFamilyKey(familyKey): Promise<
  | { ok: true }
  | { ok: false; reason: 'no-pending' | 'payload' | 'decrypt'; payloadError?: RemoteBlocker }
>
```

**The action takes the family key and nothing else.** The first draft passed `opener: RecoveryOpener` through to the store; it must not. `opener` is consumed only by the _view's_ `finishLoaded` (`LoadPodView.vue:459-462`), which also calls `ensureDurableHome()` and emits a component event — both view concerns. Threading a login-UI enum into a store action that never reads it is exactly the coupling that makes stores hard to change later. The store closes the telemetry hole (it emits on every branch, success included); the view keeps the `reason` → `uiStrings` mapping and its own `finishLoaded(opener)` call.

This closes the hole for both callers at once and means Phase 3 adds **no** new decrypt code.

**W0.6 One deep-link marker registry — moved forward from Phase 3 to Phase 1.** `recoveryKit.parseKitInput` (`:123-130`) and `LoginPage.vue:369-378` each hand-roll a hash-marker extraction, and LoginPage's is a literal regex (`/beanies-kit=([^&]+)/`) that has already drifted free of the exported `KIT_LINK_HASH` constant three lines away in another file. Lift both into **`src/services/auth/deepLinks.ts`**, which holds every marker constant and two functions:

- `readHashMarker(text, marker)` — for parsing a scanned payload that may or may not be a link.
- `consumeHashMarker(marker)` — reads from `window.location.hash` **and strips the fragment in the same call**. LoginPage's existing `history.replaceState` hygiene (`:373`) becomes part of the helper, so the second caller cannot forget it. That is the whole reason this is one function rather than two.

**Why this sits in Phase 1:** Phase 2 makes kit scanning a _primary_ path and `parseKitInput` is on it, so the consolidation earns its place even before W4 needs it. It is a ~20-line pure consolidation with no user-visible effect — exactly the shape of the rest of W0 — and it reduces W4 to one added constant and one added branch.

**Not `src/utils/url.ts`.** That module is external/user-content URL safety — `safeExternalHref`, `getUrlDomain`, `getFaviconUrl`, `isSameRegistrableDomain`. Our own deep-link scheme has nothing to do with it, and putting them together couples two things that will never change for the same reason.

**W0.7 `useFilePicker.open()` must not silently no-op.** `open()` is `inputRef.value?.click()` (`useFilePicker.ts:73-75`) — if the hidden input never mounted, the user taps a button and nothing at all happens. `AiDocumentPicker` already wraps it in a local guard for exactly this (`:54-65`, _"the one new silent-failure surface"_), and W2b would be the second copy. Per the DRY rule (same pattern in 2+ places → extract), push it into the composable: **`open()` returns `boolean`** — `false`, plus a `reportError`, when the ref is null. `AiDocumentPicker.openPicker` collapses to `if (!picker.open()) showToast(...)`; W2b's two pickers use the same shape. Signature widening only; **no behaviour change at the existing call site.**

### W1 — The creation screen leads with the code (Phase 2)

`RecoveryKitDisplay.vue` today renders, in order: warning (`:172-174`) → kit QR (`:186`) → kit code (`:190-225`) → magic-link section behind an `<hr>` (`:228-287`). The kit is scannable; the way in is not.

- Give the magic link a QR via the shared `renderQr` from W0.4, in the same watch that already builds `kitQr` (`:70-98`) — one watch, two sources, one failure path. Guard it on `props.magicLink` so the three kit-only hosts never render or compute one.
- **Reorder, inside the existing `v-if="magicLink || magicLinkErrorKey"` bracket only.** When `magicLink` is absent the component renders exactly as it does today, divider included — see the four-hosts caveat. This is the single highest-regression-risk edit in Phase 2.
- Sharpen the kit copy per the approved mockup: **"Print it out and/or save it somewhere safe"** and the confirm reading **"I've saved my recovery kit somewhere safe"**.
- **Keep `data-export-hide` discipline**: the new QR belongs _inside_ `kitCardEl` so the exported PDF carries both artefacts (the documented intent at `:31-42`, `:227-230`), but the copy button keeps `data-export-hide` (`:265`). The new QR is decorative (`alt=""`), matching the kit QR at `:186`, because the link text it encodes is rendered directly beneath it.
- The confirm button remains the gate, now released by save **or** print **or** the unconditional tick (see _Decisions already taken_ §3). Its label already switches on `magicLink` (`:319`).
- No change to `mintOwnerMagicLink`'s best-effort contract (`ResumePodSetup.vue:718-730`) or to the `magicLinkErrorKey` degrade (`:284-286`). W0.3 changes its body, never its contract.
- _Optional, only if it stays trivial:_ `handleCopyKitCode` (`:100-115`) hand-rolls `navigator.clipboard.writeText` + a `kitCopied` ref + a `reportError`, in a component that already holds a `useClipboard` instance for the magic link (`:57-61`). Swapping it to a second `useClipboard` instance removes ~16 lines. **Skip it if it perturbs the copy button's `data-export-hide` or icon-swap behaviour at all** — it is a tidy, not a requirement, and this file is the one that must not wedge.

### W2 — Every cold surface leads with the way back in (Phase 2)

Two halves, landed as two commits so a layout regression and a decode regression can be bisected apart.

**W2a — layout, ordering and copy only. Zero logic changes; every diff is markup order, copy, or a component swap. No QR, no camera, no scanner** (see the Phase 2-shape caveat).

- **`WelcomeGate.vue`** — add the affordance it entirely lacks, as a fourth `LoginChoiceCard` (`:108`, `:205`, `:238` are the existing three), so it inherits the surface's card grammar rather than introducing a fifth shape. It heads the returning-user group — **below the Create hero, above the Sign In / Join pair** — and `PasteLinkPanel` (`:276`) moves up beside it.
- **`LoadPodView.vue` state A** — `PasteLinkPanel` is currently the very last thing on the page (`:2086`), below the storage cards, and the file's own comment at `:2078-2084` admits the failure. Move the scan/paste path above the storage cards.
- **`LoadPodView.vue` state B** — the kit becomes a quiet bottom link beneath the scan path, reusing the existing shared `RecoveryKitLink.vue` (the same chip the prove screen uses) rather than styling a second one.
- **`ProveView.vue` — presentation only, and gated on `!podOpen`.** Add the affordance above the credential pane. **It must be `v-if="!podOpen"`** (the prop exists at `:34`): on a warm pod — someone switching member at home — "get in from another device" is nonsense, because the beanpod is already open and all that is wanted is a PIN. **No `proveMethods.ts` change**: `'recovery'` is already `NON_SWITCHABLE` (`:214-219`), the kit already renders as the bottom `RecoveryKitLink` chip (`:525-531`), and the `recovery` terminal is appended outside the probe loop (`proveMethods.ts:254-256`) so array order could not move it. Because `PROBES` is untouched, `switchTo`'s `fell-back` emit (`ProveView.vue:196-206`, keyed on `offered.value.indexOf(method) > 0`) keeps its current meaning and W5 has **no funnel discontinuity to account for**.
- The affordance is **copy plus, where a route exists, a tap that opens `PasteLinkPanel`**. On `ProveView`, which has no paste panel and whose parent owns navigation, it is copy only — a `<p>`, not a new emit and not a new branch in `useLoginFlow`. Anything more is Phase 3.

**W2b — kit entry: scan/upload primary, typing last, and stop the silent failures.**

- The current control is a raw `<label><input type="file">` at `LoadPodView.vue:1524-1548`; **there is no `useFilePicker` call site in `LoadPodView.vue` today.** Replace it with the house pattern — a `useFilePicker` pair, gallery + `capture: 'environment'` camera, exactly as `src/components/media/PhotoAttachments.vue:105-112` / `:117-125` and `src/components/ai/AiDocumentPicker.vue:47-53` do it, with the camera tile shown on touch-primary devices via the existing `useIsTouchPrimary`. Both pickers use W0.7's boolean `open()`. This is what makes "a phone offers its camera directly" true, and Android already carries the `<queries>` entry that makes `capture` work without declaring `android.permission.CAMERA` (`android/app/src/main/AndroidManifest.xml:151-163`).
- Change `decodeQrFromImageFile` (`qrDecode.ts:50-57`) to return `{ ok: true; data: string } | { ok: false; reason: 'no-code' | 'unreadable' | 'decoder-unavailable' }` and report the two failure reasons through `reportError` with the cause attached. **Both bare `null`s must be reclassified, not just the outer one**: the `catch` at `:54-56` splits into `unreadable` (bitmap/PDF bytes refused) vs `decoder-unavailable` (a `jsqr`/`pdfjs` chunk that would not load), and the `if (!ctx) return null` at `:26` is `decoder-unavailable`, never `no-code`. "No QR in this photo" and "the decoder failed to load" need different messages and different fixes; today all three are the same `null`. **The reason union is the only thing the caller branches on** — no error objects cross that boundary, so the view never grows a second classifier.
- **Add the missing `catch`** to `handleKitPhotoPicked` (`:119-137`). It already has `try`/`finally`; what it lacks is a `catch`, so a chunk-load failure on either dynamic `import()` rejects unhandled while the `finally` resets the spinner. The new `catch` sets `formError` and reports.
- **Add a `reportError` + `emitKitRedeemed({ ok: false, errorCode: 'redeem-threw' })` to `handleKitRedeem`'s outer `catch` (`:912-915`)**, which is `console.error` only today and therefore invisible in CloudWatch.
- The credential field stays conditional on `envelopeCapabilities()` (`src/services/sync/fileSync.ts:245`) — a kit-born family must never be offered a password it does not have, and the "use password instead" escape is already gated at `LoadPodView.vue:1561-1568`.

### W3 — Minting is first-class and PIN-gated (Phase 2)

- Add "Sign in another device" to `ProfileMenu.vue` (from W0.1), positioned with the beanie wall and Switch member. The rationale is already written at `AppHeader.vue:163-175`: these are actions that _"change what THIS DEVICE is doing, not what the family's data says."_ A sign-in code is exactly that class.
- **ProfileMenu emits the intent; it does not host the sheet.** ProfileMenu is rendered twice (mobile + desktop), so a sheet mounted inside it would be two modal instances with two independent mint states — a live re-entrancy bug, not a style nit. The menu emits `sign-in-another-device`; **`AppHeader` hosts exactly one `SignInCodeSheet`**, the same way it already hosts exactly one sign-out modal. (If the item is ever added to `MobileHamburgerMenu`, that mount moves to `App.vue` — see the caveat.)
- The sheet lives at **`src/components/auth/SignInCodeSheet.vue`**, beside `RecoveryKitDisplay.vue` — `components/login/` is the login _page's_ surfaces, and this one is opened from the app header while signed in.
- It is a `BaseModal` (three-tier system: not a form, not a confirm) rendering `MintedLinkPanel` with `mintDeviceLink` from W0.3, driven by `useMintedLink({ kind: 'device', surface: 'login-flow', detail: 'origin=profile-menu' })`. **The sheet contains no `try`/`catch`, no `logEvent`, and no crypto** — same contract as `DeviceLinkCard`, for the same reason.
- **Gate it with the existing `requireReauth()`** (`src/composables/useReauth.ts:63-95`), not a new PIN prompt. It fails closed, never hangs, and reports every non-verified path (`:67-90`, `:99-115`). Call it **before** opening the sheet, so a declined gate never renders a mint surface.
  - ⚠️ **This widens a documented scope.** `useReauth`'s header (`:13-15`) says it is _"wired to four once-a-year actions only… If a routine action ever starts asking for a PIN, that is a defect, not a hardening."_ Minting a full-family-key transport is a once-a-year, high-consequence action, so it satisfies the stated _principle_ — but the list becomes five and **the docblock must be updated with the reasoning** so the next reader does not read it as drift.
  - When `canStepUp()` (`:52-55`) is false (a member with no PIN or password — a tap-through child), the menu item is hidden rather than dead-ending, mirroring exactly how `canStartWall` handles the same case (`AppHeader.vue:176-181`).
- Copy states the 15-minute window (`deviceLink.expiryNote` already exists at `uiStrings.ts:5005`) and, unlike the magic link, needs **no** revocation warning — a device-link mint writes a fresh `inviteKeys` entry and revokes nothing.
- **No new mint telemetry.** `useMintedLink` already emits `link_minted` with `kind: 'device'` (`loginFlowEvents.ts:130-147`), and that facade's own docblock (`:121-129`) warns that a second emitter for one funnel is the drift it exists to stop. The gate's own outcome is already measured by `reauth_outcome` on the `reauth-gate` surface. The only new field is the `detail` W0.3b threads through — which also means **updating `emitLinkMinted`'s `detail` doc comment (`:132`), which currently reads "Magic links only"** and would otherwise be false the moment this ships.

### W4 — Pull-mode approval (Phase 3, behind the `deviceApproval` flag, gated on Phase 2 data)

The only genuinely new mechanism. It exists for one case W3 cannot serve: the **cold device is the laptop**, so it cannot mint, and the phone is the thing with a camera. It is also what makes the approved mockup's surfaces 1 and 2 real.

**Crypto — one pure module, no Vue and no store.** `src/services/crypto/deviceApproval.ts` **imports rather than reimplements**: `bufferToBase64url` / `base64urlToBuffer` (`@/utils/encoding:116`, `:121`) and `sha256` (`:144`), and `wrapFamilyKey` / `unwrapFamilyKey` from `@/services/crypto/familyKeyService` (`:78-98`). It exports four functions and one config object, and it touches no reactive state — which is what makes it unit-testable without a Pinia harness:

- `createApprovalKeypair()` → `crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey'])`. The **private key never leaves memory and is non-extractable.**
- `buildApprovalLink(publicKey)` → the deep link + the short fingerprint.
- `sealApproval(familyKey, requesterSpki)` → `DeviceApprovalPackage`.
- `openApproval(pkg, privateKey)` → `CryptoKey`, refusing with a named reason on fingerprint mismatch, expiry, or unwrap failure.
- `DEVICE_APPROVAL = { pollIntervalMs, timeoutMs, staleAfterFailures }` — **one object, one place to tune**, exported so the pane and its tests read the same numbers.

KEK derivation: ECDH `deriveKey` → an HKDF key, then HKDF (random per-package salt + a fixed `info` string for domain separation) → an **AES-KW** wrapping key, then `wrapFamilyKey` unchanged. It ends at the same AES-KW shape `deriveInviteKey` produces (`inviteService.ts:49-73`) so the wrap/unwrap helpers are reused verbatim — but note the _derivation_ is genuinely different (that one is PBKDF2 over a token), so it is a shared destination, not a copied recipe. Note `wrapFamilyKey` returns **base64**, not base64url; the package's `wrapped` field types accordingly.

**Deep links.** The QR encodes `${shareableOrigin()}/welcome#beanies-approve=<base64url(spki)>` — `shareableOrigin()` (`src/utils/shareableOrigin.ts:24`), never `location.origin`, for the documented Capacitor reason (`recoveryKit.ts:106-115`). The marker constant goes in `deepLinks.ts`, already built in W0.6; `LoginPage`'s handler gains one sibling branch beside the `beanies-kit=` one. Two branches is fine; **if a third marker ever appears, that is the moment to table-drive it**, not now.

**Cold device → key → open the pod, with no second orchestration site.**

- `ColdDeviceCodePane.vue` is a **view**: QR + fingerprint + waiting/expired/stale states. It runs the poll (inside a component, so `usePollWhileVisible`'s scope disposal does the teardown) and emits `approved(familyKey)` / `expired` upward.
- Its host — `LoadPodView` — runs `openPodWithFamilyKey` from W0.5 and then its own **`finishLoaded()` with NO opener**. `finishLoaded` takes `RecoveryOpener | null` and `RecoveryOpener` is `'kit' | 'passphrase'` (`useLoginFlow.ts:69`); a device approval is neither. Passing an invented `'device-approval'` would mean widening that union and feeding a value into `ProveView`'s `recoveryOpenedBy`, whose two arms drive the kit landing, the `reset-pin` unshift and the kit-chip suppression. **A device approval is an ordinary family-key arrival — the member still proves with their PIN and nothing about the prove screen changes.**
- **The pane never calls the store's open path itself**, or there would be two places that know how to finish a sign-in.
- `DeviceApprovalSheet.vue` is the approver's view: fingerprint, one approve button, one refuse. It calls `sealApproval` then the store's publish action. No crypto inline, no polling.

**No in-app camera.** The user scans with the phone's native camera app, which opens the deep link. This avoids `android.permission.CAMERA` (deliberately undeclared — `AndroidManifest.xml:155-158`) and any `getUserMedia` code, of which the repo currently has none.

**Channel: a new envelope dict, not a reuse of `memberLinkKeys`.** Reusing `memberLinkKeys` looks attractive because it is the one revocable dict, but it is keyed by `memberId` under `newest-wins` — so writing an approval there would **silently revoke that member's magic link**, which is precisely the credential this issue is promoting. They must be separate.

New dict `deviceApprovalKeys`:

- `DeviceApprovalPackage { salt: string; wrapped: string; createdAt: ISODateString; expiresAt: ISODateString; publicKeyHash: string }` — carries `wrapped: string`, so `EnvelopeKeyDictField` (`envelopeMerge.ts:73-81`) selects it and every registry guard stays engaged.
- **Keyed by the approver's `memberId`**, `rule: 'newest-wins'`, `required: false`. memberId keying bounds growth at one entry per member (the dict cannot express a deletion) and gives newest-wins arbitration; one pending approval per approver is the correct constraint anyway. The cold device does not know who it is yet, so it matches on `publicKeyHash`, not on the key.
- `publicKeyHash` lets the cold device confirm the entry is for _its_ keypair and not a stale one from an earlier attempt, and lets it refuse a mismatch loudly rather than attempting an unwrap that would fail opaquely.
- Additive optional on `'4.0'` — **never a version bump** (the pattern and its reasoning are spelled out on `recoveryKeys`/`memberLinkKeys`, `syncFileV4.ts:127-140`).
- Written with **`putEnvelopeEntry`** (`syncStore.ts:478-531`) — explicit, awaited, returns whether it landed — because `keyDictSize` cannot see an overwrite. `rollbackOnFailure: true` (the default) here: this is an addition, not a revocation, and the documented tombstone exception (`:483-493`) does not apply. If it returns false the approver sees "we couldn't send the approval — check your connection and try again", never a success tick.
- `createdAt` stamped monotonically via the `memberLinkCreatedAt` pattern (`syncStore.ts:6061-6073`), reading `authoritativeEnvelope()` rather than `envelope.value`, for the reason stated there.
- `envelopeMerge.test.ts:252-260` asserts the exact sorted registry key list and **will fail** — updating it is part of the change, plus a direct `newest-wins` rule assertion mirroring `:262-267`.

**The cold device never writes.** It displays, then polls. This is deliberate and load-bearing: the normal save path serialises the envelope from the **decrypted in-memory Automerge doc** (`createBeanpodV4`, `fileSync.ts`), which a key-less device cannot do without preserving `encryptedPayload` verbatim — and no current code path does that. Read-only avoids the hazard entirely.

**Polling — and the three traps.**

1. **`usePollWhileVisible` is the right primitive, but the callback must be `syncStore.loadFromFile()`, not `stagePendingFile()`.** `stagePendingFile` returns `{ ok: true }` on its second statement whenever `hasPendingEncryptedFile` is true (`:83`) — the cold device's permanent state — so a poll through it would never re-read the file, would never see the approval, and would look exactly like a working screen for three minutes.
2. **`loadFromFile()` THROWS** the latched remote blocker (`syncStore.ts:1773`, _"THROW, never a bare `{success:false}`"_). The pane's callback must wrap it in its own `try`/`catch`: `usePollWhileVisible` catches and **swallows** (`:66-81`), so an uncaught throw is both invisible to the pane and unable to advance the stale counter. **On a latched `RemoteBlocker` specifically, stop the loop** and show the blocker's own message — retrying re-downloads megabytes to fail identically, which is the exact behaviour that latch exists to prevent.
3. **`usePollWhileVisible` has no cap.** The 3-minute stop is the pane calling the returned `stop()` from its own tick counter or timer. The primitive will otherwise poll forever.

- Cadence **5s** and a hard stop at **3 minutes**, both from `DEVICE_APPROVAL` so there is one place to change them. Each tick re-downloads the whole `.beanpod`, payload included, so the interval is a bandwidth decision and not only a responsiveness one — ~36 full fetches is the worst case, and that number is the reason the cap is short. Visibility-gating means a backgrounded tab costs nothing. (A cheap `modifiedTime` pre-check exists for Drive — `driveService.ts:269-274` — but not for the local provider, so adding it would mean a provider-conditional poll path. Not worth the branch at this cadence; recorded so the option is on the record.)
- After the cap the pane offers a fresh code rather than spinning forever, and emits the `expired` outcome so "walked away" is distinguishable from "write failed".
- A tick that fails to fetch (offline, auth lapsed) does not kill the loop but **does** surface a quiet "still waiting — we can't reach your family file right now" line after `staleAfterFailures` (2) consecutive failures. **That counter lives in the pane's callback**, for the reason in trap 2.

**Security properties worth stating:** the QR carries a public key, so photographing it yields nothing; all authority is the approval tap on the trusted device, with a human-compared fingerprint; the private key is non-extractable and memory-only, so a stale envelope entry is useless to anyone else.

### W5 — Instrumentation, in the same change (Phase 2; the two W4 events ship with Phase 3)

- **Move `kit_redeemed` onto the typed facade.** It is raw `logEvent` at three sites in `LoadPodView.handleKitRedeem` (`:867-872`, `:877-883`, `:901-906`), and there are **two untelemetered branches**: the `!dec.success` path at `:887-902` returns with no event, and the outer `catch` at `:912-915` is `console.error` only. Add `emitKitRedeemed({ ok, errorCode? })` to `loginFlowEvents.ts`; the decrypt hole is closed by W0.5's shared store action (so the kit path and, later, the approval path are covered by one call) and the throw hole is closed by W2b's addition to the outer catch.
- **Add the missing denominator.** There is no abandonment or entry event on `login-flow`. Add `emitColdUnlockStarted({ surface })` and `emitColdUnlockAbandoned({ lastSurface })`.
  - ⚠️ Scope this to the **cold-unlock funnel only**. `loginFlowEvents.ts:168-177` explicitly warns off adding join-funnel events here, because `joinStepEvents.ts` already owns that funnel on the `join-flow` surface and a CloudWatch sweep once wrongly concluded it was uninstrumented.
- **Scan-path events, which are the whole point of the feature and currently invisible**: `emitKitScanOutcome({ ok, reason? })` for the decode path opened up in W2b (`no-code` / `unreadable` / `decoder-unavailable` are three different bugs), and the existing `qr_render_failed` warn from W0.4's `renderQr`, which now fires from every QR site instead of one.
- **W4 events (Phase 3 only)**: `emitDeviceApprovalRequested()` and `emitDeviceApprovalOutcome({ ok, errorCode? })`, emitted on the **success path too** so rates are measurable rather than just failures.
- **No new mint emitter for W3** — reuse `emitLinkMinted` with `kind: 'device'`, `detail: 'origin=profile-menu'`, and correct that parameter's doc comment. A second emitter for one funnel is exactly what that facade's docblock forbids.
- **No new context keys.** Every field above rides `action`, `kind`, `detail`, `error_code` — already allowlisted — so no `diagnosticContext.ts` change, no Lambda mirror update, and **no store data-collection declaration change**. This is a deliberate design constraint, not a coincidence.

## Files Affected

**Created — seven source files and no more (see Complexity budget), plus a test per file**

- `src/components/common/ProfileMenu.vue` (W0.1, Phase 1)
- `src/services/auth/linkMint.ts` (W0.3, Phase 1 — `mintDeviceLink` / `mintMagicLink`, lifted out of four hosts)
- `src/services/auth/deepLinks.ts` (W0.6, **Phase 1** — marker constants + `readHashMarker` / `consumeHashMarker`)
- `src/components/auth/SignInCodeSheet.vue` (W3, Phase 2 — a `BaseModal` host around `MintedLinkPanel`, mounted once in `AppHeader`)
- `src/services/crypto/deviceApproval.ts` (Phase 3 — pure; no Vue, no store)
- `src/components/login/DeviceApprovalSheet.vue` (Phase 3, the approver's sheet)
- `src/components/login/ColdDeviceCodePane.vue` (Phase 3, the cold device's QR + fingerprint + waiting state)

**Moved**

- `src/components/settings/MintedLinkPanel.vue` → `src/components/ui/MintedLinkPanel.vue` (W0.2, Phase 1)

**Modified**

- `src/components/common/AppHeader.vue` — both dropdown blocks (`:334-517`, `:731-914`) replaced by one `ProfileMenu` tag each; hosts the single `SignInCodeSheet` (Phase 1/Phase 2).
- `src/components/ui/InviteLinkCard.vue` — the dead `link` prop (`:15`) **deleted** (W0.2, Phase 1).
- `src/components/ui/__tests__/InviteLinkCard.test.ts` — `link` dropped from `defaultProps` (W0.2, Phase 1).
- `src/utils/qrCode.ts` — `renderQr` with the logged degrade (W0.4, Phase 1).
- `src/composables/useMintedLink.ts` — call `renderQr` instead of inlining the catch (W0.4); **gain an optional `detail` option threaded into all three `emitLinkMinted` calls** (W0.3b) (Phase 1).
- `src/composables/useFilePicker.ts` — `open()` returns `boolean` and reports a null input ref (W0.7, Phase 1).
- `src/components/ai/AiDocumentPicker.vue` — `openPicker` collapses onto the composable's guard (W0.7, Phase 1).
- `src/components/settings/MagicLinkCard.vue`, `src/components/settings/DeviceLinkCard.vue` — import the extracted mints and the moved panel; pass `detail: 'origin=settings'` (W0.2/W0.3/W0.3b, Phase 1).
- `src/components/login/ResumePodSetup.vue` — `mintOwnerMagicLink` (`:731-793`) delegates to `mintMagicLink`; telemetry and best-effort contract unchanged (W0.3, Phase 1).
- `src/composables/useJoinFlow.ts` — `mintJoinerMagicLink` (`:1341-1412`) delegates to `mintMagicLink({ publishTimeoutMs })`; telemetry and return shape unchanged (W0.3, Phase 1).
- `src/services/auth/recoveryKit.ts` — `parseKitInput` routed through `readHashMarker` (W0.6, **Phase 1**).
- `src/pages/LoginPage.vue` — the hand-rolled regex at `:369-378` replaced by `consumeHashMarker` (W0.6, Phase 1); plus a `beanies-approve=` sibling branch (Phase 3).
- `src/stores/syncStore.ts` — `openPodWithFamilyKey(familyKey)` (W0.5, Phase 1); approval publish/read helpers (Phase 3).
- `src/components/auth/RecoveryKitDisplay.vue` — logged QR degrade (W0.4, Phase 1); magic-link QR, conditional reorder, copy (W1, Phase 2).
- `src/components/login/WelcomeGate.vue` — fourth `LoginChoiceCard` + `PasteLinkPanel` promoted (W2a, Phase 2).
- `src/components/login/LoadPodView.vue` — scan path above the storage cards; `RecoveryKitLink` as the state-B fallback (W2a); raw file input at `:1524-1548` replaced by a `useFilePicker` gallery+camera pair, `handleKitPhotoPicked` (`:119-137`) gains its missing `catch`, and the outer redeem `catch` (`:912-915`) gains telemetry (W2b); kit-redeem tail delegated to `openPodWithFamilyKey` (W0.5); hosts `ColdDeviceCodePane` (Phase 3).
- `src/components/login/ProveView.vue` — scan affordance above the credential pane, `v-if="!podOpen"` (presentation only; **no `proveMethods.ts` change**) (W2a, Phase 2).
- `src/utils/qrDecode.ts` — discriminated result instead of `null` at **both** return sites (`:26`, `:54-56`), with reporting (W2b, Phase 2).
- `src/composables/useReauth.ts` — docblock scope update, four → five (W3, Phase 2).
- `src/types/syncFileV4.ts` — `DeviceApprovalPackage` + `deviceApprovalKeys` (Phase 3).
- `src/services/sync/envelopeMerge.ts` — one registry line (Phase 3).
- `src/services/telemetry/loginFlowEvents.ts` — new emitters; **`emitLinkMinted`'s `detail` doc comment at `:132` corrected** — it says "Magic links only" and both kinds now carry `origin=` (W5).
- `src/services/translation/uiStrings.ts` — all new strings, `en` + `beanie`.
- `src/services/translation/uiStrings.test.ts` — add **only the new** prefixes to `IMPORTANT_PREFIXES`. ⚠️ `magicLink.` (`:129`) and `deviceLink.` (`:132`) are **already there**; adding them again is a no-op that reads as a real change.
- `src/services/sync/__tests__/envelopeMerge.test.ts` — registry key list (`:252-260`) + newest-wins assertion mirroring (`:262-267`) (Phase 3).
- `docs/mockups/scan-to-sign-in-2026-09-18.html` (already committed, `50dd03a4`).

## Help Center Coverage

This introduces a distinct new way to accomplish an existing task, and it changes what an existing article implies about the recovery kit being the route onto a second device.

- **Action**: `new article`
  - **Category**: `getting-started`
  - **Article type**: `how-to`
  - **Slug**: `sign-in-on-another-device`
  - **Title**: Sign in on another device
  - **Scope**: How to get beanies onto a phone, tablet, or laptop by scanning a code from a device you are already signed in to, and what to do when there is no second device.
  - **Notes**: Must state that a sign-in code opens the whole family's beanpod. Must distinguish the two codes correctly: the **profile-menu code lasts 15 minutes, is for both devices in hand, and does not cancel anything**; the **saved magic link in Settings lasts 7 days and making a new one stops the old one working**. Getting these the wrong way round is the single most likely error in this article. Document **both** directions, since both ship together: the laptop mints and the phone scans, and the laptop shows a code the phone approves.
- **Action**: `update existing`
  - **Category**: `security`
  - **Slug**: the existing recovery-kit article
  - **Scope**: Reframe the kit as the last resort rather than the route to a second device, and state that redeeming it does not change your PIN.
  - **Notes**: Must NOT claim any "reset by email" capability — rung 3 is deferred and `src/content/help/security.ts:600` ("there is no 'reset by email'") stays true as written.

## Observability Coverage

**Events added or changed** (all on `surface: 'login-flow'`, all through `loginFlowEvents.ts`):

| Event                                                       | Release         | Level       | Context                                                                                                                                |
| ----------------------------------------------------------- | --------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `kit_redeemed` (moved to facade)                            | Phase 2         | info / warn | `action: 'ok' \| 'accepted-pod-open' \| 'failed'`, `error_code?` (incl. `redeem-threw`)                                                |
| `kit_scan_outcome` (new)                                    | Phase 2         | info / warn | `action: 'ok' \| 'failed'`, `error_code: 'no-code' \| 'unreadable' \| 'decoder-unavailable'`                                           |
| `qr_render_failed` (existing, now fires from every QR site) | Phase 1         | warn        | `action: 'qr_render_failed'`, `kind: <qr source>`                                                                                      |
| `cold_unlock_started` (new)                                 | Phase 2         | info        | `action: 'started'`, `kind: <surface>`                                                                                                 |
| `cold_unlock_abandoned` (new)                               | Phase 2         | warn        | `action: 'abandoned'`, `kind: <last surface>`                                                                                          |
| `link_minted` (existing, **not** duplicated)                | Phase 1/Phase 2 | info / warn | `kind: 'device' \| 'magic'`, `detail: 'origin=profile-menu' \| 'origin=settings' \| 'origin=creation' \| 'origin=join'`, `error_code?` |
| `device_approval_requested` (new)                           | Phase 3         | info        | `action: 'requested'`                                                                                                                  |
| `device_approval_outcome` (new)                             | Phase 3         | info / warn | `action: 'ok' \| 'rejected' \| 'expired' \| 'failed'`, `error_code?`                                                                   |

**Failure modes and the event that diagnoses each blind:**

- Mint published but never landed → `envelope_entry_publish_unconfirmed` from `putEnvelopeEntry` (`syncStore.ts:511-522`) plus `link_minted` with `ok: false`.
- PIN gate declined vs never reached → `reauth_outcome` on the `reauth-gate` surface, which already emits on the success path (`useReauth.ts:33-41`), vs absence of `link_minted`.
- Which entry point a mint came from → `link_minted.detail`, which W0.3b gives to all four mint sites for the first time (Settings has never had one).
- Approval never arrives → `device_approval_outcome` `expired`, separating "user walked away" from "write failed".
- Approval polling silently stuck → the `staleAfterFailures` notice (counted in the pane's own callback, which must catch `loadFromFile`'s throw) plus `usePollWhileVisible`'s own `reportError` (`:72-80`).
- Kit decrypt failure → closed by W0.5's shared store action, which telemeters the branch `LoadPodView.vue:887-902` currently returns from silently.
- Kit redeem threw → the outer `catch` at `LoadPodView.vue:912-915`, `console.error`-only today, now reports and emits.
- Kit photo unreadable vs decoder broken → `kit_scan_outcome`'s `error_code`, which today is one undifferentiated `null` from **two** sites (`qrDecode.ts:26` and `:54-56`).
- File picker opened but never mounted → `useFilePicker.open()`'s new `false` + `reportError` (W0.7).
- QR failed to draw on any surface → `qr_render_failed` with `kind`, which today fires from `useMintedLink` only and never from `RecoveryKitDisplay`.
- Scan path offered but unused → `cold_unlock_started` minus downstream success gives the abandonment rate the headline metric has never had.

**Success-path signal:** every outcome event fires on success too, so rates are measurable. `cold_unlock_started` is the denominator the 27% figure currently lacks.

**This is how the whole change is judged after the fact.** `cold_unlock_started` / `cold_unlock_abandoned` (**segmented by `kind: <surface>`, which separates the cold-phone case from the cold-laptop case**) plus `link_minted{detail=origin=profile-menu}` and `device_approval_outcome` give the 27% kit-redemption headline the denominator it has never had. Without these, "the kit stopped being the front door" is unprovable either way.

**Funnel continuity:** because `PROBES` is **not** reordered, `fell-back`'s meaning (`ProveView.vue:196-206`) is unchanged and there is no before/after discontinuity to correct for in this dataset. `link_minted` gains a `detail` value rather than a new name, so existing queries keep working.

**Critical vs telemetry:** none of these warrant `severity: 'critical'`. A failed mint is recoverable by retrying; a declined approval is a user choice. The existing `critical` on a failed magic-link publish (`ResumePodSetup.vue:759`, `useJoinFlow.ts:1376`) is unchanged by the W0.3 extraction.

**Privacy/store gate:** **no new context keys.** All fields ride `action`, `kind`, `detail`, `error_code`, already in `ALLOWED_CONTEXT_KEYS` (`src/utils/diagnosticContext.ts` — `action` `:68`, `error_code` `:69`, `kind` `:86`, `detail` `:199`). No `diagnosticContext.ts` change, no `infrastructure/lambda/telemetry/index.mjs` mirror update, no store data-collection declaration change.

## Acceptance Criteria

- [ ] A laptop-created pod, then app install: in by scanning, never sees the kit.
- [ ] A phone-created pod, then laptop site: in by scanning the laptop's code with the phone; nothing typed or pasted.
- [ ] On `WelcomeGate`, `LoadPodView` (both states) and `ProveView`, the way back in from a signed-in device is top-line among the re-entry routes and the kit is a fallback. **On `WelcomeGate` the Create hero is still the first thing on the page.**
- [ ] **No `getUserMedia`, no viewfinder and no in-app scanner exists anywhere in the diff.**
- [ ] Kit entry: scan/upload primary, typing secondary, camera offered directly on touch-primary devices via `useFilePicker`'s `capture`.
- [ ] **The creation screen's Continue is released by save OR print OR tick, and the checkbox is unconditional** — not disabled, not hidden, and not dependent on any PDF outcome. A unit test asserts the checkbox alone releases Continue when the PDF export has failed.
- [ ] Creation screen leads with the sign-in code and its QR **when and only when `magicLink` is supplied**; `RecoverySettings`, `RecoveryKitPromptModal` and the dev harness render byte-identically to today.
- [ ] Minting from the profile menu requires the PIN via `requireReauth()` **before the sheet opens**; the menu item is hidden when `canStepUp()` is false.
- [ ] The profile-menu code is the 15-minute device link, and the sheet does **not** claim it cancels a previous code (because it does not).
- [ ] **`SignInCodeSheet` is mounted exactly once**, in `AppHeader` — not inside `ProfileMenu`, which renders twice.
- [ ] **`ProfileMenu`'s interface stays small**: `isRefreshing` in; `refresh-all`, `sign-out`, `switch-member`, `sign-in-another-device`, `close` out. Nothing else crosses.
- [ ] **`openPodWithFamilyKey` takes only a `CryptoKey`** — no `RecoveryOpener`, no view enum, in the store signature.
- [ ] **`RecoveryOpener` is unchanged** (`'kit' | 'passphrase'`), and the Phase 3 approval path calls `finishLoaded()` with no opener.
- [ ] **`linkMint.ts` has four call sites** (`DeviceLinkCard`, `MagicLinkCard`, `ResumePodSetup`, `useJoinFlow`) and **emits no telemetry of its own**; the join site still passes `CREDENTIAL_PUBLISH_TIMEOUT_MS`.
- [ ] **Phase 1 and Phase 2 add no envelope field, no `syncFileV4` type and no `ENVELOPE_KEY_DICTS` row.**
- [ ] Phase 3 is behind a committed-`false` `deviceApproval` flag, and with the flag off no new code path can be reached.
- [ ] W4's QR carries only a public key; no key material moves without an explicit approval tap. _(Phase 3)_
- [ ] W4 adds no server component and no camera permission; `android.permission.CAMERA` stays undeclared. _(Phase 3)_
- [ ] W4's poll calls `syncStore.loadFromFile()`, not `stagePendingFile()`; **catches its throw**; stops the loop on a latched `RemoteBlocker`; reads its cadence and cap from the single `DEVICE_APPROVAL` object; and calls `stop()` at the cap with an `expired` outcome. _(Phase 3)_
- [ ] `ColdDeviceCodePane` emits `approved(familyKey)`; the **host** runs `openPodWithFamilyKey` + `finishLoaded`. There is exactly one place that finishes a sign-in. _(Phase 3)_
- [ ] `deviceApprovalKeys` is memberId-keyed, `newest-wins`, `required: false`, and written via `putEnvelopeEntry`. _(Phase 3)_
- [ ] `envelopeMerge.test.ts` registry assertion updated; newest-wins rule asserted directly. _(Phase 3)_
- [ ] `login-flow` emits a start and an abandonment event; `kit_redeemed` goes through the facade; **both** the `:887-902` branch and the `:912-915` outer catch are telemetered.
- [ ] `proveMethods.ts` is unmodified, and no `fell-back` discontinuity is introduced.
- [ ] **DRY audit passes**: exactly one QR-render path, one QR-decode path, one device-link mint, one magic-link mint, one minted-link panel, one kit chip, one paste panel, one profile menu, one "family key → open the pod" action, one deep-link marker registry, one file-picker null-ref guard. `MintedLinkPanel` has one definition and three consumers; `DeviceLinkCard`/`MagicLinkCard`/`SignInCodeSheet` contain no `try`/`catch` and no `logEvent`. No literal `beanies-` hash marker survives outside `deepLinks.ts`. No unread prop survives on `InviteLinkCard`.
- [ ] **No-silent-failure audit passes**: `RecoveryKitDisplay`'s QR degrade logs and shows a line; `decodeQrFromImageFile` returns a reason at both return sites and reports; `handleKitPhotoPicked` has a `catch`; `handleKitRedeem`'s outer catch reports; `useFilePicker.open()` cannot no-op quietly; a failed approval publish shows an error rather than a success tick; a poll that cannot reach the file says so after two ticks. No bare `catch {}` added anywhere.
- [ ] No new `ALLOWED_CONTEXT_KEYS` entry; no new mint emitter; `emitLinkMinted`'s `detail` doc comment no longer says "Magic links only".
- [ ] `AppHeader` renders the profile menu from ONE component.
- [ ] **No file is created that is not on the seven-file list**, or the deviation is raised rather than absorbed.
- [ ] All new strings in `uiStrings.ts` with `en` + `beanie`; **only genuinely new** prefixes added to `uiStrings.test.ts` (auth/sign-in copy keeps the real nouns per the beanie-mode floor).
- [ ] Every surface authored light AND dark in one pass; no raw grey ramp, an `-lift` on every accent, no opacity on readable text, a dark partner on every painted background.
- [ ] Help Center articles added/updated per the section above, with the two code lifetimes stated correctly and the Phase 2 laptop-is-cold answer stated honestly.
- [ ] Diagnostic logging implemented and verified per Observability Coverage.
- [ ] `npm run validate` green.

## Testing Plan

1. **Unit** — `deviceApproval.ts` round-trip (generate → seal → open recovers the family key); wrong-keypair, expired entry and `publicKeyHash` mismatch each refuse with their own named reason. Runs with no Pinia harness, which is the check that the module stayed pure. _(Phase 3)_
2. **Unit** — `envelopeMerge`: `deviceApprovalKeys` survives a merge in both directions; newest-wins arbitration on collision; absent-on-both-sides stays omitted rather than `{}` (the `required: false` asymmetry the registry docblock protects). _(Phase 3)_
3. **Unit** — `renderQr` returns `{ unavailable: true }` and logs once when `generateInviteQR` throws; both `RecoveryKitDisplay` and `useMintedLink` surface it.
4. **Unit** — `decodeQrFromImageFile` returns a distinct reason for no-code, unreadable bytes, a failed decoder import **and a null 2-D context**, and reports each.
5. **Unit** — `openPodWithFamilyKey` emits on the failure branch that `LoadPodView.vue:887-902` currently returns from silently, and its signature accepts only a `CryptoKey` (a type-level guard that no view enum crept back in).
6. **Unit** — `ProfileMenu` renders the existing items; the new item hides when `canStepUp()` is false; `AppHeader` mounts it once per breakpoint **and mounts `SignInCodeSheet` exactly once across both** (the regression guard for the two-modal-instances bug).
7. **Unit** — `linkMint`: `mintMagicLink` honours `publishTimeoutMs` and withholds the link when `setMemberLinkWrap` returns false; **and it emits nothing** (assert `emitLinkMinted` is not called from the service — the guard against double-counting the funnel).
8. **Unit** — `deepLinks`: `consumeHashMarker` both reads and strips, asserted on `window.location.hash`; `parseKitInput` and the LoginPage branch resolve through the same marker constant, so changing the constant moves both. _(Phase 1)_
9. **Unit** — the W4 poll calls `loadFromFile` (a regression guard against reintroducing `stagePendingFile`, which would pass a naive test by short-circuiting), **survives a throwing `loadFromFile` and counts it**, stops at the cap from `DEVICE_APPROVAL`, and shows the stale notice after exactly `staleAfterFailures` consecutive rejected ticks. _(Phase 3)_
10. **Regression** — `proveMethods.PROBES` order is unchanged, asserted explicitly, since the array is the contract (`proveMethods.ts:173-180`).
11. **Component** — `RecoveryKitDisplay` renders a magic-link QR **when `magicLink` is passed**, keeps the copy button `data-export-hide`, degrades visibly when QR generation throws, and never disables the confirm button. **Plus the inverse**: with no `magicLink` prop, the rendered order and markup match the pre-change snapshot — the guard for the three kit-only hosts.
12. **Component** — `ProveView` renders the scan affordance when `podOpen` is false and **not** when it is true.
13. **Flag** — with `deviceApproval` off, `ColdDeviceCodePane` never mounts and the `beanies-approve=` branch is unreachable. _(Phase 3)_
14. **Browser, both themes** — walk the real flows: create on desktop → mint from the profile menu with the PIN gate → scan with a phone's own camera; kit entry by camera and by saved PDF; the cold-laptop paste path end to end. Add, for Phase 3: create on phone → scan the laptop's code; approval left to expire. Per `feedback_verify_in_browser_not_just_tests`, green unit tests are not sufficient evidence here.
15. **`npm run validate`** once per release, captured to a file.

## Review Passes

> Passes 2-4 each ran in a fresh `Plan` subagent with an independent context window, per the skill's discipline. Three user decisions were taken after Pass 4 and folded in directly (15-minute device link, keep the checkbox gate, ship everything in one ungated release); these are recorded under _Decisions already taken_ and did not warrant a re-run, since none changed the technical approach.

- **Pass 1 (Initial draft)**: Drafted from the approved mockup plus four codebase surveys; corrected three assumptions from the tracker row and settled all three open questions.
- **Pass 2 (DRY + error handling)**: Verified every cited file/line against the tree and found the plan was about to rebuild four shipped things (`MintedLinkPanel`, `RecoveryKitLink`, `LoginChoiceCard`, and `DeviceLinkCard`'s entire 15-minute mint), was about to reorder `PROBES` for an effect that is already true, was about to poll through `stagePendingFile` which short-circuits on the cold device's own state, and was about to add a duplicate mint emitter — so W0 now consolidates instead of adding, W2 loses the `proveMethods` change, W3 reuses the shipped device link, W4 polls `loadFromFile`, and three pre-existing silent failures on the newly-promoted scan path (`RecoveryKitDisplay:92-94`, `qrDecode.ts:54-56`, `handleKitPhotoPicked`'s missing `catch`) are now in scope.
- **Pass 3 (Sustainability)**: Split delivery into three revertible releases with W4's permanent envelope-dict change gated behind measured Phase 2 data and a `deviceApproval` flag; decoupled `openPodWithFamilyKey` from the view's `RecoveryOpener`; fixed the `ProfileMenu` boundary and moved the single `SignInCodeSheet` mount to `AppHeader`; relocated the deep-link helper out of `src/utils/url.ts` into a `deepLinks.ts` registry whose read-and-strip helper cannot be half-used; made the W4 crypto module store-free with one tunable config object; added a complexity budget; and corrected six path/line/shape facts (`inviteService` is under `services/crypto`, `PhotoAttachments` under `components/media`, `handleKitPhotoPicked` needs a `catch` not a `try`, ADR-021 is `021-photo-storage.md`, `deriveInviteKey` is PBKDF2 not ECDH, and `usePollWhileVisible` swallows the throw so the stale counter must live in the callback).
- **Pass 4 (Fresh-eyes sweep)**: Recorded the two settled decisions and surfaced the real mockup gap (its cold-entry surfaces are Phase 3, so Phase 2's are instructional) — plus caught five latent bugs (`finishLoaded('device-approval')` is not a `RecoveryOpener`; `useMintedLink` has no `detail` to thread; `RecoveryKitDisplay` has four hosts so W1's reorder must be conditional; `loadFromFile` throws and `usePollWhileVisible` has no cap; the `ProveView` affordance must be `!podOpen`-gated), widened W0.3 to the three duplicated magic-link mints, moved `deepLinks.ts` to Phase 1, deleted `InviteLinkCard`'s dead prop outright, and corrected the "add `magicLink.`/`deviceLink.` prefixes" step that is already done.

## Prompt Log

> **No GitHub issue created.** This plan was approved for direct implementation (Notion tracker #97, `github issue: do not create github issue`).

<details>
<summary>Full prompt history — 2026-09-18 session</summary>

### Initial prompt (reshaping the issue)

> ok let's look at #97 device sign in again and perhaps alter the shape of this issue - after thinking about it some more, here are my thoughts:
>
> - Right now the magic link / QR code is buried a bit in the app. After thinking more, I feel like this should really be the #1 option, and the best way to get past that first level of friction (first user signing in on the first new device - i.e. moving from browser to app, or vice versa). I think we should make the BEANIES MAGIC LINK / QR CODE feature FIRST CLASS in the app. For example, create a QR code as part of the profile dropdown (next to beanie wall,etc) or in some other clear place in the UI, rather than being buried in settings. Write (but brief and concise) message at every cold login screen (anytime you are being asked to decrupt the app) to say - scan (or copy) a magic link from a logged-in device. In my opinion, this becomes the first class login method - have another logged in device nearby and simply scan or copy/paste the magic link it generates. We would need to improve the UI to make this option prominent for cold logins, and the recovery kit only as a fallback. It must work seamlessly both on mobile/app and desktop (mobile / app - scan another person's device. desktop - either scan with webcam, or copy/paste the magic link which can be easily shred as a first class feature a logged-in app or mobile device)
>
> - what was written as RUNG 1 in the plan - can you explain how this would work exactly? the cold device shows a QR code and the logged-in device scans it, and that decrypts the file? or something to that effect?
>
> The recovery kit becomes the fall back here, and given scanning QR is now a first class feature, when the user goes to the recovery kit fallback, scanning or loading the recovery kit becomes the first class option, clear and prominent, while manually typing in the recorvery kit code by hand becomes the fallback option
>
> what are yuot rhought on this proposal? does it make sense or how could we make it better and more seamless?

### Follow-up 1 — approving the shape and directing the build

> Agree - go ahead to upadte the tracker item and run /beanies-pre-plan on this item with the proposed shape as per your recommendation
>
> - scan (whether it's push or pull) becomes the top line, first class action in the app for login on cold device. all copy is brief and concise and directs users to scan the qr code on a logged in device.
>
> - yes, agree to input PIN before the logged in device creates a magic link/qr
>
> - yes the fallback is the recovery kit if only one member and one device, but making it first class to scan the qr code ratehr than manually typing in the recovery key
>
> - review the UI approach (which is now probably the key piece of this whole issue) with /frontend-design:frontend-design and ensure that the UI is polished, clear, intuitive and semlessly allows users to understand and login, and magic link options are clearly visible and labelled (profile dropdown works)
>
> let me know if any questions or pending concerns

### Follow-up 2 — mockup direction + surface 6 reshape

> go with C.
>
> regarding surfce 6 (the moment the family is created) this looks very good, although i feel showing 2 QR codes side by side could be confusing (and also may be hard to do at mobile width). my suggestion would be to show and surface the magic link (sign-in link) since that is the first option to sign-in with a new device, but also ensure the message to download the recovery kit is clear and non-skippable.
>
> let me know your thoughts or questions.
>
> if everything is clear, proceed to /beanies-plan then direct to /beanies-build-auto and build autonomously, only stop if required for a blocking question or showstopper.

### Follow-up 3 — copy corrections on the mockup

> on the mockup update the copy 'i've written it down somewhere safe' -> 'i've saved my recovery kit somewhere safe'
>
> and 'keep it somewhere you'd keep a passport' -> 'print it out and/or save it somewhere safe'

### Follow-up 4 — link-kind decision

> go with the 15-minute device link

### Follow-up 5 — the creation-screen gate

> i prefer to keep the checkbox, i don't think anybody can get stuck there right? it's just a checkbox, and just provides a small extra layer of verification that they saved the file.

### Follow-up 6 — scope and delivery (answering the W4-timing question)

> i'm fine to build everything now and flip the flag to true - no need to keep anything behind a false flag. prepare the plan to build everything and run it through beanies-build-auto. perform full testing and validation, using browser where possible as per the skill. expectation is we deliver as per the mockup just approved.

</details>
