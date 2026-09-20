# Plan: Magic-link-first sign-in

> Date: 2026-09-20
> Related issues: None — direct implementation. Adjacent: #346 (cross-tab clear-data), #117 (key rotation).
> Plan file: `docs/plans/2026-09-20-magic-link-first-sign-in.md`
> Mockup: `docs/mockups/welcome-back-magic-link-2026-09-20.html` — **APPROVED by greg 2026-09-20** (reviewed as a published artifact). Workstream 5 is in scope for implementation.

> **No GitHub issue created.** Approved for direct implementation in-session on 2026-09-20.

## User Story

As a family member signing in on a new device, I want to scan a magic link from a device
I am already signed in on, so that I land in my pod without hunting for a recovery kit,
a passphrase, or the right Google account in an empty chooser.

## Context

greg reported that after "sign out and clear data" the first thing beanies asks for is
Google Drive authentication, and proposed promoting magic-link scanning to a first-class
sign-in path.

Investigation established three things that shape this plan:

1. **The premise is true only for the clear-data case.** A genuinely fresh device leads
   with `WelcomeGate` — "plant a new pod" as the hero, then Sign In / Join, then a paste-link
   panel. There is no Drive consent on that screen at all. After clear-data,
   `deleteFamilyDatabase` (`database.ts:66-82`) does **not** remove the LOCAL IndexedDB `beanies-registry` `families`
   row, so the device still sees one local family, takes the silent fast path
   (`LoginPage.vue:452-468`), finds `buildPeople` returns `null` because the rosters were
   cleared, and drops into the bootstrap branch which lands on the Drive reconnect panel.
   The device looks known but has no credentials.

2. **A magic link carries a token and pointers, not key material.** `buildInviteLink`
   (`inviteService.ts:179-204`) writes `fam`, `p`, `ref`, `fileId`, `t`, `hint`, `lk`, `ml`,
   `m`. The token is only a PBKDF2 input to an AES-KW KEK; the wrapped family key lives in
   the envelope **inside the `.beanpod` on Drive**. So scanning does not bypass Drive
   consent, it precedes it. There is no peer-to-peer path, no relay, and no server copy of
   the file — the registry Lambda stores only `provider`/`fileId` metadata.

3. **The win is real anyway.** Today: consent against an empty account chooser, then a
   credential challenge (kit / passphrase / password / PIN). With this work: consent
   pre-filled with the right account, then straight in with no challenge. Supporting signal
   already in the code (`magicLink.ts:5-9`): 6 of 22 families redeemed a recovery kit, all
   on cold devices, and 5 then replaced a working PIN.

The enabling gap is small and concrete: **magic links never set `hint=` at all.**
`mintMagicLink` and `mintDeviceLink` build their URLs with no invitee email
(`linkMint.ts:102-111`, `:160-171`), so on redeem `useJoinFlow`'s `inviteEmailHint` is always
`null` (`useJoinFlow.ts:727`), `tryReconnectSilently` is skipped and Google's chooser comes up
empty. Only the classic invite (`useInviteFlow.ts:129-214`) sets it. Every downstream
`loginHint` consumer already works — verified at `usePickBeanpodFile.ts:226,255-293` and
`useJoinFlow.ts:962`.

## Requirements

1. **Terminology.** Every link or QR code that facilitates sign-in is a **magic link**,
   regardless of duration. "Device link" and "sign-in code" are retired as user-facing
   concepts. "Joining link" remains correct for a member who has not yet joined.
   This governs user-facing **values** in `uiStrings.ts`, not key namespaces (see W6).
2. **Hint invariant.** Every link minted by `linkMint` carries `hint=` derived from the
   target member's `FamilyMember.googleAccountEmail` whenever it is defined; omitted when
   undefined. Never fall back to `FamilyMember.email`.
3. **Member selection at mint time.** The mint surfaces ask "Who's signing in?", defaulting
   to self at one tap.
4. **Routing.** A member who has joined gets a magic link. A member who has **not** joined
   is handed to the **existing invite wizard**, because that is the only path that performs
   the Drive permission share.
5. **Reauth gate.** `mintMagicLink` gets the same default-on gate that `mintDeviceLink`
   already has — with explicit, named opt-outs for the two mint sites that run inside a
   flow where there is nothing yet to step up from (see W3; this is a blocking correction).
6. **Cold sign-in affordance placement.** Fix `ColdSignInPanel`'s stale docblock and render
   it on the post-Sign-In surfaces where it is currently missing, without duplicating the
   paste panel those surfaces already carry.
7. **Welcome-back promotion (mockup APPROVED, in scope).** Scanning a magic link becomes the
   first-class option on the surface reached _after_ the user chooses the login path.
8. **Consistency sweep** across every login, re-login, reconnect, join and unlock surface.

## Important Notes & Caveats

- **The `WelcomeGate` home screen does not change.** greg was explicit: the hero, the
  Sign In / Join pair and the paste-link panel stay exactly as they are. Only once the user
  has explicitly chosen the **login** path (not create-pod) does scanning become first-class.
  This narrows workstreams 4 and 5 to `LoadPodView`'s `cards` and `reconnect` states.
- **Push mode only on unstaged surfaces.** On `cards` and `reconnect` nothing is staged, so
  pull mode ("show my code here, approve from the other device") cannot work:
  `DeviceApprovalRequest` polls the staged `.beanpod` for a wrap no one will write, and
  `LoadPodView`'s own `canUseDeviceApproval` gate requires
  `hasPendingEncryptedFile && storageProviderType === 'google_drive'`
  (`LoadPodView.vue:201-203`) — neither holds on `cards`. Same reason the panel is excluded
  from `WelcomeGate` (`WelcomeGate.vue:271-281`). The `decrypt` state, where a file _is_
  staged, keeps both modes as today.
- **⚠️ `ColdSignInPanel` already contains a `PasteLinkPanel` (`ColdSignInPanel.vue:182`), and
  `LoadPodView` already hoists one above the storage cards (`LoadPodView.vue:1852-1854`)
  inside the same `<template v-else>` that renders `cards`, `reconnect`, `auto-loading`,
  `permission-grant` and `empty`.** Mounting the cold panel on those states as first drafted
  would render the paste panel **twice**, one above the other, with a duplicate "or" divider.
  This is the single most likely visible defect in this plan and W4 is written to prevent it.
  Verified directly: both imports and both render sites exist.
- **There is no in-app camera.** No `getUserMedia` anywhere in the repo
  (`ColdSignInPanel.vue:28`), consistent with removing the unreliable "Open Camera" button
  in 0.21.6. The CTA is an instruction to use the phone's own camera app, which returns via
  deep link. greg has accepted this explicitly.
- **Do not rename the persisted envelope dicts.** `memberLinkKeys` and `inviteKeys` are
  data format; renaming them is a migration, not a rename, and `envelopeMerge` is
  union/local-wins so a stale device would resurrect the old shape. Out of scope.
- **`linkMint.ts` emits no telemetry, by contract** (its header says so explicitly, and
  `useMintedLink` owns the funnel so the two kinds cannot drift into two event shapes).
  New observability goes in the hosts, never in `linkMint`. This is why `MintResult` grows a
  _returned_ hint/gate outcome rather than a `logEvent` call.
- **Prefer the existing `detail` key over new context keys.** `kind` and `detail` are already
  allowlisted, so encoding the new facts into `detail` avoids the `ALLOWED_CONTEXT_KEYS` +
  store-declaration gate entirely (`CLAUDE.md` observability rule 5).
- **A 7-day magic link is newest-wins**: minting replaces that member's previous link
  (`memberLinkKeys[memberId]`). The 15-minute variant is additive (`inviteKeys[hash]`).
  Copy must keep saying so, since minting one silently kills the other.
- **The hint rule applies to `linkMint`, not to the invite wizard.** An unjoined member has
  no `googleAccountEmail` (it is written only on that member's own first successful OAuth —
  `models.ts:275-293`, `googleAccountAssertion.ts`). The invite wizard's hint is an email the
  user **types and explicitly confirms** on step 1 before a Drive share runs; `member.email`
  is only a _form prefill_ the user must confirm (`InviteWizardModal.vue:88-92`,
  `InvitePickerStep.vue:57`), not a silent `login_hint` fallback. That behaviour is correct
  and unchanged. Do not "enforce" requirement 2 into `useInviteFlow` — doing so would remove
  the hint from the one path that actually shares the file and regress the join flow.
- **Two Settings cards will both be "magic links" after the rename.** Resolved for this run
  by differentiating on _purpose_, not concept name (the saved one vs the on-the-spot one).
  Merging them into a single card is a larger UX change than greg scoped and is flagged as
  an open question rather than done.

## Assumptions

> **Review these before implementation.** Valid as of 2026-09-20.

1. `linkMint.ts` remains the single choke point for all mint sites. Verified: the only
   callers are `MagicLinkCard.vue:72`, `DeviceLinkCard.vue:35`, `SignInCodeSheet.vue:80`,
   `ResumePodSetup.vue:737` and `useJoinFlow.ts:1472` — **five** call sites across two
   functions, not the three the first draft assumed.
2. `FamilyMember.googleAccountEmail` is the only field valid as a `login_hint` for a minted
   link. `FamilyMember.email` is documented at `models.ts:272-277` as a user-editable contact
   address "not required to match any specific external account".
3. `member.requiresPassword === true` identifies a member who has not yet joined
   (`models.ts:327`; the same predicate `useJoinFlow.ts:533` and `InvitePickerStep.vue:56` use).
4. `QuickAddMemberPicker.vue` is the fold-down member-selection pattern greg meant.
5. `loginV6.pickBeanTitle` (`"Who's signing in?"` / `"which beanie are you?"`,
   `uiStrings.ts:4178`) already exists and matches the requested phrasing, as do
   `loginV6.pickBeanSubtitle` and `quickAdd.picker.back`. No new heading key is needed.
6. Adding a required `memberId` to `mintDeviceLink` is safe: its call sites are
   `DeviceLinkCard.vue:35` and `SignInCodeSheet.vue:80`, both of which gain a picker.
   (`DeviceLinkCard` passes the bare function reference today, so TypeScript will force the
   closure — that is the intended compiler-enforced coverage.)
7. `InviteWizardModal` is mounted with byte-identical prop derivations in its two existing
   hosts (`MeetTheBeansPage.vue:732-741`, `BeanDetailPage.vue:153-161`), so the launcher
   extraction in W2 is a true de-duplication and not a new abstraction over one caller.

## Approach

### Workstream 1 — The hint invariant, enforced structurally

`linkMint.ts` is already the choke point, so the invariant belongs there.

1. **Add a required `hintMemberId` to `mintDeviceLink`.** It currently takes no member at all.
   Requiring one is compiler-enforced coverage: no call site can mint without naming a member,
   which is exactly the condition that makes a hint derivable. **Named `hintMemberId`, not
   `memberId`, deliberately** — a device link is family-scoped, and calling it `memberId` invites
   a future reader to "fix" the deliberate `m=` suppression in step 4 below.
2. **One private resolver in `linkMint.ts`:**
   ```ts
   type HintReason = 'ok' | 'no-account' | 'unknown-member';
   /** The ONLY source of a login hint. `email` is a contact address, not an account. */
   function resolveHint(memberId: string): { email?: string; reason: HintReason };
   ```
   It reads `useFamilyStore().members`, finds the member, returns `googleAccountEmail` or a
   reason. It never reads `member.email`. It is wrapped so a store read that throws (Pinia not
   yet active, roster mid-load) degrades to `{ reason: 'unknown-member' }` — a missing hint is
   a worse chooser, never a failed mint.
3. **Both mints pass `inviteeEmail: resolveHint(memberId).email`** into the URL builder.
   `buildInviteLink` already writes `hint=` when given one, so no wire-format change.
4. **⚠️ `mintDeviceLink` passes `inviteeEmail` ONLY — never `memberId` — to `buildInviteLink`.**
   `buildInviteLink` writes `m=` whenever `memberId` is set (`inviteService.ts:202`), but
   `parseInviteLink` reads `m=` only under `ml=1` (`:258-266`). A device link is `lk=1`, so a
   member id there is a dead param that still ships an internal identifier in a URL people
   paste into chat. The plumbing that makes the hint derivable must not leak onto the wire.
   Verified directly against both functions.
5. **A missing hint never refuses a mint.** A link without `hint=` still works; it just
   shows an empty chooser.
6. **⚠️ Trade-off recorded out loud: this puts an email address on the wire.** Step 4 argues
   against shipping an internal member id in a pasteable URL, and then this workstream adds a
   base64-encoded email to the same URL. `hint=` is base64, which is encoding, not protection.
   greg's requirement is explicit and stands, and the address is one the recipient already
   knows (it is their own account), but the plan should not imply the wire is clean. The same
   applies to the classic invite, which has carried `hint=` since it shipped.
7. **`MintResult`'s success arm carries the hint outcome back to the host:**
   ```ts
   export type MintResult =
     { link: string; hint: HintReason } | { errorKey: string; errorCode: string };
   ```
   This is how the hosts get the telemetry fact without `linkMint` emitting anything — the
   file's no-telemetry contract survives intact. **No `gate` field**: see Observability for why
   the gate outcome is not threaded through.
8. **Regression test:** a member with `email` set and `googleAccountEmail` undefined must
   produce a URL with **no** `hint=` param. This is the test that would have caught the
   wrong-field mistake. Plus: a device link must contain `lk=1` and **no** `m=`.

### Workstream 2 — "Who's signing in?" at mint time

Three separate DRY problems hide in this workstream. Each existing pattern is reused rather
than re-expressed.

**(a) The picker. Extract before reuse.** `QuickAddMemberPicker.vue` is coupled to
`useQuickAdd` (`stage`, `commitPicker`, `cancelPicker`, `stage.pending.labelKey`), so it cannot
be reused as-is. Split it:

- **New `src/components/ui/InlineMemberPicker.vue`** — presentation only: the fold-down
  expansion animation, the back chip, the staggered avatar tile grid, the empty state.
  Props: `members: FamilyMember[]`, `title`, `subtitle?`, `backLabel?`, `emptyMessage?`;
  emits `pick(memberId)` and `cancel`; one optional scoped slot `#badge={ member }` so a host
  can annotate a tile (used below to mark "hasn't joined yet" _before_ the user taps, rather
  than surprising them with a different flow afterwards).
- **`QuickAddMemberPicker.vue` becomes a thin wrapper** binding `useQuickAdd` to it and
  keeping its own `scrollIntoView` behaviour and its two `data-testid`s **verbatim**
  (`quick-add-member-picker-inline`, `quick-add-member-inline-tile-${id}`).
- **Styles move across unchanged** so QuickAdd's appearance cannot regress. The raw hex
  (`#f15d22`, `rgb(44 62 80)`, `#1e2a36`) is pre-existing debt — most of the file already uses
  `--tint-orange-*` vars and it does have `html.dark` partners, so it is lint-green today and a
  pure move keeps it that way. Recorded as debt in W6, not fixed in the same commit, because
  changing it here would make a visual regression indistinguishable from the extraction.
- **⚠️ One deliberate behaviour change, called out so it is not read as a regression.** The
  extracted component uses `getMemberAvatarVariant({ gender, ageGroup, isPet })`, not
  `getAvatarVariant(gender, ageGroup)`. The current QuickAdd picker uses the pet-blind
  overload, so a pet in that picker renders as a human bean — `useMemberAvatar.ts:46-53` exists
  precisely to prevent that, and every other member surface (including `InvitePickerStep`) uses
  it. This is a one-line fix to a live cosmetic bug, with a test, and it will show in the
  QuickAdd screenshots.
- **⚠️ There is no existing test of `QuickAddMemberPicker`** (verified: no file references its
  testids outside itself, and `QuickAddFab.test.ts` does not reach it). "Existing tests pass"
  is therefore not a safety net. The extraction ships with a new wrapper test asserting both
  testids still render and that a tile tap calls `commitPicker` / the back chip calls
  `cancelPicker`.
- Hosts pass `familyStore.sortedHumans` — a pet cannot sign in. QuickAdd keeps
  `sortedMembers`, because pets do take meds and have favourites.

**(b) The mint target lives in the HOST, via a small composable. No wrapper component.**

Pass 2 proposed a `MagicLinkMinter.vue` owning the target, the picker, the routing, the
`useMintedLink` call and the `MintedLinkPanel` render, with `#status` / `#note` slots handing
host copy back down. Pass 3 cut it, and was right on two grounds:

- **It inverts the architecture the two cards were refactored into.** `useMintedLink` owns the
  sequence and `MintedLinkPanel` owns presentation, and `MintedLinkPanel.vue:23-30` explicitly
  says copy must come from the host, because hard-coded copy once made the device card announce
  itself as a magic link. A fourth layer owning both, taking `qrAlt`/`hint` as pass-through
  props and handing content back down through slots, re-creates exactly that coupling.
- **⚠️ It invites a DESTRUCTIVE, SILENT defect, and this is the most likely user-visible bug in
  the whole change.** `MagicLinkCard.vue:37-60` derives `existing`, `status`, `statusText` and
  `createWarning` from `authStore.currentUser?.memberId`. Put the target inside a wrapper and
  the host can no longer see it, so the card shows **your** green "active" dot and **your**
  "this cancels the old one" warning while minting for your spouse — and because
  `memberLinkKeys` is newest-wins, the mint then silently kills their live link. With the
  target in the host, `existing` derives from the target for free and the warning tells the
  truth.

So instead:

- **New `src/composables/useMintTarget.ts`**, roughly 35 lines: holds `targetId` (defaulting to
  `authStore.currentUser?.memberId`), `isPickerOpen`, the `sortedHumans` list, the
  `requiresPassword` routing predicate, and a `reset()`. No rendering, no telemetry, no crypto.
- **Each host composes it** and keeps its own `useMintedLink` call, its own `MintedLinkPanel`
  render and its own copy, exactly as today. `MagicLinkCard` re-points its four status computeds
  at `target.targetId` instead of `currentUser.memberId` — a one-line change per computed that
  _fixes_ the status-lies-about-whose-link problem rather than creating it.
- **`InlineMemberPicker` is rendered by the host**, inside the existing card body, so the
  fold-down appears where the user tapped.

**Target-aware copy is a requirement, not polish.** Because minting for another member replaces
_their_ link, the confirm copy and the status line must name them: `fillTemplate(t(key), { name })`
with new keys under the already-registered `magicLink.` / `deviceLink.` prefixes.

**(c) The joining route. Do not reimplement the invite wizard, and do not stack it either.**

`useInviteFlow.shareDriveAccess(email)` needs a _confirmed email address_, performs two Drive
permission writes, and returns a five-code error taxonomy with per-code recovery actions
(`useInviteFlow.ts:11-24, 229-323`). All of it is already wrapped by `InviteWizardModal`, whose
**step 0 is literally a "who am I inviting?" member picker** (`InvitePickerStep.vue`, which
already dims joined members and the owner with explanatory chips). Rebuilding any of that in a
Settings card would be the largest duplication in this plan.

Pass 2 proposed an `InviteWizardLauncher.vue` plus migrating the two existing hosts onto it.
**Cut.** Not because the hosts differ — checked directly, `MeetTheBeansPage.vue:732-741` and
`BeanDetailPage.vue:153-161` pass the _same six props_ with byte-identical store derivations and
both leave `layer` at its `'overlay'` default, so pass 2's assumption 7 was substantially
correct and pass 3 overstated its refutation. The decisive objection is different and it holds:
**`SignInCodeSheet` is itself a `BaseModal`, so mounting the wizard from inside it would be a
three-deep dialog stack** on a component with no focus trap and a documented re-entrancy hazard.

The replacement is strictly in-pattern and adds no component:

- **`MeetTheBeansPage` grows an `?invite=<memberId>` deep-link param**, consumed by the
  `useDeepLinkParam` it already uses for `?edit=<id>` (`MeetTheBeansPage.vue:259-269`) — which
  was built with a cold-start retry for exactly this case — and dispatched into the existing
  `openShareModal(member)` (`:169`). Eight lines in one existing file.
- **The mint hosts route there** rather than opening a wizard in place: an unjoined pick closes
  the sheet and navigates to `/meet-the-beans?invite=<memberId>`.

Requirement 4 is satisfied literally, no page is migrated, no modal is stacked, and invites
become deep-linkable as a side effect.

### Workstream 3 — The reauth gate (contains a blocking correction)

**⚠️ The first draft would have fired a PIN prompt in the middle of pod creation and in the
middle of joining.** `mintMagicLink` has four call sites, not one:

| Call site                | Context                                                                                                 | Effect of a default-on gate |
| ------------------------ | ------------------------------------------------------------------------------------------------------- | --------------------------- |
| `MagicLinkCard.vue:72`   | Settings, user-initiated                                                                                | correct — gate wanted       |
| `SignInCodeSheet.vue:80` | profile menu, already gated pre-mount                                                                   | correct — `alreadyProved`   |
| `ResumePodSetup.vue:737` | inside the **unclosable** create-pod save step, best-effort, before `enrollDevicePinWrapForMember` runs | **defect**                  |
| `useJoinFlow.ts:1472`    | immediately after `joinFamily` commits, on the one screen the joiner can ever see their link            | **defect**                  |

At both of the latter two, `requireReauth` would stack a PIN pad over a modal the user cannot
close, and — where `currentMember` is unresolved or credential-less — it fails closed with an
`alert()` and resolves `false` (`useReauth.ts:79-90`), so the link would be **withheld** from
the exact two flows whose docblocks say the mint must never block. `canStepUp()` is not a
sufficient guard either: the owner's `pinHash` is already on the doc by that point in
`ResumePodSetup`, so the gate would genuinely fire.

The fix is an explicit, named, three-valued option, shared by both mints:

1. **One vocabulary, one implementation.** Replace `mintDeviceLink`'s `alreadyProved?: boolean`
   with `gate?: GateMode` on **both** functions, where
   `type GateMode = 'require' | 'already-proved' | 'not-applicable'`, defaulting to
   `'require'`. The gate block itself moves into a private `runGate(mode)` in `linkMint.ts`
   used by both mints — so W3 removes a copy rather than adding one. `mintDeviceLink`'s
   existing comment ("a per-host gate is a gate the next host forgets… defaulting to on means
   forgetting it fails SAFE", `linkMint.ts:60-73`) is preserved verbatim and now covers both.
2. `SignInCodeSheet` passes `'already-proved'` (it proves before the sheet mounts).
3. `ResumePodSetup` and `useJoinFlow` pass `'not-applicable'`, each with a one-line comment
   saying why: there is no prior session to step up from — the link _is_ the credential being
   issued as part of establishing the session, and the surrounding flow is uninterruptible.
4. **`runGate` returns a plain boolean and no `GateOutcome` is threaded anywhere.** Pass 2
   wanted the outcome on `MintResult` and in `detail`; pass 3 cut it and is right. A decline is
   _already_ observable as `error_code=gate_declined` (`useMintedLink.ts:117-125`), and "the
   gate fired where it must not" is **prevented** by a three-line unit test asserting
   `requireReauth` is never called for `'not-applicable'`, not diagnosed after the fact.
   Threading a third field through `MintResult`, the composable and four emitters forever, to
   catch a case a test already makes impossible, is instrumentation the app could never remove.
   `GateMode` itself stays: three values, two behaviours, where the third value **is** the
   documentation — `alreadyProved: false` at the creation and join sites would be a lie.
5. The asymmetry being fixed remains the point: the magic link is the **longer-lived**
   credential (7 days against 15 minutes) and is currently the ungated one. W2 makes this
   materially more important, because minting for _another_ member becomes possible.

### Workstream 4 — Cold sign-in affordance placement

Pass 2 proposed a `variant: 'staged' | 'unstaged'` prop on `ColdSignInPanel`. **Cut.** A variant
that disables three of four features and renders _nothing_ on desktop is not a variant, it is a
second component sharing an import — and it would turn "`decrypt` is unchanged" into a test
obligation against a 2,297-line host. Since W5 is now in scope and lands on the same two states,
splitting is cheaper than parameterising, not dearer.

1. **Correct the docblock.** `ColdSignInPanel.vue:5-8` claims it renders on three surfaces; it
   renders on one (`LoadPodView.vue:18,1633`). `ColdSignInPanel` gains **no new props** and
   `decrypt` is untouched by construction.
2. **New `src/components/login/ColdEntrySteps.vue`** — the numbered push instructions only,
   extracted so both the staged panel and the new unstaged block render the same steps from one
   source instead of two copies of the same three sentences.
3. **New `src/components/login/ScanFirstBlock.vue`** — the promoted block for the unstaged
   states: the flag, the heading, `ColdEntrySteps`, and the CTA. It mounts **no**
   `DeviceApprovalRequest` (so no throwaway ECDH keypair, no 3-second whole-file poll, and no
   inflation of the `device_approval_requested` denominator) and **no** `PasteLinkPanel` —
   because `LoadPodView.vue:1852-1854` already renders one for these states. The
   double-paste-panel defect is therefore structurally unreachable rather than guarded.
4. **On a non-touch device `ScanFirstBlock` leads with paste and drops the numbered steps**, per
   the approved mockup, switched on the `useIsTouchPrimary()` that `ColdSignInPanel` already
   uses. ⚠️ **Its telemetry emit must be guarded on `isTouchPrimary`**, because `onMounted` fires
   even when the template renders nothing — otherwise `cold_unlock_started` counts surfaces that
   offered the user nothing.
5. **Mounted ONCE with a derived surface**, not keyed per state: one mount whose `surface` is
   `load-pod-cards` or `load-pod-reconnect` computed from `viewState`. Three mount points would
   need three values or the existing `cold_unlock_started` series becomes uninterpretable;
   `load-pod-unlock` is unchanged.
6. **Not on `WelcomeGate`** — greg's narrowing, and the existing exclusion rationale stands.
7. **Not on `ProveView`** — it runs after the file is open, where the recovery-kit link is
   already the correct escape.

### Workstream 5 — The welcome-back surface (MOCKUP APPROVED 2026-09-20 — now IN SCOPE)

`docs/mockups/welcome-back-magic-link-2026-09-20.html` **exists** (created this session) and is
published as an artifact for greg to review. It covers `LoadPodView`'s `cards` state and its
`reconnect` state at phone and desktop widths in light and dark, with scan-a-magic-link as the
lead block and the Drive card beneath, and closes with a section stating what it does and does
not assert.

There is already precedent for link-first ordering there: `PasteLinkPanel` is deliberately
hoisted above the storage cards (`LoadPodView.vue:1839-1854`), so this promotes an existing
instinct rather than fighting the layout.

**greg approved the mockup on 2026-09-20, so this workstream is now implemented in this run**
alongside W4, which lands on the same two states. Implement the approved design: the promoted
magic-link block leads, then an `or` divider, then Drive, then the saved-file option, with
nothing removed and Drive's "Recommended" badge dropped (it cannot stand while a different
route is flagged fastest).

**The desktop open question is answered by the approval**: the approved artifact's desktop
specimen leads with a paste CTA and drops the numbered steps, so that is the behaviour to
build, switched on `useIsTouchPrimary()` exactly as `ColdSignInPanel` already does.

Every concrete style token comes from the theme skill and the CIG, not from the mockup's own
CSS: the mockup is design intent (layout, hierarchy, copy, ordering), and the CIG wins on any
conflict. In particular the shipped block uses `surface-*` / `ink-*` / `accent-lift` tokens
rather than the mockup's inlined hex values, and Tailwind utility classes rather than its
hand-rolled scoped CSS.

### Workstream 6 — Consistency sweep

**Terminology is a value-level change, not a key rename.** `deviceLink.*` and `signInCode.*`
are internal key namespaces; renaming them would churn `uiStrings.ts`,
`public/translations/zh.json`, `signInCodeSheet.test.ts` and every consumer for zero
user-visible gain. The user-facing values that actually say the retired words are a short list:

- `deviceLink.title` — "Link a Device"
- `deviceLink.mint` — "Create Link"
- `deviceLink.mintFailed` — "Couldn't create the **device link**…"
- `deviceLink.description` — reword around "magic link", and drop the "needs beanies 0.14 or
  later" clause only if greg confirms the floor has moved (otherwise keep it)
- `signInCode.qrAlt` — "Code to scan on your other device"
- `signInCode.expiryNote`, `signInCode.orScanHint`, `signInCode.scanLead` — say "code"; make
  them say "magic link" where it reads naturally
- `signInCode.gateLead` and `signInCode.createLink` **already** say "magic link" — leave them

**Delete two dead keys** found during review: `signInCode.mint` and `signInCode.lead` have
no consumers anywhere in `src/` (the sheet uses `gateLead` / `createLink` since the chooser was
removed). Removing them keeps the translation pipeline from paying for copy nobody renders.

New/changed keys must satisfy the beanie-mode floor: auth/sign-in/PIN/recovery are important
surfaces, so `beanie` values keep the real nouns and only drop case. Any new key prefix must be
added to `uiStrings.test.ts`'s important-surface prefix list, or the guard test silently stops
covering it.

Surfaces to sweep for terminology, hint presence and affordance ordering: `LoginPage.vue`,
`LoadPodView.vue` (all six viewStates), `ProveView.vue`, `JoinPodView.vue`,
`CreatePodView.vue`, `ResumePodSetup.vue`, `FamilyPickerView.vue`, `NoPodEmptyState.vue`,
`PasteLinkPanel.vue` (already correct — "Have a magic link? Paste it here"),
`ColdSignInPanel.vue`, `DeviceApprovalRequest.vue`, `SignInCodeSheet.vue`, `MagicLinkCard.vue`,
`DeviceLinkCard.vue`, `PodAccessBanner.vue`. `WelcomeGate.vue` is copy-only (no layout change).

Also add a row to the `CLAUDE.md` Terminology Guide table: `magic link` | `device link,
sign-in code, QR code (as a sign-in noun)`.

Recorded as debt in `docs/STATUS.md`, not fixed here: the three raw hex values carried across
in the `InlineMemberPicker` extraction.

### Adjacent, fix if cheap

`startInKitEntry` is not gated on `caps.kit`, so a legacy password-only family tapping
"use a recovery kit" gets a Recovery Code field over an envelope with no kit wraps
(`STATUS.md:2356-2357, 2481-2483`). The prop and its two branches are in
**`LoadPodView.vue:81, 119, 581`** — one condition, and `caps` / `hasRecoveryKits` are already
derived on that component at `:211-216`. (The first draft cited `LoginPage.vue:118,425,729,916`;
the symbol does not exist in that file.)

### Flagged for greg, deliberately NOT changed

1. **Should "sign out and clear data" also drop the LOCAL IndexedDB `beanies-registry` `families` row (NOT the AWS DynamoDB family registry, which sign-out must never touch and does not)?** Doing so would
   return the device to genuinely fresh and make greg's original complaint disappear without
   any of workstream 5. Not changed here because it alters sign-out semantics, is adjacent to
   open issue #346, and is his call.
2. **`emitColdUnlockAbandoned` has no caller anywhere in `src/`.** It was written as the other
   half of `cold_unlock_started`'s denominator, so the cold-surface abandonment _rate_ — the
   number this whole area exists to move — is currently unmeasurable. Wiring it needs an
   unmount/navigation decision (what counts as "left without getting in") that is a design
   question, not a line of code, so it is flagged rather than scoped.
3. **Merging the two Settings cards** now that both are "magic links".

All three recorded in `docs/STATUS.md` for the next session.

## Files Affected

**Created**

- `src/services/auth/linkMint.test.ts` — new (there is no existing `linkMint.test.ts`; note the
  flat layout `src/services/auth/` uses, not a `__tests__/` subdirectory)
- `src/composables/useMintTarget.ts` + `src/composables/__tests__/useMintTarget.test.ts`
- `src/components/ui/InlineMemberPicker.vue` + `src/components/ui/__tests__/InlineMemberPicker.test.ts`
- `src/components/login/ColdEntrySteps.vue`
- `src/components/login/ScanFirstBlock.vue` + `src/components/login/__tests__/ScanFirstBlock.test.ts`
- `src/components/common/__tests__/QuickAddMemberPicker.test.ts` — the extraction's only safety
  net; none exists today

**Cut by pass 3 — do NOT create these**

- ~~`src/components/auth/MagicLinkMinter.vue`~~ — a fourth layer; replaced by `useMintTarget`
  in the hosts, which also fixes the whose-link-is-this defect
- ~~`src/components/family/InviteWizardLauncher.vue`~~ — replaced by an `?invite=` deep link
- ~~a `variant` prop on `ColdSignInPanel`~~ — replaced by `ColdEntrySteps` + `ScanFirstBlock`

**Approved, now in scope**

- `docs/mockups/welcome-back-magic-link-2026-09-20.html` — approved 2026-09-20

**Modified**

- `src/services/auth/linkMint.ts` — required `hintMemberId` on the device mint, `resolveHint`,
  shared `runGate`, `GateMode`, `HintReason` on `MintResult`
- `src/services/telemetry/loginFlowEvents.ts` — `MintFacts` type + `mintDetail()` encoder
- `src/composables/useMintedLink.ts` — `facts: () => MintFacts` getter in place of the
  setup-time `detail` string
- `src/components/common/QuickAddMemberPicker.vue` — thin wrapper over `InlineMemberPicker`
- `src/components/settings/MagicLinkCard.vue` — `useMintTarget`, picker, target-aware status
  and replace-warning (the defect fix), routing
- `src/components/settings/DeviceLinkCard.vue` — `useMintTarget`, picker, routing
- `src/components/auth/SignInCodeSheet.vue` — `useMintTarget`, picker, `gate: 'already-proved'`
- `src/components/auth/__tests__/signInCodeSheet.test.ts` — mock follows the new signature
- `src/components/login/ResumePodSetup.vue` — `gate: 'not-applicable'`, facts via `mintDetail`
- `src/composables/useJoinFlow.ts` — `gate: 'not-applicable'`, facts via `mintDetail`
- `src/components/login/ColdSignInPanel.vue` — docblock truth, renders `ColdEntrySteps`
- `src/components/login/LoadPodView.vue` — `ScanFirstBlock` on `cards` + `reconnect` (W4/W5),
  Drive's "Recommended" badge removed, `startInKitEntry` gated on `caps.kit`
- `src/components/login/__tests__/LoadPodView.credentialSurface.test.ts` — extend the existing
  `startInKitEntry` coverage at `:277,346`
- `src/pages/MeetTheBeansPage.vue` — `?invite=<memberId>` via the existing `useDeepLinkParam`
- `src/services/translation/uiStrings.ts` — terminology values, target-aware keys (`en` +
  `beanie`), **three** dead keys removed: `signInCode.mint`, `signInCode.lead`,
  `loginV6.recommended`
- `public/translations/zh.json` — via `npm run translate`
- `CLAUDE.md` — Terminology Guide table (**done**)
- `docs/STATUS.md` — session record, the flagged questions, the hex debt

**Explicitly NOT modified**

- `src/services/translation/uiStrings.test.ts` — `magicLink.` / `deviceLink.` / `signInCode.` /
  `coldEntry.` are **already** in `IMPORTANT_PREFIXES` (verified at `:33-41`), so the beanie
  floor already covers every key this change touches
- `src/composables/useInviteFlow.ts` — its typed-and-confirmed email hint is correct
- `src/pages/BeanDetailPage.vue` — no launcher migration; its wizard mount is unchanged
- `src/types/syncFileV4.ts` — `memberLinkKeys` / `inviteKeys` are not renamed

## Observability Coverage

The `login-flow` surface already carries `link_mint_started` / `link_minted` /
`link_mint_reentered` via `loginFlowEvents.ts`, owned by `useMintedLink` for the two cards and
hand-rolled at the creation and join sites.

**One encoder, because four sites emit this funnel.** `mintDetail({ origin, target, hint,
gate, routed })` is exported from `loginFlowEvents.ts` beside `emitLinkMinted` and produces the
single `detail` grammar:

```
origin=<settings|profile-menu|creation|join>;target=<self|other>;hint=<1|0>;hintreason=<ok|no-account|unknown-member>
```

Four hand-concatenated `detail` strings would drift the moment one of them gained a field —
`ResumePodSetup.vue` and `useJoinFlow.ts` already build theirs inline today. The encoder lives
next to the emitters, so `linkMint.ts`'s no-telemetry contract is untouched.

**⚠️ `detail` has a phase problem the implementation must solve, not discover.** `hint` is only
known _after_ the mint returns, while `useMintedLink` takes `detail` as a setup-time constant and
emits `link_mint_started` **before** the mint runs. Passing a plain string would either leak the
previous mint's hint into the next start event or force hand-concatenation at all four sites. So
the option becomes a **getter**, `facts: () => MintFacts`, read at each emit point, with `hint`
typed optional and simply absent from the start event. `MintFacts` is a named type beside
`mintDetail` so the two cannot drift.

**Two fields pass 2 proposed are dropped.** `gate=` for the reason in W3. And `routed=` because
it is **vacuous**: routing to the invite wizard means no mint happened, so every `link_minted`
event would carry `routed=magic` by construction and the failure mode it claimed to diagnose is
not observable on that event at all.

**Events changed**

- `link_minted` / `link_mint_started` / `link_mint_reentered` — `detail` extended from
  `origin=<where>` to the grammar above, at **all four** origins.
- `cold_unlock_started` — two new `kind` values (`load-pod-cards`, `load-pod-reconnect`).
- `reportError({ surface: 'login-flow', severity: 'error' })` unchanged for unexpected throws.

**Why `detail` rather than new context keys.** `kind` and `detail` are already allowlisted, so
this ships no new `ALLOWED_CONTEXT_KEYS` entry and therefore needs no update to
`PrivacyInfo.xcprivacy`, the store Data-Safety answers, or `privacy.astro`. Per `CLAUDE.md`
observability rule 5 that gate is real work; avoiding it is deliberate. No email, member name,
member id or token ever enters telemetry — only the booleans and the enum reasons above.

**Failure modes and the event that diagnoses each, blind**

- Chooser still empty after the fix → `hint=0` with `hintreason` naming whether the member had
  no Google account or could not be resolved at all.
- Joiner cannot read the file → the invite wizard's own five-code error taxonomy already covers
  the share failure; a mis-route shows up as an unjoined member reaching a mint at all, which
  the routing unit test makes impossible.
- The W3 gate rejecting legitimate mints → the existing `error_code=gate_declined`, now also
  reachable on the magic path.
- The W3 gate firing where it must not → **not a telemetry question.** Prevented by a unit test
  asserting `requireReauth` is never called for `gate: 'not-applicable'`, and by the two browser
  walkthroughs of create-pod and join in the testing plan.
- Publish failure withholding a link → existing `publish-failed` error code, unchanged.
- A cold surface offering nothing → absence of `cold_unlock_started` for
  `load-pod-cards`/`load-pod-reconnect` on desktop is the expected shape (W4.4), so the series
  must be read per-`kind`, not in aggregate.

**Success-path signal.** `link_minted` already fires on success, so the new `detail` fields make
_rates_ measurable: what share of mints attach a hint, what share route to joining links, and
what share of gates are skipped. That is the number that says whether this work did anything.

**No new `severity: 'critical'`.** Nothing here is data-at-risk; a withheld link already
surfaces to the user in the card, and paging Slack for a declined PIN prompt would be noise.
The two existing `critical` reports at the creation and join mints are unchanged.

**No new silent path.** Every branch added by this plan has a named outcome: `resolveHint`
returns a reason instead of throwing; a missing hint is `hint=0` rather than a refusal;
`runGate` returns `declined` and the host renders `signInCode.notProved`; a QR that will not
draw is already `qrUnavailable` in `useMintedLink`; a routing decision that sends someone to
the invite wizard surfaces that wizard's own five-code error taxonomy rather than swallowing
it. There is no new `catch {}` and no new early `return` without an event.

## Acceptance Criteria

- [ ] Minting a magic link for a member with a `googleAccountEmail` produces a URL carrying `hint=`
- [ ] Minting for a member with only `email` set produces a URL with **no** `hint=`
- [ ] A minted **device** link carries `lk=1` and **no** `m=` param
- [ ] `mintDeviceLink` does not compile without a `hintMemberId`
- [ ] Both Settings cards and the profile-menu sheet mint for self in one tap
- [ ] "Someone else" reveals the `InlineMemberPicker` and mints for the chosen member
- [ ] An unjoined member is marked as such in the picker and routes to
      `/meet-the-beans?invite=<id>`, which opens the **existing** wizard prefilled for them; the
      Drive share is performed by `useInviteFlow` as today, and no modal is stacked
- [ ] **Minting for another member shows THEIR link status and a replace-warning naming THEM**,
      never the minter's — the destructive defect pass 3 found
- [ ] `MeetTheBeansPage` and `BeanDetailPage` open the invite wizard exactly as before
- [ ] `mintMagicLink` prompts for PIN by default in Settings, and `SignInCodeSheet` still does
      not double-prompt
- [ ] **Creating a pod end-to-end shows no PIN prompt**, and the owner's magic link still
      appears on the save step (`gate=skipped`, `origin=creation`)
- [ ] **Joining a pod end-to-end shows no PIN prompt**, and the joiner's link still appears on
      `link-saved` (`gate=skipped`, `origin=join`)
- [ ] `ScanFirstBlock` renders on `cards` and `reconnect`, mounts no `DeviceApprovalRequest`
      and starts no poll there; `ColdSignInPanel` gains no new props
- [ ] `cold_unlock_started` does NOT fire on desktop, where the block renders nothing
- [ ] **Exactly one `PasteLinkPanel` renders on `cards` and on `reconnect`** — no duplicated
      panel, no duplicated "or" divider
- [ ] On a desktop viewport, `cards` and `reconnect` show no push-mode camera instructions
- [ ] The `decrypt` state is visually and behaviourally unchanged
- [ ] `WelcomeGate`'s layout is unchanged apart from copy
- [ ] No user-facing string says "device link" or "sign-in code"; `signInCode.mint` and
      `signInCode.lead` are gone
- [ ] `QuickAddMemberPicker` behaves as before, keeps both `data-testid`s, and now renders a
      pet as a pet
- [ ] Every new `uiStrings` key has both `en` and `beanie`, beanie keeps the real noun on these
      auth surfaces, and any new prefix is registered in `uiStrings.test.ts`
- [ ] Light and dark verified on every touched surface, at phone and desktop width
- [ ] `npm run validate` green; `npm run translate` regenerates `zh.json` cleanly
- [ ] Diagnostic logging implemented and verified; one shared `mintDetail` encoder read as a
      getter so `link_mint_started` never carries a stale `hint`; no new context key was added
- [ ] Workstream 5 built to the approved mockup, with every style token taken from the CIG rather than the mockup's own CSS

## Testing Plan

1. **Unit (`linkMint.test.ts`, new):** `resolveHint` returns `googleAccountEmail`; returns
   undefined with `reason: 'no-account'` when only `email` is set; `'unknown-member'` for a bad
   id; degrades to `'unknown-member'` rather than throwing when the roster read fails.
2. **Unit:** minted URLs contain `hint=` exactly when a `googleAccountEmail` exists; a device
   link contains `lk=1` and no `m=`; a magic link contains `ml=1` and `m=`.
3. **Unit:** `runGate` — `'require'` calls `requireReauth` and withholds on refusal
   (`gate_declined`); `'already-proved'` and `'not-applicable'` never call it; `gate` rides out
   on the success result.
4. **Unit:** routing helper picks joining vs magic from `requiresPassword`.
5. **Unit:** `InlineMemberPicker` emits `pick` with the right id, `cancel` on the back chip,
   renders the empty state, and renders the `#badge` slot per tile.
6. **Unit (new):** `QuickAddMemberPicker` wrapper — both testids present, tile tap calls
   `commitPicker`, back chip calls `cancelPicker`, a pet renders `pet-dog`.
7. **Unit:** `MagicLinkMinter` — defaults to self, "someone else" reveals the picker, an
   unjoined pick emits the joining route instead of minting, an `errorKey` renders in
   `role="alert"`.
8. **Unit:** `mintDetail` produces the documented grammar and omits nothing silently.
9. **Browser:** Settings → mint for self (one tap), then for another member via the picker;
   confirm the QR renders and the URL carries the expected params.
10. **Browser:** `LoadPodView` `cards` and `reconnect` in light and dark at 400px and desktop;
    confirm push-mode copy, exactly one paste panel, and that no polling starts (network tab
    shows no 3-second file re-reads).
11. **Browser:** the `decrypt` state, to prove `variant: 'staged'` is unchanged.
12. **Browser:** full create-pod flow and full join flow, watching for any PIN prompt — the
    regression the W3 correction exists to prevent.
13. **Browser:** `QuickAddFab` member picker, to prove the extraction did not regress it.
14. **Browser:** invite wizard from Meet the Beans and from a bean detail page, post-launcher.
15. **Manual (greg):** real Google consent with a hint applied; a second physical device
    scanning with its native camera; minting for a spouse and signing in as their account;
    inviting an unjoined member through the routed wizard.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted six workstreams against verified code facts; narrowed 4 and 5 to `LoadPodView` after greg excluded the `WelcomeGate` home screen.
- **Pass 2 (DRY + error handling)**: Fixed a reauth gate that would have fired inside the create-pod and join flows and a duplicated `PasteLinkPanel` on `cards`/`reconnect`; replaced three ad-hoc rebuilds with `MagicLinkMinter`, `InviteWizardLauncher` and a shared `mintDetail`/`runGate`; stopped a member id leaking into device-link URLs; corrected file references, test paths and the missing QuickAdd test baseline.
- **Pass 3 (Sustainability)**: Cut three of pass 2's five new seams as over-built — `MagicLinkMinter` (a fourth layer inverting the `useMintedLink`/`MintedLinkPanel` split; replaced by a ~35-line `useMintTarget` composable in the hosts), `InviteWizardLauncher` plus its two-page migration (replaced by an `?invite=` deep link on the existing `useDeepLinkParam`), and `ColdSignInPanel`'s `variant` enum (replaced by `ColdEntrySteps` + `ScanFirstBlock`, leaving the panel prop-free and `decrypt` untouched by construction). Found the destructive defect the wrapper invited: minting for another member while showing the minter's own status and replace-warning, which newest-wins then silently enacts. Dropped `GateOutcome` and the vacuous `routed=` from telemetry and specified the start-vs-settle phase problem `mintDetail` must solve. Renamed the device param to `hintMemberId`, recorded the base64-email-on-the-wire trade-off, found a third dead key (`loginV6.recommended`), and corrected two test paths. **One pass-3 claim rejected on verification**: it said the two `InviteWizardModal` hosts diverge, but they pass the same six props with byte-identical derivations and both default `layer`, so the launcher was cut on the modal-stacking ground instead.
- **Pass 4 (Fresh-eyes sweep)**: _pending_

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial prompt (2026-09-20)

> one thing regarding the welcome gate / sign in (welcome back) screen - after logging out
> (and clearing data) - and presumably for the very first sign in on a fresh device as well -
> the first thing we are asking for is google drive authentication from a newly logging in user.
>
> rather than that, wouldn't it be easier to ask them to scan a code of a logged-in device?
> wouldn't that take them to the relevant google drive sign in (with the email hint enabled)
> and also provide the decryption key so that the file could be decrypted as soon as google
> drive access is enabled? just trying to think what would be the easiest/fasted way for new
> family members to login or to login for the first time on a new device.
>
> given that we now have magic link QR codes, should tihs be the promoted, first-class login
> option at all times provided there is not already a decrypted file on the device?
>
> Does the below make sense?
>
> - if no decrypted file on device, propose to open camera and scan a magic qr code, as an
>   alternative (lower option) open google drive and consent, once consent is done, then offer
>   QR code or password/passphrase for sign-in (this is where the consent and then
>   password/passphrase flow works)
>
> - if decrypted file exists on device, simply choose it and then choose your family member
>
> what do you tihnk of the above?

### Follow-up 1

> Ok - first off we had already decided that EVERY sign-in link/qr generated should be called
> a magic link - it doesn't matter the duration (15 min, 7 days, whatever). if its a link or qr
> code that facilitates sign in, it's a magic link, to avoid any confusion in the future. pls
> take note.
>
> agree with (3) above completely - when generating a magic link for yourself or another member
> from the UI, let's ask 'which beanie is signing in?' or something to that effect - we can
> re-use the same 'fold-down' (accordion open) type effect that we use on the FAB when a family
> member needs to be selected for a particular function. if a user has not joined yet, it created
> a joining link rather than a magic link (although if i'm not wrong, i believe these are already
> equivalent, or are treated the same by the app). this should work and also make magic link
> creation more intuitive, i think, rather than less.
>
> regarding (2) i would push back - i think ALL magic links, regardless of duration, should come
> with the googleAccountEmail hint - this should be a hard constraint across the app. always
> include the hint no amtter what, if it exists.
>
> In additoon, we should also include the welcome gate / welcome back login surface changes (i.e.
> putting the camera option as first class (even though we are asking the user to close beanies
> and open the camera to scan a qr code) - combined with the changes above, this is the genuinely
> less confusing approach to signing in, in my opinion. let me know if you feel differently. sweep
> across the app to ensure this is fully consistent across all login, re-login, etc surfaces.
>
> does this make sense? if so please go ahead to plan and build directly with /beanies-build-auto

### Follow-up 2

> yes agree with your caveat above and to be clear, i am NOT proposing to change the layout of
> the welcome gate HOME screen. We should only apply this to the "welcome back" view which comes
> agter you tap the welcome back button. The home screen should not change.
>
> only once a user has explictly chosen the login path (not the create pod path) should they be
> presented with the magic link scan option as the first class approach to login or re-login

### Follow-up 3

> place the mockup as a claude artifact ps

</details>
