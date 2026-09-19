# Plan: Sign-in flow fixes, scanner removal, and the unlock-screen redesign

> Date: 2026-09-19
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-09-19-sign-in-flow-fixes-and-unlock-redesign.md`
> Mockup: https://claude.ai/artifact/88L3haTXDKqcj3vKjb69Qq (approved by greg)

## Context

greg tested 0.21.5 on a production iPhone (TestFlight) and on the web. The device-approval
work from earlier today is confirmed working via the native camera, and the new Drive file
picker is confirmed working on iOS — that was the last unvalidated piece of the picker
rework. What remains is a cluster of **UI-flow** defects (duplicate screens, no-op taps,
landing on the wrong pod) plus a copy and layout pass on the cold sign-in surface, which he
described as "a wall of text that is intimidating for a sign-in screen".

Two of the flow bugs share a single root cause, and it is worth stating once: **on Capacitor
native the OAuth/picker round trip does not unload the WebView**, so the return is a
`router.replace(returnPath)`. When `returnPath` equals the current `fullPath` that is a
REDUNDANT navigation — no remount, no watcher, no re-read — and any page-local `ref` gating
the UI stays exactly as it was. The repo already solved this once for the Drive picker by
sending a DISTINCT resume path (`/welcome?resume=load-drive`), and `LoadPodView.vue:1343-1354`
documents the reasoning in its own comment. The paths that did not get that treatment are the
ones greg is hitting.

## Requirements

1. Scanning a joining/magic link for family B while signed in to family A must open B. Never A.
2. Reconnecting to Google must take one tap, not two.
3. Choosing a Drive file must proceed straight to decrypt — no second tap on the same screen.
4. Approving a device must leave the requester signed in, not on a password form.
5. Minting a magic link must be bounded, must fail visibly, and must be retryable without a reload.
6. The cold sign-in surface must lose the in-app scan, the nested card, and roughly half its words.
7. Terminology, per greg: **magic link** = the link you sign in with; **joining link** = the
   link you join a family with. The paste field accepts BOTH and must say so.

## The bugs

### B1 — a link for pod B lands you in pod A (severity: highest)

Reported: signed in to one family, scanned a joining QR for another, landed on the FIRST
family's member list. Root cause under investigation at time of writing; greg's instinct is
that a guard is missing. The fix must ensure the link's target family id — not
`familyContextStore.activeFamilyId` — decides which pod is opened.

### B2 — Google reconnect takes two taps (native only)

`useGoogleReconnect.ts:119` builds `returnPath` as the CURRENT `pathname + search`, so
`App.vue:1826`'s `router.replace` is a no-op on native. The button's predicate
(`LoadPodView.vue:1158`) reads `props.reconnectDriveFile`, a `LoginPage`-local ref written in
exactly one place — the boot-time auth-failure branch at `LoginPage.vue:556` — which never
re-runs. The second tap short-circuits at `driveTokenRecovery.ts:486`
(`if (isTokenValid()) return true`), which is the proof the FIRST tap already got a token.

Fix: give the reconnect its own resume path, mirroring the picker. The identical defect exists
at `useLoginFlow.ts:1227-1259` (`onRecoveryReconnect`), whose comment claims "the boot path
re-enters this flow with a fresh token on return" — true on web, false on native. Fix both.

### B3 — an extra tap after choosing the Drive file

Same family of defect one step later: the picker returns with a file chosen, and the screen
re-renders still asking to open the picker. The second tap short-circuits. Under investigation.
Also to assess: greg saw TWO consent prompts (connect, then picker) — is the second avoidable?

### B4 — approved device lands on a password form over an already-open pod

`decryptPendingFileWithKey` clears the staged file at `syncStore.ts:3383` and then `await`s
more (`settingsRepo.saveSettings` at `:3390`), which lets Vue flush. `canUseDeviceApproval`
(`LoadPodView.vue:197`) derives from `hasPendingEncryptedFile` and gates the whole panel with
`v-if` at `:1529` — so `ColdSignInPanel` → `DeviceApprovalRequest` UNMOUNTS, and its
`emit('approved')` hits Vue's `isUnmounted` guard and never reaches the parent. `finishLoaded()`
never runs. The pod IS open, which is why backing out and re-picking the file lands straight on
the member list.

Fix structurally: the parent observes "the pod became open" rather than depending on an event
from a child whose unmount is caused by that very state change.

### B5 — magic-link mint hangs forever, silently

`addInvitePackage` (`syncStore.ts:3547`) calls raw `await syncNow(true)` with NO timeout. Every
sibling credential publish goes through `publishEnvelopeEntry` and gets 12s or 20s;
`publishEnvelopeEntry`'s own docblock says an unbounded sync there "holds up the whole flow
behind it". Nothing emits on start, so a hang produces no telemetry at all.

There is also no way out: the reopen watcher at `SignInCodeSheet.vue:149-160` resets `link`,
`qr`, `errorKey` and `qrUnavailable` but NOT `isMinting`, and `useMintedLink.ts:48` early-returns
silently while it is set. Closing and reopening shows the spinner again and retry does nothing.
A reload was the only escape, which is exactly what greg did.

Most likely trigger for the 45s specifically: the doc worker missing its 10s handshake on first
boot after an update (new service worker activating while the page fetches the new worker chunk
and ~2.6MB of WASM), dropping the session to permanently inline, unbounded main-thread mode
(`docClient.ts:417-446`). That also explains why a hard refresh cured it. Fix the budget
regardless — it is what turns a slow operation into an infinite one.

## Scanner removal

Remove the in-app scan (button, hidden file input, `useQrCapture` wiring) from
`ColdSignInPanel` and `SignInCodeSheet`. It photographs one frame and decodes it, which is a
strictly worse signal than a live scanner, and greg confirms it still fails while the native
camera works.

**Not replaceable by "open the native camera app":** there is no public API to launch the iOS
Camera app. Android has `android.media.action.STILL_IMAGE_CAMERA`, iOS has nothing, and a
button that silently does nothing on half the devices is worse than no button. greg agreed.

The decoder (`qrDecode.ts`) STAYS — recovery-kit redemption still uses it.

⚠️ Consequence to accept: `in-app-scan` was the only transport proving the person chose to
scan, so every approval now arrives as a deep link and the provenance callout shows every
time. greg's reworded callout reads better as an always-on line than the old text did.

## Copy (greg's wording, with the two corrections he approved)

| Where                              | From                                                                                     | To                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Unlock subtitle                    | "This decrypts {family}'s family data. Next, you'll sign in as a member."                | "Next step: decrypt my beanpod"                                      |
| `coldEntry.pushLead`               | "This device has a camera, so the quickest way in is…"                                   | DELETED                                                              |
| Step 1                             | "On a device you're already signed in on, open beanies and tap your profile."            | "On a signed-in device, open the app and tap your profile."          |
| Step 2                             | "Choose Sign In Another Device, then the option about pointing a camera at that screen." | "Choose Sign In Another Device and create a magic link."             |
| Step 3 (new)                       | —                                                                                        | "Open your camera and scan the QR code."                             |
| `coldEntry.showMyCode`             | "Show my code instead"                                                                   | "Show my QR code instead"                                            |
| `signInCode.scanLead` (top copy)   | rendered TWICE                                                                           | top `<p>` DELETED                                                    |
| `signInCode.scanLead` (below code) | "Point the other device's camera at this code."                                          | "Scan this code with your other device to log in"                    |
| `deviceApproval.title`             | "Let This Device In?"                                                                    | "Approve Login"                                                      |
| `deviceApproval.provenanceBody`    | "Only carry on if you just pointed…"                                                     | "Confirm that you know the person asking to access your family pod." |
| Paste field                        | "Have a magic link? Paste it here" / "Paste your beanies magic link here"                | a label that covers BOTH link kinds                                  |

**Decisions inside this table:**

- The camera line became **step 3** rather than a floating instruction: the first two steps are
  about the OTHER device and this one is about THIS device, so as a loose line it reads like a
  caption with no owner.
- The paste field accepts **invite links as well as sign-in links** (`useBeaniesLinkSubmit`
  imports `parseInviteLink`; the placeholder is a `/join?...` URL). The existing copy says
  "magic link" and therefore contradicts its own placeholder and turns invitees away. Label
  covers both; helper names both using greg's terms.
- greg's camera-icon request is **superseded** — the button it would sit on is being deleted.

## New: the picker instruction copy

The Google picker's own CTA reads "Insert", which greg found confusing and which we cannot
change. Our surrounding copy should name it: tell the person to choose their file and tap the
blue **Insert** button at the bottom. ⚠️ That label is Google's and may localise; word it so a
different label does not make our instruction wrong.

## Layout — the cold sign-in surface

Approved mockup: https://claude.ai/artifact/88L3haTXDKqcj3vKjb69Qq

- **Drop the nested card.** `LoadPodView` wraps everything in a white `rounded-3xl … p-8` card
  and `ColdSignInPanel`'s root is ANOTHER white `rounded-3xl … p-5` card — 104px of horizontal
  padding at 390px, and a white-on-white box that reads as a rendering bug.
- **Drop the OUTER card at phone width too.** On mobile it frames the entire viewport contents
  and separates nothing; the page ground becomes the surface. KEEP it from `sm` up, where it
  genuinely bounds a 540px column in a wide field.
- **Fix the missing margin** between the subtitle (`LoadPodView.vue:1504`, `mt-1`, no bottom
  margin) and the panel below it (`:1529`, `mb-6`, no top margin).
- Always-open paste input instead of the disclosure — greg's call; saves a tap and shows the
  field to someone who does not yet know they have a link.

⚠️ **Raised with greg, his call:** the heading says "Unlock My Beanpod" and the new subtitle
says "Next step: decrypt my beanpod" — the same instruction twice, which is the exact thing
being deleted from the magic-link sheet.

## Observability Coverage

- `link_mint_started` (new, `login-flow`, `info`) — the denominator the mint has never had. A
  hang currently emits NOTHING, so "hung" and "never attempted" are the same signal.
- Mint duration via `measureAsync('link.mint', …)` — `perf_op` / `perf_duration_ms` are already
  allowlisted, so no store-declaration change.
- `errorCode: 'mint-timeout'` on the bounded mint, distinct from a clean failure.
- `useMintedLink`'s re-entrancy early return emits instead of returning silently, so "I tapped
  again and nothing happened" becomes queryable.
- The doc worker's fall back to inline mode (`docClient.ts:437-445`) currently only
  `console.error`s. A `warn` `logEvent` there names the most likely cause of B5 from one
  CloudWatch query; it is once-per-device so it cannot flood.
- B1/B2/B3: each fix emits on the path it repairs, so a recurrence is visible as a rate rather
  than as another bug report.
- **No new `ALLOWED_CONTEXT_KEYS` entries**, so no store data-collection update.

## Acceptance Criteria

- [ ] A joining/magic link for family B opens B while signed in to A (regression test)
- [ ] Reconnect is one tap on native; the sibling in `useLoginFlow` is fixed too
- [ ] Choosing a Drive file proceeds without a second tap
- [ ] An approved device lands signed in, never on a password form (regression test)
- [ ] The mint is bounded, emits start + duration, and is retryable after a hang without reload
- [ ] No in-app scan remains on the cold surface or the sign-in sheet; `qrDecode` still serves the kit
- [ ] Every copy row above is applied; every new key has `en` + `beanie`
- [ ] No nested card; no outer card below `sm`; the subtitle/panel gap exists
- [ ] Light and dark, 390px and 1280px, verified in a browser
- [ ] `npm run validate` green

## Testing Plan

1. `npm run validate`, once, captured to a file.
2. Unit: the wrong-pod guard; the approval success path not depending on a child emit; the
   bounded mint returning a timeout; `isMinting` reset on reopen.
3. Browser: the unlock surface in both themes at 390px and 1280px against the approved mockup.
4. Manual on greg's iPhone (cannot be done here): the two-tap reconnect, the picker second tap,
   the wrong-pod scan, and a real mint against real Drive latency.

## Review Passes

- **Pass 1 (Initial draft)**: drafted from four root-caused bugs plus three reported this
  session; records the native `router.replace` no-op as the shared cause of B2/B3.

## Outcome

✅ **SHIPPED as 0.21.6** (`669d38b9`) — web, iOS TestFlight, and Android `beta` (open testing).
Verified by reading the version out of the live bundle at `app.beanies.family`, not assumed.

Every acceptance criterion above was met except the ones recorded as deliberately deferred in
`docs/STATUS.md` (the Drive picker's extra tap, three sibling reconnect surfaces, and the
second Google consent prompt). The on-device checks this plan could not reach are listed
there too.

⚠️ This plan is DONE. Do not re-implement it. Where the shipped code disagrees with a design
decision written above, the code won a review round and the reasoning is in its comments.
